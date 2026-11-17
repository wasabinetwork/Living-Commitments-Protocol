// Runs the F4-F7 mutations against the BASE verifier (extracted to scratch) to prove
// the four gaps were genuinely open before the remediation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateNativeExcessRefundCapture as validateBase } from "./scratch/verify-base.mjs";

const capturePath = new URL("../../tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json", import.meta.url);
const canonical = JSON.parse(await readFile(fileURLToPath(capturePath), "utf8"));
const clone = () => structuredClone(canonical);

function addChildTransfer(scenario, graph, receiver, amount) {
  const parent = scenario[`${graph}_receipts_outcome`].find(({ outcome }) => outcome.receipt_ids?.length);
  assert.ok(parent, "need a parent");
  const receiptId = `baseprobe-${graph}-${receiver}`;
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

function attempt(label, mutate) {
  const changed = clone();
  const sc = changed.scenarios.native_excess_refund_cash_gate;
  mutate(sc);
  try {
    validateBase(changed);
    return `${label}: ACCEPTED by base checker (gap open)`;
  } catch (err) {
    return `${label}: REJECTED by base checker -> ${err.message.split("\n")[0]}`;
  }
}

const results = [
  attempt("F4 extra third-party transfer in withdrawal graph", (sc) =>
    addChildTransfer(sc, "withdrawal", "attacker.sandbox", "1")),
  attempt("F5 extra third-party transfer in failed-refund graph", (sc) =>
    addChildTransfer(sc, "failure", "attacker.sandbox", "1")),
  attempt("F6 duplicate settlement event in successful withdrawal", (sc) => {
    const source = sc.withdrawal_receipts_outcome.find(({ outcome }) =>
      (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
    const log = source.outcome.logs.find((l) => l.includes('"event":"service_report_refund_sent"'));
    const target = sc.withdrawal_receipts_outcome.find(({ id }) => id !== source.id);
    target.outcome.logs = [...(target.outcome.logs ?? []), log];
  }),
  attempt("F7 settlement event in replay graph without transfer", (sc) => {
    const source = sc.withdrawal_receipts_outcome.find(({ outcome }) =>
      (outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
    const log = source.outcome.logs.find((l) => l.includes('"event":"service_report_refund_sent"'));
    const target = sc.replay_receipts_outcome.find(({ outcome }) =>
      outcome.executor_id === "lcp-core-sandbox.sandbox");
    target.outcome.logs = [...(target.outcome.logs ?? []), log];
  }),
];
for (const r of results) console.log(r);