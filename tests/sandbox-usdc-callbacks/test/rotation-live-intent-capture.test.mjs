import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateRotationLiveIntentCapture,
  verifyManifest,
} from "../verify-rotation-live-intent-capture.mjs";

const capturePath = fileURLToPath(new URL(
  "../rotation-live-intent-acceptance-2026-11-19/recovery.json",
  import.meta.url,
));
const manifestPath = fileURLToPath(new URL(
  "../rotation-live-intent-acceptance-2026-11-19.sha256",
  import.meta.url,
));
const canonical = JSON.parse(await readFile(capturePath, "utf8"));
const clone = () => structuredClone(canonical);
const rotation = (changed) => changed.scenarios.rotation_live_intent;

test("accepts the complete rotation-with-live-intent capture", () => {
  assert.doesNotThrow(() => validateRotationLiveIntentCapture(canonical));
});

test("rejects a manifest whose capture digest was altered", async () => {
  const rows = await readFile(manifestPath, "utf8");
  const digest = rows.match(/^([a-f0-9]{64})  (.+\/recovery\.json)$/m);
  assert.ok(digest, "source manifest must pin the capture");
  const directory = await mkdtemp(join(tmpdir(), "lcp-rotation-manifest-"));
  try {
    const mutated = join(directory, "mutated.sha256");
    await writeFile(mutated, rows.replace(digest[1], "00".repeat(32)));
    await assert.rejects(verifyManifest(capturePath, mutated),
      /does not match its captured digest/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an unpinned core artifact digest", () => {
  const changed = clone();
  changed.wasm_artifacts.lcp_core_fixture.wasm_sha256 = "00".repeat(32);
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /pinned NEP-330 reproducible core WASM/);
});

test("rejects an unpinned core code hash", () => {
  const changed = clone();
  changed.wasm_artifacts.lcp_core_fixture.near_code_hash = "F1PghgpN3UQmRhjm6hmoB9na3dfW9NNaW7cTKAoDdTfA";
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /pinned NEP-330 reproducible NEAR code hash/);
});

test("rejects an upgrade that redeploys a different code hash", () => {
  const changed = clone();
  rotation(changed).upgrade_code_hash = "F1PghgpN3UQmRhjm6hmoB9na3dfW9NNaW7cTKAoDdTfA";
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /pinned artifact's code hash/);
});

test("rejects settlement under the newly active epoch", () => {
  const changed = clone();
  rotation(changed).settlement_committee_epoch = rotation(changed).active_epoch;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /settle under the retained epoch/);
});

test("rejects a retained epoch retired while its intent is still pending", () => {
  const changed = clone();
  rotation(changed).retire_blocked_while_intent_pending = false;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /refuse retirement while its intent is pending/);
});

test("rejects an epoch that never retires after settlement", () => {
  const changed = clone();
  rotation(changed).retired_retained_epoch = false;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /retire once its intent has settled/);
});

test("rejects a lost instance identity across the upgrade", () => {
  const changed = clone();
  rotation(changed).instance_identity_preserved = false;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /instance identity must be preserved/);
});

test("rejects a lost counter or ledger across the upgrade", () => {
  for (const [field, label] of [
    ["current_epoch_preserved", /current epoch must be preserved/],
    ["used_key_count_preserved", /used-key count must be preserved/],
    ["last_rotation_generation_preserved", /rotation generation must be preserved/],
    ["storage_record_count_preserved", /storage record count must be preserved/],
    ["native_cash_ledger_preserved", /native cash ledger must be preserved/],
  ]) {
    const changed = clone();
    rotation(changed)[field] = false;
    assert.throws(() => validateRotationLiveIntentCapture(changed), label);
  }
});

test("rejects a generation that does not follow the governance rotation", () => {
  const changed = clone();
  rotation(changed).activated_generation = changed.scenarios.governance.activated_generation;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /generation after the governance rotation/);
});

test("rejects a retained epoch that was not the pre-rotation epoch", () => {
  const changed = clone();
  rotation(changed).retained_epoch = rotation(changed).active_epoch;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /epoch that was active before the rotation/);
});

test("rejects a transfer counter that does not continue past the pending intent", () => {
  const changed = clone();
  rotation(changed).next_transfer_after_upgrade = rotation(changed).pending_transfer_id;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /continue past the intent/);
});

test("rejects a duplicated transaction hash", () => {
  const changed = clone();
  rotation(changed).settlement_transaction_hash = rotation(changed).upgrade_transaction_hash;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /transactions must be distinct/);
});

test("rejects an activation observed before its activation time", () => {
  const changed = clone();
  rotation(changed).observed_activation_time_ns = rotation(changed).activate_at_ns;
  changed.scenarios.rotation_live_intent.activate_at_ns =
    (BigInt(changed.scenarios.rotation_live_intent.activate_at_ns) + 1n).toString();
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /observed before its activation time/);
});

test("rejects a partially paid escrow", () => {
  const changed = clone();
  rotation(changed).escrow.paid_raw = "1";
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /full funded amount/);
});

test("rejects escrow that still holds the settled intent", () => {
  const changed = clone();
  rotation(changed).escrow.pending_raw = rotation(changed).escrow.funded_raw;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /escrow\.pending_raw must be zero/);
});

test("rejects a native payout recorded for a token settlement", () => {
  const changed = clone();
  rotation(changed).escrow.paid_yocto = "1";
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /escrow\.paid_yocto must be zero/);
});

test("rejects a settlement in an asset other than six-decimal mock USDC", () => {
  const changed = clone();
  rotation(changed).escrow.settlement_asset.decimals = 24;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /six-decimal NEP-141/);
});

test("rejects an unrepaid mock token pool", () => {
  const changed = clone();
  rotation(changed).mock_pool_balance_restored = false;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /repaid to the mock token pool/);
});

test("rejects a recipient that never received the settlement", () => {
  const changed = clone();
  rotation(changed).recipient_token_balance = "0";
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /at least the paid amount/);
});

test("rejects a capture without the rotation scenario", () => {
  const changed = clone();
  delete changed.scenarios.rotation_live_intent;
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /must include the rotation_live_intent scenario/);
});

test("rejects a rotation recorded before the governance scenarios", () => {
  const changed = clone();
  const { governance, rotation_live_intent: live, ...rest } = changed.scenarios;
  changed.scenarios = { rotation_live_intent: live, governance, ...rest };
  assert.throws(() => validateRotationLiveIntentCapture(changed),
    /after the governance scenarios/);
});
