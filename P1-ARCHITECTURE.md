# P1 Evidence and Governance Architecture

**Status:** The v3 source-policy/evaluator path is deployed to NEAR testnet; signed-operator pilot validation remains pending. Local implementation also includes consented reviewer access, service-policy amendments, and one bounded payout adapter. Consolidated Rust, JavaScript, Worker, Console, and WASM checks pass. Reviewer provisioning/security review and live testnet validation of signed probes, amendments, and adapter settlement remain. Existing v1 and v2 commitments retain their storage layout and call formats.

## Design constraints

- NEAR remains authoritative for policy version, time, health, challenge state, eligibility, and settlement. Evaluators only return bounded evidence outcomes.
- v1 and v2 policy digests and evidence formats remain immutable. Advanced evidence and governance use a new versioned format and separate storage prefixes; contract state layout must not be changed in place without a migration plan.
- The current heartbeat payload is included in the public `request_evaluation` transaction. A file selected in the browser stays local, but its digest and signed payload are public. The current flow does not provide private evidence access.
- Evidence confidence must describe inspectable provenance and agreement. It must not imply a probability that the underlying claim is true.

## Pilot use case: community service availability

Use recurring support for a community service whose public health endpoint has an availability and response-time policy. This extends the existing community-service template with measurable, domain-specific evidence.

The proposed `https://lcp.gama.works/health` endpoint returned HTTP 200 from two operator locations on different IP addresses on 2026-11-09. This validates reachability from those locations; it does not yet validate signed operator reports, quorum aggregation, or a contract-backed result.

Independent probe operators submit signed observations for each evaluation. The standalone pilot tool is `evaluators/service-availability/probe.mjs`. A report binds the contract, commitment, evaluation, policy digest, endpoint fingerprint, source and operator IDs, observation time, status class, and latency. The evaluation ID prevents replay across evaluations, and the evaluator counts at most one report per source. The endpoint fingerprint is `SHA-256(salt_bytes || canonical_HTTPS_URL_UTF8)`; operators keep the URL and salt off-chain. The policy pins unique source IDs, operator IDs, and public keys.

For a three-operator policy, a sample rule could require two independent `up` reports, define acceptable HTTP status and maximum latency, and cap report age. The count must be a strict majority, so `up` and `down` cannot both form a quorum. A minimum corroboration threshold can require stronger agreement than the minimum count; for example, 7,000 basis points over three configured operators requires all three to agree. Two valid `down` reports produce `NonCompliant` only when both thresholds are met. Reports that are missing, stale, invalid, or split without a quorum produce `Inconclusive`; they do not prove the service is down. An inconclusive result does not refresh the last-good evidence clock, so existing temporal rules still apply.

The result reports the number of valid independent operators that agree, the configured denominator (for example, `2 of 3`), and coverage in integer basis points. This is source agreement coverage, not a truth probability. Treat evidence confidence as a structured description of signature validity, source diversity, report freshness, agreement, and separately verified evaluator attestation; do not collapse it into one probability-like score. Distinct keys do not prove distinct ownership; the policy parties choose and review the operator roster. TEE attestation proves that the pinned evaluator applied the rules to the reports, not that an operator performed an honest probe.

## Evidence privacy and reviewer access

No public email, chat handle, or upload inbox is added. Reviewers identify themselves with a NEAR account and submit a NEP-413 signed request naming the commitment, evidence digest, requested scope, recipient account, encryption-key fingerprint, expiry, and one-time nonce. The maintainer approves that exact request with a wallet signature.

The local Console flow uses NEP-413 signatures for reviewer requests, maintainer approval/rejection, download, and revocation. Approval and revocation require a current maintainer FullAccess key; reviewer requests accept a current NEAR access key. The browser creates a salted file digest and a passphrase-encrypted X25519 key backup, encrypts the artifact with AES-256-GCM, and wraps its content key with HPKE. The Worker stores ciphertext in a private R2 bucket and consent/access metadata in D1, including the signed reviewer request and signed maintainer resolution envelopes; list APIs do not return those signatures. It limits download counts, expires requests and grants, purges ciphertext on revocation or expiry, and retries cleanup of unlinked ciphertext after interrupted grant writes. Access events are retained for 90 days; active grant/request metadata is retained while access is valid and terminal metadata, including consent signatures, for 90 days after closure and last access.

This is private reviewer collaboration, not proof that the file was evaluated on-chain. The salted digest is a separate private commitment; it is not the public `evidence_hash` in the NEAR evaluation record. Maintainer approval binds the chosen file to the request but cannot prove it is the original evidence source. Private evaluation still requires a separate TEE retrieval/decryption path. The Worker is not provisioned or deployed yet; independent security review remains. Revocation cannot erase a copy already decrypted by a reviewer.

Private evaluation must also keep plaintext out of NEAR transaction arguments. A future evaluator request should carry an opaque object reference and ciphertext digest; the TEE retrieves and decrypts the artifact with a per-commitment secret. OutLayer supports WASI Preview 2 HTTP and an optional `secrets_ref` on NEAR execution requests; bind a separate secret to each commitment and restrict it to the approved evaluator build before implementing this path. Confirm the caller/grant semantics in testnet. See the official [WASI guide](https://app.outlayer.ai/docs/wasi), [NEAR integration](https://app.outlayer.ai/docs/near-integration), and [secrets guide](https://app.outlayer.ai/docs/secrets). Never reuse one decryption key across commitments. Existing v1/v2 requests retain their current public-input behavior.

## Multi-source policy and outcome model

An advanced policy contains a versioned source roster, operator identities, source-key fingerprints, source type and schema version, freshness bounds, domain rules, and an aggregation rule. The digest covers the canonical serialization of every field. The evaluator rejects duplicate operators, unknown sources, replayed challenges, invalid signatures, stale observations, and unsupported schemas.

The advanced result has three outcomes:

- `Compliant`: the configured quorum supports the service condition.
- `NonCompliant`: a valid quorum supports a policy-defined failure condition.
- `Inconclusive`: the source quorum or agreement threshold is not met.

The contract records `Inconclusive` without replacing last-good evidence or starting a negative-health clock. It cannot authorize a claim from that result. The Console shows source coverage, outcome, and reason codes separately from health. The evaluator returns only bounded summaries and hashes; private reports stay off-chain.

## Contract v3 integration boundary

The current v3 implementation does not add fields to the persisted Commitment, CommitmentPolicy, or EvaluationRecord Borsh structs. It stores the source policy and bounded evaluation summary in `lcp:service-policy:v3:<commitment_id>` and `lcp:service-summary:v3:<commitment_id>:<evaluation_id>` raw-storage keys, and includes their bytes in storage-bond accounting. Separate create/request/view methods keep v1/v2 call shapes stable. `Inconclusive` was appended after the two existing `Verdict` variants so their Borsh discriminants remain 0 and 1.

The v3 commitment digest is domain-separated over the base policy Borsh bytes and canonical source-policy JSON, with explicit lengths. The contract supplies the current NEAR block timestamp and next evaluation ID. Reports bind both digests and that evaluation ID. The caller cannot choose the trusted request timestamp. Source reports remain public transaction arguments; private or confidential evidence must wait for the encrypted reviewer/evaluator path.

The evaluator reports its oldest observation among the reports that satisfy the winning quorum. The contract checks that timestamp is not in the future, is within the temporal source-lag bound, is newer than the last accepted observation, and has not expired. A compliant outcome refreshes last-good evidence; a noncompliant outcome starts the negative clock; an inconclusive outcome is recorded as an evaluation result but changes neither health clock nor claim eligibility. Every outcome blocks claims while evaluation is pending, and only a compliant accepted record can govern a claim.

The implementation persists bounded source counts and agreement coverage in the v3 summary key, exposes them through optional JSON view fields, and keeps contract storage authoritative. Local tests cover sidecar storage, storage reservation, valid source-summary handling, and the unchanged-clock inconclusive outcome. The v3 upgrade preserved existing state: finalized reads still return commitments 8, 9, 19, and 21. Validate all three v3 outcomes and duplicate/stale callback handling in the pilot.

## Consent-based amendments

The v3 source-policy amendment sidecar binds the current digest, new digest, proposal nonce, expiry, and future effective timestamp. It requires a separate NEAR transaction from each distinct sponsor, maintainer, beneficiary, and arbiter account. The proposer may cancel; anyone may record expiry after the deadline. The active policy stays in force until all approvals and the future boundary are satisfied. Activation starts a new initial evidence clock, clears prior compliant evidence for eligibility, and preserves the recurring budget schedule and existing failure/breach state. This feature does not amend base budget, evaluator, or role fields.

Past evaluation records and settled transfers remain unchanged. New evidence must satisfy the new digest before it can support a claim. Proposal and activation are blocked while an evaluation or challenge is pending. Amendment sidecars preserve approval state and emit proposal, approval, activation, cancellation, and expiry events without changing persisted Borsh state.

## Contract-gated authority adapters

An authority grant is separate from the evidence policy. The current implementation lets the sponsor or beneficiary grant a named adapter a `bounded_payout` capability for one fixed recipient, with per-action and cumulative limits, expiry, increasing action nonce, one action per epoch, and revocation. Actions require the same on-chain eligibility as a tranche claim, including completed evaluation challenge window, funded escrow, current policy evidence, and Healthy state. The sample adapter pays only from its own prefunded pool and reconciles failed NEAR transfers. The LCP grant allowance is consumed when the call is issued, even if the adapter call fails.

The sample adapter has an explicit pool-manager account that can recover available, unreserved pool funds through a reconciled transfer. Pending payouts and withdrawals cannot be withdrawn again; a failed transfer restores the pool balance. This is a local test implementation; no authority has been deployed or granted on testnet. Each target must explicitly implement the authorization interface. The grant pins an adapter account ID, not its code hash; its deployment administrator could replace the code, so test deployments should remove or tightly secure upgrade keys. A grant does not expose account keys, LCP escrow, generic calls, or authority over an account that did not consent. Cloud services and other off-chain effects need a separately reviewed relay and verifiable authorization path.

## Implementation order and gates

1. Consolidated local validation is complete for v3, reviewer access, amendment consent, and bounded adapter behavior.
2. Run the signed community-service pilot with two independent operators, then verify source rosters, all evaluation outcomes, and v1/v2 compatibility on testnet. Endpoint reachability from two networks is confirmed; signed reports, quorum outcomes, and live commitment lifecycle remain outstanding.
3. Provision private Cloudflare D1/R2 resources, configure the production origin, and deploy the reviewer Worker only after tests and security review. Keep private evaluator input blocked until the OutLayer secret grant/retrieval path is verified.
4. Deploy and exercise consent amendments on a dedicated v3 test commitment, including delayed activation, cancellation, expiry, evidence-clock reset, and role approvals.
5. Deploy and exercise the adapter separately, including unauthorized callers, eligibility gates, revocation, limits, replay, empty pool, failed-transfer reconciliation, and manager recovery.

Keep each stage independently reviewable. Local automated checks pass; rerun them after any code changes and before testnet deployment. TEE secret delivery and reviewer key recovery remain security/release gates, not implementation details to assume away.
