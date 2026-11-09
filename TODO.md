# Development TODO

## In progress

- [ ] **Live temporal boundaries:** observe expiry, grace, and recovery on the new short-horizon testnet commitments; exact local timestamp boundaries are covered.
- [ ] **Demo wallet journey:** finish checking create, fund, activate, evidence, claim/retry, close, and refund through the browser wallet UI; the user reports no bugs so far.

## Complete

- [x] Add a deterministic contract unit test covering failed callback accounting, restored eligibility, successful retry, and duplicate-callback idempotency.
- [x] Add deterministic contract tests for upheld and invalidated challenge outcomes.
- [x] Cover exact local boundaries for initial evidence, evidence expiry, grace, recovery, claim eligibility, and challenge timeout.
- [x] Create and activate 15 funded testnet playground commitments with varied policies and initial evidence deadlines staggered across the five-day horizon.
- [x] Validate live upheld, invalidated, and recovery outcomes on playground commitments `8` and `9`.
- [x] Validate failed transfer recovery on a separate feature-gated testnet fixture: force one transfer to a verified missing account, confirm eligibility and escrow recovery, retry payment successfully, and close the fixture commitment.
- [x] Complete an on-chain payout and close/refund journey on playground commitment `19` using the testnet signer: pay one tranche, close, and refund the remaining escrow.
- [x] Add a commitment health timeline that separates recorded activation/evidence from policy-derived deadlines and uses finalized NEAR time.
- [x] Inspect commitment `21`'s health clock in the browser; the user confirmed its `AwaitingEvidence` state and displayed initial/grace deadlines match the pre-deadline monitor state.
- [x] Prepare a browser walkthrough for verified testnet fixtures and the remaining wallet-driven journey.
- [x] Install a bounded, once-per-minute cron monitor for commitment `21`; record finalized health samples in `/private/tmp/lcp-temporal-monitor-21.jsonl` and remove only its own entries after breach/closure or the 03:00 AST cutoff.
- [x] Add a visible wallet disconnect action to the demo header.
- [x] Confirm wallet disconnect succeeds in the browser (user confirmed).
- [x] Verify the older-page control with 21 records in the browser (user confirmed).
- [x] Confirm the browser wallet connector opens and connects successfully (user confirmed).
- [x] Confirm testnet pagination pages as IDs `21–12`, `11–2`, and `1`.
- [x] Deploy bounded newest-first commitment discovery; confirm exclusive cursor pagination through testnet RPC.
- [x] Verify the recent-commitment list renders in Brave against the deployed testnet contract.
- [x] Select a recent commitment in Brave and verify its detail panel loads contract state and available actions.
- [x] Bind the SDK JSON-RPC `fetch` implementation to `globalThis` so browser views execute correctly.
