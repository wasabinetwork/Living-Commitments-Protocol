import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const wasmPath = resolve(
  repoRoot,
  process.env.LCP_RELEASE_WASM_PATH
    ?? "target/lcp-release-check/wasm32-unknown-unknown/release/lcp_core.wasm",
);
const outputPath = resolve(
  repoRoot,
  process.env.LCP_RELEASE_FEATURE_CAPTURE
    ?? "tests/sandbox-usdc-callbacks/release-feature-exclusion-2026-11-16.json",
);
const fixtureOnlyMethods = [
  "sandbox_mark_recovery_storage_price_stale",
  "sandbox_seed_recovery_credit_rows",
  "sandbox_recovery_storage_record_count",
];
const requiredProductionMethods = [
  "new",
  "get_effective_health",
  "revalue_recovery_storage_batch",
];

function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = alphabet[remainder] + encoded;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + encoded;
}

const wasm = await readFile(wasmPath);
const wasmModule = new WebAssembly.Module(wasm);
const exports = WebAssembly.Module.exports(wasmModule)
  .map((entry) => entry.name)
  .sort();
const fixtureExports = exports.filter((name) => name.startsWith("sandbox_"));
const missingProductionMethods = requiredProductionMethods
  .filter((name) => !exports.includes(name));
const presentFixtureMethods = fixtureOnlyMethods
  .filter((name) => exports.includes(name));

assert.deepEqual(missingProductionMethods, [],
  "the release artifact must expose required production entry points");
assert.deepEqual(fixtureExports, [],
  "the release artifact must not export Sandbox fixture methods");
assert.deepEqual(presentFixtureMethods, [],
  "fixture-only storage registry methods must not appear in the release ABI");

const wasmSha256 = createHash("sha256").update(wasm).digest();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const rustcVersion = execFileSync("rustc", ["--version"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const capture = {
  fixture_schema: "lcp.release-fixture-method-exclusion.v1",
  captured_at: new Date().toISOString(),
  source_commit: sourceCommit,
  build_command: "CARGO_TARGET_DIR=target/lcp-release-check cargo build --locked -p lcp-core --no-default-features --target wasm32-unknown-unknown --release",
  features: [],
  rustc_version: rustcVersion,
  wasm_path: relative(repoRoot, wasmPath),
  wasm_bytes: wasm.length,
  wasm_sha256: wasmSha256.toString("hex"),
  near_code_hash: base58Encode(wasmSha256),
  export_count: exports.length,
  fixture_only_methods_checked: fixtureOnlyMethods,
  fixture_only_exports: fixtureExports,
  required_production_methods: requiredProductionMethods,
  missing_production_methods: missingProductionMethods,
  exports,
};

await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`);
console.log(`PASS release Wasm excludes fixture methods: ${capture.wasm_sha256}`);
console.log(`WROTE release feature-boundary capture: ${relative(repoRoot, outputPath)}`);
