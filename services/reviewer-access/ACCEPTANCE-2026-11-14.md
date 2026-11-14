# Reviewer access acceptance audit — 2026-11-14

**Result: release gate failed.** The nine original regressions passed against the reviewed source deployed with isolated D1/R2 and RPC mocks. This follow-up found one high-priority availability blocker and three medium-priority issues. The actual preview's live authorization flow remains unaccepted. Keep Console integration, production reviewer use, and private evaluator input gated.

## Findings

### A1 — High: live finalized-head agreement prevents authorized requests

In [near.ts](src/near.ts#L175), the snapshot must have two matching responses at the highest reported finalized height. The configured providers repeatedly returned different finalized heights. All **12 signed calls** against preview version `b1882f4b-0c2c-4646-8956-f7795bb8c167` returned `503 NEAR_UNAVAILABLE`: nine calls signed with verified current FullAccess keys and three with the disposable FunctionCall key. No live reviewer request or grant was created.

The last three samples, at 19:41:46–19:41:54 UTC, returned provider heights `[277701455,277701456,277701457]`, `[277701460,277701460,277701462]`, and `[277701464,277701464,277701465]` in FastNear/dRPC/Intear order. All three providers answered HTTP 200. These separate diagnostic probes support a finalized-head disagreement explanation; they are not a trace of the exact provider replies inside each failed preview invocation. The isolated higher-head case reproduced the same fail-closed behavior. Scheduled cleanup also requires this finalized snapshot, so the disagreement can delay retention work.

Recheck the providers' finality semantics and availability together. Resolve ordinary head skew with a reviewed, freshness-bounded agreement strategy or a verified provider configuration, then rerun the live flow. Do not bypass current-key checks or silently trust an isolated newer head. Evidence: [live requests](acceptance/2026-11-14/requests.jsonl), [provider probes](acceptance/2026-11-14/live-recheck.json). Example failed live request: `a5a87edf7e0f20a7-MIA`.

### A2 — Medium: a dissenting third RPC response does not fail closed

[near.ts](src/near.ts#L228) accepts any group of two matching results. It does not reject a third valid, conflicting result. The same behavior applies to different hashes at the same finalized height in [snapshot selection](src/near.ts#L179).

Two agreeing block hashes plus a third different hash returned **200**, as did two `FullAccess` results plus a third FunctionCall result for the same key at the pinned block. The matrix requires conflicts to return `NEAR_UNAVAILABLE`; the existing local conflict tests cover disagreement without a majority, which misses this case. Deployed evidence at 19:39:48 UTC: requests `e1d9f079-8d27-45a0-8fd9-5ef999e8665e` and `39190428-1382-4e08-89ae-0042e165aca9`, version `fba890da-3ad0-40f9-9ccf-91ff17e7ad90`.

This is a mismatch with the stated acceptance policy, not evidence that one malicious provider can override two honest agreeing providers. Enforce the documented conflict rule, or explicitly revise and review the trust policy before claiming acceptance. Preserve single-outage tolerance and distinguish unavailable/malformed replies from valid contradictory state.

### A3 — Medium: commit recovery reports success for a different approval

The recovery query in [index.ts](src/index.ts#L661) looks up any committed grant with the same `request_id`. It does not establish that the grant belongs to the current operation or matches its signed ciphertext/envelope/expiry.

Two distinct, valid approvals were held immediately before their D1 batches until both had reached that point. Both returned **201 with the same grant ID**, while D1 contained one grant and the submitted ciphertext digests differed. The losing approval was therefore reported as committed. The immutable request still constrains the recipient, and no second active grant was created; the failure is incorrect success and consent/artifact reconciliation.

Recover by this operation's generated `grant_id`/artifact identity, or compare the complete immutable signed approval. Return a conflict for a different approval. Keep the new non-destructive ciphertext handling. Evidence: [deterministic race](acceptance/2026-11-14/race-results.json), carrier request `cc4e261d-d6bd-469a-8157-f32f836cb2f7`, version `4fc1861b-11d8-4670-9147-73027cf577c6`, 19:44:09 UTC. The two nested calls use harness correlation IDs rather than separate Cloudflare Ray IDs.

### A4 — Medium: encrypted backups do not authenticate the advertised recipient key

[unlockReviewerKeyVault](../../packages/sdk/src/index.ts#L1433) checks that the public key hashes to the supplied fingerprint, but does not bind either value to the encrypted private key. AES-GCM additional data contains only a constant schema string. Replacing both public fields with another key pair's public key/fingerprint requires no passphrase and still allows the legitimate passphrase to unlock the backup.

The reproduction encrypted a new artifact to this substituted public key. The original private key could not decrypt it; the substitute private key could. This does **not** bypass Worker download authorization: confidentiality impact additionally requires access to the ciphertext. It does silently redirect encryption and prevent the intended reviewer from decrypting. The [Console request path](../../apps/console/components/reviewer-access-panel.tsx#L245) uses imported public metadata without requiring successful key-pair validation first.

Authenticate public metadata in a versioned backup envelope, verify that the decrypted private key derives the advertised public key, and require that validation before using an imported key for a request. Evidence: [substitution proof](acceptance/2026-11-14/backup-substitution-proof.json), [cryptographic checks](acceptance/2026-11-14/crypto-results.json). Only booleans and outcomes are retained.

## Original findings rechecked

These results apply to the reviewed source in the disposable deployed environment. They do not convert the blocked live preview flow into a pass.

| Original finding | Follow-up result |
| --- | --- |
| 1. FunctionCall authorization | Pass: restricted keys received 403 across request, request/grant lists, approval, rejection, revocation, and download; authorized FullAccess roles succeeded. An unrelated FullAccess account saw an empty grant list and could not list others' requests or download their ciphertext. |
| 2. Unregistered-key shared quota exhaustion | Pass: ten attempts received 403, the eleventh 429; authenticated shared capacity stayed unused and the registered signer subsequently succeeded. An invalid signature created no D1 limit counters. |
| 3. Replay after nonce cleanup | Pass: original list 200, immediate replay 409, nonce table emptied at day 31, old list still 401. Exact expiry and excessive validity windows also failed. |
| 4. Incomplete retained consent | Pass for new records: request and approval canonical payload/envelope signatures still verified after nonce cleanup. Migration 0004 cannot reconstruct verification material missing from historical rows. |
| 5. Large base64 artifacts | Pass: exact 4,194,304-byte and 8,388,608-byte ciphertexts uploaded with 201 and downloaded intact. Oversized ciphertext/body, malformed base64, and digest mismatch were rejected. |
| 6. Unbounded public-key decoding | Pass: a 100,000-character key received 401 in approximately 95 ms end to end; source bounds decoding before BigInt conversion. This timing is not a CPU benchmark. |
| 7. Valid short block hashes | Pass: three providers agreeing on a valid 43-character, 32-byte hash authorized a request. |
| 8. Malformed RPC envelope | Pass: one JSON-null provider plus two agreeing providers returned 200. |
| 9. Uncertain commit deletes ciphertext | Pass: errors after an actual D1 commit, including failure of the recovery read, preserved the active grant's object through cleanup. A3 identifies a separate recovery-identity defect. |

## Matrix outcome

| Area | Isolated deployed result | Actual preview / remaining gate |
| --- | --- | --- |
| Key authorization | FullAccess/FunctionCall and unrelated-account cases passed using controlled current-key RPC fixtures. | Blocked by A1 before live key-type acceptance. |
| Consent and replay | Request/approval/download/revoke/reject replay, scope/recipient/digest/nonce binding, exact grant expiry, and post-revocation denial passed. SDK encryption → deployed upload/download → SDK decryption passed; nine cryptographic tamper cases failed decryption as expected. | A3 and A4 remain open; live wallet-key lifecycle incomplete. |
| Data limits and cleanup | 4/8 MiB, invalid input, D1 artifact insertion failure, pre/post-commit failure, pre/post-R2-put failure, orphan cleanup, retry, and deletion retry passed. Concurrent downloads at count 19 produced one 200 and one 429, ending at 20. | Normal live-provider storage flow remains untested because A1 prevents authorization. |
| RPC quorum | 3-of-3, one outage with two agreeing, JSON-null tolerance, valid short hash, three-way conflicts, insufficient answers, isolated higher head, and wrong pinned context behaved as tested. | Fail: A1 and A2. Distinct HTTPS origins were verified; independent underlying provider infrastructure was not independently attested. |
| Abuse limits | Signer-key 10/11, shared authenticated 30/31, account 30/31, and invalid/unregistered isolation passed. Shared/account/download boundaries used isolated counter seeding. | Partial: the edge limiter first returned 429 on request **62**, not 61. A strict 60-request boundary is not established. |

The edge result is consistent with Cloudflare's documented approximate, per-location rate limiter. If a strict limit is required, the current binding cannot provide that guarantee; otherwise the matrix should state the intended approximate behavior. [Cloudflare rate-limit accuracy and locality](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy).

A separate SDK compatibility probe found that a wallet which omits the requested optional NEP-413 callback produces a 401 because the SDK always includes `callback_url` in its returned envelope. Sending the exact signed envelope without that callback returned 200. This used a synthetic wallet adapter, not an interactive supported wallet, so it remains a compatibility observation rather than a demonstrated supported-wallet regression.

## Environment and evidence

Reviewed HEAD: `943bf677e04f65d6675c26a227f1e5881b3a62cc`, plus the existing uncommitted RPC tests. Worker/SDK implementation files were not changed. [Manifest and source hashes](acceptance/2026-11-14/manifest.json) identify the reviewed files and environment overrides.

- Actual preview: `lcp-reviewer-access.wasabinetwork.workers.dev`, version `b1882f4b-0c2c-4646-8956-f7795bb8c167`; separate preview D1/R2 and rate-limit namespace `1004`. All four migrations were applied; R2 public access was disabled and no custom domains were configured.
- Production: `reviewer-access.lcp.gama.works`, version `70b4c65b-e247-43be-8e55-12e0f61c2d46`. Only health/preflight requests and configuration inspection were performed; production D1/R2 received no test artifacts or fault injection.
- Disposable environment: `lcp-reviewer-audit-20261114-ple`, its own D1 database and private R2 bucket, namespace `2026111401`, and three separate HTTPS RPC mock Workers. The original Worker module was imported unchanged. The main regression run used version `cb3bb873-942d-4fa3-a473-f13f32182ee4`; later harness versions and per-request versions are in the manifest and ledger.
- Mock time, storage exceptions, counter seeding, and cleanup invocation were explicitly controlled in the disposable wrapper. Per-case edge-key suffixes prevented unrelated tests consuming one another's edge allowance; the edge burst used one fixed key. The temporary `global_fetch_strictly_public` flag enabled calls to same-account RPC mock Workers. Crons and observability were disabled on the harness.
- Live fixture: `lcpmaintainer.testnet`, commitment `35`, accepted evaluation `4`; `lcpsponsor.testnet` acted as reviewer. The supplied keys were verified as FullAccess. Disposable FunctionCall keys were restricted to `wrap.testnet` / `audit_never_called` with allowance 1 yoctoNEAR. Signing used the independent `near-api-js/nep413` serializer. No interactive wallet UI was exercised.

[Request evidence](acceptance/2026-11-14/requests.jsonl) records timestamps, Worker versions, request/correlation IDs, statuses and error codes. [Public checks](acceptance/2026-11-14/public-checks.json) record both health routes returning 200 and exact-origin preflights at 19:48:41 UTC; unrelated origins received no allow-origin header. These checks do not establish authentication. [Transaction evidence](acceptance/2026-11-14/transaction-evidence.json) contains only public hashes and sanitized outcomes for adding/removing the disposable keys.

The ledger labels initial harness setup diagnostics and one invalidated run whose two drivers overlapped storage resets. Those results are excluded from conclusions; affected cases were rerun sequentially. An initial external approval-race test also assumed only 409 could represent rejection, although 404 correctly rejected an already-resolved request. The final A3 reproduction uses an in-Worker barrier with both approvals present before either D1 batch. [Archived wrapper](acceptance/2026-11-14/harness-worker.mjs.txt) and [RPC mock](acceptance/2026-11-14/harness-rpc.mjs.txt) show the instrumentation; their literal resource paths refer to the now-deleted audit environment and are not a deployment recipe.

## Checks and cleanup

Worker tests: **18/18**. SDK tests: **12/12**. Type checking and both deployment dry runs passed. The scoped npm audit of `@lcp/reviewer-access` and `@lcp/sdk` reported **zero vulnerabilities**. Existing tests do not cover A2–A4 adequately. No contract/evaluator implementation was modified, and their broad suites were outside this follow-up's scope.

Both disposable FunctionCall keys were removed and their absence was verified against finalized testnet state. The disposable database tables and bucket were empty before deletion. All four temporary Workers, the temporary D1 database, and the temporary R2 bucket were deleted. See [key verification](acceptance/2026-11-14/key-removal-verification.json), [empty storage snapshot](acceptance/2026-11-14/final-storage-state.json), and [resource cleanup](acceptance/2026-11-14/resource-cleanup.json). Production and the normal preview deployment were not redeployed. No plaintext, private keys, full signatures, reviewer private material, or endpoint tokens are included in the evidence.

Fix A1–A4, resolve the edge-limit acceptance wording/implementation, and rerun the live matrix plus focused independent review before release. Private evaluator input remains outside this acceptance scope and must stay disabled pending its separate verified OutLayer secret-retrieval design and test.
