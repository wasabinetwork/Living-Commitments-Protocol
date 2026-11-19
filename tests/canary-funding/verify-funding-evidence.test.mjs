import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeApprovedTotals,
  nearToYocto,
  verifyEvidence,
} from "./verify-funding-evidence.mjs";

const NEAR = 10n ** 24n;
const near = (value) => nearToYocto(value).toString();
const clone = (value) => JSON.parse(JSON.stringify(value));

function validEvidence() {
  return {
    schema: "lcp.canary_funding_evidence.v1",
    network: "testnet",
    chain_id: "testnet",
    contract_account: "dev.liquid-commitments.testnet",
    recorded_at: "2026-11-19T00:00:00.000Z",
    approved_inputs: {
      max_pending: 16,
      stuck_callbacks: 16,
      stuck_allowance_hours: 24,
      largest_payout_near: "1",
      storage_bytes: 617,
      retained_bytes: 617,
      margin_percent: 25,
      gas_tgas_per_callback: 40,
    },
    cited: { buffer_near: "40.2468", gas_float_near: "0.064" },
    buffer: {
      snapshot_block: { height: 1200, hash: "11111111111111111111111111111111" },
      state_export_sha256: "a".repeat(64),
      liquid_balance_yocto: near("60"),
      headroom_yocto: near("53.9"),
      funding_transactions: [
        { hash: "FUNDTX", amount_yocto: near("60"), finalized_block_height: 1199 },
      ],
      reserve: { status: "ready", ready: true, shortfall_yocto: "0" },
      native_liabilities: {
        escrow_yocto: near("5"),
        credits_yocto: near("1"),
        storage_backing_yocto: near("0.1"),
        complete: true,
      },
      gas_float_excluded: true,
    },
    enforcement: {
      pending_cap: { limit: 16, control: "payout pause at 16 pending", alert_owner: "on-call" },
      payout_ceiling_near: "1",
      stuck_allowance: {
        hours: 24,
        callbacks: 16,
        correlation_assumption: "one shared incident stalls all in-flight callbacks",
      },
      operator_acknowledged_by: "ops-lead",
      contract_caps_pending_count: false,
    },
    gas_float: {
      monitored_separately: true,
      monitoring: "signer balance alert below 0.032 NEAR",
      signers: [
        { account: "ops-a.testnet", balance_yocto: near("0.032") },
        { account: "ops-b.testnet", balance_yocto: near("0.032") },
      ],
    },
  };
}

test("recomputes the approved buffer and gas float", () => {
  const totals = computeApprovedTotals(validEvidence().approved_inputs);
  assert.equal(totals.buffer_yocto, nearToYocto("40.2468"));
  assert.equal(totals.gas_float_yocto, nearToYocto("0.064"));
  assert.equal(totals.subtotal_yocto, nearToYocto("32.19744"));
  assert.equal(totals.margin_yocto, nearToYocto("8.04936"));
});

test("agrees with the funding-buffer calculator", () => {
  const output = execFileSync(process.execPath, [
    "tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs",
    "--max-pending", "16",
    "--max-outflow-near", "1",
    "--storage-bytes", "617",
    "--retained-bytes", "617",
    "--stuck-callbacks", "16",
    "--margin", "0.25",
    "--gas-tgas-per-callback", "40",
  ], { encoding: "utf8" });
  const calculator = JSON.parse(output);
  const totals = computeApprovedTotals(validEvidence().approved_inputs);
  assert.equal(calculator.components.recommended_buffer_yocto, totals.buffer_yocto.toString());
  assert.equal(calculator.components.separate_gas_float_yocto, totals.gas_float_yocto.toString());
});

test("passes complete, consistent evidence", () => {
  const verdict = verifyEvidence(validEvidence());
  assert.equal(verdict.verdict, "PASS", JSON.stringify(verdict));
  assert.deepEqual(verdict.failures, []);
  assert.deepEqual(verdict.problems, []);
});

test("reports UNKNOWN for the unfilled template", () => {
  const template = JSON.parse(
    readFileSync("tests/canary-funding/funding-evidence.template.json", "utf8"),
  );
  const verdict = verifyEvidence(template);
  assert.equal(verdict.verdict, "UNKNOWN");
  assert.ok(verdict.problems.length > 0);
  assert.match(verdict.note, /must not cite/);
});

test("fails when headroom is below the approved buffer", () => {
  const evidence = validEvidence();
  evidence.buffer.liquid_balance_yocto = near("44");
  evidence.buffer.headroom_yocto = near("37.9");
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.failures.some((line) => /below the approved buffer/.test(line)));
});

test("fails when the cited buffer does not recompute", () => {
  const evidence = validEvidence();
  evidence.cited.buffer_near = "41";
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.failures.some((line) => /does not recompute/.test(line)));
});

test("fails when approved inputs drift from the owner decision", () => {
  const evidence = validEvidence();
  evidence.approved_inputs.max_pending = 32;
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.failures.some((line) => /approved value is 16/.test(line)));
});

test("fails when headroom arithmetic or liability completeness is wrong", () => {
  const mismatched = validEvidence();
  mismatched.buffer.headroom_yocto = near("53");
  assert.equal(verifyEvidence(mismatched).verdict, "FAIL");

  const incomplete = validEvidence();
  incomplete.buffer.native_liabilities.complete = false;
  assert.equal(verifyEvidence(incomplete).verdict, "UNKNOWN");
});

test("fails when the reserve is not ready or reports a shortfall", () => {
  const stale = validEvidence();
  stale.buffer.reserve.status = "stale";
  stale.buffer.reserve.ready = false;
  assert.equal(verifyEvidence(stale).verdict, "FAIL");

  const short = validEvidence();
  short.buffer.reserve.shortfall_yocto = near("0.5");
  const verdict = verifyEvidence(short);
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.failures.some((line) => /shortfall/.test(line)));
});

test("fails when the buffer counts the signer gas float", () => {
  const evidence = validEvidence();
  evidence.buffer.gas_float_excluded = false;
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.failures.some((line) => /exclude the signer gas float/.test(line)));
});

test("fails when the operational limits exceed the approved values", () => {
  for (const mutate of [
    (evidence) => { evidence.enforcement.pending_cap.limit = 32; },
    (evidence) => { evidence.enforcement.payout_ceiling_near = "5"; },
    (evidence) => { evidence.enforcement.stuck_allowance.callbacks = 32; },
    (evidence) => { evidence.enforcement.stuck_allowance.hours = 48; },
    (evidence) => { evidence.enforcement.contract_caps_pending_count = true; },
  ]) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(verifyEvidence(evidence).verdict, "FAIL");
  }
});

test("fails when the signer gas float is underfunded", () => {
  const evidence = validEvidence();
  evidence.gas_float.signers[1].balance_yocto = near("0.01");
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "FAIL");
  assert.ok(verdict.failures.some((line) => /signer gas float/.test(line)));
});

test("fails when the funding transactions are absent", () => {
  const evidence = validEvidence();
  evidence.buffer.funding_transactions = [];
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "UNKNOWN");
  assert.ok(verdict.problems.some((line) => /funding_transactions/.test(line)));
});

test("rejects a malformed NEAR amount", () => {
  assert.throws(() => nearToYocto("1.5 NEAR"), /not a NEAR amount/);
});

test("rejects the wrong schema", () => {
  const evidence = validEvidence();
  evidence.schema = "lcp.funding_buffer.measurement.v1";
  const verdict = verifyEvidence(evidence);
  assert.equal(verdict.verdict, "UNKNOWN");
  assert.ok(verdict.problems.some((line) => /schema/.test(line)));
});

test("template documents the verifier command", () => {
  const template = readFileSync("tests/canary-funding/funding-evidence.template.json", "utf8");
  assert.match(template, /verify-funding-evidence\.mjs/);
  assert.match(template, /CANARY-FUNDING-RUNBOOK/);
});
