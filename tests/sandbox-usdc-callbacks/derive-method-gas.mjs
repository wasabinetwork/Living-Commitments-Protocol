// Derive per-method prepaid-gas floors from committed Sandbox captures.
//
// Gate 5 asks for "method gas limits from measured worst cases plus margin".
// This script does not measure anything: it reads the gas figures the pinned
// captures already record, takes the maximum per method, and applies a margin.
// Methods with no committed worst-case capture are reported as unmeasured so a
// provisional policy value cannot be mistaken for a derived limit.
//
// Usage:
//   node tests/sandbox-usdc-callbacks/derive-method-gas.mjs \
//     [--margin 1.5] [--json target/method-gas-floors.json]
//
// Gas figures are in gas units; the table is printed in Tgas.

import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const margin = Number(flag("margin") ?? "1.5");

const captureDir = "recovery-acceptance-2026-11-17-689fbf1";
const capture = (name) =>
  JSON.parse(readFileSync(new URL(`./${captureDir}/${name}`, import.meta.url), "utf8"));

// Only fields that a pinned capture actually records are listed. `receipt` is
// the outer call receipt; the callback/settlement gas is not part of it.
const measured = [
  {
    method: "recover_nep141_transfer",
    shape: "maximum valid envelope, 5-of-5 signatures",
    file: "recovery.json",
    scenario: "five_of_five_certificate",
    field: "recovery_receipt_gas_burnt",
  },
  {
    method: "recover_nep141_transfer",
    shape: "4-of-5 signatures",
    file: "recovery.json",
    scenario: "certificate_first",
    field: "recovery_receipt_gas_burnt",
  },
  {
    method: "recover_nep141_transfer",
    shape: "parser probe, maximum envelope (fixture-only)",
    file: "recovery.json",
    scenario: "maximum_size_positive_contract_envelope",
    field: "receipt_gas_burnt",
  },
  {
    method: "bootstrap_receipt_recovery",
    shape: "bootstrap receipt",
    file: "recovery.json",
    scenario: "bootstrap",
    field: "receipts_outcome[0].outcome.gas_burnt",
  },
  {
    method: "revalue_recovery_storage_batch",
    shape: "64-row revaluation batch",
    file: "storage-registry-cap.json",
    scenario: "storage_registry_acceptance",
    field: "maximum_revaluation_batch_gas_burnt",
  },
  {
    method: "revalue_recovery_storage_batch",
    shape: "64-row retry after OOG rollback",
    file: "storage-oog.json",
    scenario: "storage_registry_oog_acceptance",
    field: "retry_gas_burnt",
  },
];

const unmeasured = [
  {
    method: "release_usdc_certificate_quarantine",
    reason: "no capture records the outer receipt gas for a release call",
  },
  {
    method: "propose/cancel/activate_usdc_code_hash_change",
    reason: "the governance capture records hashes and timestamps, not gas",
  },
  {
    method: "finalize_receipt_recovery_intent",
    reason: "captures record the finalization transaction, not its gas",
  },
  {
    method: "finalize_receipt_recovery_credit",
    reason: "captures record the credit closure, not its gas",
  },
  {
    method: "withdraw_receipt_recovery_credit",
    reason: "the OOG fixture records only the deliberately underfunded 1 Tgas callback",
  },
  {
    method: "retire_receipt_recovery_epoch",
    reason: "not exercised by a capture",
  },
];

const read = (object, path) =>
  path.split(".").reduce((value, key) => {
    const match = key.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      return value?.[match[1]]?.[Number(match[2])];
    }
    return value?.[key];
  }, object);

const percent = BigInt(Math.round(margin * 100));
const ceilDiv = (a, b) => (a + b - 1n) / b;

const rows = [];
for (const entry of measured) {
  const value = read(capture(entry.file), `scenarios.${entry.scenario}.${entry.field}`);
  if (typeof value !== "string" && typeof value !== "number") {
    console.error(`missing gas value: ${entry.file} ${entry.scenario} ${entry.field}`);
    process.exit(2);
  }
  const burnt = BigInt(value);
  const derived = ceilDiv(burnt * percent, 100n * 10n ** 12n);
  rows.push({ ...entry, gas_burnt: burnt.toString(), derived_tgas: Number(derived) });
}

const byMethod = new Map();
for (const row of rows) {
  const current = byMethod.get(row.method);
  if (!current || row.derived_tgas > current.derived_tgas) {
    byMethod.set(row.method, row);
  }
}

const methods = [...byMethod.values()].map((row) => ({
  method: row.method,
  worst_shape: row.shape,
  evidence: `${captureDir}/${row.file} -> scenarios.${row.scenario}.${row.field}`,
  max_observed_tgas: Number(row.gas_burnt) / 1e12,
  margin,
  derived_floor_tgas: row.derived_tgas,
}));

const result = {
  schema: "lcp.method_gas_floors.v1",
  capture_set: captureDir,
  margin,
  status: "PARTIAL",
  status_reason:
    "derived floors cover the methods with a committed worst-case capture; the unmeasured methods keep their provisional policy values",
  methods,
  unmeasured,
};

for (const method of methods) {
  console.log(
    `${method.method.padEnd(34)} max ${method.max_observed_tgas.toFixed(3)} Tgas ` +
      `x${margin} -> ${method.derived_floor_tgas} Tgas  (${method.worst_shape})`,
  );
}
for (const item of unmeasured) {
  console.log(`${item.method.padEnd(34)} unmeasured: ${item.reason}`);
}

const out = flag("json");
if (out) {
  writeFileSync(out, JSON.stringify(result, null, 2));
}
