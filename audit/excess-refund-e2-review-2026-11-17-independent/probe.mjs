// Independent probe for the native excess-refund E2 checker remediation (candidate 9027052).
// Reproduces the four F-cases and exclusivity semantics WITHOUT reusing the repo test helpers.
// Read-only against the repository: mutates only in-memory structured clones.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateNativeExcessRefundCapture } from "../../tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs";

const capturePath = new URL("../../tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json", import.meta.url);
const canonical = JSON.parse(await readFile(fileURLToPath(capturePath), "utf8"));
const clone = () => structuredClone(canonical);

function failingLine(err) {
  // extract first frame inside the verifier script
  const line = (err.stack ?? "").split("\n").find((l) => l.includes("verify-native-excess-refund-capture.mjs"));
  return (line ?? "no-verifier-frame").trim();
}

function outcomeFinder(scenario, graph) {
  return (pred) => scenario[`${graph}_receipts_outcome`].find(pred);
}

// Build a receipt that is a real child of a chosen parent, with a contract-originated Transfer action.
function addChildTransfer(scenario, graph, parentOutcome, { receiver, amount }) {
  const receiptId = `probe-${graph}-${receiver}-${Math.random().toString(32).slice(2)}`;
  parentOutcome.receipt_ids.push(receiptId);
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

function runProbe(name, mutate) {
  const changed = clone();
  mutate(changed.scenarios.native_excess_refund_cash_gate, changed);
  try {
    validateNativeExcessRefundCapture(changed);
    return { name, result: "ACCEPTED (unexpected)" };
  } catch (err) {
    return {
      name,
      result: "REJECTED",
      message: err.message,
      at: failingLine(err),
    };
  }
}

const S = (g) => (sc, c) => g;

// Positive control.
let positive;
try {
  validateNativeExcessRefundCapture(canonical);
  positive = "ACCEPTED";
} catch (err) {
  positive = `REJECTED: ${err.message}`;
}

// F4: extra LCP-originated transfer to a third party in the successful withdrawal graph.
const f4 = runProbe("F4 extra third-party transfer in successful withdrawal", (sc, c) => {
  const parent = sc.withdrawal_receipts_outcome.find(({ outcome }) => outcome.receipt_ids?.length);
  assert.ok(parent, "withdrawal graph must have a parent receipt");
  addChildTransfer(sc, "withdrawal", parent.outcome, { receiver: "attacker-probe.sandbox", amount: "1" });
});

// F5: extra LCP-originated transfer to a third party in the failed-refund graph.
const f5 = runProbe("F5 extra third-party transfer in failed-refund graph", (sc, c) => {
  const parent = sc.failure_receipts_outcome.find(({ outcome }) => outcome.receipt_ids?.length);
  assert.ok(parent, "failure graph must have a parent receipt");
  addChildTransfer(sc, "failure", parent.outcome, { receiver: "attacker-probe.sandbox", amount: "1" });
});

// F6: duplicate service_report_refund_sent event in the successful withdrawal graph.
const f6 = runProbe("F6 duplicate settlement event in successful withdrawal", (sc, c) => {
  const source = sc.withdrawal_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
  assert.ok(source, "withdrawal graph must contain a settlement event");
  const log = source.outcome.logs.find((l) => l.includes('"event":"service_report_refund_sent"'));
  const target = sc.withdrawal_receipts_outcome.find(({ id }) => id !== source.id);
  assert.ok(target, "withdrawal graph must contain another receipt outcome");
  target.outcome.logs = [...(target.outcome.logs ?? []), log];
});

// F7: service_report_refund_sent event in the replay graph with NO transfer added.
const f7 = runProbe("F7 settlement event in replay graph without transfer", (sc, c) => {
  const source = sc.withdrawal_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
  const log = source.outcome.logs.find((l) => l.includes('"event":"service_report_refund_sent"'));
  const target = sc.replay_receipts_outcome.find(({ outcome }) =>
    outcome.executor_id === "lcp-core-sandbox.sandbox");
  assert.ok(target, "replay graph must contain an LCP-contract receipt outcome");
  target.outcome.logs = [...(target.outcome.logs ?? []), log];
});

// Exclusivity-across-graph probes (prove the rule is not "filter to expected recipients"):
// E1: a SECOND transfer to the PAYER (the expected recipient) on a separate receipt in the
//     withdrawal graph must still be rejected (exclusivity, not recipient filtering).
const e1 = runProbe("E1 second payer transfer on a separate receipt", (sc, c) => {
  const parent = sc.withdrawal_receipts_outcome.find(({ outcome }) => outcome.receipt_ids?.length);
  addChildTransfer(sc, "withdrawal", parent.outcome, { receiver: sc.payer, amount: sc.amount_yocto });
});

// E2: extra contract transfer in the successful withdrawal graph that ALSO keeps the canonical
//     payer transfer intact (mutated graph has two contract transactions) must be rejected.
const e2 = runProbe("E2 third-party transfer alongside intact payer transfer", (sc, c) => {
  const parent = sc.withdrawal_receipts_outcome.find(({ outcome }) => outcome.receipt_ids?.length);
  addChildTransfer(sc, "withdrawal", parent.outcome, { receiver: "attacker-probe.sandbox", amount: "1" });
});

// E3: a duplicate settlement event placed on the PAYER transfer receipt itself (not an unrelated
//     receipt) must still be rejected: count spans the entire graph.
const e3 = runProbe("E3 duplicate settlement event on the payer transfer receipt", (sc, c) => {
  const source = sc.withdrawal_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
  const log = source.outcome.logs.find((l) => l.includes('"event":"service_report_refund_sent"'));
  const payer = sc.withdrawal_receipts.find((r) => r.predecessor_id === "lcp-core-sandbox.sandbox"
    && r.receiver_id === sc.payer && r.receipt?.Action?.actions?.some((a) => a.Transfer));
  assert.ok(payer, "canonical payer transfer receipt must exist");
  const target = sc.withdrawal_receipts_outcome.find(({ id }) => id === payer.receipt_id);
  assert.ok(target, "payer transfer outcome must exist");
  target.outcome.logs = [...(target.outcome.logs ?? []), log];
});

// E4: a settlement event in the replay graph must ALSO be rejected when it is attached to a
//     non-contract replay receipt (proves the check is graph-wide, not per-receipt).
const e4 = runProbe("E4 settlement event on a non-contract replay receipt", (sc, c) => {
  const source = sc.withdrawal_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
  const log = source.outcome.logs.find((l) => l.includes('"event":"service_report_refund_sent"'));
  const target = sc.replay_receipts_outcome.find(({ outcome }) =>
    outcome.executor_id !== "lcp-core-sandbox.sandbox");
  assert.ok(target, "replay graph must contain a non-contract receipt outcome");
  target.outcome.logs = [...(target.outcome.logs ?? []), log];
});

for (const row of [positive, f4, f5, f6, f7, e1, e2, e3, e4]) {
  if (typeof row === "string") {
    console.log(`POSITIVE CONTROL: ${row}`);
  } else {
    console.log(`${row.result}  ${row.name}`);
    if (row.result === "REJECTED") {
      console.log(`    message: ${row.message}`);
      console.log(`    at:      ${row.at}`);
    }
  }
}