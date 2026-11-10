#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";

const CONFIG_SCHEMA = "lcp.service_availability.probe_config.v1";
const REPORT_SCHEMA = "lcp.service_availability.report.v1";
const MAX_RESPONSE_BYTES = 64 * 1024;

class ProbeSourceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "keygen" && args.length === 1) {
    await generateKey(args[0]);
    return;
  }
  if (command === "target-id" && args.length === 2) {
    process.stdout.write(`${fingerprintTarget(args[0], args[1])}\n`);
    return;
  }
  if (command === "policy-hash" && args.length === 1) {
    await hashSourcePolicy(args[0]);
    return;
  }
  if (command === "assemble-request" && args.length >= 3) {
    await assembleRequest(args[0], args[1], args.slice(2));
    return;
  }
  if (command === "probe" && args.length === 2) {
    await createReport(args[0], args[1]);
    return;
  }
  throw new Error("Usage: node probe.mjs keygen <private.pem> | target-id <https-url> <salt-hex> | policy-hash <policy.json> | probe <config.json> <private.pem> | assemble-request <metadata.json> <policy.json> <report.json> [report.json ...]");
}

async function generateKey(path) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  await writeFile(path, privatePem, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const publicHex = publicDer.subarray(-32).toString("hex");
  process.stdout.write(`${JSON.stringify({ public_key_hex: publicHex, private_key_file: path })}\n`);
}

async function createReport(configPath, keyPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  validateConfig(config);

  const privateKey = createPrivateKey(await readFile(keyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("The probe key must be Ed25519.");
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicHex = publicDer.subarray(-32).toString("hex");
  if (publicHex !== config.source_public_key_hex) {
    throw new Error("The private key does not match the source key pinned in this configuration.");
  }

  const targetUrl = validateTargetUrl(config.target_url);
  const targetId = fingerprintTarget(targetUrl.toString(), config.target_salt_hex);
  if (targetId !== config.target_id) {
    throw new Error("The target URL and private salt do not match the policy target fingerprint.");
  }

  let observation;
  try {
    const address = await resolvePublicIpv4(targetUrl.hostname, config.timeout_ms);
    observation = await probe(targetUrl, address, config.timeout_ms);
  } catch (error) {
    if (!(error instanceof ProbeSourceError)) throw error;
    observation = { kind: "source_error", code: error.code };
  }
  const payload = {
    schema: REPORT_SCHEMA,
    contract_id: config.contract_id,
    commitment_id: config.commitment_id,
    evaluation_id: config.evaluation_id,
    policy_version: 3,
    policy_hash: config.policy_hash,
    source_policy_hash: config.source_policy_hash,
    source_id: config.source_id,
    operator_id: config.operator_id,
    target_id: config.target_id,
    observed_at_ns: (BigInt(Date.now()) * 1_000_000n).toString(),
    observation,
  };
  const signatureHex = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("hex");
  process.stdout.write(`${JSON.stringify({ payload, signature_hex: signatureHex })}\n`);
}

function fingerprintTarget(rawUrl, saltHex) {
  if (typeof saltHex !== "string" || !/^[0-9a-f]{64}$/.test(saltHex)) {
    throw new Error("target salt must be 32 bytes of lowercase hexadecimal.");
  }
  const url = validateTargetUrl(rawUrl);
  return createHash("sha256")
    .update(Buffer.from(saltHex, "hex"))
    .update(url.toString())
    .digest("hex");
}

async function hashSourcePolicy(policyPath) {
  const input = JSON.parse(await readFile(policyPath, "utf8"));
  const canonicalPolicy = canonicalizePolicy(input);
  const canonicalJson = JSON.stringify(canonicalPolicy);
  process.stdout.write(`${JSON.stringify({
    source_policy_hash: createHash("sha256").update(canonicalJson).digest("hex"),
    canonical_policy: canonicalJson,
  })}\n`);
}

async function assembleRequest(metadataPath, policyPath, reportPaths) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const policy = canonicalizePolicy(JSON.parse(await readFile(policyPath, "utf8")));
  const policyCanonicalJson = JSON.stringify(policy);
  const reports = await Promise.all(reportPaths.map(async (path) =>
    canonicalizeReport(JSON.parse(await readFile(path, "utf8")))
  ));
  const metadataFields = ["contract_id", "commitment_id", "evaluation_id", "policy_hash", "requested_at_ns", "subject"];
  requireOnlyKeys(metadata, metadataFields, "request metadata");
  if (!metadata || metadataFields.some((field) => typeof metadata[field] !== "string" || !metadata[field])) {
    throw new Error("Metadata file must provide " + metadataFields.join(", ") + ".");
  }
  if (!/^[a-z0-9._-]+$/.test(metadata.contract_id)
      || !/^(0|[1-9][0-9]*)$/.test(metadata.commitment_id)
      || !/^(0|[1-9][0-9]*)$/.test(metadata.evaluation_id)
      || !/^(0|[1-9][0-9]*)$/.test(metadata.requested_at_ns)
      || !/^[0-9a-f]{64}$/.test(metadata.policy_hash)
      || typeof metadata.subject !== "string"
      || metadata.subject.length === 0
      || metadata.subject.length > 128) {
    throw new Error("Metadata contains a noncanonical account ID, decimal value, or policy hash.");
  }
  const request = {
    schema: "lcp.service_availability.request.v1",
    contract_id: metadata.contract_id,
    commitment_id: metadata.commitment_id,
    evaluation_id: metadata.evaluation_id,
    policy_version: 3,
    policy_hash: metadata.policy_hash,
    evidence_hash: createHash("sha256").update(JSON.stringify(reports)).digest("hex"),
    requested_at_ns: metadata.requested_at_ns,
    subject: metadata.subject,
    source_policy_hash: createHash("sha256").update(policyCanonicalJson).digest("hex"),
    source_policy: policy,
    reports,
  };
  process.stdout.write(JSON.stringify(request) + "\n");
}

function canonicalizePolicy(input) {
  requireOnlyKeys(input, [
    "schema",
    "target_id",
    "max_source_lag_ns",
    "expected_status_min",
    "expected_status_max",
    "max_latency_ms",
    "minimum_agreeing_sources",
    "minimum_corroboration_bps",
    "sources",
  ], "source policy");
  if (input.schema !== "lcp.service_availability.policy.v1" || !Array.isArray(input.sources)) {
    throw new Error("Source policy file has an unsupported schema.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.target_id)
      || typeof input.max_source_lag_ns !== "string"
      || !/^[1-9][0-9]*$/.test(input.max_source_lag_ns)
      || input.max_source_lag_ns.length > 20
      || (input.max_source_lag_ns.length === 20 && input.max_source_lag_ns > "18446744073709551615")
      || !Number.isSafeInteger(input.expected_status_min)
      || !Number.isSafeInteger(input.expected_status_max)
      || input.expected_status_min < 100
      || input.expected_status_max > 599
      || input.expected_status_min > input.expected_status_max
      || !Number.isSafeInteger(input.max_latency_ms)
      || input.max_latency_ms < 1
      || !Number.isInteger(input.minimum_agreeing_sources)
      || input.minimum_agreeing_sources < 1
      || input.minimum_agreeing_sources > input.sources.length
      || input.minimum_agreeing_sources * 2 <= input.sources.length
      || !Number.isInteger(input.minimum_corroboration_bps)
      || input.minimum_corroboration_bps < 0
      || input.minimum_corroboration_bps > 10_000
      || input.sources.length < 2
      || input.sources.length > 8) {
    throw new Error("Source policy has invalid bounds or thresholds.");
  }
  const seenOperators = new Set();
  const seenKeys = new Set();
  let previousSourceId = "";
  for (const source of input.sources) {
    requireOnlyKeys(source, ["source_id", "operator_id", "public_key_hex"], "source definition");
    if (typeof source.source_id !== "string"
        || !/^[a-z0-9._-]{1,64}$/.test(source.source_id)
        || source.source_id <= previousSourceId
        || typeof source.operator_id !== "string"
        || !/^[a-z0-9._-]{1,64}$/.test(source.operator_id)
        || seenOperators.has(source.operator_id)
        || typeof source.public_key_hex !== "string"
        || !/^[0-9a-f]{64}$/.test(source.public_key_hex)
        || seenKeys.has(source.public_key_hex)) {
      throw new Error("Source definitions must be sorted, unique, and contain distinct operators and Ed25519 keys.");
    }
    previousSourceId = source.source_id;
    seenOperators.add(source.operator_id);
    seenKeys.add(source.public_key_hex);
  }
  return {
    schema: input.schema,
    target_id: input.target_id,
    max_source_lag_ns: input.max_source_lag_ns,
    expected_status_min: input.expected_status_min,
    expected_status_max: input.expected_status_max,
    max_latency_ms: input.max_latency_ms,
    minimum_agreeing_sources: input.minimum_agreeing_sources,
    minimum_corroboration_bps: input.minimum_corroboration_bps,
    sources: input.sources.map((source) => {
      requireOnlyKeys(source, ["source_id", "operator_id", "public_key_hex"], "source definition");
      return {
        source_id: source.source_id,
        operator_id: source.operator_id,
        public_key_hex: source.public_key_hex,
      };
    }),
  };
}

function canonicalizeReport(report) {
  requireOnlyKeys(report, ["payload", "signature_hex"], "signed report");
  const payload = report?.payload;
  const observation = payload?.observation;
  if (!payload || !observation || typeof report.signature_hex !== "string") {
    throw new Error("Each report file must contain payload, observation, and signature_hex.");
  }
  requireOnlyKeys(payload, [
    "schema",
    "contract_id",
    "commitment_id",
    "evaluation_id",
    "policy_version",
    "policy_hash",
    "source_policy_hash",
    "source_id",
    "operator_id",
    "target_id",
    "observed_at_ns",
    "observation",
  ], "report payload");
  let canonicalObservation;
  switch (observation.kind) {
    case "http_response":
      requireOnlyKeys(observation, ["kind", "status_code", "latency_ms", "tls_verified"], "HTTP observation");
      canonicalObservation = {
        kind: observation.kind,
        status_code: observation.status_code,
        latency_ms: observation.latency_ms,
        tls_verified: observation.tls_verified,
      };
      break;
    case "timeout":
      requireOnlyKeys(observation, ["kind", "elapsed_ms"], "timeout observation");
      canonicalObservation = { kind: observation.kind, elapsed_ms: observation.elapsed_ms };
      break;
    case "tls_error":
      requireOnlyKeys(observation, ["kind"], "TLS observation");
      canonicalObservation = { kind: observation.kind };
      break;
    case "source_error":
      requireOnlyKeys(observation, ["kind", "code"], "source error observation");
      canonicalObservation = { kind: observation.kind, code: observation.code };
      break;
    default:
      throw new Error("A report contains an unsupported observation kind.");
  }
  return {
    payload: {
      schema: payload.schema,
      contract_id: payload.contract_id,
      commitment_id: payload.commitment_id,
      evaluation_id: payload.evaluation_id,
      policy_version: payload.policy_version,
      policy_hash: payload.policy_hash,
      source_policy_hash: payload.source_policy_hash,
      source_id: payload.source_id,
      operator_id: payload.operator_id,
      target_id: payload.target_id,
      observed_at_ns: payload.observed_at_ns,
      observation: canonicalObservation,
    },
    signature_hex: report.signature_hex,
  };
}

function requireOnlyKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be a JSON object.");
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(label + " contains an unsupported field: " + unknown[0] + ".");
  }
}

function validateConfig(config) {
  if (!config || config.schema !== CONFIG_SCHEMA) throw new Error(`Configuration must use ${CONFIG_SCHEMA}.`);
  for (const field of ["policy_hash", "source_policy_hash", "target_id", "target_salt_hex", "source_public_key_hex"]) {
    if (typeof config[field] !== "string" || !/^[0-9a-f]{64}$/.test(config[field])) {
      throw new Error(`${field} must be 64 lowercase hexadecimal characters.`);
    }
  }
  for (const field of ["commitment_id", "evaluation_id"]) {
    if (typeof config[field] !== "string" || !/^(0|[1-9][0-9]*)$/.test(config[field])) {
      throw new Error(`${field} must be a canonical decimal string.`);
    }
  }
  for (const field of ["contract_id", "source_id", "operator_id", "target_url"]) {
    if (typeof config[field] !== "string" || !config[field]) throw new Error(`${field} is required.`);
  }
  if (!/^[a-z0-9._-]+$/.test(config.source_id) || !/^[a-z0-9._-]+$/.test(config.operator_id)) {
    throw new Error("source_id and operator_id must use lowercase letters, digits, dot, underscore, or hyphen.");
  }
  if (!Number.isSafeInteger(config.timeout_ms) || config.timeout_ms < 1_000 || config.timeout_ms > 30_000) {
    throw new Error("timeout_ms must be an integer between 1000 and 30000.");
  }
}

function validateTargetUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("target_url must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Probe targets must use HTTPS on port 443 without embedded credentials.");
  }
  if (isIP(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new Error("IP literals and local hostnames are not permitted probe targets.");
  }
  return url;
}

async function resolvePublicIpv4(hostname, timeoutMs) {
  let timer;
  let addresses;
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ProbeSourceError("dns_timeout")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof ProbeSourceError) throw error;
    throw new ProbeSourceError("dns_unavailable");
  } finally {
    clearTimeout(timer);
  }
  const ipv4 = addresses.filter((entry) => entry.family === 4);
  if (ipv4.length === 0) throw new Error("Probe target must resolve to a public IPv4 address.");
  if (ipv4.some((entry) => !isPublicIpv4(entry.address))) {
    throw new Error("Probe target DNS returned a private or reserved IPv4 address.");
  }
  return ipv4[0].address;
}

function isPublicIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function probe(url, address, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let settled = false;
    let timedOut = false;
    let responseTooLarge = false;
    let receivedBytes = 0;
    const finish = (observation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(observation);
    };

    const request = httpsRequest(url, {
      method: "GET",
      agent: false,
      headers: { "User-Agent": "lcp-service-probe/0.1", Accept: "*/*" },
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
    }, (response) => {
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          responseTooLarge = true;
          request.destroy();
          finish({ kind: "source_error", code: "response_too_large" });
        }
      });
      response.on("end", () => {
        if (responseTooLarge) return;
        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
        if (!Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
          finish({ kind: "source_error", code: "invalid_http_response" });
          return;
        }
        finish({
          kind: "http_response",
          status_code: response.statusCode,
          latency_ms: latencyMs,
          tls_verified: response.socket.authorized === true,
        });
      });
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
      request.destroy();
      finish({ kind: "timeout", elapsed_ms: elapsedMs });
    }, timeoutMs);

    request.on("error", (error) => {
      if (timedOut || responseTooLarge) return;
      const code = typeof error.code === "string" ? error.code : "";
      if (/CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(code)) {
        finish({ kind: "tls_error" });
      } else {
        finish({ kind: "source_error", code: "network_error" });
      }
    });
    request.end();
  });
}

main().catch((error) => {
  process.stderr.write(`lcp-service-probe: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
