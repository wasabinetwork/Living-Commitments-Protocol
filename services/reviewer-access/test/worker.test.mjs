import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { canonicalJson, borshString, concatBytes, encodeBase64, sha256Hex, u32le } from "../dist/src/encoding.js";
import worker from "../dist/src/index.js";

globalThis.crypto ??= webcrypto;
const allowedOrigin = "https://console.example.test";
const RPC_BLOCK_HASH = "1".repeat(44);
const RPC_BLOCK_HEIGHT = 277_000_000;
const baseEnv = {
  NETWORK: "testnet",
  CONTRACT_ID: "livingcommitmentsprotocol.testnet",
  NEAR_RPC_URL: "https://rpc.example.test",
  NEAR_RPC_FALLBACK_URLS: "https://rpc2.example.test,https://rpc3.example.test",
  APP_ORIGINS: allowedOrigin,
  ACCESS_RECIPIENT: "console.example.test/reviewer-access",
  API_RATE_LIMITER: { async limit() { return { success: true }; } },
};

function rpcResponse(result) {
  return Response.json({ jsonrpc: "2.0", id: "lcp-reviewer-access", result });
}

function finalizedBlock(timestampNs) {
  return rpcResponse({
    header: { hash: RPC_BLOCK_HASH, height: RPC_BLOCK_HEIGHT, timestamp_nanosec: timestampNs },
  });
}

function finalizedQueryResult(result) {
  return rpcResponse({ block_hash: RPC_BLOCK_HASH, block_height: RPC_BLOCK_HEIGHT, ...result });
}

function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let integer = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (integer > 0n) {
    const digit = Number(integer % 58n);
    encoded = alphabet[digit] + encoded;
    integer /= 58n;
  }
  const zeroes = bytes.findIndex((byte) => byte !== 0);
  return "1".repeat(zeroes < 0 ? bytes.length : zeroes) + encoded;
}

async function signedRequest(request, recipient, signerAccount = request.reviewer_account) {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const nonce = Uint8Array.from(request.nonce_hex.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
  const message = canonicalJson(request);
  const payload = concatBytes(borshString(message), nonce, borshString(recipient), new Uint8Array([0]));
  const digest = await crypto.subtle.digest("SHA-256", concatBytes(u32le(2_147_484_061), payload));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, digest));
  return {
    account_id: signerAccount,
    public_key: `ed25519:${encodeBase58(publicKeyBytes)}`,
    signature: encodeBase64(signature),
    nonce_hex: request.nonce_hex,
    recipient,
  };
}

function mockDatabase({ requestRow = null, batchChanges = [1, 1, 1] } = {}) {
  const executed = [];
  return {
    executed,
    prepare(query) {
      const statement = {
        query,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          executed.push({ query, args: this.args, method: "first" });
          if (query.includes("reviewer_access_windows")) return { request_count: 1 };
          if (query.includes("FROM reviewer_requests")) return requestRow;
          return null;
        },
        async run() {
          executed.push({ query, args: this.args, method: "run" });
          return { success: true, meta: { changes: query.includes("UPDATE reviewer_requests") ? 0 : 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      executed.push({
        method: "batch",
        statements: statements.map((statement) => ({ query: statement.query, args: statement.args })),
      });
      return statements.map((_, index) => ({ success: true, meta: { changes: batchChanges[index] ?? 1 } }));
    },
  };
}

test("health reports configured network without exposing storage details", async () => {
  const response = await worker.fetch(new Request("https://reviewer.example.test/health"), baseEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "lcp-reviewer-access",
    network: "testnet",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("CORS preflight reflects only an exact configured origin", async () => {
  const allowed = await worker.fetch(new Request("https://reviewer.example.test/v1/requests", {
    method: "OPTIONS",
    headers: { Origin: allowedOrigin },
  }), baseEnv);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);

  const rejected = await worker.fetch(new Request("https://reviewer.example.test/v1/requests", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example.test" },
  }), baseEnv);
  assert.equal(rejected.status, 204);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});

test("signed API routes reject missing or unlisted origins before reading the body", async () => {
  const response = await worker.fetch(new Request("https://reviewer.example.test/v1/requests", {
    method: "POST",
    headers: { Origin: "https://attacker.example.test", "Content-Type": "application/json" },
    body: "not json",
  }), baseEnv);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "FORBIDDEN",
    message: "This application origin is not allowed.",
  });
});

test("malformed JSON and unknown routes return bounded errors", async () => {
  const malformed = await worker.fetch(new Request("https://reviewer.example.test/v1/requests", {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: "{",
  }), baseEnv);
  assert.equal(malformed.status, 400);

  const missing = await worker.fetch(new Request("https://reviewer.example.test/v1/unknown", {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: "{}",
  }), baseEnv);
  assert.equal(missing.status, 404);
});

test("reviewer request checks the wallet key and completed evaluation before storing consent metadata", async (t) => {
  const nowNs = "1794192696952171274";
  const database = mockDatabase();
  const env = { ...baseEnv, DB: database, PRIVATE_ARTIFACTS: { async put() {}, async get() { return null; }, async delete() {} } };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    const rpcRequest = JSON.parse(init.body);
    if (rpcRequest.method === "block") {
      return finalizedBlock(nowNs);
    }
    if (rpcRequest.method === "query" && rpcRequest.params.request_type === "view_access_key") {
      return finalizedQueryResult({ permission: "FullAccess" });
    }
    if (rpcRequest.method === "query" && rpcRequest.params.request_type === "call_function") {
      const view = { status: "Accepted", evidence_hash: "b".repeat(64) };
      return finalizedQueryResult({ result: Array.from(new TextEncoder().encode(JSON.stringify(view))) });
    }
    throw new Error(`Unexpected NEAR RPC request: ${rpcRequest.method}`);
  };

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const request = {
    schema: "lcp.reviewer-request.v1",
    contract_id: baseEnv.CONTRACT_ID,
    commitment_id: "24",
    evaluation_id: "7",
    evidence_digest: "a".repeat(64),
    reviewer_account: "reviewer.testnet",
    encryption_public_key_b64: encodeBase64(keyBytes),
    encryption_key_fingerprint: await sha256Hex(keyBytes),
    scopes: ["download_ciphertext"],
    expires_at_ns: (BigInt(nowNs) + 60_000_000_000n).toString(),
    nonce_hex: "c".repeat(64),
  };
  const signed = await signedRequest(request, baseEnv.ACCESS_RECIPIENT);
  const response = await worker.fetch(new Request("https://reviewer.example.test/v1/requests", {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ request, signed_message: signed }),
  }), env);

  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, "pending");
  assert.ok(database.executed.some(({ query }) => query.includes("INSERT INTO reviewer_requests")));
  assert.ok(database.executed.some(({ query }) => query.includes("used_nep413_nonces")));
  const storedRequest = database.executed.find(({ query }) => query.includes("INSERT INTO reviewer_requests"));
  assert.match(storedRequest.query, /request_public_key, request_signature_b64, request_callback_url/);
  assert.ok(storedRequest.args.includes(signed.signature));
});

test("grant creation keeps signed approval evidence and gates every write on one unused nonce", async (t) => {
  const nowNs = "1794192696952171274";
  const requestId = "d43fd0cc-296d-4cb9-96b0-66a43eef4f10";
  const reviewerKey = new Uint8Array(32).fill(9);
  const requestRow = {
    request_id: requestId,
    network: "testnet",
    contract_id: baseEnv.CONTRACT_ID,
    commitment_id: "24",
    evaluation_id: "7",
    evidence_digest: "a".repeat(64),
    reviewer_account: "reviewer.testnet",
    encryption_public_key_b64: encodeBase64(reviewerKey),
    encryption_key_fingerprint: await sha256Hex(reviewerKey),
    scopes_json: '["download_ciphertext"]',
    expires_at_ns: (BigInt(nowNs) + 60_000_000_000n).toString(),
    created_at_ns: nowNs,
    status: "pending",
  };
  const database = mockDatabase({ requestRow });
  const uploaded = [];
  const deleted = [];
  const env = {
    ...baseEnv,
    DB: database,
    MAX_ARTIFACT_BYTES: "8388608",
    PRIVATE_ARTIFACTS: {
      async put(key, bytes) { uploaded.push({ key, bytes: new Uint8Array(bytes) }); },
      async delete(key) { deleted.push(key); },
    },
  };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    const rpcRequest = JSON.parse(init.body);
    if (rpcRequest.method === "block") {
      return finalizedBlock(nowNs);
    }
    if (rpcRequest.method === "query" && rpcRequest.params.request_type === "view_access_key") {
      return finalizedQueryResult({ permission: "FullAccess" });
    }
    if (rpcRequest.method === "query" && rpcRequest.params.request_type === "call_function") {
      return finalizedQueryResult({ result: Array.from(new TextEncoder().encode(JSON.stringify({ maintainer: "maintainer.testnet" }))) });
    }
    throw new Error(`Unexpected NEAR RPC request: ${rpcRequest.method}`);
  };

  const ciphertext = new Uint8Array(16).fill(4);
  const grant = {
    schema: "lcp.reviewer-grant.v1",
    request_id: requestId,
    ciphertext_sha256: await sha256Hex(ciphertext),
    ciphertext_bytes: ciphertext.byteLength,
    hpke_enc_b64: encodeBase64(new Uint8Array(32).fill(1)),
    wrapped_key_b64: encodeBase64(new Uint8Array(48).fill(2)),
    content_iv_b64: encodeBase64(new Uint8Array(12).fill(3)),
    scopes: ["download_ciphertext"],
    expires_at_ns: requestRow.expires_at_ns,
    nonce_hex: "d".repeat(64),
  };
  const signed = await signedRequest(grant, baseEnv.ACCESS_RECIPIENT, "maintainer.testnet");
  const response = await worker.fetch(new Request("https://reviewer.example.test/v1/grants", {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ grant, ciphertext_b64: encodeBase64(ciphertext), signed_message: signed }),
  }), env);

  assert.equal(response.status, 201);
  assert.equal(uploaded.length, 1);
  assert.equal(deleted.length, 0);
  const batch = database.executed.find(({ method }) => method === "batch");
  assert.ok(batch);
  assert.match(batch.statements[1].query, /AND changes\(\) = 1/);
  assert.match(batch.statements[2].query, /resolution_public_key = \?, resolution_signature_b64 = \?, resolution_callback_url = \?/);
  assert.match(batch.statements[2].query, /AND changes\(\) = 1/);
  assert.ok(batch.statements[2].args.includes(signed.signature));
});

test("scheduled cleanup retries expired and orphan ciphertext and removes terminal metadata", async (t) => {
  const nowNs = "2000000000000000000";
  const queries = [];
  const database = {
    prepare(query) {
      const statement = {
        query,
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() { queries.push({ query, args: this.args, kind: "run" }); return { success: true, meta: { changes: 1 } }; },
        async all() {
          queries.push({ query, args: this.args, kind: "all" });
          if (query.includes("WITH grant_retention")) {
            return { success: true, results: [{ grant_id: "grant-1", request_id: "request-1", artifact_id: "artifact-1", retention_anchor_ns: "1" }] };
          }
          if (query.includes("JOIN reviewer_grants g")) {
            return { success: true, results: [{ artifact_id: "expired-id", object_key: "expired-key" }] };
          }
          if (query.includes("NOT EXISTS (SELECT 1 FROM reviewer_grants g WHERE g.artifact_id")) {
            return { success: true, results: [{ artifact_id: "orphan-id", object_key: "orphan-key" }] };
          }
          return { success: true, results: [] };
        },
      };
      return statement;
    },
    async batch(statements) {
      queries.push({ kind: "batch", statements: statements.map((statement) => statement.query) });
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const deletedKeys = [];
  const env = {
    ...baseEnv,
    DB: database,
    PRIVATE_ARTIFACTS: { async delete(keys) { deletedKeys.push(keys); } },
  };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    const rpcRequest = JSON.parse(init.body);
    if (rpcRequest.method === "block") return finalizedBlock(nowNs);
    throw new Error(`Unexpected NEAR RPC request: ${rpcRequest.method}`);
  };

  await worker.scheduled({}, env);

  assert.deepEqual(deletedKeys, [["expired-key"], ["orphan-key"]]);
  assert.ok(queries.some(({ kind, statements }) => kind === "batch" && statements.some((query) => query.includes("DELETE FROM reviewer_grants"))));
  assert.ok(queries.some(({ kind, statements }) => kind === "batch" && statements.some((query) => query.includes("DELETE FROM reviewer_requests"))));
  const retentionQuery = queries.find(({ query }) => query?.includes("WITH grant_retention"))?.query;
  assert.match(retentionQuery, /LENGTH\(retention_anchor_ns\)/);
});
