import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const stem = "native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17";
const defaultCapturePath = join(here, `${stem}.json`);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const EXPECTED_CORE_WASM_SHA256 = "33997ebb2f48d2ebb82db46d6f6625476ac963f71b71257aaee288c1a5671872";
const EXPECTED_CORE_CODE_HASH = "4URYaJBxtUGhYbafSHMRkVyGcHcY8Zs1uwugpRM1p76Z";
const EXPECTED_WITHDRAWAL_STORAGE_GROWTH = 260_000_000_000_000_000_000n;

function base58Encode(bytes) {
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = base58Alphabet[digit] + encoded;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + encoded;
}

function logsOf(receipts) {
  return receipts.flatMap(({ outcome }) => outcome?.logs ?? []);
}

function parseEvent(log) {
  if (!log.startsWith("EVENT_JSON:")) return null;
  try {
    return JSON.parse(log.slice("EVENT_JSON:".length));
  } catch {
    return null;
  }
}

function findEvent(receipts, name) {
  for (const receipt of receipts) {
    for (const log of receipt.outcome?.logs ?? []) {
      const event = parseEvent(log);
      if (event?.event === name) return { receipt, event };
    }
  }
  return null;
}

function nativeTransfers(receipts) {
  return receipts.flatMap((receipt) => {
    const actions = receipt.receipt?.Action?.actions
      ?? receipt.receipt?.action?.actions
      ?? [];
    return actions.flatMap((action) => {
      const transfer = action.Transfer ?? action.transfer;
      if (!transfer) return [];
      const amount = transfer.deposit ?? transfer.amount;
      return amount === undefined ? [] : [{
        receipt_id: receipt.receipt_id,
        predecessor_id: receipt.predecessor_id,
        receiver_id: receipt.receiver_id,
        amount_yocto: String(amount),
      }];
    });
  });
}

function assertFinalReceiptGraph(label, finalExecutionStatus, transactionOutcome, outcomes, bodies) {
  assert.equal(finalExecutionStatus, "FINAL", `${label} must use finalized transaction status`);
  assert.ok(Array.isArray(transactionOutcome?.outcome?.receipt_ids),
    `${label} must capture root receipt IDs`);
  assert.ok(Array.isArray(outcomes), `${label} must capture receipt outcomes`);
  assert.ok(Array.isArray(bodies), `${label} must capture raw receipt bodies`);
  const outcomeIds = new Set(outcomes.map(({ id }) => id));
  assert.equal(outcomeIds.size, outcomes.length, `${label} must have unique receipt outcome IDs`);
  const bodyIds = new Set(bodies.map(({ receipt_id }) => receipt_id));
  assert.equal(bodyIds.size, bodies.length, `${label} must have unique raw receipt bodies`);
  const referencedIds = [
    ...transactionOutcome.outcome.receipt_ids,
    ...outcomes.flatMap(({ outcome }) => outcome?.receipt_ids ?? []),
  ];
  assert.deepEqual([...new Set(referencedIds)].filter((id) => !outcomeIds.has(id)), [],
    `${label} must include every referenced child outcome`);
  assert.deepEqual([...outcomeIds].filter((id) => !bodyIds.has(id)), [],
    `${label} must include each receipt body`);
  assert.deepEqual([...bodyIds].filter((id) => !outcomeIds.has(id)), [],
    `${label} must not contain a receipt body without an outcome`);
  assert.ok(outcomes.every(({ outcome }) => !Object.hasOwn(outcome?.status ?? {}, "Unknown")),
    `${label} must not leave a receipt outcome unknown at FINAL`);
}

export function validateNativeExcessRefundCapture(capture) {
  assert.equal(capture.fixture_schema, "lcp.native-excess-refund-cash-gate-sandbox-acceptance.v1");
  assert.equal(capture.node.sandbox_version, "2.14.0");
  assert.equal(capture.node.protocol_version, 88);
  assert.match(capture.node.chain_id, /^test-chain-/);

  const coreArtifact = capture.wasm_artifacts.lcp_core_fixture;
  assert.equal(coreArtifact.wasm_sha256, EXPECTED_CORE_WASM_SHA256,
    "fixture must use the independently reproduced core WASM artifact");
  assert.equal(coreArtifact.near_code_hash, EXPECTED_CORE_CODE_HASH,
    "fixture must use the independently reproduced NEAR code hash");
  const wasmDigest = Buffer.from(coreArtifact.wasm_sha256, "hex");
  assert.equal(wasmDigest.length, 32, "WASM digest must be a SHA-256 digest");
  assert.equal(base58Encode(wasmDigest), coreArtifact.near_code_hash,
    "NEAR code hash must be base58(SHA-256(WASM))");

  const scenario = capture.scenarios.native_excess_refund_cash_gate;
  assert.ok(scenario, "native excess-refund scenario must exist");
  const amount = BigInt(scenario.amount_yocto);
  assert.equal(amount, 10n ** 22n, "fixture must refund 0.01 NEAR");

  assertFinalReceiptGraph("failed excess refund", scenario.failure_final_execution_status,
    scenario.failure_transaction_outcome, scenario.failure_receipts_outcome, scenario.failure_receipts);
  assertFinalReceiptGraph("underfunded withdrawal", scenario.underfunded_withdrawal_final_execution_status,
    scenario.underfunded_withdrawal_transaction_outcome,
    scenario.underfunded_withdrawal_receipts_outcome, scenario.underfunded_withdrawal_receipts);
  assertFinalReceiptGraph("successful withdrawal", scenario.withdrawal_final_execution_status,
    scenario.withdrawal_transaction_outcome, scenario.withdrawal_receipts_outcome, scenario.withdrawal_receipts);
  assertFinalReceiptGraph("replayed withdrawal", scenario.replay_final_execution_status,
    scenario.replay_transaction_outcome, scenario.replay_receipts_outcome, scenario.replay_receipts);

  for (const [label, transactionHash, transactionOutcome] of [
    ["failed excess refund", scenario.failure_transaction_hash, scenario.failure_transaction_outcome],
    ["underfunded withdrawal", scenario.underfunded_withdrawal_transaction_hash,
      scenario.underfunded_withdrawal_transaction_outcome],
    ["successful withdrawal", scenario.withdrawal_transaction_hash, scenario.withdrawal_transaction_outcome],
    ["replayed withdrawal", scenario.replay_transaction_hash, scenario.replay_transaction_outcome],
  ]) {
    assert.equal(transactionOutcome.id, transactionHash, `${label} root must match captured transaction hash`);
  }

  assert.ok(!Object.hasOwn(scenario.failure_transaction_outcome.outcome.status ?? {}, "Failure"),
    "the excess-refund request itself must succeed while its transfer fails downstream");
  assert.ok(!Object.hasOwn(scenario.failure_status ?? {}, "Failure"),
    "the finalized failed-refund transaction result must succeed after callback reconciliation");
  assert.ok(Object.hasOwn(scenario.underfunded_withdrawal_status ?? {}, "Failure"),
    "cash-gated withdrawal must fail at the contract root");
  assert.ok(!Object.hasOwn(scenario.withdrawal_transaction_outcome.outcome.status ?? {}, "Failure"),
    "successful withdrawal must succeed at the contract root");
  assert.ok(!Object.hasOwn(scenario.withdrawal_status ?? {}, "Failure"),
    "the finalized withdrawal transaction result must succeed");
  assert.ok(Object.hasOwn(scenario.replay_status ?? {}, "Failure"),
    "withdrawal replay after settlement must fail at the contract root");

  const missingAccountReceipt = scenario.failure_receipts_outcome.find(
    ({ outcome }) => outcome.executor_id === "missing-excess-refund.sandbox",
  );
  assert.ok(missingAccountReceipt, "forced transfer receipt must be captured");
  assert.equal(
    missingAccountReceipt.outcome.status?.Failure?.ActionError?.kind?.AccountDoesNotExist?.account_id,
    "missing-excess-refund.sandbox",
    "the native transfer must fail because the fixture recipient does not exist",
  );
  const failedRefundEvent = findEvent(scenario.failure_receipts_outcome, "excess_storage_refund_failed");
  assert.ok(failedRefundEvent, "production callback failure event must be captured");
  assert.equal(failedRefundEvent.receipt.outcome.executor_id, "lcp-core-sandbox.sandbox");
  assert.equal(failedRefundEvent.event.data?.[0]?.account_id, scenario.payer);
  assert.equal(failedRefundEvent.event.data?.[0]?.amount_yocto, amount.toString());
  assert.equal(scenario.failed_credit_balance_yocto, amount.toString());
  const failedTransfers = nativeTransfers(scenario.failure_receipts);
  assert.deepEqual(failedTransfers.filter(({ predecessor_id, receiver_id }) =>
    predecessor_id === "lcp-core-sandbox.sandbox" && receiver_id === "missing-excess-refund.sandbox")
    .map(({ amount_yocto }) => amount_yocto), [amount.toString()],
  "failed excess-refund action body must transfer the exact credit amount to the forced missing account");
  const cashAfterFailure = scenario.cash_after_failed_refund.map(BigInt);
  assert.equal(cashAfterFailure[3], amount, "failed refund must remain a legacy refund liability");
  assert.equal(cashAfterFailure[4], 0n, "failed transfer must clear its scheduled outflow");
  assert.equal(cashAfterFailure[8], 0n, "failed refund must not create a storage shortfall");

  const cashBeforeWithdrawal = scenario.cash_before_underfunded_withdrawal.map(BigInt);
  const cashAfterUnderfundedWithdrawal = scenario.cash_after_underfunded_withdrawal.map(BigInt);
  assert.deepEqual(cashAfterUnderfundedWithdrawal, cashBeforeWithdrawal,
    "underfunded withdrawal must preserve the full cash snapshot");
  assert.equal(scenario.underfunded_withdrawal_status?.Failure?.ActionError?.kind
    ?.FunctionCallError?.ExecutionError, "Smart contract panicked: native cash solvency check failed");
  const underfundedLogs = logsOf(scenario.underfunded_withdrawal_receipts_outcome);
  const cashGateLog = underfundedLogs.find((log) => log.includes("SANDBOX_CASH_GATE_FAILED"));
  assert.ok(cashGateLog, "one-transfer margin rejection must capture the cash-gate diagnostic");
  assert.ok(!underfundedLogs.some((log) => log.includes('"event":"service_report_refund_requested"')),
    "underfunded withdrawal must not request a native transfer");
  assert.ok(!nativeTransfers(scenario.underfunded_withdrawal_receipts)
    .some(({ predecessor_id, receiver_id, amount_yocto }) => predecessor_id === "lcp-core-sandbox.sandbox"
      && receiver_id === scenario.payer && amount_yocto === amount.toString()),
  "underfunded withdrawal must not create the payer payout action");
  const gateMatch = cashGateLog.match(/C=(\d+) S=(\d+).*X=(\d+)/);
  assert.ok(gateMatch, "cash-gate diagnostic must include balance, storage and planned outflow");
  assert.equal(BigInt(gateMatch[1]), cashBeforeWithdrawal[0]);
  assert.equal(BigInt(gateMatch[3]), amount);
  const storageGrowth = BigInt(gateMatch[2]) - cashBeforeWithdrawal[1];
  assert.equal(storageGrowth, EXPECTED_WITHDRAWAL_STORAGE_GROWTH,
    "persisted attempt storage growth must match the independent protocol-88 measurement");
  assert.equal(storageGrowth.toString(), scenario.measured_withdrawal_storage_growth_yocto);
  assert.equal(
    BigInt(scenario.withdrawal_margin_fixture.target_free_margin_yocto), amount + storageGrowth,
    "successful retry must start with the exact measured transfer-plus-storage margin",
  );

  const settledEvent = findEvent(scenario.withdrawal_receipts_outcome, "service_report_refund_sent");
  assert.ok(settledEvent, "production credit-withdrawal callback must settle successfully");
  assert.equal(settledEvent.receipt.outcome.executor_id, "lcp-core-sandbox.sandbox");
  assert.equal(settledEvent.event.data?.[0]?.account_id, scenario.payer);
  assert.equal(settledEvent.event.data?.[0]?.amount_yocto, amount.toString());
  const payoutTransfers = nativeTransfers(scenario.withdrawal_receipts)
    .filter(({ predecessor_id, receiver_id }) =>
      predecessor_id === "lcp-core-sandbox.sandbox" && receiver_id === scenario.payer);
  assert.deepEqual(payoutTransfers.map(({ amount_yocto }) => amount_yocto), [amount.toString()],
    "successful withdrawal must contain exactly one payer transfer for the credit amount");
  assert.equal(scenario.final_payer_credit_yocto, "0", "successful callback must close the payer credit");
  const fees = BigInt(scenario.withdrawal_fees_yocto);
  const receiptFees = scenario.withdrawal_receipts_outcome.reduce(
    (sum, receipt) => sum + BigInt(receipt.outcome?.tokens_burnt ?? 0),
    0n,
  );
  const transactionFees = BigInt(
    scenario.withdrawal_transaction_outcome?.outcome?.tokens_burnt ?? 0,
  );
  assert.equal(fees, receiptFees + transactionFees,
    "captured fee total must equal transaction and receipt gas charges");
  const before = BigInt(scenario.payer_balance_before_yocto);
  const after = BigInt(scenario.payer_balance_after_yocto);
  assert.equal(after + fees, before + amount,
    "payer balance increase plus measured transaction fees must equal the credit paid");

  assert.ok(!nativeTransfers(scenario.replay_receipts).some(({ predecessor_id, receiver_id, amount_yocto }) =>
    predecessor_id === "lcp-core-sandbox.sandbox"
      && receiver_id === scenario.payer && amount_yocto === amount.toString()),
  "settled withdrawal replay must not create a duplicate payer transfer");
  assert.ok(!logsOf(scenario.replay_receipts_outcome)
    .some((log) => log.includes('"event":"service_report_refund_requested"')),
  "settled withdrawal replay must not request a second payout");
  assert.equal(scenario.payer_credit_after_replay_yocto, "0",
    "withdrawal replay must leave payer credit closed");

  const finalCash = scenario.cash_after_withdrawal.map(BigInt);
  assert.equal(finalCash[3], 0n, "successful callback must close the refund liability");
  assert.equal(finalCash[4], 0n, "successful callback must clear scheduled outflow");
  assert.equal(finalCash[8], 0n, "successful payout must not leave a storage shortfall");
  const required = finalCash[1] + finalCash[2] + finalCash[3] + finalCash[4]
    + finalCash[5] + finalCash[6] + finalCash[7];
  assert.ok(finalCash[0] >= required, "final native cash must cover all liabilities and storage");
}

async function verifyManifest(capturePath, manifestPath) {
  const relativeCapturePath = relative(repoRoot, capturePath).split(sep).join("/");
  assert.ok(relativeCapturePath && relativeCapturePath !== ".."
    && !relativeCapturePath.startsWith("../"),
  "capture must be inside the repository so its source manifest can pin it");
  const rows = (await readFile(manifestPath, "utf8")).trim().split(/\r?\n/);
  let checked = 0;
  let capturePinned = false;
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
    assert.ok(match, `malformed checksum row: ${row}`);
    const [, expected, relativePath] = match;
    const sourcePath = resolve(repoRoot, relativePath);
    const relativeSourcePath = relative(repoRoot, sourcePath).split(sep).join("/");
    assert.ok(relativeSourcePath && relativeSourcePath !== ".."
      && !relativeSourcePath.startsWith("../"),
    `manifest path escapes the repository: ${relativePath}`);
    const bytes = await readFile(sourcePath);
    assert.equal(createHash("sha256").update(bytes).digest("hex").toString(), expected,
      `${relativeSourcePath} does not match its captured digest`);
    if (relativeSourcePath === relativeCapturePath) capturePinned = true;
    checked += 1;
  }
  assert.ok(checked > 0, "source checksum manifest must not be empty");
  assert.ok(capturePinned, "source manifest must pin the selected capture file");
  return checked;
}

async function main() {
  const capturePath = resolve(process.argv[2] ?? defaultCapturePath);
  const manifestPath = resolve(process.argv[3] ?? capturePath.replace(/\.json$/, ".sha256"));
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  validateNativeExcessRefundCapture(capture);
  const sourceCount = await verifyManifest(capturePath, manifestPath);
  console.log(`PASS native excess-refund capture: ${sourceCount} source hashes, closed finalized receipt graphs, pinned artifact, exact transfer actions and replay rejection, exact storage margin, and solvency`);
  console.log("LIMITATION: validates captured Sandbox node records and manifest consistency; it does not validate cryptographic receipt inclusion proofs against block headers.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
