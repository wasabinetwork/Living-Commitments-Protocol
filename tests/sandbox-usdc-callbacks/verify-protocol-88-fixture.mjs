import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const verifierArgs = process.argv.slice(2);
assert.ok(verifierArgs.length === 0 || verifierArgs.length === 2,
  "usage: node verify-protocol-88-fixture.mjs [<repo-relative-capture> <repo-relative-source-manifest>]");
const fixturePath = verifierArgs.length === 2
  ? resolve(repoRoot, verifierArgs[0])
  : join(here, "recovery-acceptance-2026-11-17-18ed543/protocol-88.json");
const manifestPath = verifierArgs.length === 2
  ? resolve(repoRoot, verifierArgs[1])
  : join(here, "p2-usdc-recovery-local-acceptance-2026-11-17.sha256");
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(text, label) {
  let value = 0n;
  for (const character of text) {
    const digit = base58Alphabet.indexOf(character);
    assert.notEqual(digit, -1, `${label} contains an invalid base58 character`);
    value = value * 58n + BigInt(digit);
  }
  const body = value === 0n
    ? Buffer.alloc(0)
    : Buffer.from(value.toString(16).padStart(Math.ceil(value.toString(16).length / 2) * 2, "0"), "hex");
  let leadingZeroes = 0;
  while (text[leadingZeroes] === "1") leadingZeroes += 1;
  const decoded = Buffer.concat([Buffer.alloc(leadingZeroes), body]);
  assert.equal(decoded.length, 32, `${label} must encode a 32-byte hash`);
  assert.equal(encodeBase58(decoded), text, `${label} must use canonical base58`);
  return decoded;
}

function encodeBase58(bytes) {
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let result = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    result = base58Alphabet[digit] + result;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return "1".repeat(leadingZeroes) + result;
}

function assertSuccess(status, label) {
  assert.equal(Object.keys(status).length, 1, `${label} must have one terminal status`);
  assert.ok(Object.hasOwn(status, "SuccessValue"), `${label} must succeed`);
}

function assertFailure(status, label) {
  assert.equal(Object.keys(status).length, 1, `${label} must have one terminal status`);
  assert.ok(Object.hasOwn(status, "Failure"), `${label} must fail`);
}

function assertReceiptBundles(scenarios) {
  let receiptsChecked = 0;
  for (const [scenarioName, scenario] of Object.entries(scenarios)) {
    const receipts = scenario.receipts_outcome;
    if (!Array.isArray(receipts)) continue;
    decodeBase58(scenario.outer_transaction_hash ?? scenario.transaction_hash, `${scenarioName} transaction hash`);
    const ids = new Set();
    for (const receipt of receipts) {
      decodeBase58(receipt.id, `${scenarioName} receipt ID`);
      decodeBase58(receipt.block_hash, `${scenarioName} receipt block hash`);
      assert.ok(!ids.has(receipt.id), `${scenarioName} contains a duplicate receipt ID`);
      ids.add(receipt.id);
      assert.ok(receipt.outcome && typeof receipt.outcome.executor_id === "string");
      assert.ok(Number.isSafeInteger(receipt.outcome.gas_burnt) && receipt.outcome.gas_burnt >= 0);
      assert.ok(Array.isArray(receipt.outcome.receipt_ids));
      assert.ok(Array.isArray(receipt.proof));
      for (const proofNode of receipt.proof) {
        assert.ok(proofNode.direction === "Left" || proofNode.direction === "Right");
        decodeBase58(proofNode.hash, `${scenarioName} receipt proof hash`);
      }
      assert.equal(Object.keys(receipt.outcome.status).length, 1,
        `${scenarioName} receipt must have one terminal status`);
      receiptsChecked += 1;
    }
  }
  return receiptsChecked;
}

async function verifySourceManifest() {
  const manifest = await readFile(manifestPath, "utf8");
  let filesChecked = 0;
  for (const line of manifest.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match, `malformed source manifest row: ${line}`);
    const [, expectedDigest, relativePath] = match;
    const bytes = await readFile(join(repoRoot, relativePath));
    const observedDigest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(observedDigest, expectedDigest, `${relativePath} does not match its manifest digest`);
    filesChecked += 1;
  }
  assert.ok(filesChecked > 0, "source manifest must not be empty");
  return filesChecked;
}

async function main() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(fixture.fixture_schema, "lcp.protocol-88-receipt-rollback.v1");
  assert.equal(fixture.node.sandbox_version, "2.14.0");
  assert.equal(fixture.node.protocol_version, 88);
  assert.equal(fixture.node.version.commit, "bc4e9e8cfb03d9e82f027883055624e18576993e");
  decodeBase58(fixture.node.genesis_hash, "Sandbox genesis hash");

  const coreArtifact = fixture.wasm_artifacts.lcp_core_fixture;
  const tokenA = fixture.wasm_artifacts.mock_ft_variant_a;
  const tokenB = fixture.wasm_artifacts.mock_ft_variant_b;
  for (const [label, artifact] of [["core", coreArtifact], ["token A", tokenA], ["token B", tokenB]]) {
    assert.match(artifact.wasm_sha256, /^[a-f0-9]{64}$/);
    const codeHash = decodeBase58(artifact.near_code_hash, `${label} NEAR code hash`);
    assert.equal(codeHash.toString("hex"), artifact.wasm_sha256,
      `${label} NEAR code hash must be base58(SHA-256(WASM))`);
  }

  const scenarios = fixture.scenarios;
  assert.equal(scenarios.core_deploy_transaction.near_code_hash, coreArtifact.near_code_hash);
  assert.equal(scenarios.action_order_code_hashes.variant_a, tokenA.near_code_hash);
  assert.equal(scenarios.action_order_code_hashes.variant_b, tokenB.near_code_hash);

  for (const name of ["pre_execution_failure", "post_mutation_failure"]) {
    const escrow = scenarios[name].escrow;
    const funded = BigInt(escrow.funded_raw);
    assert.equal(
      funded,
      BigInt(escrow.paid_raw) + BigInt(escrow.refunded_raw)
        + BigInt(escrow.pending_raw) + BigInt(escrow.free_raw),
      `${name} violates raw-token escrow conservation`,
    );
    assert.equal(escrow.pending_raw, "0", `${name} must reconcile the failed transfer`);
    assert.equal(escrow.paid_raw, "0", `${name} must not pay the recipient`);
    assert.equal(escrow.free_raw, escrow.funded_raw, `${name} must restore all raw units to free escrow`);
    assert.equal(scenarios[name].token_balances_after["recipient.sandbox"],
      scenarios[name].token_balances_before.recipient,
      `${name} changed the recipient token balance`);
    assert.equal(scenarios[name].token_balances_after["lcp-core-sandbox.sandbox"],
      scenarios[name].token_balances_before.sender,
      `${name} changed the core token balance`);
  }

  const preExecutionReceipts = scenarios.pre_execution_failure.receipts_outcome;
  const noCodeFailure = preExecutionReceipts.find((receipt) => receipt.outcome.executor_id === "no-code-token.sandbox");
  assert.ok(noCodeFailure, "pre-execution failure receipt must be present");
  assertFailure(noCodeFailure.outcome.status, "missing-token-code receipt");
  assert.equal(
    noCodeFailure.outcome.status.Failure.ActionError.kind.FunctionCallError.CompilationError.CodeDoesNotExist.account_id,
    "no-code-token.sandbox",
  );

  const postMutationReceipts = scenarios.post_mutation_failure.receipts_outcome;
  const tokenTrap = postMutationReceipts.find((receipt) => receipt.outcome.executor_id === "mock-usdc.sandbox");
  assert.ok(tokenTrap, "post-mutation token receipt must be present");
  assertFailure(tokenTrap.outcome.status, "post-mutation token receipt");
  assert.match(tokenTrap.outcome.status.Failure.ActionError.kind.FunctionCallError.ExecutionError, /unreachable/);
  assert.equal(tokenTrap.outcome.metadata.contracts[0].local, tokenA.near_code_hash,
    "the trapping token receipt must execute the pinned variant A code");

  const successfulReceipts = scenarios.successful_control.receipts_outcome;
  const successfulToken = successfulReceipts.find((receipt) => receipt.outcome.executor_id === "mock-usdc.sandbox");
  assert.ok(successfulToken, "successful control must include a token receipt");
  assertSuccess(successfulToken.outcome.status, "successful token receipt");
  assert.equal(successfulToken.outcome.metadata.contracts[0].local,
    scenarios.successful_control.expected_token_code_hash);

  const transferThenDeploy = scenarios.action_order_transfer_then_deploy.observed_contract_metadata;
  const deployThenTransfer = scenarios.action_order_deploy_then_transfer.observed_contract_metadata;
  assert.deepEqual(transferThenDeploy.map((entry) => entry.local), [tokenA.near_code_hash, tokenA.near_code_hash]);
  assert.deepEqual(deployThenTransfer.map((entry) => entry.local), [tokenA.near_code_hash, tokenB.near_code_hash]);

  const exactCash = scenarios.native_cash_gate.exact_balance.receipt_measurements;
  const balanceAfterBuilder = exactCash.balance_after_sdk_builder ?? exactCash.balance_after_promise;
  const balanceAfterMaterialization = exactCash.balance_after_host_materialization
    ?? exactCash.balance_after_materialization;
  assert.equal(balanceAfterBuilder, exactCash.balance_before,
    "lazy Promise construction must not materialize the transfer");
  assert.equal(BigInt(exactCash.storage_cost) + BigInt(exactCash.liability) + 1n,
    BigInt(exactCash.balance_before), "exact cash boundary must include the required outflow");
  assert.equal(BigInt(balanceAfterMaterialization), BigInt(exactCash.balance_before) - 1n,
    "host materialization must deduct the exact one-yocto transfer outflow");

  const receiptsChecked = assertReceiptBundles(scenarios);
  const filesChecked = await verifySourceManifest();
  console.log(`PASS protocol-88 capture integrity: ${filesChecked} source hashes, ${receiptsChecked} receipt records, code digests, rollback, conservation, and action order`);
  console.log("LIMITATION: validates captured artifact consistency; it does not independently recreate the Sandbox run or verify Merkle proofs against block headers.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
