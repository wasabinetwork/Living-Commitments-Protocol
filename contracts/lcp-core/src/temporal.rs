use std::fmt;

use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    serde::{Deserialize, Serialize},
};

/// Stored commitment lifecycle. Health is derived separately from time and evidence.
#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum Lifecycle {
    Draft,
    Active,
    Closed,
}

/// Effective health returned by the temporal engine.
#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum Health {
    AwaitingEvidence,
    Healthy,
    AtRisk,
    Breached,
    Closed,
}

/// Time-related policy used by the MVP state machine. All durations are nanoseconds.
#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct TemporalPolicy {
    pub initial_window_ns: u64,
    pub evidence_ttl_ns: u64,
    pub grace_ns: u64,
    pub max_source_lag_ns: u64,
    pub challenge_window_ns: u64,
    pub resolution_timeout_ns: u64,
    pub recovery_allowed: bool,
}

/// Minimal temporal projection of a commitment, independent of NEAR storage.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TemporalSnapshot {
    pub lifecycle: Lifecycle,
    pub activated_at_ns: Option<u64>,
    pub last_good_observed_at_ns: Option<u64>,
    pub negative_since_ns: Option<u64>,
    pub breach_latched: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TemporalPolicyError {
    InitialWindowMustBePositive,
    EvidenceTtlMustBePositive,
    GracePeriodMustBePositive,
    MaxSourceLagMustBePositive,
    ChallengeWindowMustBePositive,
    ResolutionTimeoutMustBePositive,
    SourceLagExceedsEvidenceTtl,
    ChallengeWindowMustBeShorterThanEvidenceTtl,
    InitialWindowAndGraceOverflow,
    EvidenceTtlAndGraceOverflow,
}

impl fmt::Display for TemporalPolicyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InitialWindowMustBePositive => "initial evidence window must be positive",
            Self::EvidenceTtlMustBePositive => "evidence TTL must be positive",
            Self::GracePeriodMustBePositive => "grace period must be positive",
            Self::MaxSourceLagMustBePositive => "maximum source lag must be positive",
            Self::ChallengeWindowMustBePositive => "challenge window must be positive",
            Self::ResolutionTimeoutMustBePositive => {
                "challenge resolution timeout must be positive"
            }
            Self::SourceLagExceedsEvidenceTtl => "maximum source lag cannot exceed evidence TTL",
            Self::ChallengeWindowMustBeShorterThanEvidenceTtl => {
                "challenge window must be shorter than evidence TTL"
            }
            Self::InitialWindowAndGraceOverflow => {
                "initial evidence window plus grace period overflows u64"
            }
            Self::EvidenceTtlAndGraceOverflow => "evidence TTL plus grace period overflows u64",
        };
        f.write_str(message)
    }
}

impl std::error::Error for TemporalPolicyError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TemporalError {
    InvalidPolicy(TemporalPolicyError),
    MissingActivationTime,
    TimestampOverflow,
}

impl fmt::Display for TemporalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPolicy(error) => write!(f, "invalid temporal policy: {error}"),
            Self::MissingActivationTime => {
                f.write_str("active commitment is missing its activation timestamp")
            }
            Self::TimestampOverflow => f.write_str("temporal timestamp arithmetic overflowed u64"),
        }
    }
}

impl std::error::Error for TemporalError {}

impl From<TemporalPolicyError> for TemporalError {
    fn from(value: TemporalPolicyError) -> Self {
        Self::InvalidPolicy(value)
    }
}

/// Reject durations that cannot define non-empty, representable state windows.
pub fn validate_temporal_policy(policy: &TemporalPolicy) -> Result<(), TemporalPolicyError> {
    if policy.initial_window_ns == 0 {
        return Err(TemporalPolicyError::InitialWindowMustBePositive);
    }
    if policy.evidence_ttl_ns == 0 {
        return Err(TemporalPolicyError::EvidenceTtlMustBePositive);
    }
    if policy.grace_ns == 0 {
        return Err(TemporalPolicyError::GracePeriodMustBePositive);
    }
    if policy.max_source_lag_ns == 0 {
        return Err(TemporalPolicyError::MaxSourceLagMustBePositive);
    }
    if policy.challenge_window_ns == 0 {
        return Err(TemporalPolicyError::ChallengeWindowMustBePositive);
    }
    if policy.resolution_timeout_ns == 0 {
        return Err(TemporalPolicyError::ResolutionTimeoutMustBePositive);
    }
    if policy.max_source_lag_ns > policy.evidence_ttl_ns {
        return Err(TemporalPolicyError::SourceLagExceedsEvidenceTtl);
    }
    if policy.challenge_window_ns >= policy.evidence_ttl_ns {
        return Err(TemporalPolicyError::ChallengeWindowMustBeShorterThanEvidenceTtl);
    }
    if policy
        .initial_window_ns
        .checked_add(policy.grace_ns)
        .is_none()
    {
        return Err(TemporalPolicyError::InitialWindowAndGraceOverflow);
    }
    if policy
        .evidence_ttl_ns
        .checked_add(policy.grace_ns)
        .is_none()
    {
        return Err(TemporalPolicyError::EvidenceTtlAndGraceOverflow);
    }
    Ok(())
}

/// Derive the effective health at `now_ns` without changing stored state.
///
/// Boundaries follow the technical specification: Healthy only before evidence expires;
/// AtRisk from expiration through the instant before `breach_at`; Breached at `breach_at`.
pub fn effective_health(
    snapshot: &TemporalSnapshot,
    policy: &TemporalPolicy,
    now_ns: u64,
) -> Result<Health, TemporalError> {
    match snapshot.lifecycle {
        Lifecycle::Closed => return Ok(Health::Closed),
        Lifecycle::Draft => return Ok(Health::AwaitingEvidence),
        Lifecycle::Active => {}
    }

    if snapshot.breach_latched {
        return Ok(Health::Breached);
    }

    validate_temporal_policy(policy)?;

    if let Some(negative_since_ns) = snapshot.negative_since_ns {
        let breach_at_ns = negative_since_ns
            .checked_add(policy.grace_ns)
            .ok_or(TemporalError::TimestampOverflow)?;

        return Ok(if now_ns < breach_at_ns {
            Health::AtRisk
        } else {
            Health::Breached
        });
    }

    if let Some(observed_at_ns) = snapshot.last_good_observed_at_ns {
        let expires_at_ns = observed_at_ns
            .checked_add(policy.evidence_ttl_ns)
            .ok_or(TemporalError::TimestampOverflow)?;
        let breach_at_ns = expires_at_ns
            .checked_add(policy.grace_ns)
            .ok_or(TemporalError::TimestampOverflow)?;

        return Ok(if now_ns < expires_at_ns {
            Health::Healthy
        } else if now_ns < breach_at_ns {
            Health::AtRisk
        } else {
            Health::Breached
        });
    }

    let activated_at_ns = snapshot
        .activated_at_ns
        .ok_or(TemporalError::MissingActivationTime)?;
    let initial_deadline_ns = activated_at_ns
        .checked_add(policy.initial_window_ns)
        .ok_or(TemporalError::TimestampOverflow)?;
    let breach_at_ns = initial_deadline_ns
        .checked_add(policy.grace_ns)
        .ok_or(TemporalError::TimestampOverflow)?;

    Ok(if now_ns < initial_deadline_ns {
        Health::AwaitingEvidence
    } else if now_ns < breach_at_ns {
        Health::AtRisk
    } else {
        Health::Breached
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const POLICY: TemporalPolicy = TemporalPolicy {
        initial_window_ns: 10,
        evidence_ttl_ns: 100,
        grace_ns: 20,
        max_source_lag_ns: 10,
        challenge_window_ns: 5,
        resolution_timeout_ns: 10,
        recovery_allowed: true,
    };

    fn snapshot(
        activated_at_ns: Option<u64>,
        last_good_observed_at_ns: Option<u64>,
        negative_since_ns: Option<u64>,
    ) -> TemporalSnapshot {
        TemporalSnapshot {
            lifecycle: Lifecycle::Active,
            activated_at_ns,
            last_good_observed_at_ns,
            negative_since_ns,
            breach_latched: false,
        }
    }

    #[test]
    fn initial_evidence_window_transitions_at_exact_boundaries() {
        let state = snapshot(Some(100), None, None);

        assert_eq!(
            effective_health(&state, &POLICY, 109).unwrap(),
            Health::AwaitingEvidence
        );
        assert_eq!(
            effective_health(&state, &POLICY, 110).unwrap(),
            Health::AtRisk
        );
        assert_eq!(
            effective_health(&state, &POLICY, 129).unwrap(),
            Health::AtRisk
        );
        assert_eq!(
            effective_health(&state, &POLICY, 130).unwrap(),
            Health::Breached
        );
    }

    #[test]
    fn evidence_expiry_and_grace_transition_at_exact_boundaries() {
        let state = snapshot(Some(100), Some(200), None);

        assert_eq!(
            effective_health(&state, &POLICY, 299).unwrap(),
            Health::Healthy
        );
        assert_eq!(
            effective_health(&state, &POLICY, 300).unwrap(),
            Health::AtRisk
        );
        assert_eq!(
            effective_health(&state, &POLICY, 319).unwrap(),
            Health::AtRisk
        );
        assert_eq!(
            effective_health(&state, &POLICY, 320).unwrap(),
            Health::Breached
        );
    }

    #[test]
    fn negative_period_breaches_at_exact_grace_deadline_and_recovery_clears_it() {
        let negative_state = snapshot(Some(100), Some(200), Some(400));
        assert_eq!(
            effective_health(&negative_state, &POLICY, 419).unwrap(),
            Health::AtRisk
        );
        assert_eq!(
            effective_health(&negative_state, &POLICY, 420).unwrap(),
            Health::Breached
        );

        let recovered_state = snapshot(Some(100), Some(415), None);
        assert_eq!(
            effective_health(&recovered_state, &POLICY, 420).unwrap(),
            Health::Healthy
        );
    }
}
