# Development TODO

## In progress

- [ ] **Public demo deployment:** deploy the finalized Next.js demo to Coolify at `lcp.gama.works`; keep the source repository private until the NEAR Hackathon entry is ready, and move evaluator artifacts to a custom Cloudflare domain before production use.

## Complete

- [x] **P0 Firefox wallet journey:** commitment `24` completed create, fund, activate, evaluation, close, and refund in Firefox. Its 3-epoch × 5-minute budget ended at epoch 25, so no tranche could be claimed. Finalized read at block `276955602` confirms `Closed`, transfer `#9` settled, and all 0.03 NEAR refunded with 0 pending. The user confirmed the ended-program timer and simplified refund-complete UI in Firefox.
- [x] **P0 retry-transfer UI:** isolated feature-testnet commitment `2` displayed the failed-transfer retry state in Firefox. Initial claim transaction `9KpNC7viTLimjLJcpctisJMLih2Cdoky5ASEEnLkEN9i` succeeded while payout transfer `#3` failed for the one-time nonexistent recipient; the user retried in the UI. Finalized read at block `276961592` confirms tranche `Paid`, 0.001 NEAR paid, and no pending or free escrow.
- [x] **NEP-413 testnet fixture:** commitment `24` is active and evaluation `1` was accepted/compliant in [7WDJecZtyZx9rJvPUraDTvcAznRDAof4UjYEkT3y1Lnc](https://testnet.nearblocks.io/txns/7WDJecZtyZx9rJvPUraDTvcAznRDAof4UjYEkT3y1Lnc). OutLayer executed the R2-mirrored evaluator; it verified the wallet signature and artifact-digest format. FastFS remains unavailable, but the R2 fallback completed the test.
- [x] Add browser-side SHA-256 calculation for selected evidence files (maximum 25 MiB); the file stays local, and changing/removing it invalidates the prepared payload and signature. The user confirmed the Firefox flow.
- [x] Raise the evaluation storage-deposit default to `0.05 NEAR` after the first `0.01 NEAR` request trapped on storage underpayment; the retry succeeded, and contract excess is refunded.
- [x] Add an active-commitment operations funding control for the configured sponsor; the contract already permits operations top-ups before closure, and fresh evaluations can be necessary for recovery.
- [x] **Live temporal boundaries:** commitment `21` transitioned from `AwaitingEvidence` to `AtRisk` at 00:21:58 AST and from `AtRisk` to `Breached` at 01:21:59 AST in finalized samples. The monitor removed its own cron entry after breach; exact timestamp boundaries are also covered by deterministic tests.
- [x] Implement NEP-413 wallet evidence across the contract, evaluator, SDK, and demo while preserving v1 evidence behavior; build checks passed.
- [x] Deploy the v2-capable contract to testnet and verify the new code hash plus existing commitment state. [Deployment transaction](https://testnet.nearblocks.io/txns/HPhtBQgHYgCzJBobDxx3MiGkCzP9WnW6v6MGpKWzeTjc)
- [x] Submit the v2 evaluator artifact to testnet FastFS and record its returned transaction and URL; FastFS currently returns 404.
- [x] Publish a testnet-only R2 mirror of the v2 evaluator, then fetch it publicly and verify the exact byte count and SHA-256.
- [x] Add a deterministic contract unit test covering failed callback accounting, restored eligibility, successful retry, and duplicate-callback idempotency.
- [x] Add deterministic contract tests for upheld and invalidated challenge outcomes.
- [x] Cover exact local boundaries for initial evidence, evidence expiry, grace, recovery, claim eligibility, and challenge timeout.
- [x] Create and activate 15 funded testnet playground commitments with varied policies and initial evidence deadlines staggered across the five-day horizon.
- [x] Validate live upheld, invalidated, and recovery outcomes on playground commitments `8` and `9`.
- [x] Validate failed transfer recovery on a separate feature-gated testnet fixture: force one transfer to a verified missing account, confirm eligibility and escrow recovery, retry payment successfully, and close the fixture commitment.
- [x] Complete an on-chain payout and close/refund journey on playground commitment `19` using the testnet signer: pay one tranche, close, and refund the remaining escrow.
- [x] Add a commitment health timeline that separates recorded activation/evidence from policy-derived deadlines and uses finalized NEAR time.
- [x] Show accepted-evidence age, expiration time, and a countdown to the next health deadline from the refreshable finalized-time snapshot.
- [x] Reconstruct recent Healthy, AtRisk, Breached, and Recovered events from accepted evaluations and timestamped challenge outcomes, while identifying the ten-evaluation history limit.
- [x] Add an honest per-evaluation OutLayer lookup that reports record availability and hash-binding mismatches without claiming the TEE quote was verified in the LCP app.
- [x] Reconcile sampled testnet OutLayer charges/refunds and callback gas for accepted, JSON-null, promise-failure, and timeout outcomes; retain remaining-operation accounting as a documented prototype limitation.
- [x] Deploy the historical challenge completion timestamp view without changing persisted contract state layout; verify prior state and a new invalidation/recovery timeline on testnet commitment `22`.
- [x] Confirm the refreshed `22` dashboard shows recorded recovery events and derived freshness/grace deadlines, and that evaluation `2` matches its public OutLayer transaction/input/output/WASM hashes.
- [x] Confirm the historical timeline and OutLayer hash-binding status render correctly in the user's browser.
- [x] Keep in-app attestation status scoped to public-record and hash-binding checks; use OutLayer's report **Verify** action or standalone verifier for TEE quote verification unless an embeddable verifier interface is documented.
- [x] Inspect commitment `21`'s health clock in the browser; the user confirmed its `AwaitingEvidence` state and displayed initial/grace deadlines match the pre-deadline monitor state.
- [x] Prepare a browser walkthrough for verified testnet fixtures and the remaining wallet-driven journey.
- [x] Install a bounded, once-per-minute cron monitor for commitment `21`; record finalized health samples in `/private/tmp/lcp-temporal-monitor-21.jsonl` and remove only its own entries after breach/closure or the 03:00 AST cutoff.
- [x] Add a visible wallet disconnect action to the demo header.
- [x] Confirm wallet disconnect succeeds in the browser (user confirmed).
- [x] Verify the older-page control with 21 records in the browser (user confirmed).
- [x] Confirm Meteor connects the demo to NEAR testnet after explicitly configuring the connector network (user verified).
- [x] Confirm testnet pagination pages as IDs `21–12`, `11–2`, and `1`.
- [x] Deploy bounded newest-first commitment discovery; confirm exclusive cursor pagination through testnet RPC.
- [x] Verify the recent-commitment list renders in Brave against the deployed testnet contract.
- [x] Select a recent commitment in Brave and verify its detail panel loads contract state and available actions.
- [x] Bind the SDK JSON-RPC `fetch` implementation to `globalThis` so browser views execute correctly.

## Deferred product decision: private evidence access

- Do not expose maintainer email/Telegram details or create a public upload inbox. Keep evidence private by default; any future sharing should require a reviewer wallet request and explicit maintainer approval, with scoped temporary access and no public contact data.
- The current browser hashes a local file but does not upload it. The public digest is only a maintainer-signed commitment; the evaluator checks signature, binding, and digest format, not the artifact's contents. Reviewers need the original file to independently verify it.
- Before production, choose between intentionally public artifacts and private encrypted storage. Review hash correlation/dictionary risks and version any salted or encrypted commitment format before implementation.
