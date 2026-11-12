use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(feature = "testnet-transfer-failure-fixture")]
use near_sdk::AccountId;
use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    env,
    json_types::{U128, U64},
    near, require,
    serde_json::{json, Value},
    store::LookupMap,
    BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

use crate::{
    effective_health,
    models::{
        encode_hex, BoundedPayoutAuthorityGrantView, BudgetPolicy, BudgetPolicyArgs, Challenge,
        ChallengeStatus, ChallengeView, ClaimEligibilityView, Commitment, CommitmentId,
        CommitmentPolicy, CommitmentPolicyArgs, CommitmentPolicyView, CommitmentSummaryView,
        CommitmentView, CreateCommitmentArgs, CreateServiceAvailabilityCommitmentArgs,
        EscrowStatusView, EvaluationInput, EvaluationRecord, EvaluationRecordView,
        EvaluationRequest, EvaluationStatus, EvaluationVerdictOutput, EvaluatorPolicy,
        EvaluatorPolicyArgs, EvidencePolicy, GoodObservation, HeartbeatPayload, PendingTransfer,
        PolicyAmendmentStatus, ServiceAvailabilityEvaluationInput,
        ServiceAvailabilityEvaluationSummary, ServiceAvailabilityPolicy,
        ServiceAvailabilitySourceCounts, ServicePolicyAmendmentView, ServiceReportInboxView,
        SignedHeartbeatEvidence, SignedProbeReport, Tranche, TrancheStatus, TrancheView,
        TransferKind, Verdict, EVALUATION_REQUEST_SCHEMA, EVALUATION_VERDICT_SCHEMA,
        HEARTBEAT_EVIDENCE_TYPE, HEARTBEAT_SCHEMA, SERVICE_AVAILABILITY_INBOX_REQUEST_SCHEMA,
        SERVICE_AVAILABILITY_REQUEST_SCHEMA, SERVICE_AVAILABILITY_VERDICT_SCHEMA,
    },
    temporal::{validate_temporal_policy, Health, Lifecycle, TemporalPolicy},
};

const MAX_SUBJECT_BYTES: usize = 128;
const MAX_WASM_URL_BYTES: usize = 512;
const MAX_BUILD_TARGET_BYTES: usize = 64;
const MAX_OUTLAYER_INSTRUCTIONS: u64 = 500_000_000_000;
const MAX_OUTLAYER_MEMORY_MB: u32 = 4_096;
const MAX_OUTLAYER_EXECUTION_SECONDS: u64 = 180;
const MAX_EVALUATIONS_PER_COMMITMENT: u64 = 64;
const MAX_COMMITMENTS_PAGE_SIZE: u32 = 20;
const MAX_CHALLENGES_PER_COMMITMENT: u32 = 64;
const MAX_PROGRAM_EPOCHS: u32 = 64;
const MAX_EVIDENCE_BYTES: usize = 4_096;
const MAX_CHALLENGE_REASON_BYTES: usize = 1_024;
const MAX_EVALUATOR_INPUT_BYTES: usize = 8_192;
const MAX_SERVICE_EVALUATOR_INPUT_BYTES: usize = 32_768;
const MAX_EVALUATOR_OUTPUT_BYTES: usize = 4_096;
const MAX_REASON_CODES: usize = 16;
const MAX_REASON_CODE_BYTES: usize = 64;
const OUTLAYER_REQUEST_GAS_TGAS: u64 = 100;
const CALLBACK_GAS_TGAS: u64 = 20;
const CHALLENGE_COMPLETION_STORAGE_PREFIX: &[u8] = b"lcp:challenge-completion:v1:";
const CHALLENGE_RESERVED_EPOCH_STORAGE_PREFIX: &[u8] = b"lcp:challenge-reserved-epoch:v1:";
const SERVICE_POLICY_STORAGE_PREFIX: &[u8] = b"lcp:service-policy:v3:";
const SERVICE_SUMMARY_STORAGE_PREFIX: &[u8] = b"lcp:service-summary:v3:";
const SERVICE_AMENDMENT_STORAGE_PREFIX: &[u8] = b"lcp:service-amendment:v1:";
const SERVICE_AMENDMENT_LATEST_PREFIX: &[u8] = b"lcp:service-amendment-latest:v1:";
const SERVICE_POLICY_HEALTH_START_PREFIX: &[u8] = b"lcp:service-policy-health-start:v1:";
const SERVICE_REPORT_INBOX_PREFIX: &[u8] = b"lcp:service-report-inbox:v1:";
const SERVICE_REPORT_REFUND_PREFIX: &[u8] = b"lcp:service-report-refund:v1:";
const AUTHORITY_GRANT_PREFIX: &[u8] = b"lcp:authority-grant:v1:";
const AUTHORITY_GRANT_LATEST_PREFIX: &[u8] = b"lcp:authority-grant-latest:v1:";
const MAX_AMENDMENT_LIFETIME_NS: u64 = 30 * 24 * 60 * 60 * 1_000_000_000;
const MAX_SERVICE_REPORT_BYTES: usize = 4_096;
const MAX_SERVICE_REPORT_INBOX_TTL_NS: u64 = 15 * 60 * 1_000_000_000;
const SERVICE_REPORT_REFUND_RESERVE_BYTES: u64 = 256;
const SERVICE_REPORT_STORAGE_OVERHEAD_BYTES: u64 = 256;
const AUTHORITY_ADAPTER_GAS_TGAS: u64 = 25;

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
struct AuthorityGrantState {
    granting_account: near_sdk::AccountId,
    adapter_account: near_sdk::AccountId,
    resource_account: near_sdk::AccountId,
    per_action_limit_yocto: u128,
    cumulative_limit_yocto: u128,
    authorized_yocto: u128,
    expires_at_ns: u64,
    last_action_nonce: u64,
    /// u64::MAX means that no action has been authorized yet.
    last_authorized_epoch: u64,
    revoked: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
struct ServiceReportInboxEntry {
    submitted_by: near_sdk::AccountId,
    submitted_at_ns: u64,
    expires_at_ns: u64,
    storage_deposit_yocto: u128,
    report_json: Vec<u8>,
}

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Commitments,
    Challenges,
    ChallengeByEvaluation,
    EvaluationRequests,
    EvaluationRecords,
    Tranches,
    PendingTransfers,
    #[cfg(feature = "testnet-transfer-failure-fixture")]
    TestTransferFailureRecipients,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    next_commitment_id: CommitmentId,
    next_challenge_id: u64,
    next_transfer_id: u64,
    commitments: LookupMap<CommitmentId, Commitment>,
    challenges: LookupMap<u64, Challenge>,
    challenge_by_evaluation: LookupMap<(CommitmentId, u64), u64>,
    evaluation_requests: LookupMap<(CommitmentId, u64), EvaluationRequest>,
    evaluation_records: LookupMap<(CommitmentId, u64), EvaluationRecord>,
    tranches: LookupMap<(CommitmentId, u32), Tranche>,
    pending_transfers: LookupMap<u64, PendingTransfer>,
    #[cfg(feature = "testnet-transfer-failure-fixture")]
    test_transfer_failure_recipients: LookupMap<CommitmentId, AccountId>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            next_commitment_id: 0,
            next_challenge_id: 0,
            next_transfer_id: 0,
            commitments: LookupMap::new(StorageKey::Commitments),
            challenges: LookupMap::new(StorageKey::Challenges),
            challenge_by_evaluation: LookupMap::new(StorageKey::ChallengeByEvaluation),
            evaluation_requests: LookupMap::new(StorageKey::EvaluationRequests),
            evaluation_records: LookupMap::new(StorageKey::EvaluationRecords),
            tranches: LookupMap::new(StorageKey::Tranches),
            pending_transfers: LookupMap::new(StorageKey::PendingTransfers),
            #[cfg(feature = "testnet-transfer-failure-fixture")]
            test_transfer_failure_recipients: LookupMap::new(
                StorageKey::TestTransferFailureRecipients,
            ),
        }
    }

    #[payable]
    pub fn create_commitment(&mut self, args: CreateCommitmentArgs) -> U64 {
        let policy = build_policy(args.policy);
        let policy_bytes = near_sdk::borsh::to_vec(&policy)
            .unwrap_or_else(|_| env::panic_str("failed to serialize commitment policy"));
        let policy_hash = env::sha256_array(&policy_bytes);
        self.insert_commitment(
            args.subject,
            args.maintainer,
            args.arbiter,
            policy,
            policy_hash,
            None,
        )
    }

    #[payable]
    pub fn create_service_availability_commitment(
        &mut self,
        args: CreateServiceAvailabilityCommitmentArgs,
    ) -> U64 {
        validate_service_availability_policy(&args.service_availability);
        require!(
            args.policy.evidence.signature_scheme.as_deref() == Some("near_nep413"),
            "service availability commitments require the near_nep413 maintainer policy"
        );
        let mut policy = build_policy(args.policy);
        require!(
            policy.version == 2,
            "service availability requires a NEP-413 policy"
        );
        policy.version = 3;
        require!(
            parse_decimal_u64(&args.service_availability.max_source_lag_ns)
                .is_some_and(|lag| lag <= policy.temporal.max_source_lag_ns
                    && lag <= policy.temporal.evidence_ttl_ns),
            "service source lag must fit the commitment temporal bounds"
        );
        let policy_hash = service_availability_policy_digest(&policy, &args.service_availability);
        self.insert_commitment(
            args.subject,
            args.maintainer,
            args.arbiter,
            policy,
            policy_hash,
            Some(args.service_availability),
        )
    }

    #[payable]
    pub fn propose_service_policy_amendment(
        &mut self,
        commitment_id: U64,
        new_policy: ServiceAvailabilityPolicy,
        effective_at_ns: U64,
        expires_at_ns: U64,
        proposal_nonce_hex: String,
    ) -> String {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        require!(
            commitment.policy.version == 3,
            "only v3 service policies can be amended"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot be amended"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "resolve the pending evaluation before proposing an amendment"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "resolve the active challenge before proposing an amendment"
        );
        validate_service_availability_policy(&new_policy);
        require!(
            parse_decimal_u64(&new_policy.max_source_lag_ns)
                .is_some_and(|lag| lag <= commitment.policy.temporal.max_source_lag_ns
                    && lag <= commitment.policy.temporal.evidence_ttl_ns),
            "source lag must fit the commitment temporal bounds"
        );
        require!(
            is_lower_hex_32(&proposal_nonce_hex),
            "amendment nonce must be 32-byte lowercase hexadecimal"
        );
        let effective_at = effective_at_ns.0;
        let expires_at = expires_at_ns.0;
        require!(
            effective_at > now_ns,
            "amendment activation must be in the future"
        );
        require!(
            expires_at > effective_at,
            "amendment expiry must follow its activation boundary"
        );
        require!(
            expires_at <= now_ns.saturating_add(MAX_AMENDMENT_LIFETIME_NS),
            "amendment expiry cannot be more than 30 days away"
        );

        let latest_id = read_latest_service_amendment_id(commitment_id.0);
        if let Some(previous_id) = latest_id {
            if let Some(previous) = read_service_amendment(commitment_id.0, &previous_id) {
                require!(
                    previous.status != PolicyAmendmentStatus::Proposed,
                    "resolve or expire the current policy amendment before proposing another"
                );
            }
        }
        let old_policy = read_service_policy(commitment_id.0)
            .unwrap_or_else(|| env::panic_str("service availability policy is missing"));
        let old_policy_hash = service_availability_policy_digest(&commitment.policy, &old_policy);
        require!(
            old_policy_hash == commitment.policy_hash,
            "active service policy digest does not match commitment state"
        );
        let new_policy_hash = service_availability_policy_digest(&commitment.policy, &new_policy);
        require!(
            new_policy_hash != old_policy_hash,
            "amendment must change the active policy digest"
        );

        let mut required_approvers = Vec::with_capacity(4);
        for account in [
            commitment.policy.budget.sponsor.clone(),
            commitment.maintainer.clone(),
            commitment.policy.budget.beneficiary.clone(),
            commitment.arbiter.clone(),
        ] {
            if !required_approvers.contains(&account) {
                required_approvers.push(account);
            }
        }
        require!(
            required_approvers.contains(&caller),
            "only an affected commitment party may propose an amendment"
        );

        let amendment = ServicePolicyAmendmentView {
            schema: "lcp.service-policy-amendment.v1".to_string(),
            amendment_id: proposal_nonce_hex.clone(),
            commitment_id,
            proposed_by: caller.clone(),
            old_policy_hash: encode_hex(&old_policy_hash),
            new_policy_hash: encode_hex(&new_policy_hash),
            new_policy,
            proposed_at_ns: U64(now_ns),
            effective_at_ns,
            activated_at_ns: None,
            expires_at_ns,
            required_approvers,
            approved_by: Vec::new(),
            status: PolicyAmendmentStatus::Proposed,
        };
        let storage_before = env::storage_usage();
        write_service_amendment(&amendment);
        write_latest_service_amendment_id(commitment_id.0, &proposal_nonce_hex);
        let required_storage_bond =
            storage_cost(env::storage_usage().saturating_sub(storage_before));
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for amendment storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller.clone(), attached, required_storage_bond);
        emit_event(
            "service_policy_amendment_proposed",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "amendment_id": proposal_nonce_hex,
                "proposed_by": caller,
                "old_policy_hash": encode_hex(&old_policy_hash),
                "new_policy_hash": encode_hex(&new_policy_hash),
                "effective_at_ns": effective_at.to_string(),
                "expires_at_ns": expires_at.to_string(),
                "required_approvers": amendment.required_approvers,
            }),
        );
        proposal_nonce_hex
    }

    #[payable]
    pub fn approve_service_policy_amendment(
        &mut self,
        commitment_id: U64,
        amendment_id: String,
    ) -> bool {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut amendment = read_service_amendment(commitment_id.0, &amendment_id)
            .unwrap_or_else(|| env::panic_str("service policy amendment not found"));
        require!(
            amendment.status == PolicyAmendmentStatus::Proposed,
            "amendment is no longer pending"
        );
        require!(
            now_ns < amendment.expires_at_ns.0,
            "amendment has expired; expire it before proposing another"
        );
        require!(
            amendment.required_approvers.contains(&caller),
            "caller is not an affected party named by this amendment"
        );
        require!(
            !amendment.approved_by.contains(&caller),
            "caller has already approved this amendment"
        );
        amendment.approved_by.push(caller.clone());

        let all_approved = amendment
            .required_approvers
            .iter()
            .all(|account| amendment.approved_by.contains(account));
        let activate = all_approved && now_ns >= amendment.effective_at_ns.0;
        let storage_before = env::storage_usage();
        if activate {
            require!(
                commitment.lifecycle != Lifecycle::Closed,
                "closed commitments cannot activate an amendment"
            );
            require!(
                commitment.pending_evaluation_id.is_none(),
                "resolve the pending evaluation before activating an amendment"
            );
            require!(
                commitment.active_challenge_id.is_none(),
                "resolve the active challenge before activating an amendment"
            );
            let expected_old_hash = decode_32_byte_hex(&amendment.old_policy_hash)
                .unwrap_or_else(|| env::panic_str("amendment policy digest is malformed"));
            require!(
                commitment.policy_hash == expected_old_hash,
                "amendment no longer matches the active policy"
            );
            amendment.status = PolicyAmendmentStatus::Activated;
            amendment.activated_at_ns = Some(U64(now_ns));
            commitment.policy_hash = decode_32_byte_hex(&amendment.new_policy_hash)
                .unwrap_or_else(|| env::panic_str("amendment policy digest is malformed"));
            commitment.last_good = None;
            write_service_policy(commitment_id.0, &amendment.new_policy);
            write_service_policy_health_start(commitment_id.0, now_ns);
        }
        write_service_amendment(&amendment);
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        let required_storage_bond =
            storage_cost(env::storage_usage().saturating_sub(storage_before));
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for amendment storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller.clone(), attached, required_storage_bond);
        emit_event(
            "service_policy_amendment_approved",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "amendment_id": amendment_id,
                "approver": caller,
                "approved_count": amendment.approved_by.len(),
                "required_count": amendment.required_approvers.len(),
            }),
        );
        if activate {
            emit_event(
                "service_policy_amendment_activated",
                json!({
                    "commitment_id": commitment_id.0.to_string(),
                    "amendment_id": amendment.amendment_id.clone(),
                    "old_policy_hash": amendment.old_policy_hash.clone(),
                    "new_policy_hash": amendment.new_policy_hash.clone(),
                    "effective_at_ns": amendment.effective_at_ns.0.to_string(),
                    "activated_at_ns": now_ns.to_string(),
                    "approved_by": amendment.approved_by.clone(),
                }),
            );
        }
        activate
    }

    #[payable]
    pub fn activate_service_policy_amendment(&mut self, commitment_id: U64, amendment_id: String) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let now_ns = env::block_timestamp();
        let mut amendment = read_service_amendment(commitment_id.0, &amendment_id)
            .unwrap_or_else(|| env::panic_str("service policy amendment not found"));
        require!(
            amendment.status == PolicyAmendmentStatus::Proposed,
            "amendment is no longer pending"
        );
        require!(
            now_ns >= amendment.effective_at_ns.0,
            "amendment effective boundary has not arrived"
        );
        require!(
            now_ns < amendment.expires_at_ns.0,
            "amendment has expired; expire it before proposing another"
        );
        require!(
            amendment
                .required_approvers
                .iter()
                .all(|account| amendment.approved_by.contains(account)),
            "all affected parties must approve before activation"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot activate an amendment"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "resolve the pending evaluation before activating an amendment"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "resolve the active challenge before activating an amendment"
        );
        let expected_old_hash = decode_32_byte_hex(&amendment.old_policy_hash)
            .unwrap_or_else(|| env::panic_str("amendment policy digest is malformed"));
        require!(
            commitment.policy_hash == expected_old_hash,
            "amendment no longer matches the active policy"
        );

        let caller = env::predecessor_account_id();
        if let Some(old_policy) = read_service_policy(commitment_id.0) {
            for source in &old_policy.sources {
                let inbox_key = service_report_inbox_storage_key(
                    commitment_id.0,
                    commitment.next_evaluation_id,
                    &source.source_id,
                );
                if let Some(staged) = read_service_report_inbox(&inbox_key) {
                    env::storage_remove(&inbox_key);
                    increase_service_report_refund_credit(
                        &staged.submitted_by,
                        staged.storage_deposit_yocto,
                    );
                }
            }
        }
        let storage_before = env::storage_usage();
        commitment.policy_hash = decode_32_byte_hex(&amendment.new_policy_hash)
            .unwrap_or_else(|| env::panic_str("amendment policy digest is malformed"));
        amendment.status = PolicyAmendmentStatus::Activated;
        amendment.activated_at_ns = Some(U64(now_ns));
        commitment.last_good = None;
        write_service_policy(commitment_id.0, &amendment.new_policy);
        write_service_policy_health_start(commitment_id.0, now_ns);
        write_service_amendment(&amendment);
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        let required_storage_bond =
            storage_cost(env::storage_usage().saturating_sub(storage_before));
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for amendment storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);
        emit_event(
            "service_policy_amendment_activated",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "amendment_id": amendment.amendment_id,
                "old_policy_hash": amendment.old_policy_hash,
                "new_policy_hash": amendment.new_policy_hash,
                "effective_at_ns": amendment.effective_at_ns.0.to_string(),
                "activated_at_ns": now_ns.to_string(),
                "approved_by": amendment.approved_by,
            }),
        );
    }

    pub fn expire_service_policy_amendment(&mut self, commitment_id: U64, amendment_id: String) {
        let mut amendment = read_service_amendment(commitment_id.0, &amendment_id)
            .unwrap_or_else(|| env::panic_str("service policy amendment not found"));
        require!(
            amendment.status == PolicyAmendmentStatus::Proposed,
            "amendment is no longer pending"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns >= amendment.expires_at_ns.0,
            "amendment has not expired"
        );
        amendment.status = PolicyAmendmentStatus::Expired;
        write_service_amendment(&amendment);
        emit_event(
            "service_policy_amendment_expired",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "amendment_id": amendment_id,
                "old_policy_hash": amendment.old_policy_hash,
                "new_policy_hash": amendment.new_policy_hash,
                "expired_at_ns": now_ns.to_string(),
                "approved_by": amendment.approved_by,
            }),
        );
    }

    pub fn cancel_service_policy_amendment(&mut self, commitment_id: U64, amendment_id: String) {
        let mut amendment = read_service_amendment(commitment_id.0, &amendment_id)
            .unwrap_or_else(|| env::panic_str("service policy amendment not found"));
        require!(
            amendment.status == PolicyAmendmentStatus::Proposed,
            "amendment is no longer pending"
        );
        let caller = env::predecessor_account_id();
        require!(
            caller == amendment.proposed_by,
            "only the proposer may cancel this amendment"
        );
        amendment.status = PolicyAmendmentStatus::Cancelled;
        write_service_amendment(&amendment);
        emit_event(
            "service_policy_amendment_cancelled",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "amendment_id": amendment_id,
                "proposed_by": caller,
                "cancelled_at_ns": env::block_timestamp().to_string(),
                "approved_by": amendment.approved_by,
            }),
        );
    }

    pub fn reject_service_policy_amendment(&mut self, commitment_id: U64, amendment_id: String) {
        let mut amendment = read_service_amendment(commitment_id.0, &amendment_id)
            .unwrap_or_else(|| env::panic_str("service policy amendment not found"));
        require!(
            amendment.status == PolicyAmendmentStatus::Proposed,
            "amendment is no longer pending"
        );
        let caller = env::predecessor_account_id();
        require!(
            amendment.required_approvers.contains(&caller),
            "only a required approver may reject this amendment"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns < amendment.expires_at_ns.0,
            "amendment has expired; record expiry instead"
        );
        amendment.status = PolicyAmendmentStatus::Rejected;
        write_service_amendment(&amendment);
        emit_event(
            "service_policy_amendment_rejected",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "amendment_id": amendment_id,
                "rejected_by": caller,
                "rejected_at_ns": now_ns.to_string(),
                "approved_by": amendment.approved_by,
            }),
        );
    }

    #[payable]
    pub fn create_bounded_payout_authority_grant(
        &mut self,
        commitment_id: U64,
        grant_id: String,
        adapter_account: near_sdk::AccountId,
        resource_account: near_sdk::AccountId,
        per_action_limit_yocto: U128,
        cumulative_limit_yocto: U128,
        expires_at_ns: U64,
    ) -> String {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot add authority grants"
        );
        require!(
            caller == commitment.policy.budget.sponsor
                || caller == commitment.policy.budget.beneficiary,
            "only the sponsor or beneficiary can grant bounded payout authority"
        );
        require!(
            is_lower_hex_32(&grant_id),
            "grant ID must be 32-byte lowercase hexadecimal"
        );
        require!(
            per_action_limit_yocto.0 > 0,
            "per-action payout limit must be positive"
        );
        require!(
            per_action_limit_yocto.0 <= commitment.policy.budget.tranche_yocto,
            "per-action limit cannot exceed the configured tranche"
        );
        let program_limit = commitment
            .policy
            .budget
            .tranche_yocto
            .checked_mul(u128::from(commitment.policy.budget.max_epochs))
            .unwrap_or_else(|| env::panic_str("commitment payout limit overflow"));
        require!(
            cumulative_limit_yocto.0 > 0 && cumulative_limit_yocto.0 <= program_limit,
            "cumulative limit must fit within the configured recurring budget"
        );
        let budget_horizon = commitment
            .policy
            .budget
            .epoch_ns
            .checked_mul(u64::from(commitment.policy.budget.max_epochs))
            .unwrap_or_else(|| env::panic_str("commitment budget horizon overflow"));
        let maximum_expiry = commitment
            .activated_at_ns
            .and_then(|activated_at| activated_at.checked_add(budget_horizon))
            .unwrap_or_else(|| env::panic_str("commitment budget horizon overflow"));
        require!(
            expires_at_ns.0 > now_ns && expires_at_ns.0 <= maximum_expiry,
            "grant expiry must fit the commitment budget horizon"
        );
        require!(
            adapter_account != env::current_account_id(),
            "the LCP contract cannot be its own authority adapter"
        );
        let storage_key = authority_grant_storage_key(commitment_id.0, &grant_id);
        require!(
            env::storage_read(&storage_key).is_none(),
            "authority grant ID has already been used"
        );
        let grant = AuthorityGrantState {
            granting_account: caller.clone(),
            adapter_account: adapter_account.clone(),
            resource_account: resource_account.clone(),
            per_action_limit_yocto: per_action_limit_yocto.0,
            cumulative_limit_yocto: cumulative_limit_yocto.0,
            authorized_yocto: 0,
            expires_at_ns: expires_at_ns.0,
            last_action_nonce: 0,
            last_authorized_epoch: u64::MAX,
            revoked: false,
        };
        let storage_before = env::storage_usage();
        write_authority_grant(commitment_id.0, &grant_id, &grant);
        write_latest_authority_grant_id(commitment_id.0, &grant_id);
        let required_storage_bond =
            storage_cost(env::storage_usage().saturating_sub(storage_before));
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!(
                "attach at least {required_storage_bond} yoctoNEAR for authority grant storage"
            )
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller.clone(), attached, required_storage_bond);
        emit_event(
            "bounded_payout_authority_granted",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "grant_id": grant_id.clone(),
                "granting_account": caller,
                "adapter_account": adapter_account,
                "resource_account": resource_account,
                "capability": "bounded_payout",
                "per_action_limit_yocto": per_action_limit_yocto.0.to_string(),
                "cumulative_limit_yocto": cumulative_limit_yocto.0.to_string(),
                "expires_at_ns": expires_at_ns.0.to_string(),
            }),
        );
        grant_id
    }

    pub fn revoke_authority_grant(&mut self, commitment_id: U64, grant_id: String) {
        let mut grant = read_authority_grant(commitment_id.0, &grant_id)
            .unwrap_or_else(|| env::panic_str("authority grant not found"));
        let caller = env::predecessor_account_id();
        require!(
            caller == grant.granting_account,
            "only the account that granted this authority can revoke it"
        );
        require!(!grant.revoked, "authority grant is already revoked");
        grant.revoked = true;
        write_authority_grant(commitment_id.0, &grant_id, &grant);
        emit_event(
            "bounded_payout_authority_revoked",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "grant_id": grant_id,
                "granting_account": caller,
                "revoked_at_ns": env::block_timestamp().to_string(),
            }),
        );
    }

    pub fn execute_authority_grant(
        &mut self,
        commitment_id: U64,
        grant_id: String,
        action_nonce: U64,
        amount_yocto: U128,
    ) -> Promise {
        let commitment = self.load_commitment(commitment_id.0);
        let mut grant = read_authority_grant(commitment_id.0, &grant_id)
            .unwrap_or_else(|| env::panic_str("authority grant not found"));
        let now_ns = env::block_timestamp();
        let caller = env::predecessor_account_id();
        require!(
            !grant.revoked && now_ns < grant.expires_at_ns,
            "authority grant is revoked or expired"
        );
        require!(
            caller == grant.granting_account || caller == grant.adapter_account,
            "only the grantor or named adapter can trigger this authority action"
        );
        let epoch = u64::from(self.claim_eligibility(&commitment, now_ns).unwrap_or_else(
            |reason| env::panic_str(&format!("authority action is not eligible: {reason}")),
        ));
        require!(
            grant.last_authorized_epoch != epoch,
            "this authority grant already acted during the current epoch"
        );
        require!(
            action_nonce.0 > grant.last_action_nonce,
            "action nonce must increase to prevent replay"
        );
        require!(
            amount_yocto.0 > 0 && amount_yocto.0 <= grant.per_action_limit_yocto,
            "action exceeds its per-action payout limit"
        );
        let authorized_total = grant
            .authorized_yocto
            .checked_add(amount_yocto.0)
            .unwrap_or_else(|| env::panic_str("authority payout accounting overflow"));
        require!(
            authorized_total <= grant.cumulative_limit_yocto,
            "action exceeds the grant's cumulative payout limit"
        );

        grant.authorized_yocto = authorized_total;
        grant.last_action_nonce = action_nonce.0;
        grant.last_authorized_epoch = epoch;
        write_authority_grant(commitment_id.0, &grant_id, &grant);
        emit_event(
            "bounded_payout_authority_action",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "grant_id": grant_id.clone(),
                "adapter_account": grant.adapter_account.clone(),
                "resource_account": grant.resource_account.clone(),
                "action_nonce": action_nonce.0.to_string(),
                "epoch": epoch.to_string(),
                "amount_yocto": amount_yocto.0.to_string(),
                "authorized_total_yocto": authorized_total.to_string(),
            }),
        );
        let adapter_args = near_sdk::serde_json::to_vec(&json!({
            "granting_account": grant.granting_account.clone(),
            "action_nonce": action_nonce,
            "resource_account": grant.resource_account.clone(),
            "amount_yocto": amount_yocto,
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize authority adapter request"));
        Promise::new(grant.adapter_account).function_call(
            "execute_authorized_action".to_string(),
            adapter_args,
            NearToken::from_yoctonear(0),
            Gas::from_tgas(AUTHORITY_ADAPTER_GAS_TGAS),
        )
    }

    #[payable]
    pub fn fund_commitment(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.policy.budget.sponsor,
            "only the configured sponsor may fund commitment escrow"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot be funded"
        );

        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a positive escrow deposit");
        commitment.escrow_funded_yocto = commitment
            .escrow_funded_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("escrow funding overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();

        emit_event(
            "commitment_funded",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "sponsor": caller,
                "amount_yocto": amount.to_string(),
            }),
        );
    }

    #[payable]
    pub fn fund_operations(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.policy.budget.sponsor,
            "only the configured sponsor may fund evaluator operations"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot receive operations funding"
        );

        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a positive operations deposit");
        commitment.operations_funded_yocto = commitment
            .operations_funded_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("operations funding overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();

        emit_event(
            "operations_funded",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "sponsor": caller,
                "amount_yocto": amount.to_string(),
            }),
        );
    }

    #[payable]
    pub fn activate_commitment(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.creator
                || caller == commitment.maintainer
                || caller == commitment.policy.budget.sponsor,
            "caller is not authorized to activate this commitment"
        );
        require!(
            commitment.lifecycle == Lifecycle::Draft,
            "only draft commitments can be activated"
        );

        let required_escrow = u128::from(commitment.policy.budget.max_epochs)
            .checked_mul(commitment.policy.budget.tranche_yocto)
            .unwrap_or_else(|| env::panic_str("required escrow calculation overflow"));
        let already_allocated = commitment
            .escrow_paid_yocto
            .checked_add(commitment.escrow_refunded_yocto)
            .and_then(|value| value.checked_add(commitment.escrow_pending_yocto))
            .unwrap_or_else(|| env::panic_str("escrow allocation overflow"));
        let escrow_available = commitment
            .escrow_funded_yocto
            .checked_sub(already_allocated)
            .unwrap_or_else(|| env::panic_str("escrow accounting invariant violated"));
        require!(
            escrow_available >= required_escrow,
            "commitment escrow is not fully funded"
        );

        let operations_available = commitment
            .operations_funded_yocto
            .checked_sub(commitment.operations_authorized_spend_yocto)
            .unwrap_or_else(|| env::panic_str("operations accounting invariant violated"));
        require!(
            operations_available >= commitment.policy.evaluator.execution_deposit_yocto,
            "fund at least one evaluator execution before activation"
        );

        let activated_at_ns = env::block_timestamp();
        let initial_deadline = activated_at_ns
            .checked_add(commitment.policy.temporal.initial_window_ns)
            .unwrap_or_else(|| env::panic_str("initial evidence deadline overflow"));
        initial_deadline
            .checked_add(commitment.policy.temporal.grace_ns)
            .unwrap_or_else(|| env::panic_str("initial breach deadline overflow"));

        commitment.lifecycle = Lifecycle::Active;
        commitment.activated_at_ns = Some(activated_at_ns);
        let storage_before = env::storage_usage();
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for activation storage")
        );
        let mut commitment = self.load_commitment(commitment_id.0);
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller.clone(), attached, required_storage_bond);

        emit_event(
            "commitment_activated",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "activated_at_ns": activated_at_ns.to_string(),
            }),
        );
    }

    #[payable]
    pub fn request_evaluation(
        &mut self,
        commitment_id: U64,
        evidence: SignedHeartbeatEvidence,
    ) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.maintainer || caller == commitment.policy.budget.sponsor,
            "only the commitment maintainer or sponsor may request evaluation"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active,
            "only active commitments can be evaluated"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "an evaluation is already pending"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "resolve the active challenge before requesting another evaluation"
        );
        require!(
            commitment.next_evaluation_id <= MAX_EVALUATIONS_PER_COMMITMENT,
            "evaluation limit reached"
        );

        let operations_available = commitment
            .operations_funded_yocto
            .checked_sub(commitment.operations_authorized_spend_yocto)
            .unwrap_or_else(|| env::panic_str("operations accounting invariant violated"));
        let execution_deposit = commitment.policy.evaluator.execution_deposit_yocto;
        require!(
            operations_available >= execution_deposit,
            "evaluator operations budget is exhausted"
        );

        let evaluation_id = commitment.next_evaluation_id;
        let canonical_payload = parse_canonical_heartbeat(&evidence);
        validate_heartbeat_binding(&commitment, &evidence, &canonical_payload, evaluation_id);
        let observed_at_ns = parse_decimal_u64(&canonical_payload.observed_at_ns)
            .unwrap_or_else(|| env::panic_str("heartbeat timestamp must be a decimal u64"));
        validate_observation_time(&commitment, observed_at_ns, now_ns);

        let evidence_hash = env::sha256_array(evidence.payload.as_bytes());
        let input = EvaluationInput {
            schema: EVALUATION_REQUEST_SCHEMA,
            commitment_id: commitment_id.0.to_string(),
            evaluation_id: evaluation_id.to_string(),
            policy_version: commitment.policy.version,
            policy_hash: encode_hex(&commitment.policy_hash),
            evidence_hash: encode_hex(&evidence_hash),
            observed_at_ns: observed_at_ns.to_string(),
            subject: &commitment.subject,
            evidence: &evidence,
            contract_id: (commitment.policy.version == 2)
                .then(|| env::current_account_id().to_string()),
        };
        let input_data = near_sdk::serde_json::to_string(&input)
            .unwrap_or_else(|_| env::panic_str("failed to serialize evaluator input"));
        require!(
            input_data.len() <= MAX_EVALUATOR_INPUT_BYTES,
            "evaluator input exceeds the 8192-byte limit"
        );
        let input_hash = env::sha256_array(input_data.as_bytes());
        let requested_at_ns = now_ns;
        let timeout_at_ns = requested_at_ns
            .checked_add(commitment.policy.evaluator.request_timeout_ns)
            .unwrap_or_else(|| env::panic_str("evaluation timeout timestamp overflow"));
        let request = EvaluationRequest {
            id: evaluation_id,
            commitment_id: commitment_id.0,
            policy_version: commitment.policy.version,
            policy_hash: commitment.policy_hash,
            input_hash,
            evidence_hash,
            observed_at_ns,
            requested_at_ns,
            timeout_at_ns,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
        };
        // This maximum-sized placeholder reserves callback storage for bounded reason codes.
        let record = EvaluationRecord {
            request_id: evaluation_id,
            commitment_id: commitment_id.0,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
            verdict: Some(Verdict::NonCompliant),
            reason_codes: vec!["X".repeat(MAX_REASON_CODE_BYTES); MAX_REASON_CODES],
            input_hash,
            evidence_hash,
            observed_at_ns,
            accepted_at_ns: Some(0),
            policy_hash: commitment.policy_hash,
            output_hash: Some([0; 32]),
        };

        commitment.next_evaluation_id = evaluation_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("evaluation ID overflow"));
        commitment.pending_evaluation_id = Some(evaluation_id);
        commitment.operations_authorized_spend_yocto = commitment
            .operations_authorized_spend_yocto
            .checked_add(execution_deposit)
            .unwrap_or_else(|| env::panic_str("operations authorization overflow"));

        let storage_before = env::storage_usage();
        let key = (commitment_id.0, evaluation_id);
        self.evaluation_requests.insert(key, request);
        self.evaluation_records.insert(key, record);
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.evaluation_requests.flush();
        self.evaluation_records.flush();
        self.commitments.flush();
        let request_state_usage = env::storage_usage();

        // Measure a conservative callback state as well as request state. The callback may
        // populate either optional health timestamp, the last-good observation, verdict,
        // acceptance time, and output digest without an attached deposit.
        let mut callback_reserve = commitment.clone();
        callback_reserve.pending_evaluation_id = None;
        callback_reserve.last_good = Some(GoodObservation {
            evaluation_id,
            evidence_hash,
            observed_at_ns,
            accepted_at_ns: now_ns,
        });
        callback_reserve.last_observed_at_ns = Some(observed_at_ns);
        callback_reserve.negative_since_ns = Some(now_ns);
        self.commitments.insert(commitment_id.0, callback_reserve);
        self.commitments.flush();
        let callback_state_usage = env::storage_usage();

        // Restore the actual pending state; the larger measured footprint remains the bond.
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        let peak_usage = request_state_usage.max(callback_state_usage);
        let storage_bytes = peak_usage
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for evaluation storage")
        );

        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let outlayer_args = json!({
            "source": {
                "WasmUrl": {
                    "url": commitment.policy.evaluator.wasm_url,
                    "hash": encode_hex(&commitment.policy.evaluator.wasm_sha256),
                    "build_target": commitment.policy.evaluator.build_target,
                }
            },
            "resource_limits": {
                "max_instructions": commitment.policy.evaluator.max_instructions,
                "max_memory_mb": commitment.policy.evaluator.max_memory_mb,
                "max_execution_seconds": commitment.policy.evaluator.max_execution_seconds,
            },
            "input_data": input_data,
            "response_format": "Json",
        });
        let outlayer_args = near_sdk::serde_json::to_vec(&outlayer_args)
            .unwrap_or_else(|_| env::panic_str("failed to serialize OutLayer request"));
        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "commitment_id": commitment_id,
            "evaluation_id": U64(evaluation_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize evaluation callback"));

        let _outlayer_promise = Promise::new(commitment.policy.evaluator.outlayer_account)
            .function_call(
                "request_execution".to_string(),
                outlayer_args,
                NearToken::from_yoctonear(execution_deposit),
                Gas::from_tgas(OUTLAYER_REQUEST_GAS_TGAS),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_outlayer_result".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));

        emit_event(
            "evaluation_requested",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "evaluation_id": evaluation_id.to_string(),
                "requested_at_ns": requested_at_ns.to_string(),
                "timeout_at_ns": timeout_at_ns.to_string(),
                "input_hash": encode_hex(&input_hash),
                "evidence_hash": encode_hex(&evidence_hash),
            }),
        );
        U64(evaluation_id)
    }

    #[payable]
    pub fn submit_service_report(&mut self, commitment_id: U64, report: SignedProbeReport) -> U128 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let report_json = near_sdk::serde_json::to_vec(&report)
            .unwrap_or_else(|_| env::panic_str("failed to serialize service report"));
        require!(
            report_json.len() <= MAX_SERVICE_REPORT_BYTES,
            "service report exceeds the 4096-byte inbox limit"
        );
        let commitment = self.load_commitment(commitment_id.0);
        require!(
            commitment.policy.version == 3,
            "commitment does not use service availability policy v3"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active
                && commitment.pending_evaluation_id.is_none()
                && commitment.active_challenge_id.is_none(),
            "service reports can only be staged for an active, unblocked commitment"
        );
        require!(
            report.payload.schema == "lcp.service_availability.report.v1"
                && report.payload.contract_id == env::current_account_id().as_str()
                && report.payload.commitment_id == commitment_id.0.to_string()
                && report.payload.evaluation_id == commitment.next_evaluation_id.to_string()
                && report.payload.policy_version == 3
                && report.payload.policy_hash == encode_hex(&commitment.policy_hash),
            "report is not bound to this contract, commitment, policy, and next evaluation"
        );
        require!(
            report.submitted_by.is_none(),
            "submitted_by is set by the contract"
        );

        let service_policy = read_service_policy(commitment_id.0)
            .unwrap_or_else(|| env::panic_str("service availability policy is missing"));
        let source = service_policy
            .sources
            .iter()
            .find(|source| source.source_id == report.payload.source_id)
            .unwrap_or_else(|| env::panic_str("report source is not in the commitment policy"));
        require!(
            source.operator_id == caller.as_str()
                && report.payload.operator_id == source.operator_id
                && report.payload.target_id == service_policy.target_id
                && report.payload.source_policy_hash == service_source_policy_hash(&service_policy),
            "report source, operator, target, or source policy does not match the commitment"
        );
        match service_policy.schema.as_str() {
            "lcp.service_availability.policy.v1" => {
                require!(
                    report.signature_hex.is_none(),
                    "the inbox accepts NEP-413 signatures for this legacy policy"
                );
                let envelope = report.wallet_signature.as_ref().unwrap_or_else(|| {
                    env::panic_str("legacy service reports require a NEP-413 wallet signature")
                });
                require!(
                    envelope.account_id == caller.as_str()
                        && envelope.recipient == env::current_account_id().as_str()
                        && !envelope.callback_url.is_empty()
                        && envelope.callback_url.len() <= 2_048,
                    "NEP-413 signer, recipient, or callback URL is invalid"
                );
                require!(
                    envelope.signature.len() == 88,
                    "NEP-413 signature must be a canonical 64-byte Ed25519 signature"
                );
                require!(
                    decode_32_byte_hex(&envelope.nonce_hex)
                        .map(|nonce| encode_hex(&nonce) == envelope.nonce_hex)
                        .unwrap_or(false),
                    "NEP-413 nonce must be 64 lowercase hexadecimal characters"
                );
                let signature_bytes = BASE64_STANDARD
                    .decode(&envelope.signature)
                    .unwrap_or_else(|_| env::panic_str("NEP-413 signature must be base64"));
                require!(
                    signature_bytes.len() == 64
                        && BASE64_STANDARD.encode(&signature_bytes) == envelope.signature,
                    "NEP-413 signature must be a canonical 64-byte Ed25519 signature"
                );
                let pinned_key = source.public_key_hex.as_deref().unwrap_or_else(|| {
                    env::panic_str("legacy source policy is missing its public key")
                });
                let pinned_key = decode_32_byte_hex(pinned_key)
                    .unwrap_or_else(|| env::panic_str("policy contains an invalid source key"));
                let wallet_key = decode_near_ed25519_public_key(&envelope.public_key)
                    .unwrap_or_else(|| {
                        env::panic_str("NEP-413 public key must be canonical ed25519")
                    });
                require!(
                    wallet_key.as_slice() == pinned_key.as_slice(),
                    "NEP-413 signer key does not match the source key pinned by this commitment"
                );
            }
            "lcp.service_availability.policy.v2" => require!(
                report.signature_hex.is_none() && report.wallet_signature.is_none(),
                "this inbox uses the operator's NEAR transaction as report authorization"
            ),
            _ => env::panic_str("unsupported service availability policy schema"),
        }
        let observed_at_ns =
            parse_decimal_u64(&report.payload.observed_at_ns).unwrap_or_else(|| {
                env::panic_str("report observation time must be a canonical decimal u64")
            });
        let max_source_lag_ns = parse_decimal_u64(&service_policy.max_source_lag_ns)
            .unwrap_or_else(|| env::panic_str("service policy source-age limit is invalid"));
        require!(
            observed_at_ns <= now_ns && now_ns.saturating_sub(observed_at_ns) < max_source_lag_ns,
            "report is future-dated or too old for the source freshness policy"
        );

        let inbox_key = service_report_inbox_storage_key(
            commitment_id.0,
            commitment.next_evaluation_id,
            &source.source_id,
        );
        let mut replacement_refund = 0;
        if let Some(previous) = read_service_report_inbox(&inbox_key) {
            require!(
                previous.submitted_by == caller,
                "only the configured operator may replace its staged report"
            );
            require!(
                previous.report_json != report_json,
                "this exact signed report is already staged"
            );
            env::storage_remove(&inbox_key);
            increase_service_report_refund_credit(
                &previous.submitted_by,
                previous.storage_deposit_yocto,
            );
            replacement_refund = previous.storage_deposit_yocto;
        }

        let expires_at_ns = observed_at_ns
            .checked_add(max_source_lag_ns)
            .unwrap_or(u64::MAX)
            .min(now_ns.saturating_add(MAX_SERVICE_REPORT_INBOX_TTL_NS));
        require!(
            expires_at_ns > now_ns,
            "report has no remaining freshness window"
        );
        let storage_before = env::storage_usage();
        let mut entry = ServiceReportInboxEntry {
            submitted_by: caller.clone(),
            submitted_at_ns: now_ns,
            expires_at_ns,
            storage_deposit_yocto: 0,
            report_json,
        };
        write_service_report_inbox(&inbox_key, &entry);
        let actual_storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("report storage usage unexpectedly decreased"));
        let required_storage_bytes = report_storage_bond_bytes(&inbox_key, &entry);
        require!(
            actual_storage_bytes.saturating_add(SERVICE_REPORT_REFUND_RESERVE_BYTES)
                <= required_storage_bytes,
            "report storage estimate is below the contract's storage usage"
        );
        let required_storage_bond = storage_cost(required_storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for report storage")
        );
        entry.storage_deposit_yocto = required_storage_bond;
        write_service_report_inbox(&inbox_key, &entry);
        refund_excess(caller.clone(), attached, required_storage_bond);

        emit_event(
            if replacement_refund > 0 {
                "service_report_replaced"
            } else {
                "service_report_submitted"
            },
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "evaluation_id": commitment.next_evaluation_id.to_string(),
                "source_id": source.source_id,
                "operator_id": caller,
                "expires_at_ns": expires_at_ns.to_string(),
                "storage_deposit_yocto": required_storage_bond.to_string(),
            }),
        );
        U128(required_storage_bond)
    }

    pub fn get_service_report_storage_deposit(
        &self,
        commitment_id: U64,
        report: SignedProbeReport,
    ) -> U128 {
        let source_id = &report.payload.source_id;
        require!(
            valid_service_identifier(source_id),
            "invalid service source ID"
        );
        let owner = report
            .wallet_signature
            .as_ref()
            .map(|signature| signature.account_id.as_str())
            .unwrap_or(report.payload.operator_id.as_str());
        let key = service_report_inbox_storage_key(commitment_id.0, 1, source_id);
        let report_json = near_sdk::serde_json::to_vec(&report)
            .unwrap_or_else(|_| env::panic_str("failed to serialize service report"));
        require!(
            report_json.len() <= MAX_SERVICE_REPORT_BYTES,
            "service report exceeds the 4096-byte inbox limit"
        );
        let entry = ServiceReportInboxEntry {
            submitted_by: owner.parse().unwrap_or_else(|_| {
                env::panic_str("report operator must be a valid NEAR account ID")
            }),
            submitted_at_ns: 0,
            expires_at_ns: 0,
            storage_deposit_yocto: 0,
            report_json,
        };
        U128(storage_cost(report_storage_bond_bytes(&key, &entry)))
    }

    pub fn get_service_report_inbox(
        &self,
        commitment_id: U64,
        evaluation_id: U64,
    ) -> Vec<ServiceReportInboxView> {
        let Some(commitment) = self.commitments.get(&commitment_id.0) else {
            return Vec::new();
        };
        if commitment.policy.version != 3 {
            return Vec::new();
        }
        let Some(policy) = read_service_policy(commitment_id.0) else {
            return Vec::new();
        };
        let now_ns = env::block_timestamp();
        policy
            .sources
            .iter()
            .filter_map(|source| {
                let key = service_report_inbox_storage_key(
                    commitment_id.0,
                    evaluation_id.0,
                    &source.source_id,
                );
                let entry = read_service_report_inbox(&key)?;
                let report = near_sdk::serde_json::from_slice(&entry.report_json).ok()?;
                Some(ServiceReportInboxView {
                    commitment_id,
                    evaluation_id,
                    source_id: source.source_id.clone(),
                    operator_id: source.operator_id.clone(),
                    submitted_by: entry.submitted_by,
                    submitted_at_ns: U64(entry.submitted_at_ns),
                    expires_at_ns: U64(entry.expires_at_ns),
                    storage_deposit_yocto: U128(entry.storage_deposit_yocto),
                    expired: now_ns >= entry.expires_at_ns,
                    report,
                })
            })
            .collect()
    }

    pub fn get_service_report_refund_balance(&self, account_id: near_sdk::AccountId) -> U128 {
        U128(read_service_report_refund_credit(&account_id).unwrap_or(0))
    }

    #[payable]
    pub fn request_service_evaluation_from_inbox(&mut self, commitment_id: U64) -> U64 {
        let commitment = self.load_commitment(commitment_id.0);
        require!(
            commitment.policy.version == 3,
            "commitment does not use service availability policy v3"
        );
        let policy = read_service_policy(commitment_id.0)
            .unwrap_or_else(|| env::panic_str("service availability policy is missing"));
        let source_policy_hash = service_source_policy_hash(&policy);
        let now_ns = env::block_timestamp();
        let mut reports = Vec::with_capacity(policy.sources.len());
        for source in &policy.sources {
            let key = service_report_inbox_storage_key(
                commitment_id.0,
                commitment.next_evaluation_id,
                &source.source_id,
            );
            let Some(entry) = read_service_report_inbox(&key) else {
                continue;
            };
            if now_ns >= entry.expires_at_ns {
                continue;
            }
            let mut report: SignedProbeReport =
                near_sdk::serde_json::from_slice(&entry.report_json)
                    .unwrap_or_else(|_| env::panic_str("staged service report is corrupted"));
            let source_lag_ns = parse_decimal_u64(&policy.max_source_lag_ns)
                .unwrap_or_else(|| env::panic_str("service policy source-age limit is invalid"));
            let report_time = parse_decimal_u64(&report.payload.observed_at_ns);
            let Some(observed_at_ns) = report_time else {
                continue;
            };
            if report.payload.schema != "lcp.service_availability.report.v1"
                || report.payload.contract_id != env::current_account_id().as_str()
                || report.payload.commitment_id != commitment_id.0.to_string()
                || report.payload.evaluation_id != commitment.next_evaluation_id.to_string()
                || report.payload.policy_version != 3
                || report.payload.policy_hash != encode_hex(&commitment.policy_hash)
                || report.payload.source_policy_hash != source_policy_hash
                || report.payload.source_id != source.source_id
                || report.payload.operator_id != source.operator_id
                || report.payload.target_id != policy.target_id
                || observed_at_ns > now_ns
                || now_ns.saturating_sub(observed_at_ns) >= source_lag_ns
            {
                continue;
            }
            if policy.schema == "lcp.service_availability.policy.v2" {
                if entry.submitted_by.as_str() != source.operator_id {
                    continue;
                }
                report.submitted_by = Some(entry.submitted_by.to_string());
            }
            reports.push(report);
        }
        require!(
            !reports.is_empty(),
            "the report inbox has no unexpired reports for the next evaluation"
        );
        self.schedule_service_evaluation(commitment_id, reports, true)
    }

    pub fn reclaim_service_report(
        &mut self,
        commitment_id: U64,
        evaluation_id: U64,
        source_id: String,
    ) -> bool {
        require!(
            valid_service_identifier(&source_id),
            "invalid service source ID"
        );
        let commitment = self.load_commitment(commitment_id.0);
        let key = service_report_inbox_storage_key(commitment_id.0, evaluation_id.0, &source_id);
        let Some(entry) = read_service_report_inbox(&key) else {
            return false;
        };
        require!(
            env::block_timestamp() >= entry.expires_at_ns
                || evaluation_id.0 < commitment.next_evaluation_id
                || commitment.lifecycle == Lifecycle::Closed,
            "only expired, consumed, or closed-commitment reports can be reclaimed"
        );
        env::storage_remove(&key);
        increase_service_report_refund_credit(&entry.submitted_by, entry.storage_deposit_yocto);
        emit_event(
            "service_report_reclaimed",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "evaluation_id": evaluation_id.0.to_string(),
                "source_id": source_id,
                "operator_id": entry.submitted_by,
                "storage_deposit_yocto": entry.storage_deposit_yocto.to_string(),
            }),
        );
        true
    }

    pub fn withdraw_service_report_refund(&mut self) {
        let caller = env::predecessor_account_id();
        let amount = read_service_report_refund_credit(&caller)
            .unwrap_or_else(|| env::panic_str("no service report storage refund is available"));
        require!(amount > 0, "no service report storage refund is available");
        env::storage_remove(&service_report_refund_storage_key(&caller));
        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "account_id": caller,
            "amount": U128(amount),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize service report refund callback"));
        let _refund_promise = Promise::new(caller.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_service_report_refund".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));
        emit_event(
            "service_report_refund_requested",
            json!({
                "account_id": caller,
                "amount_yocto": amount.to_string(),
            }),
        );
    }

    #[private]
    pub fn on_service_report_refund(&mut self, account_id: near_sdk::AccountId, amount: U128) {
        let succeeded = env::promise_results_count() == 1
            && match env::promise_result_checked(0, 0) {
                Ok(_) | Err(PromiseError::TooLong(_)) => true,
                Err(_) => false,
            };
        if succeeded {
            emit_event(
                "service_report_refund_sent",
                json!({"account_id": account_id, "amount_yocto": amount.0.to_string()}),
            );
        } else {
            increase_service_report_refund_credit(&account_id, amount.0);
            emit_event(
                "service_report_refund_failed",
                json!({"account_id": account_id, "amount_yocto": amount.0.to_string()}),
            );
        }
    }

    #[payable]
    pub fn request_service_evaluation(
        &mut self,
        commitment_id: U64,
        reports: Vec<SignedProbeReport>,
    ) -> U64 {
        self.schedule_service_evaluation(commitment_id, reports, false)
    }

    fn schedule_service_evaluation(
        &mut self,
        commitment_id: U64,
        reports: Vec<SignedProbeReport>,
        from_inbox: bool,
    ) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            commitment.policy.version == 3,
            "commitment does not use service availability policy v3"
        );
        require!(
            caller == commitment.maintainer || caller == commitment.policy.budget.sponsor,
            "only the commitment maintainer or sponsor may request evaluation"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active,
            "only active commitments can be evaluated"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "an evaluation is already pending"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "resolve the active challenge before requesting another evaluation"
        );
        require!(
            commitment.next_evaluation_id <= MAX_EVALUATIONS_PER_COMMITMENT,
            "evaluation limit reached"
        );

        let service_policy = read_service_policy(commitment_id.0)
            .unwrap_or_else(|| env::panic_str("service availability policy is missing"));
        let transaction_authenticated =
            service_policy.schema == "lcp.service_availability.policy.v2";
        require!(
            !transaction_authenticated || from_inbox,
            "transaction-authenticated reports must be requested from the NEAR inbox"
        );
        require!(
            !reports.is_empty() && reports.len() <= service_policy.sources.len(),
            "report bundle must contain between one and the configured source count"
        );
        let mut seen_sources: Vec<&str> = Vec::with_capacity(reports.len());
        for report in &reports {
            let source_id = report.payload.source_id.as_str();
            let source = service_policy
                .sources
                .iter()
                .find(|source| source.source_id == source_id)
                .unwrap_or_else(|| env::panic_str("report source is not in the commitment policy"));
            if transaction_authenticated {
                require!(
                    report.signature_hex.is_none()
                        && report.wallet_signature.is_none()
                        && report.submitted_by.as_deref() == Some(source.operator_id.as_str()),
                    "inbox report submitter does not match the configured operator"
                );
            } else {
                require!(
                    report.submitted_by.is_none(),
                    "legacy evaluation reports cannot set inbox submitter metadata"
                );
            }
            require!(
                !seen_sources.contains(&source_id),
                "an evaluation may include at most one report per source"
            );
            seen_sources.push(source_id);
        }

        for source in &service_policy.sources {
            let inbox_key = service_report_inbox_storage_key(
                commitment_id.0,
                commitment.next_evaluation_id,
                &source.source_id,
            );
            if let Some(staged) = read_service_report_inbox(&inbox_key) {
                env::storage_remove(&inbox_key);
                increase_service_report_refund_credit(
                    &staged.submitted_by,
                    staged.storage_deposit_yocto,
                );
            }
        }

        let operations_available = commitment
            .operations_funded_yocto
            .checked_sub(commitment.operations_authorized_spend_yocto)
            .unwrap_or_else(|| env::panic_str("operations accounting invariant violated"));
        let execution_deposit = commitment.policy.evaluator.execution_deposit_yocto;
        require!(
            operations_available >= execution_deposit,
            "evaluator operations budget is exhausted"
        );

        let evaluation_id = commitment.next_evaluation_id;
        let evidence_bytes = near_sdk::serde_json::to_vec(&reports)
            .unwrap_or_else(|_| env::panic_str("failed to serialize probe reports"));
        let evidence_hash = env::sha256_array(&evidence_bytes);
        let source_policy_hash = service_source_policy_hash(&service_policy);
        let input = ServiceAvailabilityEvaluationInput {
            schema: if transaction_authenticated {
                SERVICE_AVAILABILITY_INBOX_REQUEST_SCHEMA
            } else {
                SERVICE_AVAILABILITY_REQUEST_SCHEMA
            },
            contract_id: env::current_account_id().to_string(),
            commitment_id: commitment_id.0.to_string(),
            evaluation_id: evaluation_id.to_string(),
            policy_version: 3,
            policy_hash: encode_hex(&commitment.policy_hash),
            evidence_hash: encode_hex(&evidence_hash),
            requested_at_ns: now_ns.to_string(),
            subject: &commitment.subject,
            source_policy_hash,
            source_policy: &service_policy,
            reports: &reports,
        };
        let input_data = near_sdk::serde_json::to_string(&input)
            .unwrap_or_else(|_| env::panic_str("failed to serialize service evaluator input"));
        require!(
            input_data.len() <= MAX_SERVICE_EVALUATOR_INPUT_BYTES,
            "service evaluator input exceeds the 32768-byte limit"
        );
        let input_hash = env::sha256_array(input_data.as_bytes());
        let timeout_at_ns = now_ns
            .checked_add(commitment.policy.evaluator.request_timeout_ns)
            .unwrap_or_else(|| env::panic_str("evaluation timeout timestamp overflow"));
        let request = EvaluationRequest {
            id: evaluation_id,
            commitment_id: commitment_id.0,
            policy_version: 3,
            policy_hash: commitment.policy_hash,
            input_hash,
            evidence_hash,
            observed_at_ns: now_ns,
            requested_at_ns: now_ns,
            timeout_at_ns,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
        };
        let record = EvaluationRecord {
            request_id: evaluation_id,
            commitment_id: commitment_id.0,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
            verdict: Some(Verdict::NonCompliant),
            reason_codes: vec!["X".repeat(MAX_REASON_CODE_BYTES); MAX_REASON_CODES],
            input_hash,
            evidence_hash,
            observed_at_ns: now_ns,
            accepted_at_ns: Some(0),
            policy_hash: commitment.policy_hash,
            output_hash: Some([0; 32]),
        };

        commitment.next_evaluation_id = evaluation_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("evaluation ID overflow"));
        commitment.pending_evaluation_id = Some(evaluation_id);
        commitment.operations_authorized_spend_yocto = commitment
            .operations_authorized_spend_yocto
            .checked_add(execution_deposit)
            .unwrap_or_else(|| env::panic_str("operations authorization overflow"));

        let storage_before = env::storage_usage();
        let key = (commitment_id.0, evaluation_id);
        self.evaluation_requests.insert(key, request);
        self.evaluation_records.insert(key, record);
        self.commitments.insert(commitment_id.0, commitment.clone());
        reserve_service_summary(
            commitment_id.0,
            evaluation_id,
            service_policy.sources.len() as u8,
            service_policy.minimum_agreeing_sources,
        );
        self.evaluation_requests.flush();
        self.evaluation_records.flush();
        self.commitments.flush();
        let request_state_usage = env::storage_usage();

        let mut callback_reserve = commitment.clone();
        callback_reserve.pending_evaluation_id = None;
        callback_reserve.last_good = Some(GoodObservation {
            evaluation_id,
            evidence_hash,
            observed_at_ns: now_ns,
            accepted_at_ns: now_ns,
        });
        callback_reserve.last_observed_at_ns = Some(now_ns);
        callback_reserve.negative_since_ns = Some(now_ns);
        self.commitments.insert(commitment_id.0, callback_reserve);
        self.commitments.flush();
        let callback_state_usage = env::storage_usage();
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        let peak_usage = request_state_usage.max(callback_state_usage);
        let storage_bytes = peak_usage
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for evaluation storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let outlayer_args = json!({
            "source": { "WasmUrl": {
                "url": commitment.policy.evaluator.wasm_url,
                "hash": encode_hex(&commitment.policy.evaluator.wasm_sha256),
                "build_target": commitment.policy.evaluator.build_target,
            }},
            "resource_limits": {
                "max_instructions": commitment.policy.evaluator.max_instructions,
                "max_memory_mb": commitment.policy.evaluator.max_memory_mb,
                "max_execution_seconds": commitment.policy.evaluator.max_execution_seconds,
            },
            "input_data": input_data,
            "response_format": "Json",
        });
        let outlayer_args = near_sdk::serde_json::to_vec(&outlayer_args)
            .unwrap_or_else(|_| env::panic_str("failed to serialize OutLayer request"));
        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "commitment_id": commitment_id,
            "evaluation_id": U64(evaluation_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize evaluation callback"));
        let _outlayer_promise = Promise::new(commitment.policy.evaluator.outlayer_account)
            .function_call(
                "request_execution".to_string(),
                outlayer_args,
                NearToken::from_yoctonear(execution_deposit),
                Gas::from_tgas(OUTLAYER_REQUEST_GAS_TGAS),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_outlayer_result".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));
        emit_event(
            "evaluation_requested",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "evaluation_id": evaluation_id.to_string(),
                "requested_at_ns": now_ns.to_string(),
                "timeout_at_ns": timeout_at_ns.to_string(),
                "input_hash": encode_hex(&input_hash),
                "evidence_hash": encode_hex(&evidence_hash),
                "source_policy_hash": service_source_policy_hash(&service_policy),
            }),
        );
        U64(evaluation_id)
    }

    #[private]
    pub fn on_outlayer_result(&mut self, commitment_id: U64, evaluation_id: U64) {
        let key = (commitment_id.0, evaluation_id.0);
        let Some(mut request) = self.evaluation_requests.get(&key).cloned() else {
            env::log_str("ignored OutLayer callback for an unknown evaluation");
            return;
        };
        if request.status != EvaluationStatus::Pending {
            env::log_str("ignored duplicate or expired OutLayer callback");
            return;
        }
        let mut commitment = self.load_commitment(commitment_id.0);
        if commitment.pending_evaluation_id != Some(evaluation_id.0) {
            env::log_str("ignored OutLayer callback that does not match the pending evaluation");
            return;
        }

        let now_ns = env::block_timestamp();
        if now_ns >= request.timeout_at_ns {
            self.finish_evaluation(
                &mut commitment,
                &mut request,
                EvaluationStatus::TimedOut,
                None,
                vec!["OUTLAYER_TIMEOUT".to_string()],
                None,
                None,
                now_ns,
            );
            return;
        }

        if env::promise_results_count() != 1 {
            self.finish_evaluation(
                &mut commitment,
                &mut request,
                EvaluationStatus::Failed,
                None,
                vec!["MISSING_OUTLAYER_RESULT".to_string()],
                None,
                None,
                now_ns,
            );
            return;
        }

        let output_bytes = match env::promise_result_checked(0, MAX_EVALUATOR_OUTPUT_BYTES) {
            Ok(data) => data,
            Err(PromiseError::TooLong(_)) => {
                self.reject_evaluation(
                    &mut commitment,
                    &mut request,
                    "VERDICT_TOO_LARGE",
                    None,
                    now_ns,
                );
                return;
            }
            Err(_) => {
                self.finish_evaluation(
                    &mut commitment,
                    &mut request,
                    EvaluationStatus::Failed,
                    None,
                    vec!["OUTLAYER_EXECUTION_FAILED".to_string()],
                    None,
                    None,
                    now_ns,
                );
                return;
            }
        };

        let output_hash = env::sha256_array(&output_bytes);
        let output: Option<EvaluationVerdictOutput> =
            match near_sdk::serde_json::from_slice(&output_bytes) {
                Ok(output) => output,
                Err(_) => {
                    self.reject_evaluation(
                        &mut commitment,
                        &mut request,
                        "MALFORMED_VERDICT",
                        Some(output_hash),
                        now_ns,
                    );
                    return;
                }
            };
        let Some(output) = output else {
            self.finish_evaluation(
                &mut commitment,
                &mut request,
                EvaluationStatus::Failed,
                None,
                vec!["MISSING_OUTLAYER_RESULT".to_string()],
                Some(output_hash),
                None,
                now_ns,
            );
            return;
        };
        let Some(request_transaction_hash) =
            parse_near_transaction_hash(&output.request_transaction_hash)
        else {
            self.reject_evaluation(
                &mut commitment,
                &mut request,
                "INVALID_REQUEST_TRANSACTION_HASH",
                Some(output_hash),
                now_ns,
            );
            return;
        };
        request.request_transaction_hash = Some(request_transaction_hash);
        if let Some(reason) = validate_verdict_output(&commitment, &request, &output, now_ns) {
            self.reject_evaluation(
                &mut commitment,
                &mut request,
                reason,
                Some(output_hash),
                now_ns,
            );
            return;
        }

        if request.policy_version == 3 {
            request.observed_at_ns =
                parse_decimal_u64(&output.observed_at_ns).unwrap_or_else(|| {
                    env::panic_str("validated service observation time disappeared")
                });
            let summary = ServiceAvailabilityEvaluationSummary {
                source_counts: output
                    .source_counts
                    .clone()
                    .unwrap_or_else(|| env::panic_str("validated source counts disappeared")),
                corroboration_bps: output
                    .corroboration_bps
                    .unwrap_or_else(|| env::panic_str("validated corroboration value disappeared")),
            };
            write_service_summary(commitment_id.0, evaluation_id.0, &summary);
        }
        if output.verdict != Verdict::Inconclusive {
            let was_breached = health_of(&commitment, now_ns) == Health::Breached;
            if was_breached && !commitment.policy.temporal.recovery_allowed {
                commitment.breach_latched = true;
            }
            if output.verdict == Verdict::Compliant {
                commitment.last_good = Some(GoodObservation {
                    evaluation_id: evaluation_id.0,
                    evidence_hash: request.evidence_hash,
                    observed_at_ns: request.observed_at_ns,
                    accepted_at_ns: now_ns,
                });
                if commitment.policy.temporal.recovery_allowed {
                    commitment.negative_since_ns = None;
                }
            } else if commitment.negative_since_ns.is_none() {
                commitment.negative_since_ns = Some(now_ns);
            }
            commitment.last_observed_at_ns = Some(request.observed_at_ns);
        }

        self.finish_evaluation(
            &mut commitment,
            &mut request,
            EvaluationStatus::Accepted,
            Some(output.verdict),
            output.reason_codes,
            Some(output_hash),
            Some(now_ns),
            now_ns,
        );
    }

    pub fn expire_evaluation(&mut self, commitment_id: U64, evaluation_id: U64) {
        let key = (commitment_id.0, evaluation_id.0);
        let mut request = self
            .evaluation_requests
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("evaluation request not found"));
        require!(
            request.status == EvaluationStatus::Pending,
            "only pending evaluations can expire"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns >= request.timeout_at_ns,
            "evaluation request has not timed out"
        );
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            commitment.pending_evaluation_id == Some(evaluation_id.0),
            "evaluation is no longer the pending request"
        );
        self.finish_evaluation(
            &mut commitment,
            &mut request,
            EvaluationStatus::TimedOut,
            None,
            vec!["OUTLAYER_TIMEOUT".to_string()],
            None,
            None,
            now_ns,
        );
    }

    pub fn get_evaluation(
        &self,
        commitment_id: U64,
        evaluation_id: U64,
    ) -> Option<EvaluationRecordView> {
        self.evaluation_records
            .get(&(commitment_id.0, evaluation_id.0))
            .map(|record| {
                let mut view = EvaluationRecordView::from(record);
                if record.status == EvaluationStatus::Accepted
                    && self
                        .commitments
                        .get(&commitment_id.0)
                        .is_some_and(|commitment| commitment.policy.version == 3)
                {
                    view.service_availability =
                        read_service_summary(commitment_id.0, evaluation_id.0);
                }
                view
            })
    }

    pub fn get_evaluation_timeout(&self, commitment_id: U64, evaluation_id: U64) -> Option<U64> {
        self.evaluation_requests
            .get(&(commitment_id.0, evaluation_id.0))
            .map(|request| U64(request.timeout_at_ns))
    }

    pub fn get_latest_evaluation(&self, commitment_id: U64) -> Option<EvaluationRecordView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        if commitment.next_evaluation_id == 1 {
            return None;
        }
        self.get_evaluation(
            commitment_id,
            U64(commitment.next_evaluation_id.checked_sub(1)?),
        )
    }

    #[payable]
    pub fn challenge_evaluation(
        &mut self,
        commitment_id: U64,
        evaluation_id: U64,
        reason: String,
    ) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.maintainer || caller == commitment.policy.budget.sponsor,
            "only the commitment maintainer or sponsor may challenge an evaluation"
        );
        require!(
            caller != commitment.arbiter,
            "the designated arbiter cannot challenge an evaluation"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active,
            "only active commitments can be challenged"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "wait for the pending evaluation before opening a challenge"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "a challenge is already open"
        );
        require!(
            commitment.challenge_count < MAX_CHALLENGES_PER_COMMITMENT,
            "challenge limit reached"
        );
        require!(
            !reason.trim().is_empty() && reason.len() <= MAX_CHALLENGE_REASON_BYTES,
            "challenge reason must be non-empty and at most 1024 bytes"
        );

        let observation = commitment
            .last_good
            .as_ref()
            .unwrap_or_else(|| env::panic_str("there is no compliant evaluation to challenge"));
        require!(
            observation.evaluation_id == evaluation_id.0,
            "only the latest compliant evaluation may be challenged"
        );
        require!(
            !self
                .challenge_by_evaluation
                .contains_key(&(commitment_id.0, evaluation_id.0)),
            "this evaluation has already been challenged"
        );
        let record = self
            .evaluation_records
            .get(&(commitment_id.0, evaluation_id.0))
            .unwrap_or_else(|| env::panic_str("evaluation record not found"));
        require!(
            record.status == EvaluationStatus::Accepted
                && record.verdict == Some(Verdict::Compliant)
                && record.evidence_hash == observation.evidence_hash,
            "only an accepted compliant evaluation may be challenged"
        );
        let challenge_deadline = observation
            .accepted_at_ns
            .checked_add(commitment.policy.temporal.challenge_window_ns)
            .unwrap_or_else(|| env::panic_str("evaluation challenge window overflow"));
        require!(
            now_ns < challenge_deadline,
            "the evaluation challenge window has closed"
        );

        let challenge_id = self
            .next_challenge_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("challenge ID overflow"));
        let resolution_deadline_ns = now_ns
            .checked_add(commitment.policy.temporal.resolution_timeout_ns)
            .unwrap_or_else(|| env::panic_str("challenge resolution deadline overflow"));
        let challenge = Challenge {
            id: challenge_id,
            commitment_id: commitment_id.0,
            evaluation_id: evaluation_id.0,
            challenger: caller.clone(),
            reason_hash: env::sha256_array(reason.as_bytes()),
            opened_at_ns: now_ns,
            resolution_deadline_ns,
            status: ChallengeStatus::Open,
        };
        let reserved_epoch =
            self.challenge_claimable_epoch_at_open(&commitment, evaluation_id.0, now_ns);
        commitment.active_challenge_id = Some(challenge_id);
        commitment.challenge_count = commitment
            .challenge_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("challenge counter overflow"));

        let storage_before = env::storage_usage();
        self.challenges.insert(challenge_id, challenge.clone());
        self.challenge_by_evaluation
            .insert((commitment_id.0, evaluation_id.0), challenge_id);
        self.commitments.insert(commitment_id.0, commitment.clone());
        reserve_challenge_completion_timestamp(challenge_id);
        reserve_challenge_epoch(challenge_id, reserved_epoch);
        self.challenges.flush();
        self.challenge_by_evaluation.flush();
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for challenge storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);
        self.next_challenge_id = challenge_id;

        emit_event(
            "challenge_opened",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "challenge_id": challenge_id.to_string(),
                "evaluation_id": evaluation_id.0.to_string(),
                "challenger": challenge.challenger,
                "reason_hash": encode_hex(&challenge.reason_hash),
                "resolution_deadline_ns": resolution_deadline_ns.to_string(),
            }),
        );
        U64(challenge_id)
    }

    pub fn resolve_challenge(&mut self, challenge_id: U64, uphold: bool) {
        let mut challenge = self
            .challenges
            .get(&challenge_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("challenge not found"));
        require!(
            challenge.status == ChallengeStatus::Open,
            "only open challenges can be resolved"
        );
        let mut commitment = self.load_commitment(challenge.commitment_id);
        require!(
            env::predecessor_account_id() == commitment.arbiter,
            "only the designated arbiter may resolve a challenge"
        );
        require!(
            commitment.active_challenge_id == Some(challenge.id),
            "challenge is no longer active for this commitment"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns < challenge.resolution_deadline_ns,
            "challenge resolution deadline has passed"
        );
        self.complete_challenge(
            &mut commitment,
            &mut challenge,
            if uphold {
                ChallengeStatus::Upheld
            } else {
                ChallengeStatus::Invalidated
            },
            now_ns,
        );
    }

    pub fn expire_challenge(&mut self, challenge_id: U64) {
        let mut challenge = self
            .challenges
            .get(&challenge_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("challenge not found"));
        require!(
            challenge.status == ChallengeStatus::Open,
            "only open challenges can time out"
        );
        let mut commitment = self.load_commitment(challenge.commitment_id);
        require!(
            commitment.active_challenge_id == Some(challenge.id),
            "challenge is no longer active for this commitment"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns >= challenge.resolution_deadline_ns,
            "challenge resolution deadline has not passed"
        );
        self.complete_challenge(
            &mut commitment,
            &mut challenge,
            ChallengeStatus::TimedOut,
            now_ns,
        );
    }

    pub fn get_challenge(&self, challenge_id: U64) -> Option<ChallengeView> {
        self.challenges
            .get(&challenge_id.0)
            .map(|challenge| self.challenge_view(challenge))
    }

    pub fn get_challenge_for_evaluation(
        &self,
        commitment_id: U64,
        evaluation_id: U64,
    ) -> Option<ChallengeView> {
        let challenge_id = self
            .challenge_by_evaluation
            .get(&(commitment_id.0, evaluation_id.0))?;
        self.challenges
            .get(&challenge_id)
            .map(|challenge| self.challenge_view(challenge))
    }

    #[payable]
    pub fn claim_tranche(&mut self, commitment_id: U64) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.policy.budget.beneficiary,
            "only the configured beneficiary may claim a tranche"
        );
        let epoch = self
            .claim_eligibility(&commitment, now_ns)
            .unwrap_or_else(|error| env::panic_str(error));
        let tranche_key = (commitment_id.0, epoch);

        let tranche_amount = commitment.policy.budget.tranche_yocto;
        #[cfg(feature = "testnet-transfer-failure-fixture")]
        let recipient = self
            .test_transfer_failure_recipients
            .remove(&commitment_id.0)
            .unwrap_or_else(|| commitment.policy.budget.beneficiary.clone());
        #[cfg(feature = "testnet-transfer-failure-fixture")]
        self.test_transfer_failure_recipients.flush();
        #[cfg(not(feature = "testnet-transfer-failure-fixture"))]
        let recipient = commitment.policy.budget.beneficiary.clone();

        let transfer_id = self
            .next_transfer_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("transfer ID overflow"));
        commitment.escrow_pending_yocto = commitment
            .escrow_pending_yocto
            .checked_add(tranche_amount)
            .unwrap_or_else(|| env::panic_str("pending escrow overflow"));

        let tranche = Tranche {
            commitment_id: commitment_id.0,
            epoch,
            amount_yocto: tranche_amount,
            status: TrancheStatus::Pending,
            transfer_id: Some(transfer_id),
        };
        let pending_transfer = PendingTransfer {
            id: transfer_id,
            commitment_id: commitment_id.0,
            kind: TransferKind::Tranche,
            epoch: Some(epoch),
            recipient: recipient.clone(),
            amount_yocto: tranche_amount,
        };

        commitment.pending_transfer_count = commitment
            .pending_transfer_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("pending transfer counter overflow"));
        let storage_before = env::storage_usage();
        self.tranches.insert(tranche_key, tranche);
        self.pending_transfers
            .insert(transfer_id, pending_transfer.clone());
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.tranches.flush();
        self.pending_transfers.flush();
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for tranche storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "transfer_id": U64(transfer_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize tranche callback"));
        let _transfer_promise = Promise::new(recipient)
            .transfer(NearToken::from_yoctonear(pending_transfer.amount_yocto))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_tranche_transfer".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));

        self.next_transfer_id = transfer_id;
        emit_event(
            "tranche_claimed",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "epoch": epoch,
                "transfer_id": transfer_id.to_string(),
                "beneficiary": pending_transfer.recipient,
                "amount_yocto": tranche_amount.to_string(),
            }),
        );
        U64(transfer_id)
    }

    /// One-shot receiver override available only in the dedicated testnet fixture build.
    #[cfg(feature = "testnet-transfer-failure-fixture")]
    pub fn testnet_set_next_transfer_recipient(
        &mut self,
        commitment_id: U64,
        recipient: AccountId,
    ) {
        require!(
            env::current_account_id().as_str()
                == "failed-transfer-fixture.livingcommitmentsprotocol.testnet",
            "transfer failure hook is restricted to its dedicated testnet contract"
        );
        let commitment = self.load_commitment(commitment_id.0);
        require!(
            env::predecessor_account_id() == commitment.policy.budget.sponsor,
            "only the configured sponsor may arm the test transfer"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active,
            "test transfer target can only be set on an active commitment"
        );
        require!(
            recipient != commitment.policy.budget.beneficiary,
            "test transfer target must differ from the beneficiary"
        );
        self.test_transfer_failure_recipients
            .insert(commitment_id.0, recipient);
        self.test_transfer_failure_recipients.flush();
    }

    #[private]
    pub fn on_tranche_transfer(&mut self, transfer_id: U64) {
        let Some(transfer) = self.pending_transfers.get(&transfer_id.0).cloned() else {
            env::log_str("ignored callback for an unknown tranche transfer");
            return;
        };
        if transfer.kind != TransferKind::Tranche {
            env::log_str("ignored tranche callback for a non-tranche transfer");
            return;
        }
        let Some(epoch) = transfer.epoch else {
            env::log_str("ignored tranche callback without an epoch");
            return;
        };
        let tranche_key = (transfer.commitment_id, epoch);
        let mut tranche = self
            .tranches
            .get(&tranche_key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("pending tranche record not found"));
        if tranche.status != TrancheStatus::Pending || tranche.transfer_id != Some(transfer.id) {
            env::log_str("ignored stale or mismatched tranche transfer callback");
            return;
        }
        let mut commitment = self.load_commitment(transfer.commitment_id);
        require!(
            commitment.escrow_pending_yocto >= transfer.amount_yocto
                && commitment.pending_transfer_count > 0,
            "pending escrow accounting invariant violated"
        );

        let succeeded = env::promise_results_count() == 1
            && match env::promise_result_checked(0, 0) {
                Ok(_) | Err(PromiseError::TooLong(_)) => true,
                Err(_) => false,
            };
        commitment.escrow_pending_yocto -= transfer.amount_yocto;
        if succeeded {
            commitment.escrow_paid_yocto = commitment
                .escrow_paid_yocto
                .checked_add(transfer.amount_yocto)
                .unwrap_or_else(|| env::panic_str("paid escrow accounting overflow"));
            tranche.status = TrancheStatus::Paid;
        } else {
            tranche.status = TrancheStatus::Failed;
        }
        tranche.transfer_id = None;
        commitment.pending_transfer_count -= 1;

        self.commitments.insert(commitment.id, commitment);
        self.tranches.insert(tranche_key, tranche);
        self.pending_transfers.remove(&transfer_id.0);
        self.commitments.flush();
        self.tranches.flush();
        self.pending_transfers.flush();

        emit_event(
            if succeeded {
                "tranche_paid"
            } else {
                "tranche_transfer_failed"
            },
            json!({
                "commitment_id": transfer.commitment_id.to_string(),
                "epoch": epoch,
                "transfer_id": transfer.id.to_string(),
                "beneficiary": transfer.recipient,
                "amount_yocto": transfer.amount_yocto.to_string(),
            }),
        );
    }

    #[private]
    pub fn on_refund_transfer(&mut self, transfer_id: U64) {
        let Some(transfer) = self.pending_transfers.get(&transfer_id.0).cloned() else {
            env::log_str("ignored callback for an unknown refund transfer");
            return;
        };
        if transfer.kind != TransferKind::Refund {
            env::log_str("ignored refund callback for a non-refund transfer");
            return;
        }
        let mut commitment = self.load_commitment(transfer.commitment_id);
        require!(
            commitment.escrow_pending_yocto >= transfer.amount_yocto
                && commitment.pending_transfer_count > 0,
            "pending refund accounting invariant violated"
        );
        let succeeded = env::promise_results_count() == 1
            && match env::promise_result_checked(0, 0) {
                Ok(_) | Err(PromiseError::TooLong(_)) => true,
                Err(_) => false,
            };
        commitment.escrow_pending_yocto -= transfer.amount_yocto;
        if succeeded {
            commitment.escrow_refunded_yocto = commitment
                .escrow_refunded_yocto
                .checked_add(transfer.amount_yocto)
                .unwrap_or_else(|| env::panic_str("refunded escrow accounting overflow"));
        }
        commitment.pending_transfer_count -= 1;
        self.commitments.insert(commitment.id, commitment);
        self.pending_transfers.remove(&transfer_id.0);
        self.commitments.flush();
        self.pending_transfers.flush();

        emit_event(
            if succeeded {
                "escrow_refunded"
            } else {
                "escrow_refund_failed"
            },
            json!({
                "commitment_id": transfer.commitment_id.to_string(),
                "transfer_id": transfer.id.to_string(),
                "sponsor": transfer.recipient,
                "amount_yocto": transfer.amount_yocto.to_string(),
            }),
        );
    }

    pub fn close_commitment(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.creator
                || caller == commitment.maintainer
                || caller == commitment.arbiter
                || caller == commitment.policy.budget.sponsor
                || caller == commitment.policy.budget.beneficiary,
            "caller is not authorized to close this commitment"
        );
        require!(
            commitment.pending_evaluation_id.is_none()
                && commitment.active_challenge_id.is_none()
                && commitment.pending_transfer_count == 0,
            "resolve pending evaluations, challenges, and transfers before closing"
        );
        let now_ns = env::block_timestamp();
        require!(
            !self.claim_eligibility(&commitment, now_ns).is_ok()
                || caller == commitment.policy.budget.beneficiary,
            "the beneficiary must claim or explicitly close a claimable tranche"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "commitment is already closed"
        );
        commitment.lifecycle = Lifecycle::Closed;
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        emit_event(
            "commitment_closed",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "closed_by": caller,
                "closed_at_ns": now_ns.to_string(),
            }),
        );
    }

    #[payable]
    pub fn refund_remaining(&mut self, commitment_id: U64) -> U64 {
        let caller = env::predecessor_account_id();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.policy.budget.sponsor,
            "only the configured sponsor may refund remaining escrow"
        );
        require!(
            commitment.lifecycle == Lifecycle::Closed,
            "close the commitment before refunding remaining escrow"
        );
        require!(
            commitment.pending_evaluation_id.is_none() && commitment.active_challenge_id.is_none(),
            "pending evaluations and challenges must be resolved before refund"
        );
        let amount = commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|value| value.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|value| value.checked_sub(commitment.escrow_pending_yocto))
            .unwrap_or_else(|| env::panic_str("escrow accounting invariant violated"));
        require!(amount > 0, "there is no remaining escrow to refund");

        let transfer_id = self
            .next_transfer_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("transfer ID overflow"));
        commitment.escrow_pending_yocto = commitment
            .escrow_pending_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("pending escrow overflow"));
        commitment.pending_transfer_count = commitment
            .pending_transfer_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("pending transfer counter overflow"));
        let pending_transfer = PendingTransfer {
            id: transfer_id,
            commitment_id: commitment_id.0,
            kind: TransferKind::Refund,
            epoch: None,
            recipient: commitment.policy.budget.sponsor.clone(),
            amount_yocto: amount,
        };

        let storage_before = env::storage_usage();
        self.pending_transfers
            .insert(transfer_id, pending_transfer.clone());
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.pending_transfers.flush();
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for refund storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "transfer_id": U64(transfer_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize refund callback"));
        let _refund_promise = Promise::new(pending_transfer.recipient.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_refund_transfer".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));
        self.next_transfer_id = transfer_id;
        emit_event(
            "escrow_refund_requested",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "transfer_id": transfer_id.to_string(),
                "sponsor": pending_transfer.recipient,
                "amount_yocto": amount.to_string(),
            }),
        );
        U64(transfer_id)
    }

    pub fn get_current_epoch(&self, commitment_id: U64) -> Option<U64> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let now_ns = env::block_timestamp();
        current_epoch_of(commitment, now_ns).map(U64)
    }

    pub fn get_tranche(&self, commitment_id: U64, epoch: U64) -> Option<TrancheView> {
        let epoch = u32::try_from(epoch.0).ok()?;
        self.tranches
            .get(&(commitment_id.0, epoch))
            .map(TrancheView::from)
    }

    pub fn can_claim_tranche(&self, commitment_id: U64) -> Option<ClaimEligibilityView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let now_ns = env::block_timestamp();
        let eligibility = self.claim_eligibility(commitment, now_ns);
        let claimable_epoch = eligibility
            .as_ref()
            .ok()
            .copied()
            .map(|epoch| U64(u64::from(epoch)));
        let claim_window_resumed = eligibility.as_ref().ok().copied().is_some_and(|epoch| {
            self.preserved_claim_epoch(commitment, now_ns).is_some_and(
                |(preserved_epoch, was_resumed)| preserved_epoch == epoch && was_resumed,
            )
        });
        Some(ClaimEligibilityView {
            eligible: eligibility.is_ok(),
            reason: eligibility.err().map(|reason| reason.to_string()),
            current_epoch: current_epoch_of(commitment, now_ns).map(U64),
            claimable_epoch,
            claim_window_resumed,
            amount_yocto: U128(commitment.policy.budget.tranche_yocto),
        })
    }

    pub fn get_escrow_status(&self, commitment_id: U64) -> Option<EscrowStatusView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let free_yocto = commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|amount| amount.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|amount| amount.checked_sub(commitment.escrow_pending_yocto))
            .unwrap_or_else(|| env::panic_str("escrow accounting invariant violated"));
        Some(EscrowStatusView {
            funded_yocto: U128(commitment.escrow_funded_yocto),
            paid_yocto: U128(commitment.escrow_paid_yocto),
            refunded_yocto: U128(commitment.escrow_refunded_yocto),
            pending_yocto: U128(commitment.escrow_pending_yocto),
            free_yocto: U128(free_yocto),
        })
    }

    /// Returns a bounded page of commitments, newest first. `before_id` is exclusive.
    pub fn list_commitments(
        &self,
        before_id: Option<U64>,
        limit: u32,
    ) -> Vec<CommitmentSummaryView> {
        let page_size = limit.min(MAX_COMMITMENTS_PAGE_SIZE);
        if page_size == 0 {
            return Vec::new();
        }
        let upper_id = before_id
            .map(|cursor| cursor.0.saturating_sub(1))
            .unwrap_or(self.next_commitment_id)
            .min(self.next_commitment_id);
        if upper_id == 0 {
            return Vec::new();
        }
        let first_id = upper_id.saturating_sub(u64::from(page_size - 1)).max(1);
        let now_ns = env::block_timestamp();

        (first_id..=upper_id)
            .rev()
            .filter_map(|id| {
                self.commitments
                    .get(&id)
                    .map(|commitment| CommitmentSummaryView {
                        id: U64(commitment.id),
                        subject: commitment.subject.clone(),
                        lifecycle: commitment.lifecycle,
                        effective_health: health_of(commitment, now_ns),
                        policy_version: commitment.policy.version,
                        escrow_funded_yocto: U128(commitment.escrow_funded_yocto),
                        escrow_paid_yocto: U128(commitment.escrow_paid_yocto),
                    })
            })
            .collect()
    }

    pub fn get_commitment(&self, commitment_id: U64) -> Option<CommitmentView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let health = health_of(commitment, env::block_timestamp());

        Some(CommitmentView {
            id: U64(commitment.id),
            subject: commitment.subject.clone(),
            creator: commitment.creator.clone(),
            maintainer: commitment.maintainer.clone(),
            arbiter: commitment.arbiter.clone(),
            lifecycle: commitment.lifecycle,
            policy_version: commitment.policy.version,
            policy_hash: encode_hex(&commitment.policy_hash),
            next_evaluation_id: U64(commitment.next_evaluation_id),
            pending_evaluation_id: commitment.pending_evaluation_id.map(U64),
            active_challenge_id: commitment.active_challenge_id.map(U64),
            activated_at_ns: commitment.activated_at_ns.map(U64),
            last_observed_at_ns: commitment.last_observed_at_ns.map(U64),
            last_good_observed_at_ns: commitment
                .last_good
                .as_ref()
                .map(|observation| U64(observation.observed_at_ns)),
            negative_since_ns: commitment.negative_since_ns.map(U64),
            effective_health: health,
            escrow_funded_yocto: U128(commitment.escrow_funded_yocto),
            escrow_paid_yocto: U128(commitment.escrow_paid_yocto),
            escrow_refunded_yocto: U128(commitment.escrow_refunded_yocto),
            escrow_pending_yocto: U128(commitment.escrow_pending_yocto),
            operations_funded_yocto: U128(commitment.operations_funded_yocto),
            operations_authorized_spend_yocto: U128(commitment.operations_authorized_spend_yocto),
            storage_deposit_yocto: U128(commitment.storage_deposit_yocto),
        })
    }

    pub fn get_policy(&self, commitment_id: U64) -> Option<CommitmentPolicyView> {
        self.commitments
            .get(&commitment_id.0)
            .map(|commitment| CommitmentPolicyView::from(&commitment.policy))
    }

    pub fn get_service_availability_policy(
        &self,
        commitment_id: U64,
    ) -> Option<ServiceAvailabilityPolicy> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        (commitment.policy.version == 3)
            .then(|| read_service_policy(commitment_id.0))
            .flatten()
    }

    pub fn get_service_policy_amendment(
        &self,
        commitment_id: U64,
        amendment_id: String,
    ) -> Option<ServicePolicyAmendmentView> {
        read_service_amendment(commitment_id.0, &amendment_id)
    }

    pub fn get_latest_service_policy_amendment(
        &self,
        commitment_id: U64,
    ) -> Option<ServicePolicyAmendmentView> {
        let amendment_id = read_latest_service_amendment_id(commitment_id.0)?;
        read_service_amendment(commitment_id.0, &amendment_id)
    }

    pub fn supports_service_policy_amendment_rejection(&self) -> bool {
        true
    }

    pub fn get_bounded_payout_authority_grant(
        &self,
        commitment_id: U64,
        grant_id: String,
    ) -> Option<BoundedPayoutAuthorityGrantView> {
        let grant = read_authority_grant(commitment_id.0, &grant_id)?;
        Some(BoundedPayoutAuthorityGrantView {
            schema: "lcp.bounded-payout-authority.v1".to_string(),
            commitment_id,
            grant_id,
            granting_account: grant.granting_account,
            adapter_account: grant.adapter_account,
            resource_account: grant.resource_account,
            capability: "bounded_payout".to_string(),
            per_action_limit_yocto: U128(grant.per_action_limit_yocto),
            cumulative_limit_yocto: U128(grant.cumulative_limit_yocto),
            authorized_yocto: U128(grant.authorized_yocto),
            expires_at_ns: U64(grant.expires_at_ns),
            last_action_nonce: U64(grant.last_action_nonce),
            last_authorized_epoch: (grant.last_authorized_epoch != u64::MAX)
                .then_some(U64(grant.last_authorized_epoch)),
            revoked: grant.revoked,
        })
    }

    pub fn get_latest_bounded_payout_authority_grant(
        &self,
        commitment_id: U64,
    ) -> Option<BoundedPayoutAuthorityGrantView> {
        let grant_id = read_latest_authority_grant_id(commitment_id.0)?;
        self.get_bounded_payout_authority_grant(commitment_id, grant_id)
    }

    pub fn get_effective_health(&self, commitment_id: U64) -> Option<Health> {
        self.commitments
            .get(&commitment_id.0)
            .map(|commitment| health_of(commitment, env::block_timestamp()))
    }
}

impl Contract {
    fn insert_commitment(
        &mut self,
        subject: String,
        maintainer: near_sdk::AccountId,
        arbiter: near_sdk::AccountId,
        policy: CommitmentPolicy,
        policy_hash: [u8; 32],
        service_policy: Option<ServiceAvailabilityPolicy>,
    ) -> U64 {
        require!(
            !subject.trim().is_empty()
                && subject.len() <= MAX_SUBJECT_BYTES
                && is_printable_ascii(&subject),
            "subject must be non-empty printable ASCII and at most 128 bytes"
        );
        require!(
            arbiter != maintainer
                && arbiter != policy.budget.sponsor
                && arbiter != policy.budget.beneficiary,
            "arbiter must be distinct from the maintainer, sponsor, and beneficiary"
        );
        let creator = env::predecessor_account_id();
        let id = self
            .next_commitment_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("commitment ID overflow"));
        let policy_version = policy.version;
        let mut commitment = Commitment {
            id,
            subject,
            creator: creator.clone(),
            maintainer,
            arbiter,
            lifecycle: Lifecycle::Draft,
            policy,
            policy_hash,
            activated_at_ns: None,
            last_good: None,
            last_observed_at_ns: None,
            negative_since_ns: None,
            pending_evaluation_id: None,
            active_challenge_id: None,
            breach_latched: false,
            escrow_funded_yocto: 0,
            escrow_paid_yocto: 0,
            escrow_refunded_yocto: 0,
            escrow_pending_yocto: 0,
            operations_funded_yocto: 0,
            operations_authorized_spend_yocto: 0,
            storage_deposit_yocto: 0,
            next_evaluation_id: 1,
            challenge_count: 0,
            pending_transfer_count: 0,
        };

        let storage_before = env::storage_usage();
        self.commitments.insert(id, commitment.clone());
        self.commitments.flush();
        if let Some(service_policy) = &service_policy {
            write_service_policy(id, service_policy);
        }
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for storage")
        );

        commitment.storage_deposit_yocto = required_storage_bond;
        self.commitments.insert(id, commitment);
        self.commitments.flush();
        self.next_commitment_id = id;
        refund_excess(creator.clone(), attached, required_storage_bond);
        emit_event(
            "commitment_created",
            json!({
                "commitment_id": id.to_string(),
                "creator": creator,
                "policy_version": policy_version,
                "policy_hash": encode_hex(&policy_hash),
            }),
        );
        U64(id)
    }

    fn load_commitment(&self, commitment_id: CommitmentId) -> Commitment {
        self.commitments
            .get(&commitment_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("commitment not found"))
    }

    fn claim_eligibility(&self, commitment: &Commitment, now_ns: u64) -> Result<u32, &'static str> {
        if commitment.lifecycle != Lifecycle::Active {
            return Err("only active commitments can pay tranches");
        }
        if commitment.pending_evaluation_id.is_some() {
            return Err("a pending evaluation prevents tranche claims");
        }
        if commitment.active_challenge_id.is_some() {
            return Err("a blocking challenge prevents claims");
        }
        if let Some((epoch, _)) = self.preserved_claim_epoch(commitment, now_ns) {
            return Ok(epoch);
        }
        if health_of(commitment, now_ns) != Health::Healthy {
            return Err("commitment health must be Healthy to claim");
        }
        let Some(observation) = commitment.last_good.as_ref() else {
            return Err("a compliant observation is required to claim");
        };
        let Some(governing_record) = self
            .evaluation_records
            .get(&(commitment.id, observation.evaluation_id))
        else {
            return Err("governing evaluation record not found");
        };
        if governing_record.status != EvaluationStatus::Accepted
            || governing_record.verdict != Some(Verdict::Compliant)
            || governing_record.evidence_hash != observation.evidence_hash
            || governing_record.policy_hash != commitment.policy_hash
        {
            return Err("latest compliant evaluation is not eligible");
        }
        let Some(challenge_window_ends_at) = observation
            .accepted_at_ns
            .checked_add(commitment.policy.temporal.challenge_window_ns)
        else {
            return Err("evaluation challenge window overflow");
        };
        if now_ns < challenge_window_ends_at {
            return Err("evaluation challenge window is still open");
        }
        let Some(epoch) = current_epoch_of(commitment, now_ns) else {
            return Err("commitment is missing an activation timestamp");
        };
        if epoch >= u64::from(commitment.policy.budget.max_epochs) {
            return Err("the funded budget program has ended");
        }
        let Ok(epoch) = u32::try_from(epoch) else {
            return Err("current epoch exceeds the supported range");
        };
        if self
            .tranches
            .get(&(commitment.id, epoch))
            .map(|tranche| tranche.status != TrancheStatus::Failed)
            .unwrap_or(false)
        {
            return Err("this epoch is already paid or pending");
        }
        let Some(escrow_free) = commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|amount| amount.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|amount| amount.checked_sub(commitment.escrow_pending_yocto))
        else {
            return Err("escrow accounting invariant violated");
        };
        if escrow_free < commitment.policy.budget.tranche_yocto {
            return Err("insufficient unallocated commitment escrow");
        }
        Ok(epoch)
    }

    fn challenge_claimable_epoch_at_open(
        &self,
        commitment: &Commitment,
        evaluation_id: u64,
        now_ns: u64,
    ) -> Option<u32> {
        if commitment.lifecycle != Lifecycle::Active
            || commitment.pending_evaluation_id.is_some()
            || commitment.active_challenge_id.is_some()
            || health_of(commitment, now_ns) != Health::Healthy
        {
            return None;
        }
        let observation = commitment.last_good.as_ref()?;
        if observation.evaluation_id != evaluation_id {
            return None;
        }
        let epoch = u32::try_from(current_epoch_of(commitment, now_ns)?).ok()?;
        if epoch >= commitment.policy.budget.max_epochs
            || self.tranche_is_paid_or_pending(commitment.id, epoch)
            || self.escrow_available_for_tranche(commitment)?
                < commitment.policy.budget.tranche_yocto
        {
            return None;
        }
        let record = self
            .evaluation_records
            .get(&(commitment.id, evaluation_id))?;
        if record.status != EvaluationStatus::Accepted
            || record.verdict != Some(Verdict::Compliant)
            || record.evidence_hash != observation.evidence_hash
            || record.policy_hash != commitment.policy_hash
        {
            return None;
        }
        let (claim_start_ns, claim_end_ns) = claim_window_for_epoch(commitment, record, epoch)?;
        (now_ns < claim_end_ns && claim_start_ns < claim_end_ns).then_some(epoch)
    }

    fn preserved_claim_epoch(&self, commitment: &Commitment, now_ns: u64) -> Option<(u32, bool)> {
        let escrow_free = self.escrow_available_for_tranche(commitment)?;
        if escrow_free < commitment.policy.budget.tranche_yocto {
            return None;
        }

        // Evaluations and challenges are each capped at 64, so this history scan is bounded.
        for evaluation_id in 1..commitment.next_evaluation_id {
            let Some(challenge_id) = self
                .challenge_by_evaluation
                .get(&(commitment.id, evaluation_id))
                .copied()
            else {
                continue;
            };
            let Some(challenge) = self.challenges.get(&challenge_id) else {
                continue;
            };
            if !matches!(
                challenge.status,
                ChallengeStatus::Upheld | ChallengeStatus::TimedOut
            ) {
                continue;
            }
            let Some(epoch) = read_challenge_reserved_epoch(challenge_id) else {
                continue;
            };
            if self.tranche_is_paid_or_pending(commitment.id, epoch) {
                continue;
            }
            let Some(record) = self.evaluation_records.get(&(commitment.id, evaluation_id)) else {
                continue;
            };
            if record.status != EvaluationStatus::Accepted
                || record.verdict != Some(Verdict::Compliant)
                || record.policy_hash != commitment.policy_hash
            {
                continue;
            }
            // A later substantive accepted result supersedes this paused claim opportunity.
            let superseded = (evaluation_id + 1..commitment.next_evaluation_id).any(|later_id| {
                self.evaluation_records
                    .get(&(commitment.id, later_id))
                    .is_some_and(|later| {
                        later.status == EvaluationStatus::Accepted
                            && later.verdict != Some(Verdict::Inconclusive)
                    })
            });
            if superseded {
                continue;
            }
            let Some(completed_at_ns) = read_challenge_completion_timestamp(challenge_id) else {
                // Pre-upgrade challenges have no exact completion time and receive no extension.
                continue;
            };
            let Some((claim_start_ns, claim_end_ns)) =
                claim_window_for_epoch(commitment, record, epoch)
            else {
                continue;
            };
            if claim_end_ns <= claim_start_ns {
                continue;
            }
            let pause_started_at_ns = challenge.opened_at_ns.max(claim_start_ns);
            let (eligible_from_ns, eligible_until_ns) = if completed_at_ns > pause_started_at_ns {
                let paused_duration_ns = completed_at_ns - pause_started_at_ns;
                let resumed_until_ns = claim_end_ns
                    .checked_add(paused_duration_ns)
                    .unwrap_or(u64::MAX);
                (completed_at_ns, resumed_until_ns)
            } else {
                (claim_start_ns, claim_end_ns)
            };
            if now_ns >= eligible_from_ns && now_ns < eligible_until_ns {
                return Some((epoch, completed_at_ns > pause_started_at_ns));
            }
        }
        None
    }

    fn tranche_is_paid_or_pending(&self, commitment_id: CommitmentId, epoch: u32) -> bool {
        self.tranches
            .get(&(commitment_id, epoch))
            .is_some_and(|tranche| tranche.status != TrancheStatus::Failed)
    }

    fn escrow_available_for_tranche(&self, commitment: &Commitment) -> Option<u128> {
        commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|amount| amount.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|amount| amount.checked_sub(commitment.escrow_pending_yocto))
    }

    fn finish_evaluation(
        &mut self,
        commitment: &mut Commitment,
        request: &mut EvaluationRequest,
        status: EvaluationStatus,
        verdict: Option<Verdict>,
        reason_codes: Vec<String>,
        output_hash: Option<[u8; 32]>,
        accepted_at_ns: Option<u64>,
        now_ns: u64,
    ) {
        require!(
            reason_codes.len() <= MAX_REASON_CODES
                && reason_codes
                    .iter()
                    .all(|code| !code.is_empty() && code.len() <= MAX_REASON_CODE_BYTES),
            "evaluation result exceeds reserved record capacity"
        );

        request.status = status;
        commitment.pending_evaluation_id = None;
        let key = (request.commitment_id, request.id);
        let mut record = self
            .evaluation_records
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("evaluation record not found"));
        record.status = status;
        record.observed_at_ns = request.observed_at_ns;
        record.request_transaction_hash = request.request_transaction_hash;
        record.verdict = verdict;
        record.reason_codes = reason_codes.clone();
        record.accepted_at_ns = accepted_at_ns;
        record.output_hash = output_hash;

        self.evaluation_requests.insert(key, request.clone());
        self.evaluation_records.insert(key, record);
        self.commitments.insert(commitment.id, commitment.clone());
        self.evaluation_requests.flush();
        self.evaluation_records.flush();
        self.commitments.flush();

        let event_name = match status {
            EvaluationStatus::Accepted => "evaluation_accepted",
            EvaluationStatus::Rejected => "evaluation_rejected",
            EvaluationStatus::Failed => "evaluation_failed",
            EvaluationStatus::TimedOut => "evaluation_timed_out",
            EvaluationStatus::Pending => env::panic_str("cannot finish a pending evaluation"),
        };
        emit_event(
            event_name,
            json!({
                "commitment_id": commitment.id.to_string(),
                "evaluation_id": request.id.to_string(),
                "status": status,
                "verdict": verdict,
                "reason_codes": reason_codes,
                "observed_at_ns": request.observed_at_ns.to_string(),
                "accepted_at_ns": accepted_at_ns.map(|timestamp| timestamp.to_string()),
                "completed_at_ns": now_ns.to_string(),
                "request_transaction_hash": request
                    .request_transaction_hash
                    .as_ref()
                    .filter(|hash| **hash != [0; 32])
                    .map(|hash| encode_hex(hash)),
                "output_hash": output_hash.as_ref().map(|hash| encode_hex(hash)),
            }),
        );
    }

    fn reject_evaluation(
        &mut self,
        commitment: &mut Commitment,
        request: &mut EvaluationRequest,
        reason_code: &str,
        output_hash: Option<[u8; 32]>,
        now_ns: u64,
    ) {
        self.finish_evaluation(
            commitment,
            request,
            EvaluationStatus::Rejected,
            None,
            vec![reason_code.to_string()],
            output_hash,
            None,
            now_ns,
        );
    }

    fn complete_challenge(
        &mut self,
        commitment: &mut Commitment,
        challenge: &mut Challenge,
        status: ChallengeStatus,
        now_ns: u64,
    ) {
        require!(
            status != ChallengeStatus::Open,
            "challenge completion status cannot remain open"
        );
        // New challenges reserve this fixed-size slot when opened. Older open challenges from
        // before this field existed have no slot, so leave those outcomes without an exact time.
        record_challenge_completion_timestamp(challenge.id, now_ns);
        let timeout_policy_is_new = challenge_timeout_preserves_evidence(challenge.id);
        let invalidates_evidence = status == ChallengeStatus::Invalidated
            || (status == ChallengeStatus::TimedOut && !timeout_policy_is_new);
        if invalidates_evidence {
            if health_of(commitment, now_ns) == Health::Breached
                && !commitment.policy.temporal.recovery_allowed
            {
                commitment.breach_latched = true;
            }
            if commitment
                .last_good
                .as_ref()
                .map(|observation| observation.evaluation_id == challenge.evaluation_id)
                .unwrap_or(false)
            {
                commitment.last_good = None;
            }
            if commitment.negative_since_ns.is_none() {
                commitment.negative_since_ns = Some(now_ns);
            }
        }

        challenge.status = status;
        commitment.active_challenge_id = None;
        self.challenges.insert(challenge.id, challenge.clone());
        self.commitments.insert(commitment.id, commitment.clone());
        self.challenges.flush();
        self.commitments.flush();

        let event_name = match status {
            ChallengeStatus::Upheld => "challenge_upheld",
            ChallengeStatus::Invalidated => "challenge_invalidated",
            ChallengeStatus::TimedOut => "challenge_timed_out",
            ChallengeStatus::Open => env::panic_str("cannot complete an open challenge"),
        };
        emit_event(
            event_name,
            json!({
                "commitment_id": challenge.commitment_id.to_string(),
                "challenge_id": challenge.id.to_string(),
                "evaluation_id": challenge.evaluation_id.to_string(),
                "status": status,
                "evidence_preserved": !invalidates_evidence,
                "reserved_claim_epoch": read_challenge_reserved_epoch(challenge.id),
                "completed_at_ns": now_ns.to_string(),
            }),
        );
    }

    fn challenge_view(&self, challenge: &Challenge) -> ChallengeView {
        let mut view = ChallengeView::from(challenge);
        view.completed_at_ns = read_challenge_completion_timestamp(challenge.id).map(U64);
        view.timeout_preserves_evidence = challenge_timeout_preserves_evidence(challenge.id);
        view
    }
}

fn challenge_completion_storage_key(challenge_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(CHALLENGE_COMPLETION_STORAGE_PREFIX.len() + 8);
    key.extend_from_slice(CHALLENGE_COMPLETION_STORAGE_PREFIX);
    key.extend_from_slice(&challenge_id.to_le_bytes());
    key
}

fn reserve_challenge_completion_timestamp(challenge_id: u64) {
    let key = challenge_completion_storage_key(challenge_id);
    if !env::storage_has_key(&key) {
        env::storage_write(&key, &0u64.to_le_bytes());
    }
}

fn record_challenge_completion_timestamp(challenge_id: u64, completed_at_ns: u64) {
    let key = challenge_completion_storage_key(challenge_id);
    if env::storage_has_key(&key) {
        env::storage_write(&key, &completed_at_ns.to_le_bytes());
    }
}

fn read_challenge_completion_timestamp(challenge_id: u64) -> Option<u64> {
    let key = challenge_completion_storage_key(challenge_id);
    let value = env::storage_read(&key)?;
    let bytes: [u8; 8] = value.as_slice().try_into().ok()?;
    let timestamp = u64::from_le_bytes(bytes);
    (timestamp > 0).then_some(timestamp)
}

fn challenge_reserved_epoch_storage_key(challenge_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(CHALLENGE_RESERVED_EPOCH_STORAGE_PREFIX.len() + 8);
    key.extend_from_slice(CHALLENGE_RESERVED_EPOCH_STORAGE_PREFIX);
    key.extend_from_slice(&challenge_id.to_le_bytes());
    key
}

fn reserve_challenge_epoch(challenge_id: u64, epoch: Option<u32>) {
    let key = challenge_reserved_epoch_storage_key(challenge_id);
    if !env::storage_has_key(&key) {
        env::storage_write(&key, &epoch.unwrap_or(u32::MAX).to_le_bytes());
    }
}

fn read_challenge_reserved_epoch(challenge_id: u64) -> Option<u32> {
    let key = challenge_reserved_epoch_storage_key(challenge_id);
    let value = env::storage_read(&key)?;
    let bytes: [u8; 4] = value.as_slice().try_into().ok()?;
    let epoch = u32::from_le_bytes(bytes);
    (epoch != u32::MAX).then_some(epoch)
}

fn challenge_timeout_preserves_evidence(challenge_id: u64) -> bool {
    env::storage_has_key(&challenge_reserved_epoch_storage_key(challenge_id))
}

fn service_policy_storage_key(commitment_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(SERVICE_POLICY_STORAGE_PREFIX.len() + 8);
    key.extend_from_slice(SERVICE_POLICY_STORAGE_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key
}

fn service_report_inbox_storage_key(
    commitment_id: u64,
    evaluation_id: u64,
    source_id: &str,
) -> Vec<u8> {
    let mut key = Vec::with_capacity(SERVICE_REPORT_INBOX_PREFIX.len() + 17 + source_id.len());
    key.extend_from_slice(SERVICE_REPORT_INBOX_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key.extend_from_slice(&evaluation_id.to_le_bytes());
    key.push(source_id.len().min(u8::MAX as usize) as u8);
    key.extend_from_slice(source_id.as_bytes());
    key
}

fn service_report_refund_storage_key(account_id: &near_sdk::AccountId) -> Vec<u8> {
    let account = account_id.as_str().as_bytes();
    let mut key = Vec::with_capacity(SERVICE_REPORT_REFUND_PREFIX.len() + account.len());
    key.extend_from_slice(SERVICE_REPORT_REFUND_PREFIX);
    key.extend_from_slice(account);
    key
}

fn read_service_report_inbox(key: &[u8]) -> Option<ServiceReportInboxEntry> {
    let bytes = env::storage_read(key)?;
    near_sdk::borsh::from_slice(&bytes).ok()
}

fn write_service_report_inbox(key: &[u8], entry: &ServiceReportInboxEntry) {
    let bytes = near_sdk::borsh::to_vec(entry)
        .unwrap_or_else(|_| env::panic_str("failed to serialize staged service report"));
    env::storage_write(key, &bytes);
}

fn read_service_report_refund_credit(account_id: &near_sdk::AccountId) -> Option<u128> {
    let bytes = env::storage_read(&service_report_refund_storage_key(account_id))?;
    let encoded: [u8; 16] = bytes.as_slice().try_into().ok()?;
    Some(u128::from_le_bytes(encoded))
}

fn increase_service_report_refund_credit(account_id: &near_sdk::AccountId, amount: u128) {
    let current = read_service_report_refund_credit(account_id).unwrap_or(0);
    let updated = current
        .checked_add(amount)
        .unwrap_or_else(|| env::panic_str("service report refund credit overflow"));
    env::storage_write(
        &service_report_refund_storage_key(account_id),
        &updated.to_le_bytes(),
    );
}

fn report_storage_bond_bytes(key: &[u8], entry: &ServiceReportInboxEntry) -> u64 {
    let owner_len = entry.submitted_by.as_str().len();
    let value_len = 4usize
        .saturating_add(owner_len)
        .saturating_add(8 + 8 + 16 + 4)
        .saturating_add(entry.report_json.len());
    let total = key
        .len()
        .saturating_add(value_len)
        .saturating_add(SERVICE_REPORT_STORAGE_OVERHEAD_BYTES as usize)
        .saturating_add(SERVICE_REPORT_REFUND_RESERVE_BYTES as usize);
    u64::try_from(total).unwrap_or_else(|_| env::panic_str("service report storage size overflow"))
}

fn service_summary_storage_key(commitment_id: u64, evaluation_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(SERVICE_SUMMARY_STORAGE_PREFIX.len() + 16);
    key.extend_from_slice(SERVICE_SUMMARY_STORAGE_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key.extend_from_slice(&evaluation_id.to_le_bytes());
    key
}

fn service_amendment_storage_key(commitment_id: u64, amendment_id: &str) -> Vec<u8> {
    let mut key =
        Vec::with_capacity(SERVICE_AMENDMENT_STORAGE_PREFIX.len() + 8 + amendment_id.len());
    key.extend_from_slice(SERVICE_AMENDMENT_STORAGE_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key.extend_from_slice(amendment_id.as_bytes());
    key
}

fn service_amendment_latest_storage_key(commitment_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(SERVICE_AMENDMENT_LATEST_PREFIX.len() + 8);
    key.extend_from_slice(SERVICE_AMENDMENT_LATEST_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key
}

fn write_service_amendment(amendment: &ServicePolicyAmendmentView) {
    let bytes = near_sdk::serde_json::to_vec(amendment)
        .unwrap_or_else(|_| env::panic_str("failed to serialize service policy amendment"));
    env::storage_write(
        &service_amendment_storage_key(amendment.commitment_id.0, &amendment.amendment_id),
        &bytes,
    );
}

fn read_service_amendment(
    commitment_id: u64,
    amendment_id: &str,
) -> Option<ServicePolicyAmendmentView> {
    if !is_lower_hex_32(amendment_id) {
        return None;
    }
    let bytes = env::storage_read(&service_amendment_storage_key(commitment_id, amendment_id))?;
    near_sdk::serde_json::from_slice(&bytes).ok()
}

fn write_latest_service_amendment_id(commitment_id: u64, amendment_id: &str) {
    env::storage_write(
        &service_amendment_latest_storage_key(commitment_id),
        amendment_id.as_bytes(),
    );
}

fn read_latest_service_amendment_id(commitment_id: u64) -> Option<String> {
    let bytes = env::storage_read(&service_amendment_latest_storage_key(commitment_id))?;
    String::from_utf8(bytes)
        .ok()
        .filter(|value| is_lower_hex_32(value))
}

fn service_policy_health_start_storage_key(commitment_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(SERVICE_POLICY_HEALTH_START_PREFIX.len() + 8);
    key.extend_from_slice(SERVICE_POLICY_HEALTH_START_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key
}

fn write_service_policy_health_start(commitment_id: u64, timestamp_ns: u64) {
    env::storage_write(
        &service_policy_health_start_storage_key(commitment_id),
        &timestamp_ns.to_le_bytes(),
    );
}

fn read_service_policy_health_start(commitment_id: u64) -> Option<u64> {
    let bytes = env::storage_read(&service_policy_health_start_storage_key(commitment_id))?;
    let encoded: [u8; 8] = bytes.try_into().ok()?;
    Some(u64::from_le_bytes(encoded))
}

fn authority_grant_storage_key(commitment_id: u64, grant_id: &str) -> Vec<u8> {
    let grant_id = decode_32_byte_hex(grant_id).unwrap_or_else(|| {
        env::panic_str("authority grant ID must be 32-byte lowercase hexadecimal")
    });
    let mut key = Vec::with_capacity(AUTHORITY_GRANT_PREFIX.len() + 8 + grant_id.len());
    key.extend_from_slice(AUTHORITY_GRANT_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key.extend_from_slice(&grant_id);
    key
}

fn authority_grant_latest_storage_key(commitment_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(AUTHORITY_GRANT_LATEST_PREFIX.len() + 8);
    key.extend_from_slice(AUTHORITY_GRANT_LATEST_PREFIX);
    key.extend_from_slice(&commitment_id.to_le_bytes());
    key
}

fn write_latest_authority_grant_id(commitment_id: u64, grant_id: &str) {
    env::storage_write(
        &authority_grant_latest_storage_key(commitment_id),
        grant_id.as_bytes(),
    );
}

fn read_latest_authority_grant_id(commitment_id: u64) -> Option<String> {
    let bytes = env::storage_read(&authority_grant_latest_storage_key(commitment_id))?;
    String::from_utf8(bytes)
        .ok()
        .filter(|value| is_lower_hex_32(value))
}

fn write_authority_grant(commitment_id: u64, grant_id: &str, grant: &AuthorityGrantState) {
    let bytes = near_sdk::borsh::to_vec(grant)
        .unwrap_or_else(|_| env::panic_str("failed to serialize authority grant"));
    env::storage_write(
        &authority_grant_storage_key(commitment_id, grant_id),
        &bytes,
    );
}

fn read_authority_grant(commitment_id: u64, grant_id: &str) -> Option<AuthorityGrantState> {
    if !is_lower_hex_32(grant_id) {
        return None;
    }
    let bytes = env::storage_read(&authority_grant_storage_key(commitment_id, grant_id))?;
    near_sdk::borsh::from_slice(&bytes).ok()
}

fn write_service_policy(commitment_id: u64, policy: &ServiceAvailabilityPolicy) {
    let bytes = near_sdk::serde_json::to_vec(policy)
        .unwrap_or_else(|_| env::panic_str("failed to serialize service availability policy"));
    env::storage_write(&service_policy_storage_key(commitment_id), &bytes);
}

fn read_service_policy(commitment_id: u64) -> Option<ServiceAvailabilityPolicy> {
    let bytes = env::storage_read(&service_policy_storage_key(commitment_id))?;
    near_sdk::serde_json::from_slice(&bytes).ok()
}

fn write_service_summary(
    commitment_id: u64,
    evaluation_id: u64,
    summary: &ServiceAvailabilityEvaluationSummary,
) {
    let bytes = near_sdk::serde_json::to_vec(summary)
        .unwrap_or_else(|_| env::panic_str("failed to serialize service evaluation summary"));
    env::storage_write(
        &service_summary_storage_key(commitment_id, evaluation_id),
        &bytes,
    );
}

fn reserve_service_summary(commitment_id: u64, evaluation_id: u64, configured: u8, required: u8) {
    let placeholder = ServiceAvailabilityEvaluationSummary {
        source_counts: ServiceAvailabilitySourceCounts {
            configured,
            valid: u8::MAX,
            up: u8::MAX,
            down: u8::MAX,
            abstained: u8::MAX,
            required,
        },
        corroboration_bps: 10_000,
    };
    write_service_summary(commitment_id, evaluation_id, &placeholder);
}

fn read_service_summary(
    commitment_id: u64,
    evaluation_id: u64,
) -> Option<ServiceAvailabilityEvaluationSummary> {
    let bytes = env::storage_read(&service_summary_storage_key(commitment_id, evaluation_id))?;
    near_sdk::serde_json::from_slice(&bytes).ok()
}

fn service_availability_policy_digest(
    policy: &CommitmentPolicy,
    service_policy: &ServiceAvailabilityPolicy,
) -> [u8; 32] {
    let policy_bytes = near_sdk::borsh::to_vec(policy)
        .unwrap_or_else(|_| env::panic_str("failed to serialize commitment policy"));
    let source_bytes = near_sdk::serde_json::to_vec(service_policy)
        .unwrap_or_else(|_| env::panic_str("failed to serialize service availability policy"));
    let mut digest_input = b"LCP_COMMITMENT_POLICY_V3\0".to_vec();
    digest_input.extend_from_slice(&(policy_bytes.len() as u32).to_le_bytes());
    digest_input.extend_from_slice(&policy_bytes);
    digest_input.extend_from_slice(&(source_bytes.len() as u32).to_le_bytes());
    digest_input.extend_from_slice(&source_bytes);
    env::sha256_array(&digest_input)
}

fn service_source_policy_hash(policy: &ServiceAvailabilityPolicy) -> String {
    let bytes = near_sdk::serde_json::to_vec(policy)
        .unwrap_or_else(|_| env::panic_str("failed to serialize service availability policy"));
    encode_hex(&env::sha256_array(&bytes))
}

fn validate_service_availability_policy(policy: &ServiceAvailabilityPolicy) {
    require!(
        policy.schema == "lcp.service_availability.policy.v1"
            || policy.schema == "lcp.service_availability.policy.v2",
        "unsupported service availability policy schema"
    );
    let transaction_authenticated = policy.schema == "lcp.service_availability.policy.v2";
    require!(
        is_lower_hex_32(&policy.target_id),
        "service target fingerprint must be 64 lowercase hexadecimal characters"
    );
    require!(
        parse_decimal_u64(&policy.max_source_lag_ns)
            .map(|lag| lag > 0)
            .unwrap_or(false),
        "maximum source lag must be a positive canonical decimal u64"
    );
    require!(
        (100..=599).contains(&policy.expected_status_min)
            && policy.expected_status_min <= policy.expected_status_max
            && policy.expected_status_max <= 599
            && policy.max_latency_ms > 0,
        "service response status or latency rule is invalid"
    );
    let source_count = policy.sources.len();
    require!(
        (2..=8).contains(&source_count),
        "service source roster must contain between 2 and 8 operators"
    );
    require!(
        policy.minimum_agreeing_sources > 0
            && usize::from(policy.minimum_agreeing_sources) <= source_count
            && usize::from(policy.minimum_agreeing_sources) * 2 > source_count,
        "minimum agreeing source count must be a strict majority"
    );
    require!(
        policy.minimum_corroboration_bps <= 10_000,
        "minimum corroboration must be between 0 and 10000 basis points"
    );
    let mut prior_source: Option<&str> = None;
    for (index, source) in policy.sources.iter().enumerate() {
        require!(
            valid_service_identifier(&source.source_id)
                && valid_service_identifier(&source.operator_id),
            "source and operator IDs must use lowercase letters, digits, dot, underscore, or hyphen"
        );
        require!(
            prior_source
                .map(|prior| prior < source.source_id.as_str())
                .unwrap_or(true),
            "service sources must be sorted by unique source ID"
        );
        require!(
            !policy.sources[..index]
                .iter()
                .any(|prior| prior.operator_id == source.operator_id),
            "each source must name a distinct operator"
        );
        if transaction_authenticated {
            require!(
                source.public_key_hex.is_none(),
                "transaction-authenticated source policies must not pin wallet keys"
            );
        } else {
            let public_key_hex = source
                .public_key_hex
                .as_deref()
                .unwrap_or_else(|| env::panic_str("legacy source policies require a pinned key"));
            require!(
                !policy.sources[..index]
                    .iter()
                    .any(|prior| prior.public_key_hex.as_deref() == Some(public_key_hex)),
                "each source must use a distinct Ed25519 key"
            );
            require!(
                is_lower_hex_32(public_key_hex),
                "source public keys must be 32-byte lowercase hexadecimal"
            );
        }
        prior_source = Some(&source.source_id);
    }
}

fn valid_service_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn is_lower_hex_32(value: &str) -> bool {
    decode_32_byte_hex(value)
        .map(|decoded| encode_hex(&decoded) == value)
        .unwrap_or(false)
}

fn parse_canonical_heartbeat(evidence: &SignedHeartbeatEvidence) -> HeartbeatPayload {
    require!(
        evidence.payload.len() <= MAX_EVIDENCE_BYTES,
        "heartbeat payload exceeds the 4096-byte limit"
    );
    let payload: HeartbeatPayload = near_sdk::serde_json::from_str(&evidence.payload)
        .unwrap_or_else(|_| env::panic_str("heartbeat payload is malformed"));
    let canonical = near_sdk::serde_json::to_string(&payload)
        .unwrap_or_else(|_| env::panic_str("failed to canonicalize heartbeat payload"));
    require!(
        canonical == evidence.payload,
        "heartbeat payload must use canonical JSON serialization"
    );
    payload
}

fn validate_heartbeat_binding(
    commitment: &Commitment,
    evidence: &SignedHeartbeatEvidence,
    payload: &HeartbeatPayload,
    evaluation_id: u64,
) {
    require!(
        evidence.evidence_type == HEARTBEAT_EVIDENCE_TYPE,
        "unsupported evidence type"
    );
    match commitment.policy.version {
        1 => {
            require!(
                evidence.signature_scheme.is_none()
                    && evidence.nonce_hex.is_none()
                    && evidence.recipient.is_none()
                    && evidence.callback_url.is_none(),
                "v1 evidence cannot include wallet-signature fields"
            );
            let signer = decode_32_byte_hex(&evidence.maintainer_public_key).unwrap_or_else(|| {
                env::panic_str("maintainer public key must be 64 hexadecimal characters")
            });
            require!(
                encode_hex(&signer) == evidence.maintainer_public_key,
                "maintainer public key must use lowercase hexadecimal"
            );
            require!(
                signer == commitment.policy.evidence.maintainer_public_key,
                "heartbeat signer does not match the policy-pinned maintainer key"
            );
            let signature = decode_64_byte_hex(&evidence.signature).unwrap_or_else(|| {
                env::panic_str("heartbeat signature must be 128 hexadecimal characters")
            });
            require!(
                encode_hex(&signature) == evidence.signature,
                "heartbeat signature must use lowercase hexadecimal"
            );
        }
        2 => {
            require!(
                evidence.signature_scheme.as_deref() == Some("near_nep413"),
                "v2 evidence requires the near_nep413 signature scheme"
            );
            let key_bytes = decode_near_ed25519_public_key(&evidence.maintainer_public_key)
                .unwrap_or_else(|| {
                    env::panic_str("maintainer key must be a canonical ed25519 NEAR key")
                });
            require!(
                env::sha256_array(evidence.maintainer_public_key.as_bytes())
                    == commitment.policy.evidence.maintainer_public_key,
                "heartbeat signer does not match the policy-pinned maintainer key"
            );
            require!(
                key_bytes.len() == 32,
                "maintainer key must contain 32 bytes"
            );
            let nonce = evidence.nonce_hex.as_deref().unwrap_or("");
            let nonce_bytes = decode_32_byte_hex(nonce).unwrap_or_else(|| {
                env::panic_str("NEP-413 nonce must be 64 lowercase hexadecimal characters")
            });
            require!(
                encode_hex(&nonce_bytes) == nonce,
                "NEP-413 nonce must use lowercase hexadecimal"
            );
            require!(
                evidence.recipient.as_deref() == Some(env::current_account_id().as_str()),
                "NEP-413 recipient must be this commitment contract"
            );
            let callback_url = evidence.callback_url.as_deref().unwrap_or("");
            require!(
                !callback_url.is_empty() && callback_url.len() <= 2_048,
                "NEP-413 callback URL must be non-empty and at most 2048 bytes"
            );
            let signature = BASE64_STANDARD
                .decode(&evidence.signature)
                .unwrap_or_else(|_| env::panic_str("NEP-413 signature must be base64"));
            require!(
                signature.len() == 64 && BASE64_STANDARD.encode(&signature) == evidence.signature,
                "NEP-413 signature must be a canonical 64-byte Ed25519 signature"
            );
        }
        _ => env::panic_str("unsupported commitment signature policy version"),
    }
    let artifact_hash = decode_32_byte_hex(&evidence.artifact_hash)
        .unwrap_or_else(|| env::panic_str("artifact hash must be 64 hexadecimal characters"));
    require!(
        encode_hex(&artifact_hash) == evidence.artifact_hash,
        "artifact hash must use lowercase hexadecimal"
    );
    require!(
        payload.schema == HEARTBEAT_SCHEMA,
        "unsupported heartbeat schema"
    );
    require!(
        payload.commitment_id == commitment.id.to_string(),
        "heartbeat is bound to a different commitment"
    );
    require!(
        payload.evaluation_id == evaluation_id.to_string(),
        "heartbeat is bound to a different evaluation"
    );
    require!(
        payload.policy_version == commitment.policy.version,
        "heartbeat policy version does not match"
    );
    require!(
        payload.policy_hash == encode_hex(&commitment.policy_hash),
        "heartbeat policy hash does not match"
    );
    require!(
        payload.subject == commitment.subject,
        "heartbeat subject does not match the commitment"
    );
    require!(
        payload.artifact_hash == evidence.artifact_hash,
        "heartbeat artifact hash does not match the evidence envelope"
    );
    require!(
        decode_32_byte_hex(&payload.artifact_hash).is_some(),
        "heartbeat artifact hash must be valid hexadecimal"
    );
}

fn validate_observation_time(commitment: &Commitment, observed_at_ns: u64, now_ns: u64) {
    require!(
        observed_at_ns <= now_ns,
        "heartbeat timestamp cannot be in the future"
    );
    require!(
        now_ns - observed_at_ns <= commitment.policy.temporal.max_source_lag_ns,
        "heartbeat exceeds the maximum source lag"
    );
    require!(
        commitment
            .last_observed_at_ns
            .map(|last_observed_at_ns| observed_at_ns > last_observed_at_ns)
            .unwrap_or(true),
        "heartbeat timestamp must be newer than the last accepted observation"
    );
    let expiry = observed_at_ns
        .checked_add(commitment.policy.temporal.evidence_ttl_ns)
        .unwrap_or_else(|| env::panic_str("heartbeat expiry timestamp overflow"));
    require!(now_ns < expiry, "heartbeat evidence has expired");
}

fn validate_verdict_output(
    commitment: &Commitment,
    request: &EvaluationRequest,
    output: &EvaluationVerdictOutput,
    now_ns: u64,
) -> Option<&'static str> {
    let expected_schema = if request.policy_version == 3 {
        SERVICE_AVAILABILITY_VERDICT_SCHEMA
    } else {
        EVALUATION_VERDICT_SCHEMA
    };
    if output.schema != expected_schema {
        return Some("MALFORMED_VERDICT");
    }
    if output.commitment_id != request.commitment_id.to_string()
        || output.evaluation_id != request.id.to_string()
        || output.policy_version != request.policy_version
        || output.policy_hash != encode_hex(&request.policy_hash)
        || output.input_hash != encode_hex(&request.input_hash)
        || output.evidence_hash != encode_hex(&request.evidence_hash)
        || (request.policy_version != 3
            && output.observed_at_ns != request.observed_at_ns.to_string())
    {
        return Some("VERDICT_BINDING_MISMATCH");
    }
    if request.policy_version == 3 {
        if output.contract_id.as_deref() != Some(env::current_account_id().as_str()) {
            return Some("VERDICT_BINDING_MISMATCH");
        }
        let Some(policy) = read_service_policy(request.commitment_id) else {
            return Some("SERVICE_POLICY_MISSING");
        };
        if output.source_policy_hash.as_deref()
            != Some(service_source_policy_hash(&policy).as_str())
        {
            return Some("SOURCE_POLICY_MISMATCH");
        }
        let (Some(counts), Some(corroboration_bps)) =
            (output.source_counts.as_ref(), output.corroboration_bps)
        else {
            return Some("MISSING_SOURCE_SUMMARY");
        };
        if corroboration_bps > 10_000
            || counts.configured as usize != policy.sources.len()
            || counts.required != policy.minimum_agreeing_sources
            || counts.up > counts.configured
            || counts.down > counts.configured
            || counts.abstained > counts.configured
            || counts.valid > counts.configured
            || u16::from(counts.up) + u16::from(counts.down) + u16::from(counts.abstained)
                != u16::from(counts.valid)
        {
            return Some("INVALID_SOURCE_SUMMARY");
        }
        let expected_bps =
            (u32::from(counts.up.max(counts.down)) * 10_000 / u32::from(counts.configured)) as u16;
        if corroboration_bps != expected_bps {
            return Some("INVALID_SOURCE_SUMMARY");
        }
        let quorum_met = corroboration_bps >= policy.minimum_corroboration_bps;
        let expected_verdict = match (
            counts.up >= counts.required && quorum_met,
            counts.down >= counts.required && quorum_met,
        ) {
            (true, false) => Verdict::Compliant,
            (false, true) => Verdict::NonCompliant,
            _ => Verdict::Inconclusive,
        };
        if output.verdict != expected_verdict {
            return Some("SOURCE_SUMMARY_VERDICT_MISMATCH");
        }
    } else if output.source_counts.is_some()
        || output.corroboration_bps.is_some()
        || output.source_policy_hash.is_some()
        || output.contract_id.is_some()
    {
        return Some("UNEXPECTED_SOURCE_SUMMARY");
    }
    if output.reason_codes.len() > MAX_REASON_CODES
        || output.reason_codes.iter().any(|code| {
            code.is_empty()
                || code.len() > MAX_REASON_CODE_BYTES
                || !code
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
    {
        return Some("INVALID_REASON_CODES");
    }
    let Some(observed_at_ns) = parse_decimal_u64(&output.observed_at_ns) else {
        return Some("INVALID_OBSERVATION_TIMESTAMP");
    };
    if request.policy_version == 3 {
        let Some(policy) = read_service_policy(request.commitment_id) else {
            return Some("SERVICE_POLICY_MISSING");
        };
        let Some(max_source_lag_ns) = parse_decimal_u64(&policy.max_source_lag_ns) else {
            return Some("INVALID_SERVICE_POLICY");
        };
        let inconclusive = output.verdict == Verdict::Inconclusive;
        if observed_at_ns > request.requested_at_ns
            || (inconclusive && observed_at_ns != request.requested_at_ns)
            || (!inconclusive
                && request.requested_at_ns.saturating_sub(observed_at_ns) > max_source_lag_ns)
            || observed_at_ns > now_ns
            || now_ns.saturating_sub(observed_at_ns) > commitment.policy.temporal.max_source_lag_ns
            || observed_at_ns
                .checked_add(commitment.policy.temporal.evidence_ttl_ns)
                .map(|expires_at| now_ns >= expires_at)
                .unwrap_or(true)
            || (!inconclusive
                && commitment
                    .last_observed_at_ns
                    .map(|last_observed_at_ns| observed_at_ns <= last_observed_at_ns)
                    .unwrap_or(false))
        {
            return Some("STALE_OR_INVALID_OBSERVATION");
        }
    } else if observed_at_ns > now_ns
        || now_ns - observed_at_ns > commitment.policy.temporal.max_source_lag_ns
        || request
            .observed_at_ns
            .checked_add(commitment.policy.temporal.evidence_ttl_ns)
            .map(|expires_at| now_ns >= expires_at)
            .unwrap_or(true)
        || commitment
            .last_observed_at_ns
            .map(|last_observed_at_ns| observed_at_ns <= last_observed_at_ns)
            .unwrap_or(false)
    {
        return Some("STALE_OR_INVALID_OBSERVATION");
    }
    None
}

fn parse_decimal_u64(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed.to_string() == value).then_some(parsed)
}

fn parse_near_transaction_hash(value: &str) -> Option<[u8; 32]> {
    let decoded = bs58::decode(value).into_vec().ok()?;
    decoded.try_into().ok()
}

fn decode_near_ed25519_public_key(value: &str) -> Option<Vec<u8>> {
    let encoded = value.strip_prefix("ed25519:")?;
    let decoded = bs58::decode(encoded).into_vec().ok()?;
    if decoded.len() != 32 || bs58::encode(&decoded).into_string() != encoded {
        return None;
    }
    Some(decoded)
}

fn build_policy(args: CommitmentPolicyArgs) -> CommitmentPolicy {
    let temporal = TemporalPolicy {
        initial_window_ns: args.temporal.initial_window_ns.0,
        evidence_ttl_ns: args.temporal.evidence_ttl_ns.0,
        grace_ns: args.temporal.grace_ns.0,
        max_source_lag_ns: args.temporal.max_source_lag_ns.0,
        challenge_window_ns: args.temporal.challenge_window_ns.0,
        resolution_timeout_ns: args.temporal.resolution_timeout_ns.0,
        recovery_allowed: args.temporal.recovery_allowed,
    };
    if let Err(error) = validate_temporal_policy(&temporal) {
        env::panic_str(&format!("invalid temporal policy: {error}"));
    }

    let (version, pinned_key) = match args.evidence.signature_scheme.as_deref() {
        None | Some("ed25519_raw_v1") => {
            require!(
                args.evidence.maintainer_public_key.is_none(),
                "legacy evidence policy cannot include a typed NEAR public key"
            );
            let key = args
                .evidence
                .maintainer_public_key_hex
                .as_deref()
                .unwrap_or("");
            let decoded = decode_32_byte_hex(key).unwrap_or_else(|| {
                env::panic_str("maintainer public key must be 64 hexadecimal characters")
            });
            require!(
                encode_hex(&decoded) == key,
                "maintainer public key must use lowercase hexadecimal"
            );
            (1, decoded)
        }
        Some("near_nep413") => {
            require!(
                args.evidence.maintainer_public_key_hex.is_none(),
                "NEP-413 evidence policy cannot include a legacy hexadecimal key"
            );
            let key = args.evidence.maintainer_public_key.as_deref().unwrap_or("");
            decode_near_ed25519_public_key(key).unwrap_or_else(|| {
                env::panic_str("maintainer key must be a canonical ed25519 NEAR key")
            });
            (2, env::sha256_array(key.as_bytes()))
        }
        Some(_) => env::panic_str("unsupported evidence signature scheme"),
    };
    let evidence = EvidencePolicy {
        maintainer_public_key: pinned_key,
    };
    let evaluator = build_evaluator_policy(args.evaluator);
    let budget = build_budget_policy(args.budget);
    let policy = CommitmentPolicy {
        version,
        temporal,
        evidence,
        evaluator,
        budget,
    };
    validate_commitment_policy(&policy);
    policy
}

fn build_evaluator_policy(args: EvaluatorPolicyArgs) -> EvaluatorPolicy {
    let outlayer_account = args.outlayer_account.to_string();
    require!(
        outlayer_account == "outlayer.testnet" || outlayer_account == "outlayer.near",
        "evaluator account must be outlayer.testnet or outlayer.near"
    );
    require!(
        args.wasm_url.starts_with("https://") && args.wasm_url.len() <= MAX_WASM_URL_BYTES,
        "evaluator WASM URL must be HTTPS and at most 512 bytes"
    );
    require!(
        args.build_target.len() <= MAX_BUILD_TARGET_BYTES
            && (args.build_target == "wasm32-wasip1" || args.build_target == "wasm32-wasip2"),
        "evaluator build target must be wasm32-wasip1 or wasm32-wasip2"
    );
    require!(
        args.max_instructions.0 > 0 && args.max_instructions.0 <= MAX_OUTLAYER_INSTRUCTIONS,
        "max instructions must be between 1 and 500 billion"
    );
    require!(
        args.max_memory_mb > 0 && args.max_memory_mb <= MAX_OUTLAYER_MEMORY_MB,
        "max memory must be between 1 and 4096 MB"
    );
    require!(
        args.max_execution_seconds.0 > 0
            && args.max_execution_seconds.0 <= MAX_OUTLAYER_EXECUTION_SECONDS,
        "max execution time must be between 1 and 180 seconds"
    );
    let minimum_timeout_ns = args
        .max_execution_seconds
        .0
        .checked_mul(1_000_000_000)
        .unwrap_or_else(|| env::panic_str("maximum execution time overflows nanoseconds"));
    require!(
        args.request_timeout_ns.0 >= minimum_timeout_ns,
        "request timeout must cover the maximum execution time"
    );
    require!(
        args.execution_deposit_yocto.0 > 0,
        "evaluator execution deposit must be positive"
    );
    let wasm_sha256 = decode_32_byte_hex(&args.wasm_sha256_hex)
        .unwrap_or_else(|| env::panic_str("WASM digest must be 64 hexadecimal characters"));

    EvaluatorPolicy {
        outlayer_account: args.outlayer_account,
        wasm_url: args.wasm_url,
        wasm_sha256,
        build_target: args.build_target,
        max_instructions: args.max_instructions.0,
        max_memory_mb: args.max_memory_mb,
        max_execution_seconds: args.max_execution_seconds.0,
        request_timeout_ns: args.request_timeout_ns.0,
        execution_deposit_yocto: args.execution_deposit_yocto.0,
    }
}

fn build_budget_policy(args: BudgetPolicyArgs) -> BudgetPolicy {
    require!(args.epoch_ns.0 > 0, "budget epoch must be positive");
    require!(args.max_epochs > 0, "max epochs must be positive");
    require!(
        args.max_epochs <= MAX_PROGRAM_EPOCHS,
        "max epochs cannot exceed the 64-epoch v0.1 limit"
    );
    require!(args.tranche_yocto.0 > 0, "tranche amount must be positive");
    u128::from(args.max_epochs)
        .checked_mul(args.tranche_yocto.0)
        .unwrap_or_else(|| env::panic_str("required escrow calculation overflow"));

    BudgetPolicy {
        sponsor: args.sponsor,
        beneficiary: args.beneficiary,
        epoch_ns: args.epoch_ns.0,
        max_epochs: args.max_epochs,
        tranche_yocto: args.tranche_yocto.0,
    }
}

fn validate_commitment_policy(policy: &CommitmentPolicy) {
    require!(
        policy.temporal.challenge_window_ns < policy.temporal.evidence_ttl_ns,
        "challenge window must end before evidence expires"
    );
    require!(
        policy.temporal.max_source_lag_ns <= policy.temporal.evidence_ttl_ns,
        "maximum source lag cannot exceed evidence TTL"
    );
    let earliest_claim_age = policy
        .temporal
        .max_source_lag_ns
        .checked_add(policy.temporal.challenge_window_ns)
        .unwrap_or_else(|| env::panic_str("challenge window and source lag overflow"));
    require!(
        earliest_claim_age < policy.temporal.evidence_ttl_ns,
        "evidence TTL must exceed maximum source lag plus the challenge window"
    );
}

fn health_of(commitment: &Commitment, now_ns: u64) -> Health {
    let mut snapshot = commitment.temporal_snapshot();
    if commitment.policy.version == 3 {
        if let Some(health_start_ns) = read_service_policy_health_start(commitment.id) {
            snapshot.activated_at_ns = Some(health_start_ns);
        }
    }
    effective_health(&snapshot, &commitment.policy.temporal, now_ns).unwrap_or_else(|error| {
        env::panic_str(&format!("invalid commitment temporal state: {error}"))
    })
}

fn current_epoch_of(commitment: &Commitment, now_ns: u64) -> Option<u64> {
    let activated_at_ns = commitment.activated_at_ns?;
    let elapsed_ns = now_ns.checked_sub(activated_at_ns)?;
    Some(elapsed_ns / commitment.policy.budget.epoch_ns)
}

fn claim_window_for_epoch(
    commitment: &Commitment,
    evaluation: &EvaluationRecord,
    epoch: u32,
) -> Option<(u64, u64)> {
    let activated_at_ns = commitment.activated_at_ns?;
    let epoch_start_ns = activated_at_ns
        .checked_add(u64::from(epoch).checked_mul(commitment.policy.budget.epoch_ns)?)?;
    let epoch_end_ns = epoch_start_ns.checked_add(commitment.policy.budget.epoch_ns)?;
    let challenge_window_end_ns = evaluation
        .accepted_at_ns?
        .checked_add(commitment.policy.temporal.challenge_window_ns)?;
    let evidence_expiry_ns = evaluation
        .observed_at_ns
        .checked_add(commitment.policy.temporal.evidence_ttl_ns)?;
    Some((
        challenge_window_end_ns.max(epoch_start_ns),
        epoch_end_ns.min(evidence_expiry_ns),
    ))
}

fn emit_event(event_name: &str, data: Value) {
    let event = json!({
        "standard": "lcp",
        "version": "1.0.0",
        "event": event_name,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{event}"));
}

fn storage_cost(storage_bytes: u64) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(storage_bytes))
        .unwrap_or_else(|| env::panic_str("storage deposit calculation overflow"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        Nep413ProbeSignature, ProbeObservation, ProbeReportPayload, ServiceAvailabilitySource,
    };
    #[allow(deprecated)]
    use near_sdk::test_utils::testing_env_with_promise_results;
    use near_sdk::{
        test_utils::{accounts, VMContextBuilder},
        testing_env, AccountId, NearToken, PromiseResult,
    };

    const CONTRACT_ID: u64 = 1;
    const EVALUATION_ID: u64 = 1;
    const TRANSFER_ID: u64 = 1;
    const EPOCH: u32 = 0;
    const TRANCHE_AMOUNT: u128 = 10_u128.pow(22);
    const NOW_NS: u64 = 1_000_000_200;
    const PENDING_EVALUATION_ID: u64 = EVALUATION_ID + 1;
    const PENDING_EVALUATION_OBSERVED_AT_NS: u64 = 1_000_000_100;
    const PENDING_EVALUATION_INPUT_HASH: [u8; 32] = [12; 32];
    const PENDING_EVALUATION_EVIDENCE_HASH: [u8; 32] = [13; 32];

    fn context(predecessor: AccountId, attached_deposit: u128) -> near_sdk::VMContext {
        context_at(predecessor, attached_deposit, NOW_NS)
    }

    fn context_at(
        predecessor: AccountId,
        attached_deposit: u128,
        now_ns: u64,
    ) -> near_sdk::VMContext {
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor)
            .block_timestamp(now_ns)
            .attached_deposit(NearToken::from_yoctonear(attached_deposit))
            .build()
    }

    fn contract_with_pending_tranche() -> (Contract, AccountId) {
        testing_env!(context(accounts(0), 0));
        let mut contract = Contract::new();
        let sponsor = accounts(1);
        let maintainer = accounts(2);
        let beneficiary = accounts(3);
        let arbiter = accounts(4);
        let evaluator = accounts(5);
        let evidence_hash = [7; 32];
        let policy_hash = [9; 32];

        let commitment = Commitment {
            id: CONTRACT_ID,
            subject: "failed transfer retry fixture".to_string(),
            creator: sponsor.clone(),
            maintainer,
            arbiter,
            lifecycle: Lifecycle::Active,
            policy: CommitmentPolicy {
                version: 1,
                temporal: TemporalPolicy {
                    initial_window_ns: 1_000_000,
                    evidence_ttl_ns: 1_000_000,
                    grace_ns: 1_000_000,
                    max_source_lag_ns: 100,
                    challenge_window_ns: 100,
                    resolution_timeout_ns: 1_000,
                    recovery_allowed: true,
                },
                evidence: EvidencePolicy {
                    maintainer_public_key: [3; 32],
                },
                evaluator: EvaluatorPolicy {
                    outlayer_account: evaluator,
                    wasm_url: "https://example.invalid/evaluator.wasm".to_string(),
                    wasm_sha256: [4; 32],
                    build_target: "wasm32-wasip2".to_string(),
                    max_instructions: 1_000_000,
                    max_memory_mb: 64,
                    max_execution_seconds: 30,
                    request_timeout_ns: 1_000,
                    execution_deposit_yocto: TRANCHE_AMOUNT,
                },
                budget: BudgetPolicy {
                    sponsor,
                    beneficiary: beneficiary.clone(),
                    epoch_ns: 10_000_000_000,
                    max_epochs: 1,
                    tranche_yocto: TRANCHE_AMOUNT,
                },
            },
            policy_hash,
            activated_at_ns: Some(1_000_000_000),
            last_good: Some(GoodObservation {
                evaluation_id: EVALUATION_ID,
                evidence_hash,
                observed_at_ns: 1_000_000_000,
                accepted_at_ns: 1_000_000_000,
            }),
            last_observed_at_ns: Some(1_000_000_000),
            negative_since_ns: None,
            pending_evaluation_id: None,
            active_challenge_id: None,
            breach_latched: false,
            escrow_funded_yocto: TRANCHE_AMOUNT,
            escrow_paid_yocto: 0,
            escrow_refunded_yocto: 0,
            escrow_pending_yocto: TRANCHE_AMOUNT,
            operations_funded_yocto: 0,
            operations_authorized_spend_yocto: 0,
            storage_deposit_yocto: 0,
            next_evaluation_id: EVALUATION_ID + 1,
            challenge_count: 0,
            pending_transfer_count: 1,
        };

        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.evaluation_records.insert(
            (CONTRACT_ID, EVALUATION_ID),
            EvaluationRecord {
                request_id: EVALUATION_ID,
                commitment_id: CONTRACT_ID,
                request_transaction_hash: Some([0; 32]),
                status: EvaluationStatus::Accepted,
                verdict: Some(Verdict::Compliant),
                reason_codes: vec!["SIGNATURE_VALID".to_string()],
                input_hash: [5; 32],
                evidence_hash,
                observed_at_ns: 1_000_000_000,
                accepted_at_ns: Some(1_000_000_000),
                policy_hash,
                output_hash: Some([6; 32]),
            },
        );
        contract.tranches.insert(
            (CONTRACT_ID, EPOCH),
            Tranche {
                commitment_id: CONTRACT_ID,
                epoch: EPOCH,
                amount_yocto: TRANCHE_AMOUNT,
                status: TrancheStatus::Pending,
                transfer_id: Some(TRANSFER_ID),
            },
        );
        contract.pending_transfers.insert(
            TRANSFER_ID,
            PendingTransfer {
                id: TRANSFER_ID,
                commitment_id: CONTRACT_ID,
                kind: TransferKind::Tranche,
                epoch: Some(EPOCH),
                recipient: beneficiary.clone(),
                amount_yocto: TRANCHE_AMOUNT,
            },
        );
        contract.next_transfer_id = TRANSFER_ID;
        contract.commitments.flush();
        contract.evaluation_records.flush();
        contract.tranches.flush();
        contract.pending_transfers.flush();

        (contract, beneficiary)
    }

    fn contract_with_pending_evaluation() -> Contract {
        let (mut contract, _) = contract_with_pending_tranche();
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.pending_evaluation_id = Some(PENDING_EVALUATION_ID);
        commitment.next_evaluation_id = PENDING_EVALUATION_ID + 1;
        contract.commitments.insert(CONTRACT_ID, commitment.clone());

        let request = EvaluationRequest {
            id: PENDING_EVALUATION_ID,
            commitment_id: CONTRACT_ID,
            policy_version: commitment.policy.version,
            policy_hash: commitment.policy_hash,
            input_hash: PENDING_EVALUATION_INPUT_HASH,
            evidence_hash: PENDING_EVALUATION_EVIDENCE_HASH,
            observed_at_ns: PENDING_EVALUATION_OBSERVED_AT_NS,
            requested_at_ns: NOW_NS,
            timeout_at_ns: NOW_NS + 1_000,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
        };
        let record = EvaluationRecord {
            request_id: PENDING_EVALUATION_ID,
            commitment_id: CONTRACT_ID,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
            verdict: Some(Verdict::NonCompliant),
            reason_codes: vec!["X".repeat(MAX_REASON_CODE_BYTES); MAX_REASON_CODES],
            input_hash: PENDING_EVALUATION_INPUT_HASH,
            evidence_hash: PENDING_EVALUATION_EVIDENCE_HASH,
            observed_at_ns: PENDING_EVALUATION_OBSERVED_AT_NS,
            accepted_at_ns: Some(0),
            policy_hash: commitment.policy_hash,
            output_hash: Some([0; 32]),
        };

        let key = (CONTRACT_ID, PENDING_EVALUATION_ID);
        contract.evaluation_requests.insert(key, request);
        contract.evaluation_records.insert(key, record);
        contract.commitments.flush();
        contract.evaluation_requests.flush();
        contract.evaluation_records.flush();
        contract
    }

    fn callback_verdict(evaluation_id: &str) -> Vec<u8> {
        near_sdk::serde_json::to_vec(&json!({
            "schema": EVALUATION_VERDICT_SCHEMA,
            "request_transaction_hash": bs58::encode([14; 32]).into_string(),
            "commitment_id": CONTRACT_ID.to_string(),
            "evaluation_id": evaluation_id,
            "policy_version": 1,
            "policy_hash": encode_hex(&[9; 32]),
            "input_hash": encode_hex(&PENDING_EVALUATION_INPUT_HASH),
            "evidence_hash": encode_hex(&PENDING_EVALUATION_EVIDENCE_HASH),
            "observed_at_ns": PENDING_EVALUATION_OBSERVED_AT_NS.to_string(),
            "verdict": "Compliant",
            "reason_codes": ["SIGNATURE_VALID", "ARTIFACT_HASH_FORMAT_VALID"],
        }))
        .unwrap()
    }

    fn service_policy_fixture() -> ServiceAvailabilityPolicy {
        ServiceAvailabilityPolicy {
            schema: "lcp.service_availability.policy.v1".to_string(),
            target_id: "a".repeat(64),
            max_source_lag_ns: "100".to_string(),
            expected_status_min: 200,
            expected_status_max: 299,
            max_latency_ms: 500,
            minimum_agreeing_sources: 2,
            minimum_corroboration_bps: 6_000,
            sources: (0..3)
                .map(|index| ServiceAvailabilitySource {
                    source_id: format!("source-{index}"),
                    operator_id: format!("operator-{index}"),
                    public_key_hex: Some(format!("{:02x}", index + 1).repeat(32)),
                })
                .collect(),
        }
    }

    fn service_commitment_args() -> CreateServiceAvailabilityCommitmentArgs {
        CreateServiceAvailabilityCommitmentArgs {
            subject: "Community service health pilot".to_string(),
            maintainer: accounts(2),
            arbiter: accounts(4),
            policy: CommitmentPolicyArgs {
                temporal: crate::models::TemporalPolicyArgs {
                    initial_window_ns: U64(1_000),
                    evidence_ttl_ns: U64(1_000),
                    grace_ns: U64(1_000),
                    max_source_lag_ns: U64(100),
                    challenge_window_ns: U64(100),
                    resolution_timeout_ns: U64(1_000),
                    recovery_allowed: true,
                },
                evidence: crate::models::EvidencePolicyArgs {
                    signature_scheme: Some("near_nep413".to_string()),
                    maintainer_public_key_hex: None,
                    maintainer_public_key: Some(format!(
                        "ed25519:{}",
                        bs58::encode([7; 32]).into_string()
                    )),
                },
                evaluator: EvaluatorPolicyArgs {
                    outlayer_account: "outlayer.testnet".parse().unwrap(),
                    wasm_url: "https://example.org/service-evaluator.wasm".to_string(),
                    wasm_sha256_hex: "b".repeat(64),
                    build_target: "wasm32-wasip2".to_string(),
                    max_instructions: U64(1_000_000),
                    max_memory_mb: 64,
                    max_execution_seconds: U64(1),
                    request_timeout_ns: U64(1_000_000_000),
                    execution_deposit_yocto: U128(TRANCHE_AMOUNT),
                },
                budget: BudgetPolicyArgs {
                    sponsor: accounts(1),
                    beneficiary: accounts(3),
                    epoch_ns: U64(1_000_000),
                    max_epochs: 3,
                    tranche_yocto: U128(TRANCHE_AMOUNT),
                },
            },
            service_availability: service_policy_fixture(),
        }
    }

    fn transaction_authenticated_service_commitment_args() -> CreateServiceAvailabilityCommitmentArgs
    {
        let mut args = service_commitment_args();
        args.subject = "LCP Operator Inbox QA 2026-11-11".to_string();
        args.maintainer = "wasabinetwork.testnet".parse().unwrap();
        args.arbiter = "lcparbiter.testnet".parse().unwrap();
        args.policy.temporal.initial_window_ns = U64(1_800_000_000_000);
        args.policy.temporal.evidence_ttl_ns = U64(900_000_000_000);
        args.policy.temporal.grace_ns = U64(120_000_000_000);
        args.policy.temporal.max_source_lag_ns = U64(600_000_000_000);
        args.policy.temporal.challenge_window_ns = U64(60_000_000_000);
        args.policy.temporal.resolution_timeout_ns = U64(120_000_000_000);
        args.policy.evaluator.wasm_url = "https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm".to_string();
        args.policy.evaluator.wasm_sha256_hex =
            "908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611".to_string();
        args.policy.evaluator.max_instructions = U64(1_000_000_000);
        args.policy.evaluator.max_execution_seconds = U64(10);
        args.policy.evaluator.request_timeout_ns = U64(30_000_000_000);
        args.policy.evaluator.execution_deposit_yocto = U128(10_u128.pow(22));
        args.policy.budget.sponsor = "wasabinetwork.testnet".parse().unwrap();
        args.policy.budget.beneficiary = "wasabinetwork.testnet".parse().unwrap();
        args.policy.budget.epoch_ns = U64(300_000_000_000);
        args.policy.budget.max_epochs = 3;
        args.policy.budget.tranche_yocto = U128(10_u128.pow(22));
        args.service_availability.schema = "lcp.service_availability.policy.v2".to_string();
        args.service_availability.target_id =
            "3f2c4dc31f5302b158680d5cd3d1cc8d533733ff992af0947b67efc8e7b697a5".to_string();
        args.service_availability.max_source_lag_ns = "600000000000".to_string();
        args.service_availability.expected_status_min = 200;
        args.service_availability.expected_status_max = 299;
        args.service_availability.max_latency_ms = 1_500;
        args.service_availability.minimum_agreeing_sources = 2;
        args.service_availability.minimum_corroboration_bps = 6_000;
        args.service_availability.sources = vec![
            ServiceAvailabilitySource {
                source_id: "operator-a".to_string(),
                operator_id: "wasabinetwork.testnet".to_string(),
                public_key_hex: None,
            },
            ServiceAvailabilitySource {
                source_id: "operator-b".to_string(),
                operator_id: "lcptester.testnet".to_string(),
                public_key_hex: None,
            },
        ];
        args
    }

    fn report_inbox_fixture() -> (Contract, U64, Vec<AccountId>) {
        let mut args = service_commitment_args();
        let operators: Vec<AccountId> = [
            "operator-a.testnet",
            "operator-b.testnet",
            "operator-c.testnet",
        ]
        .map(|account| account.parse().unwrap())
        .to_vec();
        for (index, source) in args.service_availability.sources.iter_mut().enumerate() {
            source.operator_id = operators[index].to_string();
            source.public_key_hex = Some(format!("{:02x}", index + 21).repeat(32));
        }

        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        let mut contract = Contract::new();
        let id = contract.create_service_availability_commitment(args);
        let mut commitment = contract.commitments.get(&id.0).unwrap().clone();
        commitment.lifecycle = Lifecycle::Active;
        commitment.activated_at_ns = Some(NOW_NS - 10);
        commitment.operations_funded_yocto =
            commitment.policy.evaluator.execution_deposit_yocto * 2;
        contract.commitments.insert(id.0, commitment);
        contract.commitments.flush();
        (contract, id, operators)
    }

    fn transaction_authenticated_inbox_fixture() -> (Contract, U64, Vec<AccountId>) {
        let mut args = service_commitment_args();
        args.service_availability.schema = "lcp.service_availability.policy.v2".to_string();
        let operators: Vec<AccountId> = [
            "operator-a.testnet",
            "operator-b.testnet",
            "operator-c.testnet",
        ]
        .map(|account| account.parse().unwrap())
        .to_vec();
        for (index, source) in args.service_availability.sources.iter_mut().enumerate() {
            source.operator_id = operators[index].to_string();
            source.public_key_hex = None;
        }

        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        let mut contract = Contract::new();
        let id = contract.create_service_availability_commitment(args);
        let mut commitment = contract.commitments.get(&id.0).unwrap().clone();
        commitment.lifecycle = Lifecycle::Active;
        commitment.activated_at_ns = Some(NOW_NS - 10);
        commitment.operations_funded_yocto =
            commitment.policy.evaluator.execution_deposit_yocto * 2;
        contract.commitments.insert(id.0, commitment);
        contract.commitments.flush();
        (contract, id, operators)
    }

    fn transaction_authenticated_probe_report(
        contract: &Contract,
        commitment_id: U64,
        source_index: usize,
        observed_at_ns: u64,
    ) -> SignedProbeReport {
        let commitment = contract.commitments.get(&commitment_id.0).unwrap().clone();
        let policy = contract
            .get_service_availability_policy(commitment_id)
            .unwrap();
        let source = &policy.sources[source_index];
        SignedProbeReport {
            payload: ProbeReportPayload {
                schema: "lcp.service_availability.report.v1".to_string(),
                contract_id: accounts(0).to_string(),
                commitment_id: commitment_id.0.to_string(),
                evaluation_id: commitment.next_evaluation_id.to_string(),
                policy_version: 3,
                policy_hash: encode_hex(&commitment.policy_hash),
                source_policy_hash: service_source_policy_hash(&policy),
                source_id: source.source_id.clone(),
                operator_id: source.operator_id.clone(),
                target_id: policy.target_id,
                observed_at_ns: observed_at_ns.to_string(),
                observation: ProbeObservation::HttpResponse {
                    status_code: 200,
                    latency_ms: 25,
                    tls_verified: true,
                },
            },
            signature_hex: None,
            wallet_signature: None,
            submitted_by: None,
        }
    }

    fn wallet_signed_probe_report(
        contract: &Contract,
        commitment_id: U64,
        source_index: usize,
        observed_at_ns: u64,
        nonce_byte: u8,
    ) -> SignedProbeReport {
        let commitment = contract.commitments.get(&commitment_id.0).unwrap().clone();
        let policy = contract
            .get_service_availability_policy(commitment_id)
            .unwrap();
        let source = &policy.sources[source_index];
        let public_key_bytes =
            decode_32_byte_hex(source.public_key_hex.as_deref().unwrap()).unwrap();
        SignedProbeReport {
            payload: ProbeReportPayload {
                schema: "lcp.service_availability.report.v1".to_string(),
                contract_id: accounts(0).to_string(),
                commitment_id: commitment_id.0.to_string(),
                evaluation_id: commitment.next_evaluation_id.to_string(),
                policy_version: 3,
                policy_hash: encode_hex(&commitment.policy_hash),
                source_policy_hash: service_source_policy_hash(&policy),
                source_id: source.source_id.clone(),
                operator_id: source.operator_id.clone(),
                target_id: policy.target_id,
                observed_at_ns: observed_at_ns.to_string(),
                observation: ProbeObservation::HttpResponse {
                    status_code: 200,
                    latency_ms: 25,
                    tls_verified: true,
                },
            },
            signature_hex: None,
            wallet_signature: Some(Nep413ProbeSignature {
                account_id: source.operator_id.clone(),
                public_key: format!("ed25519:{}", bs58::encode(public_key_bytes).into_string()),
                signature: BASE64_STANDARD.encode([nonce_byte; 64]),
                nonce_hex: format!("{:02x}", nonce_byte).repeat(32),
                recipient: accounts(0).to_string(),
                callback_url: "https://lcp.example.org".to_string(),
            }),
            submitted_by: None,
        }
    }

    fn submit_inbox_report(
        contract: &mut Contract,
        commitment_id: U64,
        operator: AccountId,
        report: SignedProbeReport,
    ) -> u128 {
        testing_env!(context_at(operator.clone(), 0, NOW_NS));
        let deposit = contract
            .get_service_report_storage_deposit(commitment_id, report.clone())
            .0;
        testing_env!(context_at(operator, deposit, NOW_NS));
        contract.submit_service_report(commitment_id, report).0
    }

    fn active_service_commitment() -> (Contract, U64) {
        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        let mut contract = Contract::new();
        let id = contract.create_service_availability_commitment(service_commitment_args());
        let mut commitment = contract.commitments.get(&id.0).unwrap().clone();
        commitment.lifecycle = Lifecycle::Active;
        commitment.activated_at_ns = Some(NOW_NS - 500);
        commitment.escrow_funded_yocto =
            TRANCHE_AMOUNT * u128::from(commitment.policy.budget.max_epochs);
        let evidence_hash = [21; 32];
        commitment.last_good = Some(GoodObservation {
            evaluation_id: EVALUATION_ID,
            evidence_hash,
            observed_at_ns: NOW_NS - 50,
            accepted_at_ns: NOW_NS - 50,
        });
        commitment.last_observed_at_ns = Some(NOW_NS - 50);
        contract.commitments.insert(id.0, commitment.clone());
        contract.evaluation_records.insert(
            (id.0, EVALUATION_ID),
            EvaluationRecord {
                request_id: EVALUATION_ID,
                commitment_id: id.0,
                request_transaction_hash: Some([0; 32]),
                status: EvaluationStatus::Accepted,
                verdict: Some(Verdict::Compliant),
                reason_codes: vec!["SOURCE_QUORUM_MET".to_string()],
                input_hash: [22; 32],
                evidence_hash,
                observed_at_ns: NOW_NS - 50,
                accepted_at_ns: Some(NOW_NS - 50),
                policy_hash: commitment.policy_hash,
                output_hash: Some([23; 32]),
            },
        );
        contract.commitments.flush();
        contract.evaluation_records.flush();
        (contract, id)
    }

    fn changed_service_policy() -> ServiceAvailabilityPolicy {
        let mut policy = service_policy_fixture();
        policy.target_id = "c".repeat(64);
        policy.max_source_lag_ns = "100".to_string();
        policy
    }

    fn create_authority_grant() -> (Contract, String) {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        let grant_id = "a".repeat(64);
        testing_env!(context(accounts(1), 10_u128.pow(25)));
        contract.create_bounded_payout_authority_grant(
            U64(CONTRACT_ID),
            grant_id.clone(),
            "adapter.testnet".parse().unwrap(),
            accounts(3),
            U128(TRANCHE_AMOUNT),
            U128(TRANCHE_AMOUNT),
            U64(NOW_NS + 1_000_000_000),
        );
        (contract, grant_id)
    }

    fn contract_with_pending_service_evaluation() -> Contract {
        let mut contract = contract_with_pending_evaluation();
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        let service_policy = service_policy_fixture();
        commitment.policy.version = 3;
        commitment.policy_hash =
            service_availability_policy_digest(&commitment.policy, &service_policy);
        contract.commitments.insert(CONTRACT_ID, commitment.clone());
        write_service_policy(CONTRACT_ID, &service_policy);
        reserve_service_summary(
            CONTRACT_ID,
            PENDING_EVALUATION_ID,
            service_policy.sources.len() as u8,
            service_policy.minimum_agreeing_sources,
        );

        let key = (CONTRACT_ID, PENDING_EVALUATION_ID);
        let mut request = contract.evaluation_requests.get(&key).unwrap().clone();
        request.policy_version = 3;
        request.policy_hash = commitment.policy_hash;
        contract.evaluation_requests.insert(key, request);
        let mut record = contract.evaluation_records.get(&key).unwrap().clone();
        record.policy_hash = commitment.policy_hash;
        contract.evaluation_records.insert(key, record);
        contract.commitments.flush();
        contract.evaluation_requests.flush();
        contract.evaluation_records.flush();
        contract
    }

    fn callback_service_verdict(
        contract: &Contract,
        verdict: &str,
        observed_at_ns: u64,
        up: u8,
        down: u8,
        abstained: u8,
        corroboration_bps: u16,
    ) -> Vec<u8> {
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        let service_policy = service_policy_fixture();
        near_sdk::serde_json::to_vec(&json!({
            "schema": SERVICE_AVAILABILITY_VERDICT_SCHEMA,
            "request_transaction_hash": bs58::encode([14; 32]).into_string(),
            "contract_id": accounts(0).to_string(),
            "commitment_id": CONTRACT_ID.to_string(),
            "evaluation_id": PENDING_EVALUATION_ID.to_string(),
            "policy_version": 3,
            "policy_hash": encode_hex(&commitment.policy_hash),
            "source_policy_hash": service_source_policy_hash(&service_policy),
            "input_hash": encode_hex(&PENDING_EVALUATION_INPUT_HASH),
            "evidence_hash": encode_hex(&PENDING_EVALUATION_EVIDENCE_HASH),
            "observed_at_ns": observed_at_ns.to_string(),
            "verdict": verdict,
            "reason_codes": ["SOURCE_QUORUM_NOT_MET"],
            "source_counts": {
                "configured": 3,
                "valid": up + down + abstained,
                "up": up,
                "down": down,
                "abstained": abstained,
                "required": 2,
            },
            "corroboration_bps": corroboration_bps,
        }))
        .unwrap()
    }

    fn add_open_challenge(contract: &mut Contract) {
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        let opened_at_ns = 1_000_000_050;
        let reserved_epoch =
            contract.challenge_claimable_epoch_at_open(&commitment, EVALUATION_ID, opened_at_ns);
        commitment.active_challenge_id = Some(TRANSFER_ID);
        commitment.challenge_count = 1;
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.challenges.insert(
            TRANSFER_ID,
            Challenge {
                id: TRANSFER_ID,
                commitment_id: CONTRACT_ID,
                evaluation_id: EVALUATION_ID,
                challenger: accounts(1),
                reason_hash: [8; 32],
                opened_at_ns,
                resolution_deadline_ns: NOW_NS + 1_000,
                status: ChallengeStatus::Open,
            },
        );
        reserve_challenge_completion_timestamp(TRANSFER_ID);
        reserve_challenge_epoch(TRANSFER_ID, reserved_epoch);
        contract.commitments.flush();
        contract.challenges.flush();
    }

    fn clear_pending_tranche(contract: &mut Contract) {
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.escrow_pending_yocto = 0;
        commitment.pending_transfer_count = 0;
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.tranches.remove(&(CONTRACT_ID, EPOCH));
        contract.pending_transfers.remove(&TRANSFER_ID);
        contract.commitments.flush();
        contract.tranches.flush();
        contract.pending_transfers.flush();
    }

    fn contract_with_pending_refund() -> Contract {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.lifecycle = Lifecycle::Closed;
        commitment.escrow_funded_yocto = TRANCHE_AMOUNT * 2;
        commitment.escrow_pending_yocto = TRANCHE_AMOUNT;
        commitment.pending_transfer_count = 1;
        contract.commitments.insert(CONTRACT_ID, commitment);
        let refund_id = TRANSFER_ID + 1;
        contract.pending_transfers.insert(
            refund_id,
            PendingTransfer {
                id: refund_id,
                commitment_id: CONTRACT_ID,
                kind: TransferKind::Refund,
                epoch: None,
                recipient: accounts(1),
                amount_yocto: TRANCHE_AMOUNT,
            },
        );
        contract.next_transfer_id = refund_id;
        contract.commitments.flush();
        contract.pending_transfers.flush();
        contract
    }

    fn set_breached_recovery_policy(contract: &mut Contract, recovery_allowed: bool) {
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.policy.temporal.recovery_allowed = recovery_allowed;
        commitment.negative_since_ns = Some(NOW_NS - commitment.policy.temporal.grace_ns - 1);
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.commitments.flush();
    }

    #[test]
    fn challenge_completion_timestamp_slot_is_reserved_and_reused() {
        testing_env!(context(accounts(0), 0));
        let challenge_id = TRANSFER_ID + 10;
        let key = challenge_completion_storage_key(challenge_id);
        assert!(!env::storage_has_key(&key));
        let storage_before_reservation = env::storage_usage();

        reserve_challenge_completion_timestamp(challenge_id);

        assert!(env::storage_usage() > storage_before_reservation);
        assert_eq!(read_challenge_completion_timestamp(challenge_id), None);
        let storage_before_completion = env::storage_usage();

        record_challenge_completion_timestamp(challenge_id, NOW_NS);

        assert_eq!(env::storage_usage(), storage_before_completion);
        assert_eq!(
            read_challenge_completion_timestamp(challenge_id),
            Some(NOW_NS)
        );
    }

    #[test]
    fn service_availability_commitment_keeps_v3_policy_in_a_sidecar() {
        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        let mut contract = Contract::new();
        let args = service_commitment_args();
        let expected_source_policy = args.service_availability.clone();
        let id = contract.create_service_availability_commitment(args);

        let commitment = contract.commitments.get(&id.0).unwrap();
        assert_eq!(commitment.policy.version, 3);
        assert_eq!(
            commitment.policy_hash,
            service_availability_policy_digest(&commitment.policy, &expected_source_policy)
        );
        assert!(commitment.storage_deposit_yocto > 0);
        assert_eq!(
            contract
                .get_service_availability_policy(id)
                .unwrap()
                .target_id,
            expected_source_policy.target_id
        );
        assert_eq!(contract.get_policy(id).unwrap().version, 3);
        assert!(env::storage_has_key(&service_policy_storage_key(id.0)));

        assert_eq!(
            near_sdk::borsh::to_vec(&Verdict::Compliant).unwrap(),
            vec![0]
        );
        assert_eq!(
            near_sdk::borsh::to_vec(&Verdict::NonCompliant).unwrap(),
            vec![1]
        );
        assert_eq!(
            near_sdk::borsh::to_vec(&Verdict::Inconclusive).unwrap(),
            vec![2]
        );
    }

    #[test]
    fn transaction_authenticated_service_commitment_fits_conservative_storage_deposit() {
        let args = transaction_authenticated_service_commitment_args();

        let attached = 5 * 10_u128.pow(22); // 0.05 NEAR
        testing_env!(context("wasabinetwork.testnet".parse().unwrap(), attached));
        let mut contract = Contract::new();
        let id = contract.create_service_availability_commitment(args);
        let commitment = contract.commitments.get(&id.0).unwrap();

        assert!(commitment.storage_deposit_yocto > 0);
        assert!(commitment.storage_deposit_yocto <= attached);
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn transaction_authenticated_service_commitment_rejects_old_point_zero_one_storage_default() {
        let args = transaction_authenticated_service_commitment_args();

        testing_env!(context(
            "wasabinetwork.testnet".parse().unwrap(),
            10_u128.pow(22)
        ));
        let mut contract = Contract::new();
        contract.create_service_availability_commitment(args);
    }

    #[test]
    fn service_report_inbox_accepts_wallet_bound_report_and_refunds_replacement() {
        let (mut contract, id, operators) = report_inbox_fixture();
        let first = wallet_signed_probe_report(&contract, id, 0, NOW_NS - 1, 11);
        assert!(near_sdk::serde_json::to_vec(&first).unwrap().len() < MAX_SERVICE_REPORT_BYTES);
        let first_bond = submit_inbox_report(&mut contract, id, operators[0].clone(), first);
        assert!(first_bond > 0);
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            0
        );

        let replacement = wallet_signed_probe_report(&contract, id, 0, NOW_NS - 1, 12);
        let replacement_bond =
            submit_inbox_report(&mut contract, id, operators[0].clone(), replacement);
        assert!(replacement_bond > 0);
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            first_bond
        );
        let staged = contract.get_service_report_inbox(id, U64(1));
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].submitted_by, operators[0]);
        assert!(!staged[0].expired);
        assert_eq!(
            staged[0]
                .report
                .wallet_signature
                .as_ref()
                .unwrap()
                .nonce_hex,
            "0c".repeat(32)
        );

        testing_env!(context_at(operators[0].clone(), 0, NOW_NS));
        contract.withdraw_service_report_refund();
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            0
        );
        testing_env_with_promise_results(context_at(accounts(0), 0, NOW_NS), PromiseResult::Failed);
        contract.on_service_report_refund(operators[0].clone(), U128(first_bond));
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            first_bond
        );
        testing_env!(context_at(operators[0].clone(), 0, NOW_NS));
        contract.withdraw_service_report_refund();
        testing_env_with_promise_results(
            context_at(accounts(0), 0, NOW_NS),
            PromiseResult::Successful(Vec::new()),
        );
        contract.on_service_report_refund(operators[0].clone(), U128(first_bond));
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            0
        );
    }

    #[test]
    #[should_panic(expected = "this exact signed report is already staged")]
    fn service_report_inbox_rejects_exact_replay() {
        let (mut contract, id, operators) = report_inbox_fixture();
        let report = wallet_signed_probe_report(&contract, id, 0, NOW_NS - 1, 11);
        let bond = submit_inbox_report(&mut contract, id, operators[0].clone(), report.clone());
        testing_env!(context_at(operators[0].clone(), bond, NOW_NS));
        contract.submit_service_report(id, report);
    }

    #[test]
    #[should_panic(expected = "service report exceeds the 4096-byte inbox limit")]
    fn service_report_inbox_rejects_oversized_reports() {
        let (mut contract, id, operators) = report_inbox_fixture();
        let mut report = wallet_signed_probe_report(&contract, id, 0, NOW_NS - 1, 11);
        report.payload.observation = ProbeObservation::SourceError {
            code: "x".repeat(MAX_SERVICE_REPORT_BYTES),
        };
        submit_inbox_report(&mut contract, id, operators[0].clone(), report);
    }

    #[test]
    fn service_report_inbox_reclaim_and_evaluation_credit_original_operators() {
        let (mut contract, id, operators) = report_inbox_fixture();
        let report_a = wallet_signed_probe_report(&contract, id, 0, NOW_NS - 1, 11);
        let report_b = wallet_signed_probe_report(&contract, id, 1, NOW_NS - 1, 12);
        let bond_a = submit_inbox_report(&mut contract, id, operators[0].clone(), report_a.clone());
        let bond_b = submit_inbox_report(&mut contract, id, operators[1].clone(), report_b);

        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        let evaluation_id = contract.request_service_evaluation_from_inbox(id);
        assert_eq!(evaluation_id, U64(1));
        assert_eq!(
            contract
                .commitments
                .get(&id.0)
                .unwrap()
                .pending_evaluation_id,
            Some(1)
        );
        assert!(contract
            .get_service_report_inbox(id, evaluation_id)
            .is_empty());
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            bond_a
        );
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[1].clone())
                .0,
            bond_b
        );
    }

    #[test]
    fn transaction_authenticated_inbox_binds_operator_transaction_to_evaluation() {
        let (mut contract, id, operators) = transaction_authenticated_inbox_fixture();
        let report = transaction_authenticated_probe_report(&contract, id, 0, NOW_NS - 1);
        let bond = submit_inbox_report(&mut contract, id, operators[0].clone(), report);
        let staged = contract.get_service_report_inbox(id, U64(1));
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].submitted_by, operators[0]);
        assert!(staged[0].report.submitted_by.is_none());

        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        assert_eq!(contract.request_service_evaluation_from_inbox(id), U64(1));
        assert_eq!(
            contract
                .commitments
                .get(&id.0)
                .unwrap()
                .pending_evaluation_id,
            Some(1)
        );
        assert!(contract.get_service_report_inbox(id, U64(1)).is_empty());
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[0].clone())
                .0,
            bond
        );
    }

    #[test]
    #[should_panic(
        expected = "transaction-authenticated reports must be requested from the NEAR inbox"
    )]
    fn transaction_authenticated_reports_cannot_bypass_inbox_provenance() {
        let (mut contract, id, operators) = transaction_authenticated_inbox_fixture();
        let mut report = transaction_authenticated_probe_report(&contract, id, 0, NOW_NS - 1);
        report.submitted_by = Some(operators[0].to_string());
        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        contract.request_service_evaluation(id, vec![report]);
    }

    #[test]
    fn expired_service_report_can_be_reclaimed_by_any_account() {
        let (mut contract, id, operators) = report_inbox_fixture();
        let report_c = wallet_signed_probe_report(&contract, id, 2, NOW_NS - 1, 13);
        let bond_c = submit_inbox_report(&mut contract, id, operators[2].clone(), report_c);
        testing_env!(context_at(
            "reclaimer.testnet".parse().unwrap(),
            0,
            NOW_NS + 99
        ));
        assert!(contract.reclaim_service_report(id, U64(1), "source-2".to_string()));
        assert_eq!(
            contract
                .get_service_report_refund_balance(operators[2].clone())
                .0,
            bond_c
        );
        assert!(!contract.reclaim_service_report(id, U64(1), "source-2".to_string()));
    }

    #[test]
    fn service_policy_amendment_requires_each_party_and_resets_evidence_clock() {
        let (mut contract, id) = active_service_commitment();
        let original_hash = contract.commitments.get(&id.0).unwrap().policy_hash;
        let effective_at_ns = NOW_NS + 100;
        let expires_at_ns = effective_at_ns + 10_000;
        let amendment_id = "d".repeat(64);

        testing_env!(context(accounts(1), 10_u128.pow(25)));
        contract.propose_service_policy_amendment(
            id,
            changed_service_policy(),
            U64(effective_at_ns),
            U64(expires_at_ns),
            amendment_id.clone(),
        );

        for party in [accounts(1), accounts(2), accounts(3)] {
            testing_env!(context_at(party, 10_u128.pow(25), effective_at_ns - 1));
            assert!(!contract.approve_service_policy_amendment(id, amendment_id.clone()));
        }
        testing_env!(context_at(accounts(4), 10_u128.pow(25), effective_at_ns));
        assert!(contract.approve_service_policy_amendment(id, amendment_id.clone()));

        let amendment = contract
            .get_service_policy_amendment(id, amendment_id)
            .unwrap();
        let commitment = contract.commitments.get(&id.0).unwrap();
        assert_eq!(amendment.status, PolicyAmendmentStatus::Activated);
        assert_eq!(amendment.activated_at_ns, Some(U64(effective_at_ns)));
        assert_eq!(
            commitment.policy_hash,
            decode_32_byte_hex(&amendment.new_policy_hash).unwrap()
        );
        assert_ne!(commitment.policy_hash, original_hash);
        assert!(commitment.last_good.is_none());
        assert_eq!(
            read_service_policy_health_start(id.0),
            Some(effective_at_ns)
        );
        assert_eq!(
            health_of(commitment, effective_at_ns + 999),
            Health::AwaitingEvidence
        );
        assert_eq!(
            health_of(commitment, effective_at_ns + 1_000),
            Health::AtRisk
        );

        let mut stale_evidence = commitment.clone();
        stale_evidence.last_good = Some(GoodObservation {
            evaluation_id: EVALUATION_ID,
            evidence_hash: [21; 32],
            observed_at_ns: NOW_NS - 50,
            accepted_at_ns: NOW_NS - 50,
        });
        contract.commitments.insert(id.0, stale_evidence.clone());
        contract.commitments.flush();
        assert_eq!(
            contract.claim_eligibility(&stale_evidence, effective_at_ns + 10),
            Err("latest compliant evaluation is not eligible")
        );
    }

    #[test]
    fn service_policy_amendment_can_be_cancelled_or_expired_without_changing_policy() {
        let (mut contract, id) = active_service_commitment();
        let original_hash = contract.commitments.get(&id.0).unwrap().policy_hash;
        let cancelled_id = "e".repeat(64);
        testing_env!(context(accounts(1), 10_u128.pow(25)));
        contract.propose_service_policy_amendment(
            id,
            changed_service_policy(),
            U64(NOW_NS + 100),
            U64(NOW_NS + 1_000),
            cancelled_id.clone(),
        );
        contract.cancel_service_policy_amendment(id, cancelled_id.clone());
        assert_eq!(
            contract
                .get_service_policy_amendment(id, cancelled_id)
                .unwrap()
                .status,
            PolicyAmendmentStatus::Cancelled
        );
        assert_eq!(
            contract.commitments.get(&id.0).unwrap().policy_hash,
            original_hash
        );

        let expired_id = "f".repeat(64);
        testing_env!(context(accounts(1), 10_u128.pow(25)));
        contract.propose_service_policy_amendment(
            id,
            changed_service_policy(),
            U64(NOW_NS + 100),
            U64(NOW_NS + 1_000),
            expired_id.clone(),
        );
        testing_env!(context_at(accounts(5), 0, NOW_NS + 1_000));
        contract.expire_service_policy_amendment(id, expired_id.clone());
        assert_eq!(
            contract
                .get_service_policy_amendment(id, expired_id)
                .unwrap()
                .status,
            PolicyAmendmentStatus::Expired
        );
        assert_eq!(
            contract.commitments.get(&id.0).unwrap().policy_hash,
            original_hash
        );
    }

    #[test]
    fn bounded_authority_action_requires_claim_eligibility_and_consumes_grant_limits() {
        let (mut contract, grant_id) = create_authority_grant();
        testing_env!(context(accounts(1), 0));
        let _ = contract.execute_authority_grant(
            U64(CONTRACT_ID),
            grant_id.clone(),
            U64(1),
            U128(TRANCHE_AMOUNT),
        );
        let grant = contract
            .get_bounded_payout_authority_grant(U64(CONTRACT_ID), grant_id.clone())
            .unwrap();
        assert_eq!(grant.authorized_yocto, U128(TRANCHE_AMOUNT));
        assert_eq!(grant.last_action_nonce, U64(1));
        assert_eq!(grant.last_authorized_epoch, Some(U64(0)));

        testing_env!(context(accounts(1), 0));
        contract.revoke_authority_grant(U64(CONTRACT_ID), grant_id.clone());
        assert!(
            contract
                .get_bounded_payout_authority_grant(U64(CONTRACT_ID), grant_id)
                .unwrap()
                .revoked
        );
    }

    #[test]
    #[should_panic(expected = "this authority grant already acted during the current epoch")]
    fn bounded_authority_grant_cannot_execute_twice_in_one_epoch() {
        let (mut contract, grant_id) = create_authority_grant();
        testing_env!(context(accounts(1), 0));
        let _ =
            contract.execute_authority_grant(U64(CONTRACT_ID), grant_id.clone(), U64(1), U128(1));
        let _ = contract.execute_authority_grant(U64(CONTRACT_ID), grant_id, U64(2), U128(1));
    }

    #[test]
    #[should_panic(
        expected = "authority action is not eligible: a pending evaluation prevents tranche claims"
    )]
    fn bounded_authority_action_is_blocked_by_pending_evaluation() {
        let (mut contract, grant_id) = create_authority_grant();
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.pending_evaluation_id = Some(PENDING_EVALUATION_ID);
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.commitments.flush();
        testing_env!(context(accounts(1), 0));
        let _ = contract.execute_authority_grant(U64(CONTRACT_ID), grant_id, U64(1), U128(1));
    }

    #[test]
    #[should_panic(expected = "action exceeds its per-action payout limit")]
    fn bounded_authority_action_enforces_per_action_limit() {
        let (mut contract, grant_id) = create_authority_grant();
        testing_env!(context(accounts(1), 0));
        let _ = contract.execute_authority_grant(
            U64(CONTRACT_ID),
            grant_id,
            U64(1),
            U128(TRANCHE_AMOUNT + 1),
        );
    }

    #[test]
    #[should_panic(expected = "authority grant is revoked or expired")]
    fn revoked_authority_grant_cannot_execute() {
        let (mut contract, grant_id) = create_authority_grant();
        testing_env!(context(accounts(1), 0));
        contract.revoke_authority_grant(U64(CONTRACT_ID), grant_id.clone());
        let _ = contract.execute_authority_grant(U64(CONTRACT_ID), grant_id, U64(1), U128(1));
    }

    #[test]
    fn service_evaluation_request_pins_reports_and_reserves_callback_summary() {
        testing_env!(context_at(accounts(1), 10_u128.pow(25), NOW_NS));
        let mut contract = Contract::new();
        let id = contract.create_service_availability_commitment(service_commitment_args());
        let mut commitment = contract.commitments.get(&id.0).unwrap().clone();
        commitment.lifecycle = Lifecycle::Active;
        commitment.activated_at_ns = Some(NOW_NS - 10);
        commitment.operations_funded_yocto =
            commitment.policy.evaluator.execution_deposit_yocto * 2;
        contract.commitments.insert(id.0, commitment.clone());
        contract.commitments.flush();

        let service_policy = contract.get_service_availability_policy(id).unwrap();
        let report = SignedProbeReport {
            payload: ProbeReportPayload {
                schema: "lcp.service_availability.report.v1".to_string(),
                contract_id: accounts(0).to_string(),
                commitment_id: id.0.to_string(),
                evaluation_id: "1".to_string(),
                policy_version: 3,
                policy_hash: encode_hex(&commitment.policy_hash),
                source_policy_hash: service_source_policy_hash(&service_policy),
                source_id: service_policy.sources[0].source_id.clone(),
                operator_id: service_policy.sources[0].operator_id.clone(),
                target_id: service_policy.target_id,
                observed_at_ns: NOW_NS.to_string(),
                observation: ProbeObservation::HttpResponse {
                    status_code: 200,
                    latency_ms: 10,
                    tls_verified: true,
                },
            },
            signature_hex: Some("0".repeat(128)),
            wallet_signature: None,
            submitted_by: None,
        };
        testing_env!(context_at(accounts(2), 10_u128.pow(25), NOW_NS));
        let evaluation_id = contract.request_service_evaluation(id, vec![report]);
        assert_eq!(evaluation_id.0, 1);
        assert_eq!(
            contract
                .evaluation_requests
                .get(&(id.0, evaluation_id.0))
                .unwrap()
                .policy_version,
            3
        );
        assert!(env::storage_has_key(&service_summary_storage_key(
            id.0,
            evaluation_id.0
        )));
        assert!(contract
            .get_evaluation(id, evaluation_id)
            .unwrap()
            .service_availability
            .is_none());
    }

    #[test]
    #[allow(deprecated)]
    fn valid_outlayer_callback_accepts_pending_evaluation_and_ignores_replay() {
        let mut contract = contract_with_pending_evaluation();
        let output = callback_verdict(&PENDING_EVALUATION_ID.to_string());

        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(output.clone()),
        );
        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let accepted = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .unwrap();
        assert_eq!(accepted.status, EvaluationStatus::Accepted);
        assert_eq!(accepted.verdict, Some(Verdict::Compliant));
        assert_eq!(
            accepted.reason_codes,
            vec!["SIGNATURE_VALID", "ARTIFACT_HASH_FORMAT_VALID"]
        );
        assert_eq!(
            contract
                .commitments
                .get(&CONTRACT_ID)
                .unwrap()
                .pending_evaluation_id,
            None
        );

        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(output),
        );
        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let after_replay = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .unwrap();
        assert_eq!(after_replay.status, EvaluationStatus::Accepted);
        assert_eq!(after_replay.verdict, Some(Verdict::Compliant));
    }

    #[test]
    #[allow(deprecated)]
    fn mismatched_outlayer_callback_is_rejected_and_releases_pending_lock() {
        let mut contract = contract_with_pending_evaluation();
        let output = callback_verdict("999");

        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(output),
        );
        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let rejected = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .unwrap();
        assert_eq!(rejected.status, EvaluationStatus::Rejected);
        assert_eq!(rejected.reason_codes, vec!["VERDICT_BINDING_MISMATCH"]);
        assert_eq!(
            contract
                .commitments
                .get(&CONTRACT_ID)
                .unwrap()
                .pending_evaluation_id,
            None
        );
    }

    #[test]
    #[allow(deprecated)]
    fn stale_outlayer_callback_does_not_clear_a_newer_pending_request() {
        let mut contract = contract_with_pending_evaluation();
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.pending_evaluation_id = Some(PENDING_EVALUATION_ID + 1);
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.commitments.flush();

        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(callback_verdict(&PENDING_EVALUATION_ID.to_string())),
        );
        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        assert_eq!(
            contract
                .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
                .unwrap()
                .status,
            EvaluationStatus::Pending
        );
        assert_eq!(
            contract
                .commitments
                .get(&CONTRACT_ID)
                .unwrap()
                .pending_evaluation_id,
            Some(PENDING_EVALUATION_ID + 1)
        );
    }

    #[test]
    #[allow(deprecated)]
    fn inconclusive_service_evaluation_is_recorded_without_changing_health_clocks() {
        let mut contract = contract_with_pending_service_evaluation();
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.negative_since_ns = Some(NOW_NS - 50);
        commitment.breach_latched = true;
        let previous_last_good = commitment.last_good.as_ref().unwrap().observed_at_ns;
        let previous_last_observed = commitment.last_observed_at_ns;
        let previous_negative_since = commitment.negative_since_ns;
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.commitments.flush();

        let output = callback_service_verdict(&contract, "Inconclusive", NOW_NS, 1, 1, 0, 3_333);
        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(output),
        );
        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let after = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(
            after.last_good.as_ref().unwrap().observed_at_ns,
            previous_last_good
        );
        assert_eq!(after.last_observed_at_ns, previous_last_observed);
        assert_eq!(after.negative_since_ns, previous_negative_since);
        assert!(after.breach_latched);

        let evaluation = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .expect("accepted service result should be queryable");
        assert_eq!(evaluation.status, EvaluationStatus::Accepted);
        assert_eq!(evaluation.verdict, Some(Verdict::Inconclusive));
        assert_eq!(evaluation.observed_at_ns.0, NOW_NS);
        let summary = evaluation
            .service_availability
            .expect("source agreement should be visible");
        assert_eq!(summary.source_counts.configured, 3);
        assert_eq!(summary.source_counts.up, 1);
        assert_eq!(summary.source_counts.down, 1);
        assert_eq!(summary.corroboration_bps, 3_333);
    }

    #[test]
    fn upheld_challenge_preserves_evidence_and_releases_claim_block() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        add_open_challenge(&mut contract);
        assert_eq!(
            contract
                .get_challenge(U64(TRANSFER_ID))
                .unwrap()
                .completed_at_ns,
            None
        );

        testing_env!(context(accounts(4), 0));
        contract.resolve_challenge(U64(TRANSFER_ID), true);

        let challenge = contract.get_challenge(U64(TRANSFER_ID)).unwrap();
        assert_eq!(challenge.status, ChallengeStatus::Upheld);
        assert_eq!(challenge.completed_at_ns, Some(U64(NOW_NS)));
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(commitment.active_challenge_id, None);
        assert!(commitment.last_good.is_some());
        assert_eq!(commitment.negative_since_ns, None);
        assert!(
            contract
                .can_claim_tranche(U64(CONTRACT_ID))
                .unwrap()
                .eligible
        );
    }

    #[test]
    fn invalidated_challenge_clears_evidence_and_starts_negative_period() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        add_open_challenge(&mut contract);

        testing_env!(context(accounts(4), 0));
        contract.resolve_challenge(U64(TRANSFER_ID), false);

        let challenge = contract.get_challenge(U64(TRANSFER_ID)).unwrap();
        assert_eq!(challenge.status, ChallengeStatus::Invalidated);
        assert_eq!(challenge.completed_at_ns, Some(U64(NOW_NS)));
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(commitment.active_challenge_id, None);
        assert!(commitment.last_good.is_none());
        assert_eq!(commitment.negative_since_ns, Some(NOW_NS));
        assert_eq!(
            contract.claim_eligibility(&commitment, NOW_NS),
            Err("commitment health must be Healthy to claim")
        );
    }

    #[test]
    fn claim_eligibility_opens_at_the_exact_challenge_window_deadline() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        let challenge_window_end_ns = 1_000_000_000 + 100;

        testing_env!(context_at(accounts(3), 0, challenge_window_end_ns - 1));
        assert_eq!(
            contract.claim_eligibility(&commitment, challenge_window_end_ns - 1),
            Err("evaluation challenge window is still open")
        );

        testing_env!(context_at(accounts(3), 0, challenge_window_end_ns));
        assert_eq!(
            contract.claim_eligibility(&commitment, challenge_window_end_ns),
            Ok(EPOCH)
        );
    }

    #[test]
    fn challenge_timeout_is_applied_at_the_exact_resolution_deadline() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        add_open_challenge(&mut contract);
        let resolution_deadline_ns = NOW_NS + 1_000;

        testing_env!(context_at(accounts(0), 0, resolution_deadline_ns));
        contract.expire_challenge(U64(TRANSFER_ID));

        let challenge = contract.get_challenge(U64(TRANSFER_ID)).unwrap();
        assert_eq!(challenge.status, ChallengeStatus::TimedOut);
        assert_eq!(challenge.completed_at_ns, Some(U64(resolution_deadline_ns)));
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(commitment.active_challenge_id, None);
        assert!(commitment.last_good.is_some());
        assert_eq!(commitment.negative_since_ns, None);
        assert_eq!(
            contract.claim_eligibility(&commitment, resolution_deadline_ns),
            Ok(EPOCH)
        );
    }

    #[test]
    #[allow(deprecated)]
    fn failed_tranche_transfer_restores_eligibility_and_retry_pays_once() {
        let (mut contract, beneficiary) = contract_with_pending_tranche();

        testing_env_with_promise_results(context(accounts(0), 0), PromiseResult::Failed);
        contract.on_tranche_transfer(U64(TRANSFER_ID));

        let failed_tranche = contract
            .get_tranche(U64(CONTRACT_ID), U64(u64::from(EPOCH)))
            .expect("failed tranche should remain recorded");
        assert_eq!(failed_tranche.status, TrancheStatus::Failed);
        assert_eq!(failed_tranche.transfer_id, None);

        let after_failure = contract
            .get_escrow_status(U64(CONTRACT_ID))
            .expect("escrow view should exist");
        assert_eq!(after_failure.pending_yocto.0, 0);
        assert_eq!(after_failure.paid_yocto.0, 0);
        assert_eq!(after_failure.free_yocto.0, TRANCHE_AMOUNT);
        assert!(contract.pending_transfers.get(&TRANSFER_ID).is_none());
        assert_eq!(
            contract
                .commitments
                .get(&CONTRACT_ID)
                .unwrap()
                .pending_transfer_count,
            0
        );
        assert!(
            contract
                .can_claim_tranche(U64(CONTRACT_ID))
                .expect("eligibility view should exist")
                .eligible
        );

        testing_env!(context(beneficiary, 10_u128.pow(23)));
        let retry_transfer_id = contract.claim_tranche(U64(CONTRACT_ID));
        assert_eq!(retry_transfer_id.0, TRANSFER_ID + 1);
        assert_eq!(
            contract
                .get_tranche(U64(CONTRACT_ID), U64(u64::from(EPOCH)))
                .unwrap()
                .status,
            TrancheStatus::Pending
        );

        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(vec![]),
        );
        contract.on_tranche_transfer(retry_transfer_id);
        contract.on_tranche_transfer(retry_transfer_id);

        let paid_tranche = contract
            .get_tranche(U64(CONTRACT_ID), U64(u64::from(EPOCH)))
            .expect("paid tranche should remain recorded");
        assert_eq!(paid_tranche.status, TrancheStatus::Paid);
        assert_eq!(paid_tranche.transfer_id, None);

        let after_retry = contract
            .get_escrow_status(U64(CONTRACT_ID))
            .expect("escrow view should exist");
        assert_eq!(after_retry.pending_yocto.0, 0);
        assert_eq!(after_retry.paid_yocto.0, TRANCHE_AMOUNT);
        assert_eq!(after_retry.free_yocto.0, 0);
        assert!(contract
            .pending_transfers
            .get(&retry_transfer_id.0)
            .is_none());
        assert_eq!(
            contract
                .commitments
                .get(&CONTRACT_ID)
                .unwrap()
                .pending_transfer_count,
            0
        );
    }

    #[test]
    #[allow(deprecated)]
    fn callback_rejects_each_changed_request_binding() {
        let cases = [
            ("commitment_id", json!("999")),
            ("policy_version", json!(2)),
            ("policy_hash", json!("00".repeat(32))),
            ("input_hash", json!("00".repeat(32))),
            ("evidence_hash", json!("00".repeat(32))),
            ("observed_at_ns", json!("999")),
        ];

        for (field, value) in cases {
            let mut contract = contract_with_pending_evaluation();
            let mut output: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(
                &callback_verdict(&PENDING_EVALUATION_ID.to_string()),
            )
            .unwrap();
            output[field] = value;
            testing_env_with_promise_results(
                context(accounts(0), 0),
                PromiseResult::Successful(near_sdk::serde_json::to_vec(&output).unwrap()),
            );

            contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

            let rejected = contract
                .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
                .unwrap();
            assert_eq!(
                rejected.status,
                EvaluationStatus::Rejected,
                "field: {field}"
            );
            assert_eq!(
                rejected.reason_codes,
                vec!["VERDICT_BINDING_MISMATCH"],
                "field: {field}"
            );
        }
    }

    #[test]
    #[allow(deprecated)]
    fn failed_outlayer_promise_does_not_extend_compliant_evidence() {
        let mut contract = contract_with_pending_evaluation();
        testing_env_with_promise_results(context(accounts(0), 0), PromiseResult::Failed);

        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let record = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .unwrap();
        assert_eq!(record.status, EvaluationStatus::Failed);
        assert_eq!(record.reason_codes, vec!["OUTLAYER_EXECUTION_FAILED"]);
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(
            commitment.last_good.as_ref().unwrap().evaluation_id,
            EVALUATION_ID
        );
        assert_eq!(
            commitment.last_good.as_ref().unwrap().observed_at_ns,
            1_000_000_000
        );
        assert_eq!(commitment.negative_since_ns, None);
        assert_eq!(commitment.pending_evaluation_id, None);
    }

    #[test]
    #[allow(deprecated)]
    fn malformed_outlayer_output_is_rejected_without_extending_evidence() {
        let mut contract = contract_with_pending_evaluation();
        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(b"{malformed".to_vec()),
        );

        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let rejected = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .unwrap();
        assert_eq!(rejected.status, EvaluationStatus::Rejected);
        assert_eq!(rejected.reason_codes, vec!["MALFORMED_VERDICT"]);
        assert!(rejected.output_hash.is_some());
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(
            commitment.last_good.as_ref().unwrap().evaluation_id,
            EVALUATION_ID
        );
        assert_eq!(commitment.negative_since_ns, None);
    }

    #[test]
    #[allow(deprecated)]
    fn callback_at_timeout_boundary_does_not_accept_a_verdict() {
        let mut contract = contract_with_pending_evaluation();
        let timeout_at_ns = NOW_NS + 1_000;
        testing_env_with_promise_results(
            context_at(accounts(0), 0, timeout_at_ns),
            PromiseResult::Successful(callback_verdict(&PENDING_EVALUATION_ID.to_string())),
        );

        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let timed_out = contract
            .get_evaluation(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID))
            .unwrap();
        assert_eq!(timed_out.status, EvaluationStatus::TimedOut);
        assert_eq!(timed_out.reason_codes, vec!["OUTLAYER_TIMEOUT"]);
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(
            commitment.last_good.as_ref().unwrap().evaluation_id,
            EVALUATION_ID
        );
        assert_eq!(commitment.pending_evaluation_id, None);
    }

    #[test]
    #[allow(deprecated)]
    fn repeated_noncompliant_result_does_not_extend_the_original_grace_period() {
        let mut contract = contract_with_pending_evaluation();
        let negative_since_ns = NOW_NS - 500;
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        commitment.negative_since_ns = Some(negative_since_ns);
        contract.commitments.insert(CONTRACT_ID, commitment);
        contract.commitments.flush();

        let mut output: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_slice(&callback_verdict(&PENDING_EVALUATION_ID.to_string()))
                .unwrap();
        output["verdict"] = json!("NonCompliant");
        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(near_sdk::serde_json::to_vec(&output).unwrap()),
        );
        contract.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));

        let updated = contract.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(updated.negative_since_ns, Some(negative_since_ns));
        assert_eq!(health_of(&updated, NOW_NS), Health::AtRisk);
    }

    #[test]
    #[allow(deprecated)]
    fn compliant_evaluation_recovers_breach_only_when_policy_allows_it() {
        let mut recoverable = contract_with_pending_evaluation();
        set_breached_recovery_policy(&mut recoverable, true);
        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(callback_verdict(&PENDING_EVALUATION_ID.to_string())),
        );
        recoverable.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));
        let recovered = recoverable.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(health_of(&recovered, NOW_NS), Health::Healthy);
        assert_eq!(recovered.negative_since_ns, None);
        assert!(!recovered.breach_latched);

        let mut permanent = contract_with_pending_evaluation();
        set_breached_recovery_policy(&mut permanent, false);
        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(callback_verdict(&PENDING_EVALUATION_ID.to_string())),
        );
        permanent.on_outlayer_result(U64(CONTRACT_ID), U64(PENDING_EVALUATION_ID));
        let latched = permanent.commitments.get(&CONTRACT_ID).unwrap();
        assert_eq!(health_of(&latched, NOW_NS), Health::Breached);
        assert!(latched.breach_latched);
        assert!(latched.negative_since_ns.is_some());
    }

    #[test]
    #[should_panic(expected = "heartbeat timestamp cannot be in the future")]
    fn future_evidence_timestamp_is_rejected() {
        let (contract, _) = contract_with_pending_tranche();
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        let now_ns = 1_000_000_200;
        testing_env!(context_at(accounts(2), 0, now_ns));
        validate_observation_time(&commitment, now_ns + 1, now_ns);
    }

    #[test]
    #[should_panic(expected = "heartbeat exceeds the maximum source lag")]
    fn evidence_older_than_source_lag_is_rejected() {
        let (contract, _) = contract_with_pending_tranche();
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        let now_ns = 1_000_000_200;
        testing_env!(context_at(accounts(2), 0, now_ns));
        validate_observation_time(&commitment, 1_000_000_099, now_ns);
    }

    #[test]
    #[should_panic(
        expected = "heartbeat timestamp must be newer than the last accepted observation"
    )]
    fn repeated_evidence_timestamp_is_rejected_even_within_source_lag() {
        let (contract, _) = contract_with_pending_tranche();
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap();
        let now_ns = 1_000_000_050;
        testing_env!(context_at(accounts(2), 0, now_ns));
        validate_observation_time(&commitment, 1_000_000_000, now_ns);
    }

    #[test]
    fn claims_reject_stale_health_and_active_challenges() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        let mut commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        let evidence_expires_at_ns = 1_000_000_000 + commitment.policy.temporal.evidence_ttl_ns;

        testing_env!(context_at(accounts(3), 0, evidence_expires_at_ns));
        assert_eq!(
            contract.claim_eligibility(&commitment, evidence_expires_at_ns),
            Err("commitment health must be Healthy to claim")
        );

        let breach_at_ns = evidence_expires_at_ns + commitment.policy.temporal.grace_ns;
        testing_env!(context_at(accounts(3), 0, breach_at_ns));
        assert_eq!(
            contract.claim_eligibility(&commitment, breach_at_ns),
            Err("commitment health must be Healthy to claim")
        );

        commitment.active_challenge_id = Some(TRANSFER_ID);
        let healthy_time_ns = 1_000_000_200;
        testing_env!(context_at(accounts(3), 0, healthy_time_ns));
        assert_eq!(
            contract.claim_eligibility(&commitment, healthy_time_ns),
            Err("a blocking challenge prevents claims")
        );
    }

    #[test]
    fn claims_reject_a_settled_epoch_and_insufficient_free_escrow() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        let paid = Tranche {
            commitment_id: CONTRACT_ID,
            epoch: EPOCH,
            amount_yocto: TRANCHE_AMOUNT,
            status: TrancheStatus::Paid,
            transfer_id: None,
        };
        contract.tranches.insert((CONTRACT_ID, EPOCH), paid);
        contract.tranches.flush();
        let commitment = contract.commitments.get(&CONTRACT_ID).unwrap().clone();
        assert_eq!(
            contract.claim_eligibility(&commitment, NOW_NS),
            Err("this epoch is already paid or pending")
        );

        contract.tranches.remove(&(CONTRACT_ID, EPOCH));
        let mut underfunded = commitment;
        underfunded.escrow_funded_yocto = 0;
        assert_eq!(
            contract.claim_eligibility(&underfunded, NOW_NS),
            Err("insufficient unallocated commitment escrow")
        );
    }

    #[test]
    #[should_panic(expected = "only the designated arbiter may resolve a challenge")]
    fn non_arbiter_cannot_resolve_a_challenge() {
        let (mut contract, _) = contract_with_pending_tranche();
        clear_pending_tranche(&mut contract);
        add_open_challenge(&mut contract);
        testing_env!(context(accounts(2), 0));

        contract.resolve_challenge(U64(TRANSFER_ID), true);
    }

    #[test]
    #[allow(deprecated)]
    fn refund_callback_reconciles_success_and_failure_without_double_refund() {
        let refund_id = U64(TRANSFER_ID + 1);

        let mut failed = contract_with_pending_refund();
        testing_env_with_promise_results(context(accounts(0), 0), PromiseResult::Failed);
        failed.on_refund_transfer(refund_id);
        let failed_state = failed.get_escrow_status(U64(CONTRACT_ID)).unwrap();
        assert_eq!(failed_state.pending_yocto.0, 0);
        assert_eq!(failed_state.refunded_yocto.0, 0);
        assert_eq!(failed_state.free_yocto.0, TRANCHE_AMOUNT * 2);

        let mut succeeded = contract_with_pending_refund();
        testing_env_with_promise_results(
            context(accounts(0), 0),
            PromiseResult::Successful(vec![]),
        );
        succeeded.on_refund_transfer(refund_id);
        succeeded.on_refund_transfer(refund_id);
        let settled = succeeded.get_escrow_status(U64(CONTRACT_ID)).unwrap();
        assert_eq!(settled.pending_yocto.0, 0);
        assert_eq!(settled.refunded_yocto.0, TRANCHE_AMOUNT);
        assert_eq!(settled.free_yocto.0, TRANCHE_AMOUNT);
    }
}

fn refund_excess(account_id: near_sdk::AccountId, attached: u128, required: u128) {
    let excess = attached
        .checked_sub(required)
        .unwrap_or_else(|| env::panic_str("storage deposit underpayment"));
    if excess > 0 {
        Promise::new(account_id)
            .transfer(NearToken::from_yoctonear(excess))
            .detach();
    }
}

fn decode_32_byte_hex(input: &str) -> Option<[u8; 32]> {
    if input.len() != 64 {
        return None;
    }

    let mut digest = [0u8; 32];
    for (index, pair) in input.as_bytes().chunks_exact(2).enumerate() {
        digest[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(digest)
}

fn is_printable_ascii(input: &str) -> bool {
    input.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
}

fn decode_64_byte_hex(input: &str) -> Option<[u8; 64]> {
    if input.len() != 128 {
        return None;
    }

    let mut signature = [0u8; 64];
    for (index, pair) in input.as_bytes().chunks_exact(2).enumerate() {
        signature[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(signature)
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
