import assert from "node:assert/strict";
import test from "node:test";

import { addFastNearApiKey, createRequestPacer, readNextCanonicalBlocks } from "../src/index.ts";

const CONTRACT_ID = "livingcommitmentsprotocol.testnet";
const LAST_HASH = "last-indexed-hash";

function block(height, previousHash) {
  return {
    block: {
      header: {
        height,
        hash: `block-hash-${height}`,
        prev_hash: previousHash,
        timestamp_nanosec: "1",
      },
    },
    shards: [],
  };
}

test("reads bounded concurrent batches and verifies parent hashes in height order", async () => {
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  const parentHashes = new Map([[567, LAST_HASH], [568, "block-hash-567"], [569, "block-hash-568"], [570, "block-hash-569"]]);
  const result = await readNextCanonicalBlocks(async (height) => {
    activeRequests += 1;
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
    await new Promise((resolve) => setImmediate(resolve));
    activeRequests -= 1;
    return block(height, parentHashes.get(height));
  }, 567, 570, 4, LAST_HASH, CONTRACT_ID, 2);

  assert.equal(maximumConcurrentRequests, 2);
  assert.deepEqual(result.blocks.map((item) => item.height), [567, 568, 569, 570]);
  assert.equal(result.heightSlotCount, 4);
});

test("accepts an absent height in a concurrent batch only when the next block links to the stored hash", async () => {
  const result = await readNextCanonicalBlocks(async (height) => {
    if (height === 566) return null;
    const parentHash = height === 567 ? LAST_HASH : `block-hash-${height - 1}`;
    return block(height, parentHash);
  }, 566, 569, 4, LAST_HASH, CONTRACT_ID, 2);

  assert.deepEqual(result.blocks.map((item) => item.height), [567, 568, 569]);
  assert.equal(result.heightSlotCount, 4);
});

test("rejects a missing-height gap when the next block does not extend the stored hash", async () => {
  await assert.rejects(
    readNextCanonicalBlocks(async (height) => height === 566 ? null : block(height, "unexpected-parent"),
      566, 569, 4, LAST_HASH, CONTRACT_ID, 2),
    (error) => error.code === "CHAIN_DISCONTINUITY",
  );
});

test("refuses to skip a missing first height without a stored parent hash", async () => {
  await assert.rejects(
    readNextCanonicalBlocks(async () => null, 566, 569, 4, null, CONTRACT_ID, 2),
    (error) => error.code === "INVALID_BLOCK",
  );
});

test("does not scan beyond the per-run height budget", async () => {
  const requestedHeights = [];
  const result = await readNextCanonicalBlocks(async (height) => {
    requestedHeights.push(height);
    return null;
  }, 566, 570, 2, LAST_HASH, CONTRACT_ID, 2);

  assert.deepEqual(requestedHeights, [566, 567]);
  assert.equal(result.heightSlotCount, 2);
  assert.equal(result.blocks.length, 0);
});

test("does not count or advance through trailing null heights without a linked successor", async () => {
  const result = await readNextCanonicalBlocks(async (height) => {
    if (height > 566) return null;
    return block(height, LAST_HASH);
  }, 566, 569, 4, LAST_HASH, CONTRACT_ID, 2);

  assert.deepEqual(result.blocks.map((item) => item.height), [566]);
  assert.equal(result.heightSlotCount, 4);
});

test("paces concurrent source requests instead of releasing a burst", async () => {
  const waitForSlot = createRequestPacer(20);
  const startTimes = [];
  await Promise.all(Array.from({ length: 4 }, async () => {
    await waitForSlot();
    startTimes.push(Date.now());
  }));

  startTimes.sort((left, right) => left - right);
  for (let index = 1; index < startTimes.length; index += 1) {
    assert.ok(startTimes[index] - startTimes[index - 1] >= 18);
  }
});

test("adds an optional FastNear key as an encoded query parameter without changing URLs when absent", () => {
  const url = "https://testnet.neardata.xyz/v0/block/123?source=test";
  assert.equal(addFastNearApiKey(url, undefined), url);

  const authenticated = new URL(addFastNearApiKey(url, "key with spaces"));
  assert.equal(authenticated.searchParams.get("source"), "test");
  assert.equal(authenticated.searchParams.get("apiKey"), "key with spaces");
});
