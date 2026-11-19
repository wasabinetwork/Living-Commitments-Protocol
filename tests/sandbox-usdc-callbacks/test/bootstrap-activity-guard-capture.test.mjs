import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  compareBootstrapActivityGuardFreshCapture,
  validateBootstrapActivityGuardCapture,
} from "../verify-bootstrap-activity-guard-capture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const capture = JSON.parse(await readFile(resolve(
  here,
  "../recovery-acceptance-2026-11-17-689fbf1/bootstrap-guard.json",
), "utf8"));

test("accepts the complete bootstrap-after-commitment Sandbox capture", () => {
  validateBootstrapActivityGuardCapture(capture);
});

test("rejects a core artifact hash that is not the pinned reproducible candidate", () => {
  const changed = structuredClone(capture);
  changed.wasm_artifacts.lcp_core_fixture.wasm_sha256 = "00".repeat(32);
  assert.throws(() => validateBootstrapActivityGuardCapture(changed), /reproducible recovery core artifact/);
});

test("rejects a core code hash that differs from the deployed guard instance", () => {
  const changed = structuredClone(capture);
  changed.scenarios.bootstrap_after_commitment_activity.deployed_code_hash = "1".repeat(44);
  assert.throws(() => validateBootstrapActivityGuardCapture(changed));
});

test("rejects a successful bootstrap outcome", () => {
  const changed = structuredClone(capture);
  changed.scenarios.bootstrap_after_commitment_activity.configuration_after_rejected_bootstrap = {};
  assert.throws(() => validateBootstrapActivityGuardCapture(changed), /leave recovery unconfigured/);
});

test("rejects a bootstrap call that attaches a deposit", () => {
  const changed = structuredClone(capture);
  const tx = changed.scenarios.bootstrap_after_commitment_activity.rejected_bootstrap_transaction;
  const action = tx.transaction.actions.find(({ FunctionCall }) =>
    FunctionCall?.method_name === "bootstrap_receipt_recovery");
  action.FunctionCall.deposit = "1";
  assert.throws(() => validateBootstrapActivityGuardCapture(changed), /must not attach funds/);
});

test("rejects incomplete raw receipt closure", () => {
  const changed = structuredClone(capture);
  const tx = changed.scenarios.bootstrap_after_commitment_activity.commitment_transaction;
  tx.receipts.pop();
  assert.throws(() => validateBootstrapActivityGuardCapture(changed), /missing raw receipt bodies/);
});

test("rejects if the pre-existing commitment is missing after bootstrap rejection", () => {
  const changed = structuredClone(capture);
  changed.scenarios.bootstrap_after_commitment_activity.commitment_after_rejected_bootstrap = null;
  assert.throws(() => validateBootstrapActivityGuardCapture(changed), /preserve the commitment/);
});

test("accepts a fresh capture that differs only in chain identity", () => {
  const fresh = structuredClone(capture);
  fresh.captured_at = "2026-11-20T00:00:00.000Z";
  fresh.node.chain_id = "test-chain-QQQQQ";
  fresh.node.genesis_hash = "G".repeat(44);
  const { compared, skipped } = compareBootstrapActivityGuardFreshCapture(fresh, capture);
  assert.ok(compared > 200 && skipped > 0);
});

test("rejects a fresh capture that adds a scenario", () => {
  const fresh = structuredClone(capture);
  fresh.scenarios.unexpected_scenario = {};
  assert.throws(() => compareBootstrapActivityGuardFreshCapture(fresh, capture),
    /scenarios records different fields/);
});
