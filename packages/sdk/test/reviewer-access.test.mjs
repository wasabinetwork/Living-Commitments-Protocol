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

test("wallet message signing creates a fresh bound NEP-413 nonce", async () => {
  const signature = Buffer.alloc(64).toString("base64");
  const signer = async () => ({
    accountId: "reviewer.testnet",
    publicKey: `ed25519:${"1".repeat(32)}`,
    signature,
  });
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
});
