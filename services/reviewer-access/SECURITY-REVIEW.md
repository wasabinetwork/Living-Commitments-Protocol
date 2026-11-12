# Reviewer Access Security Review Brief

## Review status

This brief prepares the reviewer-access Worker for independent review. A scoped internal source pass confirmed the implemented bounds and controls listed below; it is not an audit or production approval. The preview Worker is deployed at `lcp-reviewer-access.wasabinetwork.workers.dev` (version `706cc768-c279-4bcc-997f-563dd5bab211`); the testnet production hostname `reviewer-access.lcp.gama.works` is deployed as version `70a22bde-7362-4b5f-b408-ab900eea600d`. Both use private D1/R2 resources and the 2-of-3 RPC quorum. Manual quorum behavior acceptance remains open. Do not enable Console integration until an independent reviewer has assessed the code, cryptographic flow, deployment configuration, and failure behavior.

## Assets and trust boundaries

- Evidence plaintext and reviewer private keys should remain in the relevant user’s browser/device.
- R2 stores encrypted artifacts. D1 stores ciphertext metadata, signed consent envelopes, access counters, and retention timestamps.
- NEAR finalized state identifies the commitment maintainer and current wallet access keys. Current source requires 2-of-3 configured RPC providers to agree on a finalized block and exact authorization reads pinned to it. NEAR does not store reviewer contact details or plaintext evidence.
- The maintainer chooses the artifact and recipient; the reviewer controls their decryption key. The Worker can authorize, store, and serve ciphertext but must not be able to decrypt it.
- Revocation and expiry stop future downloads. They cannot erase a copy already downloaded and decrypted by a reviewer.

## Controls present in the implementation

- Exact configured browser origins; production uses its custom domain with `workers.dev` and version preview URLs disabled, while preview has its own exact Pages origin; bounded JSON bodies (12 MiB) and encrypted artifacts (at most 8 MiB).
- Canonical NEP-413 payload binding, current NEAR access-key checks, finalized maintainer role checks, unique nonces, expiry checks, a 60/IP/minute edge limit, a shared 30/minute D1 cap before NEAR RPC, and a 30/account/hour limit after key validation.
- The deployed Worker requires 2-of-3 agreement across three distinct HTTPS RPC origins for the finalized block and each authorization read; all contract, access-key, and chain-time reads within a request share the same block hash. Manual outage/conflict acceptance and independent review remain open.
- Maintainer approval/rejection and revocation require a current FullAccess key. Reviewer downloads require a signature from the account named in the grant.
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

## Release acceptance

The independent reviewer should provide findings with severity, reproduction evidence, and remediation status. Resolve all critical/high findings; document and explicitly accept remaining risks. Before deployment, use dedicated private D1/R2 resources, apply reviewed migrations, set only the production Console origin, keep R2 public access disabled, and verify cleanup, revocation, and authorization against testnet. Keep private evaluator input disabled until OutLayer per-commitment secret retrieval has a separate verified design and test.
