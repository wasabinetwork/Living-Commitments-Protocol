import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify(execFileCallback);
const probeTool = resolve("evaluators/service-availability/probe.mjs");

function publicKeyHex(key) {
  return key.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
}

test("request assembler emits the contract v3 evaluator shape and report digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lcp-service-probe-test-"));
  try {
    const keyPairs = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
    const policy = {
      schema: "lcp.service_availability.policy.v1",
      target_id: "a".repeat(64),
      max_source_lag_ns: "30000000000",
      expected_status_min: 200,
      expected_status_max: 299,
      max_latency_ms: 1_500,
      minimum_agreeing_sources: 2,
      minimum_corroboration_bps: 10_000,
      sources: keyPairs.map((pair, index) => ({
        source_id: `source-${index}`,
        operator_id: `operator-${index}`,
        public_key_hex: publicKeyHex(pair.publicKey),
      })),
    };
    const sourcePolicyHash = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
    const metadata = {
      contract_id: "lcp.testnet",
      commitment_id: "9",
      evaluation_id: "2",
      policy_hash: "b".repeat(64),
      requested_at_ns: "2000000000",
      subject: "Community API availability",
    };
    const reports = keyPairs.map((pair, index) => {
      const payload = {
        schema: "lcp.service_availability.report.v1",
        contract_id: metadata.contract_id,
        commitment_id: metadata.commitment_id,
        evaluation_id: metadata.evaluation_id,
        policy_version: 3,
        policy_hash: metadata.policy_hash,
        source_policy_hash: sourcePolicyHash,
        source_id: `source-${index}`,
        operator_id: `operator-${index}`,
        target_id: policy.target_id,
        observed_at_ns: "1990000000",
        observation: { kind: "http_response", status_code: 200, latency_ms: 40, tls_verified: true },
      };
      return {
        payload,
        signature_hex: sign(null, Buffer.from(JSON.stringify(payload)), pair.privateKey).toString("hex"),
      };
    });

    const metadataPath = join(directory, "metadata.json");
    const policyPath = join(directory, "policy.json");
    const reportPaths = [join(directory, "source-a.json"), join(directory, "source-b.json")];
    await writeFile(metadataPath, JSON.stringify(metadata));
    await writeFile(policyPath, JSON.stringify(policy));
    await Promise.all(reportPaths.map((path, index) => writeFile(path, JSON.stringify(reports[index]))));

    const { stdout } = await execFile(process.execPath, [probeTool, "assemble-request", metadataPath, policyPath, ...reportPaths]);
    const request = JSON.parse(stdout);
    assert.deepEqual(Object.keys(request), [
      "schema", "contract_id", "commitment_id", "evaluation_id", "policy_version", "policy_hash",
      "evidence_hash", "requested_at_ns", "subject", "source_policy_hash", "source_policy", "reports",
    ]);
    assert.equal(request.schema, "lcp.service_availability.request.v1");
    assert.equal(request.source_policy_hash, sourcePolicyHash);
    assert.equal(request.evidence_hash, createHash("sha256").update(JSON.stringify(request.reports)).digest("hex"));
    assert.equal(request.subject, metadata.subject);
    assert.equal(request.reports.length, 2);
    assert.deepEqual(request.reports, reports);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("policy hash command rejects source lag values outside u64", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lcp-service-policy-test-"));
  try {
    const keyPairs = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
    const policy = {
      schema: "lcp.service_availability.policy.v1",
      target_id: "a".repeat(64),
      max_source_lag_ns: "18446744073709551616",
      expected_status_min: 200,
      expected_status_max: 299,
      max_latency_ms: 1_500,
      minimum_agreeing_sources: 2,
      minimum_corroboration_bps: 6_000,
      sources: keyPairs.map((pair, index) => ({
        source_id: `source-${index}`,
        operator_id: `operator-${index}`,
        public_key_hex: publicKeyHex(pair.publicKey),
      })),
    };
    const policyPath = join(directory, "policy.json");
    await writeFile(policyPath, JSON.stringify(policy));
    await assert.rejects(
      execFile(process.execPath, [probeTool, "policy-hash", policyPath]),
      /Source policy has invalid bounds or thresholds\./,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
