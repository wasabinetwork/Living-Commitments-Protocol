# Seven-day rotation/code-hash delay runbook

**Purpose:** Decision 2 requires one real elapsed 7-day
propose/cancel-or-activate cycle on the isolated recovery-enabled instance as a
pre-canary gate. The 10-second Sandbox fixture is boundary/logic evidence only
and does not satisfy this requirement.

**Scope:** Execute on a fresh, disposable, recovery-enabled child instance with
no migrated state and no inherited liabilities. Do not run on a production-domain
instance. This is a delay/operations evidence run, not a canary and not recovery
enablement for production.

## Choose one cycle

Either cycle satisfies the gate when fully recorded:

- **Committee rotation:** `propose_receipt_recovery_rotation` →
  observe pending state and `activate_at_ns` → (optional early-activation
  rejection) → after 7 days, `activate_receipt_recovery_rotation` **or**
  `cancel_receipt_recovery_rotation`.
- **USDC code-hash change:** `propose_usdc_code_hash_change` →
  observe pending state and `activate_at_ns` → (optional early-activation
  rejection) → after 7 days, `activate_usdc_code_hash_change` **or**
  `cancel_usdc_code_hash_change`.

Record which cycle was run. A single complete propose/resolve cycle is enough;
running both is optional.

## Preconditions

- The instance is deployed, bootstrapped for receipt recovery, and passes the
  deployment continuity preconditions in
  [`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md).
- You have the operator access needed to submit the proposal/cancellation
  envelopes and to call the permissionless activation after the delay (and to
  fund gas for those transactions). During current testnet development, testing
  wallets may be used per the 2026-11-19 D1–D4 deferral decision.
- You can query finalized blocks/timestamps and save transaction receipts/hashes.
- You have a place to store the evidence (export hashes, tx outputs, daily
  notes). Do not commit secrets or private keys.

## Procedure

1. **Record baseline**
   - Network/chain ID, genesis hash, contract account, `instance_id`, active
     epoch/generation, and current block height/timestamp.
   - Export or hash the relevant recovery state if practical (continuity
     evidence).

2. **Propose**
   - Submit the signed proposal. Record: proposer account, transaction hash,
     finalized block height/hash, block timestamp, `proposal_digest` (or
     equivalent identifier returned/observable), and the contract-returned
     `activate_at_ns`.
   - Confirm `activate_at_ns` is approximately proposal time + 7 days
     (604,800 seconds / `604_800_000_000_000` ns, subject to chain time).

3. **Verify pending state**
   - Read the pending proposal/rotation view and confirm it matches the
     submitted digest and `activate_at_ns`.
   - **Early-activation check (recommended):** before `activate_at_ns`, attempt
     activation and record the rejection transaction hash/error showing the delay
     is enforced.

4. **Daily check-ins (7 days)**
   - Once per elapsed day, record: date/time, block height/hash, proposal still
     pending, and `activate_at_ns` unchanged. Observation only; no state changes.
   - If the proposal disappears, changes, or activates early, stop and treat as a
     failed gate: capture evidence and do not erase it.

5. **Resolve after the delay**
   - After chain time is ≥ `activate_at_ns`, submit either activation
     (permissionless) or cancellation (signed), as chosen.
   - Record: chosen resolution, transaction hash, finalized block height/hash,
     block timestamp, resulting generation/active epoch or canceled state.
   - Compute `elapsed = resolution_block_timestamp - proposal_block_timestamp`
     and confirm it is ≥ 604,800 seconds.

6. **Complete the acceptance record**
   - Fill §3 ("Seven-day rotation delay evidence") of
     [`P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md`](P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md).
   - Link the evidence files and update
     [`P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md`](P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md)
     Gate 4 "Seven-day production delay elapsed" with the capture/report.
   - This satisfies the pre-canary gate for Decision 2; it does not approve a
     canary or production enablement by itself.

## Notes

- Use an isolated instance: the pending state and outcome are part of this
  instance's history. A fresh child instance is the expected path.
- If you cancel, the proposal must not be replayable; record any replay-rejection
  evidence if observed (the Sandbox fixture already covers the logic).
- Keep method gas within the operator-policy floors; gas is prepaid by the signer.
- Do not claim the gate met until the elapsed time and on-chain timestamps are
  recorded from finalized blocks.