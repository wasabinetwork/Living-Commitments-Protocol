# Pending-callback funding buffer

**Status (2026-11-19):** storage measurements complete, value not set. The
arithmetic model, the four measured payout paths, and the open policy inputs are
recorded here.
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
the sample output (85.52445 NEAR) remains illustrative.

## Measured inputs

Five `usdc-receipt-recovery` probes measure storage inside one mock environment
so the deltas are comparable:

```sh
cargo test -p lcp-core --locked --features usdc-receipt-recovery \
  -- pending_usdc_callback_storage_is_measured \
     failed_usdc_callback_retains_bounded_terminal_storage \
     refund_usdc_callback_storage_is_measured \
     credit_withdrawal_storage_is_measured \
     token_callback_oog_retains_the_pending_footprint --nocapture
```

| Path | While pending | Settlement delta | Retained |
| --- | --- | --- | --- |
| USDC tranche claim, success | 617 | −418 | 199 |
| USDC tranche claim, callback never resolves (OOG) | 617 | 0 | 617 |
| USDC tranche claim, failure | 617 | — | 199 net |
| USDC residual refund, success | 512 | −398 | 114 |
| Native credit withdrawal, success | 26 | −114 | 0 |
| Native credit withdrawal, failure | 26 | −26 | 0 (credit restored) |

Each probe fails if its delta exceeds 8,192 bytes; the claim and refund probes
also require at least 300 bytes, and the unresolved-callback probe asserts an
exact 0-byte committed delta. The peak figure covers the pending transfer row,
amount and intent sidecars, tranche pointer, and storage-bond record. The
retained figure for a settled transfer is the terminal record left for the
finalizer.

An out-of-gas callback receipt reverts its own writes, so the committed state is
the pending state. The OOG probe confirms the callback leaves storage unchanged
and the transfer row, amount and intent sidecars, tranche pointer, and
storage-bond record all remain, which makes OOG retention the full 617-byte
pending footprint rather than the 199-byte terminal record. The native credit
withdrawal path is cheaper: it removes the payer credit key and writes a
26-byte attempt row, releases 114 bytes on success, and on failure restores the
credit (net −26) instead of retaining an unresolved record.

## Model

```sh
node tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs \
  --max-pending 64 \
  --max-outflow-near 1 \
  --storage-bytes 617 \
  --retained-bytes 617 \
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

with the 2026-11-19 measured storage inputs and the sample policy values:

| Component | NEAR |
| --- | --- |
| In-flight outflow (64 × 1) | 64 |
| Retained unknown outflow (4 × 1) | 4 |
| Storage reserve (64 × 617 + 4 × 617 bytes) | 0.41956 |
| Subtotal | 68.41956 |
| 25% margin | 17.10489 |
| **Preliminary buffer** | **85.52445** |
| Separate gas float (64 × 20 Tgas) | 0.128 |

Gas is prepaid by the transaction signer and is not contract cash, so it is
reported separately and must not be counted as payout liquidity.

## Proposed canary inputs (awaiting owner sign-off)

These are proposed defaults for review, not approved policy:

| Input | Proposed value | Basis |
| --- | --- | --- |
| Maximum simultaneous pending payouts | 16 per instance | Small enough for one canary treasury and a daily operator check, above the four simultaneous transfers the callback fixture exercised. Enforced operationally: pause new token outflows once 16 are outstanding, because the contract caps no count |
| Stuck-callback allowance | 24 hours, converted to 16 callbacks | Correlation assumption: one shared token-contract or RPC incident stalls every callback in flight at once, so the allowance is bounded by the 16-pending cap rather than a per-callback failure rate. A 24-hour allowance exceeds the observed settlement time by orders of magnitude and leaves time for the daily check to intervene |
| Largest single authorized payout or refund | 1 NEAR per commitment | The largest fixture refund attach and the amount every capture settles. Raising it raises the buffer proportionally, so raise it deliberately with a new calculation |
| Margin | 25% of the subtotal | Percentage, not flat, so it tracks the outflow term |

The proposed buffer is 40.2468 NEAR, with a separate 0.064 NEAR gas float
(16 pending × 40 Tgas at 0.0001 NEAR/Tgas). The 40 Tgas figure is the
`recover_nep141_transfer` operator-policy floor, which is itself above the
1.5× derived floor; it is prepaid by the signer and is not part of the buffer.

```sh
node tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs \
  --max-pending 16 \
  --max-outflow-near 1 \
  --storage-bytes 617 \
  --retained-bytes 617 \
  --stuck-callbacks 16 \
  --margin 0.25 \
  --gas-tgas-per-callback 40 \
  --json target/funding-buffer-proposed.json
```

Until the owner approves these four values, the buffer stays unapproved and
the canary acceptance record must not cite it as funded policy.

## Why this is not yet a recommendation

- `max_pending = 64`, `stuck_callbacks = 4`, and `margin = 0.25` are policy
  choices, not measurements. The contract does not cap
  `pending_transfer_count`, so the cap must be an operational limit.
- The 617-byte peak covers all four payout paths: the refund path is 512 pending
  / 114 retained, and the native credit withdrawal is 26 pending. An unresolved
  callback retains the whole pending footprint, which is why `retained_bytes` is
  617 rather than the 199-byte terminal record.
- The largest single outflow is 1 NEAR because that is the largest fixture
  refund attach. Real policies can set a larger tranche or refund bond.
- Delayed-receipt behavior is characterized only by the eight synthetic
  intermediate receipts in the design capture, not by public-network latency.
- The model assumes every pending callback can be stuck at once. A production
  number should use a stated correlation assumption or the observed cap.

## Closing checklist

1. Fix `max_pending` as an enforced or operational limit, and state the stuck
   allowance as hours rather than a callback count.
2. ~~Measure recovery-credit withdrawal and OOG-retention storage with the same
   probe and record them beside the tranche and refund values.~~ Measured
   2026-11-19: `credit_withdrawal_storage_is_measured` (26 pending / −114 success
   / −26 failure) and `token_callback_oog_retains_the_pending_footprint` (617
   pending, 0 committed delta, 617 retained).
3. Replace the 1 NEAR outflow with the largest policy-authorized single payout.
4. Re-run the model with the remaining measured inputs and record the owner's
   approved buffer in `TODO.md` and the deployment runbook.
5. Keep the gas float separate and monitored; it is not solvency capital.
