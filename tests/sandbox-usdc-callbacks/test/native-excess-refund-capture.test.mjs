import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateNativeExcessRefundCapture } from "../verify-native-excess-refund-capture.mjs";

const here = new URL("../native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json", import.meta.url);
const canonical = JSON.parse(await readFile(fileURLToPath(here), "utf8"));
const clone = () => structuredClone(canonical);

test("accepts the complete native excess-refund capture", () => {
  assert.doesNotThrow(() => validateNativeExcessRefundCapture(canonical));
});

test("rejects an unpinned core artifact digest", () => {
  const changed = clone();
  changed.wasm_artifacts.lcp_core_fixture.wasm_sha256 = "00".repeat(32);
  assert.throws(() => validateNativeExcessRefundCapture(changed), /pinned NEP-330 reproducible core WASM/);
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

test("rejects a disconnected matched receipt outcome and body", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const receiptId = "disconnected-matched-receipt";
  scenario.withdrawal_receipts_outcome.push({
    id: receiptId,
    outcome: { executor_id: scenario.payer, status: { SuccessValue: "" }, receipt_ids: [], logs: [] },
  });
  scenario.withdrawal_receipts.push({
    receipt_id: receiptId,
    predecessor_id: "lcp-core-sandbox.sandbox",
    receiver_id: scenario.payer,
    receipt: { Action: { actions: [] } },
  });
  assert.throws(() => validateNativeExcessRefundCapture(changed), /disconnected receipt outcomes or bodies/);
});

test("rejects a payout action whose receipt outcome failed", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const payout = scenario.withdrawal_receipts.find((receipt) => receipt.predecessor_id === "lcp-core-sandbox.sandbox"
    && receipt.receiver_id === scenario.payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(payout, "capture must contain the payer transfer body");
  const outcome = scenario.withdrawal_receipts_outcome.find(({ id }) => id === payout.receipt_id);
  assert.ok(outcome, "payer transfer must have a matching execution outcome");
  outcome.outcome.status = { Failure: { ActionError: {} } };
  assert.throws(() => validateNativeExcessRefundCapture(changed), /must not fail/);
});

test("rejects a payout receipt that only returns a child receipt ID", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const payout = scenario.withdrawal_receipts.find((receipt) => receipt.predecessor_id === "lcp-core-sandbox.sandbox"
    && receipt.receiver_id === scenario.payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(payout, "capture must contain the payer transfer body");
  const outcome = scenario.withdrawal_receipts_outcome.find(({ id }) => id === payout.receipt_id);
  assert.ok(outcome, "payer transfer must have a matching execution outcome");
  outcome.outcome.status = { SuccessReceiptId: "unrelated-child" };
  assert.throws(() => validateNativeExcessRefundCapture(changed), /direct successful transfer result/);
});

test("rejects a withdrawal receipt without an execution status", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const outcome = scenario.withdrawal_receipts_outcome[0];
  outcome.outcome.status = {};
  assert.throws(() => validateNativeExcessRefundCapture(changed), /exactly one execution status/);
});

test("rejects a failed non-payout receipt in an otherwise successful withdrawal", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const payout = scenario.withdrawal_receipts.find((receipt) => receipt.predecessor_id === "lcp-core-sandbox.sandbox"
    && receipt.receiver_id === scenario.payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(payout, "capture must contain the payer transfer body");
  const outcome = scenario.withdrawal_receipts_outcome.find(({ id }) => id !== payout.receipt_id);
  assert.ok(outcome, "capture must contain a separate withdrawal receipt");
  outcome.outcome.status = { Failure: { ActionError: {} } };
  assert.throws(() => validateNativeExcessRefundCapture(changed), /successful withdrawal receipt .* must not fail/);
});

function appendContractTransfer(changed, graph, { receiver, amount }) {
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const parent = scenario[`${graph}_receipts_outcome`]
    .find(({ outcome }) => outcome.receipt_ids?.length);
  assert.ok(parent, `${graph} graph must have a receipt that can reference a child`);
  const receiptId = `synthetic-${graph}-transfer-${receiver}`;
  parent.outcome.receipt_ids.push(receiptId);
  scenario[`${graph}_receipts_outcome`].push({
    id: receiptId,
    outcome: { executor_id: receiver, status: { SuccessValue: "" }, receipt_ids: [], logs: [] },
  });
  scenario[`${graph}_receipts`].push({
    receipt_id: receiptId,
    predecessor_id: "lcp-core-sandbox.sandbox",
    receiver_id: receiver,
    receipt: { Action: { actions: [{ Transfer: { deposit: amount } }] } },
  });
}

test("rejects a replay transfer to a recipient other than the payer", () => {
  const changed = clone();
  const { amount_yocto: amount } = changed.scenarios.native_excess_refund_cash_gate;
  appendContractTransfer(changed, "replay", { receiver: "unrelated-account.sandbox", amount });
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /contract-originated transfer to any recipient/);
});

test("rejects an underfunded withdrawal transfer to a recipient other than the payer", () => {
  const changed = clone();
  const { amount_yocto: amount } = changed.scenarios.native_excess_refund_cash_gate;
  appendContractTransfer(changed, "underfunded_withdrawal",
    { receiver: "unrelated-account.sandbox", amount });
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /contract-originated transfer to any recipient/);
});

test("rejects a payout receipt body that does not bind to its outcome executor", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const payout = scenario.withdrawal_receipts.find((receipt) => receipt.predecessor_id === "lcp-core-sandbox.sandbox"
    && receipt.receiver_id === scenario.payer
    && receipt.receipt?.Action?.actions?.some((action) => action.Transfer));
  assert.ok(payout, "capture must contain the payer transfer body");
  const outcome = scenario.withdrawal_receipts_outcome.find(({ id }) => id === payout.receipt_id);
  assert.ok(outcome, "payer transfer must have a matching execution outcome");
  outcome.outcome.executor_id = "unrelated-account.sandbox";
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /body receiver must bind to its outcome executor/);
});

test("rejects a failed excess-refund callback receipt status", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const callback = scenario.failure_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"excess_storage_refund_failed"')));
  assert.ok(callback, "capture must contain the failed refund callback receipt");
  callback.outcome.status = { Failure: { ActionError: {} } };
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /must itself succeed/);
});

test("rejects any contract payout during replay, including one yocto", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const parent = scenario.replay_receipts_outcome.find(({ outcome }) => outcome.receipt_ids?.length);
  assert.ok(parent, "replay graph must have a receipt that can reference a child");
  const receiptId = "one-yocto-replay-payout";
  parent.outcome.receipt_ids.push(receiptId);
  scenario.replay_receipts_outcome.push({
    id: receiptId,
    outcome: { executor_id: scenario.payer, status: { SuccessValue: "" }, receipt_ids: [], logs: [] },
  });
  scenario.replay_receipts.push({
    receipt_id: receiptId,
    predecessor_id: "lcp-core-sandbox.sandbox",
    receiver_id: scenario.payer,
    receipt: { Action: { actions: [{ Transfer: { deposit: "1" } }] } },
  });
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /contract-originated transfer to any recipient/);
});

test("rejects an extra contract transfer to a third party during successful withdrawal", () => {
  const changed = clone();
  appendContractTransfer(changed, "withdrawal", {
    receiver: "unrelated-account.sandbox",
    amount: "1",
  });
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /exactly one payer transfer and no other contract-originated transfers/);
});

test("rejects an extra contract transfer during failed excess-refund settlement", () => {
  const changed = clone();
  appendContractTransfer(changed, "failure", {
    receiver: "unrelated-account.sandbox",
    amount: "1",
  });
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /exactly one contract-originated transfer to the forced missing account/);
});

test("rejects duplicate settlement events in a successful withdrawal graph", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const source = scenario.withdrawal_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
  assert.ok(source, "capture must contain the successful settlement event");
  const settlementLog = source.outcome.logs.find((log) =>
    log.includes('"event":"service_report_refund_sent"'));
  const target = scenario.withdrawal_receipts_outcome.find(({ id }) => id !== source.id);
  assert.ok(target, "capture must contain another withdrawal receipt outcome");
  target.outcome.logs = [...(target.outcome.logs ?? []), settlementLog];
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /exactly one settlement event/);
});

test("rejects a settlement event in the replay graph even without a transfer", () => {
  const changed = clone();
  const scenario = changed.scenarios.native_excess_refund_cash_gate;
  const source = scenario.withdrawal_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
  assert.ok(source, "capture must contain the successful settlement event");
  const settlementLog = source.outcome.logs.find((log) =>
    log.includes('"event":"service_report_refund_sent"'));
  const target = scenario.replay_receipts_outcome.find(({ outcome }) =>
    outcome.executor_id === "lcp-core-sandbox.sandbox");
  assert.ok(target, "replay graph must contain a contract receipt outcome");
  target.outcome.logs = [...(target.outcome.logs ?? []), settlementLog];
  assert.throws(() => validateNativeExcessRefundCapture(changed),
    /must not emit a second settlement event/);
});
