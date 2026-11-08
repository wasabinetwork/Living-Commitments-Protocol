use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    json_types::{U128, U64},
    serde::{Deserialize, Serialize},
    AccountId,
};

use crate::temporal::{Health, Lifecycle, TemporalPolicy, TemporalSnapshot};

pub type CommitmentId = u64;
pub type EvaluationId = u64;
pub type ChallengeId = u64;
pub type TransferId = u64;

pub const EVALUATION_REQUEST_SCHEMA: &str = "lcp.evaluation.request.v1";
pub const EVALUATION_VERDICT_SCHEMA: &str = "lcp.evaluation.verdict.v2";
pub const HEARTBEAT_SCHEMA: &str = "lcp.heartbeat.v1";
pub const HEARTBEAT_EVIDENCE_TYPE: &str = "signed_maintenance_heartbeat";

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct EvidencePolicy {
    pub maintainer_public_key: [u8; 32],
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct EvaluatorPolicy {
    pub outlayer_account: AccountId,
    pub wasm_url: String,
    pub wasm_sha256: [u8; 32],
    pub build_target: String,
    pub max_instructions: u64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: u64,
    pub request_timeout_ns: u64,
    pub execution_deposit_yocto: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct BudgetPolicy {
    pub sponsor: AccountId,
    pub beneficiary: AccountId,
    pub epoch_ns: u64,
    pub max_epochs: u32,
    pub tranche_yocto: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct CommitmentPolicy {
    pub version: u32,
    pub temporal: TemporalPolicy,
    pub evidence: EvidencePolicy,
    pub evaluator: EvaluatorPolicy,
    pub budget: BudgetPolicy,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct GoodObservation {
    pub evaluation_id: EvaluationId,
    pub evidence_hash: [u8; 32],
    pub observed_at_ns: u64,
    pub accepted_at_ns: u64,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum Verdict {
    Compliant,
    NonCompliant,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum EvaluationStatus {
    Pending,
    Accepted,
    Rejected,
    Failed,
    TimedOut,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum TrancheStatus {
    Unclaimed,
    Pending,
    Paid,
    Failed,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ChallengeStatus {
    Open,
    Upheld,
    Invalidated,
    TimedOut,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Tranche {
    pub commitment_id: CommitmentId,
    pub epoch: u32,
    pub amount_yocto: u128,
    pub status: TrancheStatus,
    pub transfer_id: Option<TransferId>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub enum TransferKind {
    Tranche,
    Refund,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct PendingTransfer {
    pub id: TransferId,
    pub commitment_id: CommitmentId,
    pub kind: TransferKind,
    pub epoch: Option<u32>,
    pub recipient: AccountId,
    pub amount_yocto: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Challenge {
    pub id: u64,
    pub commitment_id: CommitmentId,
    pub evaluation_id: EvaluationId,
    pub challenger: AccountId,
    pub reason_hash: [u8; 32],
    pub opened_at_ns: u64,
    pub resolution_deadline_ns: u64,
    pub status: ChallengeStatus,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ChallengeView {
    pub id: U64,
    pub commitment_id: U64,
    pub evaluation_id: U64,
    pub challenger: AccountId,
    pub reason_hash: String,
    pub opened_at_ns: U64,
    pub resolution_deadline_ns: U64,
    pub status: ChallengeStatus,
}

impl From<&Challenge> for ChallengeView {
    fn from(challenge: &Challenge) -> Self {
        Self {
            id: U64(challenge.id),
            commitment_id: U64(challenge.commitment_id),
            evaluation_id: U64(challenge.evaluation_id),
            challenger: challenge.challenger.clone(),
            reason_hash: encode_hex(&challenge.reason_hash),
            opened_at_ns: U64(challenge.opened_at_ns),
            resolution_deadline_ns: U64(challenge.resolution_deadline_ns),
            status: challenge.status,
        }
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TrancheView {
    pub commitment_id: U64,
    pub epoch: U64,
    pub amount_yocto: U128,
    pub status: TrancheStatus,
    pub transfer_id: Option<U64>,
}

impl From<&Tranche> for TrancheView {
    fn from(tranche: &Tranche) -> Self {
        Self {
            commitment_id: U64(tranche.commitment_id),
            epoch: U64(u64::from(tranche.epoch)),
            amount_yocto: U128(tranche.amount_yocto),
            status: tranche.status,
            transfer_id: tranche.transfer_id.map(U64),
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct EvaluationRequest {
    pub id: EvaluationId,
    pub commitment_id: CommitmentId,
    pub policy_version: u32,
    pub policy_hash: [u8; 32],
    pub input_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub observed_at_ns: u64,
    pub requested_at_ns: u64,
    pub timeout_at_ns: u64,
    /// The all-zero value reserves callback storage until OutLayer returns the hash.
    pub request_transaction_hash: Option<[u8; 32]>,
    pub status: EvaluationStatus,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct EvaluationRecord {
    pub request_id: EvaluationId,
    pub commitment_id: CommitmentId,
    /// The all-zero value reserves callback storage when no hash is available.
    pub request_transaction_hash: Option<[u8; 32]>,
    pub status: EvaluationStatus,
    pub verdict: Option<Verdict>,
    pub reason_codes: Vec<String>,
    pub input_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub observed_at_ns: u64,
    pub accepted_at_ns: Option<u64>,
    pub policy_hash: [u8; 32],
    pub output_hash: Option<[u8; 32]>,
}

/// Evidence submitted to `request_evaluation`.
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct SignedHeartbeatEvidence {
    #[serde(rename = "type")]
    pub evidence_type: String,
    pub artifact_hash: String,
    pub maintainer_public_key: String,
    pub signature: String,
    pub payload: String,
}

/// Canonical signed payload used by the heartbeat maintainer.
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct HeartbeatPayload {
    pub schema: String,
    pub commitment_id: String,
    pub evaluation_id: String,
    pub policy_version: u32,
    pub policy_hash: String,
    pub observed_at_ns: String,
    pub subject: String,
    pub artifact_hash: String,
}

/// Stable field order is part of the bytes hashed and passed to OutLayer.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvaluationInput<'a> {
    pub schema: &'static str,
    pub commitment_id: String,
    pub evaluation_id: String,
    pub policy_version: u32,
    pub policy_hash: String,
    pub evidence_hash: String,
    pub observed_at_ns: String,
    pub subject: &'a str,
    pub evidence: &'a SignedHeartbeatEvidence,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct EvaluationVerdictOutput {
    pub schema: String,
    pub request_transaction_hash: String,
    pub commitment_id: String,
    pub evaluation_id: String,
    pub policy_version: u32,
    pub policy_hash: String,
    pub input_hash: String,
    pub evidence_hash: String,
    pub observed_at_ns: String,
    pub verdict: Verdict,
    pub reason_codes: Vec<String>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvaluationRecordView {
    pub commitment_id: U64,
    pub evaluation_id: U64,
    pub request_transaction_hash: Option<String>,
    pub status: EvaluationStatus,
    pub verdict: Option<Verdict>,
    pub reason_codes: Vec<String>,
    pub input_hash: String,
    pub evidence_hash: String,
    pub observed_at_ns: U64,
    pub accepted_at_ns: Option<U64>,
    pub policy_hash: String,
    pub output_hash: Option<String>,
}

impl From<&EvaluationRecord> for EvaluationRecordView {
    fn from(record: &EvaluationRecord) -> Self {
        let is_pending = record.status == EvaluationStatus::Pending;
        Self {
            commitment_id: U64(record.commitment_id),
            evaluation_id: U64(record.request_id),
            request_transaction_hash: if is_pending {
                None
            } else {
                record
                    .request_transaction_hash
                    .as_ref()
                    .filter(|hash| **hash != [0; 32])
                    .map(|hash| encode_hex(hash))
            },
            status: record.status,
            verdict: if is_pending { None } else { record.verdict },
            reason_codes: if is_pending {
                Vec::new()
            } else {
                record.reason_codes.clone()
            },
            input_hash: encode_hex(&record.input_hash),
            evidence_hash: encode_hex(&record.evidence_hash),
            observed_at_ns: U64(record.observed_at_ns),
            accepted_at_ns: if is_pending {
                None
            } else {
                record.accepted_at_ns.map(U64)
            },
            policy_hash: encode_hex(&record.policy_hash),
            output_hash: if is_pending {
                None
            } else {
                record.output_hash.as_ref().map(|hash| encode_hex(hash))
            },
        }
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Commitment {
    pub id: CommitmentId,
    pub subject: String,
    pub creator: AccountId,
    pub maintainer: AccountId,
    pub arbiter: AccountId,
    pub lifecycle: Lifecycle,
    pub policy: CommitmentPolicy,
    pub policy_hash: [u8; 32],
    pub activated_at_ns: Option<u64>,
    pub last_good: Option<GoodObservation>,
    pub last_observed_at_ns: Option<u64>,
    pub negative_since_ns: Option<u64>,
    pub pending_evaluation_id: Option<EvaluationId>,
    pub active_challenge_id: Option<ChallengeId>,
    pub breach_latched: bool,
    pub escrow_funded_yocto: u128,
    pub escrow_paid_yocto: u128,
    pub escrow_refunded_yocto: u128,
    pub escrow_pending_yocto: u128,
    pub operations_funded_yocto: u128,
    pub operations_authorized_spend_yocto: u128,
    pub storage_deposit_yocto: u128,
    pub next_evaluation_id: EvaluationId,
    pub challenge_count: u32,
    pub pending_transfer_count: u32,
}

impl Commitment {
    pub fn temporal_snapshot(&self) -> TemporalSnapshot {
        TemporalSnapshot {
            lifecycle: self.lifecycle,
            activated_at_ns: self.activated_at_ns,
            last_good_observed_at_ns: self
                .last_good
                .as_ref()
                .map(|observation| observation.observed_at_ns),
            negative_since_ns: self.negative_since_ns,
            breach_latched: self.breach_latched,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CreateCommitmentArgs {
    pub subject: String,
    pub maintainer: AccountId,
    pub arbiter: AccountId,
    pub policy: CommitmentPolicyArgs,
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CommitmentPolicyArgs {
    pub temporal: TemporalPolicyArgs,
    pub evidence: EvidencePolicyArgs,
    pub evaluator: EvaluatorPolicyArgs,
    pub budget: BudgetPolicyArgs,
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TemporalPolicyArgs {
    pub initial_window_ns: U64,
    pub evidence_ttl_ns: U64,
    pub grace_ns: U64,
    pub max_source_lag_ns: U64,
    pub challenge_window_ns: U64,
    pub resolution_timeout_ns: U64,
    pub recovery_allowed: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvidencePolicyArgs {
    pub maintainer_public_key_hex: String,
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvaluatorPolicyArgs {
    pub outlayer_account: AccountId,
    pub wasm_url: String,
    pub wasm_sha256_hex: String,
    pub build_target: String,
    pub max_instructions: U64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: U64,
    pub request_timeout_ns: U64,
    pub execution_deposit_yocto: U128,
}

#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BudgetPolicyArgs {
    pub sponsor: AccountId,
    pub beneficiary: AccountId,
    pub epoch_ns: U64,
    pub max_epochs: u32,
    pub tranche_yocto: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TemporalPolicyView {
    pub initial_window_ns: U64,
    pub evidence_ttl_ns: U64,
    pub grace_ns: U64,
    pub max_source_lag_ns: U64,
    pub challenge_window_ns: U64,
    pub resolution_timeout_ns: U64,
    pub recovery_allowed: bool,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvaluatorPolicyView {
    pub outlayer_account: AccountId,
    pub wasm_url: String,
    pub wasm_sha256_hex: String,
    pub build_target: String,
    pub max_instructions: U64,
    pub max_memory_mb: u32,
    pub max_execution_seconds: U64,
    pub request_timeout_ns: U64,
    pub execution_deposit_yocto: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BudgetPolicyView {
    pub sponsor: AccountId,
    pub beneficiary: AccountId,
    pub epoch_ns: U64,
    pub max_epochs: u32,
    pub tranche_yocto: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CommitmentPolicyView {
    pub version: u32,
    pub temporal: TemporalPolicyView,
    pub evidence: EvidencePolicyView,
    pub evaluator: EvaluatorPolicyView,
    pub budget: BudgetPolicyView,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvidencePolicyView {
    pub maintainer_public_key_hex: String,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CommitmentView {
    pub id: U64,
    pub subject: String,
    pub creator: AccountId,
    pub maintainer: AccountId,
    pub arbiter: AccountId,
    pub lifecycle: Lifecycle,
    pub policy_version: u32,
    pub policy_hash: String,
    pub next_evaluation_id: U64,
    pub pending_evaluation_id: Option<U64>,
    pub active_challenge_id: Option<U64>,
    pub activated_at_ns: Option<U64>,
    pub last_observed_at_ns: Option<U64>,
    pub last_good_observed_at_ns: Option<U64>,
    pub negative_since_ns: Option<U64>,
    pub effective_health: Health,
    pub escrow_funded_yocto: U128,
    pub escrow_paid_yocto: U128,
    pub escrow_refunded_yocto: U128,
    pub escrow_pending_yocto: U128,
    pub operations_funded_yocto: U128,
    pub operations_authorized_spend_yocto: U128,
    pub storage_deposit_yocto: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ClaimEligibilityView {
    pub eligible: bool,
    pub reason: Option<String>,
    pub current_epoch: Option<U64>,
    pub amount_yocto: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EscrowStatusView {
    pub funded_yocto: U128,
    pub paid_yocto: U128,
    pub refunded_yocto: U128,
    pub pending_yocto: U128,
    pub free_yocto: U128,
}

impl From<&TemporalPolicy> for TemporalPolicyView {
    fn from(policy: &TemporalPolicy) -> Self {
        Self {
            initial_window_ns: U64(policy.initial_window_ns),
            evidence_ttl_ns: U64(policy.evidence_ttl_ns),
            grace_ns: U64(policy.grace_ns),
            max_source_lag_ns: U64(policy.max_source_lag_ns),
            challenge_window_ns: U64(policy.challenge_window_ns),
            resolution_timeout_ns: U64(policy.resolution_timeout_ns),
            recovery_allowed: policy.recovery_allowed,
        }
    }
}

impl From<&CommitmentPolicy> for CommitmentPolicyView {
    fn from(policy: &CommitmentPolicy) -> Self {
        Self {
            version: policy.version,
            temporal: TemporalPolicyView::from(&policy.temporal),
            evidence: EvidencePolicyView {
                maintainer_public_key_hex: encode_hex(&policy.evidence.maintainer_public_key),
            },
            evaluator: EvaluatorPolicyView {
                outlayer_account: policy.evaluator.outlayer_account.clone(),
                wasm_url: policy.evaluator.wasm_url.clone(),
                wasm_sha256_hex: encode_hex(&policy.evaluator.wasm_sha256),
                build_target: policy.evaluator.build_target.clone(),
                max_instructions: U64(policy.evaluator.max_instructions),
                max_memory_mb: policy.evaluator.max_memory_mb,
                max_execution_seconds: U64(policy.evaluator.max_execution_seconds),
                request_timeout_ns: U64(policy.evaluator.request_timeout_ns),
                execution_deposit_yocto: U128(policy.evaluator.execution_deposit_yocto),
            },
            budget: BudgetPolicyView {
                sponsor: policy.budget.sponsor.clone(),
                beneficiary: policy.budget.beneficiary.clone(),
                epoch_ns: U64(policy.budget.epoch_ns),
                max_epochs: policy.budget.max_epochs,
                tranche_yocto: U128(policy.budget.tranche_yocto),
            },
        }
    }
}

pub(crate) fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}
