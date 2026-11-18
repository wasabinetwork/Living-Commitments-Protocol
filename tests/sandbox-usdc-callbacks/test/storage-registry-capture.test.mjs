import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateStorageRegistryCaptures } from "../verify-storage-registry-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [capacityCapture, shapeCapture] = await Promise.all([
  readFile(resolve(
    here,
    "../recovery-acceptance-2026-11-17-689fbf1/storage-registry-cap.json",
  ), "utf8").then(JSON.parse),
  readFile(resolve(
    here,
    "../recovery-acceptance-2026-11-17-689fbf1/storage-shape.json",
  ), "utf8").then(JSON.parse),
]);

test("accepts the complete-capacity and maximum-payer Sandbox captures", () => {
  assert.equal(validateStorageRegistryCaptures(capacityCapture, shapeCapture).registry_limit, 2048);
});

test("rejects a core artifact that differs from the pinned build", () => {
  const changed = structuredClone(capacityCapture);
  changed.wasm_artifacts.lcp_core_fixture.wasm_sha256 = "00".repeat(32);
  assert.throws(() => validateStorageRegistryCaptures(changed, shapeCapture), /pinned candidate/);
});

test("rejects a reserve view that reports readiness during revaluation", () => {
  const changed = structuredClone(capacityCapture);
  changed.scenarios.storage_registry_acceptance.revaluation_batches[0].reserve_view.ready = true;
  assert.throws(() => validateStorageRegistryCaptures(changed, shapeCapture), /readiness mismatch/);
});

test("rejects a missing or skipped revaluation batch", () => {
  const changed = structuredClone(capacityCapture);
  changed.scenarios.storage_registry_acceptance.revaluation_batches.pop();
  assert.throws(() => validateStorageRegistryCaptures(changed, shapeCapture), /batch count/);
});

test("rejects a changed maximum-payer storage measurement", () => {
  const changed = structuredClone(shapeCapture);
  changed.scenarios.storage_registry_shape_acceptance.measured_credit_storage_bytes = "33727";
  assert.throws(() => validateStorageRegistryCaptures(capacityCapture, changed), /measured_credit_storage_bytes/);
});
