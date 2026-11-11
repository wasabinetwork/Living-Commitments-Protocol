import assert from "node:assert/strict";
import test from "node:test";
import { NearJsonRpcTransport } from "../dist/index.js";

test("NEAR contract reads fall back after a provider outage", async () => {
  const endpoints = [];
  const transport = new NearJsonRpcTransport({
    rpcUrl: ["https://primary.example.test", "https://fallback.example.test"],
    fetchImplementation: async (url) => {
      endpoints.push(url);
      if (url.includes("primary")) return new Response("unavailable", { status: 503 });
      const result = new TextEncoder().encode(JSON.stringify({ status: "Healthy" }));
      return Response.json({ result: { result: Array.from(result) } });
    },
  });

  assert.deepEqual(await transport.view("lcp.testnet", "get_commitment", { commitment_id: "1" }), {
    status: "Healthy",
  });
  assert.deepEqual(endpoints, ["https://primary.example.test", "https://fallback.example.test"]);
});

test("NEAR contract read errors are not hidden by provider fallback", async () => {
  const endpoints = [];
  const transport = new NearJsonRpcTransport({
    rpcUrl: ["https://primary.example.test", "https://fallback.example.test"],
    fetchImplementation: async (url) => {
      endpoints.push(url);
      return Response.json({ error: { code: -32601, message: "Method not found" } });
    },
  });

  await assert.rejects(transport.view("lcp.testnet", "missing_method", {}), /Method not found/);
  assert.deepEqual(endpoints, ["https://primary.example.test"]);
});
