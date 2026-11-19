# Pending-callback funding buffer

**Status (2026-11-19):** measurement prepared, value not set. The arithmetic
model, the measured storage input, and the open policy inputs are recorded here.
The production buffer stays an owner decision until the policy inputs are fixed.

**Owner decision (2026-11-19):** the closure method below is accepted; no
numeric buffer or method gas limit is approved yet. Close B2 by fixing the four
policy inputs, completing the missing measurements, rerunning
`tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs` with the approved
inputs, deriving method gas limits from measured worst cases plus margin, and
recording the approved values in `TODO.md` and the deployment runbook with the
gas float kept separate. See
[`P2-OPEN-DECISIONS-REVIEW-PACKAGE.md`](P2-OPEN-DECISIONS-REVIEW-PACKAGE.md)
for the full decision record and canary guidance.

The design already states the cash rule for a pending payout:
`C >= H + planned_outflow`, with `H = S + N + Q + F` (storage, native escrow,
credit, refund liabilities). The 1.07 NEAR and 0.06 NEAR margins in `TODO.md`
are fixture values, not recommendations. This document replaces them with a
formula and explicit inputs.

## Owner decision required (B2)

B2 is not a missing measurement and not a code change. The per-callback storage
cost is measured below; the unresolved input is a **policy limit** that the
design documents do not currently state. To turn the formula into a published
buffer, the owner must fix four values:

1. **Maximum concurrent pending payouts** per commitment (the contract enforces
   no cap, so this is an operational limit).
2. **Stuck-callback allowance**, stated in hours and converted to a count.
3. **Largest single authorized payout or refund**, which replaces the 1 NEAR
   fixture value.
4. **Margin** above the computed subtotal, and whether it is a percentage or a
   flat amount.

These belong in the policy design documents because they bound an operational
obligation, not because the implementation is incomplete. Until they are set,
the sample output (85.50355 NEAR) remains illustrative.

## Measured inputs

Three `usdc-receipt-recovery` probes measure storage inside one mock environment
so the deltas are comparable:

```sh
cargo test -p lcp-core --locked --features usdc-receipt-recovery \
  -- pending_usdc_callback_storage_is_measured \
     failed_usdc_callback_retains_bounded_terminal_storage \
     refund_usdc_callback_storage_is_measured --nocapture
```

| Path | While pending | Settlement delta | Retained |
| --- | --- | --- | --- |
| USDC tranche claim, success | 617 | −418 | 199 |
| USDC tranche claim, failure | 617 | — | 199 net |
| USDC residual refund, success | 512 | −398 | 114 |

Each test asserts a 300–8,192-byte envelope so a layout change cannot silently
escape it. The peak figure covers the pending transfer row, amount and intent
sidecars, tranche pointer, and storage-bond record. The retained figure is the
terminal record left for the finalizer.

Not yet measured: recovery-credit withdrawal attempts (the native credit path
persists a `RefundAttempt`; the existing OOG fixture records its storage but not
as a comparable delta) and out-of-gas retention of a token callback. The refund
path is 105 bytes smaller than the tranche path, so using the 617-byte peak as
the worst case is conservative for these two paths only.

## Model

```sh
node tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs \
  --max-pending 64 \
  --max-outflow-near 1 \
  --storage-bytes 617 \
  --retained-bytes 199 \
  --stuck-callbacks 4 \
  --margin 0.25 \
  --json target/funding-buffer-preliminary.json
```

The model computes:

```
in_flight_outflow   = largest_outflow × max_pending
retained_outflow    = largest_outflow × stuck_callbacks
storage_reserve     = 10^19 yocto × (pending_bytes × max_pending + retained_bytes × stuck_callbacks)
subtotal            = in_flight_outflow + retained_outflow + storage_reserve
recommended_buffer  = subtotal × (1 + margin)
```

with the 2026-11-18 sample inputs above:

| Component | NEAR |
| --- | --- |
| In-flight outflow (64 × 1) | 64 |
| Retained unknown outflow (4 × 1) | 4 |
| Storage reserve (64 × 617 + 4 × 199 bytes) | 0.40284 |
| Subtotal | 68.40284 |
| 25% margin | 17.10071 |
| **Preliminary buffer** | **85.50355** |
| Separate gas float (64 × 20 Tgas) | 0.128 |

Gas is prepaid by the transaction signer and is not contract cash, so it is
reported separately and must not be counted as payout liquidity.

## Why this is not yet a recommendation

- `max_pending = 64`, `stuck_callbacks = 4`, and `margin = 0.25` are policy
  choices, not measurements. The contract does not cap
  `pending_transfer_count`, so the cap must be an operational limit.
- The 617-byte peak covers the tranche claim and failure paths; the refund path
  is smaller. Recovery-credit withdrawal attempts and OOG retention still need
  comparable measurements.
- The largest single outflow is 1 NEAR because that is the largest fixture
  refund attach. Real policies can set a larger tranche or refund bond.
- Delayed-receipt behavior is characterized only by the eight synthetic
  intermediate receipts in the design capture, not by public-network latency.
- The model assumes every pending callback can be stuck at once. A production
  number should use a stated correlation assumption or the observed cap.

## Closing checklist

1. Fix `max_pending` as an enforced or operational limit, and state the stuck
   allowance as hours rather than a callback count.
2. Measure recovery-credit withdrawal and OOG-retention storage with the same
   probe and record them beside the tranche and refund values.
3. Replace the 1 NEAR outflow with the largest policy-authorized single payout.
4. Re-run the model with the remaining measured inputs and record the owner's
   approved buffer in `TODO.md` and the deployment runbook.
5. Keep the gas float separate and monitored; it is not solvency capital.
