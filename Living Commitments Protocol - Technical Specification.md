# Living Commitments Protocol
## Technical Specification v0.1

**Status:** Engineering baseline
**Date:** November 7, 2026
**Target:** NEAR Hackathon 2026
**Implementation:** Rust / NEAR SDK 5.x, OutLayer WASI evaluator, TypeScript SDK
**Network:** NEAR testnet
**Parent specification:** LCP PRD v0.2

---

# 1. Engineering Objective

Implement a minimal, reusable NEAR protocol that maintains the health of an ongoing commitment based on time-sensitive evidence and enforces financial consequences according to that health.

The initial implementation must demonstrate:

1. A commitment is created with an immutable policy.
2. An authorized evaluation is requested through OutLayer.
3. A hash-pinned WASM evaluator returns a verdict.
4. The contract accepts the verdict only when it matches the pending request.
5. A compliant observation makes the commitment Healthy.
6. Evidence expiration makes it AtRisk.
7. The grace-period deadline makes it Breached.
8. A Breached commitment cannot authorize a new budget tranche.
9. Fresh compliant evidence can restore Healthy status.
10. A recovered commitment can authorize a future tranche.

**Non-goal:** Building a generic DAO, a complete escrow marketplace, a universal oracle, or a policy compiler.

---

# 2. Architectural Decisions

## 2.1 Single authoritative contract

The MVP uses one NEAR contract for:

- Commitment state.
- Policy storage.
- Evaluation requests.
- Evaluation acceptance.
- Temporal state derivation.
- Challenge handling.
- Native NEAR escrow.
- Tranche authorization.
- Transfer reconciliation.

The WASM evaluator executes off-chain through OutLayer.

This reduces cross-contract coordination complexity during the hackathon.

## 2.2 Three separate authorities

**Evaluation authority**

The pinned evaluator determines whether supplied evidence satisfies the evidence policy.

**State authority**

LCP applies the temporal policy to accepted evaluations and current blockchain time.

**Consequence authority**

LCP authorizes or rejects a financial operation based on the current effective state.

No evaluator verdict directly transfers money.

## 2.3 Immutable policy in v0.1

Each commitment has a policy version and digest.

Version 1 is immutable after activation.

A full amendment engine is deferred. The contract should preserve a version field so amendments can be introduced without changing the meaning of historical evaluations.

## 2.4 Deterministic time

All stored timestamps use unsigned 64-bit **nanoseconds**.

All state transitions use the NEAR blockchain timestamp.

No frontend timestamp, evaluator clock, or server clock may independently determine whether an on-chain consequence is allowed.

## 2.5 One pending evaluation

Only one evaluation request may be pending per commitment.

This avoids conflicting asynchronous results in the first implementation.

Each request has a monotonically increasing identifier.

## 2.6 One budget beneficiary

The MVP supports one sponsor and one budget beneficiary per commitment.

The financial model is intentionally simple.

## 2.7 No automatic catch-up

An unclaimed budget epoch expires when the next epoch begins.

Recovery restores eligibility for the current or future epochs, not missed payments.

---

# 3. Protocol State Model

## 3.1 Commitment lifecycle

The stored lifecycle is:

- `Draft`
- `Active`
- `Closed`

The health state is separately derived.

## 3.2 Health states

- `AwaitingEvidence`
- `Healthy`
- `AtRisk`
- `Breached`
- `Closed`

`Recovered` is an event, not a permanent state.

`Challenged` is a dispute condition, not a replacement for health.

## 3.3 State transition table

| Current state | Trigger | Next state | Consequence |
|---|---|---|---|
| AwaitingEvidence | Fresh compliant evaluation | Healthy | May become eligible |
| AwaitingEvidence | Initial deadline reached | AtRisk | Blocked |
| AtRisk | Grace period elapsed | Breached | Blocked |
| Healthy | Evidence TTL elapsed | AtRisk | Blocked |
| Healthy | Accepted noncompliant evaluation | AtRisk | Blocked |
| AtRisk | Fresh compliant evaluation | Healthy | Eligibility restored |
| Breached | Fresh compliant evaluation and recovery allowed | Healthy | Eligibility restored |
| Breached | Fresh compliant evaluation and recovery forbidden | Breached | Blocked |
| Any active state | Valid challenge on governing evaluation | Health unchanged; challenge open | Blocked |
| Any active state | Authorized closure | Closed | No new claims |

## 3.4 Exact boundary semantics

For an accepted compliant observation:

`expires_at = observed_at + ttl`

`breach_at = expires_at + grace`

Then:

- Healthy if `now < expires_at`.
- AtRisk if `expires_at <= now < breach_at`.
- Breached if `now >= breach_at`.

For no accepted evidence:

`initial_deadline = activated_at + initial_window`

The same AtRisk and Breached thresholds apply after the initial deadline.

For an accepted noncompliant evaluation:

- Record `negative_since` when the first unresolved negative evaluation is accepted.
- Enter AtRisk immediately.
- Enter Breached when `now >= negative_since + grace`.

Repeated negative evaluations **must not reset** the grace-period clock.

A new qualifying compliant evaluation clears the unresolved negative condition if recovery is permitted.

All timestamp arithmetic must use checked addition and reject overflow.

---

# 4. Canonical Rust Data Structures

The following is the intended contract-state model for NEAR SDK 5.x.

It is a source-level specification. The final repository must pin exact dependency versions and compile these declarations against its lockfile.

```rust
use near_sdk::{
    borsh::{BorshDeserialize, BorshSerialize},
    store::LookupMap,
    AccountId,
    PanicOnDefault,
};

pub type CommitmentId = u64;
pub type EvaluationId = u64;
pub type ChallengeId = u64;
pub type TransferId = u64;

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug
)]
#[borsh(crate = "near_sdk::borsh")]
pub enum Lifecycle {
    Draft,
    Active,
    Closed,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug
)]
#[borsh(crate = "near_sdk::borsh")]
pub enum Health {
    AwaitingEvidence,
    Healthy,
    AtRisk,
    Breached,
    Closed,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug
)]
#[borsh(crate = "near_sdk::borsh")]
pub enum Verdict {
    Compliant,
    NonCompliant,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug
)]
#[borsh(crate = "near_sdk::borsh")]
pub enum EvaluationStatus {
    Pending,
    Accepted,
    Rejected,
    Failed,
    TimedOut,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug
)]
#[borsh(crate = "near_sdk::borsh")]
pub enum ChallengeStatus {
    Open,
    Upheld,
    Invalidated,
    TimedOut,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Debug
)]
#[borsh(crate = "near_sdk::borsh")]
pub enum TrancheStatus {
    Unclaimed,
    Pending,
    Paid,
    Failed,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
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

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct EvidencePolicy {
    pub maintainer_public_key: [u8; 32],
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
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

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct BudgetPolicy {
    pub sponsor: AccountId,
    pub beneficiary: AccountId,
    pub epoch_ns: u64,
    pub max_epochs: u32,
    pub tranche_yocto: u128,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct CommitmentPolicy {
    pub version: u32,
    pub temporal: TemporalPolicy,
    pub evidence: EvidencePolicy,
    pub evaluator: EvaluatorPolicy,
    pub budget: BudgetPolicy,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct GoodObservation {
    pub evaluation_id: EvaluationId,
    pub evidence_hash: [u8; 32],
    pub observed_at_ns: u64,
    pub accepted_at_ns: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
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

#[derive(BorshDeserialize, BorshSerialize, Clone)]
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
    /// All-zero placeholder reserves callback storage until a hash is available.
    pub request_transaction_hash: Option<[u8; 32]>,

    pub status: EvaluationStatus,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct EvaluationRecord {
    pub request_id: EvaluationId,
    pub commitment_id: CommitmentId,
    /// All-zero placeholder reserves callback storage; views expose it as absent until set.
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

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Challenge {
    pub id: ChallengeId,
    pub commitment_id: CommitmentId,
    pub evaluation_id: EvaluationId,
    pub challenger: AccountId,
    pub reason_hash: [u8; 32],

    pub opened_at_ns: u64,
    pub resolution_deadline_ns: u64,

    pub status: ChallengeStatus,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Tranche {
    pub commitment_id: CommitmentId,
    pub epoch: u32,
    pub amount_yocto: u128,
    pub status: TrancheStatus,
    pub transfer_id: Option<TransferId>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy)]
#[borsh(crate = "near_sdk::borsh")]
pub enum TransferKind {
    Tranche,
    Refund,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct PendingTransfer {
    pub id: TransferId,
    pub commitment_id: CommitmentId,
    pub kind: TransferKind,
    pub epoch: Option<u32>,
    pub recipient: AccountId,
    pub amount_yocto: u128,
}

#[near_sdk::near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub next_commitment_id: CommitmentId,
    pub next_challenge_id: ChallengeId,
    pub next_transfer_id: TransferId,

    pub commitments: LookupMap<CommitmentId, Commitment>,
    pub evaluation_requests:
        LookupMap<(CommitmentId, EvaluationId), EvaluationRequest>,
    pub evaluation_records:
        LookupMap<(CommitmentId, EvaluationId), EvaluationRecord>,
    pub challenges: LookupMap<ChallengeId, Challenge>,
    pub challenge_by_evaluation: LookupMap<(CommitmentId, EvaluationId), ChallengeId>,
    pub tranches: LookupMap<(CommitmentId, u32), Tranche>,
    pub pending_transfers: LookupMap<TransferId, PendingTransfer>,
}
```

`ChallengeView` additionally exposes optional `completed_at_ns`. New challenges reserve a fixed-width timestamp slot in raw contract storage when opened and fill it when the arbiter resolves or timeout is applied. This keeps the persisted `Challenge` and top-level contract state layout unchanged. Views of challenges created before this timestamp was introduced return `null` rather than inventing an outcome time.

## 4.1 Storage requirements

- IDs must be unique within their defined scope.
- Stored hashes must be exactly 32 bytes.
- `policy_hash` is SHA-256 of the Borsh serialization of the v1 `CommitmentPolicy`, with fields serialized in the order declared in the canonical Rust model.
- Strings and evidence payloads must have explicit maximum lengths.
- The contract must enforce a maximum number of evaluation records per commitment for the hackathon release.
- Large evidence content must remain off-chain.
- Historical records must not be silently overwritten.
- View methods must use JSON-safe representations for `u64` timestamps and `u128` balances.

The public JSON interface should serialize large integers as decimal strings.

## 4.2 Storage deposits

The implementation must separately account for:

- Contract storage.
- Commitment escrow.
- Evaluation execution expenses.

A fixed demo storage bond is acceptable only if its amount is derived from measured storage usage and bounded record counts.

The initial implementation measures storage growth when creating and activating a commitment, requires the corresponding storage deposit, records that amount separately from escrow and evaluation funding, and refunds any excess attached deposit. Later state transitions that grow storage must follow the same accounting rule. Storage deposits are not available for budget claims.

Escrow funds must never be used to subsidize unlimited evaluation requests.

---

# 5. Pure Temporal State Function

The core health calculation must be a pure function.

It must not:

- Transfer funds.
- Modify storage.
- Call external contracts.
- Trust a frontend-provided status.
- Require an indexer.

Reference implementation:

```rust
pub fn effective_health(
    commitment: &Commitment,
    now_ns: u64,
) -> Health {
    match commitment.lifecycle {
        Lifecycle::Closed => return Health::Closed,
        Lifecycle::Draft => return Health::AwaitingEvidence,
        Lifecycle::Active => {}
    }

    if commitment.breach_latched {
        return Health::Breached;
    }

    let temporal = &commitment.policy.temporal;

    if let Some(negative_since) = commitment.negative_since_ns {
        let breach_at = negative_since
            .checked_add(temporal.grace_ns)
            .expect("time overflow");

        return if now_ns < breach_at {
            Health::AtRisk
        } else {
            Health::Breached
        };
    }

    if let Some(good) = &commitment.last_good {
        let expires_at = good
            .observed_at_ns
            .checked_add(temporal.evidence_ttl_ns)
            .expect("time overflow");

        let breach_at = expires_at
            .checked_add(temporal.grace_ns)
            .expect("time overflow");

        if now_ns < expires_at {
            Health::Healthy
        } else if now_ns < breach_at {
            Health::AtRisk
        } else {
            Health::Breached
        }
    } else {
        let activated_at = commitment
            .activated_at_ns
            .expect("active commitment has activation time");

        let initial_deadline = activated_at
            .checked_add(temporal.initial_window_ns)
            .expect("time overflow");

        let breach_at = initial_deadline
            .checked_add(temporal.grace_ns)
            .expect("time overflow");

        if now_ns < initial_deadline {
            Health::AwaitingEvidence
        } else if now_ns < breach_at {
            Health::AtRisk
        } else {
            Health::Breached
        }
    }
}
```

## 5.1 Important semantics

A challenge does not change the health calculation.

Instead, an open challenge independently blocks the affected financial consequence.

A failed evaluation does not create a fresh compliant observation.

A negative evaluation sets `negative_since_ns` only if there is no unresolved negative condition.

A qualifying positive evaluation clears `negative_since_ns`.

If recovery is forbidden and the effective state has reached Breached, the contract must latch that breach before processing a new positive verdict.

---

# 6. Evaluation Request Protocol

## 6.1 Request method

Proposed contract method:

`request_evaluation(commitment_id, evidence_payload)`

The caller must be an authorized sponsor or maintainer for the MVP.

Preconditions:

- Commitment is Active.
- No evaluation is already pending.
- Evaluation limit has not been reached.
- Required execution budget is available.
- The evaluator configuration is valid.
- Evidence payload is within the size limit.

The method:

1. Allocates a new evaluation ID.
2. Constructs canonical evaluator input.
3. Hashes the exact input bytes.
4. Stores the pending request.
5. Calls OutLayer.
6. Chains a private callback to the LCP contract.

## 6.2 Evaluator input schema

```json
{
  "schema": "lcp.evaluation.request.v1",
  "commitment_id": "1",
  "evaluation_id": "4",
  "policy_version": 1,
  "policy_hash": "64-character-sha256-hex",
  "evidence_hash": "64-character-sha256-hex",
  "observed_at_ns": "1794090000000000000",
  "subject": "example-maintenance-program",
  "evidence": {
    "type": "signed_maintenance_heartbeat",
    "artifact_hash": "64-character-sha256-hex",
    "maintainer_public_key": "64-character-ed25519-public-key-hex",
    "signature": "encoded-signature",
    "payload": "canonical-signed-message"
  }
}
```

The timestamp above is illustrative.

The maintainer public key is pinned in the immutable evidence policy. The contract must reject a request whose key differs from that value. The evaluator must verify the signed payload and ensure its contents match the supplied commitment, evaluation ID, policy version and digest, observation timestamp, and evidence digest.

The signed payload must not be reusable to refresh another commitment.

The v1 signed heartbeat payload is compact canonical JSON with this field order:

```json
{
  "schema": "lcp.heartbeat.v1",
  "commitment_id": "1",
  "evaluation_id": "4",
  "policy_version": 1,
  "policy_hash": "64-character-sha256-hex",
  "observed_at_ns": "1794090000000000000",
  "subject": "example-maintenance-program",
  "artifact_hash": "64-character-sha256-hex"
}
```

The maintainer signs the exact UTF-8 bytes of this JSON with Ed25519. `evidence_hash` is SHA-256 of those bytes. The outer evidence object contains `type`, `artifact_hash`, `maintainer_public_key`, `signature`, and the payload string, in that order. Hash strings use lowercase hexadecimal; timestamps and IDs use canonical decimal strings. Commitment subjects are limited to printable ASCII so Rust and TypeScript produce the same canonical payload bytes.

## 6.3 Evaluator output schema

```json
{
  "schema": "lcp.evaluation.verdict.v2",
  "request_transaction_hash": "base58-encoded-NEAR-transaction-hash",
  "commitment_id": "1",
  "evaluation_id": "4",
  "policy_version": 1,
  "policy_hash": "64-character-sha256-hex",
  "input_hash": "64-character-sha256-hex",
  "evidence_hash": "64-character-sha256-hex",
  "observed_at_ns": "1794090000000000000",
  "verdict": "Compliant",
  "reason_codes": ["SIGNATURE_VALID", "ARTIFACT_PRESENT"]
}
```

Allowed verdicts:

- `Compliant`
- `NonCompliant`

Unknown values must be rejected.

## 6.4 Canonical serialization

Use one deterministic serialization function for evaluator inputs.

The contract hashes the exact UTF-8 bytes passed as `input_data`.

Do not calculate a digest from one JSON serialization and send a differently ordered or formatted serialization to OutLayer.

The evaluator must echo the expected identifiers and input digest.

The callback compares these fields against the stored pending request.

The contract reserves storage for each bounded evaluation record before dispatching OutLayer. At most 64 requests are retained per commitment, and callback reason codes are limited to 16 uppercase ASCII codes of at most 64 bytes each. Timeout, failure, and rejected results release the pending lock without changing evidence freshness.

Challenge history and budget programs are also bounded to 64 records/epochs per commitment. The contract keeps a monotonic observation timestamp after a challenge invalidates an observation, so an older timestamp cannot be reused to restore eligibility.

---

# 7. OutLayer Integration Contract

## 7.1 Documented endpoint

**Receiver:** `outlayer.testnet`

**Method:** `request_execution`

The v0.1 policy accepts `outlayer.testnet` or `outlayer.near`, `wasm32-wasip1` or `wasm32-wasip2`, and documented limits up to 500 billion instructions, 4096 MB, and 180 seconds. The hackathon deployment uses the testnet receiver.

The documented interface accepts:

- `source`
- `resource_limits`
- `input_data`
- `response_format`
- Optional payment and secret parameters.

The MVP will use `WasmUrl` to pin the exact evaluator binary.

## 7.2 Proposed request payload

```json
{
  "source": {
    "WasmUrl": {
      "url": "https://test.fastfs.io/.../evaluator.wasm",
      "hash": "64-character-sha256-hex",
      "build_target": "wasm32-wasip2"
    }
  },
  "resource_limits": {
    "max_instructions": 1000000000,
    "max_memory_mb": 128,
    "max_execution_seconds": 30
  },
  "input_data": "{\"schema\":\"lcp.evaluation.request.v1\",...}",
  "response_format": "Json"
}
```

The URL and hash are deployment configuration values, not placeholders to ship.

The actual build target must match the compiled WASM.

## 7.3 NEAR promise sequence

Conceptually:

```text
LCP.request_evaluation()
    |
    | save Pending request
    |
    v
outlayer.testnet.request_execution()
    |
    | TEE executes pinned WASM
    |
    v
LCP.on_outlayer_result()
    |
    | validate result
    |
    +--> Accepted -> update evidence state
    |
    +--> Failed/Rejected -> preserve old evidence age
```

The implementation should follow OutLayer's documented NEAR promise pattern.

LCP does not need to implement a separate low-level yield/resume transport when the OutLayer contract already provides the required integration.

## 7.4 Private callback

Proposed signature:

`on_outlayer_result(commitment_id, evaluation_id)`

Requirements:

- Must be callable only through the expected private callback path.
- Must inspect the result of the preceding OutLayer promise.
- Must locate the exact pending request.
- Must reject obsolete or mismatched requests.
- Must not accept the same result twice.
- Must not panic after partially mutating settlement-related state.
- Must record a failed result without extending evidence freshness.

## 7.5 Callback validation order

1. Verify the callback's private invocation context.
2. Load the commitment and request.
3. Confirm the request is Pending.
4. Confirm it is the commitment's current pending request.
5. Confirm policy version and digest.
6. Confirm the preceding promise succeeded.
7. Parse the actual OutLayer return encoding.
8. Decode the originating transaction hash supplied by the evaluator.
9. Validate the verdict schema.
10. Confirm commitment and evaluation IDs.
11. Confirm input and evidence digests.
12. Validate source timestamp.
13. Apply the verdict and store the transaction hash.
14. Clear pending request.
15. Emit the appropriate event.

**Integration note:** The exact byte encoding returned by OutLayer's `Json` response format must be confirmed with a real testnet execution. Do not assume raw stdout bytes and NEAR's serialized return value are identical.

## 7.6 Source freshness validation

For a compliant verdict, require:

- `observed_at <= current_block_time`
- `current_block_time - observed_at <= max_source_lag`
- `current_block_time < observed_at + evidence_ttl`
- `observed_at` is newer than the previous accepted evaluation observation.
- The evidence hash matches the pending request.

The evaluator is responsible for checking source provenance.

The contract is responsible for checking temporal eligibility and request binding.

## 7.7 Evaluation timeout

Each request has a timeout.

A failed or timed-out request:

- Becomes Failed or TimedOut.
- Releases the commitment's pending-request lock.
- Does not update `last_good`.
- Does not reset `negative_since`.
- Does not extend the freshness deadline.

A late result from an expired request must be rejected.

## 7.8 Attestation verification

OutLayer's execution produces a TEE attestation that can be inspected independently.

The protocol's on-chain acceptance relies on the documented OutLayer contract and execution path; LCP does not independently verify a complete Intel TDX quote in v0.1.

The evaluator reads OutLayer's `NEAR_TRANSACTION_HASH` execution environment value and returns it in its verdict. The LCP callback validates and stores it as lowercase hexadecimal, and the SDK exposes it for a NEAR Explorer link plus `outlayer-verify tx <base58-hash> --network <network>`. Pending or failed executions without a valid verdict have no transaction hash.

OutLayer documents transaction-hash lookup for on-chain executions and recovery of request and response data from NEAR. Live integration must still confirm that this LCP promise chain resolves to the expected job and attestation.

An optional indexer may store that mapping, but it must not become the authority for health or settlement.

---

# 8. Evaluator WASM Specification

## 8.1 Runtime

Rust compiled for the OutLayer-supported WASI target.

The executable:

- Reads one JSON request from stdin.
- Validates its schema.
- Validates the evidence signature.
- Checks the evidence's commitment binding.
- Checks the artifact digest format.
- Produces one JSON verdict on stdout.
- Uses a nonzero exit code for malformed requests or internal errors.

## 8.2 Demonstration evidence

The initial evaluator validates a signed maintenance heartbeat.

This proves that a designated maintainer submitted a properly bound statement.

It does not independently prove service uptime.

The demo must describe this as a controlled evidence source.

## 8.3 Evaluator determinism

For identical inputs, the evaluator should produce identical verdicts.

The evaluator should not use:

- Random values.
- Unpinned external dependencies.
- Mutable external API responses.
- Its own wall-clock time as the authoritative freshness clock.

The contract determines freshness using NEAR time.

## 8.4 Evaluator security tests

- Valid signature.
- Invalid signature.
- Wrong commitment ID.
- Wrong policy hash.
- Modified artifact digest.
- Replayed payload with wrong evaluation ID.
- Missing required fields.
- Unsupported schema version.
- Malformed JSON.
- Oversized input.

---

# 9. Financial Model

## 9.1 Escrow allocation

A commitment specifies:

- `max_epochs`
- `epoch_ns`
- `tranche_yocto`
- `beneficiary`

Required escrow:

`required_escrow = max_epochs × tranche_yocto`

For the v0.1 contract, `max_epochs` is limited to 64 so tranche history remains bounded.

Use checked multiplication.

The sponsor must fund the required amount before activation.

## 9.2 Epoch calculation

For an active commitment:

`elapsed = now - activated_at`

`current_epoch = floor(elapsed / epoch_ns)`

The epoch is eligible only if:

`current_epoch < max_epochs`

Only the current epoch can be claimed.

Earlier unclaimed epochs are not retroactively payable.

## 9.3 Claim authorization

A tranche claim is permitted only when:

- Lifecycle is Active.
- Current effective health is Healthy.
- No blocking challenge is open.
- The governing compliant evaluation's challenge window has elapsed.
- The epoch is within the funded program.
- The epoch has not been paid or placed in pending settlement.
- The commitment has sufficient unallocated escrow.
- The intended beneficiary matches the immutable budget policy.

## 9.4 Escrow accounting

Maintain four amounts:

- `escrow_funded`
- `escrow_paid`
- `escrow_refunded`
- `escrow_pending`

Define:

`escrow_free = funded - paid - refunded - pending`

`escrow_liability = funded - paid - refunded`

Invariant:

`funded = paid + refunded + pending + free`

All arithmetic must be checked.

## 9.5 Transfer lifecycle

```text
Unclaimed
    |
    | valid claim
    v
Pending
    |
    +---- transfer succeeds ----> Paid
    |
    +---- transfer fails -------> Failed
```

When initiating a transfer:

- Mark the tranche Pending.
- Allocate a unique transfer ID.
- Increase `escrow_pending`.
- Persist the pending transfer.
- Initiate the NEAR transfer.
- Attach a private callback.

On successful callback:

- Decrease `escrow_pending`.
- Increase `escrow_paid`.
- Mark tranche Paid.
- Remove the pending transfer.

On failed callback:

- Decrease `escrow_pending`.
- Mark tranche Failed.
- Remove the pending transfer.
- Permit a retry only while the same epoch remains eligible.

## 9.6 Asynchronous balance accounting

While a NEAR transfer is in flight, the contract's account balance may already reflect the outgoing amount before the callback reconciles its accounting.

Solvency checks must account for pending outgoing transfers.

The implementation must not naïvely compare the current account balance with the full escrow liability without considering in-flight transfers.

## 9.7 Evaluation funding

OutLayer execution fees must be funded separately from commitment escrow.

The MVP will use a bounded operations budget:

- Sponsor deposits an operations allowance.
- Each authorized evaluation reserves a maximum execution fee.
- Evaluation count and concurrency are limited.
- The contract never intentionally spends escrow allocations on evaluator execution.

Unused OutLayer refunds may return to the contract.

For v0.1, conservative accounting will not automatically recredit refunds as available operations budget. The handling of residual operations funds must be documented as a prototype limitation and reconciled before production use.

## 9.8 Storage solvency

The contract must maintain sufficient balance for NEAR storage requirements and a safety reserve.

Before initiating an external payment, verify that the outgoing amount does not compromise reserved escrow or required storage backing.

The exact solvency formula must be tested using actual NEAR runtime balances, including pending transfers and execution refunds.

---

# 10. Challenges

## 10.1 Opening a challenge

A named sponsor or maintainer may challenge the latest accepted compliant evaluation within its challenge window.

The challenge must reference a specific evaluation ID.

A valid challenge immediately blocks tranche claims.

## 10.2 Resolution

The designated arbiter may:

- Uphold the evaluation.
- Invalidate the evaluation.

If upheld:

- Close the challenge.
- Preserve the evaluation.
- Recompute current health before any later consequence.

If invalidated:

- Close the challenge.
- Invalidate the governing evidence for eligibility.
- Enter AtRisk, using the resolution time as the negative-condition anchor.
- Require fresh compliant evidence for recovery.

## 10.3 Timeout

A challenge has a finite resolution deadline.

If unresolved:

- The challenged evaluation cannot authorize a new tranche.
- The challenge is marked TimedOut.
- The disputed evidence is treated as invalid for financial eligibility.
- Remaining funds follow the predefined closure and refund policy.

## 10.4 Challenge-window boundary

A claim cannot execute before the applicable challenge window ends.

The policy validator must require `max_source_lag_ns + challenge_window_ns < evidence_ttl_ns`, so an observation at the maximum allowed source lag can remain Healthy through the challenge window.

---

# 11. Public Contract API

## 11.1 Mutating methods

| Method | Caller | Effect |
|---|---|---|
| `create_commitment` | Creator | Creates Draft |
| `fund_commitment` | Sponsor | Deposits escrow |
| `fund_operations` | Sponsor | Deposits evaluation budget |
| `activate_commitment` | Authorized participant | Activates funded commitment |
| `request_evaluation` | Sponsor or maintainer | Starts OutLayer execution |
| `on_outlayer_result` | Private callback | Accepts or rejects result |
| `expire_evaluation` | Anyone | Clears timed-out request |
| `challenge_evaluation` | Authorized party | Opens challenge |
| `resolve_challenge` | Arbiter | Applies challenge decision |
| `expire_challenge` | Anyone | Applies timeout fallback |
| `claim_tranche` | Beneficiary | Initiates eligible payment |
| `on_tranche_transfer` | Private callback | Reconciles transfer |
| `close_commitment` | Authorized participant | Closes eligible commitment |
| `refund_remaining` | Sponsor | Refunds eligible residual escrow |

## 11.2 View methods

| Method | Output |
|---|---|
| `get_commitment` | Commitment summary |
| `get_policy` | Current immutable policy |
| `get_effective_health` | Current time-derived health |
| `get_latest_evaluation` | Most recent accepted evaluation |
| `get_evaluation` | Specific evaluation |
| `get_challenge` | Challenge status and optional exact completion timestamp |
| `get_current_epoch` | Current budget epoch |
| `can_claim_tranche` | Eligibility and blocking reason |
| `get_escrow_status` | Funding and settlement accounting |

## 11.3 API conventions

- Use decimal strings for JSON-exposed large integers.
- Use stable enum names.
- Include schema versions in complex payloads.
- Return structured errors where practical.
- Avoid unbounded collection reads.
- Do not expose privileged callbacks as normal user actions.

---

# 12. First Test Suite

The first milestone is not a frontend.

It is a passing state-machine test suite.

## 12.1 Temporal unit tests

| Test | Expected |
|---|---|
| `healthy_before_ttl` | Healthy |
| `at_risk_exactly_at_ttl` | AtRisk |
| `breached_exactly_at_grace_end` | Breached |
| `no_evidence_before_initial_deadline` | AwaitingEvidence |
| `no_evidence_after_initial_deadline` | AtRisk |
| `no_evidence_after_initial_grace` | Breached |
| `negative_verdict_immediate_risk` | AtRisk |
| `repeated_negative_does_not_extend_grace` | Original breach deadline preserved |
| `fresh_positive_recovers` | Healthy |
| `stale_positive_does_not_recover` | Remains non-Healthy |
| `future_observation_rejected` | Rejected |
| `older_observation_rejected` | Rejected |
| `recovery_disabled_latches_breach` | Breached |
| `closed_never_recovers` | Closed |
| `timestamp_overflow_rejected` | Rejected |

## 12.2 Evaluation security tests

| Test | Expected |
|---|---|
| `unauthorized_requester` | Rejected |
| `duplicate_pending_request` | Rejected |
| `wrong_commitment_in_callback` | Rejected |
| `wrong_request_id` | Rejected |
| `wrong_policy_hash` | Rejected |
| `wrong_input_hash` | Rejected |
| `wrong_evidence_hash` | Rejected |
| `replayed_callback` | Rejected |
| `expired_request_callback` | Rejected |
| `failed_outlayer_promise` | No freshness extension |
| `malformed_verdict` | Rejected |
| `unauthorized_direct_callback` | Rejected |

## 12.3 Financial tests

| Test | Expected |
|---|---|
| `claim_when_healthy` | Allowed after challenge window |
| `claim_when_at_risk` | Rejected |
| `claim_when_breached` | Rejected |
| `claim_during_challenge` | Rejected |
| `claim_before_challenge_window_end` | Rejected |
| `claim_twice_same_epoch` | Rejected |
| `claim_missed_prior_epoch` | Rejected |
| `claim_beyond_max_epochs` | Rejected |
| `claim_insufficient_escrow` | Rejected |
| `failed_transfer_restores_allocation` | Correct accounting |
| `successful_transfer_marks_paid` | Correct accounting |
| `duplicate_transfer_callback` | No double accounting |
| `escrow_never_funds_evaluation` | Escrow remains reserved |
| `refund_does_not_exceed_residual` | Correct accounting |

## 12.4 Challenge tests

- Unauthorized challenger rejected.
- Challenge outside window rejected.
- Challenge on wrong evaluation rejected.
- Concurrent challenge rejected.
- Unauthorized arbiter rejected.
- Uphold preserves valid evidence.
- Invalidation removes financial eligibility.
- Timeout blocks disputed evaluation.
- Resolution does not authorize an expired evaluation.

## 12.5 Test execution layers

**Unit tests**

Pure temporal and policy logic.

**Contract integration tests**

NEAR storage, access control, promises, and transfer callbacks.

**OutLayer integration test**

Real testnet execution with pinned WASM.

**End-to-end test**

Browser and wallet flow for Healthy → Breached → Recovered.

---

# 13. Repository Architecture

```text
living-commitments/
├── contracts/
│   └── lcp-core/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── models.rs
│           ├── policy.rs
│           ├── temporal.rs
│           ├── evaluation.rs
│           ├── outlayer.rs
│           ├── challenge.rs
│           ├── escrow.rs
│           ├── consequences.rs
│           ├── events.rs
│           └── errors.rs
├── evaluators/
│   └── maintenance-heartbeat/
│       ├── Cargo.toml
│       └── src/
│           └── main.rs
├── packages/
│   ├── sdk/
│   │   └── src/
│   └── schemas/
├── apps/
│   └── demo/
├── tests/
│   ├── integration/
│   └── e2e/
├── spec/
│   ├── state-machine.md
│   ├── evaluator-schema.md
│   ├── security-invariants.md
│   └── trust-model.md
├── scripts/
├── README.md
└── LICENSE
```

## 13.1 Package responsibilities

**`lcp-core`**

All authoritative state and settlement logic.

**`maintenance-heartbeat`**

Minimal hash-pinned OutLayer evaluator.

**`sdk`**

Typed calls, views, and event parsing.

**`schemas`**

Canonical JSON definitions shared across contract tooling, evaluator, and frontend.

**`demo`**

A thin interface around protocol functions.

---

# 14. Development Sequence

**Repository status (2026-11-09):** Milestones A through E have initial implementations for OutLayer request/callback/timeout, bounded evaluation history, challenge resolution, health-gated tranche claims, transfer reconciliation, and closure/refunds. The SDK provides typed contract calls and finalized NEAR JSON-RPC reads with an injected wallet sender. The demo supports testnet commitment creation/funding/activation, externally signed evaluations, challenge actions, up to ten recent evaluations, eligible claims and retries, closure, and escrow refunds. The health timeline reconstructs recent transitions and separates recorded events from policy-derived deadlines. The OutLayer panel reports public-record availability and hash bindings while leaving quote verification to OutLayer's Verify report or standalone tool. The optional challenge completion timestamp uses a reserved raw-storage slot and does not alter persisted contract state layout. The updated contract is deployed as `4ycAFEtJryaNGUSMd76rWWxSoEAqqRHPrYtkdWZVHMk3`; state was preserved, and commitment `22` demonstrates a timestamped invalidation/recovery timeline that the user confirmed in the browser. Testnet evidence covers a PROVEN OutLayer evaluation, evaluator failure modes, breach/recovery, failed-transfer retry, arbiter outcomes, payout/refund, and pagination. The full wallet transaction journey and natural temporal cohort boundaries remain open.

## Milestone A — Pure engine

Implement:

- Rust models.
- Policy validation.
- `effective_health`.
- Temporal unit tests.

**Definition of done:** Every temporal boundary test passes.

## Milestone B — NEAR state

Implement:

- Contract initialization.
- Commitment creation.
- Funding.
- Activation.
- View methods.

**Definition of done:** A funded commitment activates on testnet.

## Milestone C — OutLayer

Implement:

- Evaluator WASM.
- Published evaluator hash.
- Request serialization.
- OutLayer promise call.
- Private callback.
- Result validation.

**Definition of done:** A real OutLayer verdict changes the commitment's evidence state.

## Milestone D — Consequences

Initial source implementation covers epoch calculation, health-gated claims, escrow accounting, transfer callbacks, and residual escrow refunds after closure. Testnet confirms a breached claim is rejected, a healthy tranche pays a distinct beneficiary and reconciles, and an unused escrow refund reconciles after closure. Failed-transfer recovery and broader accounting cases remain open.

Implement:

- Epoch calculation.
- Health-gated claims.
- Escrow accounting.
- Transfer callbacks.
- Refund path.

**Definition of done:** A valid tranche succeeds and an invalid tranche fails on testnet.

## Milestone E — Recovery and challenge

Initial source implementation covers positive-evidence recovery, challenge opening/resolution, arbiter timeout, and invalidation of challenged evidence. Testnet confirms recovery from `Breached` to `Healthy` and timeout of an open challenge invalidating its evidence. Arbiter uphold/invalidate outcomes and additional health boundaries remain unverified.

Implement:

- Negative evidence handling.
- Recovery.
- Challenge opening.
- Resolution.
- Timeout fallback.

**Definition of done:** A commitment breaches, blocks payment, recovers, and permits a future payment.

## Milestone F — Public demo

Implement:

- Wallet connection.
- Commitment detail.
- Evidence submission.
- Health timeline.
- Tranche claim.
- OutLayer attestation link.

**Definition of done:** The complete lifecycle is reproducible without CLI intervention.

---

# 15. Security Review Checklist

Before deployment, verify:

- Every external callback is appropriately restricted.
- Every evaluation is bound to the correct request.
- Every evaluation uses the active policy version.
- Every accepted observation satisfies source freshness limits.
- Negative evaluations cannot repeatedly extend grace.
- Recovery cannot bypass a permanent breach.
- Challenge windows cannot be bypassed.
- No payment relies only on a stored Healthy label.
- No tranche can be settled twice.
- Failed transfers do not corrupt escrow accounting.
- OutLayer execution fees cannot consume reserved escrow.
- Storage requirements remain funded.
- All financial arithmetic is checked.
- No administrator can withdraw escrow arbitrarily.
- The deployed WASM hash matches the published source build.
- The evaluator's exact input/output can be independently inspected.
- The trust model is documented accurately.

---

# 16. Open Integration Checks

These are the remaining implementation-level unknowns, not unresolved product strategy.

**OUT-001 — Callback encoding — RESOLVED (2026-11-08)**

The live testnet callback decoded and accepted the `response_format: Json` verdict.

**OUT-002 — Execution identity — RESOLVED (2026-11-08)**

The callback stored the originating request transaction hash. `outlayer-verify tx` recovered that transaction's request and response and reported `PROVEN`; see `TESTNET-E2E-STATUS.md`.

**OUT-003 — Execution fee behavior — TESTNET CHARGES MEASURED; RESIDUAL ACCOUNTING LIMITATION REMAINS**

Finalized receipts show the configured `0.01 NEAR` OutLayer deposit on commitment `19` was charged `0.0010706002 NEAR` and refunded `0.0089293998 NEAR` to the contract. A JSON `null` result on commitment `5` charged `0.001 NEAR` and refunded `0.009 NEAR`; a one-yocto promise failure produced no OutLayer refund. LCP conservatively records each full configured deposit as authorized spend, so returned funds are not recredited to that commitment or refunded to its sponsor on close. This matches the documented v0.1 limitation, but production accounting needs a correlated refund/reconciliation path.

**OUT-004 — Promise gas — TESTNET SAMPLE HEADROOM MEASURED**

Across accepted, JSON-null, promise-failure, and timeout receipts, the 20 Tgas LCP callback used at most `2.889554002453 Tgas` (85.55% unused in the sampled maximum). The configured 100 Tgas OutLayer request used at most `4.340434640545 Tgas` in these samples. Maximum-size output and stress-load measurements remain open; these samples do not establish production gas limits.

**OUT-005 — Timeout behavior**

An intentionally mismatched evaluator digest produced JSON `null` under the initial callback and was recorded as `Rejected / MALFORMED_VERDICT`. The updated callback was then verified live: JSON `null` was recorded as `Failed / MISSING_OUTLAYER_RESULT`, retaining its output hash. A second request remained pending past its deadline and later finalized as `TimedOut / OUTLAYER_TIMEOUT`. An underfunded OutLayer execution produced a genuine promise failure and was recorded as `Failed / OUTLAYER_EXECUTION_FAILED`.

**NEAR-001 — Storage reserve — TESTNET HISTORY AND CHALLENGE TIMESTAMP SLOT MEASURED**

Finalized views at block `276853449` reported storage bonds of `0.02738 NEAR` for commitment `8` (one evaluation and challenge), `0.04377 NEAR` for commitment `9` (two evaluations and challenge), `0.0286 NEAR` for closed commitment `19` (one evaluation and payout/refund), and `0.00869 NEAR` for commitment `21` (no evaluation). The updated contract is deployed in [transaction `6md8rayhN3WmiMEP8dGgUyVYUowkBciovGr2Kppdx9cF`](https://testnet.nearblocks.io/txns/6md8rayhN3WmiMEP8dGgUyVYUowkBciovGr2Kppdx9cF), and the two-evaluation/one-challenge recovery fixture `22` reports a total storage deposit of `0.04432 NEAR`. That total covers all retained commitment data, not only the timestamp slot. The contract measures storage growth when each challenge opens, and local tests confirm the reserved completion slot is overwritten without further storage growth. Pre-upgrade challenges return `completed_at_ns: null` because their completion time was not stored.

**NEAR-002 — Transfer accounting — FAILED-TRANSFER RECOVERY VERIFIED (2026-11-08)**

Successful beneficiary payment and sponsor refund reconciled through asynchronous callbacks on testnet. A feature-gated isolated fixture also verified failed-transfer recovery, restored claim eligibility, successful retry, and duplicate-callback idempotency. Receipts are in `TESTNET-E2E-STATUS.md`; broader stress testing across repeated retries remains outside the completed path.

**NEAR-003 — Final SDK compatibility — RESOLVED (2026-11-08)**

NEAR SDK, Rust toolchain, WASI target, and dependency lockfiles are pinned; the deployed contract and evaluator executed successfully on testnet.

No production-readiness claim may be made until these checks pass.

---

# 17. Immediate Engineering Tasks

**Task 009 — Validate the financial consequence on testnet — CORE PATH VERIFIED**

The breached-claim rejection, healthy distinct-beneficiary payout/callback, closure, sponsor refund, and isolated failed-transfer recovery/retry all succeeded. Receipts are in `TESTNET-E2E-STATUS.md`.

**Task 010 — Complete breach and recovery validation — LIVE CORE PATH VERIFIED; NATURAL COHORT BOUNDARIES OPEN**

Evidence expiry, breached-claim rejection, fresh-evidence recovery, challenge timeout, and upheld/invalidated arbiter outcomes were exercised. Exact local temporal boundaries have deterministic tests. The short-horizon playground cohort is still being observed for natural expiry and grace transitions.

**Task 011 — Improve commitment discovery — CONTRACT DEPLOYED; RPC AND BROWSER PAGINATION VERIFIED**

The contract exposes a capped newest-first listing by sequential commitment ID; the SDK wraps it and the demo provides ten-record pages with an exclusive cursor. Testnet RPC confirmed descending/exclusive pagination, and the user confirmed the browser older-page control across all 21 records.

**Task 012 — Finish the public demo journey — IN PROGRESS**

The app now reconstructs recent historical health transitions, shows policy-derived current deadlines, and reports OutLayer public-record availability and digest bindings. The user confirmed that commitment `22` displays the invalidation/recovery sequence, upcoming freshness/grace boundaries, and matching public-record hashes. The app does not claim to verify the TEE quote; OutLayer's report and standalone verifier remain the cryptographic verification path. The testnet update and dedicated fixture are complete. The full create/fund/activate/evidence/claim/retry/close/refund journey still needs user-driven browser validation.

---

# 18. Definition of Done

LCP Technical Specification v0.1 is implemented when:

- The Rust state model compiles.
- All temporal unit tests pass.
- A commitment activates on NEAR testnet.
- A real OutLayer execution returns a validated verdict.
- Evidence expires according to the contract's policy.
- The commitment becomes AtRisk and then Breached.
- A financial claim is rejected while Breached.
- Fresh evidence restores Healthy.
- An eligible future claim succeeds.
- Double settlement and callback replay are rejected.
- The public repository documents the implementation and its limitations.

**Final engineering principle:**

The evaluator reports evidence.

The temporal engine determines health.

The consequence layer enforces rights.

**No layer may bypass the others.**
