import { readFile } from "node:fs/promises";

const committedDir = "tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1";
const newDir = "tests/sandbox-usdc-callbacks/owner-rerun-2026-11-19-689fbf1";
const names = ["storage-shape", "usdc-claim", "usdc-refund"];

function walk(a, b, path, out) {
  if (a === b) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) out.push({ path, kind: "keys", a: ka.join(), b: kb.join() });
    for (const k of ka) if (k in b) walk(a[k], b[k], `${path}.${k}`, out);
    return;
  }
  out.push({ path, kind: typeof a === "number" || typeof b === "string" ? "value" : "other", a, b });
}

// categories of fields the handoff doc says may differ
const EXPECTED = [
  /receipt|transaction|outcome/i,
  /hash|height/i,
  /balance|storage_usage|gas_burnt|gas_used|tokens_burnt/i,
  /committee|key|nonce/i,
  /activation|captured_at|_at_ns|timestamp/i,
  /account_id|executor|predecessor|receiver/i,
  /args|input|signature|public_key|logs|actions/i,
  /_id|id$/i,
  /storage_bytes|_byte_cost|shortfall|liability|margin|storage_used/i,
];

for (const name of names) {
  const ca = JSON.parse(await readFile(`${committedDir}/${name}.json`, "utf8"));
  const cb = JSON.parse(await readFile(`${newDir}/${name}.json`, "utf8"));
  const diffs = [];
  walk(ca, cb, "", diffs);
  console.log(`\n## ${name}.json  (schema ${ca.fixture_schema} == ${cb.fixture_schema}, ` +
    `scenarios ${Object.keys(ca.scenarios).length} vs ${Object.keys(cb.scenarios).length})`);
  const leftover = [];
  for (const d of diffs) {
    const keyPath = d.path.split(".").filter((p) => !/^\d+$/.test(p)).join(".");
    if (EXPECTED.some((re) => re.test(keyPath))) continue;
    leftover.push({ ...d, keyPath });
  }
  console.log(`diffs total ${diffs.length}; unexplained after classification ${leftover.length}`);
  for (const d of leftover) console.log(`  ! ${d.keyPath} :: ${JSON.stringify(d.a)} -> ${JSON.stringify(d.b)}`);
}
