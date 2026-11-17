import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const defaultCapacityPath = resolve(
  here,
  "recovery-acceptance-2026-11-17-18ed543/storage-registry-cap.json",
);
const defaultShapePath = resolve(
  here,
  "recovery-acceptance-2026-11-17-18ed543/storage-shape.json",
);
const EXPECTED_CORE_WASM_SHA256 = "0cd6a24c9ef345a0e8d46d4fffea4361fa72951095fef535809cecb9027d57c1";
const EXPECTED_CORE_CODE_HASH = "s7iWoJczoZuewPKuDd4PYALr3Zw5HjDBrD1yVQBUkRE";
const REGISTRY_LIMIT = 2_048;
const BATCH_LIMIT = 64;

function assertCoreArtifact(capture, label) {
  assert.equal(capture.node?.sandbox_version, "2.14.0", `${label} Sandbox version mismatch`);
  assert.equal(capture.node?.protocol_version, 88, `${label} protocol version mismatch`);
  assert.equal(capture.node?.version?.commit, "bc4e9e8cfb03d9e82f027883055624e18576993e",
    `${label} nearcore commit mismatch`);
  assert.equal(capture.wasm_artifacts?.lcp_core_fixture?.wasm_sha256,
    EXPECTED_CORE_WASM_SHA256, `${label} core artifact is not the pinned candidate`);
  assert.equal(capture.wasm_artifacts?.lcp_core_fixture?.near_code_hash,
    EXPECTED_CORE_CODE_HASH, `${label} core code hash is not the pinned candidate`);
}

function assertReserveView(view, label, expected) {
  assert.ok(view && typeof view === "object", `${label} is missing`);
  assert.equal(view.status, expected.status, `${label} status mismatch`);
  assert.equal(view.ready, expected.ready, `${label} readiness mismatch`);
  assert.equal(view.revaluation_active, expected.active, `${label} active flag mismatch`);
  assert.equal(view.record_count, expected.recordCount, `${label} record count mismatch`);
  assert.equal(view.version, 1, `${label} version mismatch`);
  assert.ok(BigInt(view.observed_byte_cost_yocto) > 0n, `${label} observed byte cost must be positive`);
  assert.ok(BigInt(view.shortfall_yocto) >= 0n, `${label} shortfall must be nonnegative`);
  if (expected.cursor === null) {
    assert.equal(view.next_record_index, null, `${label} must not retain a cursor`);
    assert.equal(view.revaluation_target_byte_cost_yocto, null,
      `${label} must not retain a target byte cost`);
  } else {
    assert.equal(view.next_record_index, expected.cursor, `${label} cursor mismatch`);
    assert.equal(view.revaluation_target_byte_cost_yocto, view.observed_byte_cost_yocto,
      `${label} target must equal the observed byte cost`);
  }
}

export function validateStorageRegistryCaptures(capacityCapture, shapeCapture) {
  assert.equal(capacityCapture.fixture_schema, "lcp.storage-registry-sandbox-acceptance.v1");
  assert.equal(shapeCapture.fixture_schema, "lcp.storage-registry-sandbox-acceptance.v1");
  assertCoreArtifact(capacityCapture, "capacity capture");
  assertCoreArtifact(shapeCapture, "shape capture");

  const capacity = capacityCapture.scenarios?.storage_registry_acceptance;
  assert.ok(capacity, "capacity scenario is missing");
  assert.equal(capacity.registry_limit, REGISTRY_LIMIT);
  const initialCount = Number(capacity.initial_record_count);
  assert.equal(initialCount, capacity.initial_reserve_view.record_count);
  assert.equal(capacity.measured_credit_rows_added, REGISTRY_LIMIT - initialCount);
  assert.equal(Number(capacity.final_record_count), REGISTRY_LIMIT);
  assertReserveView(capacity.initial_reserve_view, "initial reserve view", {
    status: "ready", ready: true, active: false, recordCount: initialCount, cursor: null,
  });
  assertReserveView(capacity.reserve_view_at_capacity, "capacity reserve view", {
    status: "ready", ready: true, active: false, recordCount: REGISTRY_LIMIT, cursor: null,
  });
  assert.equal(capacity.overflow_admission_rolled_back, true);
  assert.equal(capacity.overflow_credit_row_absent, true);
  assert.ok(capacity.overflow_transaction_hash, "capacity rejection transaction is missing");

  const stale = capacity.stale_reserve_view;
  assertReserveView(stale, "stale reserve view", {
    status: "stale", ready: false, active: false, recordCount: REGISTRY_LIMIT, cursor: null,
  });
  assert.equal(BigInt(stale.stored_byte_cost_yocto) + 1n,
    BigInt(stale.observed_byte_cost_yocto), "stale view must show the byte-cost difference");
  assertReserveView(capacity.reserve_view_at_revaluation_start, "revaluation-start view", {
    status: "revaluating", ready: false, active: true, recordCount: REGISTRY_LIMIT, cursor: 0,
  });

  assert.equal(capacity.revaluation_batch_limit, BATCH_LIMIT);
  assert.equal(capacity.revaluation_batch_count, REGISTRY_LIMIT / BATCH_LIMIT);
  assert.equal(capacity.revaluation_batches?.length, REGISTRY_LIMIT / BATCH_LIMIT);
  let maximumGas = 0n;
  for (const [batchNumber, batch] of capacity.revaluation_batches.entries()) {
    const start = batchNumber * BATCH_LIMIT;
    const end = start + BATCH_LIMIT;
    const complete = end === REGISTRY_LIMIT;
    assert.equal(batch.start_index, start, `batch ${batchNumber} start mismatch`);
    assert.equal(batch.end_index, end, `batch ${batchNumber} end mismatch`);
    assert.equal(batch.returned_status, complete ? "complete" : "in_progress",
      `batch ${batchNumber} result status mismatch`);
    assert.equal(batch.returned_next_record_index, complete ? null : end,
      `batch ${batchNumber} returned cursor mismatch`);
    assertReserveView(batch.reserve_view, `batch ${batchNumber} reserve view`, {
      status: complete ? "ready" : "revaluating",
      ready: complete,
      active: !complete,
      recordCount: REGISTRY_LIMIT,
      cursor: complete ? null : end,
    });
    maximumGas = BigInt(batch.gas_burnt) > maximumGas ? BigInt(batch.gas_burnt) : maximumGas;
  }
  assert.equal(BigInt(capacity.maximum_revaluation_batch_gas_burnt), maximumGas);
  assert.deepEqual(capacity.reserve_view_after_revaluation, capacity.reserve_view_at_capacity,
    "completed revaluation must restore the exact ready reserve view");
  assert.equal(capacity.repeated_completion_was_idempotent, true);
  assert.ok(capacity.repeated_completion_transaction_hash,
    "idempotent completion transaction is missing");
  assert.equal(capacity.storage_reserve_ready_before_revaluation, true);
  assert.equal(capacity.storage_reserve_blocked_during_revaluation, true);
  assert.equal(capacity.storage_reserve_ready_after_revaluation, true);
  assert.equal(capacity.no_public_network_used, true);

  const shape = shapeCapture.scenarios?.storage_registry_shape_acceptance;
  assert.ok(shape, "maximum-payer shape scenario is missing");
  assert.equal(shape.maximum_payer_id_length, 64);
  assert.equal(shape.maximum_payer_id.length, 64);
  assert.equal(shape.rows_added, 64);
  assert.equal(Number(shape.final_record_count), Number(shape.initial_record_count) + 64);
  assert.equal(shape.measured_credit_storage_bytes, "33728");
  assert.equal(Number(shape.measured_credit_storage_bytes) / shape.rows_added, 527,
    "maximum-length payer storage must remain at the measured 527 bytes per row");
  assert.equal(shape.revaluation_batch_limit, BATCH_LIMIT);
  assert.equal(shape.revaluation_batches.length, 2);
  assert.deepEqual(shape.revaluation_batches.map(({ start_index, end_index }) => [start_index, end_index]),
    [[0, 64], [64, 67]]);
  assert.equal(shape.storage_reserve_ready_before_revaluation, true);
  assert.equal(shape.storage_reserve_blocked_during_revaluation, true);
  assert.equal(shape.storage_reserve_ready_after_revaluation, true);
  assert.equal(shape.no_public_network_used, true);

  return {
    core_wasm_sha256: EXPECTED_CORE_WASM_SHA256,
    registry_limit: REGISTRY_LIMIT,
    revaluation_batches: REGISTRY_LIMIT / BATCH_LIMIT,
    max_payer_bytes_per_row: 527,
  };
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 2,
    "usage: node verify-storage-registry-capture.mjs [<capacity-capture> <shape-capture>]");
  const capacityPath = args.length === 2 ? resolve(repoRoot, args[0]) : defaultCapacityPath;
  const shapePath = args.length === 2 ? resolve(repoRoot, args[1]) : defaultShapePath;
  const [capacityCapture, shapeCapture] = await Promise.all([
    readFile(capacityPath, "utf8").then(JSON.parse),
    readFile(shapePath, "utf8").then(JSON.parse),
  ]);
  const summary = validateStorageRegistryCaptures(capacityCapture, shapeCapture);
  console.log(`PASS full registry and maximum-payer captures: ${JSON.stringify(summary)}`);
  console.log("LIMITATION: validates saved Sandbox evidence; it does not independently rerun Sandbox or verify receipt proofs against block headers.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
