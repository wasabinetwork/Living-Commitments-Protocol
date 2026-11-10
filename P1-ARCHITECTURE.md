# P1 Evidence and Governance Architecture

**Status:** Implementation baseline for the P1 roadmap. Existing v1 and v2 commitments remain unchanged.

## Design constraints

- NEAR remains authoritative for policy version, time, health, challenge state, eligibility, and settlement. Evaluators only return bounded evidence outcomes.
- v1 and v2 policy digests and evidence formats remain immutable. Advanced evidence and governance use a new versioned format and separate storage prefixes; contract state layout must not be changed in place without a migration plan.
- The current heartbeat payload is included in the public `request_evaluation` transaction. A file selected in the browser stays local, but its digest and signed payload are public. The current flow does not provide private evidence access.
- Evidence confidence must describe inspectable provenance and agreement. It must not imply a probability that the underlying claim is true.

## Pilot use case: community service availability

Use recurring support for a community service whose public health endpoint has an availability and response-time policy. This extends the existing community-service template with measurable, domain-specific evidence.

Independent probe operators submit signed observations for each evaluation. The standalone pilot tool is `evaluators/service-availability/probe.mjs`. A report binds the contract, commitment, evaluation, policy digest, endpoint fingerprint, source and operator IDs, observation time, status class, and latency. The evaluation ID prevents replay across evaluations, and the evaluator counts at most one report per source. The endpoint fingerprint is `SHA-256(salt_bytes || canonical_HTTPS_URL_UTF8)`; operators keep the URL and salt off-chain. The policy pins unique source IDs, operator IDs, and public keys.

For a three-operator policy, a sample rule could require two independent `up` reports, define acceptable HTTP status and maximum latency, and cap report age. The count must be a strict majority, so `up` and `down` cannot both form a quorum. A minimum corroboration threshold can require stronger agreement than the minimum count; for example, 7,000 basis points over three configured operators requires all three to agree. Two valid `down` reports produce `NonCompliant` only when both thresholds are met. Reports that are missing, stale, invalid, or split without a quorum produce `Inconclusive`; they do not prove the service is down. An inconclusive result does not refresh the last-good evidence clock, so existing temporal rules still apply.

The result reports the number of valid independent operators that agree, the configured denominator (for example, `2 of 3`), and coverage in integer basis points. This is source agreement coverage, not a truth probability. Treat evidence confidence as a structured description of signature validity, source diversity, report freshness, agreement, and separately verified evaluator attestation; do not collapse it into one probability-like score. Distinct keys do not prove distinct ownership; the policy parties choose and review the operator roster. TEE attestation proves that the pinned evaluator applied the rules to the reports, not that an operator performed an honest probe.

## Evidence privacy and reviewer access

No public email, chat handle, or upload inbox is added. Reviewers identify themselves with a NEAR account and submit a NEP-413 signed request naming the commitment, evidence digest, requested scope, recipient account, encryption-key fingerprint, expiry, and one-time nonce. The maintainer approves that exact request with a wallet signature.

For private artifacts, the browser encrypts each file with a random data key before upload. It wraps that key to the reviewer’s bound X25519 key using a maintained HPKE implementation. R2 stores ciphertext only; a Worker checks the signed grant, expiry, scope, and rate limit before returning ciphertext. D1 stores grant and access metadata, never the artifact or decryption key. Revocation blocks later downloads but cannot erase a copy already received by a reviewer. Use a salted content commitment for private, low-entropy files to reduce hash-correlation and dictionary attacks.

Private evaluation must also keep plaintext out of NEAR transaction arguments. A future evaluator request should carry an opaque object reference and ciphertext digest; the TEE retrieves and decrypts the artifact with a per-commitment secret. OutLayer supports WASI Preview 2 HTTP and an optional `secrets_ref` on NEAR execution requests; bind a separate secret to each commitment and restrict it to the approved evaluator build before implementing this path. Confirm the caller/grant semantics in testnet. See the official [WASI guide](https://app.outlayer.ai/docs/wasi), [NEAR integration](https://app.outlayer.ai/docs/near-integration), and [secrets guide](https://app.outlayer.ai/docs/secrets). Never reuse one decryption key across commitments. Existing v1/v2 requests retain their current public-input behavior.

## Multi-source policy and outcome model

An advanced policy contains a versioned source roster, operator identities, source-key fingerprints, source type and schema version, freshness bounds, domain rules, and an aggregation rule. The digest covers the canonical serialization of every field. The evaluator rejects duplicate operators, unknown sources, replayed challenges, invalid signatures, stale observations, and unsupported schemas.

The advanced result has three outcomes:

- `Compliant`: the configured quorum supports the service condition.
- `NonCompliant`: a valid quorum supports a policy-defined failure condition.
- `Inconclusive`: the source quorum or agreement threshold is not met.

The contract records `Inconclusive` without replacing last-good evidence or starting a negative-health clock. It cannot authorize a claim from that result. The Console shows source coverage, outcome, and reason codes separately from health. The evaluator returns only bounded summaries and hashes; private reports stay off-chain.

## Contract v3 integration boundary

Do not add fields to the persisted Commitment, CommitmentPolicy, or EvaluationRecord Borsh structs for v3. Store the v3 source policy and bounded evaluation summary in separately prefixed raw storage keys, such as lcp:policy:v3:<commitment_id> and lcp:evaluation:v3:<commitment_id>:<evaluation_id>; include their bytes in the existing storage-bond accounting. Add separate v3 entrypoints and view methods so v1/v2 call shapes remain stable.

Domain-separate the v3 commitment digest: hash the fixed v3 domain string, serialized base policy, and canonical source-policy bytes. The contract supplies the current NEAR block timestamp and next evaluation ID. Reports bind both digests and that evaluation ID. The caller cannot choose the trusted request timestamp. Source reports remain public transaction arguments; private or confidential evidence must wait for the encrypted reviewer/evaluator path.

The evaluator reports its oldest observation among the reports that satisfy the winning quorum. The contract checks that timestamp is not in the future, is within the temporal source-lag bound, is newer than the last accepted observation, and has not expired. A compliant outcome refreshes last-good evidence; a noncompliant outcome starts the negative clock; an inconclusive outcome is recorded as an evaluation result but changes neither health clock nor claim eligibility. Every outcome blocks claims while evaluation is pending, and only a compliant accepted record can govern a claim.

Persist bounded source counts, agreement coverage, reason codes, and input/output hashes in the v3 summary key. Add optional summary fields to the JSON view. The indexer may index the corresponding events, but contract storage remains authoritative. Before deployment, verify old Borsh state decoding, callback storage reserves, duplicate callback handling, stale and conflicting sources, all three outcomes, and unchanged v1/v2 fixtures.

## Consent-based amendments

An amendment proposal binds the current digest, new digest, proposal nonce, expiry, and future effective timestamp. It requires wallet-signed approval from the deduplicated union of affected roles under the old and new policy: sponsor, maintainer, beneficiary, arbiter, and any account whose granted authority changes. Silence is not consent; an incomplete proposal expires without effect. The contract keeps the active policy in force until all approvals are present and the activation timestamp is reached.

Do not reinterpret past evaluations or settled transfers. New evidence must satisfy the new policy before it can support a claim under that policy. Reject activation while an evaluation or challenge is pending. Preserve every prior digest and the approval records in the public event history.

## Contract-gated authority adapters

An authority grant is separate from the evidence policy. It names the granting account, allow-listed LCP-compatible adapter contract, resource, exact capability, per-action and cumulative limits, expiry, nonce, and revocation state. The grant must be signed by the account whose authority is affected. The contract checks current health, eligibility, grant scope, expiry, limits, and replay protection before authorizing an adapter action. A target must explicitly implement this authorization; LCP cannot change a normal NEAR account's keys or call arbitrary contracts on its behalf.

Start with NEAR contract-to-contract adapters. Do not add generic calls, unrestricted keys, or automatic control of accounts that did not grant authority. Cloud services and other off-chain effects need a separately reviewed relay and verifiable authorization path.

## Implementation order and gates

1. Manually exercise the standalone signed service-probe report format and domain rules without changing existing commitments.
2. Add a v3 contract/SDK/evaluator schema for source rosters, quorum, corroboration, and `Inconclusive`; preserve v1/v2 behavior.
3. Build private artifact storage and consented reviewer access after validating the TEE key-release design.
4. Add multi-party amendments with future-boundary activation and explicit role consent.
5. Add one narrowly scoped NEAR authority adapter after grant and revocation behavior is specified.

Keep each stage independently reviewable. On-chain storage migration, TEE secret delivery, and reviewer key recovery are release gates, not implementation details to assume away.
