// Owner-side reconstruction of the three unverified mutation leads recorded in
// additional-mutations.log, plus one additional case in the same defect class.
//
// This is NOT an independent review. It reproduces each lead against the
// exported validator of the committed verifier and records, for each mutation,
// whether the committed verifier accepts it (a genuine checker gap) and whether
// a minimal proposed strengthening rejects it.
//
// Usage:
//   node audit/p2-native-excess-refund-e2-independent-2026-11-17/mutation-repro.mjs [capture.json]
//
// Read-only with respect to the repository: the capture is mutated in memory
// and the committed capture, manifest, and verifier are never written.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const verifierPath = resolve(repoRoot, "tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs");
const defaultCapturePath = resolve(repoRoot,
  "tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json");

const LCP = "lcp-core-sandbox.sandbox";
const ATTACKER = "attacker-account.sandbox";
const FORCED_MISSING = "missing-excess-refund.sandbox";

const verifierBytes = await readFile(verifierPath);
const { validateNativeExcessRefundCapture } = await import(verifierPath);

const capturePath = resolve(process.argv[2] ?? defaultCapturePath);
const pristine = JSON.parse(await readFile(capturePath, "utf8"));

function scenarioOf(capture) {
  return capture.scenarios.native_excess_refund_cash_gate;
}

function transfersOf(bodies) {
  return bodies.flatMap((body) => {
    const actions = body.receipt?.Action?.actions ?? [];
    return actions.flatMap((action) => {
      const transfer = action.Transfer;
      if (!transfer) return [];
      return [{
        receipt_id: body.receipt_id,
        predecessor_id: body.predecessor_id,
        receiver_id: body.receiver_id,
        amount_yocto: String(transfer.deposit ?? transfer.amount),
      }];
    });
  });
}

// Clone the capture, append a well-formed LCP-originated transfer receipt to the
// given graph, and keep root reachability and body/outcome sets consistent so
// only the intended semantic check can reject the result.
function injectContractTransfer(capture, graph, { receiver, amount }) {
  const s = scenarioOf(capture);
  const roots = s[`${graph}_transaction_outcome`].outcome.receipt_ids;
  const outcomes = s[`${graph}_receipts_outcome`];
  const bodies = s[`${graph}_receipts`];
  const receiptId = `Synthetic${graph}Transfer${receiver.replace(/[^a-zA-Z0-9]/g, "")}1111`;
  bodies.push({
    receipt_id: receiptId,
    predecessor_id: LCP,
    receiver_id: receiver,
    receipt: { Action: { actions: [{ Transfer: { deposit: String(amount) } }] } },
  });
  outcomes.push({
    id: receiptId,
    outcome: {
      executor_id: receiver,
      gas_burnt: 223182562500,
      logs: [],
      metadata: { contracts: [null], gas_profile: [], version: 4 },
      receipt_ids: [],
      status: { SuccessValue: "" },
      tokens_burnt: "0",
    },
  });
  const rootRow = outcomes.find(({ id }) => id === roots[0]);
  rootRow.outcome.receipt_ids = [...rootRow.outcome.receipt_ids, receiptId];
}

const mutations = [
  {
    name: "replay-other-recipient",
    note: "LCP-originated replay transfer to an account other than the payer",
    apply(capture) {
      const amount = scenarioOf(capture).amount_yocto;
      injectContractTransfer(capture, "replay", { receiver: ATTACKER, amount });
    },
  },
  {
    name: "payout-executor-mismatch",
    note: "payout receipt body and execution outcome disagree about the executor identity",
    apply(capture) {
      const s = scenarioOf(capture);
      const payout = s.withdrawal_receipts.find(
        ({ predecessor_id, receiver_id }) => predecessor_id === LCP && receiver_id === s.payer,
      );
      const row = s.withdrawal_receipts_outcome.find(({ id }) => id === payout.receipt_id);
      row.outcome.executor_id = ATTACKER;
    },
  },
  {
    name: "failure-callback-failed",
    note: "the failed-refund callback receipt itself has a failed execution status",
    apply(capture) {
      const s = scenarioOf(capture);
      const callback = s.failure_receipts_outcome.find(({ outcome }) =>
        (outcome.logs ?? []).some((log) => log.includes('"event":"excess_storage_refund_failed"')));
      callback.outcome.status = {
        Failure: {
          ActionError: {
            index: 0,
            kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: synthetic" } },
          },
        },
      };
    },
  },
  {
    name: "underfunded-other-recipient",
    note: "additional case in the same class: underfunded withdrawal pays an unrelated account",
    apply(capture) {
      const amount = scenarioOf(capture).amount_yocto;
      injectContractTransfer(capture, "underfunded_withdrawal", { receiver: ATTACKER, amount });
    },
  },
];

// Minimal proposed strengthening, covering the specific gaps only.
function strengthenedViolations(capture) {
  const s = scenarioOf(capture);
  const violations = [];

  // (1) Replay exclusion and (2) underfunded cash gate must forbid a contract
  // transfer to any receiver, not only to the payer.
  for (const [label, graph] of [["replay", "replay"], ["underfunded withdrawal", "underfunded_withdrawal"]]) {
    for (const transfer of transfersOf(s[`${graph}_receipts`])) {
      if (transfer.predecessor_id === LCP) {
        violations.push(`${label}: contract-originated transfer ${transfer.receipt_id} to non-payer `
          + `${transfer.receiver_id} of ${transfer.amount_yocto} yocto`);
      }
    }
  }

  // (3) Every captured receipt body must bind to its outcome's executor.
  for (const graph of ["failure", "underfunded_withdrawal", "withdrawal", "replay"]) {
    const outcomes = new Map(s[`${graph}_receipts_outcome`].map((row) => [row.id, row]));
    for (const body of s[`${graph}_receipts`]) {
      const row = outcomes.get(body.receipt_id);
      if (body.receiver_id !== row?.outcome?.executor_id) {
        violations.push(`${graph}: receipt ${body.receipt_id} body receiver ${body.receiver_id} `
          + `does not bind to outcome executor ${row?.outcome?.executor_id}`);
      }
    }
  }

  // (4) The failed-refund callback must itself have succeeded.
  const callback = s.failure_receipts_outcome.find(({ outcome }) =>
    (outcome.logs ?? []).some((log) => log.includes('"event":"excess_storage_refund_failed"')));
  if (Object.keys(callback?.outcome?.status ?? {})[0] !== "SuccessValue") {
    violations.push("failed refund: excess_storage_refund_failed callback receipt did not succeed");
  }

  // (5) The forced missing-account transfer body must bind to its failed outcome.
  const failedTransfer = s.failure_receipts.find(({ receiver_id }) => receiver_id === FORCED_MISSING);
  const failedTransferRow = s.failure_receipts_outcome.find(({ id }) => id === failedTransfer?.receipt_id);
  if (failedTransferRow?.outcome?.executor_id !== FORCED_MISSING) {
    violations.push("failed refund: forced transfer body does not bind to its failure executor");
  }

  return violations;
}

function verdictOf(capture) {
  try {
    validateNativeExcessRefundCapture(capture);
    return { accepted: true };
  } catch (error) {
    return { accepted: false, reason: error.message.split("\n")[0] };
  }
}

const baseline = verdictOf(structuredClone(pristine));
const baselineViolations = strengthenedViolations(structuredClone(pristine));

const rows = [];
for (const mutation of mutations) {
  const mutated = structuredClone(pristine);
  mutation.apply(mutated);
  const verdict = verdictOf(mutated);
  const violations = strengthenedViolations(mutated);
  rows.push({
    mutation: mutation.name,
    note: mutation.note,
    committed_verifier: verdict.accepted ? "ACCEPTED" : "REJECTED",
    committed_verifier_reason: verdict.reason ?? null,
    strengthened_check: violations.length === 0 ? "ACCEPTED" : "REJECTED",
    strengthened_reasons: violations,
    classification: verdict.accepted
      ? "genuine checker gap"
      : "mutation already rejected by committed verifier",
  });
}

const report = {
  generated_at: new Date().toISOString(),
  role: "owner-side reconstruction, not an independent review",
  capture: {
    path: capturePath.slice(repoRoot.length + 1),
    sha256: createHash("sha256").update(await readFile(capturePath)).digest("hex"),
  },
  verifier: {
    path: verifierPath.slice(repoRoot.length + 1),
    sha256: createHash("sha256").update(verifierBytes).digest("hex"),
  },
  baseline: {
    committed_verifier: baseline.accepted ? "ACCEPTED" : "REJECTED",
    strengthened_check: baselineViolations.length === 0 ? "ACCEPTED" : "REJECTED",
    strengthened_reasons: baselineViolations,
  },
  mutations: rows,
};

console.log(JSON.stringify(report, null, 2));
if (!baseline.accepted || baselineViolations.length !== 0) process.exitCode = 1;
