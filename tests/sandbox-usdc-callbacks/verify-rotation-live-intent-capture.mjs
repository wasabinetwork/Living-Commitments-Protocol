import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const captureStem = "rotation-live-intent-acceptance-2026-11-19";
const defaultCapturePath = join(here, captureStem, "recovery.json");
const defaultManifestPath = join(here, `${captureStem}.sha256`);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const EXPECTED_CORE_WASM_SHA256 = "de9dc7cfed3e6f9b9b47350e257381a77ddc7f765b347173e89e926cde06a192";
const EXPECTED_CORE_CODE_HASH = "Fz13ws3yxBWcuAd7FHtYvR3EwpfpaJTcVi8BxbBHkWxH";
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const TRANSACTION_HASH_FIELDS = [
  "pool_repayment_transaction_hash",
  "pending_transfer_transaction_hash",
  "proposal_transaction_hash",
  "activation_transaction_hash",
  "upgrade_transaction_hash",
  "settlement_transaction_hash",
];

function base58Encode(bytes) {
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    encoded = base58Alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + encoded;
}

function base58Decode(text) {
  assert.equal(typeof text, "string", "hashes must be strings");
  assert.ok(text.length > 0, "hashes must not be empty");
  let value = 0n;
  for (const char of text) {
    const digit = base58Alphabet.indexOf(char);
    assert.notEqual(digit, -1, `invalid base58 character in ${text}`);
    value = value * 58n + BigInt(digit);
  }
  const hex = value === 0n ? "" : value.toString(16).padStart(2, "0");
  let leadingZeroes = 0;
  while (text[leadingZeroes] === "1") leadingZeroes += 1;
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(hex, "hex")]);
}

function decimal(value, label) {
  assert.equal(typeof value, "string", `${label} must be a decimal string`);
  assert.match(value, DECIMAL, `${label} must be an unsigned decimal string`);
  return BigInt(value);
}

function assertPreservedFlag(value, label) {
  assert.equal(value, true, `${label} must be preserved`);
}

function assertZero(value, label) {
  assert.equal(decimal(value, label), 0n, `${label} must be zero`);
}

export function validateRotationLiveIntentCapture(capture) {
  assert.equal(capture.fixture_schema, "lcp.receipt-recovery-sandbox-acceptance.v1");
  assert.equal(capture.node.sandbox_version, "2.14.0");
  assert.equal(capture.node.protocol_version, 88);
  assert.match(capture.node.chain_id, /^test-chain-/);

  const coreArtifact = capture.wasm_artifacts.lcp_core_fixture;
  assert.equal(coreArtifact.wasm_sha256, EXPECTED_CORE_WASM_SHA256,
    "fixture must use the pinned NEP-330 reproducible core WASM artifact");
  assert.equal(coreArtifact.near_code_hash, EXPECTED_CORE_CODE_HASH,
    "fixture must use the pinned NEP-330 reproducible NEAR code hash");
  assert.equal(coreArtifact.input_mode, "explicit-path",
    "fixture must record that the pinned WASM was supplied by explicit path");
  const wasmDigest = Buffer.from(coreArtifact.wasm_sha256, "hex");
  assert.equal(wasmDigest.length, 32, "WASM digest must be a SHA-256 digest");
  assert.equal(base58Encode(wasmDigest), coreArtifact.near_code_hash,
    "NEAR code hash must be base58(SHA-256(WASM))");

  const order = Object.keys(capture.scenarios);
  for (const name of ["governance", "rotation_live_intent", "code_hash_change"]) {
    assert.ok(order.includes(name), `capture must include the ${name} scenario`);
  }
  assert.ok(order.indexOf("rotation_live_intent") > order.indexOf("governance"),
    "the live-intent rotation must run after the governance scenarios");
  assert.ok(order.indexOf("rotation_live_intent") < order.indexOf("code_hash_change"),
    "the live-intent rotation must settle before the code-hash measurement");

  const governance = capture.scenarios.governance;
  const scenario = capture.scenarios.rotation_live_intent;
  assert.ok(scenario, "rotation-with-live-intent scenario must exist");
  assert.ok(governance, "the preceding governance scenario must exist for continuity checks");

  const priorGeneration = decimal(governance.activated_generation,
    "governance.activated_generation");
  const generation = decimal(scenario.activated_generation,
    "rotation_live_intent.activated_generation");
  assert.equal(generation, priorGeneration + 1n,
    "the live-intent rotation must activate the generation after the governance rotation");
  assert.equal(decimal(scenario.last_rotation_generation, "rotation_live_intent.last_rotation_generation"),
    generation, "the observed rotation generation must be the activated generation");
  assert.equal(scenario.active_epoch, governance.active_epoch + 1,
    "the live-intent rotation must activate the epoch after the governance rotation");
  assert.equal(scenario.retained_epoch, governance.active_epoch,
    "the epoch retained by the pending intent must be the epoch that was active before the rotation");
  assert.equal(scenario.settlement_committee_epoch, scenario.retained_epoch,
    "the intent must settle under the retained epoch");
  assert.ok(scenario.settlement_committee_epoch < scenario.active_epoch,
    "settlement must use the retained epoch while a newer epoch is active");

  const activateAt = decimal(scenario.activate_at_ns, "rotation_live_intent.activate_at_ns");
  const observedActivation = decimal(scenario.observed_activation_time_ns,
    "rotation_live_intent.observed_activation_time_ns");
  assert.ok(observedActivation >= activateAt,
    "the rotation must not be observed before its activation time");
  assert.ok(activateAt > decimal(governance.activation_at_ns, "governance.activation_at_ns"),
    "the live-intent rotation must activate after the governance rotation");
  assert.ok(Number.isSafeInteger(scenario.fast_forward_calls) && scenario.fast_forward_calls >= 1,
    "the fixture must record the Sandbox fast-forwards used to reach activation");

  assert.equal(scenario.retire_blocked_while_intent_pending, true,
    "the retained epoch must refuse retirement while its intent is pending");
  assert.equal(scenario.retired_retained_epoch, true,
    "the retained epoch must retire once its intent has settled");

  assert.equal(scenario.upgrade_code_hash, coreArtifact.near_code_hash,
    "the in-place upgrade must redeploy the pinned artifact's code hash");
  assertPreservedFlag(scenario.instance_identity_preserved, "instance identity");
  assert.match(scenario.instance_id, /^[0-9a-f]{64}$/,
    "instance identity must be a 32-byte hex value");
  assertPreservedFlag(scenario.current_epoch_preserved, "current epoch");
  assertPreservedFlag(scenario.used_key_count_preserved, "used-key count");
  assertPreservedFlag(scenario.last_rotation_generation_preserved, "rotation generation");
  assertPreservedFlag(scenario.storage_record_count_preserved, "storage record count");
  assertPreservedFlag(scenario.native_cash_ledger_preserved, "native cash ledger");

  const nextTransfer = decimal(scenario.next_transfer_after_upgrade,
    "rotation_live_intent.next_transfer_after_upgrade");
  const pendingTransfer = decimal(scenario.pending_transfer_id,
    "rotation_live_intent.pending_transfer_id");
  assert.equal(nextTransfer, pendingTransfer + 1n,
    "the transfer counter must continue past the intent that predates the upgrade");
  assert.ok(pendingTransfer > 0n, "the pending intent must carry an allocated transfer ID");

  for (const field of TRANSACTION_HASH_FIELDS) {
    const digest = base58Decode(scenario[field]);
    assert.equal(digest.length, 32, `${field} must be a 32-byte transaction hash`);
  }
  const hashes = TRANSACTION_HASH_FIELDS.map((field) => scenario[field]);
  assert.equal(new Set(hashes).size, hashes.length,
    "the rotation, upgrade, repayment, and settlement transactions must be distinct");

  assert.equal(scenario.mock_pool_balance_restored, true,
    "the scenario's payouts must be repaid to the mock token pool");

  const escrow = scenario.escrow;
  assert.deepEqual(escrow.settlement_asset, {
    kind: "nep141",
    token_account_id: "mock-usdc.sandbox",
    decimals: 6,
  }, "the retained intent must settle as a six-decimal NEP-141 transfer");
  const fundedRaw = decimal(escrow.funded_raw, "escrow.funded_raw");
  const paidRaw = decimal(escrow.paid_raw, "escrow.paid_raw");
  assert.ok(fundedRaw > 0n, "the settled intent must have funded escrow");
  assert.equal(paidRaw, fundedRaw, "settlement must pay out the full funded amount");
  for (const field of ["pending_raw", "free_raw", "refunded_raw", "quarantined_raw"]) {
    assertZero(escrow[field], `escrow.${field}`);
  }
  for (const field of ["funded_yocto", "paid_yocto", "refunded_yocto",
    "pending_yocto", "free_yocto", "quarantined_yocto"]) {
    assertZero(escrow[field], `escrow.${field}`);
  }
  const recipientBalance = decimal(scenario.recipient_token_balance,
    "rotation_live_intent.recipient_token_balance");
  assert.ok(recipientBalance >= paidRaw,
    "the settlement recipient must hold at least the paid amount");

  return { paidRaw, generation, pendingTransfer, nextTransfer };
}

export async function verifyManifest(capturePath, manifestPath) {
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
  const captureArgument = process.argv[2];
  const capturePath = resolve(captureArgument ?? defaultCapturePath);
  const manifestPath = resolve(process.argv[3]
    ?? (captureArgument ? capturePath.replace(/\.json$/, ".sha256") : defaultManifestPath));
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  const { paidRaw, generation, pendingTransfer, nextTransfer } =
    validateRotationLiveIntentCapture(capture);
  const sourceCount = await verifyManifest(capturePath, manifestPath);
  console.log(`PASS rotation-with-live-intent capture: ${sourceCount} source hashes, pinned artifact, epoch ${capture.scenarios.rotation_live_intent.retained_epoch} blocked from retirement until transfer ${pendingTransfer} settles under the active epoch ${capture.scenarios.rotation_live_intent.active_epoch}, generation ${generation} preserved across an in-place upgrade (next transfer ${nextTransfer}), ${paidRaw} raw units paid, and the mock pool repaid`);
  console.log("LIMITATION: validates the recorded scenario fields, their cross-scenario continuity, and manifest consistency; it does not re-derive receipt-level execution, and the upgrade is a DeployContract over live state rather than a state-migration function.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
