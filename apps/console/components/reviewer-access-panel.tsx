"use client";

import {
  createPrivateEvidenceCommitment,
  createReviewerKeyVault,
  decryptPrivateArtifact,
  encryptPrivateArtifact,
  ReviewerAccessClient,
  sha256Hex,
  signReviewerPayload,
  unlockReviewerKeyVault,
} from "@lcp/sdk";
import type {
  CommitmentId,
  EvaluationId,
  EvaluationRecordView,
  NearSignedMessage,
  ReviewerKeyVault,
  ReviewerSignedMessage,
} from "@lcp/sdk";
import { useEffect, useRef, useState } from "react";

const SERVICE_URL = process.env.NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL?.trim() ?? "";
const ACCESS_RECIPIENT = process.env.NEXT_PUBLIC_LCP_REVIEWER_ACCESS_RECIPIENT?.trim() || "lcp.gama.works/reviewer-access";
const VAULT_DB = "lcp-reviewer-key-vaults-v1";
const VAULT_STORE = "vaults";
const LIST_SIGNATURE_TTL_NS = 5n * 60n * 1_000_000_000n;

interface Props {
  accountId: string | null;
  contractId: string;
  commitmentId: CommitmentId;
  maintainerAccount: string;
  chainTimeNs: string | null;
  evaluation: EvaluationRecordView;
  onSignMessage: (message: string, nonce: Uint8Array, recipient: string, callbackUrl: string) => Promise<NearSignedMessage>;
}

interface EvidenceReceipt {
  schema: "lcp.private-evidence-commitment.v1";
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  evidence_digest: string;
  digest_salt_b64: string;
}

interface ReviewerRequestRow {
  request_id: string;
  evaluation_id: string;
  evidence_digest: string;
  reviewer_account: string;
  encryption_key_fingerprint: string;
  encryption_public_key_b64: string;
  scopes_json: string;
  expires_at_ns: string;
}

interface ReviewerGrantRow {
  grant_id: string;
  request_id: string;
  reviewer_account: string;
  commitment_id: string;
  evaluation_id: string;
  evidence_digest: string;
  ciphertext_sha256: string;
  ciphertext_bytes: number;
  expires_at_ns: string;
  revoked_at_ns: string | null;
  hpke_enc_b64: string;
  wrapped_key_b64: string;
  content_iv_b64: string;
}

export function ReviewerAccessPanel(props: Props) {
  const [vault, setVault] = useState<ReviewerKeyVault | null>(null);
  const [privateKey, setPrivateKey] = useState<Uint8Array | null>(null);
  const privateKeyRef = useRef<Uint8Array | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [requestDigest, setRequestDigest] = useState("");
  const [receipt, setReceipt] = useState<EvidenceReceipt | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [requests, setRequests] = useState<ReviewerRequestRow[]>([]);
  const [grants, setGrants] = useState<ReviewerGrantRow[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedGrantId, setSelectedGrantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isMaintainer = props.accountId === props.maintainerAccount;
  const evaluationComplete = props.evaluation.status !== "Pending";

  useEffect(() => {
    privateKeyRef.current?.fill(0);
    privateKeyRef.current = null;
    setPrivateKey(null);
    setPassphrase("");
    setVault(null);
    if (!props.accountId) return;
    let cancelled = false;
    void getVault(props.accountId).then((stored) => {
      if (!cancelled) setVault(stored);
    }).catch(() => {
      if (!cancelled) setError("The browser could not read its local reviewer key vault.");
    });
    return () => { cancelled = true; };
  }, [props.accountId]);

  useEffect(() => () => {
    privateKeyRef.current?.fill(0);
  }, []);

  function clearNotice() {
    setError("");
    setMessage("");
  }

  function client(): ReviewerAccessClient {
    if (!SERVICE_URL) throw new Error("Reviewer access is not configured for this Console deployment yet.");
    return new ReviewerAccessClient(SERVICE_URL);
  }

  async function signPayload<T extends Record<string, unknown>>(payload: T): Promise<{ payload: T & { nonce_hex: string }; signed_message: ReviewerSignedMessage }> {
    if (!props.accountId) throw new Error("Connect the NEAR account that will request or manage reviewer access.");
    const callbackUrl = window.location.origin;
    const signed = await signReviewerPayload(payload, {
      recipient: ACCESS_RECIPIENT,
      callbackUrl,
      signMessage: ({ message: text, nonce, recipient, callbackUrl: callback }) => props.onSignMessage(text, nonce, recipient, callback),
    });
    if (signed.signed_message.account_id !== props.accountId) {
      throw new Error(`The wallet signed as ${signed.signed_message.account_id}; connect ${props.accountId} and retry.`);
    }
    return signed;
  }

  async function saveVault(nextVault: ReviewerKeyVault, accountId = props.accountId) {
    if (!accountId) throw new Error("Connect a NEAR wallet before creating a reviewer key.");
    await putVault(accountId, nextVault);
    setVault(nextVault);
  }

  async function createVault() {
    clearNotice();
    setBusy(true);
    try {
      const nextVault = await createReviewerKeyVault(passphrase);
      await saveVault(nextVault);
      downloadJson(`lcp-reviewer-key-${safeName(props.accountId ?? "wallet")}.json`, nextVault);
      setMessage("Reviewer key created. An encrypted recovery backup was downloaded; keep it with your passphrase.");
      setPassphrase("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importVault(event: React.ChangeEvent<HTMLInputElement>) {
    clearNotice();
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    try {
      if (selected.size > 16_384) throw new Error("Reviewer key backup exceeds the size limit.");
      const parsed: unknown = JSON.parse(await selected.text());
      if (!isReviewerKeyVault(parsed)) throw new Error("This file is not a supported reviewer key backup.");
      await saveVault(parsed);
      setMessage("Encrypted reviewer key backup imported into this browser profile.");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function unlockVault() {
    if (!vault) return;
    clearNotice();
    setBusy(true);
    try {
      const unlocked = await unlockReviewerKeyVault(vault, passphrase);
      privateKeyRef.current?.fill(0);
      privateKeyRef.current = unlocked;
      setPrivateKey(unlocked);
      setPassphrase("");
      setMessage("Reviewer key unlocked in memory for this browser session.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function lockVault() {
    privateKeyRef.current?.fill(0);
    privateKeyRef.current = null;
    setPrivateKey(null);
    setMessage("Reviewer key locked and cleared from this page's memory.");
  }

  async function loadRequests() {
    clearNotice();
    setBusy(true);
    try {
      if (!props.chainTimeNs) throw new Error("Refresh the commitment to read finalized NEAR time before listing requests.");
      const signed = await signPayload({
        schema: "lcp.reviewer-request-list.v1",
        commitment_id: props.commitmentId,
        auth_expires_at_ns: (BigInt(props.chainTimeNs) + LIST_SIGNATURE_TTL_NS).toString(),
      });
      const result = await client().listRequests(signed.payload, signed.signed_message);
      const rows = result.requests as unknown as ReviewerRequestRow[];
      setRequests(rows);
      setSelectedRequestId(rows[0]?.request_id ?? "");
      setMessage(`${rows.length} pending request${rows.length === 1 ? "" : "s"} found.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function loadGrants() {
    clearNotice();
    setBusy(true);
    try {
      if (!props.chainTimeNs) throw new Error("Refresh the commitment to read finalized NEAR time before listing grants.");
      const signed = await signPayload({
        schema: "lcp.reviewer-grant-list.v1",
        commitment_id: props.commitmentId,
        auth_expires_at_ns: (BigInt(props.chainTimeNs) + LIST_SIGNATURE_TTL_NS).toString(),
      });
      const result = await client().listGrants(signed.payload, signed.signed_message);
      const rows = result.grants as unknown as ReviewerGrantRow[];
      setGrants(rows);
      setSelectedGrantId(rows[0]?.grant_id ?? "");
      setMessage(`${rows.length} reviewer grant${rows.length === 1 ? "" : "s"} found.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createRequest() {
    clearNotice();
    setBusy(true);
    try {
      if (!vault) throw new Error("Create or import a local reviewer key first.");
      if (!props.accountId) throw new Error("Connect the wallet that will receive reviewer access.");
      if (!props.chainTimeNs) throw new Error("Refresh the commitment to read finalized NEAR time before requesting access.");
      if (!/^[0-9a-f]{64}$/.test(requestDigest)) throw new Error("Enter the 64-character salted evidence digest shared by the maintainer.");
      const request = {
        schema: "lcp.reviewer-request.v1",
        contract_id: props.contractId,
        commitment_id: props.commitmentId,
        evaluation_id: props.evaluation.evaluation_id,
        evidence_digest: requestDigest,
        reviewer_account: props.accountId,
        encryption_public_key_b64: vault.public_key_b64,
        encryption_key_fingerprint: vault.fingerprint_hex,
        scopes: ["download_ciphertext"],
        expires_at_ns: (BigInt(props.chainTimeNs) + 7n * 24n * 60n * 60n * 1_000_000_000n).toString(),
      };
      const signed = await signPayload(request);
      const result = await client().createRequest(signed.payload, signed.signed_message);
      setMessage(`Reviewer request ${String(result.request_id)} submitted. The maintainer can review it for this evaluation.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createReceipt() {
    clearNotice();
    if (!file) {
      setError("Choose the private evidence file before creating its salted digest.");
      return;
    }
    setBusy(true);
    try {
      if (file.size > 8 * 1024 * 1024 - 16_384) throw new Error("Private evidence must be no larger than 8 MiB before encryption.");
      const commitment = await createPrivateEvidenceCommitment(new Uint8Array(await file.arrayBuffer()));
      const nextReceipt: EvidenceReceipt = {
        schema: "lcp.private-evidence-commitment.v1",
        commitment_id: props.commitmentId,
        evaluation_id: props.evaluation.evaluation_id,
        evidence_digest: commitment.evidence_digest,
        digest_salt_b64: commitment.digest_salt_b64,
      };
      setReceipt(nextReceipt);
      setRequestDigest(nextReceipt.evidence_digest);
      downloadJson(`lcp-private-evidence-receipt-${props.commitmentId}-${props.evaluation.evaluation_id}.json`, nextReceipt);
      setMessage("Salted evidence digest created. The local receipt contains the salt; the signed reviewer request sends only the digest.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importReceipt(event: React.ChangeEvent<HTMLInputElement>) {
    clearNotice();
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    try {
      if (selected.size > 4_096) throw new Error("Evidence receipt exceeds the size limit.");
      const parsed: unknown = JSON.parse(await selected.text());
      if (!isEvidenceReceipt(parsed) || parsed.commitment_id !== props.commitmentId || parsed.evaluation_id !== props.evaluation.evaluation_id) {
        throw new Error("The receipt does not match this commitment and evaluation.");
      }
      setReceipt(parsed);
      setRequestDigest(parsed.evidence_digest);
      setMessage("Local evidence receipt loaded. The salt stays in this browser and is packed into the encrypted artifact.");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function approveRequest() {
    clearNotice();
    setBusy(true);
    try {
      if (!file || !receipt) throw new Error("Choose the private file and load its matching local evidence receipt.");
      const request = requests.find((candidate) => candidate.request_id === selectedRequestId);
      if (!request) throw new Error("Select a pending reviewer request.");
      if (request.evidence_digest !== receipt.evidence_digest || request.evaluation_id !== props.evaluation.evaluation_id) {
        throw new Error("The local evidence receipt does not match the selected review request.");
      }
      const encrypted = await encryptPrivateArtifact({
        request_id: request.request_id,
        commitment_id: props.commitmentId,
        evaluation_id: props.evaluation.evaluation_id,
        evidence_digest: receipt.evidence_digest,
        digest_salt_b64: receipt.digest_salt_b64,
        file_name: file.name,
        media_type: file.type || "application/octet-stream",
        file_bytes: new Uint8Array(await file.arrayBuffer()),
        reviewer_public_key_b64: request.encryption_public_key_b64,
      });
      const grant = {
        schema: "lcp.reviewer-grant.v1",
        request_id: request.request_id,
        ciphertext_sha256: encrypted.ciphertext_sha256,
        ciphertext_bytes: encrypted.ciphertext_bytes,
        hpke_enc_b64: encrypted.hpke_enc_b64,
        wrapped_key_b64: encrypted.wrapped_key_b64,
        content_iv_b64: encrypted.content_iv_b64,
        scopes: ["download_ciphertext"],
        expires_at_ns: request.expires_at_ns,
      };
      const signed = await signPayload(grant);
      const result = await client().createGrant(signed.payload, encrypted.ciphertext_b64, signed.signed_message);
      setMessage(`Encrypted reviewer grant ${String(result.grant_id)} created. The Worker received ciphertext only.`);
      await loadGrants();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function rejectRequest() {
    clearNotice();
    setBusy(true);
    try {
      const request = requests.find((candidate) => candidate.request_id === selectedRequestId);
      if (!request) throw new Error("Select a pending reviewer request.");
      const signed = await signPayload({ schema: "lcp.reviewer-request-reject.v1", request_id: request.request_id });
      await client().rejectRequest(request.request_id, signed.payload, signed.signed_message);
      setRequests((current) => current.filter((candidate) => candidate.request_id !== request.request_id));
      setSelectedRequestId("");
      setMessage("Reviewer request rejected with the connected maintainer wallet.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function downloadGrant() {
    clearNotice();
    setBusy(true);
    try {
      if (!privateKey) throw new Error("Unlock the local reviewer key before downloading evidence.");
      const grant = grants.find((candidate) => candidate.grant_id === selectedGrantId);
      if (!grant) throw new Error("Select a reviewer grant.");
      const signed = await signPayload({ schema: "lcp.reviewer-download.v1", grant_id: grant.grant_id });
      const envelope = await client().downloadGrant(grant.grant_id, signed.payload, signed.signed_message);
      if (envelope.grant_id !== grant.grant_id || envelope.request_id !== grant.request_id
          || envelope.commitment_id !== grant.commitment_id || envelope.evaluation_id !== grant.evaluation_id
          || envelope.evidence_digest !== grant.evidence_digest) {
        throw new Error("The downloaded artifact metadata does not match the selected reviewer grant.");
      }
      if (await sha256Hex(envelope.ciphertext) !== envelope.ciphertext_sha256) throw new Error("Downloaded ciphertext failed its SHA-256 integrity check.");
      const decrypted = await decryptPrivateArtifact({
        private_key: privateKey,
        ciphertext: envelope.ciphertext,
        hpke_enc_b64: envelope.hpke_enc_b64,
        wrapped_key_b64: envelope.wrapped_key_b64,
        content_iv_b64: envelope.content_iv_b64,
        request_id: envelope.request_id,
        commitment_id: envelope.commitment_id,
        evaluation_id: envelope.evaluation_id,
        evidence_digest: envelope.evidence_digest,
      });
      downloadBytes(decrypted.file_name, "application/octet-stream", decrypted.file_bytes);
      setMessage(`Evidence decrypted locally; its salted digest ${decrypted.digest_verified ? "matches" : "did not match"} the grant.`);
      decrypted.file_bytes.fill(0);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant() {
    clearNotice();
    setBusy(true);
    try {
      const grant = grants.find((candidate) => candidate.grant_id === selectedGrantId);
      if (!grant) throw new Error("Select a reviewer grant to revoke.");
      const signed = await signPayload({ schema: "lcp.reviewer-revoke.v1", grant_id: grant.grant_id });
      const result = await client().revokeGrant(grant.grant_id, signed.payload, signed.signed_message);
      setMessage(`Grant revoked. Ciphertext purge ${result.artifact_purge === "pending" ? "will retry automatically" : "completed"}. Copies already downloaded by a reviewer cannot be recalled.`);
      await loadGrants();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-card reviewer-access-card" aria-labelledby="reviewer-access-title">
      <div className="card-heading">
        <div><p className="eyebrow">PRIVATE EVIDENCE · CONSENTED ACCESS</p><h3 id="reviewer-access-title">Reviewer access</h3></div>
        <span className="card-index">04</span>
      </div>
      {!SERVICE_URL ? (
        <p className="empty-copy">The reviewer access Worker is not configured for this Console deployment. No file or contact details are sent anywhere.</p>
      ) : !evaluationComplete ? (
        <p className="empty-copy">Reviewer access becomes available after this evaluation finishes.</p>
      ) : (
        <>
          <p className="reviewer-access-intro">A reviewer requests access with a NEAR wallet. The maintainer approves a specific file and expiry. Files are encrypted in this browser; the service stores ciphertext only.</p>
          <div className="reviewer-vault-box">
            <div className="reviewer-subheading"><strong>Local reviewer key</strong><span>{vault ? `Fingerprint · ${vault.fingerprint_hex.slice(0, 16)}…` : "No key for this wallet"}</span></div>
            {privateKey ? (
              <div className="reviewer-inline-actions"><p>Unlocked in this browser session.</p><button type="button" className="browser-text-button" onClick={lockVault}>Lock key</button></div>
            ) : (
              <div className="reviewer-key-controls">
                <label>Passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} minLength={12} /></label>
                <div className="reviewer-inline-actions">
                  {vault ? <button type="button" className="browser-button" disabled={busy || !props.accountId} onClick={() => void unlockVault()}>Unlock reviewer key</button> : <button type="button" className="browser-button" disabled={busy || !props.accountId} onClick={() => void createVault()}>Create local key</button>}
                  <label className="reviewer-import-label">Import backup<input type="file" accept="application/json,.json" onChange={(event) => void importVault(event)} disabled={busy || !props.accountId} /></label>
                </div>
                {!props.accountId && <small>Connect a NEAR wallet to create or load its reviewer key.</small>}
              </div>
            )}
            <p className="reviewer-security-note">The private key backup is encrypted with your passphrase and stays in this browser profile or your downloaded backup. The passphrase is never sent to the Worker.</p>
          </div>

          <div className="reviewer-workflow-grid">
            <section className="reviewer-workflow-block">
              <p className="eyebrow">REQUEST ACCESS</p>
              <p>Enter the salted evidence digest the maintainer shared with you privately. The request is signed by your connected wallet.</p>
              <label>Evidence digest<input className="reviewer-digest-input" inputMode="text" spellCheck={false} autoCapitalize="off" value={requestDigest} onChange={(event) => setRequestDigest(event.target.value.trim())} placeholder="64 lowercase hexadecimal characters" /></label>
              <button type="button" className="browser-button" disabled={busy || !props.accountId || !vault || !evaluationComplete} onClick={() => void createRequest()}>Sign and request access</button>
            </section>
            <section className="reviewer-workflow-block">
              <p className="eyebrow">PREPARE A PRIVATE EVIDENCE DIGEST</p>
              <p>Create a salted commitment for a local file, then share only the digest with an authorized reviewer. Keep the downloaded receipt for later approval.</p>
              <label className="reviewer-file-input">Evidence file<input type="file" onChange={(event) => { setFile(event.target.files?.[0] ?? null); clearNotice(); }} /></label>
              <div className="reviewer-inline-actions"><button type="button" className="browser-button" disabled={busy || !file} onClick={() => void createReceipt()}>Create digest and receipt</button><label className="reviewer-import-label">Load receipt<input type="file" accept="application/json,.json" onChange={(event) => void importReceipt(event)} /></label></div>
              {receipt && <div className="reviewer-receipt"><span>Salted evidence digest</span><code>{receipt.evidence_digest}</code><button type="button" className="browser-text-button" onClick={() => void navigator.clipboard.writeText(receipt.evidence_digest).then(() => setMessage("Digest copied."), () => setError("Clipboard access was unavailable."))}>Copy digest</button></div>}
              {file && <small>Selected locally: {file.name} · {formatBytes(file.size)}</small>}
            </section>
          </div>

          <div className="reviewer-management-grid">
            {isMaintainer && (
              <section className="reviewer-workflow-block">
                <div className="reviewer-section-title"><p className="eyebrow">MAINTAINER CONSENT</p><button type="button" className="browser-text-button" disabled={busy} onClick={() => void loadRequests()}>Load signed requests</button></div>
                {requests.length > 0 && <label>Pending request<select value={selectedRequestId} onChange={(event) => setSelectedRequestId(event.target.value)}>{requests.map((request) => <option key={request.request_id} value={request.request_id}>{request.reviewer_account} · {request.evidence_digest.slice(0, 12)}… · expires {formatNs(request.expires_at_ns)}</option>)}</select></label>}
                <div className="reviewer-inline-actions">
                  <button type="button" className="browser-button" disabled={busy || !selectedRequestId || !file || !receipt} onClick={() => void approveRequest()}>Encrypt file and approve</button>
                  <button type="button" className="browser-text-button" disabled={busy || !selectedRequestId} onClick={() => void rejectRequest()}>Reject request</button>
                </div>
                <small>Approval signs the exact reviewer request, file digest, encryption envelope, scope, and expiry.</small>
              </section>
            )}
            <section className="reviewer-workflow-block">
              <div className="reviewer-section-title"><p className="eyebrow">ACTIVE AND PAST GRANTS</p><button type="button" className="browser-text-button" disabled={busy || !props.accountId} onClick={() => void loadGrants()}>Load grants</button></div>
              {grants.length > 0 && <label>Reviewer grant<select value={selectedGrantId} onChange={(event) => setSelectedGrantId(event.target.value)}>{grants.map((grant) => <option key={grant.grant_id} value={grant.grant_id}>{grant.reviewer_account} · {grant.evidence_digest.slice(0, 12)}… · {grant.revoked_at_ns ? "revoked" : "active"}</option>)}</select></label>}
              <div className="reviewer-inline-actions">
                <button type="button" className="browser-button" disabled={busy || !selectedGrantId || !privateKey} onClick={() => void downloadGrant()}>Sign, download, and decrypt</button>
                {isMaintainer && <button type="button" className="browser-text-button" disabled={busy || !selectedGrantId} onClick={() => void revokeGrant()}>Revoke grant</button>}
              </div>
              <small>Revocation blocks later downloads. It cannot delete a copy a reviewer already received.</small>
            </section>
          </div>
        </>
      )}
      {error && <p className="reviewer-notice reviewer-notice-error" role="alert">{error}</p>}
      {message && <p className="reviewer-notice reviewer-notice-success" role="status">{message}</p>}
    </section>
  );
}

function openVaultDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(VAULT_STORE, { keyPath: "account_id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local key vault."));
  });
}

async function getVault(accountId: string): Promise<ReviewerKeyVault | null> {
  const database = await openVaultDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(VAULT_STORE, "readonly").objectStore(VAULT_STORE).get(accountId);
    request.onsuccess = () => { database.close(); resolve(request.result?.vault ?? null); };
    request.onerror = () => { database.close(); reject(request.error ?? new Error("Could not read local reviewer key.")); };
  });
}

async function putVault(accountId: string, vault: ReviewerKeyVault): Promise<void> {
  const database = await openVaultDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(VAULT_STORE, "readwrite");
    transaction.objectStore(VAULT_STORE).put({ account_id: accountId, vault });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Could not save encrypted reviewer key.")); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Could not save encrypted reviewer key.")); };
  });
}

function isReviewerKeyVault(value: unknown): value is ReviewerKeyVault {
  return isRecord(value) && value.schema === "lcp.reviewer-key-vault.v1"
    && typeof value.public_key_b64 === "string" && typeof value.fingerprint_hex === "string"
    && value.kdf === "PBKDF2-SHA256" && typeof value.iterations === "number"
    && typeof value.salt_b64 === "string" && typeof value.iv_b64 === "string"
    && typeof value.encrypted_private_key_b64 === "string";
}

function isEvidenceReceipt(value: unknown): value is EvidenceReceipt {
  return isRecord(value) && value.schema === "lcp.private-evidence-commitment.v1"
    && typeof value.commitment_id === "string" && typeof value.evaluation_id === "string"
    && typeof value.evidence_digest === "string" && /^[0-9a-f]{64}$/.test(value.evidence_digest)
    && typeof value.digest_salt_b64 === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function downloadJson(filename: string, value: unknown): void {
  downloadBytes(filename, "application/json", new TextEncoder().encode(JSON.stringify(value, null, 2)));
}

function downloadBytes(filename: string, mediaType: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName(filename);
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "evidence.bin";
}

function formatBytes(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1_024))} KiB`;
}

function formatNs(value: string): string {
  try { return `${new Date(Number(BigInt(value) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 19)} UTC`; } catch { return "unknown"; }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Reviewer access could not complete this action.";
}
