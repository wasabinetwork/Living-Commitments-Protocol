# Reviewer Access Security Review Brief

## Review status

This brief records the reviewer-access design and a scoped internal source pass; it is not an audit or production approval. The independent findings below identify nine issues. Local source remediations now address Findings 1–9: require FullAccess NEP-413 signers; isolate pre-auth signer-key limits from the authenticated action allowance; expire signed list authorizations using finalized NEAR time; retain canonical consent payloads and signature envelopes; validate large base64 inputs linearly and bound base58 input lengths; accept valid 32-byte block-hash encodings; treat malformed RPC envelopes as individual provider failures; and preserve ciphertext when a grant commit outcome is uncertain. These fixes are deployed to preview Worker `lcp-reviewer-access.wasabinetwork.workers.dev` (version `7b1773b7-897e-4a45-8b09-824ee7bcb60a`) and production Worker `reviewer-access.lcp.gama.works` (version `70b4c65b-e247-43be-8e55-12e0f61c2d46`). Migration 0004 is applied to their shared D1 database, and both health endpoints returned `ok` on 2026-11-13. Manual acceptance and independent follow-up review remain open. Do not enable Console integration until these gates are complete.

## Assets and trust boundaries

- Evidence plaintext and reviewer private keys should remain in the relevant user’s browser/device.
- R2 stores encrypted artifacts. D1 stores ciphertext metadata, signed consent envelopes, access counters, and retention timestamps.
- NEAR finalized state identifies the commitment maintainer and current wallet access keys. Current source requires 2-of-3 configured RPC providers to agree on a finalized block and exact authorization reads pinned to it. NEAR does not store reviewer contact details or plaintext evidence.
- The maintainer chooses the artifact and recipient; the reviewer controls their decryption key. The Worker can authorize, store, and serve ciphertext but must not be able to decrypt it.
- Revocation and expiry stop future downloads. They cannot erase a copy already downloaded and decrypted by a reviewer.

## Controls present in the implementation

- Exact configured browser origins; production uses its custom domain with `workers.dev` and version preview URLs disabled, while preview has its own exact Pages origin; bounded JSON bodies (12 MiB) and encrypted artifacts (at most 8 MiB).
- Canonical NEP-413 payload binding, finalized NEAR access-key checks, maintainer role checks, unique nonces, expiry checks, a 60/IP/minute edge limit, a 10/signer-key/minute D1 limit before NEAR authorization reads, a shared 30/minute authenticated D1 cap, and a 30/account/hour limit after key validation. Both deployed versions require FullAccess keys for every NEP-413 action and charge the shared cap only after key validation and any required maintainer-role check; finding-specific rate-limit and key-type acceptance remains pending.
- The deployed Worker requires 2-of-3 agreement across three distinct HTTPS RPC origins for the finalized block and each authorization read; all contract, access-key, and chain-time reads within a request share the same block hash. Manual outage/conflict acceptance and independent review remain open.
- Maintainer approval/rejection, revocation, reviewer requests, grant listing, and downloads require a current FullAccess key. Verify the Finding 1 rejection and acceptance cases against both deployed environments.
- Private R2 binding, opaque random object keys, ciphertext digest checks, constrained scope, bounded download counts, and response cache protections.
- Scheduled expiry/revocation cleanup, orphan cleanup, retryable deletion state, and bounded retention for request, signature, and access metadata.
- Structured error logging records event and error class without request bodies, signatures, evidence, or endpoint secrets.

## Required independent review

Review the Worker, `src/encoding.ts`, `src/nep413.ts`, the Console encryption/decryption path, D1 migrations, and both `wrangler.jsonc` and `wrangler.preview.jsonc`. In particular:

1. Independently validate NEP-413 byte serialization, Ed25519 verification, key parsing, AES-GCM/HPKE parameters, key-backup handling, and all metadata bindings.
2. Test concurrent duplicate grant creation, replay races, revoke/download races, nonce retention, quota bypass across accounts, and D1 batch atomicity assumptions.
3. Confirm unauthorized callers cannot enumerate requests, grants, R2 objects, or private metadata; verify exact-origin behavior is not treated as authentication.
4. Inject NEAR, D1, and R2 failures at each write/delete boundary. Confirm no orphaned plaintext, unintended access, or permanent cleanup dead end.
5. Verify quorum behavior: a single provider outage is tolerated, while conflicting block heads, conflicting pinned reads, fewer than two answers, and invalid/duplicate endpoint origins fail closed. Confirm configured RPC operators are independent and serve the same network.
6. Review account-key rotation/revocation timing, finalized RPC availability, request expiry, retention behavior, logging, migrations, and production secret/resource configuration.

## INDEPENDENT AUDIT REVIEW FINDINGS

Found **9 issues: 2 high severity and 7 medium severity**.

1. **High — Restricted keys can impersonate reviewers.** [near.ts:278](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/near.ts:278) accepts arbitrary `FunctionCall` keys. A key restricted to an unrelated contract successfully created a reviewer request and downloaded its approved artifact. Maintainer function-call keys also exposed all grant metadata. Require `FullAccess` for these signatures, as [NEP-413 specifies](https://github.com/near/NEPs/blob/master/neps/nep-0413.md).
2. **High — Unregistered keys can exhaust the service-wide quota.** [index.ts:645](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/index.ts:645) consumes the shared RPC budget before checking account-key ownership. Repeating one signature from an unregistered key 30 times caused a legitimate maintainer request to receive HTTP 429. Add caller-level admission controls and protect capacity for authenticated users.
3. **Medium — Old signatures become replayable after nonce cleanup.** [index.ts:861](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/index.ts:861) deletes nonces after 30 days, but list authorizations have no expiry. A previously rejected replay succeeded on day 31 and disclosed newly created requests. Bind signed actions to a short validity window.
4. **Medium — Retained consent signatures lose their verification data.** [0003_signed_consent_audit.sql:1](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/migrations/0003_signed_consent_audit.sql:1) stores signatures without their nonces or complete signed payloads. After nonce cleanup, approval/request signatures remain but cannot be independently verified. Retain complete payloads and envelopes for the consent-retention period.
5. **Medium — Valid large artifacts are rejected.** [encoding.ts:42](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/encoding.ts:42) uses a base64 regex that exhausts the runtime’s stack. Valid 4 MiB and 8 MiB ciphertexts returned HTTP 400 in workerd, despite the advertised 8 MiB limit. Replace it with validation that handles bounded large inputs without recursive matching.
6. **Medium — Oversized public keys consume substantial CPU before authentication.** [encoding.ts:60](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/encoding.ts:60) performs unbounded BigInt conversion before checking decoded length. An unsigned request with a 100,000-character key took approximately 1.5 seconds to reject. Enforce encoded field lengths before decoding.
7. **Medium — Valid block hashes fail validation.** [near.ts:153](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/near.ts:153) requires exactly 44 base58 characters. Valid 32-byte hashes can have 43 characters; three agreeing providers using such a hash still produced `NEAR_UNAVAILABLE`. Validate decoded byte length.
8. **Medium — One malformed RPC response defeats the quorum.** [near.ts:126](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/near.ts:126) dereferences parsed JSON without checking for `null`. One provider returning JSON `null` caused failure despite two healthy, agreeing providers. Treat malformed envelopes as individual provider failures.
9. **Medium — An uncertain commit can trigger deletion of active ciphertext.** [index.ts:623](/Users/gilbertoadon/Downloads/Develop/Living%20Commitments%20Protocol/services/reviewer-access/src/index.ts:623) unconditionally deletes the uploaded object on error. Injecting an error after the D1 batch committed left an approved request and active grant pointing to deleted ciphertext. Reconcile the commit outcome before deletion, or defer cleanup to the orphan collector.

**Audit-time validation:** The auditor reported that all 15 Worker tests, 11 SDK tests, type checking, both deployment dry runs, and the scoped npm audit passed. Additional probes reportedly confirmed the findings; duplicate-approval, download-limit, revocation-race, and purge-retry checks passed. Those results predate the remediations above and have not been rerun as part of this pass.

Reproductions: [D1/R2 harness](/tmp/lcp-reviewer-audit.ZYOzHF/reproduce.mjs), [workerd input checks](/tmp/lcp-reviewer-audit.ZYOzHF/workerd-size.mjs). The auditor made no implementation changes during that review. Deployed storage permissions and live RPC-provider independence were not verified.

## Release acceptance

The independent reviewer has provided the nine findings recorded above. Local source remediations are deployed to preview and production, and migration 0004 is applied to their shared private D1 database. Finding-specific acceptance and independent follow-up review remain open. Keep reviewer Console integration and production use gated until those checks pass; verify cleanup, revocation, and authorization against testnet. Keep private evaluator input disabled until OutLayer per-commitment secret retrieval has a separate verified design and test.
