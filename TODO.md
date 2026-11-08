# Development TODO

## In progress

- [ ] **Live failed tranche recovery:** find a safe deterministic testnet fixture for a failed transfer; the local mock-runtime test already confirms the failure callback accounting and exactly-once retry behavior.
- [ ] **Live arbiter outcomes:** validate `Upheld` and `Invalidated` challenges on fresh testnet commitments; local tests cover evidence retention/invalidation and claim eligibility.

## Next

- [ ] **Temporal boundaries:** verify `AtRisk`, `Breached`, recovery, challenge-window, and timeout transitions at exact boundary timestamps.
- [ ] **Wallet journey:** verify selecting a commitment from the browser list; complete create, fund, activate, evidence, claim/retry, close, and refund flows. Check the older-page control when at least ten records exist.

## Complete

- [x] Add a deterministic contract unit test covering failed callback accounting, restored eligibility, successful retry, and duplicate-callback idempotency.
- [x] Add deterministic contract tests for upheld and invalidated challenge outcomes.
- [x] Deploy bounded newest-first commitment discovery; confirm exclusive cursor pagination through testnet RPC.
- [x] Verify the recent-commitment list renders in Brave against the deployed testnet contract.
- [x] Bind the SDK JSON-RPC `fetch` implementation to `globalThis` so browser views execute correctly.
