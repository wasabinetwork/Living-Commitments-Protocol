# USDC Receipt-Recovery Canary Acceptance Record (template)

**Status:** template. A canary is not approved until every required field is
filled and every signature row is complete. Copy this file to the canary's
record location, replace each `TBD`, and link the completed copy from
[`P2-OPEN-DECISIONS-REVIEW-PACKAGE.md`](P2-OPEN-DECISIONS-REVIEW-PACKAGE.md)
and `TODO.md`. The decision context is in the review package (Decisions 2–5) and
the operating rules are in
[`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md).

## 1. Instance and scope

| Field | Value |
| --- | --- |
| Network / chain ID | TBD |
| Genesis hash | TBD |
| Contract account (`core_account_id`) | TBD |
| Fresh-child instance proof (zero migrated state, zero inherited liabilities) | TBD (export hash + block) |
| Deployment continuity preconditions evidence | TBD (before/after export hashes) |
| Release commit | TBD |
| WASM SHA-256 / NEAR code hash | TBD |
| `instance_id` / recovery bootstrap transaction | TBD |
| Token account and active USDC code hash | TBD |
| Committee epoch and operator set | TBD |
| Recovery enabled at (block timestamp) | TBD |
| Approved canary end date or removal trigger | TBD |

## 2. Accepted false-`Failure` risk and exposure limits (Decision 4)

Required statement (do not paraphrase away):

> A false certificate `Failure` can lock every certificate quarantine until full
> backing is restored. No timeout, admin override, or split-balance escape hatch
> exists.

| Limit / control | Approved value | Evidence or reference |
| --- | --- | --- |
| Maximum total canary escrow exposure (USDC) | TBD | TBD |
| Maximum exposure per commitment (USDC) | TBD | TBD |
| Maximum number of commitments | TBD | TBD |
| Maximum concurrent pending payouts | TBD | funding-buffer artifact |
| Disposable low-value instance confirmed | TBD | TBD |
| Operators named (4-of-5 sign-once, abstain on uncertainty) | TBD for mainnet; testnet development may use available testing wallets (owner decision 2026-11-19) | Workstream D1 (mainnet gate) |
| Quarantine and backing-shortfall alerting | TBD (channel, threshold, on-call) | TBD |
| Response runbook location (quarantine stuck, no override) | TBD | operator policy |
| False-`Failure` incident review obligation | TBD (who reviews, when) | TBD |
| Owner acceptance signature and date | TBD | TBD |

The canary stops, without expanding exposure, if actual exposure approaches any
limit above or if a quarantine lasts longer than the approved response window.

## 3. Seven-day rotation delay evidence (Decision 2)

One real elapsed propose/cancel-or-activate cycle on this instance, not the
ten-second Sandbox fixture. Record both the proposal and the resolution. See
[`P2-USDC-RECEIPT-RECOVERY-SEVEN-DAY-DELAY-RUNBOOK.md`](P2-USDC-RECEIPT-RECOVERY-SEVEN-DAY-DELAY-RUNBOOK.md)
for the execution and recording procedure.

| Field | Value |
| --- | --- |
| Recovery generation before / after | TBD |
| `proposal_digest` | TBD |
| Proposer account | TBD |
| Proposal transaction hash and finalized block | TBD |
| Proposal block timestamp | TBD |
| `activate_at_ns` returned by the contract | TBD |
| Required delay (7 days = 604,800 s) | 604,800 s |
| Resolution chosen (`activate` or `cancel`) | TBD |
| Resolution transaction hash and finalized block | TBD |
| Resolution block timestamp | TBD |
| Elapsed = resolution timestamp − proposal timestamp | TBD (must be ≥ 604,800 s) |
| Early-activation rejection observed (attempt before `activate_at_ns`) | TBD (tx hash + error) |
| Delay met | TBD (yes/no) |
| Evidence files (exports, logs, screenshots, verifier output) | TBD |

Daily check-ins (one row per elapsed day; observation only, no state changes):

| Day | Block height/hash | Proposal still pending | `activate_at_ns` unchanged | Observer |
| --- | --- | --- | --- | --- |
| 1 | TBD | TBD | TBD | TBD |
| 2 | TBD | TBD | TBD | TBD |
| 3 | TBD | TBD | TBD | TBD |
| 4 | TBD | TBD | TBD | TBD |
| 5 | TBD | TBD | TBD | TBD |
| 6 | TBD | TBD | TBD | TBD |
| 7 | TBD | TBD | TBD | TBD |

A canary cannot set its own production duration. This row is complete only when
the owner records that the pre-canary gate is met; until then the canary stays a
canary and no production enablement is approved.

## 4. Buffer, gas, and pending-callback limits (Decision 5)

| Field | Approved value | Evidence |
| --- | --- | --- |
| Buffer (NEAR) and component subtotal | 40.2468 NEAR (subtotal 32.19744: 16 in-flight + 16 retained + 0.19744 storage) | `measure-funding-buffer.mjs` with 617/617 bytes, 16/16 callbacks, 1 NEAR, 25% |
| Largest authorized single payout/refund | 1 NEAR per commitment | owner-approved 2026-11-19 (fixture ceiling) |
| Stuck-callback allowance (hours → count, correlation assumption) | 24 h → 16 callbacks; shared-incident stalls all in-flight callbacks at once | owner-approved 2026-11-19 |
| Margin (percentage or flat, with rationale) | 25% of subtotal (percentage, tracks outflow) | owner-approved 2026-11-19 |
| Separate gas float (NEAR), monitored separately | 0.064 NEAR (16 × 40 Tgas) | prepaid signer gas, not solvency capital |
| Method gas limits derived from measured worst case + margin | Partial: `recover_nep141_transfer` 26, `bootstrap_receipt_recovery` 11, `revalue_recovery_storage_batch` 18 Tgas (1.5× from 689fbf1 captures); finalize/code-hash/quarantine/credit withdrawal/retirement provisional | `derive-method-gas.mjs`, traceability Gate 5 |
| Approved values recorded in `TODO.md` and deployment runbook | Owner-approved 2026-11-19 | `TODO.md`, `P2-PENDING-CALLBACK-FUNDING-BUFFER.md`, `P2-OPEN-DECISIONS-REVIEW-PACKAGE.md` |

The buffer is solvency capital; the gas float is not. Neither may be counted
twice or netted against the other.

## 5. Gate evidence

| Gate | Required evidence | Link / status |
| --- | --- | --- |
| A1 independent capture reproduction | Independent operator report | TBD |
| A2 independent rebuild | Matching WASM/code hash from a separate environment | TBD |
| A3 independent verifier/settlement review | Signed review, no open Critical/High | TBD |
| D1–D4 operator readiness | Deferred to mainnet readiness for current testnet development (owner decision 2026-11-19) | Workstream D1–D4 (mainnet gate) |
| Fresh instance + zero migrated state | Export hashes before bootstrap | TBD |
| Prohibited-restore rule acknowledged | Signed acknowledgment of the operator policy preconditions | TBD |

## 6. Stop and abort conditions

Stop the canary and escalate without restoring state if any of these occur:

- a consumed marker is missing, a counter decreases, or the native cash ledger
  or storage reserve changes without finalized activity;
- a false `Failure` locks certificate quarantines, or backing shortfall is
  detected (quarantine alert fires; no override exists);
- actual exposure approaches an approved limit in §2, or a quarantine exceeds
  the approved response window;
- a bootstrap or upgrade is proposed from a snapshot, restore, or non-finalized
  state.

Any restart requires a new acceptance record; do not edit this record to erase a
breach.

## 7. Sign-off

| Role | Name | Decision | Date | Evidence link |
| --- | --- | --- | --- | --- |
| Owner (risk and exposure acceptance) | TBD | TBD | TBD | TBD |
| Engineering (code hash, limits, calculator) | TBD | TBD | TBD | TBD |
| Operations (instance, alerting, runbook) | TBD | TBD | TBD | TBD |
| Independent reviewer (A3) | TBD | TBD | TBD | TBD |

**Prohibited actions reminder:** no full state restore that deletes a consumed
marker, no bootstrap over existing recovery state, and no deployment from a
snapshot. Upgrades are forward-only from finalized live state with the
continuity checks in the operator policy.
