import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createPrivateEvidenceCommitment,
  createReviewerKeyVault,
  decryptPrivateArtifact,
  encryptPrivateArtifact,
  signReviewerPayload,
  unlockReviewerKeyVault,
} from "../dist/index.js";

globalThis.crypto ??= webcrypto;

const NEP413_TAG = 2_147_484_061;

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function u32le(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function borshString(value) {
  const bytes = new TextEncoder().encode(value);
  return concat(u32le(bytes.byteLength), bytes);
}

function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let result = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    result = alphabet[digit] + result;
    value /= 58n;
  }
  const firstNonzero = bytes.findIndex((byte) => byte !== 0);
  return "1".repeat(firstNonzero < 0 ? bytes.length : firstNonzero) + result;
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

async function makeLegacyVault(sourceVault, passphrase, advertisedVault = sourceVault) {
  const salt = Uint8Array.from(Buffer.from(sourceVault.salt_b64, "base64"));
  const sourceIv = Uint8Array.from(Buffer.from(sourceVault.iv_b64, "base64"));
  const encryptedSource = Uint8Array.from(Buffer.from(sourceVault.encrypted_private_key_b64, "base64"));
  const passphraseMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"],
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: sourceVault.iterations },
    passphraseMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const sourceHeader = {
    schema: sourceVault.schema,
    public_key_b64: sourceVault.public_key_b64,
    fingerprint_hex: sourceVault.fingerprint_hex,
    kdf: sourceVault.kdf,
    iterations: sourceVault.iterations,
    salt_b64: sourceVault.salt_b64,
    iv_b64: sourceVault.iv_b64,
  };
  const privateKey = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sourceIv, additionalData: new TextEncoder().encode(canonicalJson(sourceHeader)) },
    wrappingKey,
    encryptedSource,
  ));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("lcp.reviewer-key-vault.v1") },
    wrappingKey,
    privateKey,
  ));
  privateKey.fill(0);
  return {
    schema: "lcp.reviewer-key-vault.v1",
    public_key_b64: advertisedVault.public_key_b64,
    fingerprint_hex: advertisedVault.fingerprint_hex,
    kdf: sourceVault.kdf,
    iterations: sourceVault.iterations,
    salt_b64: sourceVault.salt_b64,
    iv_b64: Buffer.from(iv).toString("base64"),
    encrypted_private_key_b64: Buffer.from(encrypted).toString("base64"),
  };
}

async function makeReviewerWalletSigner({ callback = "requested" } = {}) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return async ({ message, nonce, recipient, callbackUrl }) => {
    const signedCallback = callback === "requested" ? callbackUrl : undefined;
    const callbackBytes = signedCallback === undefined
      ? new Uint8Array([0])
      : concat(new Uint8Array([1]), borshString(signedCallback));
    const serialized = concat(
      u32le(NEP413_TAG),
      borshString(message),
      nonce,
      borshString(recipient),
      callbackBytes,
    );
    const digest = await crypto.subtle.digest("SHA-256", serialized);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, digest));
    return {
      accountId: "reviewer.testnet",
      publicKey: `ed25519:${encodeBase58(publicKey)}`,
      signature: Buffer.from(signature).toString("base64"),
      ...(signedCallback === undefined ? {} : { callbackUrl: signedCallback }),
    };
  };
}

test("reviewer key backup encrypts locally and private artifacts decrypt with digest verification", async () => {
  const passphrase = "correct horse battery staple 2026";
  const vault = await createReviewerKeyVault(passphrase);
  const privateKey = await unlockReviewerKeyVault(vault, passphrase);
  const fileBytes = new TextEncoder().encode("private evidence for evaluation 7");
  const commitment = await createPrivateEvidenceCommitment(fileBytes);
  const requestId = "d43fd0cc-296d-4cb9-96b0-66a43eef4f10";
  const encrypted = await encryptPrivateArtifact({
    request_id: requestId,
    commitment_id: "24",
    evaluation_id: "7",
    evidence_digest: commitment.evidence_digest,
    digest_salt_b64: commitment.digest_salt_b64,
    reviewer_public_key_b64: vault.public_key_b64,
    file_name: "evidence.txt",
    media_type: "text/plain",
    file_bytes: fileBytes,
  });

  const decrypted = await decryptPrivateArtifact({
    private_key: privateKey,
    ciphertext: Uint8Array.from(Buffer.from(encrypted.ciphertext_b64, "base64")),
    hpke_enc_b64: encrypted.hpke_enc_b64,
    wrapped_key_b64: encrypted.wrapped_key_b64,
    content_iv_b64: encrypted.content_iv_b64,
    request_id: requestId,
    commitment_id: "24",
    evaluation_id: "7",
    evidence_digest: commitment.evidence_digest,
  });
  assert.equal(decrypted.file_name, "evidence.txt");
  assert.equal(decrypted.media_type, "text/plain");
  assert.equal(decrypted.digest_verified, true);
  assert.deepEqual(decrypted.file_bytes, fileBytes);
  privateKey.fill(0);
});

test("reviewer key backups reject an incorrect passphrase", async () => {
  const vault = await createReviewerKeyVault("long enough local recovery passphrase");
  await assert.rejects(unlockReviewerKeyVault(vault, "incorrect passphrase"), /could not unlock/);
});

test("v2 reviewer key backups authenticate their advertised public-key metadata", async () => {
  const passphrase = "reviewer metadata binding passphrase";
  const original = await createReviewerKeyVault(passphrase);
  const substitute = await createReviewerKeyVault(passphrase);
  const tampered = {
    ...original,
    public_key_b64: substitute.public_key_b64,
    fingerprint_hex: substitute.fingerprint_hex,
  };
  await assert.rejects(unlockReviewerKeyVault(tampered, passphrase), /could not unlock/);
});

test("legacy reviewer key backups import only when decrypted private and advertised public keys match", async () => {
  const passphrase = "legacy reviewer backup compatibility";
  const original = await createReviewerKeyVault(passphrase);
  const substitute = await createReviewerKeyVault(passphrase);
  const validLegacy = await makeLegacyVault(original, passphrase);
  const unlocked = await unlockReviewerKeyVault(validLegacy, passphrase);
  assert.equal(unlocked.byteLength, 32);
  unlocked.fill(0);

  const substitutedLegacy = await makeLegacyVault(original, passphrase, substitute);
  await assert.rejects(
    unlockReviewerKeyVault(substitutedLegacy, passphrase),
    /does not match the public key/,
  );
});

test("wallet message signing verifies callback-bound NEP-413 signatures and creates fresh nonces", async () => {
  const signer = await makeReviewerWalletSigner();
  const first = await signReviewerPayload(
    { schema: "lcp.reviewer-request.v1", commitment_id: "24" },
    { recipient: "lcp.gama.works/reviewer-access", callbackUrl: "https://lcp.gama.works", signMessage: signer },
  );
  const second = await signReviewerPayload(
    { schema: "lcp.reviewer-request.v1", commitment_id: "24" },
    { recipient: "lcp.gama.works/reviewer-access", callbackUrl: "https://lcp.gama.works", signMessage: signer },
  );
  assert.match(first.payload.nonce_hex, /^[0-9a-f]{64}$/);
  assert.notEqual(first.payload.nonce_hex, second.payload.nonce_hex);
  assert.equal(first.signed_message.nonce_hex, first.payload.nonce_hex);
  assert.equal(first.signed_message.recipient, "lcp.gama.works/reviewer-access");
  assert.equal(first.signed_message.callback_url, "https://lcp.gama.works");
});

test("wallet message signing preserves a valid NEP-413 signature that omits the optional callback", async () => {
  const signer = await makeReviewerWalletSigner({ callback: "omit" });
  const result = await signReviewerPayload(
    { schema: "lcp.reviewer-request.v1", commitment_id: "24" },
    { recipient: "lcp.gama.works/reviewer-access", callbackUrl: "https://lcp.gama.works", signMessage: signer },
  );
  assert.equal(Object.hasOwn(result.signed_message, "callback_url"), false);
});

test("wallet message signing rejects a malformed signature instead of forwarding it", async () => {
  const signer = await makeReviewerWalletSigner();
  const result = await signReviewerPayload(
    { schema: "lcp.reviewer-request.v1", commitment_id: "24" },
    { recipient: "lcp.gama.works/reviewer-access", callbackUrl: "https://lcp.gama.works", signMessage: signer },
  );
  const tamperedSigner = async (input) => ({
    ...(await signer(input)),
    signature: Buffer.alloc(64).toString("base64"),
  });
  await assert.rejects(
    signReviewerPayload(
      { schema: "lcp.reviewer-request.v1", commitment_id: "24" },
      { recipient: "lcp.gama.works/reviewer-access", callbackUrl: "https://lcp.gama.works", signMessage: tamperedSigner },
    ),
    /does not match this request and callback/,
  );
  assert.ok(result.signed_message.signature);
});
