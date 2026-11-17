// Probes the capture/source manifest verification machinery (verifyManifest) in
// verify-native-excess-refund-capture.mjs against scratch copies under
// audit/excess-refund-e2-review-2026-11-17-independent/scratch.
import assert from "node:assert/strict";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scratch = `${here}/scratch`;
const repoRoot = `${here}/../..`;

function run(capturePath, manifestPath) {
  const res = spawnSync("node", [
    "tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs",
    capturePath, manifestPath,
  ], { cwd: repoRoot, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout.trim(), stderr: res.stderr.trim() };
}

// 1. Tampered capture: flip one byte of the scratch capture copy -> manifest hash mismatch.
await copyFile(`${scratch}/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json`,
  `${scratch}/tampered.json`);
let buf = await readFile(`${scratch}/tampered.json`);
buf = Buffer.concat([buf.subarray(0, 100), Buffer.from([buf[100] ^ 0x01]), buf.subarray(101)]);
await writeFile(`${scratch}/tampered.json`, buf);
await copyFile(`${scratch}/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256`,
  `${scratch}/tampered.sha256`);
const tamper = run("audit/excess-refund-e2-review-2026-11-17-independent/scratch/tampered.json",
  "audit/excess-refund-e2-review-2026-11-17-independent/scratch/tampered.sha256");

// 2. Tooling manifest supplied as the source manifest: the capture must not be pinned there.
const toolingAsSource = run(
  "tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json",
  "tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.tooling.sha256");

// 3. Escaping path in the manifest -> must be rejected before reading the file.
await writeFile(`${scratch}/escape.sha256`,
  "00".repeat(32) + "  ../outside.js\n");
const escape = run(
  "tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json",
  "audit/excess-refund-e2-review-2026-11-17-independent/scratch/escape.sha256");

// 4. Malformed checksum row -> rejected.
await writeFile(`${scratch}/malformed.sha256`, "not-a-checksum  some/path\n");
const malformed = run(
  "tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json",
  "audit/excess-refund-e2-review-2026-11-17-independent/scratch/malformed.sha256");

console.log(`TAMPERED capture file: exit=${tamper.status}`);
console.log(`   ${tamper.stderr.split("\n").find((l) => l.includes("does not match")) ?? tamper.stderr}`);
console.log(`TOOLING manifest as source: exit=${toolingAsSource.status}`);
console.log(`   ${toolingAsSource.stderr.split("\n").find((l) => l.includes("must pin")) ?? toolingAsSource.stderr}`);
console.log(`ESCAPING path row: exit=${escape.status}`);
console.log(`   ${escape.stderr.split("\n").find((l) => l.includes("escapes")) ?? escape.stderr}`);
console.log(`MALFORMED row: exit=${malformed.status}`);
console.log(`   ${malformed.stderr.split("\n").find((l) => l.includes("malformed checksum")) ?? malformed.stderr}`);
