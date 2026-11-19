// Verifies the recorded canary funding/enforcement evidence against the
// owner-approved Decision 5 values.
//
// This does NOT query the chain and does NOT reimplement contract solvency. It
// checks that an operator's evidence file (the template is
// funding-evidence.template.json) is complete, internally consistent, and
// recomputes to the cited buffer and gas float. A PASS here means "the record
// cites funded and enforced values with the required evidence", not "the
// contract is solvent".
//
// Usage:
//   node tests/canary-funding/verify-funding-evidence.mjs <evidence.json> [--json out.json]
//
// Exit codes: 0 PASS, 1 FAIL, 2 UNKNOWN (evidence incomplete) or malformed input.

const YOCTO_PER_NEAR = 10n ** 24n;
const STORAGE_PRICE_YOCTO_PER_BYTE = 10n ** 19n;
const GAS_PRICE_YOCTO_PER_GAS = 10n ** 8n;
const TGAS = 10n ** 12n;

const APPROVED = {
  max_pending: 16,
  stuck_callbacks: 16,
  largest_payout_near: "1",
  storage_bytes: 617,
  retained_bytes: 617,
  margin_percent: 25,
  gas_tgas_per_callback: 40,
  stuck_allowance_hours: 24,
};

export function nearToYocto(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`not a NEAR amount: ${value}`);
  }
  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "0".repeat(24)).slice(0, 24);
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(padded || "0");
}

export function computeApprovedTotals(inputs) {
  const largest = nearToYocto(inputs.largest_payout_near);
  const maxPending = BigInt(inputs.max_pending);
  const stuck = BigInt(inputs.stuck_callbacks);
  const inFlight = largest * maxPending;
  const retained = largest * stuck;
  const storage = BigInt(inputs.storage_bytes) * STORAGE_PRICE_YOCTO_PER_BYTE * maxPending
    + BigInt(inputs.retained_bytes) * STORAGE_PRICE_YOCTO_PER_BYTE * stuck;
  const subtotal = inFlight + retained + storage;
  const margin = (subtotal * BigInt(inputs.margin_percent)) / 100n;
  const buffer = subtotal + margin;
  const gasFloat = BigInt(inputs.gas_tgas_per_callback) * TGAS * GAS_PRICE_YOCTO_PER_GAS
    * maxPending;
  return {
    in_flight_yocto: inFlight,
    retained_yocto: retained,
    storage_yocto: storage,
    subtotal_yocto: subtotal,
    margin_yocto: margin,
    buffer_yocto: buffer,
    gas_float_yocto: gasFloat,
  };
}

const isBlank = (value) => value === undefined || value === null || value === ""
  || (typeof value === "string" && /^tbd$/i.test(value.trim()));
const yoctoString = (value) => typeof value === "string" && /^\d+$/.test(value);

function requireField(problems, path, value, check = (v) => !isBlank(v)) {
  if (!check(value)) {
    problems.push(`${path} is missing, TBD, or invalid`);
    return false;
  }
  return true;
}

export function verifyEvidence(evidence) {
  const problems = [];
  const failures = [];
  // Incomplete evidence is UNKNOWN, not FAIL: the record simply cannot cite the
  // values yet. Arithmetic or consistency errors are FAIL: the record is wrong.
  if (evidence?.schema !== "lcp.canary_funding_evidence.v1") {
    problems.push("schema must be lcp.canary_funding_evidence.v1");
  }

  const inputs = evidence?.approved_inputs ?? {};
  const complete = [
    ["approved_inputs.max_pending", inputs.max_pending, (v) => Number.isInteger(v)],
    ["approved_inputs.stuck_callbacks", inputs.stuck_callbacks, (v) => Number.isInteger(v)],
    ["approved_inputs.largest_payout_near", inputs.largest_payout_near],
    ["approved_inputs.storage_bytes", inputs.storage_bytes, (v) => Number.isInteger(v)],
    ["approved_inputs.retained_bytes", inputs.retained_bytes, (v) => Number.isInteger(v)],
    ["approved_inputs.margin_percent", inputs.margin_percent, (v) => Number.isFinite(v)],
    ["approved_inputs.gas_tgas_per_callback", inputs.gas_tgas_per_callback,
      (v) => Number.isFinite(v)],
    ["approved_inputs.stuck_allowance_hours", inputs.stuck_allowance_hours,
      (v) => Number.isFinite(v)],
  ];
  let inputsComplete = true;
  for (const [path, value, check] of complete) {
    if (!requireField(problems, path, value, check)) inputsComplete = false;
  }

  let totals;
  if (inputsComplete) {
    totals = computeApprovedTotals(inputs);
    for (const [name, expected] of Object.entries(APPROVED)) {
      const actual = inputs[name];
      if (name === "largest_payout_near") {
        if (nearToYocto(actual) !== nearToYocto(expected)) {
          failures.push(`approved_inputs.${name} is ${actual}, approved value is ${expected}`);
        }
      } else if (Number(actual) !== Number(expected)) {
        failures.push(`approved_inputs.${name} is ${actual}, approved value is ${expected}`);
      }
    }
    const citedBuffer = evidence?.cited?.buffer_near;
    if (requireField(problems, "cited.buffer_near", citedBuffer)) {
      if (nearToYocto(citedBuffer) !== totals.buffer_yocto) {
        failures.push(`cited.buffer_near ${citedBuffer} does not recompute to the approved inputs`);
      }
    }
    const citedGas = evidence?.cited?.gas_float_near;
    if (requireField(problems, "cited.gas_float_near", citedGas)) {
      if (nearToYocto(citedGas) !== totals.gas_float_yocto) {
        failures.push(`cited.gas_float_near ${citedGas} does not recompute to the approved inputs`);
      }
    }
  }

  // Buffer funding evidence.
  const buffer = evidence?.buffer ?? {};
  const reserve = buffer.reserve ?? {};
  const liabilities = buffer.native_liabilities ?? {};
  const funding = Array.isArray(buffer.funding_transactions) ? buffer.funding_transactions : [];
  const bufferComplete = [
    ["buffer.liquid_balance_yocto", buffer.liquid_balance_yocto, yoctoString],
    ["buffer.headroom_yocto", buffer.headroom_yocto, yoctoString],
    ["buffer.snapshot_block.height", buffer.snapshot_block?.height,
      (v) => Number.isInteger(v) && v > 0],
    ["buffer.snapshot_block.hash", buffer.snapshot_block?.hash],
    ["buffer.state_export_sha256", buffer.state_export_sha256,
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)],
    ["buffer.reserve.status", reserve.status],
    ["buffer.reserve.ready", reserve.ready, (v) => typeof v === "boolean"],
    ["buffer.reserve.shortfall_yocto", reserve.shortfall_yocto, yoctoString],
    ["buffer.native_liabilities.escrow_yocto", liabilities.escrow_yocto, yoctoString],
    ["buffer.native_liabilities.credits_yocto", liabilities.credits_yocto, yoctoString],
    ["buffer.native_liabilities.storage_backing_yocto", liabilities.storage_backing_yocto,
      yoctoString],
    ["buffer.native_liabilities.complete", liabilities.complete,
      (v) => typeof v === "boolean"],
    ["buffer.gas_float_excluded", buffer.gas_float_excluded,
      (v) => typeof v === "boolean"],
  ].reduce((ok, entry) => requireField(problems, ...entry) && ok, true);

  if (bufferComplete) {
    if (!liabilities.complete) {
      problems.push("buffer.native_liabilities.complete is false; headroom cannot be attested");
    }
    if (!buffer.gas_float_excluded) {
      failures.push("buffer must exclude the signer gas float");
    }
    if (!reserve.ready) failures.push("recovery storage reserve is not ready");
    if (BigInt(reserve.shortfall_yocto) !== 0n) {
      failures.push(`recovery storage reserve reports a shortfall of ${reserve.shortfall_yocto}`);
    }
    const liabilitiesTotal = BigInt(liabilities.escrow_yocto)
      + BigInt(liabilities.credits_yocto)
      + BigInt(liabilities.storage_backing_yocto);
    const computedHeadroom = BigInt(buffer.liquid_balance_yocto) - liabilitiesTotal;
    if (computedHeadroom !== BigInt(buffer.headroom_yocto)) {
      failures.push(
        `headroom ${buffer.headroom_yocto} != liquid balance minus escrow, credits, and backing (${computedHeadroom})`,
      );
    }
    if (funding.length === 0) {
      problems.push("buffer.funding_transactions must record at least one finalized transfer");
    }
    for (const [index, tx] of funding.entries()) {
      requireField(problems, `buffer.funding_transactions[${index}].hash`, tx?.hash);
      requireField(problems, `buffer.funding_transactions[${index}].amount_yocto`,
        tx?.amount_yocto, yoctoString);
      requireField(problems, `buffer.funding_transactions[${index}].finalized_block_height`,
        tx?.finalized_block_height, (v) => Number.isInteger(v) && v > 0);
    }
    if (totals && BigInt(buffer.headroom_yocto) < totals.buffer_yocto) {
      failures.push(
        `headroom ${buffer.headroom_yocto} is below the approved buffer ${totals.buffer_yocto}`,
      );
    }
  }

  // Operational enforcement evidence.
  const enforcement = evidence?.enforcement ?? {};
  const pendingCap = enforcement.pending_cap ?? {};
  const payoutCeiling = enforcement.payout_ceiling_near;
  const stuck = enforcement.stuck_allowance ?? {};
  const enforcementComplete = [
    ["enforcement.pending_cap.limit", pendingCap.limit, (v) => Number.isInteger(v)],
    ["enforcement.pending_cap.control", pendingCap.control],
    ["enforcement.pending_cap.alert_owner", pendingCap.alert_owner],
    ["enforcement.payout_ceiling_near", payoutCeiling],
    ["enforcement.stuck_allowance.hours", stuck.hours, (v) => Number.isFinite(v)],
    ["enforcement.stuck_allowance.callbacks", stuck.callbacks, (v) => Number.isInteger(v)],
    ["enforcement.stuck_allowance.correlation_assumption", stuck.correlation_assumption],
    ["enforcement.operator_acknowledged_by", enforcement.operator_acknowledged_by],
    ["enforcement.contract_caps_pending_count", enforcement.contract_caps_pending_count,
      (v) => typeof v === "boolean"],
  ].reduce((ok, entry) => requireField(problems, ...entry) && ok, true);

  if (enforcementComplete) {
    if (pendingCap.limit > APPROVED.max_pending) {
      failures.push(
        `enforcement.pending_cap.limit ${pendingCap.limit} exceeds the approved cap ${APPROVED.max_pending}`,
      );
    }
    if (nearToYocto(payoutCeiling) > nearToYocto(APPROVED.largest_payout_near)) {
      failures.push(
        `enforcement.payout_ceiling_near ${payoutCeiling} exceeds the approved 1 NEAR ceiling`,
      );
    }
    if (stuck.callbacks > APPROVED.stuck_callbacks) {
      failures.push(
        `enforcement.stuck_allowance.callbacks ${stuck.callbacks} exceeds the approved ${APPROVED.stuck_callbacks}`,
      );
    }
    if (Number(stuck.hours) > APPROVED.stuck_allowance_hours) {
      failures.push(
        `enforcement.stuck_allowance.hours ${stuck.hours} exceeds the approved ${APPROVED.stuck_allowance_hours} h`,
      );
    }
    if (enforcement.contract_caps_pending_count) {
      failures.push(
        "enforcement.contract_caps_pending_count must be false; the controlled contract does not cap pending payouts",
      );
    }
  }

  // Gas float evidence.
  const gas = evidence?.gas_float ?? {};
  const signers = Array.isArray(gas.signers) ? gas.signers : [];
  const gasComplete = [
    ["gas_float.monitored_separately", gas.monitored_separately,
      (v) => typeof v === "boolean"],
    ["gas_float.monitoring", gas.monitoring],
  ].reduce((ok, entry) => requireField(problems, ...entry) && ok, true);

  if (gasComplete) {
    if (!gas.monitored_separately) failures.push("gas float must be monitored separately");
    if (signers.length === 0) problems.push("gas_float.signers must name the funded signers");
    let gasTotal = 0n;
    for (const [index, signer] of signers.entries()) {
      requireField(problems, `gas_float.signers[${index}].account`, signer?.account);
      requireField(problems, `gas_float.signers[${index}].balance_yocto`,
        signer?.balance_yocto, yoctoString);
      if (yoctoString(signer?.balance_yocto)) gasTotal += BigInt(signer.balance_yocto);
    }
    if (totals && gasTotal < totals.gas_float_yocto) {
      failures.push(
        `signer gas float ${gasTotal} is below the approved ${totals.gas_float_yocto}`,
      );
    }
  }

  const verdict = failures.length ? "FAIL" : problems.length ? "UNKNOWN" : "PASS";
  return {
    schema: "lcp.canary_funding_verdict.v1",
    verdict,
    cited_buffer_near: evidence?.cited?.buffer_near,
    cited_gas_float_near: evidence?.cited?.gas_float_near,
    recomputed: totals
      ? {
        buffer_yocto: totals.buffer_yocto.toString(),
        gas_float_yocto: totals.gas_float_yocto.toString(),
      }
      : null,
    failures,
    problems,
    note: verdict === "PASS"
      ? "Evidence is complete and consistent with the approved inputs. This validates the record, not chain solvency."
      : verdict === "UNKNOWN"
      ? "Evidence is incomplete; the canary record must not cite the buffer or gas float as satisfied."
      : "Evidence is inconsistent with the approved inputs or limits; correct the record and re-run.",
  };
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node tests/canary-funding/verify-funding-evidence.mjs <evidence.json>");
    process.exit(2);
  }
  let verdict;
  try {
    verdict = verifyEvidence(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    console.error(`cannot read evidence: ${error.message}`);
    process.exit(2);
  }
  console.log(JSON.stringify(verdict, null, 2));
  const jsonIndex = process.argv.indexOf("--json");
  if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
    writeFileSync(process.argv[jsonIndex + 1], `${JSON.stringify(verdict, null, 2)}\n`);
  }
  process.exit(verdict.verdict === "PASS" ? 0 : verdict.verdict === "FAIL" ? 1 : 2);
}
