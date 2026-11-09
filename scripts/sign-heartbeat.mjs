#!/usr/bin/env node

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expectedPublicKeyHex = process.argv[2] ?? "";
if (!/^[0-9a-f]{64}$/.test(expectedPublicKeyHex)) {
  fail("Pass the policy-pinned maintainer public key as 64 lowercase hex characters.");
}

const payload = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
if (!payload) fail("No payload received on stdin. Copy the prepared payload, then pipe your clipboard into this command.");
if (Buffer.byteLength(payload, "utf8") > 4096) fail("Payload exceeds the protocol's 4096-byte heartbeat limit.");

let parsedPayload;
try {
  parsedPayload = JSON.parse(payload);
} catch {
  fail("Input is not valid JSON. Copy the canonical payload from the demo without editing it.");
}
const canonicalFields = [
  "schema",
  "commitment_id",
  "evaluation_id",
  "policy_version",
  "policy_hash",
  "observed_at_ns",
  "subject",
  "artifact_hash",
];
if (
  parsedPayload?.schema !== "lcp.heartbeat.v1"
  || Object.keys(parsedPayload).join(",") !== canonicalFields.join(",")
  || JSON.stringify(parsedPayload) !== payload
) {
  fail("Input is not the exact canonical LCP heartbeat payload. Copy it again from the demo.");
}
if (
  !/^(0|[1-9][0-9]*)$/.test(parsedPayload.commitment_id)
  || !/^(0|[1-9][0-9]*)$/.test(parsedPayload.evaluation_id)
  || !Number.isInteger(parsedPayload.policy_version)
  || parsedPayload.policy_version < 1
  || parsedPayload.policy_version > 0xffff_ffff
  || !/^[0-9a-f]{64}$/.test(parsedPayload.policy_hash)
  || !/^(0|[1-9][0-9]*)$/.test(parsedPayload.observed_at_ns)
  || typeof parsedPayload.subject !== "string"
  || !parsedPayload.subject.trim()
  || parsedPayload.subject.length > 128
  || !/^[\x20-\x7e]+$/.test(parsedPayload.subject)
  || !/^[0-9a-f]{64}$/.test(parsedPayload.artifact_hash)
) {
  fail("Payload fields are invalid. Prepare a fresh canonical payload in the demo.");
}

const fileEnv = readEnvFile(resolve(process.cwd(), ".env.testnet"));
const encodedPrivateKey = process.env.LCP_MAINTAINER_PRIVATE_KEY
  ?? fileEnv.LCP_MAINTAINER_PRIVATE_KEY
  ?? process.env.NEAR_PRIVATE_KEY
  ?? fileEnv.NEAR_PRIVATE_KEY;
if (!encodedPrivateKey) {
  fail("Set LCP_MAINTAINER_PRIVATE_KEY in the environment or ignored .env.testnet file.");
}

const [keyType, base58Key] = encodedPrivateKey.split(":", 2);
if (keyType !== "ed25519" || !base58Key) {
  fail("The configured signing key must use NEAR's ed25519:<base58-secret-key> format.");
}

let secretKeyBytes;
try {
  secretKeyBytes = decodeBase58(base58Key);
} catch {
  fail("The configured Ed25519 secret key is not valid base58.");
}
if (secretKeyBytes.length !== 32 && secretKeyBytes.length !== 64) {
  fail("The configured Ed25519 secret key must decode to 32 or 64 bytes.");
}

let privateKey;
let publicKeyBytes;
try {
  const seed = secretKeyBytes.subarray(0, 32);
  privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  publicKeyBytes = publicKeyDer.subarray(-32);
} catch {
  fail("Node.js could not decode the configured Ed25519 key.");
}

if (secretKeyBytes.length === 64 && !secretKeyBytes.subarray(32).equals(publicKeyBytes)) {
  fail("The configured 64-byte Ed25519 key has an inconsistent public-key suffix.");
}
if (publicKeyBytes.toString("hex") !== expectedPublicKeyHex) {
  fail("The configured signing key does not match the public key pinned by this commitment. Nothing was signed.");
}

process.stdout.write(sign(null, Buffer.from(payload, "utf8"), privateKey).toString("hex") + "\n");

function readEnvFile(path) {
  let contents;
  try {
    contents = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return {};
  }

  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function decodeBase58(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("invalid base58 character");
    number = number * 58n + BigInt(digit);
  }

  const hex = number === 0n ? "" : number.toString(16).padStart(Math.ceil(number.toString(16).length / 2) * 2, "0");
  const decoded = hex ? Buffer.from(hex, "hex") : Buffer.alloc(0);
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  return Buffer.concat([Buffer.alloc(leadingZeroes), decoded]);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
