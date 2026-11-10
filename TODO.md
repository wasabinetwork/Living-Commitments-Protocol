# Development TODO

## In progress

- [x] **Cloudflare Pages preview:** deployed the LCP Console to https://preview.lcp-preview.pages.dev; Firefox checks confirmed wallet connection, NEAR reads, and OutLayer report lookup work. The new /health endpoint returned HTTP 200 JSON on the preview deployment.
- [ ] **Production domain:** attach `lcp.gama.works` when the LCP Console is finalized. The static `/health` JSON route is prepared in the build; it will be reachable at the production domain after deployment. The `lcp-preview` Direct Upload project is intentionally separate from any future Git-integrated production project.

## P0 public-readiness checklist

- [x] Add contract callback, refund, claim-gating, timestamp, recovery-policy, temporal, and evaluator CLI regression coverage; `cargo test --workspace` currently runs 37 tests.
- [x] Add reproducible Rust/WASM build instructions, test coverage map, and manual testnet/browser steps in `TESTING.md` and `CONSOLE-GUIDE.md`.
- [x] Reconcile testnet lifecycle and Firefox results in `TESTNET-E2E-STATUS.md` and the technical specification.
- [x] Apply Apache-2.0 to project-authored material and explicitly exclude the upstream `NEAR-HACKATHON-SKILL.md` snapshot.
- [ ] Publish the repository. This makes PRD requirement LCP-017's tests and reproduction instructions publicly accessible; until then it is prepared but not formally closed.

The production Git-integrated Pages project and `lcp.gama.works` domain are separate deployment tasks, not P0 protocol acceptance criteria.

## P1 roadmap

- [x] Add reusable, editable starter policy templates for the LCP Console; Firefox verified both presets, edits, preserved role/artifact fields, and light/dark notes on 2026-11-09. Templates prefill subject and policy values only; the community-service example is illustrative and does not imply proof of service quality.
- [x] Record the staged evidence, privacy, amendment, and authority architecture in [P1-ARCHITECTURE.md](P1-ARCHITECTURE.md).
- [x] Define evidence confidence as visible provenance, freshness, and source agreement rather than a probability of truth.
- [x] Add the signed-probe offline pilot kit and manually exercise compliant and corroboration-threshold outcomes with locally generated reports; this validates serialization and aggregation only, not operator independence or a live commitment.
- [ ] Run the community-service availability pilot with at least two independent operators; the signed-probe tool, canonical request assembler, evaluator prototype, and offline runbook exist, but no independent live pilot or contract integration has been completed.
- [x] Implement a Cloudflare Worker that indexes finalized LCP events in D1, exposes paginated read-only history, and optionally displays that history in the LCP Console; contract reads remain authoritative.
- [x] Create the testnet D1 database and deploy the Worker at `https://lcp-event-indexer.wasabinetwork.workers.dev` with a once-per-minute Cron Trigger.
- [x] Verify preview-origin CORS preflight against the deployed Worker.
- [x] Add a D1 lease to prevent overlapping Cron runs; three consecutive 20-block scheduled runs completed without FastNear rate-limit errors.
- [x] Confirm the LCP Console archive card in Firefox reports the indexer's catching-up status and explains that older events may not be available yet.
- [ ] Continue the historical backfill to the current head and verify multi-page commitment event paging once enough history is indexed.
- [x] Draft the private reviewer request, maintainer consent, encrypted artifact, scoped-access, and revocation model; validate per-commitment OutLayer secret permissions before implementation.
- [ ] Integrate a v3 source roster and multiple independent evidence sources while preserving v1/v2 commitments.
- [ ] Integrate configurable quorum and corroboration thresholds on-chain; the standalone evaluator exercises these rules off-chain only.
- [ ] Expose source agreement coverage in commitment views and the LCP Console without presenting it as a probability of truth.
- [ ] Add consent-based policy amendments that preserve prior policy digests and record affected-party approvals.
- [ ] Add a contract-gated authority consequence adapter that operates only for accounts that explicitly grant it authority.

For the indexer, use a finalized NEAR block feed and persist each block's LCP events with its cursor atomically; the LCP Console must continue reading health and settlement from the contract. The [FastNear NEAR Data Server](https://github.com/fastnear/neardata-server) provides finalized blocks and receipt outcomes without requiring a custom node. The [NEAR indexer client](https://github.com/near/near-indexer-client) remains an alternative when operating a dedicated nearcore node; public RPC endpoints do not expose its indexer method. NEAR's developer guide lists QueryAPI as deprecated. Keep the community-service pilot limited to public endpoint signals; do not pass confidential artifacts into multi-source evaluation until the reviewer privacy boundary is implemented. Leave on-chain policy and consequence authority unchanged until versioning and consent models are specified.

## Complete

- [x] **P0 Firefox wallet journey:** commitment `24` completed create, fund, activate, evaluation, close, and refund in Firefox. Its 3-epoch × 5-minute budget ended at epoch 25, so no tranche could be claimed. Finalized read at block `276955602` confirms `Closed`, transfer `#9` settled, and all 0.03 NEAR refunded with 0 pending. Firefox checks confirmed the ended-program timer and simplified refund-complete UI.
- [x] **P0 retry-transfer UI:** isolated feature-testnet commitment `2` displayed the failed-transfer retry state in Firefox. Initial claim transaction `9KpNC7viTLimjLJcpctisJMLih2Cdoky5ASEEnLkEN9i` succeeded while payout transfer `#3` failed for the one-time nonexistent recipient; retry completed in the UI. Finalized read at block `276961592` confirms tranche `Paid`, 0.001 NEAR paid, and no pending or free escrow.
- [x] **NEP-413 testnet fixture:** commitment `24`'s evaluation `1` was accepted/compliant in [7WDJecZtyZx9rJvPUraDTvcAznRDAof4UjYEkT3y1Lnc](https://testnet.nearblocks.io/txns/7WDJecZtyZx9rJvPUraDTvcAznRDAof4UjYEkT3y1Lnc); fresh evidence later recovered it, and it is now closed with the residual refund settled. OutLayer executed the R2-mirrored evaluator and verified the wallet signature and artifact-digest format. The FastFS URL returned HTTP 404 at last check, so the R2 fallback completed the test.
- [x] Add browser-side SHA-256 calculation for selected evidence files (maximum 25 MiB); the file stays local, and changing/removing it invalidates the prepared payload and signature. Firefox checks confirmed the flow.
- [x] Raise the evaluation storage-deposit default to `0.05 NEAR` after the first `0.01 NEAR` request trapped on storage underpayment; the retry succeeded, and contract excess is refunded.
- [x] Add an active-commitment operations funding control for the configured sponsor; the contract already permits operations top-ups before closure, and fresh evaluations can be necessary for recovery.
- [x] **Live temporal boundaries:** commitment `21` transitioned from `AwaitingEvidence` to `AtRisk` at 00:21:58 AST and from `AtRisk` to `Breached` at 01:21:59 AST in finalized samples. The monitor removed its own cron entry after breach; exact timestamp boundaries are also covered by deterministic tests.
- [x] Implement NEP-413 wallet evidence across the contract, evaluator, SDK, and LCP Console while preserving v1 evidence behavior; build checks passed.
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
- [x] Confirm the historical timeline and OutLayer hash-binding status render correctly in Firefox.
- [x] Keep in-app attestation status scoped to public-record and hash-binding checks; use OutLayer's report **Verify** action or standalone verifier for TEE quote verification unless an embeddable verifier interface is documented.
- [x] Inspect commitment `21`'s health clock in the browser; its `AwaitingEvidence` state and displayed initial/grace deadlines matched the pre-deadline monitor state.
- [x] Prepare a browser walkthrough for verified testnet fixtures and wallet-driven journeys.
- [x] Install a bounded, once-per-minute cron monitor for commitment `21`; record finalized health samples in `/private/tmp/lcp-temporal-monitor-21.jsonl` and remove only its own entries after breach/closure or the 03:00 AST cutoff.
- [x] Add a visible wallet disconnect action to the LCP Console header.
- [x] Confirm wallet disconnect succeeds in Firefox.
- [x] Verify the older-page control with 21 records in Firefox.
- [x] Confirm Meteor connects the LCP Console to NEAR testnet after explicitly configuring the connector network.
- [x] Confirm testnet pagination pages as IDs `21–12`, `11–2`, and `1`.
- [x] Deploy bounded newest-first commitment discovery; confirm exclusive cursor pagination through testnet RPC.
- [x] Verify the recent-commitment list renders in Brave against the deployed testnet contract.
- [x] Select a recent commitment in Brave and verify its detail panel loads contract state and available actions.
- [x] Bind the SDK JSON-RPC `fetch` implementation to `globalThis` so browser views execute correctly.

## Deferred implementation: private evidence access

- Keep email and chat handles out of the Console and do not create a public upload inbox. The proposed reviewer-request, maintainer-consent, encrypted-storage, and scoped-access model is in [P1-ARCHITECTURE.md](P1-ARCHITECTURE.md).
- Current v1/v2 evaluation arguments and signed payloads are public on NEAR; only the selected artifact file stays in the browser. The current digest does not prove artifact contents or provide private sharing.
- Before implementation, verify the per-commitment OutLayer secret grant and retrieval path, add salted commitments for private artifacts, and preserve v1/v2 behavior. Revocation can stop future access but cannot erase copies already received.
