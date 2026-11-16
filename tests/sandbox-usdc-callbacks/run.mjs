import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRIVATE_KEY,
  DEFAULT_PUBLIC_KEY,
  Sandbox,
} from "near-sandbox";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../..");
const wasmDir = join(repoRoot, "target/wasm32-unknown-unknown/release");
const sandboxCache = process.env.LCP_SANDBOX_BINARY_DIR;
if (sandboxCache) process.env.DIR_TO_DOWNLOAD_BINARY = sandboxCache;

const CORE_ID = "lcp-core-sandbox.sandbox";
const TOKEN_ID = "mock-usdc.sandbox";
const NO_CODE_TOKEN_ID = "no-code-token.sandbox";
const ORDER_A_ID = "order-a.sandbox";
const ORDER_B_ID = "order-b.sandbox";
const CASH_RECIPIENT_ID = "cash-recipient.sandbox";
const RECIPIENT_ID = "recipient.sandbox";
const AMOUNT = 1_000_000n;
const INITIAL_TOKEN_BALANCE = 10_000_000n;
const ONE_NEAR = 10n ** 24n;
const NATIVE_STORAGE_MARGIN_BUFFER = 5n * 10n ** 22n;
const TERA = 1_000_000_000_000n;
const privateKeyPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
let rpcId = 0;

function base58Decode(text) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of text) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error(`Invalid base58 character ${char}`);
    value = value * 58n + BigInt(digit);
  }
  const bytes = value === 0n ? Buffer.alloc(0) : Buffer.from(value.toString(16).padStart(Math.ceil(value.toString(16).length / 2) * 2, "0"), "hex");
  let leadingZeroes = 0;
  while (text[leadingZeroes] === "1") leadingZeroes += 1;
  return Buffer.concat([Buffer.alloc(leadingZeroes), bytes]);
}

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

function u32(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
}

function u8(value) {
  return Buffer.from([value]);
}

function u64(value) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt(value));
  return result;
}

function u128(value) {
  const result = Buffer.alloc(16);
  const integer = BigInt(value);
  result.writeBigUInt64LE(integer & ((1n << 64n) - 1n), 0);
  result.writeBigUInt64LE(integer >> 64n, 8);
  return result;
}

function borshString(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function borshBytes(value) {
  return Buffer.concat([u32(value.length), value]);
}

function sha256Bytes(...parts) {
  return createHash("sha256").update(Buffer.concat(parts)).digest();
}

function hexBytes(value) {
  const bytes = Buffer.from(value, "hex");
  assert.equal(bytes.length, 32);
  return bytes;
}

function signedEnvelope(message, domain, committee, count = 4) {
  const digest = sha256Bytes(Buffer.from(domain, "utf8"), message);
  const signatures = [...committee]
    .sort((left, right) => Buffer.compare(left.publicKeyBytes, right.publicKeyBytes))
    .slice(0, count)
    .map((key) => ({
      publicKeyBytes: key.publicKeyBytes,
      signature: sign(null, digest, key.privateKeyObject),
    }));
  return Buffer.concat([
    borshBytes(message),
    u32(signatures.length),
    ...signatures.flatMap(({ publicKeyBytes, signature }) => [publicKeyBytes, signature]),
  ]).toString("base64");
}

function recoveryCertificate(intentView, outcome, committee, domain = "LCP/NEP141/RECOVERY/V1\0", intentHashOverride) {
  const intentBytes = Buffer.from(intentView.intent_base64, "base64");
  const intentHash = intentHashOverride ?? hexBytes(intentView.intent_digest);
  const identity = (label) => sha256Bytes(Buffer.from(label), intentBytes);
  const certificate = Buffer.concat([
    u8(1),
    intentBytes,
    intentHash,
    identity("sandbox-origin-transaction"),
    identity("sandbox-origin-receipt"),
    identity("sandbox-origin-block"),
    u64(1),
    identity("sandbox-token-receipt"),
    u32(0),
    identity("sandbox-outcome-block"),
    u64(2),
    u8(outcome === "success" ? 0 : 1),
  ]);
  return {
    certificate,
    envelope: signedEnvelope(certificate, domain, committee),
    intentBytes,
  };
}

function maximumRecoveryEnvelope(committee) {
  const intentBytes = Buffer.concat([
    u8(1),
    borshString(`test-chain-${"a".repeat(117)}`),
    Buffer.alloc(32, 0x11),
    borshString("a".repeat(64)),
    Buffer.alloc(32, 0x22),
    u32(0),
    u64(1),
    u64(1),
    u8(0),
    u8(1),
    u32(0),
    borshString("a".repeat(64)),
    borshString("a".repeat(64)),
    u128(1),
    u8(0),
    Buffer.alloc(32, 0x33),
    u128(1),
    u64(25),
  ]);
  const intentHash = sha256Bytes(Buffer.from("LCP/NEP141/INTENT/V1\0", "utf8"), intentBytes);
  const identity = (label) => sha256Bytes(Buffer.from(label), intentBytes);
  const certificate = Buffer.concat([
    u8(1),
    intentBytes,
    intentHash,
    identity("sandbox-origin-transaction"),
    identity("sandbox-origin-receipt"),
    identity("sandbox-origin-block"),
    u64(10),
    identity("sandbox-token-receipt"),
    u32(0),
    identity("sandbox-outcome-block"),
    u64(11),
    u8(0),
  ]);
  const envelope = signedEnvelope(
    certificate,
    "LCP/NEP141/RECOVERY/V1\0",
    committee,
    5,
  );
  return { intentBytes, certificate, envelope };
}

function recoveryCertificateFieldMutations(certificate, intentBytes) {
  const offsets = { certificate_schema_version: 0, intent_schema_version: 1 };
  let intentOffset = 0;
  const readString = (field) => {
    const length = intentBytes.readUInt32LE(intentOffset);
    intentOffset += 4;
    offsets[field] = 1 + intentOffset;
    intentOffset += length;
  };
  const skipFixed = (field, length) => {
    offsets[field] = 1 + intentOffset;
    intentOffset += length;
  };
  const skip = (length) => { intentOffset += length; };

  skip(1); // RecoveryIntentV1.schema_version
  readString("intent_chain_id");
  skipFixed("intent_genesis_hash", 32);
  readString("intent_core_account_id");
  skipFixed("intent_instance_id", 32);
  offsets.intent_committee_epoch = 1 + intentOffset; skip(4);
  offsets.intent_transfer_id = 1 + intentOffset; skip(8);
  offsets.intent_commitment_id = 1 + intentOffset; skip(8);
  offsets.intent_kind = 1 + intentOffset; skip(1);
  assert.equal(intentBytes[intentOffset], 1, "claim fixture must include tranche_epoch");
  offsets.intent_tranche_epoch = 1 + intentOffset + 1; skip(5);
  readString("intent_token_account_id");
  readString("intent_recipient_id");
  offsets.intent_amount_raw = 1 + intentOffset; skip(16);
  offsets.intent_origin_method = 1 + intentOffset; skip(1);
  skipFixed("intent_token_code_hash", 32);
  offsets.intent_ft_transfer_deposit = 1 + intentOffset; skip(16);
  offsets.intent_ft_transfer_gas = 1 + intentOffset; skip(8);
  assert.equal(intentOffset, intentBytes.length, "intent field offsets must cover canonical Borsh bytes");

  let certificateOffset = 1 + intentBytes.length;
  const certificateFields = [
    ["intent_hash", 32],
    ["origin_transaction_hash", 32],
    ["origin_receipt_id", 32],
    ["origin_block_hash", 32],
    ["origin_block_height", 8],
    ["token_receipt_id", 32],
    ["token_action_index", 4],
    ["outcome_block_hash", 32],
    ["outcome_block_height", 8],
    ["outcome", 1],
  ];
  for (const [field, length] of certificateFields) {
    offsets[field] = certificateOffset;
    certificateOffset += length;
  }
  assert.equal(certificateOffset, certificate.length, "certificate field offsets must cover canonical Borsh bytes");

  return Object.entries(offsets).map(([field, offset]) => {
    const changed = Buffer.from(certificate);
    changed[offset] ^= 1;
    return [`mutated ${field}`, changed];
  });
}

function envelopeWithOriginalSignatures(envelope, certificate) {
  const original = Buffer.from(envelope, "base64");
  const originalCertificateLength = original.readUInt32LE(0);
  return Buffer.concat([
    borshBytes(certificate),
    original.subarray(4 + originalCertificateLength),
  ]).toString("base64");
}

function recoveryEnvelopeAdversarialCases(envelope, intentBytes, committee) {
  const raw = Buffer.from(envelope, "base64");
  const certificateLength = raw.readUInt32LE(0);
  const certificate = raw.subarray(4, 4 + certificateLength);
  const signatureCountOffset = 4 + certificateLength;
  const signatureCount = raw.readUInt32LE(signatureCountOffset);
  const signatures = Array.from({ length: signatureCount }, (_, index) => {
    const offset = signatureCountOffset + 4 + (index * 96);
    return Buffer.from(raw.subarray(offset, offset + 96));
  });
  const encode = (message = certificate, entries = signatures) => Buffer.concat([
    borshBytes(message),
    u32(entries.length),
    ...entries,
  ]).toString("base64");

  const duplicateSignatures = signatures.map((entry) => Buffer.from(entry));
  duplicateSignatures[1].set(duplicateSignatures[0].subarray(0, 32), 0);
  const unsortedSignatures = signatures.map((entry) => Buffer.from(entry));
  [unsortedSignatures[0], unsortedSignatures[1]] = [unsortedSignatures[1], unsortedSignatures[0]];
  const unpinnedSignatures = signatures.map((entry) => Buffer.from(entry));
  const outsider = newKey();
  assert.equal(committee.some((member) => member.publicKeyBytes.equals(outsider.publicKeyBytes)), false);
  unpinnedSignatures[0].set(outsider.publicKeyBytes, 0);
  unpinnedSignatures.sort((left, right) => Buffer.compare(left.subarray(0, 32), right.subarray(0, 32)));
  const noncanonicalScalarSignatures = signatures.map((entry) => Buffer.from(entry));
  noncanonicalScalarSignatures[0].set(
    Buffer.from("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010", "hex"),
    64,
  );
  const smallOrderRSignatures = signatures.map((entry) => Buffer.from(entry));
  smallOrderRSignatures[0].set(Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]), 32);

  let intentCursor = 1;
  const skipString = () => {
    const length = intentBytes.readUInt32LE(intentCursor);
    intentCursor += 4 + length;
  };
  skipString();
  intentCursor += 32;
  const coreLength = intentBytes.readUInt32LE(intentCursor);
  intentCursor += 4;
  const coreAccountOffset = intentCursor;
  intentCursor += coreLength + 32 + 4 + 8 + 8;
  const kindOffset = intentCursor;
  intentCursor += 1;
  const optionTagOffset = intentCursor;
  assert.equal(intentBytes[optionTagOffset], 1, "claim fixture must have a Some tranche epoch");

  const badOption = Buffer.from(certificate);
  badOption[1 + optionTagOffset] = 2;
  const badKind = Buffer.from(certificate);
  badKind[1 + kindOffset] = 2;
  const badAccount = Buffer.from(certificate);
  badAccount[1 + coreAccountOffset] = 0x4c; // Uppercase the first account-ID byte.
  const badStringLength = Buffer.from(certificate);
  badStringLength.writeUInt32LE(0xffff_ffff, 2); // intent schema byte, then chain_id length.

  const invalidLength = Buffer.from(raw);
  invalidLength.writeUInt32LE(715, 0);
  const invalidCount = Buffer.from(raw);
  invalidCount.writeUInt32LE(6, signatureCountOffset);
  const truncated = raw.subarray(0, raw.length - 1).toString("base64");
  const trailing = Buffer.concat([raw, Buffer.from([0])]).toString("base64");
  const oversizedBase64 = "A".repeat(1_608);
  const oversizedDecoded = Buffer.alloc(1_203).toString("base64");
  const atDecodedLimit = Buffer.alloc(1_202).toString("base64");
  let noncanonicalSource = Buffer.from(envelope, "base64");
  while (noncanonicalSource.length % 3 === 0) {
    noncanonicalSource = Buffer.concat([noncanonicalSource, Buffer.from([0])]);
  }
  const canonicalWithPadding = noncanonicalSource.toString("base64");
  const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = canonicalWithPadding.endsWith("==") ? 2 : canonicalWithPadding.endsWith("=") ? 1 : 0;
  assert.ok(padding > 0);
  const unusedBits = padding === 2 ? 0x0f : 0x03;
  const lastDataIndex = canonicalWithPadding.length - padding - 1;
  const lastDataValue = base64Alphabet.indexOf(canonicalWithPadding[lastDataIndex]);
  const noncanonicalBase64 = `${canonicalWithPadding.slice(0, lastDataIndex)}${base64Alphabet[(lastDataValue & ~unusedBits) | 1]}${canonicalWithPadding.slice(lastDataIndex + 1)}`;

  return [
    ["duplicate signer key", encode(certificate, duplicateSignatures)],
    ["unsorted signer keys", encode(certificate, unsortedSignatures)],
    ["unpinned signer key", encode(certificate, unpinnedSignatures)],
    ["noncanonical Ed25519 S scalar", encode(certificate, noncanonicalScalarSignatures)],
    ["small-order Ed25519 R point", encode(certificate, smallOrderRSignatures)],
    ["malformed Base64 alphabet", `${envelope.slice(0, -1)}!`],
    ["noncanonical Base64 padding bits", noncanonicalBase64],
    ["truncated Borsh envelope", truncated],
    ["trailing Borsh envelope byte", trailing],
    ["invalid certificate length field", invalidLength.toString("base64")],
    ["invalid signature count", invalidCount.toString("base64")],
    ["certificate with trailing Borsh byte", encode(Buffer.concat([certificate, Buffer.from([0])]))],
    ["oversized certificate body", encode(Buffer.alloc(715), signatures)],
    ["invalid Borsh chain string length", encode(badStringLength)],
    ["invalid Borsh option tag", encode(badOption)],
    ["invalid Borsh transfer kind", encode(badKind)],
    ["noncanonical intent account ID", encode(badAccount)],
    ["decoded envelope at maximum byte bound", atDecodedLimit],
    ["decoded envelope above byte bound", oversizedDecoded],
    ["Base64 above encoded byte bound", oversizedBase64],
  ];
}

function buildRotationMessage(config, chainId, genesisHash, coreAccountId, oldEpoch, newEpoch, generation, keys, activateAtNs) {
  return Buffer.concat([
    u8(2),
    borshString(chainId),
    genesisHash,
    borshString(coreAccountId),
    Buffer.from(config.instance_id, "hex"),
    u32(oldEpoch),
    u32(newEpoch),
    u64(generation),
    ...[...keys]
      .sort((left, right) => Buffer.compare(left.publicKeyBytes, right.publicKeyBytes))
      .map((key) => key.publicKeyBytes),
    u64(activateAtNs),
  ]);
}

function publicKeyBytes(publicKey) {
  const [curve, encoded] = publicKey.split(":");
  assert.equal(curve, "ed25519");
  const bytes = base58Decode(encoded);
  assert.equal(bytes.length, 32);
  return Buffer.concat([Buffer.from([0]), bytes]);
}

function keyFromNearStrings(privateKey, publicKey) {
  const [privateCurve, privateEncoded] = privateKey.split(":");
  const [publicCurve, publicEncoded] = publicKey.split(":");
  assert.equal(privateCurve, "ed25519");
  assert.equal(publicCurve, "ed25519");
  const secret = base58Decode(privateEncoded);
  const publicBytes = base58Decode(publicEncoded);
  assert.equal(secret.length, 64);
  assert.equal(publicBytes.length, 32);
  assert.deepEqual(secret.subarray(32), publicBytes);
  return {
    publicKey,
    publicKeyBytes: publicBytes,
    privateKeyObject: createPrivateKey({
      key: Buffer.concat([privateKeyPrefix, secret.subarray(0, 32)]),
      format: "der",
      type: "pkcs8",
    }),
  };
}

function newKey() {
  const pair = generateKeyPairSync("ed25519");
  const seed = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const publicBytes = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    publicKey: `ed25519:${base58Encode(publicBytes)}`,
    publicKeyBytes: publicBytes,
    privateKeyObject: pair.privateKey,
    privateKey: `ed25519:${base58Encode(Buffer.concat([seed, publicBytes]))}`,
  };
}

function actionCreateAccount() {
  return Buffer.from([0]);
}

function actionDeploy(code) {
  return Buffer.concat([Buffer.from([1]), borshBytes(code)]);
}

function actionFunctionCall(method, args = {}, gas = 30n * TERA, deposit = 0n) {
  return Buffer.concat([
    Buffer.from([2]),
    borshString(method),
    borshBytes(Buffer.from(JSON.stringify(args), "utf8")),
    u64(gas),
    u128(deposit),
  ]);
}

function actionTransfer(amount) {
  return Buffer.concat([Buffer.from([3]), u128(amount)]);
}

function actionAddFullAccessKey(publicKey) {
  return Buffer.concat([Buffer.from([5]), publicKeyBytes(publicKey), u64(0), Buffer.from([1])]);
}

function serializeTransaction({ signerId, key, nonce, receiverId, blockHash, actions }) {
  // NEAR preserves the untagged TransactionV0 encoding for backward compatibility.
  return Buffer.concat([
    borshString(signerId),
    publicKeyBytes(key.publicKey),
    u64(nonce),
    borshString(receiverId),
    base58Decode(blockHash),
    u32(actions.length),
    ...actions,
  ]);
}

function isFailedExecution(value) {
  return Boolean(value && typeof value === "object" && Object.hasOwn(value, "Failure"));
}

function hasFailedExecution(result) {
  return isFailedExecution(result.status)
    || (result.receipts_outcome ?? []).some((receipt) => isFailedExecution(receipt.outcome?.status));
}

function shouldRetryTransactionLookup(error) {
  return /unknown transaction|does not exist|not found|PENDING|TIMEOUT_ERROR|Timeout/i.test(String(error));
}

function assertTransactionSucceeded(result, description) {
  if (isFailedExecution(result.status)) {
    throw new Error(`${description} failed:\n${JSON.stringify(result, null, 2)}`);
  }
}

async function main() {
  const rootKey = keyFromNearStrings(DEFAULT_PRIVATE_KEY, DEFAULT_PUBLIC_KEY);
  const coreKey = newKey();
  const tokenKey = newKey();
  const noCodeTokenKey = newKey();
  const orderAKey = newKey();
  const orderBKey = newKey();
  const cashRecipientKey = newKey();
  const recipientKey = newKey();
  const sandbox = await Sandbox.start({ version: "2.14.0" });
  const fixtures = {};

  async function rpc(method, params) {
    const response = await fetch(sandbox.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const responseText = await response.text();
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error(`${method} RPC returned non-JSON HTTP ${response.status}: ${responseText.slice(0, 500)}`);
    }
    if (!response.ok || body.error) {
      throw new Error(`${method} RPC failed: ${JSON.stringify(body.error ?? body)}`);
    }
    return body.result;
  }

  async function sendTransaction(signerId, key, receiverId, actions, description, options = {}) {
    const block = await rpc("block", { finality: "final" });
    let nonce = options.nonce;
    if (nonce === undefined) {
      const accessKey = await rpc("query", {
        request_type: "view_access_key",
        account_id: signerId,
        public_key: key.publicKey,
        finality: "optimistic",
      });
      nonce = BigInt(accessKey.nonce) + 1n;
    }
    const transactionBytes = serializeTransaction({
      signerId,
      key,
      nonce,
      receiverId,
      blockHash: block.header.hash,
      actions,
    });
    const digest = createHash("sha256").update(transactionBytes).digest();
    const signature = sign(null, digest, key.privateKeyObject);
    const signedTransaction = Buffer.concat([transactionBytes, Buffer.from([0]), signature]);
    const method = options.broadcastMethod ?? "broadcast_tx_commit";
    let result;
    try {
      result = await rpc(method, [signedTransaction.toString("base64")]);
    } catch (error) {
      if (method !== "broadcast_tx_commit" || !/(?:PENDING|TIMEOUT_ERROR|Timeout)/i.test(String(error))) {
        throw error;
      }
      const transactionHash = base58Encode(digest);
      result = await waitFor(`${description} final receipt after commit RPC timeout`, async () => {
        try {
          const status = await rpc("tx", [transactionHash, signerId]);
          const complete = status.status && (
            Object.hasOwn(status.status, "SuccessValue")
            || Object.hasOwn(status.status, "Failure")
          );
          return complete
            ? { done: true, value: status }
            : { done: false, value: status.status };
        } catch (lookupError) {
          if (shouldRetryTransactionLookup(lookupError)) {
            return { done: false, value: String(lookupError) };
          }
          throw lookupError;
        }
      }, 120_000);
      result.transaction ??= { hash: transactionHash };
    }
    if (method === "broadcast_tx_commit") {
      if (options.expectFailure) {
        assert.ok(hasFailedExecution(result),
          `${description} should fail its execution receipt: ${JSON.stringify(result.status)}`);
        console.log(`EXPECTED FAILURE RECEIPT ${description}: ${JSON.stringify({
          status: result.status,
          transaction_status: result.transaction_outcome?.outcome?.status,
          receipt_statuses: (result.receipts_outcome ?? []).map((receipt) => ({
            status: receipt.outcome?.status,
            logs: receipt.outcome?.logs,
          })),
        })}`);
        console.log(`PASS expected failure ${description}: ${result.transaction.hash}`);
        return result;
      }
      assertTransactionSucceeded(result, description);
      console.log(`PASS ${description}: ${result.transaction.hash}`);
      return result;
    }
    console.log(`SUBMITTED ${description}: ${result}`);
    return result;
  }

  async function createSubaccount(accountId, key) {
    await sendTransaction("sandbox", rootKey, accountId, [
      actionCreateAccount(),
      actionTransfer(30n * 10n ** 24n),
      actionAddFullAccessKey(key.publicKey),
    ], `create ${accountId}`);
  }

  async function functionCall(accountId, key, method, args, gas = 30n * TERA, deposit = 0n, options = {}) {
    return sendTransaction(accountId, key, accountId, [
      actionFunctionCall(method, args, gas, deposit),
    ], `${accountId}.${method}`, options);
  }

  async function accountBalance(accountId, finality = "final") {
    const result = await rpc("query", {
      request_type: "view_account",
      account_id: accountId,
      finality,
    });
    return BigInt(result.amount);
  }

  function returnedJson(result) {
    const statuses = [
      ...(result.receipts_outcome ?? []).map((receipt) => receipt.outcome?.status),
      result.status,
    ];
    const success = statuses.find((status) => status && Object.hasOwn(status, "SuccessValue"));
    assert.ok(success, "transaction has no function-call return value");
    return JSON.parse(Buffer.from(success.SuccessValue, "base64").toString("utf8"));
  }

  async function view(accountId, method, args = {}) {
    const result = await rpc("query", {
      request_type: "call_function",
      account_id: accountId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
      finality: "optimistic",
    });
    if (!Array.isArray(result.result)) {
      throw new Error(`view ${accountId}.${method} failed: ${JSON.stringify(result)}`);
    }
    return JSON.parse(Buffer.from(result.result).toString("utf8"));
  }

  async function accountCodeHash(accountId) {
    try {
      const result = await rpc("query", {
        request_type: "view_code",
        account_id: accountId,
        finality: "final",
      });
      return result.hash;
    } catch (error) {
      if (String(error).includes("NO_CONTRACT_CODE")) return null;
      throw error;
    }
  }

  async function waitFor(description, check, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await check();
      if (last.done) return last.value;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`Timed out waiting for ${description}; last state: ${JSON.stringify(last)}`);
  }

  async function deployAndWait(accountId, key, wasm, expectedCodeHash, description) {
    const transactionHash = await sendTransaction(
      accountId,
      key,
      accountId,
      [actionDeploy(wasm)],
      description,
      { broadcastMethod: "broadcast_tx_async" },
    );
    await waitFor(`${description} code`, async () => {
      const codeHash = await accountCodeHash(accountId);
      return codeHash === expectedCodeHash
        ? { done: true, value: codeHash }
        : { done: false, value: codeHash };
    }, 90_000);
    console.log(`PASS ${description} finalized with the expected code hash`);
    return { transaction_hash: String(transactionHash), near_code_hash: expectedCodeHash };
  }

  async function submitAndWaitForTransaction(accountId, key, receiverId, actions, description) {
    const transactionHash = await sendTransaction(
      accountId,
      key,
      receiverId,
      actions,
      description,
      { broadcastMethod: "broadcast_tx_async" },
    );
    const result = await waitFor(`${description} receipt`, async () => {
      try {
        const status = await rpc("tx", [transactionHash, accountId]);
        const complete = status.status && (
          Object.hasOwn(status.status, "SuccessValue")
          || Object.hasOwn(status.status, "Failure")
        );
        return complete
          ? { done: true, value: status }
          : { done: false, value: status.status };
      } catch (error) {
        if (shouldRetryTransactionLookup(error)) {
          return { done: false, value: String(error) };
        }
        throw error;
      }
    }, 120_000);
    assertTransactionSucceeded(result, description);
    result.transaction ??= { hash: transactionHash };
    return result;
  }

  async function escrow(commitmentId) {
    return view(CORE_ID, "get_escrow_status", { commitment_id: String(commitmentId) });
  }

  async function tranche(commitmentId) {
    return view(CORE_ID, "get_tranche", { commitment_id: String(commitmentId), epoch: "0" });
  }

  async function nativeCashSnapshot() {
    const cash = (await view(CORE_ID, "sandbox_native_cash_snapshot", {})).map(BigInt);
    assert.equal(cash[8], 0n, "native cash ledger must have no storage shortfall");
    return cash;
  }

  function nativeFreeMargin(cash) {
    return cash[0] - cash[1] - cash[2] - cash[3] - cash[4]
      - cash[5] - cash[6] - cash[7];
  }

  async function setNativeFreeMargin(target, description) {
    const before = await nativeCashSnapshot();
    const marginTx = await submitAndWaitForTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall("sandbox_set_native_free_margin", {
        target_free_balance_yocto: target.toString(),
      }, 100n * TERA)],
      `set free native cash margin for ${description}`,
    );
    const measurements = returnedJson(marginTx).map(BigInt);
    assert.equal(measurements[3] - measurements[5], target,
      `${description}: fixture did not set the requested native-cash margin`);
    assert.equal(measurements[6], target,
      `${description}: fixture did not preserve the requested target`);
    const after = await nativeCashSnapshot();
    const freeAfter = nativeFreeMargin(after);
    assert.equal(freeAfter, target,
      `${description}: view snapshot reports ${freeAfter}, expected ${target}`);
    assert.equal(after[6], before[6] + measurements[5] - measurements[4],
      `${description}: fixture liability differs from the ledger snapshot`);
    return {
      target_free_margin_yocto: target.toString(),
      account_balance_yocto: measurements[0].toString(),
      storage_cost_yocto: measurements[1].toString(),
      required_without_fixture_yocto: measurements[2].toString(),
      available_without_fixture_yocto: measurements[3].toString(),
      previous_fixture_liability_yocto: measurements[4].toString(),
      fixture_liability_yocto: measurements[5].toString(),
      free_after_fixture_yocto: freeAfter.toString(),
      cash_snapshot: after.map(String),
    };
  }

  async function clearNativeFreeMargin(description) {
    const cash = await nativeCashSnapshot();
    const available_without_fixture = cash[0] - cash[1] - cash[2] - cash[3]
      - cash[4] - cash[5] - cash[7];
    const cleared = await setNativeFreeMargin(available_without_fixture, description);
    const after = await nativeCashSnapshot();
    assert.equal(after[6], 0n, `${description}: fixture recovery-credit liability remains`);
    return cleared;
  }

  async function runRecoveryAcceptance(nodeStatus, tokenWasm, tokenCodeHash) {
    const results = {};
    const committee = Array.from({ length: 5 }, newKey)
      .sort((left, right) => Buffer.compare(left.publicKeyBytes, right.publicKeyBytes));
    const instanceId = randomBytes(32);
    assert.notEqual(instanceId.toString("hex"), "00".repeat(32));

    results.token_deploy = await deployAndWait(
      TOKEN_ID, tokenKey, tokenWasm, tokenCodeHash, "deploy recovery mock USDC",
    );
    await functionCall(TOKEN_ID, tokenKey, "new", {
      initial_holder: CORE_ID,
      initial_balance: INITIAL_TOKEN_BALANCE.toString(),
    });

    const bootstrapArgs = {
      genesis_hash: nodeStatus.genesis_hash,
      instance_id: instanceId.toString("hex"),
      committee_keys: committee.map((key) => key.publicKey),
      approved_usdc_code_hashes: [tokenCodeHash],
      active_usdc_code_hash: tokenCodeHash,
    };
    const weakPublicBytes = Buffer.alloc(32);
    weakPublicBytes[0] = 1;
    const weakCommittee = [
      ...committee.slice(0, 4),
      { publicKeyBytes: weakPublicBytes, publicKey: `ed25519:${base58Encode(weakPublicBytes)}` },
    ].sort((left, right) => Buffer.compare(left.publicKeyBytes, right.publicKeyBytes));
    const rejectedWeakBootstrap = await functionCall(
      CORE_ID,
      coreKey,
      "bootstrap_receipt_recovery",
      { args: { ...bootstrapArgs, committee_keys: weakCommittee.map((key) => key.publicKey) } },
      220n * TERA,
      ONE_NEAR,
      { expectFailure: true },
    );
    assert.equal(await view(CORE_ID, "receipt_recovery_configuration", {}), null,
      "weak-key bootstrap must leave recovery unconfigured and retryable");
    results.weak_committee_bootstrap = {
      rejected_transaction_hash: rejectedWeakBootstrap.transaction.hash,
      configuration_unchanged: true,
    };
    results.bootstrap = await functionCall(
      CORE_ID, coreKey, "bootstrap_receipt_recovery", { args: bootstrapArgs }, 220n * TERA, ONE_NEAR,
    );
    let config = await view(CORE_ID, "receipt_recovery_configuration", {});
    assert.equal(config.chain_id, nodeStatus.chain_id);
    assert.equal(config.token_account_id, TOKEN_ID);
    assert.equal(config.current_epoch, 0);
    assert.equal(config.used_key_count, 5);
    results.bootstrap_configuration = config;
    console.log("PASS local Sandbox bootstrap pins the mock token and five sorted recovery keys");

    const maximumEnvelope = maximumRecoveryEnvelope(committee);
    const maximumEnvelopeBytes = Buffer.from(maximumEnvelope.envelope, "base64");
    assert.equal(maximumEnvelope.intentBytes.length, 500, "maximum intent must use the configured 500-byte limit");
    assert.equal(maximumEnvelope.certificate.length, 714, "maximum certificate must use the configured 714-byte limit");
    assert.equal(maximumEnvelopeBytes.length, 1_202, "maximum envelope must use the configured 1,202-byte limit");
    assert.equal(maximumEnvelope.envelope.length, 1_604, "maximum Base64 must use the configured 1,604-character limit");
    const maximumEnvelopeTx = await functionCall(
      CORE_ID,
      coreKey,
      "sandbox_verify_maximum_recovery_envelope",
      { certificate_base64: maximumEnvelope.envelope },
      220n * TERA,
    );
    assert.equal(returnedJson(maximumEnvelopeTx), true,
      "contract VM must accept the canonical maximum-size 5-of-5 envelope");
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_configuration", {}), config,
      "read-only maximum envelope verification must not change recovery configuration");
    results.maximum_size_positive_contract_envelope = {
      transaction_hash: maximumEnvelopeTx.transaction.hash,
      intent_bytes: maximumEnvelope.intentBytes.length,
      certificate_bytes: maximumEnvelope.certificate.length,
      decoded_envelope_bytes: maximumEnvelopeBytes.length,
      encoded_base64_characters: maximumEnvelope.envelope.length,
      signature_count: 5,
      receipt_gas_burnt: (maximumEnvelopeTx.receipts_outcome ?? [])
        .reduce((sum, receipt) => sum + BigInt(receipt.outcome?.gas_burnt ?? 0), 0n).toString(),
      synthetic_fixture_only: true,
      settlement_state_unchanged: true,
    };
    console.log("PASS 500-byte intent and 1,202-byte 5-of-5 envelope in the contract VM parser");

    const recoveryIntent = (transferId) => view(CORE_ID, "receipt_recovery_intent", {
      transfer_id: String(transferId),
    });
    const queueRecovery = async (commitmentId, callbackGasTgas, description, options = {}) => {
      const actions = [actionFunctionCall("sandbox_queue_tranche_transfer", {
        commitment_id: String(commitmentId),
        token_account_id: TOKEN_ID,
        recipient: CASH_RECIPIENT_ID,
        amount_raw: AMOUNT.toString(),
        callback_gas_tgas: callbackGasTgas,
        recovery_enabled: true,
      }, 100n * TERA)];
      if (options.async) {
        return sendTransaction(CASH_RECIPIENT_ID, cashRecipientKey, CORE_ID, actions, description, {
          broadcastMethod: "broadcast_tx_async",
        });
      }
      const tx = await submitAndWaitForTransaction(
        CASH_RECIPIENT_ID, cashRecipientKey, CORE_ID, actions, description,
      );
      return { tx, transferId: String(returnedJson(tx)) };
    };
    const rootCall = (method, args, description, gas = 220n * TERA, deposit = 0n, expectFailure = false) =>
      sendTransaction("sandbox", rootKey, CORE_ID, [actionFunctionCall(method, args, gas, deposit)], description,
        expectFailure ? { expectFailure: true } : {});
    const creditPayerCall = (method, args, description, gas = 150n * TERA, expectFailure = false) =>
      sendTransaction(CASH_RECIPIENT_ID, cashRecipientKey, CORE_ID, [actionFunctionCall(method, args, gas)], description,
        expectFailure ? { expectFailure: true } : {});
    const assertEscrow = async (commitmentId, fields) => {
      const state = await escrow(commitmentId);
      for (const [field, expected] of Object.entries(fields)) {
        assert.equal(BigInt(state[field]), BigInt(expected), `${field} mismatch for commitment ${commitmentId}`);
      }
      assertConservation(state);
      return state;
    };

    const callbackFirst = await queueRecovery(101, 20, "recovery callback-first transfer");
    const callbackFirstState = await waitFor("callback-first recovery transfer", async () => {
      const state = await escrow(101);
      return state && BigInt(state.paid_raw) === AMOUNT && state.pending_raw === "0"
        ? { done: true, value: state } : { done: false, value: state };
    });
    assert.equal((await tranche(101)).status, "Paid");
    const callbackFirstIntent = await recoveryIntent(callbackFirst.transferId);
    assert.equal(callbackFirstIntent.terminal_outcome, "success");
    const callbackFirstCertificate = recoveryCertificate(callbackFirstIntent, "success", committee);
    await rootCall("recover_nep141_transfer", {
      transfer_id: callbackFirst.transferId,
      certificate_base64: callbackFirstCertificate.envelope,
    }, "reject recovery after callback settlement", 220n * TERA, 0n, true);
    await assertEscrow(101, { paid_raw: AMOUNT, pending_raw: 0n });
    results.callback_first = {
      transaction_hash: callbackFirst.tx.transaction.hash,
      transfer_id: callbackFirst.transferId,
      escrow: callbackFirstState,
      duplicate_recovery_rejected: true,
      recipient_token_balance: (await tokenBalance(CASH_RECIPIENT_ID)).toString(),
    };
    console.log("PASS callback-first settlement remains terminal and rejects a later certificate without double payment");

    const certFirst = await queueRecovery(102, 1, "recovery certificate-first transfer");
    const certFirstPending = await waitFor("callback-OOG token transfer remains pending", async () => {
      const [state, intent, balance] = await Promise.all([
        escrow(102), recoveryIntent(certFirst.transferId), tokenBalance(CASH_RECIPIENT_ID),
      ]);
      return state && intent && BigInt(state.pending_raw) === AMOUNT && intent.terminal_outcome === null
        && balance >= AMOUNT * 2n
        ? { done: true, value: { state, intent, balance } }
        : { done: false, value: { state, intent: intent?.terminal_outcome, balance: balance?.toString() } };
    });
    assert.equal((await tranche(102)).status, "Pending");
    const validCertFirst = recoveryCertificate(certFirstPending.intent, "success", committee);
    const fiveInvalidEnvelopeBytes = Buffer.from(
      signedEnvelope(validCertFirst.certificate, "LCP/NEP141/RECOVERY/V1\0", committee, 5),
      "base64",
    );
    const certificateLength = fiveInvalidEnvelopeBytes.readUInt32LE(0);
    const signatureCountOffset = 4 + certificateLength;
    assert.equal(fiveInvalidEnvelopeBytes.readUInt32LE(signatureCountOffset), 5);
    const firstSignatureOffset = signatureCountOffset + 4 + (5 * 32);
    for (let signatureIndex = 0; signatureIndex < 5; signatureIndex += 1) {
      fiveInvalidEnvelopeBytes[firstSignatureOffset + (signatureIndex * 96) + 32] ^= 1;
    }
    const invalidEnvelopes = [
      ["zero signatures", signedEnvelope(validCertFirst.certificate, "LCP/NEP141/RECOVERY/V1\0", committee, 0)],
      ["one signature", signedEnvelope(validCertFirst.certificate, "LCP/NEP141/RECOVERY/V1\0", committee, 1)],
      ["two signatures", signedEnvelope(validCertFirst.certificate, "LCP/NEP141/RECOVERY/V1\0", committee, 2)],
      ["three signatures", signedEnvelope(validCertFirst.certificate, "LCP/NEP141/RECOVERY/V1\0", committee, 3)],
      ["five invalid signatures", fiveInvalidEnvelopeBytes.toString("base64")],
      ["wrong signing domain", recoveryCertificate(certFirstPending.intent, "success", committee, "LCP/NEP141/RECOVERY/V0\0").envelope],
      ["mismatched intent digest", recoveryCertificate(certFirstPending.intent, "success", committee, "LCP/NEP141/RECOVERY/V1\0", sha256Bytes(Buffer.from("wrong intent digest"))).envelope],
      ["mutated signature", (() => {
        const bytes = Buffer.from(validCertFirst.envelope, "base64");
        bytes[bytes.length - 1] ^= 1;
        return bytes.toString("base64");
      })()],
      ...recoveryCertificateFieldMutations(validCertFirst.certificate, validCertFirst.intentBytes)
        .map(([label, certificate]) => [label, envelopeWithOriginalSignatures(validCertFirst.envelope, certificate)]),
      ...recoveryEnvelopeAdversarialCases(validCertFirst.envelope, validCertFirst.intentBytes, committee),
    ];
    for (const [label, envelope] of invalidEnvelopes) {
      await rootCall("recover_nep141_transfer", {
        transfer_id: certFirst.transferId,
        certificate_base64: envelope,
      }, `reject ${label} recovery certificate`, 220n * TERA, 0n, true);
      const intentAfterReject = await recoveryIntent(certFirst.transferId);
      assert.equal(intentAfterReject.terminal_outcome, null, `${label} altered the pending intent`);
      await assertEscrow(102, { pending_raw: AMOUNT, paid_raw: 0n, free_raw: 0n });
      assert.equal(await tokenBalance(CASH_RECIPIENT_ID), certFirstPending.balance,
        `${label} caused an extra token transfer`);
    }
    const certFirstRecoveryTx = await rootCall("recover_nep141_transfer", {
      transfer_id: certFirst.transferId,
      certificate_base64: validCertFirst.envelope,
    }, "settle certificate-first recovery", 220n * TERA);
    const certFirstState = await assertEscrow(102, { pending_raw: 0n, paid_raw: AMOUNT, free_raw: 0n });
    assert.equal((await tranche(102)).status, "Paid");
    assert.equal((await recoveryIntent(certFirst.transferId)).terminal_outcome, "success");
    await rootCall("recover_nep141_transfer", {
      transfer_id: certFirst.transferId,
      certificate_base64: validCertFirst.envelope,
    }, "reject replayed recovery certificate", 220n * TERA, 0n, true);
    const conflictingCertFirst = recoveryCertificate(certFirstPending.intent, "failure", committee);
    await rootCall("recover_nep141_transfer", {
      transfer_id: certFirst.transferId,
      certificate_base64: conflictingCertFirst.envelope,
    }, "reject conflicting outcome after recovery settlement", 220n * TERA, 0n, true);
    await assertEscrow(102, { pending_raw: 0n, paid_raw: AMOUNT, free_raw: 0n });
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), certFirstPending.balance,
      "replayed or conflicting certificate changed the token balance");
    results.certificate_first = {
      transaction_hash: certFirst.tx.transaction.hash,
      recovery_transaction_hash: certFirstRecoveryTx.transaction.hash,
      transfer_id: certFirst.transferId,
      rejected_certificates: invalidEnvelopes.map(([label]) => label),
      replay_rejected: true,
      conflicting_terminal_outcome_rejected: true,
      escrow: certFirstState,
      recovery_receipt_gas_burnt: (certFirstRecoveryTx.receipts_outcome ?? [])
        .reduce((sum, receipt) => sum + BigInt(receipt.outcome?.gas_burnt ?? 0), 0n).toString(),
      recipient_token_balance: (await tokenBalance(CASH_RECIPIENT_ID)).toString(),
    };
    console.log("PASS certificate-first recovery settles after callback OOG; 56 malformed, mutated, or replayed envelopes leave state unchanged");

    const crossTransferA = await queueRecovery(106, 1, "cross-transfer certificate source intent");
    const crossTransferB = await queueRecovery(107, 1, "cross-transfer certificate target intent");
    const crossTransferPending = await waitFor("two cross-transfer pending intents", async () => {
      const [stateA, intentA, stateB, intentB, balance] = await Promise.all([
        escrow(106), recoveryIntent(crossTransferA.transferId),
        escrow(107), recoveryIntent(crossTransferB.transferId),
        tokenBalance(CASH_RECIPIENT_ID),
      ]);
      const pending = stateA && stateB && intentA && intentB
        && BigInt(stateA.pending_raw) === AMOUNT && intentA.terminal_outcome === null
        && BigInt(stateB.pending_raw) === AMOUNT && intentB.terminal_outcome === null
        && balance === certFirstPending.balance + (AMOUNT * 2n);
      return pending
        ? { done: true, value: { stateA, intentA, stateB, intentB, balance } }
        : { done: false, value: { stateA, intentA: intentA?.terminal_outcome, stateB, intentB: intentB?.terminal_outcome, balance: balance?.toString() } };
    });
    const transferACertificate = recoveryCertificate(crossTransferPending.intentA, "success", committee);
    const rejectedCrossTransferTx = await rootCall("recover_nep141_transfer", {
      transfer_id: crossTransferB.transferId,
      certificate_base64: transferACertificate.envelope,
    }, "reject transfer A certificate against transfer B", 220n * TERA, 0n, true);
    assert.equal((await recoveryIntent(crossTransferA.transferId)).terminal_outcome, null,
      "cross-transfer rejection changed source intent");
    assert.equal((await recoveryIntent(crossTransferB.transferId)).terminal_outcome, null,
      "cross-transfer rejection changed target intent");
    await assertEscrow(106, { pending_raw: AMOUNT, paid_raw: 0n, free_raw: 0n });
    await assertEscrow(107, { pending_raw: AMOUNT, paid_raw: 0n, free_raw: 0n });
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), crossTransferPending.balance,
      "cross-transfer certificate rejection changed token balances");
    const crossTransferARecovery = await rootCall("recover_nep141_transfer", {
      transfer_id: crossTransferA.transferId,
      certificate_base64: transferACertificate.envelope,
    }, "settle source transfer with its own certificate", 220n * TERA);
    const transferBCertificate = recoveryCertificate(crossTransferPending.intentB, "success", committee);
    const crossTransferBRecovery = await rootCall("recover_nep141_transfer", {
      transfer_id: crossTransferB.transferId,
      certificate_base64: transferBCertificate.envelope,
    }, "settle target transfer with its own certificate", 220n * TERA);
    await assertEscrow(106, { pending_raw: 0n, paid_raw: AMOUNT, free_raw: 0n });
    await assertEscrow(107, { pending_raw: 0n, paid_raw: AMOUNT, free_raw: 0n });
    assert.equal((await recoveryIntent(crossTransferA.transferId)).terminal_outcome, "success");
    assert.equal((await recoveryIntent(crossTransferB.transferId)).terminal_outcome, "success");
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), crossTransferPending.balance,
      "certificate settlement must not repeat either completed token transfer");
    results.cross_transfer_certificate = {
      source_transfer_id: crossTransferA.transferId,
      target_transfer_id: crossTransferB.transferId,
      rejected_cross_transfer_transaction_hash: rejectedCrossTransferTx.transaction.hash,
      source_recovery_transaction_hash: crossTransferARecovery.transaction.hash,
      target_recovery_transaction_hash: crossTransferBRecovery.transaction.hash,
      both_pending_intents_unchanged_on_rejection: true,
      both_transfers_later_settled_with_own_certificate: true,
      no_duplicate_token_transfer: true,
    };
    console.log("PASS certificate for one pending transfer cannot settle another; both transfers later settle against their own intent");

    const fiveOfFiveBalanceBefore = await tokenBalance(CASH_RECIPIENT_ID);
    const fiveOfFiveTransfer = await queueRecovery(105, 1, "five-of-five recovery certificate");
    const fiveOfFivePending = await waitFor("five-of-five callback-OOG transfer", async () => {
      const [state, intent, balance] = await Promise.all([
        escrow(105), recoveryIntent(fiveOfFiveTransfer.transferId), tokenBalance(CASH_RECIPIENT_ID),
      ]);
      return state && intent && BigInt(state.pending_raw) === AMOUNT && intent.terminal_outcome === null
        && balance === fiveOfFiveBalanceBefore + AMOUNT
        ? { done: true, value: { state, intent, balance } }
        : { done: false, value: { state, intent: intent?.terminal_outcome, balance: balance?.toString() } };
    });
    const fiveOfFiveCertificate = recoveryCertificate(fiveOfFivePending.intent, "success", committee);
    const fiveOfFiveEnvelope = signedEnvelope(
      fiveOfFiveCertificate.certificate,
      "LCP/NEP141/RECOVERY/V1\0",
      committee,
      5,
    );
    const fiveOfFiveBytes = Buffer.from(fiveOfFiveEnvelope, "base64");
    assert.equal(fiveOfFiveBytes.readUInt32LE(4 + fiveOfFiveBytes.readUInt32LE(0)), 5,
      "positive maximum-quorum envelope must contain all five signatures");
    const fiveOfFiveTx = await rootCall("recover_nep141_transfer", {
      transfer_id: fiveOfFiveTransfer.transferId,
      certificate_base64: fiveOfFiveEnvelope,
    }, "settle five-of-five recovery certificate", 220n * TERA);
    const fiveOfFiveEscrow = await assertEscrow(105, { pending_raw: 0n, paid_raw: AMOUNT, free_raw: 0n });
    assert.equal((await tranche(105)).status, "Paid");
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), fiveOfFiveBalanceBefore + AMOUNT,
      "five-of-five certificate settlement must not duplicate the original token transfer");
    results.five_of_five_certificate = {
      transfer_transaction_hash: fiveOfFiveTransfer.tx.transaction.hash,
      recovery_transaction_hash: fiveOfFiveTx.transaction.hash,
      transfer_id: fiveOfFiveTransfer.transferId,
      signature_count: 5,
      envelope_bytes: fiveOfFiveBytes.length,
      recovery_receipt_gas_burnt: (fiveOfFiveTx.receipts_outcome ?? [])
        .reduce((sum, receipt) => sum + BigInt(receipt.outcome?.gas_burnt ?? 0), 0n).toString(),
      escrow: fiveOfFiveEscrow,
      token_balance: (await tokenBalance(CASH_RECIPIENT_ID)).toString(),
    };
    console.log("PASS maximum five-signature recovery envelope settles once with measured Sandbox receipt gas");

    const raceTransferId = String(Number(certFirst.transferId) + 1);
    const raceQueueHash = await queueRecovery(103, 20, "recovery callback-certificate race", { async: true });
    const raceIntentBeforeSettlement = await waitFor("race transfer intent", async () => {
      const intent = await recoveryIntent(raceTransferId);
      return intent ? { done: true, value: intent } : { done: false, value: null };
    });
    const raceCertificate = recoveryCertificate(raceIntentBeforeSettlement, "success", committee);
    const raceRecoveryHash = await sendTransaction("sandbox", rootKey, CORE_ID, [actionFunctionCall(
      "recover_nep141_transfer",
      { transfer_id: raceTransferId, certificate_base64: raceCertificate.envelope },
      220n * TERA,
    )], "submit concurrent recovery certificate", { broadcastMethod: "broadcast_tx_async" });
    await waitFor("callback and certificate race settlement", async () => {
      const state = await escrow(103);
      return state && state.pending_raw === "0" && BigInt(state.paid_raw) === AMOUNT
        ? { done: true, value: state } : { done: false, value: state };
    });
    const raceIntent = await recoveryIntent(raceTransferId);
    assert.equal(raceIntent.terminal_outcome, "success");
    assert.equal((await tranche(103)).status, "Paid");
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), fiveOfFiveBalanceBefore + (AMOUNT * 2n),
      "racing settlement paths must not duplicate the token payment");
    const raceRecoveryStatus = await waitFor("concurrent recovery transaction result", async () => {
      try {
        const status = await rpc("tx", [raceRecoveryHash, "sandbox"]);
        const complete = status.status && (Object.hasOwn(status.status, "SuccessValue") || Object.hasOwn(status.status, "Failure"));
        return complete ? { done: true, value: status } : { done: false, value: status.status };
      } catch (error) {
        if (shouldRetryTransactionLookup(error)) return { done: false, value: String(error) };
        throw error;
      }
    });
    const raceQueueStatus = await waitFor("concurrent transfer transaction result", async () => {
      try {
        const status = await rpc("tx", [raceQueueHash, CASH_RECIPIENT_ID]);
        const complete = status.status && (Object.hasOwn(status.status, "SuccessValue") || Object.hasOwn(status.status, "Failure"));
        return complete ? { done: true, value: status } : { done: false, value: status.status };
      } catch (error) {
        if (shouldRetryTransactionLookup(error)) return { done: false, value: String(error) };
        throw error;
      }
    });
    results.callback_certificate_race = {
      transfer_transaction_hash: raceQueueHash,
      recovery_transaction_hash: raceRecoveryHash,
      transfer_transaction_succeeded: !hasFailedExecution(raceQueueStatus),
      recovery_transaction_succeeded: !hasFailedExecution(raceRecoveryStatus),
      transfer_id: raceTransferId,
      terminal_outcome: raceIntent.terminal_outcome,
      certificate_digest: raceIntent.certificate_digest,
      escrow: await escrow(103),
      token_balance: (await tokenBalance(CASH_RECIPIENT_ID)).toString(),
    };
    console.log("PASS callback/certificate race produces one terminal tranche settlement and one token payment");

    await functionCall(TOKEN_ID, tokenKey, "set_fail_transfers", { fail: true });
    const failedTransfer = await queueRecovery(104, 1, "recovery failed-transfer callback OOG");
    const failedIntent = await waitFor("failed FT receipt with callback OOG", async () => {
      const [state, intent] = await Promise.all([escrow(104), recoveryIntent(failedTransfer.transferId)]);
      return state && intent && BigInt(state.pending_raw) === AMOUNT && intent.terminal_outcome === null
        ? { done: true, value: intent } : { done: false, value: { state, intent: intent?.terminal_outcome } };
    });
    const failureCertificate = recoveryCertificate(failedIntent, "failure", committee);
    const failedRecoveryTx = await rootCall("recover_nep141_transfer", {
      transfer_id: failedTransfer.transferId,
      certificate_base64: failureCertificate.envelope,
    }, "recover failed FT transfer", 220n * TERA);
    const failedRecovered = await assertEscrow(104, { pending_raw: 0n, paid_raw: 0n, free_raw: AMOUNT });
    assert.equal((await tranche(104)).status, "Failed");
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), fiveOfFiveBalanceBefore + (AMOUNT * 2n),
      "failed token execution must not change recipient balance");
    await functionCall(TOKEN_ID, tokenKey, "set_fail_transfers", { fail: false });
    const retry = await queueRecovery(104, 20, "retry certificate-recovered failed transfer");
    const retriedState = await waitFor("recovery failure retry settlement", async () => {
      const state = await escrow(104);
      return state && state.pending_raw === "0" && BigInt(state.paid_raw) === AMOUNT
        ? { done: true, value: state } : { done: false, value: state };
    });
    assert.equal((await tranche(104)).status, "Paid");
    assert.equal(await tokenBalance(CASH_RECIPIENT_ID), fiveOfFiveBalanceBefore + AMOUNT * 3n,
      "one successful retry must result in one token payment");
    results.failed_transfer_recovery = {
      initial_transaction_hash: failedTransfer.tx.transaction.hash,
      recovery_transaction_hash: failedRecoveryTx.transaction.hash,
      retry_transaction_hash: retry.tx.transaction.hash,
      transfer_id: failedTransfer.transferId,
      failed_escrow: failedRecovered,
      retry_escrow: retriedState,
      final_token_balance: (await tokenBalance(CASH_RECIPIENT_ID)).toString(),
    };
    console.log("PASS failure certificate frees the pending tranche; a new transfer ID retries and pays once");

    const transferIdForCredit = certFirst.transferId;
    const creditIntent = await recoveryIntent(transferIdForCredit);
    const creditId = creditIntent.refund_credit_id;
    const creditBeforeFinalize = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    const lowGasFinalize = await rootCall("finalize_receipt_recovery_intent", {
      transfer_id: transferIdForCredit,
    }, "reject recovery-intent storage release with insufficient gas", 1n * TERA, 0n, true);
    assert.ok(hasFailedExecution(lowGasFinalize));
    assert.deepEqual(await recoveryIntent(transferIdForCredit), creditIntent,
      "failed storage release must preserve the terminal intent for retry");
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditBeforeFinalize,
      "failed storage release must not mutate the payer credit");
    const finalizedIntentTx = await rootCall("finalize_receipt_recovery_intent", {
      transfer_id: transferIdForCredit,
    }, "finalize terminal recovery intent", 220n * TERA);
    assert.equal(returnedJson(finalizedIntentTx), true);
    assert.equal(await recoveryIntent(transferIdForCredit), null);
    let credit = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.ok(credit && BigInt(credit.accrued_yocto) > 0n, "finalized intent should accrue its measured storage bond");
    const creditBeforeRevaluation = credit;

    const directCreditCallback = await sendTransaction(
      RECIPIENT_ID,
      recipientKey,
      CORE_ID,
      [actionFunctionCall("on_receipt_recovery_credit_withdrawal", {
        credit_id_hex: creditId,
        amount: "1",
        nonce: "1",
      }, 150n * TERA)],
      "reject direct recovery-credit callback from another account",
      { expectFailure: true },
    );
    const creditAfterDirectCallback = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.deepEqual(creditAfterDirectCallback, creditBeforeRevaluation,
      "external direct callback must not mutate the credit");

    const unauthorizedCreditWithdrawal = await sendTransaction(
      RECIPIENT_ID,
      recipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_receipt_recovery_credit", { credit_id_hex: creditId }, 150n * TERA)],
      "reject recovery-credit withdrawal by a different account",
      { expectFailure: true },
    );
    const creditAfterUnauthorizedWithdrawal = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.deepEqual(creditAfterUnauthorizedWithdrawal, creditBeforeRevaluation,
      "non-payer withdrawal attempt must not mutate the credit");

    const attachedDepositWithdrawal = await sendTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_receipt_recovery_credit", { credit_id_hex: creditId }, 150n * TERA, 1n)],
      "reject attached deposit on recovery-credit withdrawal",
      { expectFailure: true },
    );
    const creditAfterDepositAttempt = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.deepEqual(creditAfterDepositAttempt, creditBeforeRevaluation,
      "attached-deposit rejection must not mutate the credit");

    const beginCreditCallbackTx = await creditPayerCall(
      "sandbox_begin_recovery_credit_callback_fixture",
      { credit_id_hex: creditId },
      "fixture a payer-authorized in-flight recovery-credit withdrawal",
      150n * TERA,
    );
    const [callbackAmount, callbackNonce] = returnedJson(beginCreditCallbackTx).map(BigInt);
    assert.ok(callbackAmount > 0n);
    const creditWithWithdrawalInFlight = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(creditWithWithdrawalInFlight.state, "withdrawing");
    assert.equal(BigInt(creditWithWithdrawalInFlight.in_flight_yocto), callbackAmount);
    const mismatchedAmountCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: (callbackAmount + 1n).toString(),
      nonce: callbackNonce.toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore recovery-credit callback with mismatched amount", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditWithWithdrawalInFlight,
      "mismatched callback amount must preserve the in-flight payer credit");
    const mismatchedNonceCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: callbackAmount.toString(),
      nonce: (callbackNonce + 1n).toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore recovery-credit callback with mismatched nonce", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditWithWithdrawalInFlight,
      "mismatched callback nonce must preserve the in-flight payer credit");
    const zeroResultCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: callbackAmount.toString(),
      nonce: callbackNonce.toString(),
      result_count: 0,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore recovery-credit callback without a promise result", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditWithWithdrawalInFlight,
      "callback with zero promise results must preserve the in-flight payer credit");
    const multipleResultCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: callbackAmount.toString(),
      nonce: callbackNonce.toString(),
      result_count: 2,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore recovery-credit callback with multiple promise results", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditWithWithdrawalInFlight,
      "callback with multiple promise results must preserve the in-flight payer credit");
    const nonemptyResultCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: callbackAmount.toString(),
      nonce: callbackNonce.toString(),
      result_count: 1,
      result_too_long: true,
      result_succeeds: true,
    }, "ignore recovery-credit callback with an unexpected successful payload", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditWithWithdrawalInFlight,
      "callback with a nonempty successful result must preserve the in-flight payer credit");
    const failedExactCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: callbackAmount.toString(),
      nonce: callbackNonce.toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: false,
    }, "restore the payer credit after an exact failed callback", 220n * TERA, 0n, true);
    const creditAfterFailedCallback = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(creditAfterFailedCallback.state, "refund_pending");
    assert.equal(creditAfterFailedCallback.accrued_yocto, creditWithWithdrawalInFlight.accrued_yocto);
    assert.equal(BigInt(creditAfterFailedCallback.in_flight_yocto), 0n);

    const retryCreditCallbackTx = await creditPayerCall(
      "sandbox_begin_recovery_credit_callback_fixture",
      { credit_id_hex: creditId },
      "begin a newer recovery-credit withdrawal attempt",
      150n * TERA,
    );
    const [retryCallbackAmount, retryCallbackNonce] = returnedJson(retryCreditCallbackTx).map(BigInt);
    assert.equal(retryCallbackAmount, callbackAmount);
    assert.equal(retryCallbackNonce, callbackNonce + 1n);
    const creditWithRetryInFlight = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(creditWithRetryInFlight.state, "withdrawing");
    const staleCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: retryCallbackAmount.toString(),
      nonce: callbackNonce.toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore a stale callback from the previous withdrawal attempt", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditWithRetryInFlight,
      "stale callback from a previous nonce must preserve the newer in-flight credit");
    const failedRetryCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: retryCallbackAmount.toString(),
      nonce: retryCallbackNonce.toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: false,
    }, "restore the credit after the newer withdrawal fails", 220n * TERA, 0n, true);
    const creditAfterRetryFailure = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(creditAfterRetryFailure.state, "refund_pending");
    assert.equal(creditAfterRetryFailure.accrued_yocto, creditAfterFailedCallback.accrued_yocto);
    assert.equal(BigInt(creditAfterRetryFailure.in_flight_yocto), 0n);
    const duplicateCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: retryCallbackAmount.toString(),
      nonce: retryCallbackNonce.toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore a duplicate callback after the attempt has failed", 220n * TERA);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), creditAfterRetryFailure,
      "duplicate callback after failure must not change the retryable credit");

    await rootCall("sandbox_mark_recovery_storage_price_stale", {}, "fixture a stale reserve price", 100n * TERA);
    const beginRevaluationTx = await rootCall("begin_recovery_storage_revaluation", {}, "begin storage-reserve revaluation", 100n * TERA);
    assert.equal(returnedJson(beginRevaluationTx), true);
    credit = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(credit.storage_reserve_ready, false);
    const blockedWithdrawal = await creditPayerCall("withdraw_receipt_recovery_credit", {
      credit_id_hex: creditId,
    }, "reject withdrawal during storage revaluation", 150n * TERA, true);
    assert.ok(hasFailedExecution(blockedWithdrawal));
    let nextIndex = 0;
    const revaluation = [];
    for (let batches = 0; batches < 100; batches += 1) {
      const batchTx = await rootCall("revalue_recovery_storage_batch", {
        start_index: nextIndex,
        limit: 16,
      }, `revalue storage bonds from ${nextIndex}`, 180n * TERA);
      const result = returnedJson(batchTx);
      revaluation.push(result);
      if (result.status === "complete") break;
      assert.equal(result.status, "in_progress", `unexpected reserve revaluation status ${result.status}`);
      nextIndex = result.next_record_index;
      assert.ok(batches < 99, "storage-reserve revaluation did not complete within 100 batches");
    }
    credit = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(credit.storage_reserve_ready, true);
    assert.equal(credit.withdrawal_available, true);
    const withdrawable = BigInt(credit.withdrawable_yocto);
    assert.ok(withdrawable > 1n);

    await setNativeFreeMargin(withdrawable - 1n, "one-yocto-short recovery-credit withdrawal");
    credit = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(credit.cash_solvency_ready, true);
    assert.equal(credit.withdrawal_cash_margin_ready, false);
    assert.equal(credit.withdrawal_available, false);
    assert.equal(BigInt(credit.withdrawal_outflow_yocto), withdrawable);
    const shortWithdrawal = await creditPayerCall("withdraw_receipt_recovery_credit", {
      credit_id_hex: creditId,
    }, "reject one-yocto-short recovery-credit withdrawal", 150n * TERA, true);
    assert.ok(hasFailedExecution(shortWithdrawal));
    credit = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
    assert.equal(credit.state, "refund_pending");
    assert.equal(BigInt(credit.accrued_yocto), withdrawable);
    assert.equal(BigInt(credit.in_flight_yocto), 0n);

    const delayedCallbackSteps = 8;
    const delayConfiguration = await rootCall("sandbox_set_recovery_credit_callback_delay", {
      delay_steps: delayedCallbackSteps,
    }, "configure eight intermediate callback receipts", 100n * TERA);
    await setNativeFreeMargin(withdrawable, "exact recovery-credit withdrawal boundary");
    const payerBalanceBefore = await accountBalance(CASH_RECIPIENT_ID);
    const exactWithdrawalHash = String(await sendTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_receipt_recovery_credit", { credit_id_hex: creditId }, 150n * TERA)],
      "withdraw recovery credit at exact cash margin with delayed callback",
      { broadcastMethod: "broadcast_tx_async" },
    ));
    const exactWithdrawal = await waitFor("delayed recovery-credit callback", async () => {
      let status;
      try {
        status = await rpc("tx", [exactWithdrawalHash, CASH_RECIPIENT_ID]);
      } catch (error) {
        if (shouldRetryTransactionLookup(error)) {
          return { done: false, value: String(error) };
        }
        throw error;
      }
      const complete = status.status && (
        Object.hasOwn(status.status, "SuccessValue")
        || Object.hasOwn(status.status, "Failure")
      );
      return complete
        ? { done: true, value: status }
        : { done: false, value: status.status };
    }, 120_000);
    assert.ok(!hasFailedExecution(exactWithdrawal),
      `delayed recovery-credit withdrawal failed: ${JSON.stringify(exactWithdrawal.status)}`);
    const delayedCallbackReceipts = (exactWithdrawal.receipts_outcome ?? []).flatMap((receipt, index) =>
      (receipt.outcome?.logs ?? []).flatMap((line) => {
        const match = line.match(/^LCP_RECOVERY_DELAY_CASH step=(\d+) state=withdrawing in_flight=(\d+) C=(\d+) S=(\d+) E=(\d+) R=(\d+) O=(\d+) Q=(\d+) F=(\d+) X=(\d+) shortfall=(\d+)$/);
        return match ? [{ receipt_index: index, receipt_id: receipt.id, block_hash: receipt.block_hash,
          step: Number(match[1]), in_flight: BigInt(match[2]), C: BigInt(match[3]), S: BigInt(match[4]),
          E: BigInt(match[5]), R: BigInt(match[6]), O: BigInt(match[7]), Q: BigInt(match[8]),
          F: BigInt(match[9]), X: BigInt(match[10]), shortfall: BigInt(match[11]) }] : [];
      }));
    assert.deepEqual(delayedCallbackReceipts.map(({ step }) => step),
      Array.from({ length: delayedCallbackSteps }, (_, index) => index + 1),
    "all delayed callback receipts must execute in order before settlement");
    const delayedCashPhases = await Promise.all(delayedCallbackReceipts.map(async (phase) => {
      assert.equal(phase.in_flight, withdrawable,
        `delayed callback step ${phase.step} must preserve the exact withdrawal attempt`);
      const required = phase.S + phase.E + phase.R + phase.O + phase.Q + phase.F + phase.X;
      assert.equal(phase.C, required,
        `delayed callback step ${phase.step} must preserve the exact zero-free-cash boundary`);
      assert.equal(phase.shortfall, 0n);
      assert.ok(phase.Q >= withdrawable,
        `delayed callback step ${phase.step} must keep the entire credit as a liability`);
      const block = await rpc("block", { block_id: phase.block_hash });
      return {
        step: phase.step,
        receipt_id: phase.receipt_id,
        block_height: block.header.height,
        account_balance_yocto: phase.C.toString(),
        required_balance_yocto: required.toString(),
        free_cash_yocto: (phase.C - required).toString(),
        recovery_credit_liability_yocto: phase.Q.toString(),
        scheduled_outflow_yocto: phase.X.toString(),
      };
    }));
    const callbackOutcome = (exactWithdrawal.receipts_outcome ?? []).find((receipt) =>
      receipt.outcome?.executor_id === CORE_ID
      && (receipt.outcome?.logs ?? []).some((line) =>
        line.includes('"event":"receipt_recovery_credit_withdrawn"')));
    const payerTransferOutcome = (exactWithdrawal.receipts_outcome ?? []).find((receipt) =>
      receipt.outcome?.executor_id === CASH_RECIPIENT_ID);
    assert.ok(callbackOutcome, "production withdrawal callback must settle after delayed receipts");
    assert.ok(payerTransferOutcome, "native transfer receipt must appear before callback settlement");
    const [transferBlock, callbackBlock] = await Promise.all([
      rpc("block", { block_id: payerTransferOutcome.block_hash }),
      rpc("block", { block_id: callbackOutcome.block_hash }),
    ]);
    assert.ok(callbackBlock.header.height > transferBlock.header.height,
      "production callback must settle in a later block than the payer transfer");
    console.log(`PASS exact-margin payer withdrawal preserves solvency across ${delayedCallbackSteps} delayed callback receipts`);
    const withdrawalFees = BigInt(exactWithdrawal.transaction_outcome?.outcome?.tokens_burnt ?? 0)
      + (exactWithdrawal.receipts_outcome ?? []).reduce(
        (sum, receipt) => sum + BigInt(receipt.outcome?.tokens_burnt ?? 0), 0n,
      );
    const payerBalanceAfter = await waitFor("recovery-credit NEAR withdrawal", async () => {
      const balance = await accountBalance(CASH_RECIPIENT_ID);
      return balance + withdrawalFees >= payerBalanceBefore + withdrawable
        ? { done: true, value: balance } : { done: false, value: balance.toString() };
    });
    const creditAfter = await waitFor("recovery-credit callback closes its row", async () => {
      const row = await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId });
      return row === null ? { done: true, value: null } : { done: false, value: row };
    });
    assert.equal(payerBalanceAfter + withdrawalFees, payerBalanceBefore + withdrawable,
      "payer balance delta must equal the recovery credit after accounting for transaction gas");
    const duplicateSettledCallbackNonce = retryCallbackNonce + 1n;
    const duplicateSettledCallbackTx = await rootCall("sandbox_queue_recovery_credit_callback_fixture", {
      credit_id_hex: creditId,
      amount: withdrawable.toString(),
      nonce: duplicateSettledCallbackNonce.toString(),
      result_count: 1,
      result_too_long: false,
      result_succeeds: true,
    }, "ignore recovery-credit callback replay after successful settlement", 220n * TERA);
    assert.equal(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), null,
      "duplicate callback after settlement must not recreate the closed credit row");

    const duplicateWithdrawal = await creditPayerCall("withdraw_receipt_recovery_credit", {
      credit_id_hex: creditId,
    }, "reject recovery-credit withdrawal replay after settlement", 150n * TERA, true);
    assert.equal(await view(CORE_ID, "receipt_recovery_credit", { credit_id_hex: creditId }), null,
      "replayed withdrawal must not recreate the settled credit");
    assert.equal(duplicateWithdrawal.receipts_outcome.length, 1,
      "replayed withdrawal must fail before scheduling a transfer or callback");
    const payerBalanceAfterDuplicate = await accountBalance(CASH_RECIPIENT_ID);

    results.recovery_credit = {
      credit_id: creditId,
      initial_credit: creditBeforeRevaluation,
      storage_release_low_gas_failure_transaction_hash: lowGasFinalize.transaction.hash,
      storage_release_retry_transaction_hash: finalizedIntentTx.transaction.hash,
      permissionless_storage_release_retry: true,
      direct_callback_transaction_hash: directCreditCallback.transaction.hash,
      direct_callback_rejected_without_mutation: true,
      unauthorized_withdrawal_transaction_hash: unauthorizedCreditWithdrawal.transaction.hash,
      unauthorized_withdrawal_preserved_credit: true,
      attached_deposit_rejection_transaction_hash: attachedDepositWithdrawal.transaction.hash,
      attached_deposit_rejection_preserved_credit: true,
      callback_attempt_transaction_hash: beginCreditCallbackTx.transaction.hash,
      callback_attempt_amount_yocto: callbackAmount.toString(),
      callback_attempt_nonce: callbackNonce.toString(),
      mismatched_amount_callback_transaction_hash: mismatchedAmountCallbackTx.transaction.hash,
      mismatched_amount_callback_preserved_withdrawing_credit: true,
      mismatched_nonce_callback_transaction_hash: mismatchedNonceCallbackTx.transaction.hash,
      mismatched_nonce_callback_preserved_withdrawing_credit: true,
      zero_result_callback_transaction_hash: zeroResultCallbackTx.transaction.hash,
      zero_result_callback_preserved_withdrawing_credit: true,
      multiple_result_callback_transaction_hash: multipleResultCallbackTx.transaction.hash,
      multiple_result_callback_preserved_withdrawing_credit: true,
      nonempty_result_callback_transaction_hash: nonemptyResultCallbackTx.transaction.hash,
      nonempty_result_callback_preserved_withdrawing_credit: true,
      exact_failed_callback_transaction_hash: failedExactCallbackTx.transaction.hash,
      exact_failed_callback_restored_refund_pending_credit: true,
      retry_callback_attempt_transaction_hash: retryCreditCallbackTx.transaction.hash,
      retry_callback_attempt_nonce: retryCallbackNonce.toString(),
      stale_callback_transaction_hash: staleCallbackTx.transaction.hash,
      stale_callback_preserved_newer_withdrawing_credit: true,
      failed_retry_callback_transaction_hash: failedRetryCallbackTx.transaction.hash,
      failed_retry_callback_restored_refund_pending_credit: true,
      duplicate_callback_transaction_hash: duplicateCallbackTx.transaction.hash,
      duplicate_callback_preserved_refund_pending_credit: true,
      revaluation_batches: revaluation,
      blocked_during_revaluation: true,
      one_yocto_short_rejected: true,
      exact_withdrawal_transaction_hash: exactWithdrawalHash,
      delayed_callback_configuration_transaction_hash: delayConfiguration.transaction.hash,
      delayed_callback_steps: delayedCallbackSteps,
      delayed_callback_receipts: delayedCashPhases,
      transfer_block_height: transferBlock.header.height,
      callback_block_height: callbackBlock.header.height,
      callback_delay_blocks: callbackBlock.header.height - transferBlock.header.height,
      duplicate_settled_callback_transaction_hash: duplicateSettledCallbackTx.transaction.hash,
      duplicate_settled_callback_did_not_recreate_credit: true,
      payer_balance_before: payerBalanceBefore.toString(),
      payer_balance_after: payerBalanceAfter.toString(),
      payer_transaction_gas_fee_yocto: withdrawalFees.toString(),
      replayed_withdrawal_transaction_hash: duplicateWithdrawal.transaction.hash,
      replayed_withdrawal_rejected: true,
      replayed_withdrawal_receipt_count: duplicateWithdrawal.receipts_outcome.length,
      payer_balance_after_replay: payerBalanceAfterDuplicate.toString(),
      credit_after_callback: creditAfter,
      tombstone_cleanup: "successful callback removed the settled zero-credit row",
    };
    console.log("PASS reserve revaluation blocks withdrawal; exact cash margin pays the credit and cleans the settled row");

    const stagedFirst = 11n;
    const stagedSecond = 17n;
    const firstNativeBefore = await accountBalance(ORDER_A_ID);
    const secondNativeBefore = await accountBalance(ORDER_B_ID);
    const underfundedStaged = await rootCall("sandbox_probe_native_staged_outflows", {
      first_recipient: ORDER_A_ID,
      second_recipient: ORDER_B_ID,
      first_outflow_yocto: stagedFirst.toString(),
      second_outflow_yocto: stagedSecond.toString(),
      underfund_by_one: true,
    }, "reject one-yocto-short staged outflows", 120n * TERA, 0n, true);
    assert.ok(hasFailedExecution(underfundedStaged));
    assert.equal(await accountBalance(ORDER_A_ID), firstNativeBefore);
    assert.equal(await accountBalance(ORDER_B_ID), secondNativeBefore);
    const exactStaged = await functionCall(CORE_ID, coreKey, "sandbox_probe_native_staged_outflows", {
      first_recipient: ORDER_A_ID,
      second_recipient: ORDER_B_ID,
      first_outflow_yocto: stagedFirst.toString(),
      second_outflow_yocto: stagedSecond.toString(),
      underfund_by_one: false,
    }, 120n * TERA);
    const stagedMeasures = returnedJson(exactStaged).map(BigInt);
    assert.equal(stagedMeasures[1], stagedMeasures[0]);
    assert.equal(stagedMeasures[2], stagedMeasures[0] - stagedFirst - stagedSecond);
    assert.equal(await waitFor("first staged native outflow", async () => {
      const balance = await accountBalance(ORDER_A_ID);
      return balance === firstNativeBefore + stagedFirst ? { done: true, value: balance } : { done: false, value: balance.toString() };
    }), firstNativeBefore + stagedFirst);
    assert.equal(await accountBalance(ORDER_B_ID), secondNativeBefore + stagedSecond);
    results.staged_native_outflows = {
      balance_before: stagedMeasures[0].toString(),
      balance_after_builders: stagedMeasures[1].toString(),
      balance_after_materialization: stagedMeasures[2].toString(),
      total_outflow: (stagedFirst + stagedSecond).toString(),
      underfunded_gate_rejected_before_promises: true,
    };
    console.log("PASS combined cash gate reserves both staged transfer actions before promise materialization");
    results.staged_native_outflows.fixture_margin_cleanup = await clearNativeFreeMargin(
      "staged native outflow fixture cleanup",
    );

    const existingCredit = 5n * 10n ** 21n;
    const firstRefund = 7n * 10n ** 21n;
    const secondRefund = 9n * 10n ** 21n;
    const refundTotal = existingCredit + firstRefund + secondRefund;
    const aggregateTx = await functionCall(
      CORE_ID,
      coreKey,
      "sandbox_queue_two_storage_refund_failures",
      {
        payer: CASH_RECIPIENT_ID,
        existing_credit_yocto: existingCredit.toString(),
        first_refund_yocto: firstRefund.toString(),
        second_refund_yocto: secondRefund.toString(),
      },
      180n * TERA,
      refundTotal,
    );
    const attemptIds = returnedJson(aggregateTx).map(String);
    await waitFor("both failed refund callbacks aggregate credit", async () => {
      const [creditBalance, attempts] = await Promise.all([
        view(CORE_ID, "get_storage_refund_balance", { account_id: CASH_RECIPIENT_ID }),
        Promise.all(attemptIds.map((attemptId) => view(CORE_ID, "sandbox_refund_attempt_exists", { attempt_id: attemptId }))),
      ]);
      return BigInt(creditBalance) === refundTotal && attempts.every((present) => !present)
        ? { done: true, value: { creditBalance, attempts } }
        : { done: false, value: { creditBalance, attempts } };
    });
    assert.equal(BigInt(await view(CORE_ID, "get_storage_refund_balance", { account_id: CASH_RECIPIENT_ID })), refundTotal);
    const legacyCash = (await nativeCashSnapshot()).map(BigInt);
    assert.equal(legacyCash[3], refundTotal, "aggregate liability must include the existing credit and both failed attempts once");
    for (const attemptId of attemptIds) {
      await functionCall(CORE_ID, coreKey, "on_storage_refund_attempt", { attempt_id: attemptId });
    }
    assert.equal(BigInt(await view(CORE_ID, "get_storage_refund_balance", { account_id: CASH_RECIPIENT_ID })), refundTotal,
      "stale duplicate callbacks must not credit the payer twice");
    results.failed_refund_aggregation = {
      transaction_hash: aggregateTx.transaction.hash,
      attempt_ids: attemptIds,
      prior_credit_yocto: existingCredit.toString(),
      first_failure_yocto: firstRefund.toString(),
      second_failure_yocto: secondRefund.toString(),
      final_credit_yocto: refundTotal.toString(),
      aggregate_liability_yocto: legacyCash[3].toString(),
      stale_duplicate_callbacks_ignored: true,
    };
    console.log("PASS two independent failed callbacks aggregate onto the same existing credit without duplicate liability");

    const rotationKeys = Array.from({ length: 5 }, newKey)
      .sort((left, right) => Buffer.compare(left.publicKeyBytes, right.publicKeyBytes));
    const genesisHash = base58Decode(config.genesis_hash);
    const blockBeforeGovernance = await rpc("block", { finality: "final" });
    const nowNs = BigInt(blockBeforeGovernance.header.timestamp_nanosec);
    // Sandbox-only build uses a ten-second rotation delay; release builds
    // continue to enforce seven days. Leave enough signed slack for the local
    // RPC and transaction-signing round trip before the proposal is recorded.
    const minDelay = 10_000_000_000n;
    const activationSlack = 30_000_000_000n;
    const cancelProposalMessage = buildRotationMessage(
      config, nodeStatus.chain_id, genesisHash, CORE_ID, 0, 1, 1, rotationKeys, nowNs + minDelay + activationSlack,
    );
    const cancelProposalEnvelope = signedEnvelope(
      cancelProposalMessage, "LCP/NEP141/COMMITTEE-ROTATION/V2\0", committee,
    );
    const cancelledProposalTx = await functionCall(
      CORE_ID, coreKey, "propose_receipt_recovery_rotation", {
        signed_proposal_base64: cancelProposalEnvelope,
      }, 220n * TERA, ONE_NEAR,
    );
    const cancelledProposal = returnedJson(cancelledProposalTx);
    assert.equal(cancelledProposal.new_epoch, 1);
    assert.equal((await view(CORE_ID, "receipt_recovery_configuration", {})).pending_rotation.proposal_generation, "1");
    const cancelMessage = Buffer.concat([
      u8(2),
      borshString(nodeStatus.chain_id),
      genesisHash,
      borshString(CORE_ID),
      Buffer.from(config.instance_id, "hex"),
      u32(0),
      u32(1),
      u64(1),
      hexBytes(cancelledProposal.proposal_digest),
    ]);
    const cancelEnvelope = signedEnvelope(
      cancelMessage, "LCP/NEP141/ROTATION-CANCEL/V2\0", committee,
    );
    await functionCall(CORE_ID, coreKey, "cancel_receipt_recovery_rotation", {
      signed_cancellation_base64: cancelEnvelope,
    }, 180n * TERA);
    config = await view(CORE_ID, "receipt_recovery_configuration", {});
    assert.equal(config.pending_rotation, null);
    assert.equal(config.current_epoch, 0);
    await rootCall("cancel_receipt_recovery_rotation", {
      signed_cancellation_base64: cancelEnvelope,
    }, "reject replayed rotation cancellation", 180n * TERA, 0n, true);
    const replayedProposal = await rootCall("propose_receipt_recovery_rotation", {
      signed_proposal_base64: cancelProposalEnvelope,
    }, "reject canceled committee proposal replay", 220n * TERA, 0n, true);
    config = await view(CORE_ID, "receipt_recovery_configuration", {});
    assert.equal(config.last_rotation_generation, "1");
    assert.equal(config.pending_rotation, null);

    const activationBase = BigInt((await rpc("block", { finality: "final" })).header.timestamp_nanosec);
    const activationAt = activationBase + minDelay + activationSlack;
    const activateMessage = buildRotationMessage(
      config, nodeStatus.chain_id, genesisHash, CORE_ID, 0, 1, 2, rotationKeys, activationAt,
    );
    const activateEnvelope = signedEnvelope(
      activateMessage, "LCP/NEP141/COMMITTEE-ROTATION/V2\0", committee,
    );
    const activationProposalTx = await functionCall(
      CORE_ID, coreKey, "propose_receipt_recovery_rotation", {
        signed_proposal_base64: activateEnvelope,
      }, 220n * TERA, ONE_NEAR,
    );
    const activationProposal = returnedJson(activationProposalTx);
    assert.equal(activationProposal.proposal_generation, "2");
    assert.equal(activationProposal.activate_at_ns, activationAt.toString());
    const earlyActivation = await rootCall(
      "activate_receipt_recovery_rotation",
      {},
      "reject committee activation before its delay",
      220n * TERA,
      0n,
      true,
    );
    assert.ok(hasFailedExecution(earlyActivation));
    let observedTimestamp = BigInt((await rpc("block", { finality: "final" })).header.timestamp_nanosec);
    let fastForwardCalls = 0;
    while (observedTimestamp < activationAt && fastForwardCalls < 12) {
      const remainingNs = activationAt - observedTimestamp;
      const deltaHeight = Number((remainingNs + 299_999_999n) / 300_000_000n + 2n);
      await rpc("sandbox_fast_forward", { delta_height: deltaHeight });
      fastForwardCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      observedTimestamp = BigInt((await rpc("block", { finality: "final" })).header.timestamp_nanosec);
    }
    assert.ok(observedTimestamp >= activationAt,
      `Sandbox time did not reach governance boundary ${activationAt}; observed ${observedTimestamp}`);
    const activationTx = await rootCall("activate_receipt_recovery_rotation", {}, "activate delayed committee rotation", 220n * TERA);
    const activeConfig = await view(CORE_ID, "receipt_recovery_configuration", {});
    assert.equal(activeConfig.current_epoch, 1);
    assert.equal(activeConfig.used_key_count, 10);
    assert.deepEqual(activeConfig.current_committee_keys, rotationKeys.map((key) => key.publicKey));
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_committee", { epoch: 0 }), committee.map((key) => key.publicKey));
    const oldCommitteeReplayMessage = buildRotationMessage(
      activeConfig, nodeStatus.chain_id, genesisHash, CORE_ID, 1, 2, 3, committee, observedTimestamp + minDelay + 120_000_000_000n,
    );
    const oldCommitteeReplay = signedEnvelope(
      oldCommitteeReplayMessage, "LCP/NEP141/COMMITTEE-ROTATION/V2\0", committee,
    );
    await rootCall("propose_receipt_recovery_rotation", {
      signed_proposal_base64: oldCommitteeReplay,
    }, "reject retired committee governance signatures", 220n * TERA, 0n, true);
    const retireTx = await rootCall("retire_receipt_recovery_epoch", { epoch: 0 }, "retire unused prior committee epoch", 180n * TERA);
    assert.equal(returnedJson(retireTx), true);
    assert.equal(await view(CORE_ID, "receipt_recovery_committee", { epoch: 0 }), null);
    const reusedCommitteeKeys = [
      ...rotationKeys.slice(0, 4),
      committee[0],
    ].sort((left, right) => Buffer.compare(left.publicKeyBytes, right.publicKeyBytes));
    const reuseNow = BigInt((await rpc("block", { finality: "final" })).header.timestamp_nanosec);
    const reusedKeyMessage = buildRotationMessage(
      activeConfig,
      nodeStatus.chain_id,
      genesisHash,
      CORE_ID,
      1,
      2,
      3,
      reusedCommitteeKeys,
      reuseNow + minDelay + activationSlack,
    );
    const reusedKeyEnvelope = signedEnvelope(
      reusedKeyMessage,
      "LCP/NEP141/COMMITTEE-ROTATION/V2\0",
      rotationKeys,
    );
    await rootCall("propose_receipt_recovery_rotation", {
      signed_proposal_base64: reusedKeyEnvelope,
    }, "reject historical key reuse after prior epoch retirement", 220n * TERA, 0n, true);
    const configAfterReusedKey = await view(CORE_ID, "receipt_recovery_configuration", {});
    assert.equal(configAfterReusedKey.current_epoch, 1);
    assert.equal(configAfterReusedKey.last_rotation_generation, "2");
    assert.equal(configAfterReusedKey.used_key_count, 10);
    assert.equal(configAfterReusedKey.pending_rotation, null);
    results.governance = {
      proposal_cancel_transaction_hash: cancelledProposalTx.transaction.hash,
      activation_proposal_transaction_hash: activationProposalTx.transaction.hash,
      activation_transaction_hash: activationTx.transaction.hash,
      canceled_proposal_replay_rejected: !hasFailedExecution(replayedProposal) ? false : true,
      historical_key_reuse_after_retirement_rejected: true,
      early_activation_rejected: true,
      canceled_generation: cancelledProposal.proposal_generation,
      activated_generation: activationProposal.proposal_generation,
      fast_forward_calls: fastForwardCalls,
      activation_at_ns: activationAt.toString(),
      observed_activation_time_ns: observedTimestamp.toString(),
      active_epoch: activeConfig.current_epoch,
      retired_epoch_zero: returnedJson(retireTx),
      old_committee_replay_rejected: true,
    };
    console.log("PASS signed rotation proposal/cancellation, delayed Sandbox activation, old-key rejection, and epoch retirement");

    const overflowPayer = RECIPIENT_ID;
    const overflowIdTx = await functionCall(CORE_ID, coreKey, "sandbox_queue_refund_credit_overflow_callback", {
      payer: overflowPayer,
    }, 120n * TERA);
    const overflowAttemptId = String(returnedJson(overflowIdTx));
    const overflowResult = await waitFor("overflow callback receipt rollback", async () => {
      try {
        const status = await rpc("tx", [overflowIdTx.transaction.hash, CORE_ID]);
        const receipt = (status.receipts_outcome ?? []).find((item) =>
          item.outcome?.executor_id === CORE_ID && (item.outcome?.logs ?? []).some((line) => line.includes("refund credit overflow")));
        const failed = (status.receipts_outcome ?? []).some((item) =>
          item.outcome?.executor_id === CORE_ID && isFailedExecution(item.outcome?.status));
        return failed ? { done: true, value: { status, receipt } } : { done: false, value: status.status };
      } catch (error) {
        if (shouldRetryTransactionLookup(error)) return { done: false, value: String(error) };
        throw error;
      }
    });
    assert.equal(await view(CORE_ID, "sandbox_refund_attempt_exists", { attempt_id: overflowAttemptId }), true,
      "NEAR receipt rollback must restore the removed refund attempt after the overflow panic");
    assert.equal(BigInt(await view(CORE_ID, "get_storage_refund_balance", { account_id: overflowPayer })), (1n << 128n) - 1n);
    results.overflow_receipt_rollback = {
      setup_transaction_hash: overflowIdTx.transaction.hash,
      callback_attempt_id: overflowAttemptId,
      callback_failed_on_credit_overflow: true,
      attempt_present_after_receipt_failure: true,
      refund_credit_remains_u128_max: true,
      receipt_status: overflowResult.receipt?.outcome?.status ?? null,
    };
    console.log("PASS overflow panic rolls back failed-attempt deletion in an actual Sandbox callback receipt");

    const callbackOogSource = await queueRecovery(108, 20, "create a recovery credit for callback-OOG acceptance");
    const callbackOogTerminal = await waitFor("callback-OOG source transfer settlement", async () => {
      const [state, intent] = await Promise.all([
        escrow(108), recoveryIntent(callbackOogSource.transferId),
      ]);
      return state && intent?.terminal_outcome === "success" && BigInt(state.paid_raw) === AMOUNT
        ? { done: true, value: { state, intent } }
        : { done: false, value: { state, terminal_outcome: intent?.terminal_outcome } };
    });
    const callbackOogFinalizeTx = await rootCall("finalize_receipt_recovery_intent", {
      transfer_id: callbackOogSource.transferId,
    }, "finalize callback-OOG source recovery intent", 220n * TERA);
    assert.equal(returnedJson(callbackOogFinalizeTx), true);
    const callbackOogCreditId = callbackOogTerminal.intent.refund_credit_id;
    const callbackOogCreditBefore = await view(CORE_ID, "receipt_recovery_credit", {
      credit_id_hex: callbackOogCreditId,
    });
    const callbackOogAmount = BigInt(callbackOogCreditBefore.accrued_yocto);
    assert.equal(callbackOogCreditBefore.state, "available");
    assert.ok(callbackOogAmount > 0n);
    await setNativeFreeMargin(ONE_NEAR / 10n, "recovery-credit callback-OOG withdrawal");
    const callbackOogCreditReady = await view(CORE_ID, "receipt_recovery_credit", {
      credit_id_hex: callbackOogCreditId,
    });
    assert.ok(callbackOogCreditReady.withdrawal_available,
      "funded callback-OOG scenario must pass the production withdrawal gate");
    const callbackOogPayerBalanceBefore = await accountBalance(CASH_RECIPIENT_ID);
    const callbackOogWithdrawal = await creditPayerCall(
      "sandbox_withdraw_recovery_credit_callback_oog_fixture",
      { credit_id_hex: callbackOogCreditId },
      "pay recovery credit with an underfunded callback",
      150n * TERA,
    );
    assert.ok(hasFailedExecution(callbackOogWithdrawal),
      "the intentionally underfunded recovery-credit callback must fail");
    const callbackOogReceipt = (callbackOogWithdrawal.receipts_outcome ?? []).find((item) =>
      item.outcome?.executor_id === CORE_ID && isFailedExecution(item.outcome?.status));
    assert.ok(callbackOogReceipt, "missing failed recovery-credit callback receipt");
    const callbackOogFailure = JSON.stringify(callbackOogReceipt.outcome.status.Failure);
    assert.match(callbackOogFailure, /gas|prepaid|exceed/i,
      `the one-Tgas callback should fail because it is underfunded: ${callbackOogFailure}`);
    assert.ok(BigInt(callbackOogReceipt.outcome.gas_burnt) > 0n);
    const callbackOogTransferReceipt = (callbackOogWithdrawal.receipts_outcome ?? []).find((item) =>
      item.outcome?.executor_id === CASH_RECIPIENT_ID
      && item.outcome?.status && Object.hasOwn(item.outcome.status, "SuccessValue"));
    assert.ok(callbackOogTransferReceipt, "the payer transfer must succeed before callback OOG");
    const callbackOogFees = BigInt(callbackOogWithdrawal.transaction_outcome?.outcome?.tokens_burnt ?? 0)
      + (callbackOogWithdrawal.receipts_outcome ?? []).reduce(
        (sum, receipt) => sum + BigInt(receipt.outcome?.tokens_burnt ?? 0), 0n,
      );
    const callbackOogPayerBalanceAfter = await waitFor("callback-OOG payer transfer", async () => {
      const balance = await accountBalance(CASH_RECIPIENT_ID);
      return balance + callbackOogFees >= callbackOogPayerBalanceBefore + callbackOogAmount
        ? { done: true, value: balance }
        : { done: false, value: balance.toString() };
    });
    assert.equal(callbackOogPayerBalanceAfter + callbackOogFees,
      callbackOogPayerBalanceBefore + callbackOogAmount,
      "the transfer must pay exactly the accrued credit after transaction gas");
    const callbackOogCreditAfter = await view(CORE_ID, "receipt_recovery_credit", {
      credit_id_hex: callbackOogCreditId,
    });
    assert.equal(callbackOogCreditAfter.state, "withdrawing");
    assert.equal(callbackOogCreditAfter.accrued_yocto, callbackOogCreditBefore.accrued_yocto);
    assert.equal(BigInt(callbackOogCreditAfter.in_flight_yocto), callbackOogAmount);
    assert.equal(callbackOogCreditAfter.withdrawal_available, false);
    const replayAfterCallbackOog = await creditPayerCall("withdraw_receipt_recovery_credit", {
      credit_id_hex: callbackOogCreditId,
    }, "block second payment while the recovery callback is unresolved", 150n * TERA, true);
    assert.deepEqual(await view(CORE_ID, "receipt_recovery_credit", {
      credit_id_hex: callbackOogCreditId,
    }), callbackOogCreditAfter,
    "an unresolved callback must keep the paid credit reserved and block a second transfer");
    results.recovery_credit_callback_oog = {
      source_transfer_transaction_hash: callbackOogSource.tx.transaction.hash,
      intent_finalization_transaction_hash: callbackOogFinalizeTx.transaction.hash,
      callback_oog_withdrawal_transaction_hash: callbackOogWithdrawal.transaction.hash,
      callback_oog_receipt_id: callbackOogReceipt.id,
      callback_oog_gas_burnt: String(callbackOogReceipt.outcome.gas_burnt),
      callback_oog_failure: callbackOogFailure,
      transfer_receipt_id: callbackOogTransferReceipt.id,
      amount_yocto: callbackOogAmount.toString(),
      payer_balance_before: callbackOogPayerBalanceBefore.toString(),
      payer_balance_after: callbackOogPayerBalanceAfter.toString(),
      total_transaction_gas_fee_yocto: callbackOogFees.toString(),
      successful_transfer_callback_failed: true,
      credit_remains_withdrawing_and_reserved: true,
      replay_transaction_hash: replayAfterCallbackOog.transaction.hash,
      replay_rejected_without_state_change: true,
    };
    console.log("PASS successful recovery-credit transfer plus callback OOG leaves its liability reserved and blocks replay");

    return results;
  }

  async function tokenBalance(accountId, tokenAccountId = TOKEN_ID) {
    return BigInt(await view(tokenAccountId, "ft_balance_of", { account_id: accountId }));
  }

  function assertConservation(status) {
    const funded = BigInt(status.funded_raw);
    const settled = BigInt(status.paid_raw) + BigInt(status.refunded_raw)
      + BigInt(status.pending_raw) + BigInt(status.free_raw);
    assert.equal(funded, settled, "raw-unit escrow conservation failed");
  }

  try {
    const nodeStatus = await rpc("status", []);
    assert.equal(nodeStatus.protocol_version, 88, "fixture requires NEAR protocol 88");
    fixtures.node = {
      sandbox_version: "2.14.0",
      protocol_version: nodeStatus.protocol_version,
      chain_id: nodeStatus.chain_id,
      genesis_hash: nodeStatus.genesis_hash,
      version: nodeStatus.version,
    };

    const coreWasm = await readFile(join(wasmDir, "lcp_core.wasm"));
    const tokenWasm = await readFile(join(wasmDir, "sandbox_mock_ft.wasm"));
    const tokenVariantBWasm = await readFile(join(wasmDir, "sandbox_mock_ft_variant_b.wasm"));
    const codeHashV1 = base58Encode(createHash("sha256").update(tokenWasm).digest());
    const codeHashV2 = base58Encode(createHash("sha256").update(tokenVariantBWasm).digest());
    const codeHashCore = base58Encode(createHash("sha256").update(coreWasm).digest());
    fixtures.artifacts = {
      lcp_core_fixture: {
        wasm_sha256: createHash("sha256").update(coreWasm).digest("hex"),
        near_code_hash: codeHashCore,
      },
      mock_ft_variant_a: {
        wasm_sha256: createHash("sha256").update(tokenWasm).digest("hex"),
        near_code_hash: codeHashV1,
      },
      mock_ft_variant_b: {
        wasm_sha256: createHash("sha256").update(tokenVariantBWasm).digest("hex"),
        near_code_hash: codeHashV2,
      },
    };
    await createSubaccount(CORE_ID, coreKey);
    await createSubaccount(TOKEN_ID, tokenKey);
    await createSubaccount(NO_CODE_TOKEN_ID, noCodeTokenKey);
    await createSubaccount(ORDER_A_ID, orderAKey);
    await createSubaccount(ORDER_B_ID, orderBKey);
    await createSubaccount(CASH_RECIPIENT_ID, cashRecipientKey);
    await createSubaccount(RECIPIENT_ID, recipientKey);

    fixtures.core_deploy_transaction = await deployAndWait(
      CORE_ID,
      coreKey,
      coreWasm,
      codeHashCore,
      "deploy fixture core",
    );
    await functionCall(CORE_ID, coreKey, "new", {});

    const marginTopUpYocto = 1n * 10n ** 24n;
    const coreBalanceBeforeTopUp = await accountBalance(CORE_ID, "optimistic");
    const topUpTransaction = await sendTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionTransfer(marginTopUpYocto)],
      "fund isolated core native liquidity margin",
    );
    assert.ok(!hasFailedExecution(topUpTransaction), "native liquidity top-up must settle successfully");
    const coreBalanceAfterTopUp = await waitFor("isolated core liquidity top-up", async () => {
      const balance = await accountBalance(CORE_ID, "optimistic");
      return balance >= coreBalanceBeforeTopUp + marginTopUpYocto
        ? { done: true, value: balance }
        : {
          done: false,
          value: {
            minimum: (coreBalanceBeforeTopUp + marginTopUpYocto).toString(),
            observed: balance.toString(),
          },
        };
    });
    fixtures.native_liquidity_funding = {
      transaction_hash: topUpTransaction.transaction.hash,
      source_account: "sandbox",
      target_account: CORE_ID,
      action: "Transfer",
      amount_yocto: marginTopUpYocto.toString(),
      target_balance_before: coreBalanceBeforeTopUp.toString(),
      target_balance_after: coreBalanceAfterTopUp.toString(),
      observed_balance_delta: (coreBalanceAfterTopUp - coreBalanceBeforeTopUp).toString(),
    };
    console.log("PASS a plain NEAR transfer funds isolated-instance liquidity margin without a contract call");

    if (process.env.LCP_RECOVERY_ONLY === "1") {
      fixtures.recovery_acceptance = await runRecoveryAcceptance(nodeStatus, tokenWasm, codeHashV1);
      const fixturePath = process.env.LCP_FIXTURE_OUTPUT;
      if (fixturePath) {
        await writeFile(fixturePath, `${JSON.stringify({
          fixture_schema: "lcp.receipt-recovery-sandbox-acceptance.v1",
          captured_at: new Date().toISOString(),
          node: fixtures.node,
          wasm_artifacts: fixtures.artifacts,
          scenarios: fixtures.recovery_acceptance,
        }, null, 2)}\n`);
      }
      console.log("All isolated receipt-recovery Sandbox checks passed; no public network was used.");
      return;
    }

    const cashRecipientBalanceBeforeProbe = await accountBalance(CASH_RECIPIENT_ID);
    const underfundedProbe = await functionCall(CORE_ID, coreKey, "sandbox_probe_native_cash_gate", {
      recipient: CASH_RECIPIENT_ID,
      outflow_yocto: "1",
      underfund_by_one: true,
    }, 100n * TERA, 0n, { expectFailure: true });
    assert.ok(hasFailedExecution(underfundedProbe),
      "one-yocto-underfunded promise must fail at the native cash gate");
    const cashRecipientBalanceAfterFailedProbe = await accountBalance(CASH_RECIPIENT_ID);
    assert.equal(cashRecipientBalanceAfterFailedProbe, cashRecipientBalanceBeforeProbe,
      "failed solvency check must roll back the native transfer promise");

    const balancedProbe = await functionCall(CORE_ID, coreKey, "sandbox_probe_native_cash_gate", {
      recipient: CASH_RECIPIENT_ID,
      outflow_yocto: "1",
      underfund_by_one: false,
    }, 100n * TERA);
    const [balanceBefore, balanceAfterBuilder, balanceAfterMaterialization, storageCost, liability] =
      returnedJson(balancedProbe).map(BigInt);
    console.log("CASH_BOUNDARY_PROBE", JSON.stringify({
      balance_before: balanceBefore.toString(),
      balance_after_builder: balanceAfterBuilder.toString(),
      balance_after_materialization: balanceAfterMaterialization.toString(),
      storage_cost: storageCost.toString(),
      seeded_liability: liability.toString(),
      finalized_account_balance: (await accountBalance(CORE_ID)).toString(),
    }));
    assert.equal(balanceAfterBuilder, balanceBefore,
      "creating a lazy SDK Promise builder must not yet materialize a host action");
    assert.equal(balanceAfterMaterialization, balanceBefore - 1n,
      "materializing the one-yocto transfer action must deduct its value from the host balance");
    assert.equal(storageCost + liability + 1n, balanceBefore,
      "the explicit outflow reserve must make the exact-balance control solvent");
    const cashRecipientBalanceAfterExactProbe = await waitFor("exactly funded one-yocto transfer", async () => {
      const balance = await accountBalance(CASH_RECIPIENT_ID);
      return balance === cashRecipientBalanceBeforeProbe + 1n
        ? { done: true, value: balance }
        : { done: false, value: balance.toString() };
    });
    fixtures.native_cash_gate = {
      underfunded: {
        transaction_hash: underfundedProbe.transaction.hash,
        receipt_outcomes: underfundedProbe.receipts_outcome.map((outcome) => ({
          id: outcome.id,
          status: outcome.outcome?.status,
        })),
        recipient_balance_before: cashRecipientBalanceBeforeProbe.toString(),
        recipient_balance_after: cashRecipientBalanceAfterFailedProbe.toString(),
      },
      exact_balance: {
        transaction_hash: balancedProbe.transaction.hash,
        receipt_measurements: {
          balance_before: balanceBefore.toString(),
          balance_after_sdk_builder: balanceAfterBuilder.toString(),
          balance_after_host_materialization: balanceAfterMaterialization.toString(),
          storage_cost: storageCost.toString(),
          liability: liability.toString(),
        },
        recipient_balance_before: cashRecipientBalanceBeforeProbe.toString(),
        recipient_balance_after: cashRecipientBalanceAfterExactProbe.toString(),
      },
    };
    console.log("PASS protocol-88 cash gate explicitly reserves promise outflows, rejects one yocto short, and settles the exact-balance control");
    if (process.env.LCP_CASH_GATE_ONLY === "1") {
      console.log("All focused native cash gate checks passed; no public network was used.");
      return;
    }

    const nativeCommitmentId = "90";
    const nativeTrancheAmount = 10n ** 22n;
    await functionCall(CORE_ID, coreKey, "sandbox_seed_native_claimable_commitment", {
      commitment_id: nativeCommitmentId,
      beneficiary: CASH_RECIPIENT_ID,
      amount_yocto: nativeTrancheAmount.toString(),
    }, 100n * TERA);
    await functionCall(CORE_ID, coreKey, "sandbox_set_next_transfer_recipient", {
      commitment_id: nativeCommitmentId,
      recipient: "missing-native-recipient.sandbox",
    });

    const nativeClaimAction = () => actionFunctionCall(
      "claim_tranche",
      { commitment_id: nativeCommitmentId },
      100n * TERA,
      1n * 10n ** 24n,
    );
    const failedNativeClaimTx = await submitAndWaitForTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [nativeClaimAction()],
      "native tranche claim with missing recipient",
    );
    const failedNativeClaim = await waitFor("failed native payout callback", async () => {
      const [tranche, escrowState, cash] = await Promise.all([
        view(CORE_ID, "get_tranche", {
          commitment_id: nativeCommitmentId,
          epoch: "0",
        }),
        view(CORE_ID, "get_escrow_status", { commitment_id: nativeCommitmentId }),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (tranche?.status === "Failed"
        && BigInt(cash[2]) === nativeTrancheAmount
        && BigInt(cash[3]) === 0n
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { tranche, escrowState, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: {
          tranche_status: tranche?.status,
          escrow_state: escrowState,
          cash: cash.map(String),
        },
      };
    });
    const failedNativeClaimReceiptTree = await rpc("tx", [
      failedNativeClaimTx.transaction.hash,
      CASH_RECIPIENT_ID,
    ]);
    assert.ok(
      failedNativeClaimReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"tranche_transfer_failed"'))),
      "native failure receipt tree must include the successful failure-reconciliation callback",
    );
    assert.ok(
      failedNativeClaimReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"excess_storage_refund_sent"'))),
      "native failure receipt tree must include the successful excess-refund callback",
    );
    assert.equal(failedNativeClaim.escrowState.pending_yocto, "0");
    assert.equal(failedNativeClaim.escrowState.free_yocto, nativeTrancheAmount.toString());
    assert.ok(
      failedNativeClaim.cash[0] >= failedNativeClaim.cash[1] + failedNativeClaim.cash[2],
      "failed native transfer must leave the recorded escrow liability cash-backed",
    );
    console.log("NATIVE_CLAIM_RETRY_PRE_STATE", JSON.stringify({
      cash: failedNativeClaim.cash.map(String),
      escrow: failedNativeClaim.escrowState,
      tranche_status: failedNativeClaim.tranche.status,
    }));

    const successfulNativeClaimTx = await submitAndWaitForTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [nativeClaimAction()],
      "native tranche claim retry",
    );
    const successfulNativeClaim = await waitFor("successful native payout callback", async () => {
      const [tranche, escrowState, cash] = await Promise.all([
        view(CORE_ID, "get_tranche", {
          commitment_id: nativeCommitmentId,
          epoch: "0",
        }),
        view(CORE_ID, "get_escrow_status", { commitment_id: nativeCommitmentId }),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (tranche?.status === "Paid"
        && BigInt(escrowState.paid_yocto) === nativeTrancheAmount
        && BigInt(cash[2]) === 0n
        && BigInt(cash[3]) === 0n
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { tranche, escrowState, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: {
          tranche_status: tranche?.status,
          escrow_state: escrowState,
          cash: cash.map(String),
        },
      };
    });
    const successfulNativeClaimReceiptTree = await rpc("tx", [
      successfulNativeClaimTx.transaction.hash,
      CASH_RECIPIENT_ID,
    ]);
    assert.ok(
      successfulNativeClaimReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"tranche_paid"'))),
      "native retry receipt tree must include the successful payout-reconciliation callback",
    );
    assert.ok(
      successfulNativeClaimReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"excess_storage_refund_sent"'))),
      "native retry receipt tree must include the successful excess-refund callback",
    );
    assert.equal(successfulNativeClaim.escrowState.pending_yocto, "0");
    assert.equal(successfulNativeClaim.escrowState.free_yocto, "0");
    assert.ok(
      successfulNativeClaim.cash[0] >= successfulNativeClaim.cash[1],
      "successful native payout must leave account balance above storage cost",
    );
    fixtures.native_claim_callback = {
      commitment_id: nativeCommitmentId,
      amount_yocto: nativeTrancheAmount.toString(),
      failure: {
        transaction_hash: failedNativeClaimTx.transaction.hash,
        transaction_outcome: failedNativeClaimReceiptTree.transaction_outcome,
        receipts_outcome: failedNativeClaimReceiptTree.receipts_outcome,
        recipient: "missing-native-recipient.sandbox",
        tranche_status: failedNativeClaim.tranche.status,
        escrow_state: failedNativeClaim.escrowState,
        cash_snapshot: failedNativeClaim.cash.map(String),
      },
      retry_success: {
        transaction_hash: successfulNativeClaimTx.transaction.hash,
        transaction_outcome: successfulNativeClaimReceiptTree.transaction_outcome,
        receipts_outcome: successfulNativeClaimReceiptTree.receipts_outcome,
        tranche_status: successfulNativeClaim.tranche.status,
        escrow_state: successfulNativeClaim.escrowState,
        cash_snapshot: successfulNativeClaim.cash.map(String),
      },
    };
    console.log("PASS production native claim path preserves failed escrow and clears liability after successful retry");

    const nativeRefundCommitmentId = "91";
    const nativeRefundAmount = nativeTrancheAmount;
    const nativeRefundSafeMargin = ONE_NEAR + (2n * nativeRefundAmount)
      + NATIVE_STORAGE_MARGIN_BUFFER;
    const operationsFunded = nativeTrancheAmount * 2n;
    const operationsSpent = nativeTrancheAmount;
    await functionCall(CORE_ID, coreKey, "sandbox_seed_closed_native_refund_commitment", {
      commitment_id: nativeRefundCommitmentId,
      sponsor: "sandbox",
      beneficiary: CASH_RECIPIENT_ID,
      escrow_amount_yocto: nativeRefundAmount.toString(),
      operations_funded_yocto: operationsFunded.toString(),
      operations_spent_yocto: operationsSpent.toString(),
    }, 100n * TERA);

    await functionCall(CORE_ID, coreKey, "sandbox_set_next_transfer_recipient", {
      commitment_id: nativeRefundCommitmentId,
      recipient: "missing-native-refund-recipient.sandbox",
    });
    const nativeLiquidityMargin = {};
    nativeLiquidityMargin.escrow_one_transfer_gate = await setNativeFreeMargin(
      nativeRefundAmount,
      "native escrow refund one-transfer margin gate",
    );
    const insufficientNativeEscrowRefundTx = await sendTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall(
        "refund_remaining",
        { commitment_id: nativeRefundCommitmentId },
        100n * TERA,
        ONE_NEAR,
      )],
      "native escrow refund with one-transfer free margin",
      { expectFailure: true },
    );
    const insufficientNativeEscrowRefundLogs = (insufficientNativeEscrowRefundTx.receipts_outcome ?? [])
      .flatMap((receipt) => receipt.outcome?.logs ?? []);
    assert.ok(insufficientNativeEscrowRefundLogs.some((log) =>
      log.includes("SANDBOX_CASH_GATE_FAILED")),
    "one-transfer native escrow margin must fail at the cash solvency gate");
    assert.ok(!insufficientNativeEscrowRefundLogs.some((log) =>
      log.includes('"event":"escrow_refund_requested"')),
    "underfunded escrow refund must stop before its payout promise is requested");
    const insufficientNativeEscrowRefundReceipt = insufficientNativeEscrowRefundTx.receipts_outcome
      ?.find((receipt) => receipt.outcome?.executor_id === CORE_ID
        && isFailedExecution(receipt.outcome?.status));
    assert.ok(insufficientNativeEscrowRefundReceipt,
      "insufficient native refund margin must fail in the core receipt");
    const escrowStateAtInsufficientMargin = await escrow(nativeRefundCommitmentId);
    const cashAtInsufficientEscrowMargin = await nativeCashSnapshot();
    assert.equal(escrowStateAtInsufficientMargin.pending_yocto, "0",
      "insufficient native margin must not leave an escrow refund pending");
    assert.equal(escrowStateAtInsufficientMargin.free_yocto, nativeRefundAmount.toString(),
      "insufficient native margin must preserve the refundable escrow amount");
    assert.deepEqual(
      cashAtInsufficientEscrowMargin.map(String),
      nativeLiquidityMargin.escrow_one_transfer_gate.cash_snapshot,
      "insufficient native refund margin must preserve contract balance and liabilities",
    );
    nativeLiquidityMargin.escrow_one_transfer_gate_result = {
      transaction_hash: insufficientNativeEscrowRefundTx.transaction.hash,
      receipt_logs: insufficientNativeEscrowRefundLogs,
      receipt_outcomes: insufficientNativeEscrowRefundTx.receipts_outcome?.map((receipt) => ({
        id: receipt.id,
        executor_id: receipt.outcome?.executor_id,
        status: receipt.outcome?.status,
        receipt_ids: receipt.outcome?.receipt_ids,
      })),
      escrow_state: escrowStateAtInsufficientMargin,
      cash_snapshot: cashAtInsufficientEscrowMargin.map(String),
    };
    nativeLiquidityMargin.escrow_failure = await setNativeFreeMargin(
      nativeRefundSafeMargin,
      "native escrow refund failure with callback reserve",
    );
    const failedNativeEscrowRefundTx = await submitAndWaitForTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall(
        "refund_remaining",
        { commitment_id: nativeRefundCommitmentId },
        100n * TERA,
        ONE_NEAR,
      )],
      "native escrow refund with missing recipient",
    );
    const failedNativeEscrowRefund = await waitFor("failed native escrow refund callback", async () => {
      const [escrowState, cash, receiptTree] = await Promise.all([
        escrow(nativeRefundCommitmentId),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
        rpc("tx", [failedNativeEscrowRefundTx.transaction.hash, "sandbox"]),
      ]);
      if (escrowState?.pending_yocto === "0"
        && escrowState.free_yocto === nativeRefundAmount.toString()
        && escrowState.refunded_yocto === "0"
        && BigInt(cash[2]) === nativeRefundAmount
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { escrowState, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: {
          escrowState,
          cash: cash.map(String),
          receipts: receiptTree.receipts_outcome?.map(({ id, outcome }) => ({
            id,
            executor_id: outcome.executor_id,
            status: outcome.status,
            logs: outcome.logs,
          })),
        },
      };
    });
    const failedNativeEscrowRefundReceiptTree = await rpc("tx", [
      failedNativeEscrowRefundTx.transaction.hash,
      "sandbox",
    ]);
    assert.ok(
      failedNativeEscrowRefundReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"escrow_refund_failed"'))),
      "native escrow refund receipt tree must include the failure-reconciliation callback",
    );
    assert.ok(
      failedNativeEscrowRefundReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"excess_storage_refund_sent"'))),
      "native escrow refund receipt tree must include the excess-refund callback",
    );

    nativeLiquidityMargin.escrow_retry = await setNativeFreeMargin(
      nativeRefundSafeMargin,
      "native escrow refund retry",
    );
    const successfulNativeEscrowRefundTx = await submitAndWaitForTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall(
        "refund_remaining",
        { commitment_id: nativeRefundCommitmentId },
        100n * TERA,
        ONE_NEAR,
      )],
      "native escrow refund retry",
    );
    const successfulNativeEscrowRefund = await waitFor("successful native escrow refund callback", async () => {
      const [escrowState, cash] = await Promise.all([
        escrow(nativeRefundCommitmentId),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (escrowState?.pending_yocto === "0"
        && escrowState.free_yocto === "0"
        && escrowState.refunded_yocto === nativeRefundAmount.toString()
        && BigInt(cash[2]) === 0n
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { escrowState, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: { escrowState, cash: cash.map(String) },
      };
    });
    const successfulNativeEscrowRefundReceiptTree = await rpc("tx", [
      successfulNativeEscrowRefundTx.transaction.hash,
      "sandbox",
    ]);
    assert.ok(
      successfulNativeEscrowRefundReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"escrow_refunded"'))),
      "native escrow refund retry must include the successful settlement callback",
    );
    fixtures.native_escrow_refund_callback = {
      commitment_id: nativeRefundCommitmentId,
      amount_yocto: nativeRefundAmount.toString(),
      failure: {
        transaction_hash: failedNativeEscrowRefundTx.transaction.hash,
        transaction_outcome: failedNativeEscrowRefundReceiptTree.transaction_outcome,
        receipts_outcome: failedNativeEscrowRefundReceiptTree.receipts_outcome,
        escrow_state: failedNativeEscrowRefund.escrowState,
        cash_snapshot: failedNativeEscrowRefund.cash.map(String),
      },
      retry_success: {
        transaction_hash: successfulNativeEscrowRefundTx.transaction.hash,
        transaction_outcome: successfulNativeEscrowRefundReceiptTree.transaction_outcome,
        receipts_outcome: successfulNativeEscrowRefundReceiptTree.receipts_outcome,
        escrow_state: successfulNativeEscrowRefund.escrowState,
        cash_snapshot: successfulNativeEscrowRefund.cash.map(String),
      },
    };
    console.log("PASS production native escrow refund preserves liability on failure and releases it on retry");

    await functionCall(CORE_ID, coreKey, "sandbox_set_next_transfer_recipient", {
      commitment_id: nativeRefundCommitmentId,
      recipient: "missing-operations-refund-recipient.sandbox",
    });
    nativeLiquidityMargin.operations_failure = await setNativeFreeMargin(
      nativeRefundSafeMargin,
      "native operations refund failure",
    );
    const failedNativeOperationsRefundTx = await submitAndWaitForTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall(
        "refund_unused_operations",
        { commitment_id: nativeRefundCommitmentId },
        100n * TERA,
        ONE_NEAR,
      )],
      "native operations refund with missing recipient",
    );
    const failedNativeOperationsRefund = await waitFor("failed operations refund callback", async () => {
      const [commitment, cash] = await Promise.all([
        view(CORE_ID, "get_commitment", { commitment_id: nativeRefundCommitmentId }),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (commitment?.pending_transfer_count === 0
        && commitment.operations_funded_yocto === operationsFunded.toString()
        && BigInt(cash[5]) === nativeRefundAmount
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { commitment, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: { commitment, cash: cash.map(String) },
      };
    });
    const failedNativeOperationsRefundReceiptTree = await rpc("tx", [
      failedNativeOperationsRefundTx.transaction.hash,
      "sandbox",
    ]);
    assert.ok(
      failedNativeOperationsRefundReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"operations_refund_failed"'))),
      "native operations refund receipt tree must include the failure-reconciliation callback",
    );

    nativeLiquidityMargin.operations_retry = await setNativeFreeMargin(
      nativeRefundSafeMargin,
      "native operations refund retry",
    );
    const successfulNativeOperationsRefundTx = await submitAndWaitForTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall(
        "refund_unused_operations",
        { commitment_id: nativeRefundCommitmentId },
        100n * TERA,
        ONE_NEAR,
      )],
      "native operations refund retry",
    );
    const successfulNativeOperationsRefund = await waitFor("successful operations refund callback", async () => {
      const [commitment, cash] = await Promise.all([
        view(CORE_ID, "get_commitment", { commitment_id: nativeRefundCommitmentId }),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (commitment?.pending_transfer_count === 0
        && commitment.operations_funded_yocto === operationsSpent.toString()
        && BigInt(cash[5]) === 0n
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { commitment, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: { commitment, cash: cash.map(String) },
      };
    });
    const successfulNativeOperationsRefundReceiptTree = await rpc("tx", [
      successfulNativeOperationsRefundTx.transaction.hash,
      "sandbox",
    ]);
    assert.ok(
      successfulNativeOperationsRefundReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"operations_refunded"'))),
      "native operations refund retry must include the successful settlement callback",
    );
    fixtures.native_operations_refund_callback = {
      commitment_id: nativeRefundCommitmentId,
      amount_yocto: nativeRefundAmount.toString(),
      failure: {
        transaction_hash: failedNativeOperationsRefundTx.transaction.hash,
        transaction_outcome: failedNativeOperationsRefundReceiptTree.transaction_outcome,
        receipts_outcome: failedNativeOperationsRefundReceiptTree.receipts_outcome,
        operations_funded_yocto: failedNativeOperationsRefund.commitment.operations_funded_yocto,
        cash_snapshot: failedNativeOperationsRefund.cash.map(String),
      },
      retry_success: {
        transaction_hash: successfulNativeOperationsRefundTx.transaction.hash,
        transaction_outcome: successfulNativeOperationsRefundReceiptTree.transaction_outcome,
        receipts_outcome: successfulNativeOperationsRefundReceiptTree.receipts_outcome,
        operations_funded_yocto: successfulNativeOperationsRefund.commitment.operations_funded_yocto,
        cash_snapshot: successfulNativeOperationsRefund.cash.map(String),
      },
    };
    console.log("PASS production native operations refund restores spendable balance on failure and settles on retry");

    const storageRefundCredit = nativeTrancheAmount / 2n;
    await functionCall(CORE_ID, coreKey, "sandbox_seed_storage_refund_credit", {
      account_id: CASH_RECIPIENT_ID,
      amount_yocto: storageRefundCredit.toString(),
    }, 100n * TERA);
    await functionCall(CORE_ID, coreKey, "sandbox_set_next_storage_refund_recipient", {
      account_id: CASH_RECIPIENT_ID,
      recipient: "missing-storage-refund-recipient.sandbox",
    });
    nativeLiquidityMargin.storage_credit_one_transfer_gate = await setNativeFreeMargin(
      storageRefundCredit,
      "native storage-credit withdrawal one-transfer margin gate",
    );
    const insufficientStorageCreditWithdrawalTx = await sendTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_storage_refund", {}, 100n * TERA)],
      "storage-credit withdrawal with one-transfer free margin",
      { expectFailure: true },
    );
    const insufficientStorageCreditWithdrawalLogs = (insufficientStorageCreditWithdrawalTx.receipts_outcome ?? [])
      .flatMap((receipt) => receipt.outcome?.logs ?? []);
    assert.ok(insufficientStorageCreditWithdrawalLogs.some((log) =>
      log.includes("SANDBOX_CASH_GATE_FAILED")),
    "one-transfer storage-credit margin must fail at the cash solvency gate");
    assert.ok(!insufficientStorageCreditWithdrawalLogs.some((log) =>
      log.includes('"event":"service_report_refund_requested"')),
    "underfunded storage-credit withdrawal must stop before its transfer promise is requested");
    const insufficientStorageCreditWithdrawalReceipt = insufficientStorageCreditWithdrawalTx.receipts_outcome
      ?.find((receipt) => receipt.outcome?.executor_id === CORE_ID
        && isFailedExecution(receipt.outcome?.status));
    assert.ok(insufficientStorageCreditWithdrawalReceipt,
      "insufficient storage-credit margin must fail in the core receipt");
    const creditAtInsufficientMargin = await view(
      CORE_ID,
      "get_storage_refund_balance",
      { account_id: CASH_RECIPIENT_ID },
    );
    assert.equal(creditAtInsufficientMargin, storageRefundCredit.toString(),
      "insufficient storage-credit margin must preserve the withdrawal credit");
    const cashAtInsufficientCreditMargin = await nativeCashSnapshot();
    assert.deepEqual(
      cashAtInsufficientCreditMargin.map(String),
      nativeLiquidityMargin.storage_credit_one_transfer_gate.cash_snapshot,
      "insufficient storage-credit margin must preserve contract balance and liabilities",
    );
    nativeLiquidityMargin.storage_credit_one_transfer_gate_result = {
      transaction_hash: insufficientStorageCreditWithdrawalTx.transaction.hash,
      receipt_logs: insufficientStorageCreditWithdrawalLogs,
      receipt_outcomes: insufficientStorageCreditWithdrawalTx.receipts_outcome?.map((receipt) => ({
        id: receipt.id,
        executor_id: receipt.outcome?.executor_id,
        status: receipt.outcome?.status,
        receipt_ids: receipt.outcome?.receipt_ids,
      })),
      credit_yocto: creditAtInsufficientMargin,
      cash_snapshot: cashAtInsufficientCreditMargin.map(String),
    };
    nativeLiquidityMargin.storage_credit_failure = await setNativeFreeMargin(
      (2n * storageRefundCredit) + NATIVE_STORAGE_MARGIN_BUFFER,
      "native storage-credit withdrawal failure with callback reserve",
    );
    const failedStorageCreditWithdrawalTx = await submitAndWaitForTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_storage_refund", {}, 100n * TERA)],
      "storage credit withdrawal with missing recipient",
    );
    const failedStorageCreditWithdrawal = await waitFor("failed storage credit callback", async () => {
      const [credit, cash] = await Promise.all([
        view(CORE_ID, "get_storage_refund_balance", { account_id: CASH_RECIPIENT_ID }),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (credit === storageRefundCredit.toString()
        && BigInt(cash[3]) === storageRefundCredit
        && BigInt(cash[4]) === 0n) {
        return { done: true, value: { credit, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: { credit, cash: cash.map(String) },
      };
    });
    const failedStorageCreditWithdrawalReceiptTree = await rpc("tx", [
      failedStorageCreditWithdrawalTx.transaction.hash,
      CASH_RECIPIENT_ID,
    ]);
    assert.ok(
      failedStorageCreditWithdrawalReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"service_report_refund_failed"'))),
      "failed credit receipt tree must include the failure-reconciliation callback",
    );

    nativeLiquidityMargin.storage_credit_retry = await setNativeFreeMargin(
      (2n * storageRefundCredit) + NATIVE_STORAGE_MARGIN_BUFFER,
      "native storage-credit withdrawal retry",
    );
    const successfulStorageCreditWithdrawalTx = await submitAndWaitForTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_storage_refund", {}, 100n * TERA)],
      "storage credit withdrawal retry",
    );
    const successfulStorageCreditWithdrawal = await waitFor("successful storage credit callback", async () => {
      const [credit, cash] = await Promise.all([
        view(CORE_ID, "get_storage_refund_balance", { account_id: CASH_RECIPIENT_ID }),
        view(CORE_ID, "sandbox_native_cash_snapshot", {}),
      ]);
      if (credit === "0" && BigInt(cash[3]) === 0n && BigInt(cash[4]) === 0n) {
        return { done: true, value: { credit, cash: cash.map(BigInt) } };
      }
      return {
        done: false,
        value: { credit, cash: cash.map(String) },
      };
    });
    const successfulStorageCreditWithdrawalReceiptTree = await rpc("tx", [
      successfulStorageCreditWithdrawalTx.transaction.hash,
      CASH_RECIPIENT_ID,
    ]);
    assert.ok(
      successfulStorageCreditWithdrawalReceiptTree.receipts_outcome?.some(({ outcome }) =>
        outcome.executor_id === CORE_ID
          && outcome.logs?.some((log) => log.includes('"event":"service_report_refund_sent"'))),
      "credit withdrawal retry must include the successful settlement callback",
    );
    fixtures.native_storage_credit_callback = {
      account_id: CASH_RECIPIENT_ID,
      amount_yocto: storageRefundCredit.toString(),
      failure: {
        transaction_hash: failedStorageCreditWithdrawalTx.transaction.hash,
        transaction_outcome: failedStorageCreditWithdrawalReceiptTree.transaction_outcome,
        receipts_outcome: failedStorageCreditWithdrawalReceiptTree.receipts_outcome,
        credit_yocto: failedStorageCreditWithdrawal.credit,
        cash_snapshot: failedStorageCreditWithdrawal.cash.map(String),
      },
      retry_success: {
        transaction_hash: successfulStorageCreditWithdrawalTx.transaction.hash,
        transaction_outcome: successfulStorageCreditWithdrawalReceiptTree.transaction_outcome,
        receipts_outcome: successfulStorageCreditWithdrawalReceiptTree.receipts_outcome,
        credit_yocto: successfulStorageCreditWithdrawal.credit,
        cash_snapshot: successfulStorageCreditWithdrawal.cash.map(String),
      },
    };
    console.log("PASS production storage-credit withdrawal restores credit on failure and clears liability on retry");

    nativeLiquidityMargin.storage_credit_callback_oog_seed_reserve = await setNativeFreeMargin(
      ONE_NEAR + (3n * storageRefundCredit) + NATIVE_STORAGE_MARGIN_BUFFER,
      "native storage-credit callback out-of-gas fixture setup",
    );
    await functionCall(CORE_ID, coreKey, "sandbox_seed_storage_refund_credit", {
      account_id: CASH_RECIPIENT_ID,
      amount_yocto: storageRefundCredit.toString(),
    }, 100n * TERA);
    await submitAndWaitForTransaction(
      "sandbox",
      rootKey,
      CORE_ID,
      [actionFunctionCall("sandbox_set_next_storage_refund_callback_gas", {
        callback_gas_tgas: 1,
      }, 100n * TERA)],
      "configure native storage-refund callback out-of-gas fixture",
    );
    nativeLiquidityMargin.storage_credit_callback_oog = await setNativeFreeMargin(
      (2n * storageRefundCredit) + NATIVE_STORAGE_MARGIN_BUFFER,
      "native storage-credit callback out-of-gas reserve",
    );
    const cashBeforeStorageCallbackOog = await nativeCashSnapshot();
    const storageCallbackOogTx = await submitAndWaitForTransaction(
      CASH_RECIPIENT_ID,
      cashRecipientKey,
      CORE_ID,
      [actionFunctionCall("withdraw_storage_refund", {}, 100n * TERA)],
      "storage-credit withdrawal with deliberately underfunded callback gas",
    );
    const storageCallbackOogReceiptTree = await waitFor(
      "native storage-refund callback out-of-gas receipt",
      async () => {
        const tree = await rpc("tx", [
          storageCallbackOogTx.transaction.hash,
          CASH_RECIPIENT_ID,
        ]);
        const callbackReceipt = tree.receipts_outcome?.find(({ outcome }) =>
          outcome.executor_id === CORE_ID && isFailedExecution(outcome.status));
        return callbackReceipt
          ? { done: true, value: tree }
          : { done: false, value: tree.receipts_outcome?.map(({ outcome }) => ({
            executor_id: outcome.executor_id,
            status: outcome.status,
          })) };
      },
      120_000,
    );
    const storageCallbackOogReceipt = storageCallbackOogReceiptTree.receipts_outcome.find(
      ({ outcome }) => outcome.executor_id === CORE_ID && isFailedExecution(outcome.status),
    );
    assert.ok(storageCallbackOogReceipt, "missing failed native refund callback receipt");
    assert.ok(
      JSON.stringify(storageCallbackOogReceipt.outcome.status).includes("Exceeded the prepaid gas."),
      "native refund callback must fail from its deliberate gas limit",
    );
    const nativeRefundTransferReceipt = storageCallbackOogReceiptTree.receipts_outcome.find(
      ({ outcome }) => outcome.executor_id === CASH_RECIPIENT_ID
        && outcome.status && Object.hasOwn(outcome.status, "SuccessValue"),
    );
    assert.ok(nativeRefundTransferReceipt, "native refund transfer must settle before the callback OOG");
    assert.ok(
      !storageCallbackOogReceipt.outcome.logs?.some((log) =>
        log.includes('"event":"service_report_refund_sent"')
          || log.includes('"event":"service_report_refund_failed"')),
      "out-of-gas callback must not emit a refund settlement event",
    );
    const pendingAfterStorageCallbackOog = await waitFor(
      "native refund liability remains pending after callback out of gas",
      async () => {
        const [credit, cash] = await Promise.all([
          view(CORE_ID, "get_storage_refund_balance", { account_id: CASH_RECIPIENT_ID }),
          view(CORE_ID, "sandbox_native_cash_snapshot", {}),
        ]);
        const cashValues = cash.map(BigInt);
        return credit === "0" && cashValues[3] === storageRefundCredit && cashValues[4] === 0n
          ? { done: true, value: { credit, cash: cashValues } }
          : { done: false, value: { credit, cash: cash.map(String) } };
      },
      120_000,
    );
    assert.equal(
      cashBeforeStorageCallbackOog[0] - pendingAfterStorageCallbackOog.cash[0],
      storageRefundCredit,
      "successful native transfer must reduce core cash by the credited amount",
    );
    assert.ok(
      nativeFreeMargin(pendingAfterStorageCallbackOog.cash) >= 0n,
      "conservative reserve must still cover the unresolved native refund liability",
    );
    fixtures.native_storage_credit_callback_oog = {
      account_id: CASH_RECIPIENT_ID,
      amount_yocto: storageRefundCredit.toString(),
      callback_gas_tgas: 1,
      transaction_hash: storageCallbackOogTx.transaction.hash,
      transaction_outcome: storageCallbackOogReceiptTree.transaction_outcome,
      receipts_outcome: storageCallbackOogReceiptTree.receipts_outcome,
      available_credit_yocto: pendingAfterStorageCallbackOog.credit,
      cash_before_transfer: cashBeforeStorageCallbackOog.map(String),
      cash_after_callback_oog: pendingAfterStorageCallbackOog.cash.map(String),
      free_margin_after_callback_oog: nativeFreeMargin(pendingAfterStorageCallbackOog.cash).toString(),
    };
    console.log("PASS native refund transfer can settle while an out-of-gas callback leaves its liability pending and funded");
    nativeLiquidityMargin.fixture_cleanup = await clearNativeFreeMargin(
      "native callback fixture cleanup",
    );
    fixtures.native_liquidity_margin = nativeLiquidityMargin;

    fixtures.mock_ft_deploy_transaction = await deployAndWait(
      TOKEN_ID,
      tokenKey,
      tokenWasm,
      codeHashV1,
      "deploy mock NEP-141",
    );
    await functionCall(TOKEN_ID, tokenKey, "new", {
      initial_holder: CORE_ID,
      initial_balance: INITIAL_TOKEN_BALANCE.toString(),
    });
    await deployAndWait(ORDER_A_ID, orderAKey, tokenWasm, codeHashV1, "deploy action-order A");
    await functionCall(ORDER_A_ID, orderAKey, "new", {
      initial_holder: ORDER_A_ID,
      initial_balance: INITIAL_TOKEN_BALANCE.toString(),
    });
    await deployAndWait(ORDER_B_ID, orderBKey, tokenWasm, codeHashV1, "deploy action-order B");
    await functionCall(ORDER_B_ID, orderBKey, "new", {
      initial_holder: ORDER_B_ID,
      initial_balance: INITIAL_TOKEN_BALANCE.toString(),
    });

    const oOg = await functionCall(CORE_ID, coreKey, "sandbox_queue_tranche_transfer", {
      commitment_id: "1",
      token_account_id: TOKEN_ID,
      recipient: RECIPIENT_ID,
      amount_raw: AMOUNT.toString(),
      callback_gas_tgas: 2,
    }, 100n * TERA);
    assert.ok(
      (oOg.receipts_outcome ?? []).some((outcome) =>
        JSON.stringify(outcome.outcome?.status).includes("Exceeded the prepaid gas")),
      "callback receipt should explicitly fail for exceeding its prepaid gas",
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const oOgEscrow = await escrow(1);
    assert.ok(oOgEscrow, "missing escrow status for callback OOG commitment");
    const oOgTranche = await tranche(1);
    assert.equal(oOgTranche.status, "Pending");
    assert.equal(BigInt(oOgEscrow.pending_raw), AMOUNT);
    assert.equal(BigInt(oOgEscrow.paid_raw), 0n);
    assert.equal(BigInt(oOgEscrow.free_raw), 0n);
    assert.equal(await tokenBalance(RECIPIENT_ID), AMOUNT, "token receipt should have succeeded before callback OOG");
    assertConservation(oOgEscrow);
    console.log(`PASS callback OOG leaves the token liability reserved (${oOg.transaction.hash})`);

    await functionCall(TOKEN_ID, tokenKey, "set_fail_transfers", { fail: true });
    await functionCall(CORE_ID, coreKey, "sandbox_queue_tranche_transfer", {
      commitment_id: "2",
      token_account_id: TOKEN_ID,
      recipient: RECIPIENT_ID,
      amount_raw: AMOUNT.toString(),
      callback_gas_tgas: 20,
    }, 100n * TERA);
    const failedEscrow = await waitFor("explicit token failure callback", async () => {
      const state = await escrow(2);
      return state && state.pending_raw === "0" && (await tranche(2))?.status === "Failed"
        ? { done: true, value: state }
        : { done: false, value: state };
    });
    assert.equal(BigInt(failedEscrow.free_raw), AMOUNT);
    assert.equal(BigInt(failedEscrow.paid_raw), 0n);
    assertConservation(failedEscrow);
    assert.equal(await tokenBalance(RECIPIENT_ID), AMOUNT);
    console.log("PASS explicit token failure restores free escrow and marks the tranche Failed");

    await functionCall(TOKEN_ID, tokenKey, "set_fail_transfers", { fail: false });
    const retryTx = await functionCall(CORE_ID, coreKey, "sandbox_queue_tranche_transfer", {
      commitment_id: "2",
      token_account_id: TOKEN_ID,
      recipient: RECIPIENT_ID,
      amount_raw: AMOUNT.toString(),
      callback_gas_tgas: 20,
    }, 100n * TERA);
    const retryEscrow = await waitFor("successful retry callback", async () => {
      const state = await escrow(2);
      return state && BigInt(state.paid_raw) === AMOUNT && state.pending_raw === "0"
        ? { done: true, value: state }
        : { done: false, value: state };
    });
    assert.equal((await tranche(2)).status, "Paid");
    assert.equal(BigInt(retryEscrow.free_raw), 0n);
    assert.equal(await tokenBalance(RECIPIENT_ID), AMOUNT * 2n);
    assertConservation(retryEscrow);
    const successReceipt = retryTx.receipts_outcome?.find(
      ({ outcome }) => outcome.executor_id === TOKEN_ID,
    );
    assert.ok(successReceipt, "missing successful token receipt");
    assert.ok(
      successReceipt.outcome.status && Object.hasOwn(successReceipt.outcome.status, "SuccessValue"),
      `successful token receipt must have SuccessValue status, got ${JSON.stringify(successReceipt.outcome.status)}`,
    );
    assert.equal(successReceipt.outcome.metadata?.contracts?.[0]?.local, codeHashV1);
    fixtures.successful_control = {
      outer_transaction_hash: retryTx.transaction.hash,
      receipts_outcome: retryTx.receipts_outcome,
      expected_token_code_hash: codeHashV1,
    };
    console.log("PASS successful retry pays once and consumes the reservation");

    const beforeNoCode = {
      sender: await tokenBalance(CORE_ID),
      recipient: await tokenBalance(RECIPIENT_ID),
    };
    const noCodeTx = await submitAndWaitForTransaction(
      CORE_ID,
      coreKey,
      CORE_ID,
      [actionFunctionCall("sandbox_queue_tranche_transfer", {
        commitment_id: "7",
        token_account_id: NO_CODE_TOKEN_ID,
        recipient: RECIPIENT_ID,
        amount_raw: AMOUNT.toString(),
        callback_gas_tgas: 20,
      }, 100n * TERA, 0n)],
      "queue transfer to account without token code",
    );
    const noCodeReceipt = noCodeTx.receipts_outcome?.find(
      ({ outcome }) => outcome.executor_id === NO_CODE_TOKEN_ID,
    );
    assert.ok(noCodeReceipt, "missing pre-execution token receipt outcome");
    assert.ok(isFailedExecution(noCodeReceipt.outcome.status), "no-code token receipt must fail");
    const noCodeEscrow = await waitFor("no-code token failure callback", async () => {
      const state = await escrow(7);
      return state && state.pending_raw === "0" && (await tranche(7))?.status === "Failed"
        ? { done: true, value: state }
        : { done: false, value: state };
    });
    assert.equal(await tokenBalance(CORE_ID), beforeNoCode.sender);
    assert.equal(await tokenBalance(RECIPIENT_ID), beforeNoCode.recipient);
    assert.equal(BigInt(noCodeEscrow.free_raw), AMOUNT);
    assertConservation(noCodeEscrow);
    fixtures.pre_execution_failure = {
      outer_transaction_hash: noCodeTx.transaction.hash,
      receipts_outcome: noCodeTx.receipts_outcome,
      token_balances_before: Object.fromEntries(
        Object.entries(beforeNoCode).map(([accountId, value]) => [accountId, value.toString()]),
      ),
      token_balances_after: {
        [CORE_ID]: (await tokenBalance(CORE_ID)).toString(),
        [RECIPIENT_ID]: (await tokenBalance(RECIPIENT_ID)).toString(),
      },
      escrow: noCodeEscrow,
    };
    console.log("PASS missing-code token receipt fails before contract execution with no token balance changes");

    await functionCall(TOKEN_ID, tokenKey, "set_fail_after_mutation", { fail: true });
    const beforePanic = {
      sender: await tokenBalance(CORE_ID),
      recipient: await tokenBalance(RECIPIENT_ID),
    };
    const panicTx = await functionCall(CORE_ID, coreKey, "sandbox_queue_tranche_transfer", {
      commitment_id: "8",
      token_account_id: TOKEN_ID,
      recipient: RECIPIENT_ID,
      amount_raw: AMOUNT.toString(),
      callback_gas_tgas: 20,
    }, 100n * TERA);
    const panicReceipt = panicTx.receipts_outcome?.find(
      ({ outcome }) => outcome.executor_id === TOKEN_ID,
    );
    assert.ok(panicReceipt, "missing post-mutation token receipt outcome");
    assert.ok(isFailedExecution(panicReceipt.outcome.status), "post-mutation token receipt must fail");
    const panicEscrow = await waitFor("post-mutation panic callback", async () => {
      const state = await escrow(8);
      return state && state.pending_raw === "0" && (await tranche(8))?.status === "Failed"
        ? { done: true, value: state }
        : { done: false, value: state };
    });
    assert.equal(await tokenBalance(CORE_ID), beforePanic.sender, "sender write must roll back");
    assert.equal(await tokenBalance(RECIPIENT_ID), beforePanic.recipient, "recipient write must roll back");
    assert.equal(BigInt(panicEscrow.free_raw), AMOUNT);
    assertConservation(panicEscrow);
    fixtures.post_mutation_failure = {
      outer_transaction_hash: panicTx.transaction.hash,
      receipts_outcome: panicTx.receipts_outcome,
      token_balances_before: Object.fromEntries(
        Object.entries(beforePanic).map(([accountId, value]) => [accountId, value.toString()]),
      ),
      token_balances_after: {
        [CORE_ID]: (await tokenBalance(CORE_ID)).toString(),
        [RECIPIENT_ID]: (await tokenBalance(RECIPIENT_ID)).toString(),
      },
      escrow: panicEscrow,
    };
    await functionCall(TOKEN_ID, tokenKey, "set_fail_after_mutation", { fail: false });
    console.log("PASS token receipt panic after balance writes rolls back both token writes");

    const functionCallAction = actionFunctionCall("ft_transfer", {
      receiver_id: RECIPIENT_ID,
      amount: AMOUNT.toString(),
      memo: null,
    }, 25n * TERA, 1n);
    const deployV2Action = actionDeploy(tokenVariantBWasm);
    assert.notEqual(codeHashV1, codeHashV2, "action-order fixture code versions must differ");

    const transferThenDeploy = await submitAndWaitForTransaction(
      ORDER_A_ID,
      orderAKey,
      ORDER_A_ID,
      [functionCallAction, deployV2Action],
      "action order A transfer then deploy B",
    );
    const transferThenDeployReceipt = transferThenDeploy.receipts_outcome?.find(
      ({ outcome }) => outcome.executor_id === ORDER_A_ID,
    );
    assert.ok(transferThenDeployReceipt, "missing transfer-then-deploy receipt");
    const firstOrderContracts = transferThenDeployReceipt.outcome.metadata?.contracts;
    assert.ok(Array.isArray(firstOrderContracts), "protocol-88 V4 contract metadata is missing");
    assert.equal(firstOrderContracts[0]?.local, codeHashV1, "transfer action should execute A before deploy B");
    assert.equal(firstOrderContracts[1]?.local, codeHashV1, "the deployment action begins under the existing A code");
    assert.equal(await tokenBalance(RECIPIENT_ID, ORDER_A_ID), AMOUNT);
    fixtures.action_order_transfer_then_deploy = {
      transaction_hash: transferThenDeploy.transaction.hash,
      receipts_outcome: transferThenDeploy.receipts_outcome,
      expected_code_hash: codeHashV1,
      observed_contract_metadata: firstOrderContracts,
    };

    const deployThenTransfer = await submitAndWaitForTransaction(
      ORDER_B_ID,
      orderBKey,
      ORDER_B_ID,
      [deployV2Action, functionCallAction],
      "action order B deploy then transfer",
    );
    const deployThenTransferReceipt = deployThenTransfer.receipts_outcome?.find(
      ({ outcome }) => outcome.executor_id === ORDER_B_ID,
    );
    assert.ok(deployThenTransferReceipt, "missing deploy-then-transfer receipt");
    const secondOrderContracts = deployThenTransferReceipt.outcome.metadata?.contracts;
    assert.ok(Array.isArray(secondOrderContracts), "protocol-88 V4 contract metadata is missing");
    assert.equal(secondOrderContracts[0]?.local, codeHashV1, "the deployment action begins under the existing A code");
    assert.equal(secondOrderContracts[1]?.local, codeHashV2, "transfer action should execute B after deployment");
    assert.equal(await tokenBalance(RECIPIENT_ID, ORDER_B_ID), AMOUNT);
    assert.equal(await view(ORDER_A_ID, "ft_contract_version", {}), 2);
    assert.equal(await view(ORDER_B_ID, "ft_contract_version", {}), 2);
    fixtures.action_order_deploy_then_transfer = {
      transaction_hash: deployThenTransfer.transaction.hash,
      receipts_outcome: deployThenTransfer.receipts_outcome,
      expected_code_hash: codeHashV2,
      observed_contract_metadata: secondOrderContracts,
    };
    fixtures.action_order_code_hashes = { variant_a: codeHashV1, variant_b: codeHashV2 };
    console.log("PASS protocol-88 V4 metadata binds transfer-before-deploy to A and deploy-before-transfer to B");

    const concurrentAccessKey = await rpc("query", {
      request_type: "view_access_key",
      account_id: CORE_ID,
      public_key: coreKey.publicKey,
      finality: "optimistic",
    });
    for (let offset = 0; offset < 4; offset += 1) {
      const commitmentId = 3 + offset;
      await sendTransaction(CORE_ID, coreKey, CORE_ID, [
        actionFunctionCall("sandbox_queue_tranche_transfer", {
          commitment_id: String(commitmentId),
          token_account_id: TOKEN_ID,
          recipient: RECIPIENT_ID,
          amount_raw: AMOUNT.toString(),
          callback_gas_tgas: 20,
        }, 100n * TERA),
      ], `queue concurrent commitment ${commitmentId}`, {
        nonce: BigInt(concurrentAccessKey.nonce) + BigInt(offset) + 1n,
        broadcastMethod: "broadcast_tx_async",
      });
    }
    for (const commitmentId of [3, 4, 5, 6]) {
      const state = await waitFor(`concurrent commitment ${commitmentId}`, async () => {
        const value = await escrow(commitmentId);
        return value && BigInt(value.paid_raw) === AMOUNT && value.pending_raw === "0"
          ? { done: true, value }
          : { done: false, value };
      });
      assert.equal((await tranche(commitmentId)).status, "Paid");
      assertConservation(state);
    }
    assert.equal(await tokenBalance(RECIPIENT_ID), AMOUNT * 6n);
    console.log("PASS four concurrent equal-amount transfers settle independently");
    console.log("PASS final recipient balance equals six successful token transfers (6,000,000 raw units)");

    if (process.env.LCP_FIXTURE_OUTPUT) {
      const fixture = {
        fixture_schema: "lcp.protocol-88-receipt-rollback.v1",
        captured_at: new Date().toISOString(),
        node: fixtures.node,
        wasm_artifacts: fixtures.artifacts,
        scenarios: {
          native_liquidity_funding: fixtures.native_liquidity_funding,
          native_cash_gate: fixtures.native_cash_gate,
          native_claim_callback: fixtures.native_claim_callback,
          native_escrow_refund_callback: fixtures.native_escrow_refund_callback,
          native_operations_refund_callback: fixtures.native_operations_refund_callback,
          native_storage_credit_callback: fixtures.native_storage_credit_callback,
          native_storage_credit_callback_oog: fixtures.native_storage_credit_callback_oog,
          native_liquidity_margin: fixtures.native_liquidity_margin,
          core_deploy_transaction: fixtures.core_deploy_transaction,
          pre_execution_failure: fixtures.pre_execution_failure,
          post_mutation_failure: fixtures.post_mutation_failure,
          successful_control: fixtures.successful_control,
          action_order_transfer_then_deploy: fixtures.action_order_transfer_then_deploy,
          action_order_deploy_then_transfer: fixtures.action_order_deploy_then_transfer,
          action_order_code_hashes: fixtures.action_order_code_hashes,
        },
      };
      await writeFile(process.env.LCP_FIXTURE_OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`);
      console.log(`WROTE protocol-88 raw receipt fixture: ${process.env.LCP_FIXTURE_OUTPUT}`);
    }
    console.log("All local NEAR Sandbox callback checks passed; no testnet transaction was sent.");
  } finally {
    const teardown = sandbox.tearDown();
    let timeout;
    const stoppedGracefully = await Promise.race([
      teardown.then(() => true),
      new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 5_000); }),
    ]);
    clearTimeout(timeout);
    if (!stoppedGracefully) {
      const childProcess = sandbox.childProcess;
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill("SIGKILL");
      }
      await teardown;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
