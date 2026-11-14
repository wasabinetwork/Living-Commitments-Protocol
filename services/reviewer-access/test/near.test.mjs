import assert from "node:assert/strict";
import test from "node:test";
import {
  createNearReadSession,
  NearReadError,
  NearUnavailableError,
  parseNearAccountId,
  parseSha256,
} from "../dist/src/near.js";

const BLOCK_HASH = "GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN";
const BLOCK_HEIGHT = 277_000_000;
const BLOCK_TIMESTAMP_NS = (BigInt(Date.now()) * 1_000_000n - 1_000_000_000n).toString();
const PROVIDERS = ["https://rpc1.example.test/", "https://rpc2.example.test/", "https://rpc3.example.test/"];
const env = {
  NEAR_RPC_URL: PROVIDERS[0],
  NEAR_RPC_FALLBACK_URLS: `${PROVIDERS[1]},${PROVIDERS[2]}`,
  CONTRACT_ID: "livingcommitmentsprotocol.testnet",
};

function blockResult({ hash = BLOCK_HASH, height = BLOCK_HEIGHT, timestamp = BLOCK_TIMESTAMP_NS } = {}) {
  return { header: { hash, height, timestamp_nanosec: timestamp } };
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
  assert.equal(await createNearReadSession(env).finalizedTimeNs(), BigInt(BLOCK_TIMESTAMP_NS));
});

test("reviewer authorization reads tolerate one unavailable provider when two agree", async (t) => {
  const endpoints = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    endpoints.push(url);
    if (url.includes("rpc1")) return new Response("unavailable", { status: 503 });
    return rpcResponse(blockResult());
  });

  assert.equal(await createNearReadSession(env).finalizedTimeNs(), BigInt(BLOCK_TIMESTAMP_NS));
  assert.deepEqual(endpoints, [...PROVIDERS, ...PROVIDERS]);
});

test("small finalized-head skew uses the highest checkpoint backed by two providers", async (t) => {
  const heights = new Map([
    ["rpc1", BLOCK_HEIGHT],
    ["rpc2", BLOCK_HEIGHT + 1],
    ["rpc3", BLOCK_HEIGHT + 2],
  ]);
  const pinnedHeights = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = JSON.parse(init.body);
    if (request.method !== "block") throw new Error("Unexpected RPC method.");
    if (request.params.finality === "final") {
      const provider = new URL(url).hostname.split(".")[0];
      return rpcResponse(blockResult({ height: heights.get(provider) }));
    }
    pinnedHeights.push(request.params.block_id);
    return rpcResponse(blockResult({ height: request.params.block_id }));
  });

  assert.equal(await createNearReadSession(env).finalizedTimeNs(), BigInt(BLOCK_TIMESTAMP_NS));
  assert.deepEqual(pinnedHeights, [BLOCK_HEIGHT + 1, BLOCK_HEIGHT + 1, BLOCK_HEIGHT + 1]);
});

test("finalized head skew beyond the freshness bound fails closed", async (t) => {
  const heights = [BLOCK_HEIGHT, BLOCK_HEIGHT + 1, BLOCK_HEIGHT + 20];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = JSON.parse(init.body);
    const providerIndex = PROVIDERS.findIndex((provider) => url.includes(provider));
    return rpcResponse(blockResult({ height: heights[providerIndex] }));
  });
  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);
});

test("freshness check rejects an old but otherwise unanimous finalized checkpoint", async (t) => {
  const staleTimestamp = (BigInt(Date.now()) * 1_000_000n - 61_000_000_000n).toString();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method !== "block") throw new Error("Unexpected RPC method.");
    return rpcResponse({
      header: {
        hash: BLOCK_HASH,
        height: request.params.block_id ?? BLOCK_HEIGHT,
        timestamp_nanosec: staleTimestamp,
      },
    });
  });
  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);
});

test("freshness check rejects an implausibly future finalized checkpoint", async (t) => {
  const futureTimestamp = (BigInt(Date.now()) * 1_000_000n + 16_000_000_000n).toString();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method !== "block") throw new Error("Unexpected RPC method.");
    return rpcResponse(blockResult({
      height: request.params.block_id ?? BLOCK_HEIGHT,
      timestamp: futureTimestamp,
    }));
  });
  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);
});

test("authorization reads tolerate one unavailable provider when two agree", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url.includes("rpc1")) return new Response("unavailable", { status: 503 });
    const request = JSON.parse(init.body);
    if (request.method === "block") return rpcResponse(blockResult());
    return rpcResponse(queryResult({ permission: "FullAccess" }));
  });

  await createNearReadSession(env).requireFullAccessKey("maintainer.testnet", "ed25519:validtestkey");
});

test("conflicting finalized block responses fail closed", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const result = blockResult();
    if (url.includes("rpc1")) return rpcResponse(result);
    if (url.includes("rpc2")) result.header.hash = "1".repeat(32);
    else result.header.hash = "AaEtZZbVfzFTa1ffhsjnYSJNtZAF7BKgn34i8T66h4CF";
    return rpcResponse(result);
  });

  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);
});

test("a third valid but conflicting pinned checkpoint fails even when two providers agree", async (t) => {
  const dissentingHash = "AaEtZZbVfzFTa1ffhsjnYSJNtZAF7BKgn34i8T66h4CF";
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = JSON.parse(init.body);
    if (request.method !== "block") throw new Error("Unexpected RPC method.");
    const block = blockResult({ height: request.params.block_id ?? BLOCK_HEIGHT });
    if (request.params.block_id !== undefined && url.includes("rpc3")) block.header.hash = dissentingHash;
    return rpcResponse(block);
  });
  await assert.rejects(createNearReadSession(env).finalizedTimeNs(), NearUnavailableError);
});

test("conflicting finalized authorization state responses fail closed", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "block") return rpcResponse(blockResult());
    if (url.includes("rpc3")) return new Response("unavailable", { status: 503 });
    const permission = url.includes("rpc1") ? "FullAccess" : "FunctionCall";
    return rpcResponse(queryResult({ permission }));
  });

  await assert.rejects(
    createNearReadSession(env).requireFullAccessKey("maintainer.testnet", "ed25519:validtestkey"),
    NearUnavailableError,
  );
});

test("a dissenting third valid authorization response fails even when two providers agree", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "block") return rpcResponse(blockResult());
    const permission = url.includes("rpc3") ? "FunctionCall" : "FullAccess";
    return rpcResponse(queryResult({ permission }));
  });

  await assert.rejects(
    createNearReadSession(env).requireFullAccessKey("maintainer.testnet", "ed25519:validtestkey"),
    NearUnavailableError,
  );
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
