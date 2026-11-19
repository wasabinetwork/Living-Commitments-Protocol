import { readFile } from "node:fs/promises";

// Investigation aid: compare the committed 689fbf1 captures with the 2026-11-19
// owner-machine rerun and drop only the field classes the handoff document lists
// as expected to differ (chain identity, transaction/receipt/block identifiers,
// account balances and storage-dependent numbers, key material, timestamps).
// Empty result means every non-volatile field is identical.
const committedDir = "tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1";
const newDir = "audit/owner-rerun-689fbf1-2026-11-19/captures";
const names = ["protocol-88", "recovery", "bootstrap-guard", "storage-oog",
  "storage-registry-cap", "storage-shape", "usdc-claim", "usdc-refund"];

const VOLATILE = new RegExp([
  "receipt", "transaction", "outcome", "hash", "height", "balance", "storage_usage",
  "committee", "public_key", "private_key", "nonce", "signature", "args", "input",
  "account", "executor", "predecessor", "receiver", "logs", "captured_at", "^at$",
  "activation", "timestamp", "native_cash", "cash_snapshot", "liability", "margin",
  "byte_cost", "shortfall", "storage_used", "gas", "tokens_burnt", "intent_base64",
  "intent_digest", "digest$", "fee_yocto", "^id$", "_id$", "epoch_id", "chain_id",
  "genesis", "block", "status$", "success_value",
].join("|"), "i");

function strip(value, path = "") {
  if (Array.isArray(value)) return value.map((v, i) => strip(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (VOLATILE.test(k)) continue;
      out[k] = strip(v, `${path}.${k}`);
    }
    return out;
  }
  return value;
}

let totalScenarios = 0, equalScenarios = 0;
for (const name of names) {
  const ca = JSON.parse(await readFile(`${committedDir}/${name}.json`, "utf8"));
  const cb = JSON.parse(await readFile(`${newDir}/${name}.json`, "utf8"));
  const sameSchema = ca.fixture_schema === cb.fixture_schema;
  const sameWasm = JSON.stringify(ca.wasm_artifacts) === JSON.stringify(cb.wasm_artifacts);
  const ka = Object.keys(ca.scenarios ?? {}).sort();
  const kb = Object.keys(cb.scenarios ?? {}).sort();
  const sameScenarios = ka.join("|") === kb.join("|");
  let ok = 0;
  const bad = [];
  for (const key of ka) {
    totalScenarios += 1;
    if (JSON.stringify(strip(ca.scenarios[key])) === JSON.stringify(strip(cb.scenarios[key]))) {
      ok += 1; equalScenarios += 1;
    } else {
      bad.push(key);
    }
  }
  console.log(`${name}.json: schema=${sameSchema} wasm_artifacts=${sameWasm} ` +
    `scenario_names=${sameScenarios} (${ka.length}) nonvolatile_scenarios_equal=${ok}/${ka.length}` +
    (bad.length ? ` differs: ${bad.join(", ")}` : ""));
}
console.log(`TOTAL non-volatile scenario payloads equal: ${equalScenarios}/${totalScenarios}`);
