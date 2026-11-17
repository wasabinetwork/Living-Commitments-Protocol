import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateNativeExcessRefundCapture } from "../verify-native-excess-refund-capture.mjs";

const here = new URL("../native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17.json", import.meta.url);
const canonical = JSON.parse(await readFile(fileURLToPath(here), "utf8"));
const clone = () => structuredClone(canonical);

test("accepts the complete native excess-refund capture", () => {
  assert.doesNotThrow(() => validateNativeExcessRefundCapture(canonical));
});

test("rejects an unpinned core artifact digest", () => {
  const changed = clone();
  changed.wasm_artifacts.lcp_core_fixture.wasm_sha256 = "00".repeat(32);
  assert.throws(() => validateNativeExcessRefundCapture(changed), /independently reproduced core WASM/);
});

test("rejects a missing refund-failure callback event", () => {
  const changed = clone();
  for (const row of changed.scenarios.native_excess_refund_cash_gate.failure_receipts_outcome) {
    row.outcome.logs = (row.outcome.logs ?? []).filter((log) =>
      !log.includes('"event":"excess_storage_refund_failed"'));
  }
  assert.throws(() => validateNativeExcessRefundCapture(changed), /callback failure event/);
});

test("rejects a duplicate successful payout action", () => {
  const changed = clone();
  const { withdrawal_receipts, payer } = changed.scenarios.native_excess_refund_cash_gate;
  const body = withdrawal_receipts.find((receipt) => receipt.receiver_id === payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(body, "capture must contain the payer transfer body");
  const actions = body.receipt.Action.actions;
  actions.push(structuredClone(actions.find((action) => action.Transfer)));
  assert.throws(() => validateNativeExcessRefundCapture(changed), /exactly one payer transfer/);
});

test("rejects a missing successful payout action", () => {
  const changed = clone();
  const { withdrawal_receipts, payer } = changed.scenarios.native_excess_refund_cash_gate;
  const body = withdrawal_receipts.find((receipt) => receipt.receiver_id === payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(body, "capture must contain the payer transfer body");
  body.receipt.Action.actions = body.receipt.Action.actions.filter((action) => !action.Transfer);
  assert.throws(() => validateNativeExcessRefundCapture(changed), /exactly one payer transfer/);
});

test("rejects an altered payout amount", () => {
  const changed = clone();
  const { withdrawal_receipts, payer } = changed.scenarios.native_excess_refund_cash_gate;
  const body = withdrawal_receipts.find((receipt) => receipt.receiver_id === payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(body, "capture must contain the payer transfer body");
  const action = body.receipt.Action.actions.find((candidate) => candidate.Transfer);
  action.Transfer.deposit = "1";
  assert.throws(() => validateNativeExcessRefundCapture(changed), /exactly one payer transfer/);
});

test("rejects an incomplete child receipt graph", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const parent = scenario.withdrawal_receipts_outcome.find(({ outcome }) => outcome.receipt_ids?.length);
  assert.ok(parent, "capture must contain a receipt with a child");
  const childId = parent.outcome.receipt_ids[0];
  scenario.withdrawal_receipts_outcome = scenario.withdrawal_receipts_outcome
    .filter(({ id }) => id !== childId);
  scenario.withdrawal_receipts = scenario.withdrawal_receipts
    .filter(({ receipt_id }) => receipt_id !== childId);
  assert.throws(() => validateNativeExcessRefundCapture(changed), /every referenced child outcome/);
});
