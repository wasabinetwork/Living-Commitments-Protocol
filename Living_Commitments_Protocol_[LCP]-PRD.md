# Living Commitments Protocol

## Product Requirements Document — v0.2

**Status:** Research-aligned, ready for technical specification<br>**Target:** NEAR Hackathon 2026<br>**Submission deadline:** November 14, 2026, 23:59 UTC<br>**Primary track:** Open Innovation<br>**Secondary track candidate:** Social Money<br>**Conditional track candidate:** Privacy & Private AI, only if confidential TEE evaluation is demonstrated<br>**Implementation network:** NEAR testnet<br>**Product category:** Programmable, continuously verified commitments infrastructure

---

# 1. Executive Summary

## 1.1 The product

**Living Commitments Protocol (LCP)** is an open, NEAR-native protocol for representing obligations that must **remain true over time**.

Unlike conventional smart contracts that execute when a one-time condition is satisfied, a Living Commitment maintains an evolving state based on evidence freshness, verification results, challenges, recovery policies, and elapsed time.

A Living Commitment can be:

* Healthy when its conditions are supported by sufficiently fresh evidence.
* At Risk when evidence becomes stale, missing, or noncompliant.
* Challenged when an authorized participant disputes its evidence or evaluation.
* Breached when its conditions remain unsatisfied beyond an agreed grace period.
* Recovered when new valid evidence satisfies its recovery policy.

These states govern executable consequences.

A commitment may control access to a budget, eligibility for a role, authorization to perform an action, or other rights through independent consequence adapters.

The protocol is not specific to grants, DAOs, environmental stewardship, AI agents, or any single application.

## 1.2 Core thesis

> **Blockchains are excellent at proving what happened. Living Commitments lets NEAR govern what must remain true.**

The innovation is not evidence verification alone, conditional payment alone, or permission management alone.

It is the combination of:

1. Persistent commitment identity.
2. Temporal evidence policies.
3. Verifiable off-chain evaluation.
4. Deterministic, evolving on-chain state.
5. Challenge and recovery procedures.
6. Enforceable consequences.
7. Application-independent interfaces.

## 1.3 The defining product experience

A community funds the ongoing maintenance of open-source infrastructure.

The maintainer begins in a Healthy state because current evidence satisfies the agreed policy.

As the evidence ages, the commitment moves toward At Risk. If no qualifying evidence arrives during the grace period, it becomes Breached.

While the commitment is no longer Healthy, new budget releases are blocked.

A fresh, valid evaluation can restore the commitment to Healthy if recovery is permitted.

The protocol records the complete history and enforces the consequences without requiring a centralized administrator to interpret the agreement.

**This is a continuously maintained relationship, not a completed milestone.**

## 1.4 Hackathon objective

Deploy a real NEAR contract that demonstrates:

**Create → Verify → Healthy → Evidence Expires → At Risk → Breached → Consequence Enforced → Fresh Evidence → Recovered**

At least one verification cycle must use a real OutLayer TEE evaluator, with an independently inspectable execution record.

At least one consequence must be enforced by a NEAR smart contract using real testnet funds or a real contract-gated capability.

The implementation must remain independently usable without the demonstration frontend.

---

# 2. Research Basis and Competitive Positioning

## 2.1 Why this product exists

The research reviewed a snapshot of 252 NEAR hackathon submissions, sponsor capabilities, NEAR ecosystem directories, and comparable Web3 protocols.

Its principal findings were:

* AI-agent wallet guards and spending controls are heavily crowded.
* Milestone escrow and evidence-gated payments already have meaningful competition.
* Functional NFTs and asset passports have established prior art.
* DAO treasury and governance infrastructure already exists.
* The strongest opportunity is a general-purpose primitive combining **temporal evidence, attested evaluation, persistent state, challenge/recovery, and programmable consequences**.

The submission snapshot contains names and tracks rather than complete project implementations. Therefore, collision analysis is directional rather than proof of identical functionality.

## 2.2 What LCP is not

| Existing category | Typical question | LCP's different question |
| --- | --- | --- |
| Milestone escrow | Was the deliverable approved? | Is the obligation still being maintained? |
| Oracle | What fact did the data source report? | What does that fact mean over time under this agreement? |
| Credential | What has this actor proven? | What is this actor still entitled to do? |
| Wallet guard | Is this transaction allowed now? | Is the underlying authorization relationship still valid? |
| DAO governance | Did members approve this proposal? | Are the ongoing conditions of the approved mandate being satisfied? |
| Monitoring dashboard | Is a service healthy? | What binding consequences follow from its health state? |

## 2.3 Defensible novelty claim

LCP proposes a general-purpose NEAR protocol combining:

**Time-bounded evidence + verifiable computation + evolving commitment state + challenges and recovery + executable consequences.**

The project must not claim that continuous verification, TEE computation, escrow, programmable roles, or governance policies are individually unprecedented.

Its differentiation is their integration into a reusable commitment primitive.

## 2.4 Relationship to existing ecosystem infrastructure

LCP should create demand for existing NEAR capabilities, not replace them.

| Infrastructure | Role in LCP |
| --- | --- |
| NEAR smart contracts | Authoritative commitment state and consequences |
| NEAR Yield/Resume | Asynchronous verification workflow |
| OutLayer | Attested off-chain WASM evaluation |
| NEAR access keys | Future programmable authority integrations |
| NEAR Chain Signatures | Future external-chain authority and action adapters |
| NEAR Intents | Future cross-chain funding and settlement adapters |
| Trezu | Future organizational treasury integration |
| SputnikDAO | Future governance and authorization integration |
| NEAR AI | Future evidence analysis and policy assistance |

Only integrations actually demonstrated and verified may be included in hackathon claims.

---

# 3. Product Vision and Principles

## 3.1 Long-term vision

Make continuously verified commitments a standard primitive for decentralized coordination.

Applications should be able to declare:

> This actor, organization, asset, or program remains eligible for a specified right while these evidence conditions remain satisfied.

The application should not have to build its own evidence freshness engine, challenge lifecycle, recovery policy, or consequence enforcement from scratch.

## 3.2 Design principles

**Continuity over completion.** The primary object is an ongoing condition, not a one-time deliverable.

**Evidence expires.** A historical proof does not automatically justify indefinite authority.

**Evaluation is accountable.** Every accepted evaluation is bound to an identifiable policy, input, and evaluator.

**Rules precede consequences.** Participants must know the conditions and outcomes before activation.

**State is deterministic.** The contract applies explicit transition rules; it does not make subjective judgments.

**No silent upgrades.** Changes to governing policies must be versioned and authorized.

**Challenge is a protocol capability.** Participants can contest evidence without granting an administrator unlimited power.

**Recovery is explicit.** A breach need not be permanent, but recovery must follow predefined rules.

**Fail closed for sensitive actions.** Missing, stale, disputed, or failed verification must not silently authorize new spending.

**Modularity.** The protocol defines commitment semantics; applications supply domain-specific evidence and consequences.

---

# 4. Target Users and Jobs to Be Done

## 4.1 Initial target users

**Community treasury operators**

"When we fund ongoing work, we want capital to remain conditional on continuing performance rather than a one-time approval."

**Open-source infrastructure teams**

"We need a verifiable way to maintain eligibility for a recurring maintenance budget."

**DAO delegates and program operators**

"We want authority to reflect current compliance with an agreed mandate."

**Public-goods funders**

"We need ongoing accountability without manually recreating a grant approval process every month."

## 4.2 Future users

* Infrastructure and validator operators.
* Renewable-energy and physical infrastructure programs.
* Research collaborations.
* Environmental stewardship initiatives.
* Equipment maintenance and warranty programs.
* Human–AI agent partnerships.
* Cross-chain organizations.

## 4.3 Initial reference application

**Open-source Infrastructure Maintenance Commitment**

A sponsor funds an ongoing maintenance budget.

The maintainer must periodically produce evidence that the service or project continues to satisfy its agreed conditions.

The commitment's health state determines whether the next budget tranche is available.

This scenario is selected because it is general-purpose, understandable, demonstrable within minutes, and not dependent on Kokonut-specific assumptions.

---

# 5. Core Protocol Primitives

LCP v0.2 defines seven primitives.

## 5.1 Commitment

A persistent on-chain identity for an ongoing obligation.

Required properties:

* Commitment ID.
* Subject identifier.
* Creator and designated parties.
* Policy version and digest.
* Activation and expiration rules.
* Current verification references.
* Lifecycle status.
* Challenge state.
* Consequence configuration.
* Event history.

A subject may represent a person, service, organization, asset, or program.

The protocol does not assume that the subject is an NFT or that it owns a wallet.

## 5.2 Policy

A bounded, machine-readable definition of what must remain true.

The MVP policy specifies:

* Required evidence type.
* The approved public key for the signed maintenance heartbeat.
* Approved evaluator.
* Evaluator WASM digest.
* Maximum permitted evidence age.
* Verification cadence or due date.
* Grace period.
* Breach conditions.
* Recovery eligibility.
* Challenge rules.
* Consequence conditions.

Policies are immutable within their active version.

## 5.3 Evidence Observation

A reference to data supporting or contradicting a commitment.

Fields include:

* Evidence ID.
* Commitment ID.
* Source identifier.
* Content digest.
* Source observation timestamp.
* Submission timestamp.
* Optional content URI.
* Provenance metadata.
* Applicable policy version.

Evidence is not automatically trusted merely because its digest is stored on-chain.

## 5.4 Evaluation

A structured verdict produced by an authorized evaluator.

Fields include:

* Evaluation ID.
* Commitment ID.
* Policy version and digest.
* Evaluator identity.
* Evaluator WASM digest.
* Request nonce.
* Input digest.
* Output digest.
* Evidence observation timestamp.
* Evaluation timestamp.
* Compliance verdict.
* Reason codes.
* Attestation reference, where available.

The contract must reject an evaluation that does not match the pending request and applicable policy.

## 5.5 Temporal State

The commitment's effective status at a particular time.

It is derived from accepted evidence, policy thresholds, and the blockchain timestamp.

A state-changing transaction is not required merely for time to pass.

## 5.6 Challenge and Recovery

Procedures for disputing an evaluation and restoring compliance.

Challenge and recovery are governed by predefined rules, not discretionary administrator powers.

## 5.7 Consequence

A contract-enforced effect resulting from the commitment's effective state.

Examples include:

* Permit a budget tranche.
* Deny a budget tranche.
* Permit a contract-gated operation.
* Suspend a capability.
* Emit an actionable status transition.
* Trigger an authorized external adapter.

The MVP implements one financial consequence end-to-end.

---

# 6. Temporal State Machine

## 6.1 Primary states

| State | Meaning |
| --- | --- |
| Draft | Commitment exists but is not activated |
| AwaitingEvidence | Active commitment has not yet received qualifying initial evidence |
| Healthy | Latest accepted evidence satisfies the policy and remains fresh |
| AtRisk | Evidence is missing, stale, or noncompliant, but the grace period has not elapsed |
| Breached | The policy's breach threshold has been reached |
| Closed | Commitment has reached its authorized terminal condition |

**Challenged** is modeled as a separate dispute flag, not as a replacement for health status.

**Recovered** is an auditable transition event, not a permanent health state. After successful recovery, the effective status is Healthy.

This separation prevents health, dispute, and settlement fields from contradicting one another.

## 6.2 Evidence freshness

For a qualifying observation:

`fresh_until = observed_at + max_age_seconds`

`breach_after = fresh_until + grace_seconds`

The evaluator must establish the observation time according to the source policy.

The contract must not treat the time an evaluation arrived as proof that the underlying source data is fresh.

### Example

A commitment requires fresh evidence every 60 seconds, with a 30-second grace period.

| Time | Effective state |
| --- | --- |
| Valid observation at 12:00:00 | Healthy |
| 12:00:45 | Healthy |
| 12:01:01 | AtRisk |
| 12:01:31 | Breached |
| New qualifying observation accepted at 12:01:40 | Healthy, if recovery is allowed |

The exact boundary comparisons must be specified and tested in the contract.

## 6.3 Missing initial evidence

A commitment with no accepted evidence remains AwaitingEvidence until its initial evidence deadline.

After that deadline:

* It becomes AtRisk during the grace period.
* It becomes Breached after the grace period.

## 6.4 Negative or contradictory evidence

For the MVP, an authenticated negative verdict immediately places the commitment in AtRisk.

If the issue remains unresolved beyond the configured grace period, the commitment becomes Breached.

A policy may eventually support immediate breach for critical failures, but this is not required for the first release.

## 6.5 Confidence

The research identifies confidence decay as an important future capability.

The MVP will **not** implement an arbitrary numeric confidence score.

Instead, it will use deterministic evidence validity, freshness, and compliance rules.

This preserves the temporal innovation without introducing an unaudited scoring system.

A future policy module may support weighted evidence, confidence thresholds, and contradictory-source reconciliation.

## 6.6 Effective versus recorded state

The protocol must expose:

* `get_effective_status(commitment_id)` — computes the status using current blockchain time.
* `get_commitment(commitment_id)` — returns stored commitment data.
* Structured events — record material transitions and actions.

A commitment can be effectively Breached because time has elapsed even if no transaction has yet emitted a breach event.

**All consequence methods must recompute effective status before acting.**

The frontend must not be the enforcement authority.

---

# 7. Evidence Evaluation and Attestation

## 7.1 The verification pipeline

 1. A participant or authorized automation service initiates an evaluation.
 2. LCP records a pending evaluation request.
 3. LCP invokes the configured OutLayer execution path.
 4. OutLayer executes the pinned WASM evaluator in its TEE environment.
 5. The evaluator inspects the supplied or fetched evidence.
 6. The evaluator returns a structured verdict.
 7. The NEAR callback processes the result.
 8. LCP validates the request identity, policy version, and expected execution context.
 9. The accepted result updates the commitment's evidence record.
10. The commitment's effective state changes according to the temporal policy.

## 7.2 OutLayer integration

The MVP should use the documented NEAR integration with OutLayer on testnet.

The evaluator's exact WASM bytes must be pinned by digest.

The implementation must not rely on an unpinned "latest" evaluator version for security-sensitive decisions.

Each evaluation request must bind:

* Commitment ID.
* Policy version.
* Policy digest.
* Request nonce.
* Expected evaluator digest.
* Evidence reference or input digest.
* Request timestamp.

The callback must reject:

* Unsolicited results.
* Duplicate results.
* Results for another commitment.
* Results for an outdated policy version.
* Results for an obsolete request.
* Malformed verdicts.
* Evaluations that exceed the permitted freshness constraints.

## 7.3 What attestation proves

OutLayer's attestation can establish that a particular WASM binary executed with particular inputs and produced a particular output inside an attested TEE environment.

It does **not** establish that:

* The evaluator's code is logically correct.
* The external data source is truthful.
* A reported real-world event actually occurred.
* The chosen policy is fair.
* The result is free of application-level vulnerabilities.

The PRD requires the team to distinguish **attested computation** from **verified real-world truth**.

## 7.4 On-chain trust boundary

LCP must integrate through the documented OutLayer contract and callback mechanism.

The team must verify exactly what is authenticated by that integration and what evidence remains independently verifiable off-chain.

The contract must not claim to verify an entire Intel TDX quote unless it actually performs or relies on a documented, valid verification path.

The UI should expose the execution and attestation reference so observers can inspect the proof.

## 7.5 Failure behavior

If an evaluation:

* Times out,
* Fails,
* Returns malformed output,
* Cannot be authenticated,
* Or references stale evidence,

it must not refresh the commitment's Healthy status.

The previous accepted evidence continues to age under its original freshness policy.

If no fresh valid evidence arrives, the commitment naturally progresses toward AtRisk and Breached.

## 7.6 MVP evidence fixture

The initial evaluator should process a simple, reproducible maintenance evidence format.

Suggested inputs:

* Maintainer identity.
* Signed maintenance heartbeat.
* Artifact digest.
* Observation timestamp.
* Optional repository or service reference.

The evaluator checks the specified conditions and returns a structured compliance verdict.

The demo may use a controlled evidence source for reproducibility, but it must clearly identify that source as a demonstration fixture rather than independent proof of real-world service quality.

---

# 8. Challenges and Recovery

## 8.1 Challenge model

An authorized participant may challenge a specific accepted evaluation within a configured window.

A challenge contains:

* Commitment ID.
* Target evaluation ID.
* Challenger.
* Reason code.
* Supporting evidence digest.
* Submission timestamp.

A valid challenge places affected consequences on hold.

## 8.2 MVP resolution

The initial policy designates an arbiter before activation.

The arbiter can:

* Uphold the challenged evaluation.
* Invalidate the challenged evaluation.

The arbiter cannot redirect escrow to an arbitrary address or rewrite unrelated policy terms.

A challenge timeout must be finite.

If the arbiter fails to respond, the fallback is conservative: no new tranche is authorized on the basis of the disputed evaluation. Funds follow the predefined expiry/refund rules.

## 8.3 Recovery

A Breached commitment may recover only when its policy permits recovery.

The MVP recovery process requires:

* A new evaluation request.
* Fresh qualifying evidence.
* A compliant verdict.
* No unresolved blocking challenge.
* A commitment that has not permanently closed.

Successful recovery returns the effective health state to Healthy and emits a recovery event.

## 8.4 No retroactive entitlement

Recovery does not automatically entitle a beneficiary to previously missed budget tranches.

The MVP uses a **no automatic catch-up** rule.

Future policies may define explicit arrears or remediation mechanisms.

This prevents recovery from silently reversing previously enforced consequences.

---

# 9. Executable Consequences

## 9.1 MVP consequence: health-gated recurring budget

The protocol manages a small escrowed budget divided into discrete epochs.

A beneficiary may claim an epoch's tranche only if:

* The commitment is active.
* The effective state is Healthy.
* The applicable evidence is fresh.
* No blocking challenge is open.
* The epoch is eligible.
* The tranche has not been claimed or settled.
* Sufficient allocated escrow remains.

A transaction that fails any condition must be rejected.

## 9.2 Why recurring budget gating matters

One-time milestone escrow demonstrates conditional payment.

A recurring budget whose eligibility disappears when evidence expires demonstrates a **persistent obligation with temporal consequences**.

That difference is essential to the product's competitive positioning.

## 9.3 Settlement mechanics

The MVP uses native NEAR.

The contract must:

* Track deposits and allocations.
* Lock a tranche before initiating transfer.
* Prevent duplicate claims.
* Handle asynchronous transfer outcomes.
* Mark settlement complete only after success.
* Restore an eligible retry state after failure.
* Maintain consistent escrow accounting.
* Provide an authorized path for remaining funds at closure.

## 9.4 Consequence adapters

The protocol architecture must distinguish the **decision** from the **effect**.

LCP determines whether a consequence is permitted.

An adapter performs the authorized effect.

Initial adapter:

* `NativeNearBudgetAdapter`

Future adapters:

* `ContractCapabilityAdapter`
* `DaoTreasuryAdapter`
* `AccessKeyAuthorityAdapter`
* `ChainSignatureAdapter`
* `IntentSettlementAdapter`

The core contract must not require these future integrations to exist.

## 9.5 Authority limitations

A generic LCP contract cannot arbitrarily revoke access keys belonging to unrelated NEAR accounts.

A future access-key adapter must operate only through accounts and contracts that have explicitly granted it the required authority.

The MVP should not imply that status changes automatically revoke arbitrary external permissions.

---

# 10. Policy Versioning and Amendments

## 10.1 Why versioning remains important

A living commitment changes its **state** as evidence changes.

That does not mean its governing **policy** may be changed freely.

These are different operations:

* **State transition:** Applies existing rules to new evidence or time.
* **Policy amendment:** Changes the rules themselves.

The protocol must preserve that distinction.

## 10.2 MVP requirement

Every commitment stores a policy version and immutable policy digest.

Every evaluation references the policy version under which it was produced.

Old evaluations cannot silently authorize actions under incompatible new rules.

## 10.3 Full amendment workflow

A complete consent-based amendment engine is deferred to P1.

It will support:

* Proposed policy revisions.
* Identification of affected parties.
* Approval of the exact new policy digest.
* Activation at a defined boundary.
* Preservation of prior policy versions.
* Re-evaluation of rights affected by the amendment.

No unilateral policy replacement is permitted in the MVP.

**Reason for this scope decision:** Continuous verification and recovery are the protocol's defining novelty. Full multi-party renegotiation should not displace them from the hackathon deliverable.

---

# 11. Functional Requirements

## 11.1 P0 — Required

| ID | Requirement | Acceptance test |
| --- | --- | --- |
| LCP-001 | Create a commitment | Valid policy produces a unique on-chain object |
| LCP-002 | Activate a commitment | Required authorization and funding conditions are satisfied |
| LCP-003 | Store temporal policy | Freshness, grace, and recovery rules are immutable under the active version |
| LCP-004 | Request evaluation | A uniquely identified request is dispatched to the configured evaluator |
| LCP-005 | Execute attested evaluation | At least one real OutLayer TEE execution completes on testnet |
| LCP-006 | Validate evaluation callback | Unauthorized, stale, duplicated, or mismatched results are rejected |
| LCP-007 | Track evidence freshness | Effective status changes as qualifying evidence ages |
| LCP-008 | Enter AtRisk | Missing or stale evidence produces the correct intermediate state |
| LCP-009 | Enter Breached | Unresolved noncompliance past grace produces Breached |
| LCP-010 | Recover | Fresh compliant evidence restores Healthy when allowed |
| LCP-011 | Enforce consequence | Healthy permits an eligible tranche; non-Healthy blocks it |
| LCP-012 | Handle challenges | A valid challenge blocks the affected consequence |
| LCP-013 | Protect escrow | Duplicate and unauthorized transfers are rejected |
| LCP-014 | Expose protocol state | Read methods return policy, evidence, effective status, and history references |
| LCP-015 | Emit audit events | Important transitions are externally inspectable |
| LCP-016 | Provide demo application | Full lifecycle can be demonstrated without manual contract calls |
| LCP-017 | Provide tests and documentation | Critical invariants and reproduction instructions are public |

## 11.2 P1 — If core is stable early

* Additional consequence adapter for contract-gated authority.
* Multiple independent evidence sources.
* Threshold-based reviewer or evaluator policies.
* Full consent-based policy amendments.
* Configurable evidence confidence.
* Reusable policy templates.
* Independent event indexer.
* More comprehensive private evidence handling.
* A second real-world use-case template.

## 11.3 P2 — After hackathon

* Constitution Compiler.
* Resilience Lab.
* Forkable Programs.
* NEAR Intents settlement integration.
* Chain Signatures authority integration.
* Trezu and SputnikDAO adapters.
* Cross-chain commitment subjects.
* Generalized obligation dependency graphs.
* AI-assisted policy creation and evaluation.
* Formal verification of selected policy invariants.

---

# 12. Smart Contract Data Model

## 12.1 Core entities

| Entity | Essential fields |
| --- | --- |
| Commitment | ID, subject, creator, parties, policy ID/version, activation, expiry, lifecycle |
| CommitmentPolicy | Digest, evaluator digest, freshness, grace, challenge, recovery, consequence rules |
| EvidenceObservation | ID, source, content digest, observed_at, submitted_at, provenance |
| EvaluationRequest | ID, commitment ID, nonce, policy version, input digest, status |
| EvaluationResult | Request ID, verdict, timestamps, reason codes, output digest, attestation reference |
| Challenge | ID, target evaluation, challenger, reason digest, status, deadline |
| BudgetAllocation | Commitment ID, epoch, beneficiary, amount, funding and settlement status |
| ConsequenceRecord | ID, type, commitment ID, state snapshot, outcome |
| AuditEvent | Type, commitment ID, actor, policy version, timestamp, payload |

## 12.2 Recommended contract modules

* `commitment.rs`
* `policy.rs`
* `temporal.rs`
* `evaluation.rs`
* `challenge.rs`
* `consequences.rs`
* `escrow.rs`
* `events.rs`
* `errors.rs`

These are proposed code boundaries, not mandatory file names.

## 12.3 Storage strategy

Keep authoritative policy, evidence references, evaluation state, and escrow accounting on-chain.

Store large evidence payloads and detailed TEE attestation materials off-chain with content-addressed references.

The protocol must expose enough information for independent reconstruction of decisions without requiring the original frontend.

---

# 13. Contract Interface — Proposed

## 13.1 Mutating methods

| Method | Function |
| --- | --- |
| `create_commitment` | Register a new commitment and policy |
| `activate_commitment` | Activate when prerequisites are satisfied |
| `fund_commitment` | Deposit native NEAR for budget allocations |
| `request_evaluation` | Initiate a verification cycle |
| `on_evaluation_result` | Private callback for the authorized asynchronous result |
| `challenge_evaluation` | Open an authorized challenge |
| `resolve_challenge` | Apply the predefined resolution policy |
| `claim_tranche` | Request a health-gated budget release |
| `on_tranche_transfer` | Reconcile asynchronous settlement result |
| `close_commitment` | Apply authorized terminal conditions |
| `refund_remaining` | Return eligible unspent escrow according to policy |

## 13.2 Read methods

* `get_commitment`
* `get_policy`
* `get_effective_status`
* `get_latest_evaluation`
* `get_evaluation_history`
* `get_challenge`
* `get_budget_status`
* `can_claim_tranche`
* `get_consequence_history`

## 13.3 Event schema

Versioned events should include:

* `commitment_created`
* `commitment_activated`
* `evaluation_requested`
* `evaluation_accepted`
* `evaluation_rejected`
* `health_changed`
* `evidence_expired`
* `challenge_opened`
* `challenge_resolved`
* `commitment_recovered`
* `tranche_claimed`
* `settlement_completed`
* `settlement_failed`
* `commitment_closed`

Time-derived status changes may exist before an event is emitted. The contract and UI must document this behavior clearly.

---

# 14. Technical Architecture

## 14.1 Core architecture

**Layer 1 — Applications**

Wallet-connected interfaces, community dashboards, SDK consumers, and future organizational integrations.

**Layer 2 — LCP Core**

Commitment identity, temporal policy, evaluation requests, health state, challenge/recovery, and consequence authorization.

**Layer 3 — Verifiable Evaluation**

OutLayer-hosted, hash-pinned WASM evaluator executed in an attested environment.

**Layer 4 — NEAR Execution**

Contract state, accounts, escrow, asynchronous calls, and settlement.

**Layer 5 — Future Adapters**

External treasury systems, capabilities, Intents, Chain Signatures, and other protocols.

## 14.2 Recommended implementation

**Smart contracts:** Rust with NEAR SDK.

**Evaluator:** Rust compiled to the WASM target supported by the selected OutLayer execution configuration.

**Client SDK:** TypeScript.

**Frontend:** Next.js, React, TypeScript.

**Wallet:** Compatible NEAR wallet connection library.

**Evidence:** Signed payloads and content digests, with optional externally hosted evidence.

**Tests:** Rust unit tests, NEAR integration tests, OutLayer integration test, and browser end-to-end tests.

## 14.3 Yield/Resume

The OutLayer NEAR integration is the preferred P0 path for asynchronous verification.

The team should use its documented request and callback interfaces rather than independently inventing a yield/resume transport.

A verification request may outlive the initial transaction execution context.

The implementation must explicitly handle failures, timeouts, and callback authentication.

## 14.4 Trust boundaries

**NEAR contract:** Trusted to enforce the implemented state machine, subject to contract correctness.

**OutLayer execution:** Trusted according to its attested worker and execution verification model.

**Evaluator WASM:** Must be reviewed; attestation does not prove its logic is correct.

**External evidence source:** Must be evaluated under the selected source and provenance policy.

**Automation service:** Untrusted for authorization; may only trigger permitted transitions.

**Frontend:** Presentation layer, never a source of financial authority.

---

# 15. Security and Protocol Invariants

## 15.1 Critical invariants

**INV-001 — Freshness enforcement**

No sensitive consequence may execute using evidence that is stale under the active policy.

**INV-002 — Policy binding**

Every accepted evaluation must reference the exact applicable policy version and digest.

**INV-003 — Evaluator binding**

An evaluation from an unauthorized or unexpected evaluator must not update the commitment.

**INV-004 — Request binding**

Evaluation results must be bound to the intended commitment and request nonce.

**INV-005 — Replay resistance**

A completed or superseded evaluation request cannot be accepted again.

**INV-006 — Challenge safety**

A blocking challenge prevents affected consequences from executing.

**INV-007 — Recovery authorization**

A Breached commitment may recover only under its predefined recovery policy.

**INV-008 — No silent policy mutation**

Active policies cannot be changed without the authorized versioning process.

**INV-009 — No duplicate settlement**

An epoch's budget tranche can be settled at most once.

**INV-010 — Escrow conservation**

Recorded allocations and completed transfers cannot exceed available escrow.

**INV-011 — Callback safety**

Failed asynchronous operations cannot produce false successful outcomes.

**INV-012 — Time-derived enforcement**

Every consequence checks the current effective state, not only the last stored status label.

**INV-013 — Fail-closed verification**

Missing, failed, or malformed evaluations never extend evidence validity.

**INV-014 — Finite dispute handling**

Challenge and expiry rules must provide a defined path to resolution or eligible refund; funds must not depend on an immortal pending state.

## 15.2 Adversarial test cases

* Replay a successful TEE verdict.
* Substitute a verdict from another commitment.
* Use an evaluator result for an obsolete policy version.
* Submit evidence whose source timestamp is too old.
* Submit evidence with a future source timestamp.
* Claim a tranche immediately after freshness expires.
* Open a challenge immediately before settlement.
* Attempt settlement during a challenge.
* Recover using stale evidence.
* Recover after permanent closure.
* Claim the same epoch twice.
* Trigger overlapping transfer requests.
* Simulate a failed NEAR transfer.
* Simulate OutLayer timeout.
* Submit malformed evaluator output.
* Attempt unauthorized challenge resolution.
* Attempt unilateral policy replacement.

## 15.3 Security limitations

The hackathon release is an unaudited prototype.

TEE attestation does not prove source truth or policy correctness.

The dispute process cannot guarantee fair judgment.

An externally controlled evidence source may misrepresent real-world conditions.

No production financial custody should be recommended before independent review.

---

# 16. Demonstration Specification

## 16.1 Demo title

**The Promise That Expires — and Can Recover**

## 16.2 Demo narrative

A community agrees to fund ongoing maintenance of a software service.

A maintainer is eligible for recurring support only while the service's maintenance commitment remains Healthy.

The demonstration follows one commitment across multiple evidence cycles.

## 16.3 Live sequence

**Scene 1 — Establish the commitment**

Create a commitment with:

* Sponsor.
* Maintainer.
* Evidence policy.
* Evaluator digest.
* Freshness threshold.
* Grace period.
* Recovery policy.
* Budget consequence.

Fund the commitment with testnet NEAR.

**Scene 2 — Prove current compliance**

Submit or expose fresh qualifying maintenance evidence.

Initiate the OutLayer evaluation.

Display the evaluator's output and inspectable attestation reference.

LCP records the accepted result.

Status becomes Healthy.

**Scene 3 — Enforce a positive consequence**

The maintainer claims an eligible budget tranche.

The contract releases the authorized testnet amount.

**Scene 4 — Let the proof expire**

Do not submit new evidence.

The UI shows the remaining freshness period.

After expiration, effective status becomes AtRisk.

After the grace period, it becomes Breached.

**Scene 5 — Enforce a negative consequence**

Attempt to claim the next budget tranche.

The contract rejects the action.

This is the defining moment of the demo.

**Scene 6 — Recover**

Provide new qualifying evidence.

Run the evaluator again.

LCP accepts the fresh verdict.

The commitment returns to Healthy.

**Scene 7 — Restore eligibility**

Claim an eligible future tranche.

The contract permits the transfer.

Previously missed tranches are not silently backpaid.

**Scene 8 — Inspect history**

Show:

* Original policy.
* Evaluator WASM digest.
* Evidence observations.
* Evaluation records.
* Health changes.
* Breach.
* Recovery.
* Blocked and successful financial actions.

## 16.4 Challenge demonstration

If implemented in the stable release, show a valid challenge freezing a consequence and its resolution.

If challenge handling is incomplete, the project must not claim full dispute support. The relevant release requirement must be marked incomplete.

## 16.5 Demo timing

Use deliberately short freshness and grace parameters on testnet.

The same policy logic must support longer periods without relying on simulated blockchain timestamps in production.

Unit tests may use an injected test clock.

The live demonstration must use real testnet time and transactions.

---

# 17. User Experience

## 17.1 Primary screens

**Commitment Explorer**

Displays active commitments and their effective health.

**Create Commitment**

Collects subject, parties, evidence policy, timing parameters, and consequence configuration.

**Commitment Detail**

Displays current state, next evidence deadline, policy version, and active consequence eligibility.

**Evidence & Verification**

Shows evidence observations, evaluator identity, verification status, and attestation reference.

**Health Timeline**

Visualizes Healthy, AtRisk, Breached, and Recovered transitions.

**Budget Consequence**

Shows escrow, epoch eligibility, successful payouts, and blocked actions.

**Challenge Panel**

Shows challenge status and permitted resolution actions.

## 17.2 UX requirements

* Explain why a commitment is Healthy or not Healthy.
* Display evidence age and expiration.
* Distinguish submitted evidence from accepted evaluation.
* Show whether the evaluator was actually attested.
* Identify the exact policy version in force.
* Explain why a consequence is blocked.
* Distinguish time-derived status from recorded events.
* Never present TEE execution as proof of real-world truth.
* Make wallet transactions and financial consequences explicit.
* Use the NEAR wallet `signMessage` standard (NEP-413) for new maintainer evidence so users approve signatures in their connected wallet; version signature schemes and preserve verification for existing commitments.

---

# 18. Seven-Day Build Plan

## November 8 — Freeze protocol semantics

**Goal:** Eliminate ambiguity before implementation.

Deliver:

* Commitment and policy schema.
* Temporal state rules.
* Exact time boundary semantics.
* Evaluator input/output schema.
* Consequence authorization interface.
* Escrow invariants.
* Repository structure.

**Gate:** Every critical state transition has a deterministic test case.

## November 9 — Implement temporal engine

**Goal:** A commitment can become Healthy, AtRisk, and Breached.

Deliver:

* Contract state model.
* Policy storage.
* Commitment creation.
* Effective-status calculation.
* Initial evidence handling.
* Unit tests for freshness and grace periods.

**Gate:** Time-driven status changes work without the frontend.

## November 10 — Integrate OutLayer

**Goal:** Real attested evidence changes protocol state.

Deliver:

* WASM evaluator.
* Hash-pinned evaluator deployment.
* OutLayer testnet integration.
* Evaluation request tracking.
* Authenticated callback processing.
* Timeout and replay tests.

**Gate:** A real OutLayer result updates a NEAR testnet commitment.

**Critical decision:** If the live integration is not functioning by the end of this day, stop adding features and focus on resolving it.

## November 11 — Implement consequences

**Goal:** Commitment state controls real value.

Deliver:

* Native NEAR escrow.
* Budget epochs.
* Health-gated tranche claims.
* Transfer callbacks.
* Double-claim prevention.
* Refund/closure path.

**Gate:** Healthy permits a valid claim; stale or Breached blocks it.

## November 12 — Recovery, challenges, and frontend

**Goal:** Complete the living lifecycle.

Deliver:

* Recovery transitions.
* Challenge handling.
* Core frontend.
* Wallet integration.
* Evidence and status timeline.

**Gate:** The full breach-and-recovery demonstration works.

## November 13 — Hardening and recording

**Goal:** Reproducibility and reliability.

Deliver:

* Integration tests.
* Adversarial tests.
* Public README.
* Contract and evaluator addresses.
* Attestation verification instructions.
* End-to-end demonstration.
* Recorded demo.
* Submission draft.

**Gate:** A fresh developer can reproduce the core flow from documentation.

## November 14 — Submission

**Goal:** Submit a working, accurately described protocol.

Deliver:

* Final testnet deployment verification.
* Public repository verification.
* Demo publication.
* Track selection.
* Submission links.
* Final human review.
* Submission before 23:59 UTC.

**Rule:** No new major feature development on submission day.

---

# 19. Scope and Contingency Rules

## 19.1 Non-negotiable MVP

The following must remain intact:

1. Persistent commitment.
2. Temporal evidence freshness.
3. Healthy → AtRisk → Breached transition.
4. Real verification integration.
5. Recovery.
6. Enforced consequence.
7. Public reproducibility.

Removing any of these would materially weaken the product thesis.

## 19.2 First features to cut if time runs short

In order:

1. Additional evidence source types.
2. Complex frontend visualizations.
3. Multiple commitment templates.
4. Generalized challenge arbitration interface.
5. Multiple consequence adapters.
6. Full policy amendment workflow.
7. Cross-chain functionality.

The team must preserve a minimum safe challenge/timeout policy if the release claims challenge support.

## 19.3 Verification contingency

If the OutLayer integration encounters a blocking technical issue, a deterministic on-chain or local evaluator may be used to continue developing the state machine.

However, a fallback evaluator must be labeled as such.

It is **not equivalent** to a completed attested-computation demonstration.

The README and submission must accurately distinguish implemented capabilities from planned ones.

---

# 20. Acceptance Criteria

The hackathon release succeeds when:

* A Living Commitment can be created and activated on NEAR testnet.
* Its policy specifies evidence freshness and grace periods.
* A real OutLayer evaluator runs pinned WASM and returns a usable verdict.
* The result is bound to the correct commitment and policy.
* The effective state becomes Healthy.
* Time passing causes the effective state to become AtRisk and then Breached.
* A budget consequence is permitted while Healthy.
* The same class of consequence is blocked while Breached.
* Fresh compliant evidence permits recovery.
* Recovery restores eligibility according to policy.
* An unauthorized or stale evaluation cannot change the commitment.
* Double settlement is rejected.
* The contract, evaluator, and demo are publicly reproducible.
* The demo shows the difference between ongoing verification and one-time milestone approval.

## 20.1 Stretch acceptance

* An authorized challenge pauses consequences.
* An arbiter resolves the challenge under fixed rules.
* A second consequence adapter works.
* A second independent application can consume the protocol SDK.

---

# 21. Metrics

## 21.1 Technical metrics

* Successful attested evaluation cycles.
* Successful and rejected state transitions.
* Evaluation latency.
* Evaluation timeout rate.
* On-chain transaction cost per cycle.
* Contract storage cost per commitment.
* Number of tested security invariants.
* Successful recovery cycles.
* Successful and rejected consequence executions.

## 21.2 Protocol adoption metrics

After the hackathon:

* Independent applications integrating LCP.
* Active commitments.
* Distinct evaluator implementations.
* Distinct consequence adapters.
* Percentage of commitments completing multiple verification cycles.
* Percentage of recoveries and challenges resolved under explicit policy.
* Number of external developers using the SDK.

The long-term north-star metric is **independently maintained commitments completing repeated verification cycles with enforceable consequences**.

---

# 22. Future Modules

## 22.1 Constitution Compiler

Converts human-authored organizational rules into bounded, machine-readable commitment and authority policies.

Potential outputs:

* LCP policy manifests.
* Role and authorization configurations.
* Treasury restrictions.
* Recovery and exit rules.

Its responsibility is **policy compilation**, not live evidence verification.

LCP remains the runtime for maintaining commitment state.

## 22.2 Resilience Lab

Simulates adverse scenarios against commitments and organizations.

Examples:

* Evidence stops arriving.
* Evaluator disappears.
* A participant loses access.
* A sponsor becomes unresponsive.
* A reviewer colludes.
* Treasury authority is compromised.
* A critical program becomes insolvent.

The lab should test whether rights, funds, and recovery procedures remain safe.

It extends the Kokonut Walkaway Test and Insider Attack Test into reusable organizational engineering tools.

## 22.3 Forkable Programs

Packages a program's mandate, policy, participants, provenance, and portable state so it can continue under authorized fork or exit conditions.

A fork must not automatically inherit funds, private data, signing authority, or obligations without the necessary consent.

LCP provides the ongoing commitments that such a program must maintain.

## 22.4 Absorbed ideas

**ProofGate:** Evidence and verification subsystem.

**StewardPass:** Optional subject identity and asset representation.

**ExitReady:** Specialized governance and exit consequence.

**PurposeFlow:** Funding design principle and future policy template.

**ProblemSwarm:** Potential discovery and contributor coordination interface.

**PolicyGuard:** Not a standalone product; bounded authorization remains an internal protocol invariant.

---

# 23. Open Technical Decisions

These must be resolved before or during the first implementation session.

| Question | Proposed decision |
| --- | --- |
| Primary reference commitment | Open-source infrastructure maintenance |
| Evaluation engine | OutLayer WASM on NEAR testnet |
| Evidence format | Signed maintenance heartbeat plus artifact digest |
| Freshness model | Deterministic observation TTL |
| Confidence model | Binary compliance in MVP |
| Grace behavior | AtRisk before Breached |
| Recovery | Allowed through fresh qualifying evidence |
| Challenge authority | Named participant roles |
| Challenge resolution | Predefined arbiter and timeout fallback |
| Consequence | Health-gated native NEAR budget tranche |
| Policy updates | Immutable policy version in MVP |
| Escrow asset | Native NEAR |
| Cross-chain execution | Deferred |
| AI authority | No independent settlement authority |
| External automation | Permissionless triggering, no privileged overrides |
| Evaluation failure | Fail closed; existing evidence continues aging |

---

# 24. Risks and Mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| OutLayer integration delay | Critical | Integrate by November 10; use documented example |
| Temporal semantics bug | Critical | Pure state function with boundary tests |
| Escrow vulnerability | Critical | Isolated accounting and asynchronous settlement tests |
| Incorrect callback trust assumptions | Critical | Verify documented caller and result guarantees |
| Stale source data presented as fresh | High | Bind source observation timestamp, not just evaluation time |
| TEE result mistaken for truth | High | Explicit provenance and trust-boundary documentation |
| Evidence source unavailable | High | Reproducible signed fixture and conservative failure behavior |
| Challenge deadlock | High | Finite timeout and predefined fallback |
| Product confused with milestone escrow | High | Demo evidence expiration, breach, and recovery |
| Overly broad consequence framework | High | One working adapter first |
| Feature expansion consumes deadline | High | P0 gates and explicit cut order |
| Demo requires too much waiting | Medium | Short testnet policy periods and edited recording |
| Policy upgrades introduce authority bypass | High | No unilateral policy mutation |

---

# 25. Release and Submission Requirements

The final repository must contain:

* NEAR contract source.
* Evaluator WASM source.
* Reproducible build instructions.
* Deployed testnet contract address.
* Evaluator version and digest.
* Evidence input/output schema.
* Contract interface documentation.
* State-machine specification.
* Security invariants and tests.
* Demonstration instructions.
* Trust assumptions and limitations.
* Links to verifiable transactions and OutLayer execution evidence.
* Clear list of implemented versus future features.

The submission must follow the official hackathon instructions and receive human review before final publication.

---

# 26. Product North Star

**Living Commitments Protocol is infrastructure for continuously maintained trust.**

A milestone says something happened.

A credential says something was proven.

A permission says something is allowed.

A Living Commitment connects these ideas over time:

> **This right remains valid while the evidence supporting its conditions remains valid—and changes predictably when those conditions fail or recover.**

That is the primitive.

Constitution Compiler will define the rules.

Resilience Lab will test the rules.

Forkable Programs will make the resulting organizational structures portable.

**Living Commitments Protocol will make the rules live.**

---

# 27. Source Basis

This PRD is aligned with the attached **NEAR Hackathon White-Space Research: From Good Ideas to a Frontier Build**, including its 252-project competitive analysis, sponsor capability review, novelty audit, and Living Commitments architecture.

Technical implementation references:

* [NEAR developer documentation](https://docs.near.org/)
* [OutLayer Getting Started](https://app.outlayer.ai/docs/getting-started)
* [OutLayer NEAR Integration](https://app.outlayer.ai/docs/near-integration)
* [OutLayer TEE Attestation](https://app.outlayer.ai/docs/tee-attestation)
* [NEAR Intents](https://docs.near-intents.org/)

The PRD distinguishes research-derived direction from proposed implementation decisions. Contract interfaces, policies, and acceptance tests are specifications to implement, not claims of deployed functionality.
