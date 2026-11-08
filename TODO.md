# Development TODO

## In progress

- [ ] **Live failed tranche recovery:** find a safe deterministic testnet fixture for a failed transfer; the local mock-runtime test already confirms the failure callback accounting and exactly-once retry behavior.
- [ ] **Live temporal boundaries:** observe expiry, grace, and recovery on the new short-horizon testnet commitments; exact local timestamp boundaries are covered.
- [ ] **Demo wallet journey:** confirm connect/disconnect, then exercise create, fund, activate, evidence, claim/retry, close, and refund through the browser wallet UI.

## Complete

- [x] Add a deterministic contract unit test covering failed callback accounting, restored eligibility, successful retry, and duplicate-callback idempotency.
- [x] Add deterministic contract tests for upheld and invalidated challenge outcomes.
- [x] Cover exact local boundaries for initial evidence, evidence expiry, grace, recovery, claim eligibility, and challenge timeout.
- [x] Create and activate 15 funded testnet playground commitments with varied policies and initial evidence deadlines staggered across the five-day horizon.
- [x] Validate live upheld, invalidated, and recovery outcomes on playground commitments `8` and `9`.
- [x] Complete an on-chain payout and close/refund journey on playground commitment `19` using the testnet signer: pay one tranche, close, and refund the remaining escrow.
- [x] Add a visible wallet disconnect action to the demo header.
- [x] Verify the older-page control with 21 records in the browser (user confirmed).
- [x] Confirm the browser wallet connector opens and connects successfully (user confirmed).
- [x] Confirm testnet pagination pages as IDs `21–12`, `11–2`, and `1`.
- [x] Deploy bounded newest-first commitment discovery; confirm exclusive cursor pagination through testnet RPC.
- [x] Verify the recent-commitment list renders in Brave against the deployed testnet contract.
- [x] Select a recent commitment in Brave and verify its detail panel loads contract state and available actions.
- [x] Bind the SDK JSON-RPC `fetch` implementation to `globalThis` so browser views execute correctly.
