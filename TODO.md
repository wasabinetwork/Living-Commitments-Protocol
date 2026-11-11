# Development TODO

## In progress

- [x] **Cloudflare Pages preview:** deployed the transaction-authenticated operator inbox and wallet-session restoration to <https://preview.lcp-preview.pages.dev> on 2026-11-11. The static `/health` endpoint returns HTTP 200; the new two-operator flow and refresh persistence still need a Firefox walkthrough.
- [ ] **Production domain:** attach `lcp.gama.works` when the LCP Console is finalized. The static `/health` JSON route is prepared in the build; it will be reachable at the production domain after deployment. The `lcp-preview` Direct Upload project is intentionally separate from any future Git-integrated production project.

## P0 public-readiness checklist

- [x] Add contract callback, refund, claim-gating, timestamp, recovery-policy, temporal, and evaluator regression coverage; see `TESTING.md` for the consolidated Rust and JavaScript commands.
- [x] Add reproducible Rust/WASM build instructions, test coverage map, and manual testnet/browser steps in `TESTING.md` and `CONSOLE-GUIDE.md`.
- [x] Reconcile testnet lifecycle and Firefox results in `TESTNET-E2E-STATUS.md` and the technical specification.
- [x] Apply Apache-2.0 to project-authored material and explicitly exclude the upstream `NEAR-HACKATHON-SKILL.md` snapshot.
- [ ] Publish the repository. This makes PRD requirement LCP-017's tests and reproduction instructions publicly accessible; until then it is prepared but not formally closed.

The production Git-integrated Pages project and `lcp.gama.works` domain are separate deployment tasks, not P0 protocol acceptance criteria.

## P1 roadmap

- [x] Add reusable, editable starter policy templates for the LCP Console; Firefox verified both presets, edits, preserved role/artifact fields, and light/dark notes on 2026-11-09. Templates prefill subject and policy values only; the community-service example is illustrative and does not imply proof of service quality.
- [x] Record the staged evidence, privacy, amendment, and authority architecture in [P1-ARCHITECTURE.md](P1-ARCHITECTURE.md).
- [x] Define evidence confidence as visible provenance, freshness, and source agreement rather than a probability of truth.
- [x] Simplify v3 commitment creation with a guided policy form, starter defaults, collapsed advanced settings, browser-generated target salt/fingerprint, and NEAR-wallet key pinning.
- [x] Add an in-app, same-origin service health check and NEAR report inbox so operators do not need separate report keys, terminal commands, or JSON handoff. Legacy source-policy v1 keeps NEP-413 support; new schema v2 reports are submitted by each operator's wallet transaction. The updated contract, evaluator, and Console are deployed; the separate-device Firefox pilot passed on commitment `27`.
- [x] Implement the NEAR report inbox keyed by commitment/evaluation/source. Each staged report has a deliberate 4 KiB application limit, one entry per source and upcoming evaluation, and a 15-minute hard expiry capped by source freshness. Storage bonds become withdrawable credits after consumption, replacement, or reclaim. Contract tests cover bounded reports, replacement, replay rejection, expiry, and refund settlement.
- [x] Publish the transaction-authenticated evaluator to R2 and upgrade the testnet contract. Contract hash: `FR3TS4oyqGRtHxjo8y7jLRi13ruWwJ3Cs9gdcKgT3mvG`; evaluator SHA-256: `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`.
- [x] Create a fresh commitment with the v2 evaluator URL/digest and complete the two-operator testnet pilot on commitment `27`. Evaluations `#1` and `#2` were accepted/compliant with 2/2 valid UP reports and 100% corroboration; evaluation `#2` also exercised report replacement and refund withdrawal. Commitment `26` remains on its older evaluator and is not the v2 inbox pilot.
- [ ] Improve the Console's overall layout and information hierarchy, then review WCAG 2.1 at 320 CSS px, 200% text zoom, keyboard-only focus, text-spacing overrides, status announcements, and light/dark contrast. Current styles set 16px body text, 14px small/form text, visible focus outlines, and 44px controls; these are implementation targets, not a completed conformance audit.
- [ ] Decide whether to add an explicitly labeled single-source OutLayer TEE probe. WASI Preview 2 can make HTTPS requests, but this shifts trust from independent operator locations to OutLayer's network environment and requires private endpoint input handling.
- [x] Add the signed-probe offline pilot kit and manually exercise compliant and corroboration-threshold outcomes with locally generated reports; this validates serialization and aggregation only, not operator independence or a live commitment.
- [x] Check `https://preview.lcp-preview.pages.dev/health` from two operator locations on different IP addresses; both returned HTTP 200 on 2026-11-09. This confirms reachability only, not signed probes or source independence.
- [ ] Complete the community-service availability pilot with signed reports from at least two operators. Commitment `25` remains active with an immutable production endpoint fingerprint and must not be evaluated. Commitment `26` pins the preview target. Evaluation `#1` was accepted as `Inconclusive` at finalized block `277119378` because one report exceeded the 300-second source-age limit; this confirms stale-report filtering. Evaluation `#2` used the fresh two-report bundle (matching evidence hash `9389221362257a96f6a9a655797e1f5200415d8f143fabfea699249cb435ebf`) but ended `TimedOut` with `OUTLAYER_TIMEOUT` after the 30-second request deadline. The two retry calls were made while evaluation `#2` was pending; the later expiry call was made after it had already timed out. The 0.02 NEAR operations budget is now fully authorized, so diagnose the OutLayer callback and add operations funding before another attempt. The standalone probe handles Node 26's multi-address DNS callback behavior.
- [x] Implement a Cloudflare Worker that indexes finalized LCP events in D1, exposes paginated read-only history, and optionally displays that history in the LCP Console; contract reads remain authoritative.
- [x] Create the testnet D1 database and deploy the Worker at `https://lcp-event-indexer.wasabinetwork.workers.dev` with a once-per-minute Cron Trigger.
- [x] Verify preview-origin CORS preflight against the deployed Worker.
- [x] Add a D1 lease to prevent overlapping Cron runs; three consecutive 20-block scheduled runs completed without FastNear rate-limit errors.
- [x] Confirm the LCP Console archive card in Firefox reports the indexer's catching-up status and explains that older events may not be available yet.
- [ ] Continue the historical backfill to the current head and verify multi-page commitment event paging once enough history is indexed. On 2026-11-10 the live Worker was degraded at block `276824565` (next `276824566`, 286,034 blocks behind head `277110599`). FastNear and NEAR RPC both report `276824566` absent, while block `276824567` links to the last indexed hash; handle skipped heights without weakening parent-hash continuity checks before resuming the backfill.
- [x] Draft the private reviewer request, maintainer consent, encrypted artifact, scoped-access, and revocation model; validate per-commitment OutLayer secret permissions before implementation.
- [x] Implement the local private reviewer workflow: NEP-413 requests, maintainer approval/rejection, salted digest receipts, browser AES-GCM/HPKE encryption, local encrypted key backup, signed downloads, revocation, scheduled ciphertext expiry/orphan cleanup, and bounded 90-day retention for terminal metadata. Automated local checks pass; independent security review, Cloudflare provisioning, and deployment remain.
- [x] Integrate a v3 source roster and multiple independent evidence sources while preserving v1/v2 commitments; v3 uses separate raw-storage policy and summary keys.
- [x] Integrate configurable quorum and corroboration thresholds on-chain and validate callback summary arithmetic.
- [x] Expose source agreement coverage in commitment views and the LCP Console as source agreement, not a probability of truth.

## Next sprint

- [x] Implement the local transaction-authenticated inbox path as source-policy schema v2. New policies list operator accounts without keys; each operator submits from their own wallet transaction, and only contract inbox state can supply report provenance to the evaluator. Schema v1 and existing NEP-413 commitments remain supported.
- [x] Remove service-operator key pinning from new commitment setup. The creator lists accounts without having those wallets present; each operator opts in by submitting from the listed account on their own device.
- [x] Restore the NEAR Connector's persisted wallet session on page load using `getConnectedWallet()`. Show a restoring state and keep the wallet selected across refreshes; Firefox confirmed both wallet persistence after refresh and that explicit disconnect stays disconnected after refresh.
- [x] Improve operator setup layout and feedback: account-only rows, responsive fields, separate-device instructions, and error notices that scroll into view.
- [x] Build and publish the v2 contract/evaluator, upgrade the testnet contract, and deploy the updated Console preview. The deployment preserves existing commitments and their immutable evaluators.
- [x] Fix service-commitment creation storage underpayment: the old 0.01 NEAR default was below the 0.01263 NEAR required for the reproduced two-operator policy. Service-policy creation now attaches a fixed 0.05 NEAR reserve and explains that the contract refunds excess; regression tests cover the old failure and new reserve.
- [x] Create fresh source-policy v2 testnet commitment `27` with the transaction-authenticated evaluator and account-only roster; the commitment is active.
- [x] Submit reports from both listed operator accounts on separate devices and complete commitment `27` evaluation `#1`: Accepted / Compliant, 2 of 2 valid reports UP, 100% corroboration.
- [x] Replace Operator A's report for evaluation `#2`, withdraw the replaced report's storage credit, submit Operator B's report, and request evaluation. Evaluation `#2` was Accepted / Compliant with 2/2 valid UP reports and 100% corroboration. The wallet stayed connected after page refresh.
- [x] Label schema v2 reports as NEAR wallet-authenticated in Console notices, while preserving “signed” wording for legacy schema v1.
- [x] Withdraw both report-storage credits: 0.0124 NEAR to `wasabinetwork.testnet` and 0.01233 NEAR to `lcptester.testnet`; finalized balances are zero.
- [x] Validate expired-report reclaim on testnet using commitment `27`, evaluation `3`: Operator A's 0.0124 NEAR storage bond was credited after reclaim, the withdrawal reconciled, and the inbox/refund balance returned to empty/zero.
- [ ] Validate exact report replay rejection on testnet. The local contract test passes. Report replacement, expiry reclaim, wallet restoration, and explicit-disconnect persistence after refresh passed on commitment `27`. The regular Console flow generates a fresh report on each probe, so live exact replay needs a controlled repeat of the identical report payload; another probe tests replacement instead. Commitment `26` remains on the old evaluator with its separate timed-out request and exhausted operations budget.
- [ ] Improve the Console's overall visual layout and information hierarchy across desktop and mobile; track the WCAG review in the P1 roadmap above.
- [ ] Park the optional direct OutLayer TEE probe for a later design decision. WASI Preview 2 can make HTTPS requests, but this would replace independent operator quorum with OutLayer's network vantage point and requires a private endpoint-input path. It must be presented as a separate trust mode, not equivalent evidence.
- [x] Implement consent-based v3 source-policy amendments with affected-party approvals, future activation, cancellation/expiry, event history, policy-digest preservation, and a restarted evidence clock. Automated local checks pass; testnet deployment and lifecycle validation remain.
- [x] Implement a bounded payout authority grant and sample NEAR adapter. Grants are limited to a named adapter and fixed recipient, require full tranche eligibility, and do not touch LCP escrow or user wallet keys. The adapter pool manager can withdraw only available pool funds with asynchronous failure reconciliation. Automated local checks pass; testnet deployment and settlement validation remain.
- [x] Run the consolidated local validation pass after the v2 transaction-authentication changes: 67 Rust tests and 24 JavaScript tests passed; Console production build, contract/evaluator WASM builds, formatting, and `git diff --check` passed.
- [ ] Provision private Cloudflare D1/R2 resources, configure the production origin, and deploy reviewer access after security review.
- [ ] Verify OutLayer per-commitment secret provisioning/retrieval before implementing private evaluator input. The reviewer file is a private supplement, not evaluator input or a proven match to the public evaluation hash.
- [ ] Deploy and validate amendments and the adapter on dedicated testnet commitments after the community-service pilot and contract upgrade review.

For the indexer, use a finalized NEAR block feed and persist each block's LCP events with its cursor atomically; the LCP Console must continue reading health and settlement from the contract. The [FastNear NEAR Data Server](https://github.com/fastnear/neardata-server) provides finalized blocks and receipt outcomes without requiring a custom node. The [NEAR indexer client](https://github.com/near/near-indexer-client) remains an alternative when operating a dedicated nearcore node; public RPC endpoints do not expose its indexer method. NEAR's developer guide lists QueryAPI as deprecated. Keep the community-service pilot limited to public endpoint signals. The new reviewer service supports post-evaluation private review, but confidential evaluator inputs remain blocked until the TEE retrieval path is implemented and reviewed.

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

## Reviewer-access boundaries

- Keep email and chat handles out of the Console and do not create a public upload inbox. Reviewer identity is a NEAR account, with signed requests and maintainer consent.
- The private salted digest is separate from the public on-chain evaluation hash; the grant does not prove that a file was the evaluator's input. Keep confidential files out of evaluator inputs until the OutLayer secret retrieval path is implemented.
- Revocation blocks future downloads and removes stored ciphertext after deployment; it cannot erase copies already received. See [P1-ARCHITECTURE.md](P1-ARCHITECTURE.md) and [services/reviewer-access/README.md](services/reviewer-access/README.md).
