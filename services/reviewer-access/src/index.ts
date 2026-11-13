import { canonicalJson, decodeBase64, decodeHex, encodeBase64, sha256Hex, utf8 } from "./encoding.js";
import { createNearReadSession, NearReadError, NearUnavailableError, parseNearAccountId, parseSha256, type NearReadSession } from "./near.js";
import { verifyNep413Message, type SignedWalletMessage } from "./nep413.js";

const MAX_JSON_BYTES = 12 * 1024 * 1024;
const MAX_SCOPES = ["download_ciphertext"] as const;
const MAX_GRANT_LIFETIME_NS = 14n * 24n * 60n * 60n * 1_000_000_000n;
const REVIEWER_METADATA_RETENTION_NS = 90n * 24n * 60n * 60n * 1_000_000_000n;
const ACCESS_WINDOW_SECONDS = 3_600;
const SIGNER_KEY_WINDOW_SECONDS = 60;
const MAX_SIGNER_KEY_REQUESTS_PER_WINDOW = 10;
const MAX_LIST_SIGNATURE_TTL_NS = 10n * 60n * 1_000_000_000n;

type Scope = (typeof MAX_SCOPES)[number];
type ApiErrorCode = "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "NEAR_UNAVAILABLE" | "STORAGE_UNAVAILABLE";

class ApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface ReviewerRequest {
  schema: "lcp.reviewer-request.v1";
  contract_id: string;
  commitment_id: string;
  evaluation_id: string;
  evidence_digest: string;
  reviewer_account: string;
  encryption_public_key_b64: string;
  encryption_key_fingerprint: string;
  scopes: Scope[];
  expires_at_ns: string;
  nonce_hex: string;
}

interface ReviewerGrant {
  schema: "lcp.reviewer-grant.v1";
  request_id: string;
  ciphertext_sha256: string;
  ciphertext_bytes: number;
  hpke_enc_b64: string;
  wrapped_key_b64: string;
  content_iv_b64: string;
  scopes: Scope[];
  expires_at_ns: string;
  nonce_hex: string;
}

interface CommitmentIdentityView {
  id?: string;
  maintainer?: string;
}

interface EvaluationIdentityView {
  status?: string;
  evidence_hash?: string;
}

interface RequestRow extends ReviewerRequest {
  request_id: string;
  network: string;
  created_at_ns: string;
  status: "pending" | "approved" | "rejected" | "expired";
  scopes_json: string;
  resolved_by?: string | null;
  resolved_at_ns?: string | null;
}

interface GrantRow {
  grant_id: string;
  request_id: string;
  artifact_id: string;
  object_key: string;
  network: string;
  contract_id: string;
  commitment_id: string;
  evaluation_id: string;
  evidence_digest: string;
  ciphertext_sha256: string;
  ciphertext_bytes: number;
  owner_account: string;
  reviewer_account: string;
  scopes_json: string;
  expires_at_ns: string;
  hpke_enc_b64: string;
  wrapped_key_b64: string;
  content_iv_b64: string;
  revoked_at_ns: string | null;
  download_count: number;
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Referrer-Policy", "no-referrer");
  return Response.json(body, { status, headers: result });
}

function parseAllowedOrigins(env: Env): string[] {
  return env.APP_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Access-Control-Expose-Headers": "X-LCP-Grant-Id, X-LCP-Request-Id, X-LCP-HPKE-Enc, X-LCP-Wrapped-Key, X-LCP-Content-IV, X-LCP-Commitment-Id, X-LCP-Evaluation-Id, X-LCP-Evidence-Digest, X-LCP-Ciphertext-SHA256",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && parseAllowedOrigins(env).includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function requireAllowedOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("Origin");
  if (!origin || !parseAllowedOrigins(env).includes(origin)) {
    throw new ApiError(403, "FORBIDDEN", "This application origin is not allowed.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

async function readJsonLimited(request: Request): Promise<unknown> {
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new ApiError(413, "BAD_REQUEST", "Request body exceeds the configured limit.");
  }
  if (!request.body) throw new ApiError(400, "BAD_REQUEST", "Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "BAD_REQUEST", "Request body exceeds the configured limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON.");
  }
}

function requireDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20) {
    throw new ApiError(400, "BAD_REQUEST", `${label} must be a canonical unsigned decimal string.`);
  }
  return value;
}

function parseScopes(value: unknown): Scope[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCOPES.length) {
    throw new ApiError(400, "BAD_REQUEST", "At least one supported access scope is required.");
  }
  const scopes = value as unknown[];
  if (scopes.some((scope) => typeof scope !== "string" || !MAX_SCOPES.includes(scope as Scope))) {
    throw new ApiError(400, "BAD_REQUEST", "The request contains an unsupported access scope.");
  }
  const normalized = [...new Set(scopes as Scope[])].sort();
  if (normalized.length !== scopes.length) throw new ApiError(400, "BAD_REQUEST", "Access scopes must be unique.");
  return normalized;
}

function parseSignedMessage(value: unknown): SignedWalletMessage {
  const signed = asRecord(value);
  if (!signed || !exactKeys(signed, ["account_id", "public_key", "signature", "nonce_hex", "recipient", ...(Object.hasOwn(signed, "callback_url") ? ["callback_url"] : [])])) {
    throw new ApiError(400, "BAD_REQUEST", "The NEP-413 signature envelope has an invalid shape.");
  }
  const fields = ["account_id", "public_key", "signature", "nonce_hex", "recipient"] as const;
  if (fields.some((field) => typeof signed[field] !== "string" || signed[field] === "")) {
    throw new ApiError(400, "BAD_REQUEST", "The NEP-413 signature envelope is incomplete.");
  }
  if (signed.callback_url !== undefined && typeof signed.callback_url !== "string") {
    throw new ApiError(400, "BAD_REQUEST", "The NEP-413 callback URL is malformed.");
  }
  return signed as unknown as SignedWalletMessage;
}

async function verifySignedPayload(
  env: Env,
  payload: Record<string, unknown>,
  signedValue: unknown,
  expectedAccount?: string,
): Promise<SignedWalletMessage> {
  const signed = parseSignedMessage(signedValue);
  const account = parseNearAccountId(signed.account_id);
  if (!account || (expectedAccount && account !== expectedAccount)) {
    throw new ApiError(403, "FORBIDDEN", "The NEP-413 signer does not match the authorized account.");
  }
  if (typeof payload.nonce_hex !== "string" || signed.nonce_hex !== payload.nonce_hex) {
    throw new ApiError(400, "BAD_REQUEST", "The NEP-413 nonce must match the signed request payload.");
  }
  const allowedOrigins = parseAllowedOrigins(env);
  if (signed.recipient !== env.ACCESS_RECIPIENT || !await verifyNep413Message(
    canonicalJson(payload), signed, env.ACCESS_RECIPIENT, allowedOrigins,
  )) {
    throw new ApiError(401, "UNAUTHORIZED", "The NEP-413 signature is invalid or bound to a different request.");
  }
  await rateLimitSignerKey(env, signed.public_key);
  return signed;
}

async function requireCurrentAccessKey(near: NearReadSession, signed: SignedWalletMessage): Promise<void> {
  try {
    await near.requireCurrentAccessKey(signed.account_id, signed.public_key);
  } catch (error) {
    if (error instanceof NearUnavailableError) throw new ApiError(503, "NEAR_UNAVAILABLE", "Finalized NEAR access-key state is unavailable.");
    if (error instanceof NearReadError) throw new ApiError(403, "FORBIDDEN", error.message);
    throw error;
  }
}

async function currentChainTime(near: NearReadSession): Promise<bigint> {
  try {
    return await near.finalizedTimeNs();
  } catch {
    throw new ApiError(503, "NEAR_UNAVAILABLE", "Finalized NEAR time is unavailable; retry shortly.");
  }
}

async function readCommitment(near: NearReadSession, commitmentId: string): Promise<CommitmentIdentityView> {
  let commitment: CommitmentIdentityView | null;
  try {
    commitment = await near.viewContract<CommitmentIdentityView>("get_commitment", { commitment_id: commitmentId });
  } catch {
    throw new ApiError(503, "NEAR_UNAVAILABLE", "The commitment could not be read from finalized NEAR state.");
  }
  if (!commitment || parseNearAccountId(commitment.maintainer) === null) {
    throw new ApiError(404, "NOT_FOUND", "The commitment was not found.");
  }
  return commitment;
}

async function requireMaintainer(env: Env, near: NearReadSession, commitmentId: string, accountId: string, publicKey: string): Promise<void> {
  try {
    await near.requireFullAccessKey(accountId, publicKey);
  } catch (error) {
    if (error instanceof NearUnavailableError) throw new ApiError(503, "NEAR_UNAVAILABLE", "Finalized NEAR access-key state is unavailable.");
    if (!(error instanceof NearReadError)) throw error;
    throw new ApiError(403, "FORBIDDEN", "The signer is not a current full-access key for the maintainer account.");
  }
  await rateLimitAccount(env, accountId);
  const commitment = await readCommitment(near, commitmentId);
  if (commitment.maintainer !== accountId) throw new ApiError(403, "FORBIDDEN", "Only the current on-chain maintainer can approve or revoke access.");
  await rateLimitAuthorizedAction(env);
}

async function requireCompletedEvaluation(near: NearReadSession, commitmentId: string, evaluationId: string): Promise<void> {
  let evaluation: EvaluationIdentityView | null;
  try {
    evaluation = await near.viewContract<EvaluationIdentityView>("get_evaluation", {
      commitment_id: commitmentId,
      evaluation_id: evaluationId,
    });
  } catch {
    throw new ApiError(503, "NEAR_UNAVAILABLE", "The evaluation could not be read from finalized NEAR state.");
  }
  if (!evaluation || evaluation.status === "Pending") {
    throw new ApiError(409, "CONFLICT", "Reviewer access can only be requested for a completed on-chain evaluation.");
  }
}

async function useNonce(env: Env, accountId: string, action: string, nonceHex: string, timeNs: bigint): Promise<void> {
  try {
    decodeHex(nonceHex, 32);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "The signed nonce must be 32 bytes of lowercase hexadecimal.");
  }
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO used_nep413_nonces (signer_account, action, nonce_hex, used_at_ns)
     VALUES (?, ?, ?, ?)`,
  ).bind(accountId, action, nonceHex, timeNs.toString()).run();
  if (result.meta.changes !== 1) throw new ApiError(409, "CONFLICT", "This signed request nonce has already been used.");
}

function maxRequestsPerHour(env: Env): number {
  const value = Number(env.MAX_REQUESTS_PER_HOUR);
  return Number.isSafeInteger(value) && value > 0 && value <= 500 ? value : 30;
}

function maxAuthorizedActionsPerMinute(env: Env): number {
  const value = Number(env.MAX_AUTHORIZED_ACTIONS_PER_MINUTE);
  return Number.isSafeInteger(value) && value > 0 && value <= 600 ? value : 30;
}

function requireFreshListAuthorization(payload: Record<string, unknown>, nowNs: bigint): void {
  let expiresAtNs: bigint;
  try {
    expiresAtNs = BigInt(requireDecimal(payload.auth_expires_at_ns, "auth_expires_at_ns"));
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "The signed list authorization expiry is invalid.");
  }
  if (expiresAtNs <= nowNs || expiresAtNs > nowNs + MAX_LIST_SIGNATURE_TTL_NS) {
    throw new ApiError(401, "UNAUTHORIZED", "The signed list authorization has expired or is valid for too long.");
  }
}

async function incrementRateWindow(env: Env, key: string, windowStart: number, limit: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO reviewer_access_windows (account_id, window_start_s, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(account_id, window_start_s) DO UPDATE SET request_count = request_count + 1
     WHERE request_count < ?
     RETURNING request_count`,
  ).bind(key, windowStart, limit).first<{ request_count: number }>();
  return row !== null;
}

async function rateLimitAccount(env: Env, accountId: string): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const accountWindowStart = Math.floor(nowSeconds / ACCESS_WINDOW_SECONDS) * ACCESS_WINDOW_SECONDS;
  if (!await incrementRateWindow(env, accountId, accountWindowStart, maxRequestsPerHour(env))) {
    throw new ApiError(429, "RATE_LIMITED", "The signed access action limit has been reached for this hour.");
  }
}

async function rateLimitAuthorizedAction(env: Env): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const windowStart = Math.floor(nowSeconds / 60) * 60;
  if (!await incrementRateWindow(env, "!global-authorized-actions", windowStart, maxAuthorizedActionsPerMinute(env))) {
    throw new ApiError(429, "RATE_LIMITED", "The service-wide authorized-action limit has been reached for this minute.");
  }
}

async function rateLimitSignerKey(env: Env, publicKey: string): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const windowStart = Math.floor(nowSeconds / SIGNER_KEY_WINDOW_SECONDS) * SIGNER_KEY_WINDOW_SECONDS;
  const keyDigest = await sha256Hex(utf8(publicKey));
  if (!await incrementRateWindow(env, `!nep413-key:${keyDigest}`, windowStart, MAX_SIGNER_KEY_REQUESTS_PER_WINDOW)) {
    throw new ApiError(429, "RATE_LIMITED", "This signing key has reached its request limit for this minute.");
  }
}

async function rateLimitByIp(request: Request, env: Env): Promise<void> {
  const key = request.headers.get("CF-Connecting-IP") ?? "local-development";
  let allowed: boolean;
  try {
    allowed = (await env.API_RATE_LIMITER.limit({ key })).success;
  } catch {
    throw new ApiError(503, "STORAGE_UNAVAILABLE", "The request rate limiter is unavailable; retry shortly.");
  }
  if (!allowed) throw new ApiError(429, "RATE_LIMITED", "Too many requests from this network. Retry in a minute.");
}

async function createRequest(env: Env, near: NearReadSession, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const request = asRecord(root?.request);
  if (!root || !request || !exactKeys(root, ["request", "signed_message"])) {
    throw new ApiError(400, "BAD_REQUEST", "Expected a request and NEP-413 signature envelope.");
  }
  const requestKeys = [
    "schema", "contract_id", "commitment_id", "evaluation_id", "evidence_digest", "reviewer_account",
    "encryption_public_key_b64", "encryption_key_fingerprint", "scopes", "expires_at_ns", "nonce_hex",
  ];
  if (!exactKeys(request, requestKeys) || request.schema !== "lcp.reviewer-request.v1") {
    throw new ApiError(400, "BAD_REQUEST", "The reviewer request schema is unsupported or has extra fields.");
  }
  if (request.contract_id !== env.CONTRACT_ID) throw new ApiError(400, "BAD_REQUEST", "The request names a different LCP contract.");
  const commitmentId = requireDecimal(request.commitment_id, "commitment_id");
  const evaluationId = requireDecimal(request.evaluation_id, "evaluation_id");
  const reviewer = parseNearAccountId(request.reviewer_account);
  const digest = parseSha256(request.evidence_digest);
  const fingerprint = parseSha256(request.encryption_key_fingerprint);
  if (!reviewer || !digest || !fingerprint || typeof request.encryption_public_key_b64 !== "string") {
    throw new ApiError(400, "BAD_REQUEST", "The account, evidence digest, or encryption-key fingerprint is invalid.");
  }
  let encryptionKey: Uint8Array;
  try {
    encryptionKey = decodeBase64(request.encryption_public_key_b64, 32);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "The reviewer X25519 public key must be 32 bytes of canonical base64.");
  }
  if (await sha256Hex(encryptionKey) !== fingerprint) throw new ApiError(400, "BAD_REQUEST", "The encryption-key fingerprint does not match the submitted public key.");
  const scopes = parseScopes(request.scopes);
  const expiresAt = BigInt(requireDecimal(request.expires_at_ns, "expires_at_ns"));
  const signed = await verifySignedPayload(env, request, root.signed_message, reviewer);
  await requireCurrentAccessKey(near, signed);
  await rateLimitAccount(env, reviewer);
  await rateLimitAuthorizedAction(env);
  const now = await currentChainTime(near);
  if (expiresAt <= now || expiresAt > now + MAX_GRANT_LIFETIME_NS) {
    throw new ApiError(400, "BAD_REQUEST", "The access request expiry must be in the future and no more than 14 days away.");
  }
  await requireCompletedEvaluation(near, commitmentId, evaluationId);
  await env.DB.prepare(
    `UPDATE reviewer_requests SET status = 'expired', resolved_at_ns = ?
     WHERE network = ? AND contract_id = ? AND status = 'pending' AND expires_at_ns <= ?`,
  ).bind(now.toString(), env.NETWORK, env.CONTRACT_ID, now.toString()).run();
  await useNonce(env, reviewer, "request", signed.nonce_hex, now);
  const requestId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO reviewer_requests (
         request_id, network, contract_id, commitment_id, evaluation_id, evidence_digest,
         reviewer_account, encryption_public_key_b64, encryption_key_fingerprint,
         scopes_json, expires_at_ns, created_at_ns, status,
         request_public_key, request_signature_b64, request_callback_url, request_signed_record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).bind(
      requestId,
      env.NETWORK,
      env.CONTRACT_ID,
      commitmentId,
      evaluationId,
      digest,
      reviewer,
      request.encryption_public_key_b64,
      fingerprint,
      JSON.stringify(scopes),
      expiresAt.toString(),
      now.toString(),
      signed.public_key,
      signed.signature,
      signed.callback_url ?? null,
      canonicalJson({ payload: request, signed_message: signed }),
    ).run();
  } catch {
    throw new ApiError(409, "CONFLICT", "A request for this evidence and reviewer key already exists, or storage is unavailable.");
  }
  return json({ request_id: requestId, status: "pending", expires_at_ns: expiresAt.toString() }, 201);
}

async function listRequests(env: Env, near: NearReadSession, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const payload = asRecord(root?.payload);
  if (!root || !payload || !exactKeys(root, ["payload", "signed_message"])
      || !exactKeys(payload, ["schema", "commitment_id", "auth_expires_at_ns", "nonce_hex"])
      || payload.schema !== "lcp.reviewer-request-list.v1") {
    throw new ApiError(400, "BAD_REQUEST", "Expected a signed reviewer request-list query.");
  }
  const commitmentId = requireDecimal(payload.commitment_id, "commitment_id");
  const signed = await verifySignedPayload(env, payload, root.signed_message);
  await requireMaintainer(env, near, commitmentId, signed.account_id, signed.public_key);
  const now = await currentChainTime(near);
  requireFreshListAuthorization(payload, now);
  await useNonce(env, signed.account_id, "list-requests", signed.nonce_hex, now);
  await env.DB.prepare(
    `UPDATE reviewer_requests SET status = 'expired', resolved_at_ns = ?
     WHERE network = ? AND contract_id = ? AND commitment_id = ? AND status = 'pending' AND expires_at_ns <= ?`,
  ).bind(now.toString(), env.NETWORK, env.CONTRACT_ID, commitmentId, now.toString()).run();
  const result = await env.DB.prepare(
    `SELECT request_id, commitment_id, evaluation_id, evidence_digest, reviewer_account,
            encryption_public_key_b64, encryption_key_fingerprint, scopes_json, expires_at_ns,
            created_at_ns, status
     FROM reviewer_requests
     WHERE network = ? AND contract_id = ? AND commitment_id = ? AND status = 'pending'
     ORDER BY created_at_ns ASC LIMIT 100`,
  ).bind(env.NETWORK, env.CONTRACT_ID, commitmentId).all();
  return json({ requests: result.results });
}

async function rejectRequest(env: Env, near: NearReadSession, requestId: string, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const payload = asRecord(root?.payload);
  if (!root || !payload || !exactKeys(root, ["payload", "signed_message"])
      || !exactKeys(payload, ["schema", "request_id", "nonce_hex"])
      || payload.schema !== "lcp.reviewer-request-reject.v1" || payload.request_id !== requestId) {
    throw new ApiError(400, "BAD_REQUEST", "Expected a signed rejection for this reviewer request.");
  }
  const request = await env.DB.prepare(
    `SELECT request_id, commitment_id, status FROM reviewer_requests
     WHERE request_id = ? AND network = ? AND contract_id = ?`,
  ).bind(requestId, env.NETWORK, env.CONTRACT_ID)
    .first<{ request_id: string; commitment_id: string; status: string }>();
  if (!request) throw new ApiError(404, "NOT_FOUND", "The reviewer request was not found.");
  if (request.status !== "pending") throw new ApiError(409, "CONFLICT", "The reviewer request is no longer pending.");
  const signed = await verifySignedPayload(env, payload, root.signed_message);
  await requireMaintainer(env, near, request.commitment_id, signed.account_id, signed.public_key);
  const now = await currentChainTime(near);
  await useNonce(env, signed.account_id, "reject-request", signed.nonce_hex, now);
  const result = await env.DB.prepare(
    `UPDATE reviewer_requests
     SET status = 'rejected', resolved_by = ?, resolved_at_ns = ?,
         resolution_public_key = ?, resolution_signature_b64 = ?, resolution_callback_url = ?,
         resolution_signed_record_json = ?
     WHERE request_id = ? AND status = 'pending'`,
  ).bind(
    signed.account_id,
    now.toString(),
    signed.public_key,
    signed.signature,
    signed.callback_url ?? null,
    canonicalJson({ payload, signed_message: signed }),
    requestId,
  ).run();
  if (result.meta.changes !== 1) throw new ApiError(409, "CONFLICT", "The reviewer request changed before the rejection was recorded.");
  return json({ request_id: requestId, status: "rejected", resolved_at_ns: now.toString() });
}

async function createGrant(env: Env, near: NearReadSession, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const grant = asRecord(root?.grant);
  if (!root || !grant || typeof root.ciphertext_b64 !== "string"
      || !exactKeys(root, ["grant", "ciphertext_b64", "signed_message"])) {
    throw new ApiError(400, "BAD_REQUEST", "Expected an encrypted artifact, grant, and maintainer signature.");
  }
  const grantKeys = [
    "schema", "request_id", "ciphertext_sha256", "ciphertext_bytes", "hpke_enc_b64",
    "wrapped_key_b64", "content_iv_b64", "scopes", "expires_at_ns", "nonce_hex",
  ];
  if (!exactKeys(grant, grantKeys) || grant.schema !== "lcp.reviewer-grant.v1") {
    throw new ApiError(400, "BAD_REQUEST", "The reviewer grant schema is unsupported or has extra fields.");
  }
  if (typeof grant.request_id !== "string" || !/^[0-9a-f-]{36}$/.test(grant.request_id)) {
    throw new ApiError(400, "BAD_REQUEST", "The reviewer request ID is invalid.");
  }
  const maximum = Number(env.MAX_ARTIFACT_BYTES);
  const maxArtifactBytes = Number.isSafeInteger(maximum) && maximum > 0 ? Math.min(maximum, 8 * 1024 * 1024) : 8 * 1024 * 1024;
  if (typeof grant.ciphertext_bytes !== "number" || !Number.isSafeInteger(grant.ciphertext_bytes)
      || grant.ciphertext_bytes < 16 || grant.ciphertext_bytes > maxArtifactBytes) {
    throw new ApiError(413, "BAD_REQUEST", "The ciphertext is empty or exceeds the configured artifact-size limit.");
  }
  if (root.ciphertext_b64.length > 4 * Math.ceil(maxArtifactBytes / 3)) {
    throw new ApiError(413, "BAD_REQUEST", "The encoded ciphertext exceeds the configured artifact-size limit.");
  }
  let ciphertext: Uint8Array;
  let hpkeEnc: Uint8Array;
  let wrappedKey: Uint8Array;
  let iv: Uint8Array;
  try {
    ciphertext = decodeBase64(root.ciphertext_b64, Number.isSafeInteger(grant.ciphertext_bytes) ? grant.ciphertext_bytes as number : undefined);
    hpkeEnc = decodeBase64(String(grant.hpke_enc_b64), 32);
    wrappedKey = decodeBase64(String(grant.wrapped_key_b64), 48);
    iv = decodeBase64(String(grant.content_iv_b64), 12);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "The encrypted artifact or HPKE envelope is malformed.");
  }
  if (ciphertext.byteLength < 16 || ciphertext.byteLength > maxArtifactBytes || grant.ciphertext_bytes !== ciphertext.byteLength) {
    throw new ApiError(413, "BAD_REQUEST", "The ciphertext is empty or exceeds the configured artifact-size limit.");
  }
  const ciphertextDigest = await sha256Hex(ciphertext);
  if (parseSha256(grant.ciphertext_sha256) !== ciphertextDigest) {
    throw new ApiError(400, "BAD_REQUEST", "The ciphertext digest does not match the encrypted artifact.");
  }
  const requestRow = await env.DB.prepare(
    `SELECT request_id, network, contract_id, commitment_id, evaluation_id, evidence_digest,
            reviewer_account, encryption_public_key_b64, encryption_key_fingerprint, scopes_json,
            expires_at_ns, created_at_ns, status
     FROM reviewer_requests WHERE request_id = ?`,
  ).bind(grant.request_id).first<RequestRow>();
  if (!requestRow || requestRow.status !== "pending" || requestRow.network !== env.NETWORK || requestRow.contract_id !== env.CONTRACT_ID) {
    throw new ApiError(404, "NOT_FOUND", "The access request is missing or is no longer pending.");
  }
  const scopes = parseScopes(grant.scopes);
  const requestedScopes = JSON.parse(requestRow.scopes_json) as string[];
  if (scopes.some((scope) => !requestedScopes.includes(scope))) {
    throw new ApiError(403, "FORBIDDEN", "The grant exceeds the scope requested by the reviewer.");
  }
  const expiresAt = BigInt(requireDecimal(grant.expires_at_ns, "expires_at_ns"));
  if (expiresAt > BigInt(requestRow.expires_at_ns)) throw new ApiError(400, "BAD_REQUEST", "Grant expiry cannot exceed the signed reviewer request.");
  const requestPayload = {
    schema: "lcp.reviewer-grant.v1",
    request_id: grant.request_id,
    ciphertext_sha256: ciphertextDigest,
    ciphertext_bytes: ciphertext.byteLength,
    hpke_enc_b64: grant.hpke_enc_b64,
    wrapped_key_b64: grant.wrapped_key_b64,
    content_iv_b64: grant.content_iv_b64,
    scopes,
    expires_at_ns: expiresAt.toString(),
    nonce_hex: grant.nonce_hex,
  };
  const signed = await verifySignedPayload(env, requestPayload, root.signed_message);
  await requireMaintainer(env, near, requestRow.commitment_id, signed.account_id, signed.public_key);
  const now = await currentChainTime(near);
  if (expiresAt <= now || expiresAt > now + MAX_GRANT_LIFETIME_NS) {
    throw new ApiError(400, "BAD_REQUEST", "Grant expiry must be in the future and no more than 14 days away.");
  }
  const grantId = crypto.randomUUID();
  const artifactId = crypto.randomUUID();
  const objectKey = crypto.randomUUID();
  const metadata = {
    grant_id: grantId,
    commitment_id: requestRow.commitment_id,
    evaluation_id: requestRow.evaluation_id,
    evidence_digest: requestRow.evidence_digest,
  };
  try {
    const artifactRow = await env.DB.prepare(
      `INSERT INTO encrypted_artifacts (
         artifact_id, object_key, network, contract_id, commitment_id, evaluation_id,
         evidence_digest, ciphertext_sha256, ciphertext_bytes, created_at_ns
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      artifactId, objectKey, env.NETWORK, env.CONTRACT_ID, requestRow.commitment_id,
      requestRow.evaluation_id, requestRow.evidence_digest, ciphertextDigest, ciphertext.byteLength, now.toString(),
    ).run();
    if (artifactRow.meta.changes !== 1) throw new Error("artifact metadata could not be stored");
    await env.PRIVATE_ARTIFACTS.put(objectKey, ciphertext, {
      httpMetadata: { contentType: "application/octet-stream", cacheControl: "private, no-store" },
      customMetadata: { grant_id: grantId },
    });
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO used_nep413_nonces (signer_account, action, nonce_hex, used_at_ns)
         SELECT ?, 'grant', ?, ? WHERE EXISTS (
           SELECT 1 FROM reviewer_requests WHERE request_id = ? AND status = 'pending'
         )`,
      ).bind(signed.account_id, signed.nonce_hex, now.toString(), requestRow.request_id),
      env.DB.prepare(
        `INSERT INTO reviewer_grants (
           grant_id, request_id, artifact_id, owner_account, reviewer_account, scopes_json,
           expires_at_ns, hpke_enc_b64, wrapped_key_b64, content_iv_b64, created_at_ns
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM reviewer_requests WHERE request_id = ? AND status = 'pending'
         ) AND changes() = 1`,
      ).bind(
        grantId, requestRow.request_id, artifactId, signed.account_id, requestRow.reviewer_account,
        JSON.stringify(scopes), expiresAt.toString(), grant.hpke_enc_b64, grant.wrapped_key_b64,
        grant.content_iv_b64, now.toString(), requestRow.request_id,
      ),
      env.DB.prepare(
        `UPDATE reviewer_requests
         SET status = 'approved', resolved_by = ?, resolved_at_ns = ?,
             resolution_public_key = ?, resolution_signature_b64 = ?, resolution_callback_url = ?,
             resolution_signed_record_json = ?
         WHERE request_id = ? AND status = 'pending' AND changes() = 1`,
      ).bind(
        signed.account_id,
        now.toString(),
        signed.public_key,
        signed.signature,
        signed.callback_url ?? null,
        canonicalJson({ payload: requestPayload, signed_message: signed }),
        requestRow.request_id,
      ),
    ]);
    if (results.some((result) => !result.success || result.meta.changes !== 1)) throw new Error("grant transaction failed");
  } catch {
    try {
      const committedGrant = await env.DB.prepare(
        `SELECT g.grant_id, g.expires_at_ns, a.commitment_id, a.evaluation_id, a.evidence_digest
         FROM reviewer_grants g JOIN encrypted_artifacts a ON a.artifact_id = g.artifact_id
         WHERE g.request_id = ? AND a.network = ? AND a.contract_id = ?`,
      ).bind(requestRow.request_id, env.NETWORK, env.CONTRACT_ID).first<{
        grant_id: string;
        expires_at_ns: string;
        commitment_id: string;
        evaluation_id: string;
        evidence_digest: string;
      }>();
      if (committedGrant) {
        return json({
          grant_id: committedGrant.grant_id,
          status: "active",
          expires_at_ns: committedGrant.expires_at_ns,
          artifact: {
            grant_id: committedGrant.grant_id,
            commitment_id: committedGrant.commitment_id,
            evaluation_id: committedGrant.evaluation_id,
            evidence_digest: committedGrant.evidence_digest,
          },
        }, 201);
      }
    } catch {
      // The commit outcome is unknown. Leave the object for the orphan collector; never delete a committed grant's ciphertext.
    }
    throw new ApiError(409, "CONFLICT", "The grant could not be stored; confirm the request is still pending and retry with a new nonce.");
  }
  return json({ grant_id: grantId, status: "active", expires_at_ns: expiresAt.toString(), artifact: metadata }, 201);
}

async function listGrants(env: Env, near: NearReadSession, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const payload = asRecord(root?.payload);
  if (!root || !payload || !exactKeys(root, ["payload", "signed_message"])
      || !exactKeys(payload, ["schema", "commitment_id", "auth_expires_at_ns", "nonce_hex"])
      || payload.schema !== "lcp.reviewer-grant-list.v1") {
    throw new ApiError(400, "BAD_REQUEST", "Expected a signed reviewer grant-list query.");
  }
  const commitmentId = requireDecimal(payload.commitment_id, "commitment_id");
  const signed = await verifySignedPayload(env, payload, root.signed_message);
  await requireCurrentAccessKey(near, signed);
  await rateLimitAccount(env, signed.account_id);
  await rateLimitAuthorizedAction(env);
  const now = await currentChainTime(near);
  requireFreshListAuthorization(payload, now);
  const commitment = await readCommitment(near, commitmentId);
  const isMaintainer = commitment.maintainer === signed.account_id;
  await useNonce(env, signed.account_id, "list-grants", signed.nonce_hex, now);
  const result = await env.DB.prepare(
    `SELECT g.grant_id, g.request_id, g.reviewer_account, g.scopes_json, g.expires_at_ns,
            g.hpke_enc_b64, g.wrapped_key_b64, g.content_iv_b64, g.revoked_at_ns,
            a.commitment_id, a.evaluation_id, a.evidence_digest, a.ciphertext_sha256, a.ciphertext_bytes
     FROM reviewer_grants g JOIN encrypted_artifacts a ON a.artifact_id = g.artifact_id
     WHERE (? = 1 OR g.reviewer_account = ?)
       AND a.network = ? AND a.contract_id = ? AND a.commitment_id = ?
     ORDER BY g.created_at_ns DESC LIMIT 100`,
  ).bind(isMaintainer ? 1 : 0, signed.account_id, env.NETWORK, env.CONTRACT_ID, commitmentId).all();
  return json({ grants: result.results });
}

async function consumeGrantDownload(env: Env, grant: GrantRow, signed: SignedWalletMessage, now: bigint): Promise<void> {
  const maxDownloadsValue = Number(env.MAX_DOWNLOADS_PER_GRANT);
  const maxDownloads = Number.isSafeInteger(maxDownloadsValue) && maxDownloadsValue > 0 ? Math.min(maxDownloadsValue, 100) : 20;
  await useNonce(env, signed.account_id, "download", signed.nonce_hex, now);
  const results = await env.DB.batch([
    env.DB.prepare(
    `UPDATE reviewer_grants SET download_count = download_count + 1
     WHERE grant_id = ? AND revoked_at_ns IS NULL AND download_count < ?
     RETURNING download_count`,
    ).bind(grant.grant_id, maxDownloads),
    env.DB.prepare(
      `INSERT INTO reviewer_access_events (grant_id, actor_account, accessed_at_ns, action)
       SELECT ?, ?, ?, 'download' WHERE changes() = 1`,
    ).bind(grant.grant_id, signed.account_id, now.toString()),
  ]);
  if (!results.every((result) => result.success) || results[0].meta.changes !== 1) {
    throw new ApiError(429, "RATE_LIMITED", "This grant has reached its download limit or was revoked.");
  }
}

async function downloadGrant(env: Env, near: NearReadSession, grantId: string, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const payload = asRecord(root?.payload);
  if (!root || !payload || !exactKeys(root, ["payload", "signed_message"])) {
    throw new ApiError(400, "BAD_REQUEST", "Expected a signed download authorization.");
  }
  const grant = await env.DB.prepare(
    `SELECT g.grant_id, g.request_id, g.artifact_id, g.owner_account, g.reviewer_account,
            g.scopes_json, g.expires_at_ns, g.hpke_enc_b64, g.wrapped_key_b64, g.content_iv_b64,
            g.revoked_at_ns, g.download_count, a.object_key, a.network, a.contract_id,
            a.commitment_id, a.evaluation_id, a.evidence_digest, a.ciphertext_sha256, a.ciphertext_bytes
     FROM reviewer_grants g JOIN encrypted_artifacts a ON a.artifact_id = g.artifact_id
     WHERE g.grant_id = ?`,
  ).bind(grantId).first<GrantRow>();
  if (!grant || grant.network !== env.NETWORK || grant.contract_id !== env.CONTRACT_ID) {
    throw new ApiError(404, "NOT_FOUND", "The reviewer grant was not found.");
  }
  const expectedPayload = {
    schema: "lcp.reviewer-download.v1",
    grant_id: grantId,
    nonce_hex: typeof payload.nonce_hex === "string" ? payload.nonce_hex : "",
  };
  if (!exactKeys(payload, ["schema", "grant_id", "nonce_hex"]) || payload.schema !== expectedPayload.schema || payload.grant_id !== grantId) {
    throw new ApiError(400, "BAD_REQUEST", "The download authorization has an invalid shape.");
  }
  const signed = await verifySignedPayload(env, expectedPayload, root.signed_message, grant.reviewer_account);
  if (signed.nonce_hex !== expectedPayload.nonce_hex) throw new ApiError(400, "BAD_REQUEST", "The signature nonce does not match the signed download request.");
  await requireCurrentAccessKey(near, signed);
  await rateLimitAccount(env, signed.account_id);
  await rateLimitAuthorizedAction(env);
  const now = await currentChainTime(near);
  if (grant.revoked_at_ns !== null || BigInt(grant.expires_at_ns) <= now) {
    throw new ApiError(403, "FORBIDDEN", "This reviewer grant is revoked or expired.");
  }
  if (!(JSON.parse(grant.scopes_json) as string[]).includes("download_ciphertext")) {
    throw new ApiError(403, "FORBIDDEN", "This grant does not include artifact download scope.");
  }
  const object = await env.PRIVATE_ARTIFACTS.get(grant.object_key);
  if (!object) throw new ApiError(404, "NOT_FOUND", "The encrypted artifact is no longer available.");
  await consumeGrantDownload(env, grant, signed, now);
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Length": String(object.size),
    "Content-Disposition": "attachment; filename=encrypted-evidence.bin",
    "Cache-Control": "no-store",
    "X-LCP-Grant-Id": grant.grant_id,
    "X-LCP-Request-Id": grant.request_id,
    "X-LCP-HPKE-Enc": grant.hpke_enc_b64,
    "X-LCP-Wrapped-Key": grant.wrapped_key_b64,
    "X-LCP-Content-IV": grant.content_iv_b64,
    "X-LCP-Commitment-Id": grant.commitment_id,
    "X-LCP-Evaluation-Id": grant.evaluation_id,
    "X-LCP-Evidence-Digest": grant.evidence_digest,
    "X-LCP-Ciphertext-SHA256": grant.ciphertext_sha256,
    "Access-Control-Expose-Headers": "X-LCP-Grant-Id, X-LCP-Request-Id, X-LCP-HPKE-Enc, X-LCP-Wrapped-Key, X-LCP-Content-IV, X-LCP-Commitment-Id, X-LCP-Evaluation-Id, X-LCP-Evidence-Digest, X-LCP-Ciphertext-SHA256",
  });
  return new Response(object.body, { headers });
}

async function revokeGrant(env: Env, near: NearReadSession, grantId: string, body: unknown): Promise<Response> {
  const root = asRecord(body);
  const payload = asRecord(root?.payload);
  if (!root || !payload || !exactKeys(root, ["payload", "signed_message"])
      || !exactKeys(payload, ["schema", "grant_id", "nonce_hex"])
      || payload.schema !== "lcp.reviewer-revoke.v1" || payload.grant_id !== grantId) {
    throw new ApiError(400, "BAD_REQUEST", "Expected a signed revocation for this grant.");
  }
  const grant = await env.DB.prepare(
    `SELECT g.grant_id, g.revoked_at_ns, a.object_key, a.commitment_id
     FROM reviewer_grants g JOIN encrypted_artifacts a ON a.artifact_id = g.artifact_id
     WHERE g.grant_id = ? AND a.network = ? AND a.contract_id = ?`,
  ).bind(grantId, env.NETWORK, env.CONTRACT_ID).first<{ grant_id: string; revoked_at_ns: string | null; object_key: string; commitment_id: string }>();
  if (!grant) throw new ApiError(404, "NOT_FOUND", "The reviewer grant was not found.");
  if (grant.revoked_at_ns !== null) throw new ApiError(409, "CONFLICT", "The reviewer grant has already been revoked.");
  const signed = await verifySignedPayload(env, payload, root.signed_message);
  await requireMaintainer(env, near, grant.commitment_id, signed.account_id, signed.public_key);
  const now = await currentChainTime(near);
  await useNonce(env, signed.account_id, "revoke", signed.nonce_hex, now);
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE reviewer_grants SET revoked_at_ns = ? WHERE grant_id = ? AND revoked_at_ns IS NULL")
      .bind(now.toString(), grantId),
    env.DB.prepare(
      `INSERT INTO reviewer_access_events (grant_id, actor_account, accessed_at_ns, action)
       SELECT ?, ?, ?, 'revoke' WHERE changes() = 1`,
    ).bind(grantId, signed.account_id, now.toString()),
  ]);
  if (!results.every((result) => result.success) || results[0].meta.changes !== 1) {
    throw new ApiError(409, "CONFLICT", "The reviewer grant changed before revocation was recorded.");
  }
  let artifactPurge = "complete";
  try {
    await env.PRIVATE_ARTIFACTS.delete(grant.object_key);
    await env.DB.prepare("UPDATE encrypted_artifacts SET deleted_at_ns = ? WHERE object_key = ? AND deleted_at_ns IS NULL")
      .bind(now.toString(), grant.object_key).run();
  } catch {
    artifactPurge = "pending";
  }
  return json({ grant_id: grantId, revoked: true, revoked_at_ns: now.toString(), artifact_purge: artifactPurge });
}

async function purgeArtifactBatch(
  env: Env,
  artifacts: Array<{ artifact_id: string; object_key: string }>,
  nowNs: string,
): Promise<void> {
  if (artifacts.length === 0) return;
  try {
    await env.PRIVATE_ARTIFACTS.delete(artifacts.map((artifact) => artifact.object_key));
    const results = await env.DB.batch(artifacts.map((artifact) => env.DB.prepare(
      "UPDATE encrypted_artifacts SET deleted_at_ns = ? WHERE artifact_id = ? AND deleted_at_ns IS NULL",
    ).bind(nowNs, artifact.artifact_id)));
    if (results.some((result) => !result.success)) throw new Error("artifact deletion metadata batch failed");
  } catch (error) {
    console.error(JSON.stringify({
      event: "reviewer_artifact_purge_retry",
      error: error instanceof Error ? error.name : "unknown",
    }));
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ status: "ok", service: "lcp-reviewer-access", network: env.NETWORK });
  }
  if (request.method !== "POST") throw new ApiError(404, "NOT_FOUND", "Route not found.");
  requireAllowedOrigin(request, env);
  await rateLimitByIp(request, env);
  const body = await readJsonLimited(request);
  const near = createNearReadSession(env);
  if (url.pathname === "/v1/requests") return createRequest(env, near, body);
  if (url.pathname === "/v1/requests/list") return listRequests(env, near, body);
  const reject = url.pathname.match(/^\/v1\/requests\/([0-9a-f-]{36})\/reject$/);
  if (reject) return rejectRequest(env, near, reject[1], body);
  if (url.pathname === "/v1/grants") return createGrant(env, near, body);
  if (url.pathname === "/v1/grants/list") return listGrants(env, near, body);
  const download = url.pathname.match(/^\/v1\/grants\/([0-9a-f-]{36})\/download$/);
  if (download) return downloadGrant(env, near, download[1], body);
  const revoke = url.pathname.match(/^\/v1\/grants\/([0-9a-f-]{36})\/revoke$/);
  if (revoke) return revokeGrant(env, near, revoke[1], body);
  throw new ApiError(404, "NOT_FOUND", "Route not found.");
}

async function cleanupExpiredAccess(env: Env): Promise<void> {
  const near = createNearReadSession(env);
  const now = await currentChainTime(near);
  await env.DB.prepare(
    `UPDATE reviewer_requests SET status = 'expired', resolved_at_ns = ?
     WHERE network = ? AND contract_id = ? AND status = 'pending' AND expires_at_ns <= ?`,
  ).bind(now.toString(), env.NETWORK, env.CONTRACT_ID, now.toString()).run();

  const expired = await env.DB.prepare(
    `SELECT a.artifact_id, a.object_key
     FROM encrypted_artifacts a JOIN reviewer_grants g ON g.artifact_id = a.artifact_id
     WHERE a.network = ? AND a.contract_id = ? AND a.deleted_at_ns IS NULL
       AND (g.revoked_at_ns IS NOT NULL OR g.expires_at_ns <= ?)
     ORDER BY a.created_at_ns ASC LIMIT 100`,
  ).bind(env.NETWORK, env.CONTRACT_ID, now.toString()).all<{ artifact_id: string; object_key: string }>();
  await purgeArtifactBatch(env, expired.results, now.toString());

  const orphanCutoffNs = now - 15n * 60n * 1_000_000_000n;
  const orphaned = await env.DB.prepare(
    `SELECT a.artifact_id, a.object_key
     FROM encrypted_artifacts a
     WHERE a.network = ? AND a.contract_id = ? AND a.deleted_at_ns IS NULL AND a.created_at_ns <= ?
       AND NOT EXISTS (SELECT 1 FROM reviewer_grants g WHERE g.artifact_id = a.artifact_id)
     ORDER BY a.created_at_ns ASC LIMIT 100`,
  ).bind(env.NETWORK, env.CONTRACT_ID, orphanCutoffNs.toString()).all<{ artifact_id: string; object_key: string }>();
  await purgeArtifactBatch(env, orphaned.results, now.toString());

  const accessLogCutoffNs = now - REVIEWER_METADATA_RETENTION_NS;
  const nonceCutoffNs = now - 30n * 24n * 60n * 60n * 1_000_000_000n;
  const windowCutoffSeconds = Number(now / 1_000_000_000n) - 2 * 24 * 60 * 60;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reviewer_access_events WHERE accessed_at_ns < ?").bind(accessLogCutoffNs.toString()),
    env.DB.prepare("DELETE FROM used_nep413_nonces WHERE used_at_ns < ?").bind(nonceCutoffNs.toString()),
    env.DB.prepare("DELETE FROM reviewer_access_windows WHERE window_start_s < ?").bind(windowCutoffSeconds),
  ]);

  const metadataCutoffNs = now - REVIEWER_METADATA_RETENTION_NS;
  const closedGrants = await env.DB.prepare(
    `WITH grant_retention AS (
       SELECT g.grant_id, g.request_id, g.artifact_id, g.created_at_ns,
              CASE WHEN g.revoked_at_ns IS NOT NULL THEN g.revoked_at_ns ELSE g.expires_at_ns END AS closed_at_ns,
              COALESCE((SELECT e.accessed_at_ns FROM reviewer_access_events e WHERE e.grant_id = g.grant_id
                        ORDER BY LENGTH(e.accessed_at_ns) DESC, e.accessed_at_ns DESC LIMIT 1), '0') AS last_accessed_at_ns
       FROM reviewer_grants g
       JOIN encrypted_artifacts a ON a.artifact_id = g.artifact_id
       WHERE a.network = ? AND a.contract_id = ? AND a.deleted_at_ns IS NOT NULL
         AND (g.revoked_at_ns IS NOT NULL OR g.expires_at_ns <= ?)
     ), eligible_grants AS (
       SELECT *, CASE
         WHEN LENGTH(last_accessed_at_ns) > LENGTH(closed_at_ns)
           OR (LENGTH(last_accessed_at_ns) = LENGTH(closed_at_ns) AND last_accessed_at_ns > closed_at_ns)
         THEN last_accessed_at_ns ELSE closed_at_ns END AS retention_anchor_ns
       FROM grant_retention
     )
     SELECT grant_id, request_id, artifact_id, retention_anchor_ns
     FROM eligible_grants
     WHERE LENGTH(retention_anchor_ns) < LENGTH(?)
        OR (LENGTH(retention_anchor_ns) = LENGTH(?) AND retention_anchor_ns <= ?)
     ORDER BY created_at_ns ASC LIMIT 100`,
  ).bind(env.NETWORK, env.CONTRACT_ID, now.toString(), metadataCutoffNs.toString(), metadataCutoffNs.toString(), metadataCutoffNs.toString()).all<{
    grant_id: string;
    request_id: string;
    artifact_id: string;
    retention_anchor_ns: string;
  }>();
  for (const grant of closedGrants.results) {
    const purged = await env.DB.batch([
      env.DB.prepare("DELETE FROM reviewer_access_events WHERE grant_id = ?").bind(grant.grant_id),
      env.DB.prepare("DELETE FROM reviewer_grants WHERE grant_id = ?").bind(grant.grant_id),
      env.DB.prepare("DELETE FROM reviewer_requests WHERE request_id = ?").bind(grant.request_id),
      env.DB.prepare("DELETE FROM encrypted_artifacts WHERE artifact_id = ? AND deleted_at_ns IS NOT NULL").bind(grant.artifact_id),
    ]);
    if (!purged.every((result) => result.success)
        || purged[1].meta.changes !== 1 || purged[2].meta.changes !== 1 || purged[3].meta.changes !== 1) {
      throw new Error("reviewer metadata retention transaction failed");
    }
  }

  await env.DB.prepare(
    `DELETE FROM reviewer_requests
     WHERE network = ? AND contract_id = ? AND status IN ('rejected', 'expired')
       AND resolved_at_ns IS NOT NULL AND resolved_at_ns <= ?
       AND NOT EXISTS (SELECT 1 FROM reviewer_grants g WHERE g.request_id = reviewer_requests.request_id)`,
  ).bind(env.NETWORK, env.CONTRACT_ID, metadataCutoffNs.toString()).run();
  await env.DB.prepare(
    `DELETE FROM encrypted_artifacts
     WHERE network = ? AND contract_id = ? AND deleted_at_ns IS NOT NULL AND deleted_at_ns <= ?
       AND NOT EXISTS (SELECT 1 FROM reviewer_grants g WHERE g.artifact_id = encrypted_artifacts.artifact_id)`,
  ).bind(env.NETWORK, env.CONTRACT_ID, metadataCutoffNs.toString()).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const response = await route(request, env);
      for (const [key, value] of headers) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.code, message: error.message }, error.status, headers);
      if (error instanceof NearUnavailableError) return json({ error: "NEAR_UNAVAILABLE", message: "Finalized NEAR state is unavailable; retry shortly." }, 503, headers);
      if (error instanceof NearReadError) return json({ error: "NEAR_UNAVAILABLE", message: "Finalized NEAR state is unavailable; retry shortly." }, 503, headers);
      console.error(JSON.stringify({ event: "reviewer_access_failure", error: error instanceof Error ? error.name : "unknown" }));
      return json({ error: "STORAGE_UNAVAILABLE", message: "The reviewer access service could not complete this request." }, 503, headers);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await cleanupExpiredAccess(env);
  },
} satisfies ExportedHandler<Env>;
