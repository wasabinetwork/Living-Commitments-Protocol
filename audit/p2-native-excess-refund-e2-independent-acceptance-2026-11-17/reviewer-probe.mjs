// Independent reviewer probe for the E2 native excess-refund evidence.
//
// Written from the raw capture data without importing the owner's assertion
// helpers: all graph, accounting, and event rules are re-derived here, and the
// committed verifier is imported only to compare verdicts on synthetic mutants.

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const repoRoot = process.argv[2] ?? process.cwd();
const capturePath = resolve(repoRoot,
  "tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json");
const manifestPath = capturePath.replace(/\.json$/, ".sha256");
const committedVerifierPath = resolve(repoRoot,
  "tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs");

const LCP = "lcp-core-sandbox.sandbox";
const AMOUNT = 10n ** 22n;
const STORAGE_GROWTH = 260_000_000_000_000_000_000n;

const captureBytes = await readFile(capturePath);
const capture = JSON.parse(captureBytes.toString("utf8"));
const scenario = capture.scenarios.native_excess_refund_cash_gate;
const { validateNativeExcessRefundCapture } = await import(committedVerifierPath);

const findings = [];
const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, result: "PASS" });
  } catch (error) {
    checks.push({ name, result: "FAIL", detail: error.message });
    findings.push({ kind: "capture-claim", name, detail: error.message });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

// ---- base58 and code hash, reimplemented ----
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  let zeros = 0;
  while (bytes[zeros] === 0) zeros += 1;
  return "1".repeat(zeros) + out;
}

// ---- manifest ----
const manifestRows = (await readFile(manifestPath, "utf8")).trim().split(/\r?\n/);
const manifest = new Map();
for (const row of manifestRows) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
  assert(match, `malformed manifest row: ${row}`);
  manifest.set(match[2], match[1]);
}

const manifestResults = [];
for (const [path, expected] of manifest) {
  const bytes = await readFile(resolve(repoRoot, path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  manifestResults.push({ path, ok: actual === expected });
}
check("manifest pins the selected capture", () => {
  assert(manifest.has("tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json"),
    "capture is not pinned by its manifest");
});
check("manifest rows all verify", () => {
  const bad = manifestResults.filter((row) => !row.ok);
  assert(bad.length === 0, `${bad.length} stale rows: ${bad.map((row) => row.path).join(", ")}`);
});

// ---- artifact ----
check("wasm digest is the pinned candidate", () => {
  assertEqual(capture.wasm_artifacts.lcp_core_fixture.wasm_sha256,
    "4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad", "wasm sha256");
});
check("code hash is base58(sha256(wasm)) of the pinned candidate", () => {
  const digest = Buffer.from(capture.wasm_artifacts.lcp_core_fixture.wasm_sha256, "hex");
  assertEqual(digest.length, 32, "digest length");
  assertEqual(base58(digest), "6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212", "code hash");
  assertEqual(capture.wasm_artifacts.lcp_core_fixture.near_code_hash,
    "6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212", "recorded code hash");
});

// ---- independent graph analysis ----
const TERMINAL = new Set(["SuccessValue", "SuccessReceiptId", "Failure"]);
const graphs = {
  failure: { status: "failure_final_execution_status", tx: "failure_transaction_outcome",
    outcomes: "failure_receipts_outcome", bodies: "failure_receipts", hash: "failure_transaction_hash" },
  underfunded: { status: "underfunded_withdrawal_final_execution_status", tx: "underfunded_withdrawal_transaction_outcome",
    outcomes: "underfunded_withdrawal_receipts_outcome", bodies: "underfunded_withdrawal_receipts",
    hash: "underfunded_withdrawal_transaction_hash" },
  withdrawal: { status: "withdrawal_final_execution_status", tx: "withdrawal_transaction_outcome",
    outcomes: "withdrawal_receipts_outcome", bodies: "withdrawal_receipts", hash: "withdrawal_transaction_hash" },
  replay: { status: "replay_final_execution_status", tx: "replay_transaction_outcome",
    outcomes: "replay_receipts_outcome", bodies: "replay_receipts", hash: "replay_transaction_hash" },
};

const analysis = {};
for (const [name, spec] of Object.entries(graphs)) {
  const outcomes = scenario[spec.outcomes];
  const bodies = scenario[spec.bodies];
  const tx = scenario[spec.tx].outcome;
  const outcomeById = new Map();
  const duplicateOutcomes = [];
  for (const row of outcomes) {
    if (outcomeById.has(row.id)) duplicateOutcomes.push(row.id);
    outcomeById.set(row.id, row);
  }
  const bodyById = new Map();
  const duplicateBodies = [];
  for (const body of bodies) {
    if (bodyById.has(body.receipt_id)) duplicateBodies.push(body.receipt_id);
    bodyById.set(body.receipt_id, body);
  }
  const reachable = new Set();
  const stack = [...tx.receipt_ids];
  while (stack.length > 0) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    const row = outcomeById.get(id);
    if (!row) { reachable.add(`MISSING:${id}`); continue; }
    reachable.add(id);
    stack.push(...(row.outcome.receipt_ids ?? []));
  }
  const transfers = bodies.flatMap((body) => (body.receipt?.Action?.actions ?? [])
    .filter((action) => action.Transfer)
    .map((action) => ({
      receipt_id: body.receipt_id,
      predecessor_id: body.predecessor_id,
      receiver_id: body.receiver_id,
      amount_yocto: String(action.Transfer.deposit ?? action.Transfer.amount),
    })));
  const events = [];
  for (const row of outcomes) {
    for (const log of row.outcome.logs ?? []) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        events.push({ receipt_id: row.id, executor_id: row.outcome.executor_id,
          status: Object.keys(row.outcome.status ?? {})[0],
          event: JSON.parse(log.slice("EVENT_JSON:".length)) });
      } catch { /* ignore unparseable */ }
    }
  }
  analysis[name] = {
    finalStatus: scenario[spec.status],
    txStatus: Object.keys(scenario[spec.tx].outcome.status ?? {})[0],
    txHashMatches: scenario[spec.tx].id === scenario[spec.hash],
    roots: tx.receipt_ids,
    duplicateOutcomes, duplicateBodies,
    outcomeCount: outcomes.length, bodyCount: bodies.length,
    missingOutcomes: [...reachable].filter((id) => id.startsWith("MISSING:")),
    unreachableOutcomes: [...outcomeById.keys()].filter((id) => !reachable.has(id)),
    unresolvedBodies: bodies.filter((body) => !outcomeById.has(body.receipt_id)).map((body) => body.receipt_id),
    missingBodies: outcomes.filter((row) => !bodyById.has(row.id)).map((row) => row.id),
    nonTerminal: outcomes.filter((row) => {
      const keys = Object.keys(row.outcome.status ?? {});
      return keys.length !== 1 || !TERMINAL.has(keys[0]);
    }).map((row) => row.id),
    identityMismatches: bodies.filter((body) => body.receiver_id !== outcomeById.get(body.receipt_id)?.outcome?.executor_id)
      .map((body) => ({ receipt_id: body.receipt_id, body_receiver: body.receiver_id,
        outcome_executor: outcomeById.get(body.receipt_id)?.outcome?.executor_id })),
    transfers,
    contractTransfers: transfers.filter((transfer) => transfer.predecessor_id === LCP),
    events: events.map(({ receipt_id, executor_id, status, event }) => ({ receipt_id, executor_id, status, event: event.event })),
  };
}

for (const [name, info] of Object.entries(analysis)) {
  check(`${name}: receipt graph is closed, unique, and terminal`, () => {
    assertEqual(info.duplicateOutcomes.length, 0, `${name} duplicate outcome ids`);
    assertEqual(info.duplicateBodies.length, 0, `${name} duplicate body ids`);
    assertEqual(info.missingOutcomes.length, 0, `${name} unresolved child outcomes`);
    assertEqual(info.unreachableOutcomes.length, 0, `${name} unreachable outcomes`);
    assertEqual(info.unresolvedBodies.length, 0, `${name} bodies without outcomes`);
    assertEqual(info.missingBodies.length, 0, `${name} outcomes without bodies`);
    assertEqual(info.nonTerminal.length, 0, `${name} non-terminal statuses`);
    assert(info.finalStatus === "FINAL", `${name} must be FINAL, got ${info.finalStatus}`);
    assert(info.txHashMatches, `${name} transaction id must match the captured hash`);
  });
  check(`${name}: body receiver binds to outcome executor`, () => {
    assertEqual(info.identityMismatches.length, 0,
      `${name} identity mismatches: ${JSON.stringify(info.identityMismatches)}`);
  });
}

// ---- failed excess refund ----
const failure = analysis.failure;
check("failed refund attempts exactly one contract transfer", () => {
  assertEqual(failure.contractTransfers.length, 1, "contract transfer count");
  const [transfer] = failure.contractTransfers;
  assertEqual(transfer.receiver_id, "missing-excess-refund.sandbox", "forced recipient");
  assertEqual(transfer.amount_yocto, AMOUNT.toString(), "forced amount");
});
check("failed refund transfer outcome is a missing-account failure", () => {
  const row = scenario.failure_receipts_outcome.find(({ outcome }) =>
    outcome.executor_id === "missing-excess-refund.sandbox");
  assert(row, "forced transfer outcome must exist");
  assertEqual(Object.keys(row.outcome.status)[0], "Failure", "forced transfer status");
  assertEqual(row.outcome.status.Failure?.ActionError?.kind?.AccountDoesNotExist?.account_id,
    "missing-excess-refund.sandbox", "failure kind");
});
check("failed refund callback succeeded and recorded the payer credit", () => {
  const callback = scenario.failure_receipts_outcome.find((row) =>
    (row.outcome.logs ?? []).some((log) => log.includes('"event":"excess_storage_refund_failed"')));
  assert(callback, "callback receipt must exist");
  assertEqual(callback.outcome.executor_id, LCP, "callback executor");
  assertEqual(Object.keys(callback.outcome.status)[0], "SuccessValue", "callback status");
  const event = callback.outcome.logs.map((log) => log.startsWith("EVENT_JSON:")
    ? JSON.parse(log.slice("EVENT_JSON:".length)) : null).find((parsed) => parsed?.event === "excess_storage_refund_failed");
  assertEqual(event.data[0].account_id, scenario.payer, "credited account");
  assertEqual(String(event.data[0].amount_yocto), AMOUNT.toString(), "credited amount");
});
check("failed refund keeps the credit liability and clears the scheduled outflow", () => {
  const cash = scenario.cash_after_failed_refund.map(BigInt);
  assertEqual(cash[3], AMOUNT, "refund liability");
  assertEqual(cash[4], 0n, "scheduled outflow");
  assertEqual(cash[8], 0n, "storage shortfall");
  assertEqual(scenario.failed_credit_balance_yocto, AMOUNT.toString(), "recorded credit");
});

// ---- underfunded withdrawal ----
check("underfunded withdrawal makes no contract transfer at all", () => {
  assertEqual(analysis.underfunded.contractTransfers.length, 0,
    `contract transfers: ${JSON.stringify(analysis.underfunded.contractTransfers)}`);
});
check("underfunded withdrawal preserves the cash snapshot and rejects at the margin", () => {
  assertEqual(JSON.stringify(scenario.cash_before_underfunded_withdrawal),
    JSON.stringify(scenario.cash_after_underfunded_withdrawal), "cash snapshot unchanged");
  assertEqual(scenario.underfunded_withdrawal_status?.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError,
    "Smart contract panicked: native cash solvency check failed", "panic message");
  const log = analysis.underfunded.events.length >= 0
    ? scenario.underfunded_withdrawal_receipts_outcome.flatMap((row) => row.outcome.logs ?? [])
      .find((entry) => entry.includes("SANDBOX_CASH_GATE_FAILED"))
    : undefined;
  assert(log, "cash gate diagnostic must be captured");
  const match = /C=(\d+) S=(\d+).*X=(\d+)/.exec(log);
  assert(match, "diagnostic shape");
  const [cash, storage, outflow] = [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
  assertEqual(cash, BigInt(scenario.cash_before_underfunded_withdrawal[0]), "diagnostic cash");
  assertEqual(outflow, AMOUNT, "diagnostic outflow");
  assertEqual(storage - BigInt(scenario.cash_before_underfunded_withdrawal[1]), STORAGE_GROWTH,
    "measured storage growth");
  assertEqual(scenario.measured_withdrawal_storage_growth_yocto, STORAGE_GROWTH.toString(), "recorded growth");
  assertEqual(BigInt(scenario.withdrawal_margin_fixture.target_free_margin_yocto), AMOUNT + STORAGE_GROWTH,
    "retry margin");
  assert(!analysis.underfunded.events.some(({ event }) => event === "service_report_refund_requested"),
    "underfunded withdrawal must not request a payout");
});

// ---- successful withdrawal ----
check("successful withdrawal pays the credit exactly once to the payer", () => {
  assertEqual(analysis.withdrawal.contractTransfers.length, 1, "contract transfer count");
  const [transfer] = analysis.withdrawal.contractTransfers;
  assertEqual(transfer.receiver_id, scenario.payer, "payout recipient");
  assertEqual(transfer.amount_yocto, AMOUNT.toString(), "payout amount");
});
check("successful withdrawal every receipt succeeded", () => {
  const failing = scenario.withdrawal_receipts_outcome.filter((row) =>
    Object.keys(row.outcome.status)[0] !== "SuccessValue");
  assertEqual(failing.length, 0, `non-success receipts: ${failing.map((row) => row.id).join(", ")}`);
});
check("successful withdrawal settles the credit once and reconciles balance and fees", () => {
  const settled = analysis.withdrawal.events.filter(({ event }) => event === "service_report_refund_sent");
  assertEqual(settled.length, 1, "settlement event count");
  assertEqual(scenario.final_payer_credit_yocto, "0", "closed credit");
  const fees = scenario.withdrawal_receipts_outcome.reduce((sum, row) => sum + BigInt(row.outcome.tokens_burnt ?? 0), 0n)
    + BigInt(scenario.withdrawal_transaction_outcome.outcome.tokens_burnt ?? 0);
  assertEqual(fees, BigInt(scenario.withdrawal_fees_yocto), "fee total");
  assertEqual(BigInt(scenario.payer_balance_after_yocto) + BigInt(scenario.withdrawal_fees_yocto),
    BigInt(scenario.payer_balance_before_yocto) + AMOUNT, "payer balance reconciliation");
});

// ---- replay ----
check("replay makes no contract transfer and does not settle twice", () => {
  assertEqual(analysis.replay.contractTransfers.length, 0,
    `contract transfers: ${JSON.stringify(analysis.replay.contractTransfers)}`);
  assert(!analysis.replay.events.some(({ event }) => event === "service_report_refund_requested"),
    "replay must not request a payout");
  assert(!analysis.replay.events.some(({ event }) => event === "service_report_refund_sent"),
    "replay must not settle a payout");
  assertEqual(scenario.payer_credit_after_replay_yocto, "0", "credit stays closed");
  assertEqual(analysis.replay.finalStatus, "FINAL", "replay final status");
  assertEqual(scenario.replay_status?.Failure !== undefined, true,
    `finalized replay transaction status must fail, got ${JSON.stringify(Object.keys(scenario.replay_status ?? {}))}`);
});

// ---- solvency ----
check("final cash covers liabilities plus storage", () => {
  const cash = scenario.cash_after_withdrawal.map(BigInt);
  assertEqual(cash[3], 0n, "refund liability");
  assertEqual(cash[4], 0n, "scheduled outflow");
  assertEqual(cash[8], 0n, "storage shortfall");
  const required = cash[1] + cash[2] + cash[3] + cash[4] + cash[5] + cash[6] + cash[7];
  assert(cash[0] >= required, `cash ${cash[0]} must cover ${required}`);
});

// ---- independent mutants against the committed verifier ----
function appendTransfer(target, graph, { receiver, amount }) {
  const spec = graphs[graph];
  const outcomes = target.scenarios.native_excess_refund_cash_gate[spec.outcomes];
  const bodies = target.scenarios.native_excess_refund_cash_gate[spec.bodies];
  const parent = outcomes.find((row) => row.outcome.receipt_ids?.length);
  const id = `reviewer-${graph}-${receiver}`;
  parent.outcome.receipt_ids.push(id);
  outcomes.push({ id, outcome: { executor_id: receiver, status: { SuccessValue: "" }, receipt_ids: [], logs: [] } });
  bodies.push({ receipt_id: id, predecessor_id: LCP, receiver_id: receiver,
    receipt: { Action: { actions: [{ Transfer: { deposit: String(amount) } }] } } });
}

function verdictOf(mutate) {
  const target = structuredClone(capture);
  mutate(target, target.scenarios.native_excess_refund_cash_gate);
  try {
    validateNativeExcessRefundCapture(target);
    return "ACCEPTED";
  } catch (error) {
    return `REJECTED: ${error.message.split("\n")[0]}`;
  }
}

const mutants = {
  "replay-other-recipient (listed lead)": (target) =>
    appendTransfer(target, "replay", { receiver: "third-party.sandbox", amount: AMOUNT }),
  "payout-executor-mismatch (listed lead)": (target) => {
    const s = target.scenarios.native_excess_refund_cash_gate;
    const payout = s.withdrawal_receipts.find((body) => body.predecessor_id === LCP && body.receiver_id === s.payer);
    s.withdrawal_receipts_outcome.find((row) => row.id === payout.receipt_id).outcome.executor_id = "third-party.sandbox";
  },
  "failure-callback-failed (listed lead)": (target) => {
    const s = target.scenarios.native_excess_refund_cash_gate;
    const callback = s.failure_receipts_outcome.find((row) =>
      (row.outcome.logs ?? []).some((log) => log.includes("excess_storage_refund_failed")));
    callback.outcome.status = { Failure: { ActionError: {} } };
  },
  "extra contract transfer in withdrawal graph (new)": (target) =>
    appendTransfer(target, "withdrawal", { receiver: "third-party.sandbox", amount: 1n }),
  "extra contract transfer in failed-refund graph (new)": (target) =>
    appendTransfer(target, "failure", { receiver: "third-party.sandbox", amount: AMOUNT }),
  "duplicate settlement event in withdrawal graph (new)": (target) => {
    const s = target.scenarios.native_excess_refund_cash_gate;
    const source = s.withdrawal_receipts_outcome.find((row) =>
      (row.outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
    const targetRow = s.withdrawal_receipts_outcome.find((row) => row.id !== source.id);
    targetRow.outcome.logs = [...(targetRow.outcome.logs ?? []),
      ...source.outcome.logs.filter((log) => log.includes('"event":"service_report_refund_sent"'))];
  },
  "second settlement event without transfer in replay (new)": (target) => {
    const s = target.scenarios.native_excess_refund_cash_gate;
    const source = s.withdrawal_receipts_outcome.find((row) =>
      (row.outcome.logs ?? []).some((log) => log.includes('"event":"service_report_refund_sent"')));
    const targetRow = s.replay_receipts_outcome.find((row) => row.id !== s.replay_transaction_outcome.outcome.receipt_ids[0])
      ?? s.replay_receipts_outcome[0];
    targetRow.outcome.logs = [...(targetRow.outcome.logs ?? []),
      ...source.outcome.logs.filter((log) => log.includes('"event":"service_report_refund_sent"'))];
  },
};

const mutantResults = Object.entries(mutants).map(([name, mutate]) => ({ name, verdict: verdictOf(mutate) }));

const report = {
  reviewer: "owner-adjacent independent pass (same assistant that authored the remediation; see limitations)",
  generated_at: new Date().toISOString(),
  capture: { path: capturePath.slice(repoRoot.length + 1),
    sha256: createHash("sha256").update(captureBytes).digest("hex") },
  manifest: { rows: manifest.size, verified: manifestResults.filter((row) => row.ok).length,
    stale: manifestResults.filter((row) => !row.ok).map((row) => row.path) },
  graphSummary: Object.fromEntries(Object.entries(analysis).map(([name, info]) => [name, {
    outcomes: info.outcomeCount, bodies: info.bodyCount, roots: info.roots.length,
    contractTransfers: info.contractTransfers.length, events: info.events.map(({ event }) => event),
    finalStatus: info.finalStatus, txStatus: info.txStatus,
  }])),
  checks,
  failures: checks.filter((entry) => entry.result === "FAIL"),
  mutants: mutantResults,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failures.length === 0 ? 0 : 1;
