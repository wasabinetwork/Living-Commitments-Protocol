#![forbid(unsafe_code)]

mod contract;
mod models;
mod native_cash;
#[cfg(feature = "usdc-receipt-recovery")]
mod receipt_recovery;
mod recovery_accounting;
#[cfg(feature = "usdc-receipt-recovery")]
mod usdc_pool;
#[cfg(feature = "usdc-receipt-recovery")]
mod recovery_config;
mod temporal;

pub use contract::Contract;
pub use models::{
    BoundedPayoutAuthorityGrantView, BudgetPolicyArgs, ChallengeStatus, ChallengeView,
    ClaimEligibilityView, CommitmentPolicyArgs, CommitmentSummaryView, CreateCommitmentArgs,
    CreateServiceAvailabilityCommitmentArgs, EscrowStatusView, EvaluationRecordView,
    EvaluationStatus, EvaluatorPolicyArgs, EvidencePolicyArgs, PolicyAmendmentStatus,
    ServiceAvailabilityEvaluationSummary, ServiceAvailabilityPolicy, ServiceAvailabilitySource,
    ServicePolicyAmendmentView, ServiceReportInboxView, SettlementAsset, SettlementAssetArgs,
    SignedHeartbeatEvidence, SignedProbeReport, TemporalPolicyArgs, TrancheStatus, TrancheView,
    Verdict,
};
#[cfg(feature = "usdc-receipt-recovery")]
pub use receipt_recovery::ReceiptRecoveryIntentViewV1;
#[cfg(feature = "usdc-receipt-recovery")]
pub use recovery_accounting::ReceiptRecoveryCreditViewV1;
pub use recovery_accounting::RecoveryStorageReserveViewV1;
pub use recovery_accounting::RevaluationBatchResult;
#[cfg(feature = "usdc-receipt-recovery")]
pub use recovery_config::{
    ReceiptRecoveryCodeHashViewV1, ReceiptRecoveryConfigViewV1, ReceiptRecoveryRotationViewV1,
    RecoveryBootstrapArgs,
};
pub use temporal::{
    effective_health, validate_temporal_policy, Health, Lifecycle, TemporalError, TemporalPolicy,
    TemporalPolicyError, TemporalSnapshot,
};
