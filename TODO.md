# Development TODO

## In progress

- [ ] **NEP-413 testnet fixture:** confirm the uploaded evaluator is served by FastFS (its returned URL currently gives 404), then create a fresh v2 commitment through the connected wallet and validate maintainer-key pinning plus evidence signing end to end.
- [x] **Live temporal boundaries:** commitment `21` transitioned from `AwaitingEvidence` to `AtRisk` at 00:21:58 AST and from `AtRisk` to `Breached` at 01:21:59 AST in finalized samples. The monitor removed its own cron entry after breach; exact timestamp boundaries are also covered by deterministic tests.
- [ ] **Demo wallet journey:** finish checking create, fund, activate, evidence, claim/retry, close, and refund through the browser wallet UI; the user reports no bugs so far.

## Complete

- [x] Implement NEP-413 wallet evidence across the contract, evaluator, SDK, and demo while preserving v1 evidence behavior; build checks passed.
- [x] Deploy the v2-capable contract to testnet and verify the new code hash plus existing commitment state. [Deployment transaction](https://testnet.nearblocks.io/txns/HPhtBQgHYgCzJBobDxx3MiGkCzP9WnW6v6MGpKWzeTjc)
- [x] Submit the v2 evaluator artifact to testnet FastFS and record its returned transaction and URL; keep public URL retrieval as an open validation item because the current response is 404.
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
