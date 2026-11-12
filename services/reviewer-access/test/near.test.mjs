import assert from "node:assert/strict";
import test from "node:test";
import {
  createNearReadSession,
  NearReadError,
  NearUnavailableError,
  parseNearAccountId,
  parseSha256,
} from "../dist/src/near.js";

const BLOCK_HASH = "1".repeat(44);
const BLOCK_HEIGHT = 277_000_000;
const BLOCK_TIMESTAMP_NS = "1794192696952171274";
const PROVIDERS = ["https://rpc1.example.test/", "https://rpc2.example.test/", "https://rpc3.example.test/"];
const env = {
  NEAR_RPC_URL: PROVIDERS[0],
  NEAR_RPC_FALLBACK_URLS: `${PROVIDERS[1]},${PROVIDERS[2]}`,
  CONTRACT_ID: "livingcommitmentsprotocol.testnet",
};

function blockResult() {
  return { header: { hash: BLOCK_HASH, height: BLOCK_HEIGHT, timestamp_nanosec: BLOCK_TIMESTAMP_NS } };
}

function queryResult(value) {
  return { block_hash: BLOCK_HASH, block_height: BLOCK_HEIGHT, ...value };
}

function rpcResponse(result) {
  return Response.json({ jsonrpc: "2.0", id: "lcp-reviewer-access", result });
}

test("account and digest parsers accept only canonical values", () => {
  assert.equal(parseNearAccountId("wasabinetwork.testnet"), "wasabinetwork.testnet");
  assert.equal(parseNearAccountId("UPPER.testnet"), null);
  assert.equal(parseSha256("a".repeat(64)), "a".repeat(64));
  assert.equal(parseSha256("A".repeat(64)), null);
});

test("finalized block timestamp is read from NEAR RPC", async (t) => {
  t.mock.method(globalThis, "fetch", async () => rpcResponse(blockResult()));
  assert.equal(await createNearReadSession(env).finalizedTimeNs(), 1_794_192_696_952_171_274n);
});

test("reviewer authorization reads tolerate one unavailable provider when two agree", async (t) => {
  const endpoints = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    endpoints.push(url);
    if (url.includes("rpc1")) return new Response("unavailable", { status: 503 });
    return rpcResponse(blockResult());
  });

  assert.equal(await createNearReadSession(env).finalizedTimeNs(), 1_794_192_696_952_171_274n);
  assert.deepEqual(endpoints, PROVIDERS);
});

test("network and malformed JSON responses map to retryable NEAR failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{", { status: 200 }));
  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);

  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);
});

test("contract views encode their JSON arguments and decode finalized JSON bytes", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    requests.push(requestBody);
    if (requestBody.method === "block") return rpcResponse(blockResult());
    const result = new TextEncoder().encode(JSON.stringify({ maintainer: "wasabinetwork.testnet" }));
    return rpcResponse(queryResult({ result: Array.from(result) }));
  });

  assert.deepEqual(await createNearReadSession(env).viewContract("get_commitment", { commitment_id: "24" }), {
    maintainer: "wasabinetwork.testnet",
  });
  const queryRequest = requests.find((request) => request.method === "query");
  assert.equal(queryRequest.params.block_id, BLOCK_HASH);
  assert.equal(queryRequest.params.method_name, "get_commitment");
  assert.equal(atob(queryRequest.params.args_base64), JSON.stringify({ commitment_id: "24" }));
});

test("current access-key permissions are distinguished from missing permissions", async (t) => {
  let permission = "FullAccess";
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    if (requestBody.method === "block") return rpcResponse(blockResult());
    return rpcResponse(queryResult({ permission }));
  });
  await createNearReadSession(env).requireFullAccessKey("maintainer.testnet", "ed25519:validtestkey");

  t.mock.restoreAll();
  permission = null;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    if (requestBody.method === "block") return rpcResponse(blockResult());
    return rpcResponse(queryResult({ permission }));
  });
  await assert.rejects(
    createNearReadSession(env).requireCurrentAccessKey("maintainer.testnet", "ed25519:validtestkey"),
    NearReadError,
  );
});
