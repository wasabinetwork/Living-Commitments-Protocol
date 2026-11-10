import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";

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
export type Verdict = "Compliant" | "NonCompliant" | "Inconclusive";
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

export interface ServiceAvailabilitySourceInput {
  source_id: string;
  operator_id: string;
  public_key_hex: Ed25519PublicKeyHex;
}

export interface ServiceAvailabilityPolicyInput {
  schema: "lcp.service_availability.policy.v1";
  target_id: Sha256Hex;
  max_source_lag_ns: Nanoseconds;
  expected_status_min: number;
  expected_status_max: number;
  max_latency_ms: number;
  minimum_agreeing_sources: number;
  minimum_corroboration_bps: number;
  sources: ServiceAvailabilitySourceInput[];
}

/** Validate the canonical v1 source-policy shape before it is sent to a wallet or contract. */
export function validateServiceAvailabilityPolicyInput(value: unknown): asserts value is ServiceAvailabilityPolicyInput {
  if (!isRecord(value)) throw new Error("Service source policy must be a JSON object.");
  const expectedKeys = [
    "schema", "target_id", "max_source_lag_ns", "expected_status_min", "expected_status_max",
    "max_latency_ms", "minimum_agreeing_sources", "minimum_corroboration_bps", "sources",
  ].sort();
  if (Object.keys(value).sort().join(",") !== expectedKeys.join(",")) {
    throw new Error("Service source policy must contain only the documented v1 fields.");
  }
  const policy = value as unknown as ServiceAvailabilityPolicyInput;
  if (policy.schema !== "lcp.service_availability.policy.v1"
      || !/^[0-9a-f]{64}$/.test(policy.target_id)
      || typeof policy.max_source_lag_ns !== "string"
      || !/^[1-9][0-9]*$/.test(policy.max_source_lag_ns)
      || policy.max_source_lag_ns.length > 20
      || (policy.max_source_lag_ns.length === 20 && policy.max_source_lag_ns > "18446744073709551615")
      || !Number.isInteger(policy.expected_status_min)
      || !Number.isInteger(policy.expected_status_max)
      || policy.expected_status_min < 100
      || policy.expected_status_max > 599
      || policy.expected_status_min > policy.expected_status_max
      || !Number.isSafeInteger(policy.max_latency_ms)
      || policy.max_latency_ms < 1
      || policy.max_latency_ms > 0xffff_ffff
      || !Array.isArray(policy.sources)
      || policy.sources.length < 2
      || policy.sources.length > 8) {
    throw new Error("Service source policy fields, source-age limit, or roster size are invalid.");
  }
  if (!Number.isInteger(policy.minimum_agreeing_sources)
      || policy.minimum_agreeing_sources < 1
      || policy.minimum_agreeing_sources > policy.sources.length
      || policy.minimum_agreeing_sources * 2 <= policy.sources.length
      || !Number.isInteger(policy.minimum_corroboration_bps)
      || policy.minimum_corroboration_bps < 0
      || policy.minimum_corroboration_bps > 10_000) {
    throw new Error("Quorum must require a strict majority and corroboration between 0 and 10000 basis points.");
  }
  const sourceIds = new Set<string>();
  const operatorIds = new Set<string>();
  const publicKeys = new Set<string>();
  let previousSourceId = "";
  for (const source of policy.sources) {
    if (!isRecord(source)
        || Object.keys(source).sort().join(",") !== ["operator_id", "public_key_hex", "source_id"].join(",")) {
      throw new Error("Each source must contain only source_id, operator_id, and public_key_hex.");
    }
    if (typeof source.source_id !== "string"
        || typeof source.operator_id !== "string"
        || typeof source.public_key_hex !== "string"
        || !/^[a-z0-9._-]{1,64}$/.test(source.source_id)
        || !/^[a-z0-9._-]{1,64}$/.test(source.operator_id)
        || !/^[0-9a-f]{64}$/.test(source.public_key_hex)
        || source.source_id <= previousSourceId
        || sourceIds.has(source.source_id)
        || operatorIds.has(source.operator_id)
        || publicKeys.has(source.public_key_hex)) {
      throw new Error("Sources must be sorted and use unique source IDs, operators, and lowercase Ed25519 keys.");
    }
    previousSourceId = source.source_id;
    sourceIds.add(source.source_id);
    operatorIds.add(source.operator_id);
    publicKeys.add(source.public_key_hex);
  }
}

export type PolicyAmendmentStatus = "proposed" | "activated" | "expired" | "cancelled";

export interface ServicePolicyAmendmentView {
  schema: "lcp.service-policy-amendment.v1";
  amendment_id: string;
  commitment_id: CommitmentId;
  proposed_by: string;
  old_policy_hash: Sha256Hex;
  new_policy_hash: Sha256Hex;
  new_policy: ServiceAvailabilityPolicyInput;
  proposed_at_ns: Nanoseconds;
  effective_at_ns: Nanoseconds;
  activated_at_ns: Nanoseconds | null;
  expires_at_ns: Nanoseconds;
  required_approvers: string[];
  approved_by: string[];
  status: PolicyAmendmentStatus;
}

export interface BoundedPayoutAuthorityGrantView {
  schema: "lcp.bounded-payout-authority.v1";
  commitment_id: CommitmentId;
  grant_id: string;
  granting_account: string;
  adapter_account: string;
  resource_account: string;
  capability: "bounded_payout";
  per_action_limit_yocto: YoctoNear;
  cumulative_limit_yocto: YoctoNear;
  authorized_yocto: YoctoNear;
  expires_at_ns: Nanoseconds;
  last_action_nonce: DecimalString;
  last_authorized_epoch: DecimalString | null;
  revoked: boolean;
}

export interface BoundedPayoutAdapterPoolStatusView {
  lcp_contract_id: string;
  pool_manager: string;
  resource_account: string;
  available_yocto: YoctoNear;
  pending_yocto: YoctoNear;
  pending_action_nonce: DecimalString | null;
  pending_kind: "authorized_payout" | "manager_withdrawal" | null;
}

export interface CreateServiceAvailabilityCommitmentArgs extends CreateCommitmentArgs {
  service_availability: ServiceAvailabilityPolicyInput;
}

export interface ServiceAvailabilitySourceCountsView {
  configured: number;
  valid: number;
  up: number;
  down: number;
  abstained: number;
  required: number;
}

export interface ServiceAvailabilityEvaluationSummaryView {
  source_counts: ServiceAvailabilitySourceCountsView;
  corroboration_bps: number;
}

export interface SignedProbeReport {
  payload: {
    schema: "lcp.service_availability.report.v1";
    contract_id: string;
    commitment_id: CommitmentId;
    evaluation_id: EvaluationId;
    policy_version: 3;
    policy_hash: Sha256Hex;
    source_policy_hash: Sha256Hex;
    source_id: string;
    operator_id: string;
    target_id: Sha256Hex;
    observed_at_ns: Nanoseconds;
    observation:
      | { kind: "http_response"; status_code: number; latency_ms: number; tls_verified: boolean }
      | { kind: "timeout"; elapsed_ms: number }
      | { kind: "tls_error" }
      | { kind: "source_error"; code: string };
  };
  signature_hex: Ed25519SignatureHex;
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

export interface ReviewerSignedMessage {
  account_id: string;
  public_key: string;
  signature: string;
  nonce_hex: string;
  recipient: string;
  callback_url: string;
}

export type ReviewerWalletMessageSigner = (input: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl: string;
}) => Promise<NearSignedMessage>;

export interface ReviewerDownloadEnvelope {
  ciphertext: Uint8Array;
  grant_id: string;
  request_id: string;
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  evidence_digest: Sha256Hex;
  ciphertext_sha256: Sha256Hex;
  hpke_enc_b64: string;
  wrapped_key_b64: string;
  content_iv_b64: string;
}

export interface ReviewerKeyVault {
  schema: "lcp.reviewer-key-vault.v1";
  public_key_b64: string;
  fingerprint_hex: Sha256Hex;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt_b64: string;
  iv_b64: string;
  encrypted_private_key_b64: string;
}

export interface PrivateArtifactEncryptionInput {
  request_id: string;
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  evidence_digest: Sha256Hex;
  digest_salt_b64: string;
  file_name: string;
  media_type: string;
  file_bytes: Uint8Array;
  reviewer_public_key_b64: string;
}

export interface EncryptedPrivateArtifact {
  ciphertext_b64: string;
  ciphertext_sha256: Sha256Hex;
  ciphertext_bytes: number;
  hpke_enc_b64: string;
  wrapped_key_b64: string;
  content_iv_b64: string;
}

export interface DecryptedPrivateArtifact {
  file_name: string;
  media_type: string;
  file_bytes: Uint8Array;
  evidence_digest: Sha256Hex;
  digest_verified: boolean;
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
  service_availability?: ServiceAvailabilityEvaluationSummaryView;
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

  getServiceAvailabilityPolicy(id: CommitmentId): Promise<ServiceAvailabilityPolicyInput | null> {
    return this.transport.view<ServiceAvailabilityPolicyInput | null>(
      this.contractId,
      "get_service_availability_policy",
      { commitment_id: id },
    );
  }

  getLatestServicePolicyAmendment(id: CommitmentId): Promise<ServicePolicyAmendmentView | null> {
    return this.transport.view<ServicePolicyAmendmentView | null>(
      this.contractId,
      "get_latest_service_policy_amendment",
      { commitment_id: id },
    );
  }

  getBoundedPayoutAuthorityGrant(id: CommitmentId, grantId: string): Promise<BoundedPayoutAuthorityGrantView | null> {
    return this.transport.view<BoundedPayoutAuthorityGrantView | null>(
      this.contractId,
      "get_bounded_payout_authority_grant",
      { commitment_id: id, grant_id: grantId },
    );
  }

  getLatestBoundedPayoutAuthorityGrant(id: CommitmentId): Promise<BoundedPayoutAuthorityGrantView | null> {
    return this.transport.view<BoundedPayoutAuthorityGrantView | null>(
      this.contractId,
      "get_latest_bounded_payout_authority_grant",
      { commitment_id: id },
    );
  }

  getBoundedPayoutAdapterPoolStatus(adapterAccount: string): Promise<BoundedPayoutAdapterPoolStatusView | null> {
    return this.transport.view<BoundedPayoutAdapterPoolStatusView | null>(adapterAccount, "get_pool_status", {});
  }

  withdrawBoundedPayoutAdapterPool(adapterAccount: string, recipient: string, amountYocto: YoctoNear): Promise<void> {
    return this.transport.call<void>(adapterAccount, "withdraw_pool", {
      recipient,
      amount_yocto: amountYocto,
    }, { gas: "100000000000000" });
  }

  getServicePolicyAmendment(id: CommitmentId, amendmentId: string): Promise<ServicePolicyAmendmentView | null> {
    return this.transport.view<ServicePolicyAmendmentView | null>(
      this.contractId,
      "get_service_policy_amendment",
      { commitment_id: id, amendment_id: amendmentId },
    );
  }

  proposeServicePolicyAmendment(
    id: CommitmentId,
    newPolicy: ServiceAvailabilityPolicyInput,
    effectiveAtNs: Nanoseconds,
    expiresAtNs: Nanoseconds,
    nonceHex: string,
    options: ContractCallOptions,
  ): Promise<string> {
    return this.transport.call<string>(this.contractId, "propose_service_policy_amendment", {
      commitment_id: id,
      new_policy: newPolicy,
      effective_at_ns: effectiveAtNs,
      expires_at_ns: expiresAtNs,
      proposal_nonce_hex: nonceHex,
    }, options);
  }

  approveServicePolicyAmendment(
    id: CommitmentId,
    amendmentId: string,
    options: ContractCallOptions,
  ): Promise<boolean> {
    return this.transport.call<boolean>(this.contractId, "approve_service_policy_amendment", {
      commitment_id: id,
      amendment_id: amendmentId,
    }, options);
  }

  activateServicePolicyAmendment(
    id: CommitmentId,
    amendmentId: string,
    options: ContractCallOptions,
  ): Promise<void> {
    return this.transport.call<void>(this.contractId, "activate_service_policy_amendment", {
      commitment_id: id,
      amendment_id: amendmentId,
    }, options);
  }

  expireServicePolicyAmendment(id: CommitmentId, amendmentId: string): Promise<void> {
    return this.transport.call<void>(this.contractId, "expire_service_policy_amendment", {
      commitment_id: id,
      amendment_id: amendmentId,
    });
  }

  cancelServicePolicyAmendment(id: CommitmentId, amendmentId: string): Promise<void> {
    return this.transport.call<void>(this.contractId, "cancel_service_policy_amendment", {
      commitment_id: id,
      amendment_id: amendmentId,
    });
  }

  createBoundedPayoutAuthorityGrant(
    id: CommitmentId,
    grantId: string,
    adapterAccount: string,
    resourceAccount: string,
    perActionLimitYocto: YoctoNear,
    cumulativeLimitYocto: YoctoNear,
    expiresAtNs: Nanoseconds,
    options: ContractCallOptions,
  ): Promise<string> {
    return this.transport.call<string>(this.contractId, "create_bounded_payout_authority_grant", {
      commitment_id: id,
      grant_id: grantId,
      adapter_account: adapterAccount,
      resource_account: resourceAccount,
      per_action_limit_yocto: perActionLimitYocto,
      cumulative_limit_yocto: cumulativeLimitYocto,
      expires_at_ns: expiresAtNs,
    }, options);
  }

  revokeAuthorityGrant(id: CommitmentId, grantId: string): Promise<void> {
    return this.transport.call<void>(this.contractId, "revoke_authority_grant", {
      commitment_id: id,
      grant_id: grantId,
    });
  }

  executeAuthorityGrant(
    id: CommitmentId,
    grantId: string,
    actionNonce: DecimalString,
    amountYocto: YoctoNear,
  ): Promise<void> {
    return this.transport.call<void>(this.contractId, "execute_authority_grant", {
      commitment_id: id,
      grant_id: grantId,
      action_nonce: actionNonce,
      amount_yocto: amountYocto,
    }, { gas: "100000000000000" });
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

  createServiceAvailabilityCommitment(
    args: CreateServiceAvailabilityCommitmentArgs,
    options: ContractCallOptions,
  ): Promise<CommitmentId> {
    return this.transport.call<CommitmentId>(
      this.contractId,
      "create_service_availability_commitment",
      { args },
      options,
    );
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

  requestServiceEvaluation(
    id: CommitmentId,
    reports: SignedProbeReport[],
    options: ContractCallOptions,
  ): Promise<EvaluationId> {
    return this.transport.call<EvaluationId>(
      this.contractId,
      "request_service_evaluation",
      { commitment_id: id, reports },
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

/** Add a random NEP-413 nonce, canonicalize the payload, and ask the connected NEAR wallet to sign it. */
export async function signReviewerPayload<T extends Record<string, unknown>>(
  payload: T,
  options: { recipient: string; callbackUrl: string; signMessage: ReviewerWalletMessageSigner },
): Promise<{ payload: T & { nonce_hex: string }; signed_message: ReviewerSignedMessage }> {
  if (Object.hasOwn(payload, "nonce_hex")) throw new Error("Do not supply a nonce; the SDK creates a fresh one for each signed action.");
  if (!options.recipient.trim() || options.recipient.length > 128) throw new Error("The reviewer service recipient is invalid.");
  if (!options.callbackUrl || new TextEncoder().encode(options.callbackUrl).byteLength > 2_048) throw new Error("The wallet callback URL is invalid.");
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const nonceHex = Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const signedPayload = { ...payload, nonce_hex: nonceHex };
  const signed = await options.signMessage({
    message: canonicalJson(signedPayload),
    nonce,
    recipient: options.recipient,
    callbackUrl: options.callbackUrl,
  });
  if (!signed.accountId || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(signed.publicKey)
      || !/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(signed.signature)) {
    throw new Error("The connected NEAR wallet returned an unsupported NEP-413 signature.");
  }
  validateBase58Ed25519Key(signed.publicKey);
  return {
    payload: signedPayload,
    signed_message: {
      account_id: signed.accountId,
      public_key: signed.publicKey,
      signature: signed.signature,
      nonce_hex: nonceHex,
      recipient: options.recipient,
      callback_url: options.callbackUrl,
    },
  };
}

/** Browser API wrapper for the separate reviewer-access Worker. */
export class ReviewerAccessClient {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly baseUrl: string, fetchImplementation: typeof fetch = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Reviewer access must use HTTPS outside localhost.");
    this.baseUrl = parsed.origin.replace(/\/$/, "");
    this.fetchImplementation = fetchImplementation.bind(globalThis);
  }

  createRequest(request: Record<string, unknown>, signed: ReviewerSignedMessage): Promise<Record<string, unknown>> {
    return this.postJson("/v1/requests", { request, signed_message: signed });
  }

  listRequests(payload: Record<string, unknown>, signed: ReviewerSignedMessage): Promise<{ requests: Record<string, unknown>[] }> {
    return this.postJson("/v1/requests/list", { payload, signed_message: signed });
  }

  rejectRequest(requestId: string, payload: Record<string, unknown>, signed: ReviewerSignedMessage): Promise<Record<string, unknown>> {
    return this.postJson(`/v1/requests/${encodeURIComponent(requestId)}/reject`, { payload, signed_message: signed });
  }

  createGrant(grant: Record<string, unknown>, ciphertextBase64: string, signed: ReviewerSignedMessage): Promise<Record<string, unknown>> {
    return this.postJson("/v1/grants", { grant, ciphertext_b64: ciphertextBase64, signed_message: signed });
  }

  listGrants(payload: Record<string, unknown>, signed: ReviewerSignedMessage): Promise<{ grants: Record<string, unknown>[] }> {
    return this.postJson("/v1/grants/list", { payload, signed_message: signed });
  }

  async downloadGrant(grantId: string, payload: Record<string, unknown>, signed: ReviewerSignedMessage): Promise<ReviewerDownloadEnvelope> {
    const response = await this.fetchImplementation(`${this.baseUrl}/v1/grants/${encodeURIComponent(grantId)}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, signed_message: signed }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await responseFailure(response));
    const header = (name: string): string => {
      const value = response.headers.get(name);
      if (!value) throw new Error(`Reviewer service response is missing ${name}.`);
      return value;
    };
    return {
      ciphertext: new Uint8Array(await response.arrayBuffer()),
      grant_id: header("X-LCP-Grant-Id"),
      request_id: header("X-LCP-Request-Id"),
      commitment_id: header("X-LCP-Commitment-Id"),
      evaluation_id: header("X-LCP-Evaluation-Id"),
      evidence_digest: header("X-LCP-Evidence-Digest"),
      ciphertext_sha256: header("X-LCP-Ciphertext-SHA256"),
      hpke_enc_b64: header("X-LCP-HPKE-Enc"),
      wrapped_key_b64: header("X-LCP-Wrapped-Key"),
      content_iv_b64: header("X-LCP-Content-IV"),
    };
  }

  revokeGrant(grantId: string, payload: Record<string, unknown>, signed: ReviewerSignedMessage): Promise<Record<string, unknown>> {
    return this.postJson(`/v1/grants/${encodeURIComponent(grantId)}/revoke`, { payload, signed_message: signed });
  }

  private async postJson<T extends Record<string, unknown>>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await responseFailure(response));
    return await response.json() as T;
  }
}

async function responseFailure(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Use a generic error for non-JSON worker failures.
  }
  return `Reviewer access request failed with HTTP ${response.status}.`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Signed JSON payload cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("Signed JSON payload contains an unsupported value.");
}

const REVIEWER_KEY_VAULT_ITERATIONS = 310_000;
const PRIVATE_ARTIFACT_MAGIC = new TextEncoder().encode("LCPPA1\0");

/** Create a local-only encrypted backup for an X25519 reviewer key. The passphrase is never sent anywhere. */
export async function createReviewerKeyVault(passphrase: string): Promise<ReviewerKeyVault> {
  assertVaultPassphrase(passphrase);
  const suite = reviewerHpkeSuite();
  const pair = await suite.kem.generateKeyPair();
  const publicKey = new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey));
  const privateKey = new Uint8Array(await suite.kem.serializePrivateKey(pair.privateKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveVaultWrappingKey(passphrase, salt, REVIEWER_KEY_VAULT_ITERATIONS);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: Uint8Array.from(iv).buffer, additionalData: new TextEncoder().encode("lcp.reviewer-key-vault.v1") },
    wrappingKey,
    Uint8Array.from(privateKey).buffer,
  );
  privateKey.fill(0);
  return {
    schema: "lcp.reviewer-key-vault.v1",
    public_key_b64: encodeBase64(publicKey),
    fingerprint_hex: await sha256Hex(publicKey),
    kdf: "PBKDF2-SHA256",
    iterations: REVIEWER_KEY_VAULT_ITERATIONS,
    salt_b64: encodeBase64(salt),
    iv_b64: encodeBase64(iv),
    encrypted_private_key_b64: encodeBase64(new Uint8Array(encrypted)),
  };
}

/** Unlock an encrypted reviewer-key backup in memory. Clear the returned bytes when finished. */
export async function unlockReviewerKeyVault(vault: ReviewerKeyVault, passphrase: string): Promise<Uint8Array> {
  assertVaultPassphrase(passphrase);
  if (vault.schema !== "lcp.reviewer-key-vault.v1" || vault.kdf !== "PBKDF2-SHA256"
      || !Number.isInteger(vault.iterations) || vault.iterations < 310_000 || vault.iterations > 2_000_000) {
    throw new Error("The reviewer key backup format or KDF settings are unsupported.");
  }
  const publicKey = decodeBase64(vault.public_key_b64, 32);
  if (await sha256Hex(publicKey) !== vault.fingerprint_hex) throw new Error("The reviewer key backup fingerprint is invalid.");
  const salt = decodeBase64(vault.salt_b64, 16);
  const iv = decodeBase64(vault.iv_b64, 12);
  const encryptedPrivateKey = decodeBase64(vault.encrypted_private_key_b64, 48);
  const wrappingKey = await deriveVaultWrappingKey(passphrase, salt, vault.iterations);
  let rawPrivateKey: ArrayBuffer;
  try {
    rawPrivateKey = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(iv).buffer, additionalData: new TextEncoder().encode("lcp.reviewer-key-vault.v1") },
      wrappingKey,
      Uint8Array.from(encryptedPrivateKey).buffer,
    );
  } catch {
    throw new Error("The passphrase could not unlock this reviewer key backup.");
  }
  const privateKey = new Uint8Array(rawPrivateKey);
  if (privateKey.byteLength !== 32) {
    privateKey.fill(0);
    throw new Error("The reviewer key backup contains an invalid private key.");
  }
  return privateKey;
}

/** Generate a salted commitment for a private file. Keep the salt with the local vault; it is packaged into the encrypted artifact for reviewers. */
export async function createPrivateEvidenceCommitment(fileBytes: Uint8Array): Promise<{ evidence_digest: Sha256Hex; digest_salt_b64: string }> {
  if (fileBytes.byteLength === 0) throw new Error("Choose a non-empty evidence file.");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return {
    evidence_digest: await sha256Hex(concatUint8Arrays(salt, fileBytes)),
    digest_salt_b64: encodeBase64(salt),
  };
}

/** Encrypt file bytes in the browser with AES-256-GCM and wrap the fresh content key to the reviewer's X25519 key using HPKE. */
export async function encryptPrivateArtifact(input: PrivateArtifactEncryptionInput): Promise<EncryptedPrivateArtifact> {
  assertCanonicalDecimal(input.commitment_id, "commitment_id");
  assertCanonicalDecimal(input.evaluation_id, "evaluation_id");
  assertLowerHex(input.evidence_digest, 32, "evidence_digest");
  if (!/^[0-9a-f-]{36}$/.test(input.request_id)) throw new Error("The reviewer request ID is invalid.");
  if (input.file_bytes.byteLength === 0 || input.file_bytes.byteLength > 8 * 1024 * 1024 - 16_384) {
    throw new Error("Private evidence must be between 1 byte and 8 MiB before encryption.");
  }
  if (input.file_name.length > 255 || /[\u0000-\u001f\u007f]/.test(input.file_name)) {
    throw new Error("The evidence filename is invalid or too long.");
  }
  const digestSalt = decodeBase64(input.digest_salt_b64, 32);
  if (await sha256Hex(concatUint8Arrays(digestSalt, input.file_bytes)) !== input.evidence_digest) {
    throw new Error("This file and local salt do not match the reviewer-requested evidence digest.");
  }
  const recipientBytes = decodeBase64(input.reviewer_public_key_b64, 32);
  const metadata = new TextEncoder().encode(JSON.stringify({
    schema: "lcp.private-evidence.v1",
    file_name: input.file_name,
    media_type: input.media_type.slice(0, 127) || "application/octet-stream",
    file_bytes: input.file_bytes.byteLength,
    evidence_digest: input.evidence_digest,
    digest_salt_b64: input.digest_salt_b64,
  }));
  if (metadata.byteLength > 2_048) throw new Error("Private evidence metadata exceeds its size limit.");
  const packageBytes = concatUint8Arrays(PRIVATE_ARTIFACT_MAGIC, u32le(metadata.byteLength), metadata, input.file_bytes);
  const aad = privateArtifactAad(input);
  const contentKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const contentKey = await crypto.subtle.importKey("raw", Uint8Array.from(contentKeyBytes).buffer, { name: "AES-GCM" }, false, ["encrypt"]);
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: Uint8Array.from(contentIv).buffer, additionalData: Uint8Array.from(aad).buffer },
    contentKey,
    Uint8Array.from(packageBytes).buffer,
  ));
  const suite = reviewerHpkeSuite();
  const recipientKey = await suite.kem.deserializePublicKey(recipientBytes);
  const wrapped = await suite.seal({ recipientPublicKey: recipientKey }, contentKeyBytes, aad);
  contentKeyBytes.fill(0);
  return {
    ciphertext_b64: encodeBase64(ciphertext),
    ciphertext_sha256: await sha256Hex(ciphertext),
    ciphertext_bytes: ciphertext.byteLength,
    hpke_enc_b64: encodeBase64(new Uint8Array(wrapped.enc)),
    wrapped_key_b64: encodeBase64(new Uint8Array(wrapped.ct)),
    content_iv_b64: encodeBase64(contentIv),
  };
}

/** Decrypt a downloaded artifact using an unlocked local key. The returned file bytes remain in browser memory. */
export async function decryptPrivateArtifact(input: {
  private_key: Uint8Array;
  ciphertext: Uint8Array;
  hpke_enc_b64: string;
  wrapped_key_b64: string;
  content_iv_b64: string;
  request_id: string;
  commitment_id: CommitmentId;
  evaluation_id: EvaluationId;
  evidence_digest: Sha256Hex;
}): Promise<DecryptedPrivateArtifact> {
  const context = {
    request_id: input.request_id,
    commitment_id: input.commitment_id,
    evaluation_id: input.evaluation_id,
    evidence_digest: input.evidence_digest,
  };
  const aad = privateArtifactAad(context);
  const suite = reviewerHpkeSuite();
  const recipientKey = await suite.kem.deserializePrivateKey(input.private_key);
  const contentKeyBytes = new Uint8Array(await suite.open({
    recipientKey,
    enc: decodeBase64(input.hpke_enc_b64, 32),
  }, decodeBase64(input.wrapped_key_b64, 48), aad));
  const contentKey = await crypto.subtle.importKey("raw", Uint8Array.from(contentKeyBytes).buffer, { name: "AES-GCM" }, false, ["decrypt"]);
  contentKeyBytes.fill(0);
  let packageBytes: Uint8Array;
  try {
    packageBytes = new Uint8Array(await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(decodeBase64(input.content_iv_b64, 12)).buffer,
        additionalData: Uint8Array.from(aad).buffer,
      },
      contentKey,
      Uint8Array.from(input.ciphertext).buffer,
    ));
  } catch {
    throw new Error("The downloaded evidence failed authenticated decryption.");
  }
  if (packageBytes.byteLength < PRIVATE_ARTIFACT_MAGIC.byteLength + 4
      || !PRIVATE_ARTIFACT_MAGIC.every((byte, index) => packageBytes[index] === byte)) {
    throw new Error("The decrypted evidence package has an unsupported format.");
  }
  const metadataLength = readU32le(packageBytes, PRIVATE_ARTIFACT_MAGIC.byteLength);
  const metadataStart = PRIVATE_ARTIFACT_MAGIC.byteLength + 4;
  const contentStart = metadataStart + metadataLength;
  if (metadataLength > 2_048 || contentStart > packageBytes.byteLength) throw new Error("The decrypted evidence metadata is malformed.");
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packageBytes.subarray(metadataStart, contentStart)));
  } catch {
    throw new Error("The decrypted evidence metadata is not valid UTF-8 JSON.");
  }
  if (!isRecord(metadata) || metadata.schema !== "lcp.private-evidence.v1"
      || typeof metadata.file_name !== "string" || typeof metadata.media_type !== "string"
      || typeof metadata.digest_salt_b64 !== "string" || metadata.evidence_digest !== input.evidence_digest) {
    throw new Error("The decrypted evidence metadata does not match the signed grant.");
  }
  const fileBytes = packageBytes.slice(contentStart);
  const digestSalt = decodeBase64(metadata.digest_salt_b64, 32);
  const digestVerified = await sha256Hex(concatUint8Arrays(digestSalt, fileBytes)) === input.evidence_digest;
  digestSalt.fill(0);
  packageBytes.fill(0);
  if (!digestVerified) throw new Error("The private file does not match its salted evidence commitment.");
  return {
    file_name: metadata.file_name,
    media_type: metadata.media_type,
    file_bytes: fileBytes,
    evidence_digest: input.evidence_digest,
    digest_verified: true,
  };
}

function reviewerHpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}

function privateArtifactAad(context: Pick<PrivateArtifactEncryptionInput, "request_id" | "commitment_id" | "evaluation_id" | "evidence_digest">): Uint8Array {
  return new TextEncoder().encode([
    "lcp.private-artifact.v1",
    context.request_id,
    context.commitment_id,
    context.evaluation_id,
    context.evidence_digest,
  ].join("\n"));
}

async function deriveVaultWrappingKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt).buffer, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function assertVaultPassphrase(passphrase: string): void {
  const bytes = new TextEncoder().encode(passphrase);
  if (bytes.byteLength < 12 || bytes.byteLength > 256) throw new Error("Use a reviewer-key passphrase between 12 and 256 UTF-8 bytes.");
}

function decodeBase64(value: string, expectedBytes?: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Malformed base64 data.");
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (encodeBase64(bytes) !== value || (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)) throw new Error("Base64 data is not canonical or has an invalid length.");
  return bytes;
}

function concatUint8Arrays(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function u32le(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error("Value is outside the little-endian u32 range.");
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24);
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

export function createRandomNonceHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
