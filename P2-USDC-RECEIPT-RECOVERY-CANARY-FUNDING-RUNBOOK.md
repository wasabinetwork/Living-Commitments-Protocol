# Canary funding and enforcement runbook (Decision 5)

**Purpose:** fund the owner-approved 40.2468 NEAR pending-callback buffer plus the
separate 0.064 NEAR signer gas float on the canary instance, enforce the
operational limits the contract does not enforce, and record evidence the canary
acceptance record can cite. The approved values and their derivation are in
[`P2-PENDING-CALLBACK-FUNDING-BUFFER.md`](P2-PENDING-CALLBACK-FUNDING-BUFFER.md);
the limits, stop conditions, and acceptance rows are in
[`P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md`](P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md).

**Scope:** a fresh, disposable, recovery-enabled child instance with no migrated
state. This is pre-canary preparation. It does not enable recovery for
production, does not authorize a canary, and does not replace A1/A2/A3 or the
seven-day delay evidence.

**Status:** procedure only. No instance has been funded under this runbook, so
the canary acceptance record's funding and enforcement rows remain `TBD` until
this procedure is executed and its evidence verified.

## Approved values

| Item | Approved value | Where it lives |
| --- | --- | --- |
| Pending-callback buffer | 40.2468 NEAR (subtotal 32.19744 + 25% margin) | liquid headroom on the contract account |
| Largest authorized payout/refund | 1 NEAR per commitment | operational ceiling |
| Simultaneous pending payouts | 16 per instance | operational cap, contract does not enforce it |
| Stuck-callback allowance | 24 h, converted to 16 callbacks (shared-incident assumption) | operational allowance |
| Signer gas float | 0.064 NEAR (16 × 40 Tgas) | signer account(s), never contract cash |

The buffer is solvency capital. The gas float is prepaid signer gas. Never count
one as the other, and never net them.

## Preconditions

- The candidate WASM and code hash match the reviewed release commit, and the
  canary acceptance record's §1 instance fields are filled.
- The instance is bootstrapped for receipt recovery and passes the deployment
  continuity preconditions in
  [`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md).
- `recovery_storage_reserve_view` reports `ready` with no shortfall and no
  revaluation in flight.
- You can read finalized state and store evidence outside the repository. Do not
  record private keys, seed phrases, or signing secrets in the evidence file or
  in git.

## A. Fund the buffer

The buffer is liquid headroom, not storage-reserve capital. Fund it with a plain
NEAR `Transfer` from the operator account to the contract account, which adds
balance without a contract call and without crediting escrow, USDC, refunds, or
operations.

Use a plain `Transfer` action from the operator account to the contract account —
near-cli-rs `near send`, or the transfer helper in `packages/sdk`. Do not wrap it
in a contract call. Send at least 40.2468 NEAR plus the instance's existing
headroom gap; one transfer is enough, and multiple transfers are fine when each
one is recorded.

Sanity check before funding: the current headroom (step A.3 below) plus the
planned transfer must reach 40.2468 NEAR, and the gas float must stay on the
signer account(s), not move to the contract.

`top_up_recovery_storage_reserve` is a **different** pot: it adds non-withdrawable
storage backing for byte-cost increases. Funding it does not fund the payout
buffer, and funding the payout buffer does not reduce a storage shortfall.

1. Record each funding transfer: hash, finalized block height/hash, timestamp,
   amount.
2. Wait for finality and read the post-funding snapshot at one finalized block:
   - account balance (`view_account` → `amount`),
   - `recovery_storage_reserve_view` (`status`, `ready`, `shortfall_yocto`,
     `non_withdrawable_backing_yocto`, `free_treasury_reserve_yocto`),
   - native escrow liabilities from `get_escrow_status` / `get_commitment`
     (`escrow_pending_yocto` is the native pending amount; the USDC ledger is
     separate),
   - recovery-credit liabilities from `receipt_recovery_credit` for every credit
     ID the instance has produced (`accrued_yocto` plus `in_flight_yocto`),
   - a `view_state` export hash over the recovery, credit, storage-bond, and
     native-cash prefixes as continuity evidence.
3. Compute headroom as `liquid balance − (escrow + credits + storage backing)`
   and require it to be at least 40.2468 NEAR. The contract has no single
   "buffer funded" view: the `sandbox_native_cash_snapshot` used in the Sandbox
   fixture is feature-gated and is not available on a deployed instance.
4. Because headroom depends on a complete liability inventory, attest
   completeness explicitly: the export hash, the covered commitment/credit IDs,
   and the fact that the instance has no migrated state. If the inventory cannot
   be shown complete, the evidence is `Unknown`, not funded.

## B. Enforce the operational limits

The contract caps neither `pending_transfer_count` nor payout size, so these are
controls, not protocol guarantees.

| Limit | Control to configure and record |
| --- | --- |
| 16 simultaneous pending payouts | Monitor `get_commitment(...).pending_transfer_count` plus `receipt_recovery_credit(...).state == "withdrawing"` across canary commitments; at 16 outstanding, pause new token outflows (claims, refunds, credit withdrawals) until the count falls. Record the monitor location, its query/alert definition, and the pause procedure. |
| 1 NEAR payout/refund ceiling | Reject or escalate any commitment or refund whose authorized amount exceeds 1 NEAR. Record where the ceiling is configured and who enforces it. Record the fact that raising the ceiling requires a new buffer calculation. |
| 24 h / 16 stuck allowance | Alert when a callback has been unresolved for 24 h; treat 16 stuck callbacks as the stopped state. Record the alert threshold and the shared-incident assumption. |
| Operator acknowledgment | Name the operator who accepted these controls and when. The contract does not enforce them, and the canary record must not imply that it does. |

## C. Fund and monitor the gas float

1. Choose the signer account(s) that will prepay recovery gas. Split 0.064 NEAR
   across them or hold it in one; record each account and its balance.
2. Monitor those balances separately from contract solvency and alert below the
   approved floor. Record the monitor and threshold.
3. Never move the gas float into the contract account to "top up" the buffer
   without recording a new funding transfer and re-running the verifier — that
   converts signer gas into solvency capital and changes what is counted where.

## D. Record and verify the evidence

1. Copy [`tests/canary-funding/funding-evidence.template.json`](tests/canary-funding/funding-evidence.template.json)
   to the canary record location and replace every `TBD`.
2. Run the verifier:

   ```sh
   node tests/canary-funding/verify-funding-evidence.mjs <evidence.json> --json <verdict.json>
   ```

   - `PASS` (exit 0): evidence is complete and recomputes to the approved buffer
     and float. It validates the record, not chain solvency.
   - `FAIL` (exit 1): the record is inconsistent — headroom below the buffer,
     cited values that do not recompute, limits above the approved values, a
     reserve shortfall, or a gas float counted as buffer.
   - `UNKNOWN` (exit 2): evidence is incomplete; the canary record must not cite
     the buffer or gas float as satisfied.
3. Keep the evidence file, the verdict file, the state export hash, and the
   funding/transition receipts with the canary record. Do not edit this runbook or
   the acceptance record to erase a failed funding attempt.

## E. Cite the values in the canary record

Fill §4 of
[`P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md`](P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md):

- "Buffer funded on the canary instance" — funding transaction hashes, finalized
  block, headroom figure, reserve status, export hash, and the `PASS` verdict.
- "Maximum simultaneous pending payouts and stuck-callback allowance" and
  "Operational limits enforced before citing" — the monitor/pause controls and
  operator acknowledgment.
- "Separate gas float" — signer accounts, balances, and monitoring.

Leaving any of those rows `TBD` means the section is not satisfied, even when the
approved values are filled in.

## Stop conditions

Stop and escalate without funding further or enabling recovery if:

- the reserve is not `ready`, reports a shortfall, or a revaluation is in flight;
- headroom cannot be computed from a complete liability inventory, or the export
  hash changes without finalized activity;
- the pending count or stuck allowance reaches the approved limit and the pause
  control does not actually stop new outflows;
- any recorded evidence would be destroyed by restoring state. Restores are
  prohibited for recovery-candidate instances; redeploy as a new instance
  instead.
