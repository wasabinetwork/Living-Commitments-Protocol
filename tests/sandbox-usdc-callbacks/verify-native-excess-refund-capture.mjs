import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const stem = "native-excess-refund-cash-gate-sandbox-acceptance-2026-11-16";
const capturePath = join(here, `${stem}.json`);
const manifestPath = join(here, `${stem}.sha256`);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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

async function verifyManifest() {
  const rows = (await readFile(manifestPath, "utf8")).trim().split(/\r?\n/);
  let checked = 0;
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
    assert.ok(match, `malformed checksum row: ${row}`);
    const [, expected, relativePath] = match;
    const bytes = await readFile(join(repoRoot, relativePath));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected,
      `${relativePath} does not match its captured digest`);
    checked += 1;
  }
  assert.ok(checked > 0, "source checksum manifest must not be empty");
  return checked;
}

async function main() {
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  assert.equal(capture.fixture_schema, "lcp.native-excess-refund-cash-gate-sandbox-acceptance.v1");
  assert.equal(capture.node.sandbox_version, "2.14.0");
  assert.equal(capture.node.protocol_version, 88);
  assert.match(capture.node.chain_id, /^test-chain-/);

  const coreArtifact = capture.wasm_artifacts.lcp_core_fixture;
  assert.match(coreArtifact.wasm_sha256, /^[a-f0-9]{64}$/);
  const wasmDigest = Buffer.from(coreArtifact.wasm_sha256, "hex");
  assert.equal(wasmDigest.length, 32, "WASM digest must be a SHA-256 digest");
  assert.equal(base58Encode(wasmDigest), coreArtifact.near_code_hash,
    "NEAR code hash must be base58(SHA-256(WASM))");

  const scenario = capture.scenarios.native_excess_refund_cash_gate;
  assert.ok(scenario, "native excess-refund scenario must exist");
  const amount = BigInt(scenario.amount_yocto);
  assert.equal(amount, 10n ** 22n, "fixture must refund 0.01 NEAR");

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
  const gateMatch = cashGateLog.match(/C=(\d+) S=(\d+).*X=(\d+)/);
  assert.ok(gateMatch, "cash-gate diagnostic must include balance, storage and planned outflow");
  assert.equal(BigInt(gateMatch[1]), cashBeforeWithdrawal[0]);
  assert.equal(BigInt(gateMatch[3]), amount);
  const storageGrowth = BigInt(gateMatch[2]) - cashBeforeWithdrawal[1];
  assert.ok(storageGrowth > 0n, "persisted attempt must have measurable storage growth");
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
  assert.ok(scenario.withdrawal_receipts_outcome.some(({ outcome }) =>
    outcome.executor_id === scenario.payer && Object.hasOwn(outcome.status ?? {}, "SuccessValue")),
  "successful native transfer to the payer must be present");
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

  const finalCash = scenario.cash_after_withdrawal.map(BigInt);
  assert.equal(finalCash[3], 0n, "successful callback must close the refund liability");
  assert.equal(finalCash[4], 0n, "successful callback must clear scheduled outflow");
  assert.equal(finalCash[8], 0n, "successful payout must not leave a storage shortfall");
  const required = finalCash[1] + finalCash[2] + finalCash[3] + finalCash[4]
    + finalCash[5] + finalCash[6] + finalCash[7];
  assert.ok(finalCash[0] >= required, "final native cash must cover all liabilities and storage");

  const sourceCount = await verifyManifest();
  console.log(`PASS native excess-refund capture: ${sourceCount} source hashes, failed transfer, preserved credit, exact storage margin, one successful withdrawal, and solvency`);
  console.log("LIMITATION: validates captured records and manifest consistency; it does not rerun Sandbox or validate receipt Merkle proofs against block headers.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
