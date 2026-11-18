// Funding-buffer calculator for pending callbacks.
//
// The design requires C >= H + planned_outflow while a callback is in flight,
// where H = S + N + Q + F (storage, native escrow, credit, refund liabilities).
// A safe operating buffer therefore has to cover the largest simultaneous set of
// in-flight payouts plus the storage and retained liabilities that outlive them.
//
// This script does not measure the chain. Every input is printed with its
// provenance so a value copied from a capture, a unit test, or a policy decision
// cannot be mistaken for a production recommendation.
//
// Usage:
//   node tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs \
//     --max-pending 64 --max-outflow-near 1 --storage-bytes 1024 \
//     --stuck-callbacks 4 [--margin 0.25] [--json out.json]
//
// Inputs:
//   --max-pending         maximum simultaneous pending payouts the operator will allow
//   --max-outflow-near    largest single outgoing transfer, in NEAR
//   --storage-bytes       measured worst-case bytes while a callback is pending
//   --retained-bytes      measured bytes retained after settlement (default: same)
//   --stuck-callbacks     callbacks allowed to remain unresolved indefinitely
//   --margin              extra fraction on top of the computed minimum (default 0.25)
//   --json                write the full result to a file

const STORAGE_PRICE_YOCTO_PER_BYTE = 10n ** 19n; // NEAR protocol storage price
const YOCTO_PER_NEAR = 10n ** 24n;
const GAS_PRICE_YOCTO_PER_GAS = 10n ** 8n; // 0.0001 NEAR per Tgas

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const nearToYocto = (value) => {
  const [whole, fraction = ""] = String(value).split(".");
  const padded = (fraction + "0".repeat(24)).slice(0, 24);
  return BigInt(whole || "0") * YOCTO_PER_NEAR + BigInt(padded || "0");
};
const yoctoToNear = (value) =>
  (Number(value) / Number(YOCTO_PER_NEAR)).toLocaleString("en-US", {
    maximumFractionDigits: 9,
  });

const maxPending = Number(flag("max-pending"));
const maxOutflowNear = Number(flag("max-outflow-near"));
const storageBytes = Number(flag("storage-bytes"));
const retainedBytes = Number(flag("retained-bytes") ?? flag("storage-bytes"));
const stuckCallbacks = Number(flag("stuck-callbacks"));
const margin = Number(flag("margin") ?? "0.25");

const missing = [
  ["--max-pending", maxPending],
  ["--max-outflow-near", maxOutflowNear],
  ["--storage-bytes", storageBytes],
  ["--retained-bytes", retainedBytes],
  ["--stuck-callbacks", stuckCallbacks],
].filter(([, value]) => !Number.isFinite(value) || value <= 0);
if (missing.length) {
  console.error(`missing or invalid inputs: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(2);
}

const outflowYocto = nearToYocto(maxOutflowNear);
const inFlightOutflow = outflowYocto * BigInt(maxPending);
const retainedOutflow = outflowYocto * BigInt(stuckCallbacks);
const pendingStorageYocto = BigInt(storageBytes) * STORAGE_PRICE_YOCTO_PER_BYTE;
const retainedStorageYocto = BigInt(retainedBytes) * STORAGE_PRICE_YOCTO_PER_BYTE;
const storageReserve =
  pendingStorageYocto * BigInt(maxPending) + retainedStorageYocto * BigInt(stuckCallbacks);
// Callback gas is prepaid by the transaction signer, not the contract balance.
// It is reported so the operator can size a separate gas/refund float.
const callbackGasTgas = 20n;
const gasFloatYocto = callbackGasTgas * 10n ** 12n * GAS_PRICE_YOCTO_PER_GAS * BigInt(maxPending);

const subtotal = inFlightOutflow + retainedOutflow + storageReserve;
const marginYocto = (subtotal * BigInt(Math.round(margin * 100))) / 100n;
const recommended = subtotal + marginYocto;

const inputs = [
  { name: "max simultaneous pending payouts", value: maxPending, unit: "callbacks", provenance: "policy input" },
  { name: "largest single outgoing transfer", value: maxOutflowNear, unit: "NEAR", provenance: "measured fixture (largest refund attach)" },
  { name: "bytes while a callback is pending", value: storageBytes, unit: "bytes", provenance: "caller-supplied measurement; the local USDC claim probe records 617 bytes" },
  { name: "bytes retained after settlement", value: retainedBytes, unit: "bytes", provenance: "caller-supplied measurement; the local success probe records 199 bytes" },
  { name: "indefinitely unresolved callbacks", value: stuckCallbacks, unit: "callbacks", provenance: "policy input" },
  { name: "safety margin", value: margin, unit: "fraction", provenance: "policy input" },
];

const result = {
  schema: "lcp.funding_buffer.measurement.v1",
  generated_at: new Date().toISOString(),
  status: "PRELIMINARY",
  status_reason:
    "pending-count, stuck-callback, and margin inputs are policy decisions; only the pending-callback storage byte count is measured",
  formula: "buffer = outflow*maxPending + outflow*stuckCallbacks + storagePrice*(pendingBytes*maxPending + retainedBytes*stuckCallbacks), plus margin",
  inputs,
  components: {
    in_flight_outflow_yocto: inFlightOutflow.toString(),
    retained_unknown_outflow_yocto: retainedOutflow.toString(),
    pending_storage_yocto: (pendingStorageYocto * BigInt(maxPending)).toString(),
    retained_storage_yocto: (retainedStorageYocto * BigInt(stuckCallbacks)).toString(),
    storage_reserve_yocto: storageReserve.toString(),
    subtotal_yocto: subtotal.toString(),
    margin_yocto: marginYocto.toString(),
    recommended_buffer_yocto: recommended.toString(),
    separate_gas_float_yocto: gasFloatYocto.toString(),
  },
  components_near: {
    in_flight_outflow: yoctoToNear(inFlightOutflow),
    retained_unknown_outflow: yoctoToNear(retainedOutflow),
    storage_reserve: yoctoToNear(storageReserve),
    subtotal: yoctoToNear(subtotal),
    margin: yoctoToNear(marginYocto),
    recommended_buffer: yoctoToNear(recommended),
    separate_gas_float: yoctoToNear(gasFloatYocto),
  },
  limits: [
    "This is an arithmetic model, not a network measurement.",
    "Gas is prepaid by the signer; the gas figure is a separate float, not contract cash.",
    "Delayed receipt timing on a public network still needs a measured value.",
  ],
};

console.log(JSON.stringify(result, null, 2));

const out = flag("json");
if (out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(out, JSON.stringify(result, null, 2));
}
