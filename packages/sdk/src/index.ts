export type DecimalString = string;
export type CommitmentId = DecimalString;
export type EvaluationId = DecimalString;
export type ChallengeId = DecimalString;
export type TransferId = DecimalString;
export type YoctoNear = DecimalString;
export type Nanoseconds = DecimalString;
export type Sha256Hex = string;
export type Ed25519PublicKeyHex = string;
export type Ed25519SignatureHex = string;

export type Lifecycle = "Draft" | "Active" | "Closed";
export type Health = "AwaitingEvidence" | "Healthy" | "AtRisk" | "Breached" | "Closed";
export type Verdict = "Compliant" | "NonCompliant";
export type EvaluationStatus = "Pending" | "Accepted" | "Rejected" | "Failed" | "TimedOut";
export type ChallengeStatus = "Open" | "Upheld" | "Invalidated" | "TimedOut";
export type TrancheStatus = "Unclaimed" | "Pending" | "Paid" | "Failed";

export interface TemporalPolicyInput {
  initial_window_ns: Nanoseconds;
  evidence_ttl_ns: Nanoseconds;
  grace_ns: Nanoseconds;
  max_source_lag_ns: Nanoseconds;
  challenge_window_ns: Nanoseconds;
  resolution_timeout_ns: Nanoseconds;
  recovery_allowed: boolean;
}

export type EvidencePolicyInput =
  | { signature_scheme: "ed25519_raw_v1"; maintainer_public_key_hex: Ed25519PublicKeyHex }
  | { signature_scheme: "near_nep413"; maintainer_public_key: NearEd25519PublicKey };

export type NearEd25519PublicKey = `ed25519:${string}`;

export interface EvaluatorPolicyInput {
  outlayer_account: string;
  wasm_url: string;
  wasm_sha256_hex: Sha256Hex;
  build_target: "wasm32-wasip1" | "wasm32-wasip2";
  max_instructions: DecimalString;
  max_memory_mb: number;
  max_execution_seconds: DecimalString;
  request_timeout_ns: Nanoseconds;
  execution_deposit_yocto: YoctoNear;
}

export interface BudgetPolicyInput {
  sponsor: string;
  beneficiary: string;
  epoch_ns: Nanoseconds;
  max_epochs: number;
  tranche_yocto: YoctoNear;
}

export interface CreateCommitmentArgs {
  subject: string;
  maintainer: string;
  arbiter: string;
  policy: {
    temporal: TemporalPolicyInput;
    evidence: EvidencePolicyInput;
    evaluator: EvaluatorPolicyInput;
    budget: BudgetPolicyInput;
  };
}

interface SignedHeartbeatEvidenceBase {
  type: "signed_maintenance_heartbeat";
  artifact_hash: Sha256Hex;
  payload: string;
}

export interface LegacySignedHeartbeatEvidence extends SignedHeartbeatEvidenceBase {
  maintainer_public_key: Ed25519PublicKeyHex;
  signature: Ed25519SignatureHex;
}

export interface Nep413SignedHeartbeatEvidence extends SignedHeartbeatEvidenceBase {
  maintainer_public_key: NearEd25519PublicKey;
  signature: string;
  signature_scheme: "near_nep413";
  nonce_hex: string;
  recipient: string;
  callback_url: string;
}

export type SignedHeartbeatEvidence = LegacySignedHeartbeatEvidence | Nep413SignedHeartbeatEvidence;

export interface NearSignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
}

export interface HeartbeatSigningInput {
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  policy_version: number;
  policy_hash: Sha256Hex;
  observed_at_ns: Nanoseconds;
  subject: string;
  artifact_hash: Sha256Hex;
  pinned_public_key_hex?: Ed25519PublicKeyHex;
}

export interface HeartbeatSigner {
  publicKeyHex: Ed25519PublicKeyHex;
  sign(message: Uint8Array): Promise<Ed25519SignatureHex>;
}

export interface CommitmentView {
  id: CommitmentId;
  subject: string;
  creator: string;
  maintainer: string;
  arbiter: string;
  lifecycle: Lifecycle;
  policy_version: number;
  policy_hash: Sha256Hex;
  next_evaluation_id: EvaluationId;
  pending_evaluation_id: EvaluationId | null;
  active_challenge_id: ChallengeId | null;
  activated_at_ns: Nanoseconds | null;
  last_observed_at_ns: Nanoseconds | null;
  last_good_observed_at_ns: Nanoseconds | null;
  negative_since_ns: Nanoseconds | null;
  effective_health: Health;
  escrow_funded_yocto: YoctoNear;
  escrow_paid_yocto: YoctoNear;
  escrow_refunded_yocto: YoctoNear;
  escrow_pending_yocto: YoctoNear;
  operations_funded_yocto: YoctoNear;
  operations_authorized_spend_yocto: YoctoNear;
  storage_deposit_yocto: YoctoNear;
}

export interface CommitmentSummaryView {
  id: CommitmentId;
  subject: string;
  lifecycle: Lifecycle;
  effective_health: Health;
  policy_version: number;
  escrow_funded_yocto: YoctoNear;
  escrow_paid_yocto: YoctoNear;
}

export interface TemporalPolicyView extends Omit<TemporalPolicyInput, "recovery_allowed"> {
  recovery_allowed: boolean;
}

export interface CommitmentPolicyView {
  version: number;
  temporal: TemporalPolicyView;
  evidence: {
    signature_scheme?: "ed25519_raw_v1" | "near_nep413";
    maintainer_public_key_hex?: Ed25519PublicKeyHex;
    maintainer_key_fingerprint_hex?: Sha256Hex;
  };
  evaluator: Omit<EvaluatorPolicyInput, "wasm_sha256_hex"> & { wasm_sha256_hex: Sha256Hex };
  budget: BudgetPolicyInput;
}

export interface EvaluationRecordView {
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  request_transaction_hash: Sha256Hex | null;
  status: EvaluationStatus;
  verdict: Verdict | null;
  reason_codes: string[];
  input_hash: Sha256Hex;
  evidence_hash: Sha256Hex;
  observed_at_ns: Nanoseconds;
  accepted_at_ns: Nanoseconds | null;
  policy_hash: Sha256Hex;
  output_hash: Sha256Hex | null;
}

export interface ChallengeView {
  id: ChallengeId;
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  challenger: string;
  reason_hash: Sha256Hex;
  opened_at_ns: Nanoseconds;
  resolution_deadline_ns: Nanoseconds;
  completed_at_ns: Nanoseconds | null;
  status: ChallengeStatus;
}

export interface TrancheView {
  commitment_id: CommitmentId;
  epoch: DecimalString;
  amount_yocto: YoctoNear;
  status: TrancheStatus;
  transfer_id: TransferId | null;
}

export interface ClaimEligibilityView {
  eligible: boolean;
  reason: string | null;
  current_epoch: DecimalString | null;
  amount_yocto: YoctoNear;
}

export interface EscrowStatusView {
  funded_yocto: YoctoNear;
  paid_yocto: YoctoNear;
  refunded_yocto: YoctoNear;
  pending_yocto: YoctoNear;
  free_yocto: YoctoNear;
}

export interface LcpEvent<TData extends Record<string, unknown> = Record<string, unknown>> {
  standard: "lcp";
  version: string;
  event: string;
  data: TData[];
}

export interface LcpTransport {
  view<T>(contractId: string, methodName: string, args: Record<string, unknown>): Promise<T>;
  call<T = unknown>(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
    options?: ContractCallOptions,
  ): Promise<T>;
}

export interface NearTransactionRequest extends ContractCallOptions {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
}

export type NearTransactionSender = <T = unknown>(request: NearTransactionRequest) => Promise<T>;

export interface NearJsonRpcTransportOptions {
  rpcUrl: string;
  sendTransaction?: NearTransactionSender;
  fetchImplementation?: typeof fetch;
}

export interface ContractCallOptions {
  attachedDepositYocto?: YoctoNear;
  gas?: DecimalString;
}

/** NEAR JSON-RPC views plus a wallet-provided transaction sender. */
export class NearJsonRpcTransport implements LcpTransport {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: NearJsonRpcTransportOptions) {
    this.fetchImplementation = (options.fetchImplementation ?? fetch).bind(globalThis);
  }

  async view<T>(contractId: string, methodName: string, args: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImplementation(this.options.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "lcp-sdk",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: methodName,
          args_base64: encodeBase64(new TextEncoder().encode(JSON.stringify(args))),
        },
      }),
    });
    if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status}.`);

    const payload: unknown = await response.json();
    if (!isRecord(payload)) throw new Error("NEAR RPC returned an invalid JSON-RPC response.");
    if ("error" in payload) throw new Error(`NEAR RPC query failed: ${describeError(payload.error)}`);
    if (!isRecord(payload.result)) throw new Error("NEAR RPC response is missing its result.");
    if (typeof payload.result.error === "string") {
      throw new Error(`NEAR view method ${methodName} failed: ${payload.result.error}`);
    }
    if (!Array.isArray(payload.result.result)
      || !payload.result.result.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error("NEAR RPC view result is not a byte array.");
    }

    const json = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(payload.result.result));
    return JSON.parse(json) as T;
  }

  call<T = unknown>(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>,
    options: ContractCallOptions = {},
  ): Promise<T> {
    if (!this.options.sendTransaction) {
      return Promise.reject(new Error("No wallet transaction sender is configured."));
    }
    return this.options.sendTransaction<T>({ contractId, methodName, args, ...options });
  }
}

/** Thin typed wrapper. Wallet connection and NEAR transaction signing stay in the transport. */
export class LcpClient {
  constructor(
    readonly contractId: string,
    private readonly transport: LcpTransport,
  ) {}

  getCommitment(id: CommitmentId): Promise<CommitmentView | null> {
    return this.transport.view<CommitmentView | null>(this.contractId, "get_commitment", { commitment_id: id });
  }

  listCommitments(beforeId: CommitmentId | null, limit: number): Promise<CommitmentSummaryView[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      return Promise.reject(new Error("Commitment page size must be an integer from 1 to 20."));
    }
    return this.transport.view<CommitmentSummaryView[]>(this.contractId, "list_commitments", {
      before_id: beforeId,
      limit,
    });
  }

  getPolicy(id: CommitmentId): Promise<CommitmentPolicyView | null> {
    return this.transport.view<CommitmentPolicyView | null>(this.contractId, "get_policy", { commitment_id: id });
  }

  getEffectiveHealth(id: CommitmentId): Promise<Health | null> {
    return this.transport.view<Health | null>(this.contractId, "get_effective_health", { commitment_id: id });
  }

  getLatestEvaluation(id: CommitmentId): Promise<EvaluationRecordView | null> {
    return this.transport.view<EvaluationRecordView | null>(this.contractId, "get_latest_evaluation", { commitment_id: id });
  }

  getEvaluation(id: CommitmentId, evaluationId: EvaluationId): Promise<EvaluationRecordView | null> {
    return this.transport.view<EvaluationRecordView | null>(this.contractId, "get_evaluation", {
      commitment_id: id,
      evaluation_id: evaluationId,
    });
  }

  getEvaluationTimeout(id: CommitmentId, evaluationId: EvaluationId): Promise<Nanoseconds | null> {
    return this.transport.view<Nanoseconds | null>(this.contractId, "get_evaluation_timeout", {
      commitment_id: id,
      evaluation_id: evaluationId,
    });
  }

  getChallenge(challengeId: ChallengeId): Promise<ChallengeView | null> {
    return this.transport.view<ChallengeView | null>(this.contractId, "get_challenge", { challenge_id: challengeId });
  }

  getChallengeForEvaluation(commitmentId: CommitmentId, evaluationId: EvaluationId): Promise<ChallengeView | null> {
    return this.transport.view<ChallengeView | null>(this.contractId, "get_challenge_for_evaluation", {
      commitment_id: commitmentId,
      evaluation_id: evaluationId,
    });
  }

  getCurrentEpoch(id: CommitmentId): Promise<DecimalString | null> {
    return this.transport.view<DecimalString | null>(this.contractId, "get_current_epoch", { commitment_id: id });
  }

  canClaimTranche(id: CommitmentId): Promise<ClaimEligibilityView | null> {
    return this.transport.view<ClaimEligibilityView | null>(this.contractId, "can_claim_tranche", { commitment_id: id });
  }

  getEscrowStatus(id: CommitmentId): Promise<EscrowStatusView | null> {
    return this.transport.view<EscrowStatusView | null>(this.contractId, "get_escrow_status", { commitment_id: id });
  }

  getTranche(id: CommitmentId, epoch: DecimalString): Promise<TrancheView | null> {
    return this.transport.view<TrancheView | null>(this.contractId, "get_tranche", { commitment_id: id, epoch });
  }

  createCommitment(args: CreateCommitmentArgs, options: ContractCallOptions): Promise<CommitmentId> {
    return this.transport.call<CommitmentId>(this.contractId, "create_commitment", { args }, options);
  }

  fundCommitment(id: CommitmentId, amountYocto: YoctoNear, options: Omit<ContractCallOptions, "attachedDepositYocto"> = {}): Promise<void> {
    return this.transport.call<void>(
      this.contractId,
      "fund_commitment",
      { commitment_id: id },
      { ...options, attachedDepositYocto: amountYocto },
    );
  }

  fundOperations(id: CommitmentId, amountYocto: YoctoNear, options: Omit<ContractCallOptions, "attachedDepositYocto"> = {}): Promise<void> {
    return this.transport.call<void>(
      this.contractId,
      "fund_operations",
      { commitment_id: id },
      { ...options, attachedDepositYocto: amountYocto },
    );
  }

  activateCommitment(id: CommitmentId, options: ContractCallOptions): Promise<void> {
    return this.transport.call<void>(this.contractId, "activate_commitment", { commitment_id: id }, options);
  }

  requestEvaluation(
    id: CommitmentId,
    evidence: SignedHeartbeatEvidence,
    options: ContractCallOptions,
  ): Promise<EvaluationId> {
    return this.transport.call<EvaluationId>(
      this.contractId,
      "request_evaluation",
      { commitment_id: id, evidence },
      options,
    );
  }

  expireEvaluation(id: CommitmentId, evaluationId: EvaluationId): Promise<void> {
    return this.transport.call<void>(this.contractId, "expire_evaluation", {
      commitment_id: id,
      evaluation_id: evaluationId,
    });
  }

  challengeEvaluation(
    id: CommitmentId,
    evaluationId: EvaluationId,
    reason: string,
    options: ContractCallOptions,
  ): Promise<ChallengeId> {
    return this.transport.call<ChallengeId>(
      this.contractId,
      "challenge_evaluation",
      { commitment_id: id, evaluation_id: evaluationId, reason },
      options,
    );
  }

  resolveChallenge(challengeId: ChallengeId, uphold: boolean): Promise<void> {
    return this.transport.call<void>(this.contractId, "resolve_challenge", { challenge_id: challengeId, uphold });
  }

  expireChallenge(challengeId: ChallengeId): Promise<void> {
    return this.transport.call<void>(this.contractId, "expire_challenge", { challenge_id: challengeId });
  }

  claimTranche(id: CommitmentId, options: ContractCallOptions): Promise<TransferId> {
    return this.transport.call<TransferId>(this.contractId, "claim_tranche", { commitment_id: id }, options);
  }

  closeCommitment(id: CommitmentId): Promise<void> {
    return this.transport.call<void>(this.contractId, "close_commitment", { commitment_id: id });
  }

  refundRemaining(id: CommitmentId, options: ContractCallOptions): Promise<TransferId> {
    return this.transport.call<TransferId>(this.contractId, "refund_remaining", { commitment_id: id }, options);
  }
}

export async function createSignedHeartbeat(
  input: HeartbeatSigningInput,
  signer: HeartbeatSigner,
): Promise<LegacySignedHeartbeatEvidence> {
  const payload = buildHeartbeatSigningPayload(input);
  assertLowerHex(signer.publicKeyHex, 32, "signer public key");
  if (!input.pinned_public_key_hex || signer.publicKeyHex !== input.pinned_public_key_hex) {
    throw new Error("Signer key does not match the policy-pinned maintainer key.");
  }
  const signature = await signer.sign(new TextEncoder().encode(payload));
  assertLowerHex(signature, 64, "signature");

  return {
    type: "signed_maintenance_heartbeat",
    artifact_hash: input.artifact_hash,
    maintainer_public_key: signer.publicKeyHex,
    signature,
    payload,
  };
}

/** Build the exact compact JSON bytes a maintainer must sign for a v1 heartbeat. */
export function buildHeartbeatSigningPayload(input: HeartbeatSigningInput): string {
  assertCanonicalDecimal(input.commitment_id, "commitment_id");
  assertCanonicalDecimal(input.evaluation_id, "evaluation_id");
  assertCanonicalDecimal(input.observed_at_ns, "observed_at_ns");
  assertLowerHex(input.policy_hash, 32, "policy_hash");
  assertLowerHex(input.artifact_hash, 32, "artifact_hash");
  if (input.pinned_public_key_hex !== undefined) {
    assertLowerHex(input.pinned_public_key_hex, 32, "pinned_public_key_hex");
  }
  if (!Number.isInteger(input.policy_version) || input.policy_version <= 0 || input.policy_version > 0xffff_ffff) {
    throw new Error("policy_version must be a positive u32 integer.");
  }
  if (!input.subject.trim() || input.subject.length > 128 || !isPrintableAscii(input.subject)) {
    throw new Error("subject must be non-empty printable ASCII no longer than 128 bytes.");
  }

  const payload = JSON.stringify({
    schema: "lcp.heartbeat.v1",
    commitment_id: input.commitment_id,
    evaluation_id: input.evaluation_id,
    policy_version: input.policy_version,
    policy_hash: input.policy_hash,
    observed_at_ns: input.observed_at_ns,
    subject: input.subject,
    artifact_hash: input.artifact_hash,
  });
  return payload;
}

/** Build the v2 envelope returned by a NEP-413 compatible NEAR wallet. */
export async function createNep413HeartbeatEvidence(
  input: HeartbeatSigningInput,
  signedMessage: NearSignedMessage,
  expectedAccountId: string,
  expectedPublicKeyFingerprintHex: Sha256Hex,
  nonceHex: string,
  recipient: string,
  callbackUrl: string,
): Promise<Nep413SignedHeartbeatEvidence> {
  if (!expectedAccountId || signedMessage.accountId !== expectedAccountId) {
    throw new Error("The wallet signature came from a different account than the commitment maintainer.");
  }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(signedMessage.publicKey)) {
    throw new Error("The connected wallet returned an unsupported NEAR public key type.");
  }
  validateBase58Ed25519Key(signedMessage.publicKey);
  assertLowerHex(expectedPublicKeyFingerprintHex, 32, "pinned maintainer key fingerprint");
  if (await sha256Hex(signedMessage.publicKey) !== expectedPublicKeyFingerprintHex) {
    throw new Error("The connected wallet key does not match the key pinned by this commitment.");
  }
  assertLowerHex(nonceHex, 32, "NEP-413 nonce");
  if (!recipient.trim() || recipient.length > 64) {
    throw new Error("The NEP-413 recipient must be this commitment contract account.");
  }
  if (!callbackUrl || new TextEncoder().encode(callbackUrl).length > 2_048) {
    throw new Error("The NEP-413 callback URL must be non-empty and at most 2048 bytes.");
  }
  if (!/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(signedMessage.signature)) {
    throw new Error("The wallet returned a malformed NEP-413 signature.");
  }
  const payload = buildHeartbeatSigningPayload(input);
  return {
    type: "signed_maintenance_heartbeat",
    artifact_hash: input.artifact_hash,
    maintainer_public_key: signedMessage.publicKey as NearEd25519PublicKey,
    signature: signedMessage.signature,
    payload,
    signature_scheme: "near_nep413",
    nonce_hex: nonceHex,
    recipient,
    callback_url: callbackUrl,
  };
}

export async function nearPublicKeyFingerprintHex(publicKey: NearEd25519PublicKey | string): Promise<Sha256Hex> {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(publicKey)) {
    throw new Error("Expected an ed25519 NEAR public key.");
  }
  validateBase58Ed25519Key(publicKey);
  return sha256Hex(publicKey);
}

function validateBase58Ed25519Key(publicKey: string): void {
  const encoded = publicKey.slice("ed25519:".length);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const character of encoded) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("The wallet returned a malformed base58 NEAR public key.");
    value = value * 58n + BigInt(digit);
  }
  let byteCount = 0;
  for (let rest = value; rest > 0n; rest >>= 8n) byteCount += 1;
  const leadingZeroBytes = encoded.match(/^1*/)?.[0].length ?? 0;
  if (byteCount + leadingZeroBytes !== 32) {
    throw new Error("The wallet returned a NEAR Ed25519 public key with an invalid byte length.");
  }
}

export async function sha256Hex(value: string | Uint8Array): Promise<Sha256Hex> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const EVENT_PREFIX = "EVENT_JSON:";

export function parseLcpEvents(logs: readonly string[]): LcpEvent[] {
  const events: LcpEvent[] = [];
  for (const log of logs) {
    if (!log.startsWith(EVENT_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(log.slice(EVENT_PREFIX.length));
      if (!isLcpEvent(parsed)) continue;
      events.push(parsed);
    } catch {
      // Ignore malformed or unrelated logs so callers can parse mixed transaction output.
    }
  }
  return events;
}

function isLcpEvent(value: unknown): value is LcpEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.standard === "lcp"
    && typeof candidate.version === "string"
    && typeof candidate.event === "string"
    && Array.isArray(candidate.data)
    && candidate.data.every((item) => typeof item === "object" && item !== null && !Array.isArray(item));
}

function assertCanonicalDecimal(value: string, name: string): void {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a canonical unsigned decimal string.`);
  }
  if (BigInt(value) > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${name} must fit in an unsigned 64-bit integer.`);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "unknown RPC error";
  }
}

function assertLowerHex(value: string, byteLength: number, name: string): void {
  if (value.length !== byteLength * 2 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error(`${name} must be ${byteLength * 2} lowercase hexadecimal characters.`);
  }
}

function isPrintableAscii(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0)!;
    return code >= 0x20 && code <= 0x7e;
  });
}
