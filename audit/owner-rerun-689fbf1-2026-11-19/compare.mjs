import { readFile } from "node:fs/promises";

const committedDir = "tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1";
const newDir = "tests/sandbox-usdc-callbacks/owner-rerun-2026-11-19-689fbf1";
const names = ["protocol-88", "recovery", "bootstrap-guard", "storage-oog",
  "storage-registry-cap", "storage-shape", "usdc-claim", "usdc-refund"];

const VOLATILE_KEY = /(^captured_at$|_hash$|_hashes$|hash$|_height$|^height$|block_height|balance|storage_usage|storage_used|^timestamp$|_at$|nonce|_id$|^id$|signature|public_key|observed_byte_cost_yocto|shortfall_yocto|deposit_yocto|gas_burnt|gas_used|tokens_burnt|executor_id|predecessor_id|receiver_id|account_id|chain_id|genesis_hash|latest_block_hash|epoch_id|receipt_id|outcome|proof|logs|input|args_base64|actions|receipts|transaction|block_hash)/;

function walk(a, b, path, out, keyCtx) {
  if (a === b) return;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb || (a === null) !== (b === null)) {
    out.push({ path, kind: "type", a, b });
    return;
  }
  if (a && typeof a === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) {
      out.push({ path, kind: "keys", a: ka.join(), b: kb.join() });
    }
    for (const k of ka) if (k in b) walk(a[k], b[k], `${path}.${k}`, out, k);
    return;
  }
  out.push({ path, kind: "value", a, b, key: keyCtx });
}

for (const name of names) {
  const ca = JSON.parse(await readFile(`${committedDir}/${name}.json`, "utf8"));
  const cb = JSON.parse(await readFile(`${newDir}/${name}.json`, "utf8"));
  const diffs = [];
  walk(ca, cb, "", diffs, null);
  const schemaSame = ca.fixture_schema === cb.fixture_schema;
  const wasmSame = JSON.stringify(ca.wasm_artifacts) === JSON.stringify(cb.wasm_artifacts);
  const scenA = Object.keys(ca.scenarios ?? {}).sort();
  const scenB = Object.keys(cb.scenarios ?? {}).sort();
  const scenSame = scenA.join("|") === scenB.join("|");
  const nodeA = ca.node ?? {}, nodeB = cb.node ?? {};
  const nodeCoreSame = nodeA.sandbox_version === nodeB.sandbox_version
    && nodeA.protocol_version === nodeB.protocol_version
    && JSON.stringify(nodeA.version) === JSON.stringify(nodeB.version);
  const unexplained = diffs.filter((d) => !VOLATILE_KEY.test(d.path.split(".").pop() ?? ""));
  console.log(`\n## ${name}.json`);
  console.log(`fixture_schema equal: ${schemaSame} (${ca.fixture_schema})`);
  console.log(`wasm_artifacts equal: ${wasmSame}`);
  console.log(`scenario name sets equal: ${scenSame} (${scenA.length} scenarios)`);
  console.log(`node sandbox/protocol/nearcore equal: ${nodeCoreSame}`);
  console.log(`total differing leaf paths: ${diffs.length}; outside volatile-key filter: ${unexplained.length}`);
  for (const d of unexplained.slice(0, 25)) {
    console.log(`  ! ${d.path} :: ${JSON.stringify(d.a)} -> ${JSON.stringify(d.b)}`);
  }
  if (name === "storage-shape") {
    console.log("  storage-shape committed measured_credit_storage_bytes:",
      ca.scenarios?.shape?.measured_credit_storage_bytes, "new:",
      cb.scenarios?.shape?.measured_credit_storage_bytes);
  }
}
