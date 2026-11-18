import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const defaultCapturePath = resolve(
  here,
  "recovery-acceptance-2026-11-17-689fbf1/bootstrap-guard.json",
);
const defaultManifestPath = resolve(
  here,
  "p2-usdc-recovery-local-acceptance-2026-11-17.sha256",
);
const EXPECTED_CORE_WASM_SHA256 = "890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80";
const EXPECTED_CORE_CODE_HASH = "ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX";
const BOOTSTRAP_GUARD_ERROR =
  "receipt recovery must be bootstrapped before commitments or transfers are created";

function actionCall(transaction, receiverId, methodName) {
  assert.equal(transaction.transaction.receiver_id, receiverId,
    `${methodName} transaction receiver mismatch`);
  const action = transaction.transaction.actions
    .flatMap(({ FunctionCall }) => FunctionCall ? [FunctionCall] : [])
    .find(({ method_name }) => method_name === methodName);
  assert.ok(action, `transaction does not call ${methodName}`);
  return action;
}

function assertFinalReceiptClosure(transaction, description) {
  assert.equal(transaction.final_execution_status, "FINAL",
    `${description} must be finalized`);
  assert.ok(transaction.transaction_outcome?.outcome,
    `${description} is missing its transaction outcome`);
  assert.ok(Array.isArray(transaction.receipts_outcome),
    `${description} is missing receipt outcomes`);
  assert.ok(Array.isArray(transaction.receipts),
    `${description} is missing raw receipts`);

  const outcomeIds = new Set(transaction.receipts_outcome.map(({ id }) => id));
  assert.equal(outcomeIds.size, transaction.receipts_outcome.length,
    `${description} has duplicate outcome IDs`);
  const bodyIds = new Set(transaction.receipts.map(({ receipt_id }) => receipt_id));
  assert.equal(bodyIds.size, transaction.receipts.length,
    `${description} has duplicate receipt bodies`);
  assert.deepEqual([...outcomeIds].filter((id) => !bodyIds.has(id)), [],
    `${description} is missing raw receipt bodies`);
  assert.deepEqual([...bodyIds].filter((id) => !outcomeIds.has(id)), [],
    `${description} has receipt bodies without outcomes`);

  const referencedIds = [
    ...(transaction.transaction_outcome.outcome.receipt_ids ?? []),
    ...transaction.receipts_outcome.flatMap(({ outcome }) => outcome?.receipt_ids ?? []),
  ];
  assert.deepEqual(
    [...new Set(referencedIds)].filter((id) => !outcomeIds.has(id)),
    [],
    `${description} has an incomplete child receipt graph`,
  );
  assert.ok(transaction.receipts_outcome.every(({ outcome }) =>
    !Object.hasOwn(outcome?.status ?? {}, "Unknown")),
  `${description} has an unknown receipt outcome`);
}

export function validateBootstrapActivityGuardCapture(capture) {
  assert.equal(capture.fixture_schema, "lcp.bootstrap-activity-guard-sandbox-acceptance.v1");
  assert.equal(capture.node.sandbox_version, "2.14.0");
  assert.equal(capture.node.protocol_version, 88);
  assert.ok(capture.node.chain_id.startsWith("test-chain-"),
    "fixture must come from isolated NEAR Sandbox");

  assert.equal(capture.wasm_artifacts?.lcp_core_fixture?.wasm_sha256, EXPECTED_CORE_WASM_SHA256,
    "fixture must use the pinned reproducible recovery core artifact");
  assert.equal(capture.wasm_artifacts?.lcp_core_fixture?.near_code_hash, EXPECTED_CORE_CODE_HASH,
    "fixture must use the pinned reproducible recovery core code hash");

  const scenario = capture.scenarios?.bootstrap_after_commitment_activity;
  assert.ok(scenario, "capture is missing the bootstrap-after-commitment scenario");
  assert.equal(scenario.isolated_sandbox_only, true);
  assert.equal(scenario.account_id, "bootstrap-guard.sandbox");
  assert.equal(scenario.deployed_code_hash, capture.wasm_artifacts.lcp_core_fixture.near_code_hash);
  assert.equal(scenario.commitment_id, "1");
  assert.ok(BigInt(scenario.storage_bond_yocto) > 0n,
    "draft must use its measured positive storage bond");

  const commitmentTx = scenario.commitment_transaction;
  assertFinalReceiptClosure(commitmentTx, "commitment creation");
  const commitmentCall = actionCall(commitmentTx, scenario.account_id, "create_commitment");
  assert.equal(commitmentCall.deposit, scenario.storage_bond_yocto,
    "commitment must attach the measured storage bond");
  const commitmentArgs = JSON.parse(Buffer.from(commitmentCall.args, "base64").toString("utf8"));
  assert.equal(commitmentArgs.args.subject, "Bootstrap after commitment activity");
  const commitmentSuccess = [
    commitmentTx.status,
    ...commitmentTx.receipts_outcome.map(({ outcome }) => outcome?.status),
  ].find((status) => status && Object.hasOwn(status, "SuccessValue"));
  assert.ok(commitmentSuccess, "create_commitment did not return successfully");
  assert.equal(JSON.parse(Buffer.from(commitmentSuccess.SuccessValue, "base64").toString("utf8")), "1");
  assert.ok(commitmentTx.receipts_outcome.some(({ outcome }) =>
    outcome?.logs?.some((log) => log.includes('"event":"commitment_created"'))),
  "commitment_created event is missing");

  const bootstrapTx = scenario.rejected_bootstrap_transaction;
  assertFinalReceiptClosure(bootstrapTx, "rejected recovery bootstrap");
  const bootstrapCall = actionCall(bootstrapTx, scenario.account_id, "bootstrap_receipt_recovery");
  assert.equal(bootstrapCall.deposit, "0",
    "guard probe must not attach funds to a transaction expected to fail");
  assert.ok(JSON.stringify([
    bootstrapTx.status,
    ...bootstrapTx.receipts_outcome.map(({ outcome }) => outcome?.status),
  ]).includes(BOOTSTRAP_GUARD_ERROR),
  "bootstrap did not fail at the activity guard");

  assert.equal(scenario.configuration_after_rejected_bootstrap, null,
    "failed bootstrap must leave recovery unconfigured");
  assert.equal(scenario.commitment_after_rejected_bootstrap?.id, "1",
    "failed bootstrap must preserve the commitment");
  assert.equal(scenario.commitment_after_rejected_bootstrap?.subject,
    "Bootstrap after commitment activity");
  assert.equal(scenario.commitment_after_rejected_bootstrap?.lifecycle, "Draft");
}

export async function verifyBootstrapActivityGuardManifest(capturePath, manifestPath) {
  const captureRelativePath = relative(repoRoot, capturePath).split(sep).join("/");
  assert.ok(captureRelativePath && captureRelativePath !== ".."
    && !captureRelativePath.startsWith("../"),
  "capture must be inside the repository");

  const rows = (await readFile(manifestPath, "utf8")).trim().split(/\r?\n/);
  let capturePinned = false;
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
    assert.ok(match, `malformed manifest row: ${row}`);
    const [, expectedHash, relativePath] = match;
    const sourcePath = resolve(repoRoot, relativePath);
    const sourceRelativePath = relative(repoRoot, sourcePath).split(sep).join("/");
    assert.ok(sourceRelativePath && sourceRelativePath !== ".."
      && !sourceRelativePath.startsWith("../"),
    `manifest path escapes the repository: ${relativePath}`);
    const bytes = await readFile(sourcePath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash,
      `${sourceRelativePath} does not match its manifest hash`);
    if (sourceRelativePath === captureRelativePath) capturePinned = true;
  }
  assert.ok(rows.length > 0, "source manifest must not be empty");
  assert.ok(capturePinned, "source manifest must pin the capture file");
  return rows.length;
}

async function main() {
  const captureArgument = process.argv[2];
  const capturePath = resolve(captureArgument ?? defaultCapturePath);
  const inferredManifestPath = captureArgument
    ? capturePath.replace(/\.json$/, ".sha256")
    : defaultManifestPath;
  const manifestPath = resolve(process.argv[3] ?? inferredManifestPath);
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  validateBootstrapActivityGuardCapture(capture);
  const checked = await verifyBootstrapActivityGuardManifest(capturePath, manifestPath);
  console.log(`PASS bootstrap-guard capture: ${checked} source hashes, finalized commitment, rejected bootstrap, preserved state`);
  console.log("LIMITATION: validates saved local Sandbox records; it is not a testnet or receipt-proof verification.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
