# Pending-callback funding buffer

**Status (2026-11-19):** storage measurements complete and canary buffer inputs
approved by the owner. The arithmetic model and the four measured payout paths
are recorded here; the gas float is reported separately and is not solvency
capital.

**Owner decision (2026-11-19):** the closure method and the four canary policy
inputs below are approved. Recovery-credit withdrawal and callback-OOG-retention
storage are measured, and `tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs`
computes the approved buffer from those measurements and inputs. Method gas
floors are partially derived from committed worst-case captures in
`tests/sandbox-usdc-callbacks/derive-method-gas.mjs`; methods without a
committed figure keep their provisional policy floors. See
[`P2-OPEN-DECISIONS-REVIEW-PACKAGE.md`](P2-OPEN-DECISIONS-REVIEW-PACKAGE.md)
for the full decision record and canary guidance.

The design already states the cash rule for a pending payout:
`C >= H + planned_outflow`, with `H = S + N + Q + F` (storage, native escrow,
credit, refund liabilities). The 1.07 NEAR and 0.06 NEAR margins in `TODO.md`
are fixture values, not recommendations. This document replaces them with a
formula and explicit inputs.

## Approved policy inputs (B2)

B2 is a policy limit, not a missing measurement. The owner fixed the four
values below for the canary (2026-11-19):

1. **Maximum concurrent pending payouts:** 16 per instance. The contract
   enforces no cap, so this is an operational limit: pause new token outflows
   once 16 are outstanding.
2. **Stuck-callback allowance:** 24 hours, converted to 16 callbacks. The
   correlation assumption is that one shared token-contract or RPC incident can
   stall every callback in flight at once, so the allowance is bounded by the
   16-pending cap rather than an independent per-callback failure rate.
3. **Largest single authorized payout or refund:** 1 NEAR per commitment (the
   largest fixture refund attach). Raising it raises the buffer proportionally.
4. **Margin:** 25% of the subtotal (a percentage so it tracks the outflow term).

These bound an operational obligation; they are not contract-enforced limits.

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

## Approved canary buffer (2026-11-19)

| Input | Approved value | Basis |
| --- | --- | --- |
| Maximum simultaneous pending payouts | 16 per instance | Operational limit (contract caps no count); pause new token outflows once 16 are outstanding. Above the four simultaneous transfers the callback fixture exercised |
| Stuck-callback allowance | 24 hours, converted to 16 callbacks | Correlation assumption: one shared token-contract or RPC incident stalls every callback in flight at once, so the allowance is bounded by the 16-pending cap |
| Largest single authorized payout or refund | 1 NEAR per commitment | Largest fixture refund attach. Raising it requires a new calculation |
| Margin | 25% of the subtotal | Percentage, so it tracks the outflow term |

**Approved buffer: 40.2468 NEAR**, with a **separate 0.064 NEAR gas float**
(16 pending × 40 Tgas at 0.0001 NEAR/Tgas). The 40 Tgas figure is the
`recover_nep141_transfer` operator-policy floor (above the 1.5× derived floor);
it is prepaid by the signer and is not part of the solvency buffer.

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

The canary acceptance record must not cite these values as satisfied until the
buffer is actually funded and the operational pending-count limit is enforced,
with evidence recorded in the canary acceptance record.

## Limits and conditions

The approved values are an arithmetic model over measured storage costs, not a
network measurement. They remain valid only while these conditions hold:

- The 16-pending and 1 NEAR limits are enforced operationally (the contract does
  not cap `pending_transfer_count` or payout size).
- The 617-byte pending/retained figure remains the worst case for the measured
  paths (claim 617/199 settled, refund 512/114, native credit withdrawal 26;
  an unresolved callback retains the full 617-byte footprint).
- The stuck-allowance count is interpreted with the stated shared-incident
  correlation assumption; independent failures could need a different count.
- Delayed-receipt behavior is characterized only by the eight synthetic
  intermediate receipts in the design capture, not by public-network latency.
- Raising the largest authorized payout, the pending cap, or the stuck allowance
  requires rerunning the calculator and recording a revised approved buffer.

## Closing checklist

1. [x] Fix `max_pending` as an enforced operational limit (16) and state the
   stuck allowance in hours (24 h → 16 callbacks, shared-incident assumption).
2. [x] Measure recovery-credit withdrawal and OOG-retention storage:
   `credit_withdrawal_storage_is_measured` (26 pending / −114 success / −26
   failure) and `token_callback_oog_retains_the_pending_footprint` (617 pending,
   0 committed delta, 617 retained).
3. [x] Set the largest authorized payout/refund (1 NEAR, fixture ceiling) and
   the margin (25%).
4. [x] Re-run the model and record the owner's approved buffer in `TODO.md` and
   this document (40.2468 NEAR, separate 0.064 NEAR gas float).
5. Keep the gas float separate and monitored; it is not solvency capital. The
   canary acceptance record must cite the buffer only when it is funded and the
   limits are enforced, with recorded evidence.

## Funding and enforcement evidence

Procedure: [`P2-USDC-RECEIPT-RECOVERY-CANARY-FUNDING-RUNBOOK.md`](P2-USDC-RECEIPT-RECOVERY-CANARY-FUNDING-RUNBOOK.md).
Fill [`tests/canary-funding/funding-evidence.template.json`](tests/canary-funding/funding-evidence.template.json)
and verify it with `node tests/canary-funding/verify-funding-evidence.mjs
<evidence.json>`; the verifier recomputes the approved buffer and gas float,
rejects headroom below the buffer, and returns `UNKNOWN` for incomplete records.

Before a canary acceptance record cites the approved buffer or gas float as
satisfied, record evidence that:

- **Buffer funded:** the canary instance holds at least 40.2468 NEAR of
  uncommitted solvency capital above its current native liabilities for the
  canary scope. Evidence should include finalized funding transfer transaction
  hash(es), the funded account, and a post-funding view/export showing the
  recovery storage reserve is `ready` with no shortfall and the native-cash
  ledger has headroom for the approved outflow/stuck allowance (the contract has
  no single "buffer funded" view, so record the underlying balance and liability
  inputs). Do not count the signer gas float as part of this balance.
- **Operational limits enforced:** the 16-pending cap, 1 NEAR largest authorized
  payout/refund, and 24-hour / 16-callback stuck allowance are enforced by named
  runbook controls and monitoring that pause new token outflows at the cap and
  alert operators. The contract does not enforce these caps; enforcement is an
  operator responsibility and must be documented.
- **Gas float available and monitored:** 0.064 NEAR is available to the
  authorized signer account(s) that will prepay recovery gas, with monitoring
  separate from contract solvency. It is prepaid signer gas, never netted
  against the buffer.
