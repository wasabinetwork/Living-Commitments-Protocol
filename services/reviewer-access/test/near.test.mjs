import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizedTimeNs,
  NearReadError,
  NearUnavailableError,
  parseNearAccountId,
  parseSha256,
  requireCurrentAccessKey,
  requireFullAccessKey,
  viewContract,
} from "../dist/src/near.js";

const env = { NEAR_RPC_URL: "https://rpc.example.test", CONTRACT_ID: "livingcommitmentsprotocol.testnet" };

test("account and digest parsers accept only canonical values", () => {
  assert.equal(parseNearAccountId("wasabinetwork.testnet"), "wasabinetwork.testnet");
  assert.equal(parseNearAccountId("UPPER.testnet"), null);
  assert.equal(parseSha256("a".repeat(64)), "a".repeat(64));
  assert.equal(parseSha256("A".repeat(64)), null);
});

test("finalized block timestamp is read from NEAR RPC", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: { header: { timestamp_nanosec: "1794192696952171274" } } }));
  assert.equal(await finalizedTimeNs(env), 1_794_192_696_952_171_274n);
});

test("reviewer authorization reads fall back when the primary RPC is unavailable", async (t) => {
  const endpoints = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    endpoints.push(url);
    if (url.includes("primary")) return new Response("unavailable", { status: 503 });
    return Response.json({ result: { header: { timestamp_nanosec: "1794192696952171274" } } });
  });

  assert.equal(await finalizedTimeNs({
    ...env,
    NEAR_RPC_URL: "https://primary.example.test",
    NEAR_RPC_FALLBACK_URLS: "https://fallback.example.test",
  }), 1_794_192_696_952_171_274n);
  assert.deepEqual(endpoints, ["https://primary.example.test", "https://fallback.example.test"]);
});

test("network and malformed JSON responses map to retryable NEAR failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{", { status: 200 }));
  await assert.rejects(finalizedTimeNs(env), NearUnavailableError);

  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(finalizedTimeNs(env), NearUnavailableError);
});

test("contract views encode their JSON arguments and decode finalized JSON bytes", async (t) => {
  let requestBody;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const result = new TextEncoder().encode(JSON.stringify({ maintainer: "wasabinetwork.testnet" }));
    return Response.json({ result: { result: Array.from(result) } });
  });

  assert.deepEqual(await viewContract(env, "get_commitment", { commitment_id: "24" }), {
    maintainer: "wasabinetwork.testnet",
  });
  assert.equal(requestBody.method, "query");
  assert.equal(requestBody.params.finality, "final");
  assert.equal(requestBody.params.method_name, "get_commitment");
  assert.equal(atob(requestBody.params.args_base64), JSON.stringify({ commitment_id: "24" }));
});

test("current access-key permissions are distinguished from missing permissions", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: { permission: "FullAccess" } }));
  await requireFullAccessKey(env, "maintainer.testnet", "ed25519:validtestkey");

  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: { permission: null } }));
  await assert.rejects(
    requireCurrentAccessKey(env, "maintainer.testnet", "ed25519:validtestkey"),
    NearReadError,
  );
});
