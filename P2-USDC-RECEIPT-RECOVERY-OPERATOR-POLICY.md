# USDC Receipt-Recovery Operator Policy

**Status (2026-11-15):** Proposed v1 operator policy aligned with the v4 recovery design, which is approved for implementation planning. No verifier or recovery configuration is deployed. The observed network values below are snapshots, not evidence that either network is enabled for recovery. Any mismatch or unavailable evidence is `Unknown` and leaves the liability pending.

## Supported replay baseline

Use stable **nearcore 2.14.0**, release commit `bc4e9e8cfb03d9e82f027883055624e18576993e`, for operator replay and receipt interpretation. This release implements protocol version 88 and execution metadata V4. Pin the Rust toolchain and build artifact in each operator's deployment record; do not silently substitute a release candidate, `master`, or a later nearcore version. This policy supports network protocol version **88 only**. If either network advances before recovery is enabled, publish a reviewed policy revision with regenerated fixtures first. NEAR protocol version is a network-agreed value, distinct from the nearcore client version.

At execution, V4 metadata records one `AccountContract` per action, in receipt action order, describing the contract attached to the receiver immediately before that action ran. For the single `ft_transfer` action, require metadata version 4, exactly one contract entry, and `Local(expected_hash)`. Treat `None`, `Global`, `GlobalByAccount`, unknown variants, missing metadata, or a length mismatch as unsupported for successful transfers. Never substitute current, pre-block, or post-block `view_code` for action-time identity.

Operators validate the finalized block/receipt ancestry on their locally validated archival chain. They must obtain V4 metadata from local execution under the pinned implementation, not accept a public RPC's metadata as proof. Where historical metadata is unavailable, replay the containing shard chunk from its validated parent state under the exact protocol configuration, applying preceding receipts in runtime order and recording the receiver's attached contract immediately before action 0. Verify the replayed receipt outcome against the canonical finalized outcome. Missing state, protocol config, receipt body, or reproducible execution means `Unknown`; no endpoint quorum can waive this rule. An independently administered source is corroboration only.

For the exact single-action `ft_transfer`, a canonical finalized `Failure` certifies `Failure` because NEAR rolls back state changes from the failed receipt under the pinned [receipt execution semantics](https://github.com/near/nearcore/blob/2.14.0/docs/RuntimeSpec/Receipts.md). This classification is independent of code identity: no token state written by that receipt commits. It does not authorize treating a failed callback or child receipt as failure of the original token action. This rollback rule must be covered by the protocol-88 pre-execution and post-execution failure fixtures before implementation approval.

## Quorum risk and pooled escrow

The 4-of-5 committee attests to receipt interpretation; the contract does not verify receipt inclusion or execution proofs. All commitments share the same USDC token account. A certificate `Failure` quarantines that transfer's amount instead of returning it to free escrow. `refund_remaining` and a new claim can spend only the free remainder. The private release callback accepts the quarantine only when `ft_balance_of` covers every gross unit and the accounting generation is unchanged. One false Failure therefore keeps every outstanding certificate quarantine locked until the pool is fully backed. That can delay a true-failure retry. It does not let a refund spend another commitment's tokens. Callback failures still return pending value to free. Do not describe the escrow as physically segregated. Operators must abstain (`Unknown`) whenever canonicality, ancestry, execution identity, or outcome is uncertain. No timeout or single-party override repairs a false certificate. **Owner decision 2026-11-19:** this liveness limit is accepted as a bounded canary risk rather than mitigated by an override, timeout, or per-commitment split; the canary acceptance record must state that a false `Failure` can lock every certificate quarantine until full backing is restored and must name the maximum accepted exposure. See [`P2-OPEN-DECISIONS-REVIEW-PACKAGE.md`](P2-OPEN-DECISIONS-REVIEW-PACKAGE.md).

## Token account and code-hash changes

The token account remains the chain-fixed Circle account selected at bootstrap. A delayed 4-of-5 proposal can append a code hash or select one that is already approved. It cannot remove a hash or change the token account. Existing intents keep the hash copied at creation. Success under a historical hash requires that hash to equal the intent hash and to remain in the retained allowlist. Operators must not consult the current active registry to reinterpret an existing intent. The code-hash methods are local source and still need independent review before a canary. Do not treat key rotation, an RPC observation, or the token's current code hash as approval to rewrite an intent's execution-time hash.

## Recovery storage operations

On the recovery-enabled candidate, call the read-only `recovery_storage_reserve_view` before planning a cash-moving operation or continuing byte-cost revaluation. It reports the stored and current byte cost, record count, deficit, backing, `ready` status, and the active revaluation target/cursor. `revaluating`, `stale`, or `shortfall` means cash-sensitive methods must remain paused. Continue with the cursor returned by `revalue_recovery_storage_batch`; after a byte-cost change restart from zero when instructed. The method now returns `complete` for an already-ready reserve, so checking completion does not require an empty batch.

Until maximum-bound measurements are independently confirmed, use these conservative prepaid-gas minima for local isolated operations. These are operational recommendations derived from the measured fixtures, not worst-case guarantees, and are not enforced by the contract:

| Method | Minimum prepaid gas |
| --- | ---: |
| `bootstrap_receipt_recovery` | 20 Tgas |
| `recover_nep141_transfer` | 40 Tgas |
| `finalize_receipt_recovery_intent` and `finalize_receipt_recovery_credit` | 30 Tgas |
| `revalue_recovery_storage_batch` with 64 records | 25 Tgas |
| `propose_usdc_code_hash_change`, `cancel_usdc_code_hash_change`, and `activate_usdc_code_hash_change` | 100 Tgas |
| `release_usdc_certificate_quarantine` | 220 Tgas |

`release_usdc_certificate_quarantine` schedules a 10 Tgas `ft_balance_of` and a 30 Tgas private callback. The 220 Tgas row is prepaid gas for that whole call in the local fixture. If the callback is under-gassed, the quarantine stays in place and the caller can retry. An under-gassed callback or maintenance call must remain fail-closed and retryable as designed; these floors are not a substitute for the 2,048-record maximum-capacity measurement or deployment-specific transaction review.

The current 2,048-record registry cap is a provisional implementation limit. At the observed maximum-payer row size of 527 bytes, filling it would account for about 1,079,296 bytes of record storage, or approximately 0.0108 NEAR at the present `10^19 yoctoNEAR/byte` storage price. This is a planning estimate from the measured row shape, not a reserve funding guarantee; configuration, indexes, other state, runtime price changes, and the fresh capacity run must also be included before any canary.

## Callback payload policy

The generic transfer callback treats `Ok(_)` and `TooLong(_)` from a zero-byte-bounded result read as successful value movement. A completed transfer must not be retried merely because its response payload is unexpectedly large. Persisted storage-credit withdrawals use the stricter native-transfer contract: a successful result is expected to have no payload, and `TooLong(_)` leaves the credit in `Withdrawing` as unknown, preventing a second payment. The two policies are deliberate; the stricter path favors avoiding double payment over automatic liveness when the callback response is malformed.

## NEAR runtime balance observation for solvency checks

The recovery design pins its accounting observation to nearcore 2.14.0, commit `bc4e9e8cfb03d9e82f027883055624e18576993e`. At contract execution, `current_account_balance` starts with the execution context's account balance plus the receipt's attached deposit; the host `account_balance` function reads that current value. The Rust SDK `Promise` is a lazy builder: creating the value queues actions locally, and dropping it calls the NEAR host APIs. The host deducts an attached transfer or function-call deposit when the corresponding action is materialized. The candidate therefore runs its solvency preflight after state/storage updates but before materializing the first relevant action, and explicitly includes every planned outflow in `X`. For a method that materializes actions in stages, the first check must reserve all later outflows too, or a later check must use the post-materialization balance and only the remaining `X`. The payable liability remains counted until an exact successful private callback; this backs the unresolved transfer and leaves an OOG or missing callback non-retryable.

These are pinned implementation facts, not claims about the client build currently serving a public RPC. Review the [`account_balance` context initialization](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/logic.rs), [`account_balance` host read](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/host.rs), [`deduct_balance` and promise-action accounting](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/logic.rs), [failed-transfer refund semantics](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/docs/RuntimeSpec/Refunds.md), and [runtime final storage-stake check](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/runtime/src/lib.rs). The earlier Sandbox probe sampled while the SDK builder was still alive; it did not verify host-action materialization. The updated fixture distinguishes those phases, but exact VM behavior and cash-gate ordering remain acceptance items.

## Observed network values

Read-only queries to the official RPC endpoints on 2026-11-15 returned:

| Network | Chain / genesis | Protocol version | USDC account | Observed NEAR `CodeHash` / bytecode SHA-256 | Recovery status |
| --- | --- | ---: | --- | --- | --- |
| Testnet | `testnet` / `FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b` | 88 | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | `EoAUFWELjD9gYzsjKDXYRmHDHf1RJ95jaKNSYE6v9b2z` (`ccfb5ad61c10b5a364d405eb404926f31b37bf636897ab9c7cfc3e74ffbf12ab`) | Disabled; candidate code hash requires review approval and must be copied into each new intent |
| Mainnet | `mainnet` / `EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H` | 88 | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | `DVJx7F3dHEHJYwpYPwXHu8K9Uo7h4kXFcALucY5oNX8q` (`b98ccd530f7e643cfef32f4529ade060ef87ff73b0101536399470777b86cfe6`) | Disabled; candidate code hash requires review approval plus a finalized mainnet V4 receipt fixture |

The RPC `status` response did not disclose `node_version`; protocol version 88 does not prove which client build each validator runs. The supported **operator replay client** is pinned above; do not claim it is the observed validator software. Current code hashes came from finalized `view_code` bytes hashed with SHA-256 and NEAR base58 encoding. They are point-in-time observations, not independently sourced Circle build attestations.

The testnet cross-check used finalized claim transaction `4SDsWMiWTtCaYhFi4MHXtMkVWhzRRA4s56XfUYyJsnvH` through `EXPERIMENTAL_tx_status`: `final_execution_status=FINAL`; token receipt `AVJfZYC5V5GGgVeFgMyySNFjynCuJtzwsBTVYPDZDoay`; receipt block hash `Gys3LDYToWRHpTq7SKJEA7TJkjL7ochjmCpYyrxAHAbu`; metadata version 4; `contracts[0].local=EoAUFWELjD9gYzsjKDXYRmHDHf1RJ95jaKNSYE6v9b2z`. This proves that the official RPC returned a compatible sample, not that the RPC is a trusted operator source or that local archival replay was exercised. No mainnet transfer receipt was checked for this annex.

## Intent and code-hash lifecycle

At transfer creation, the contract selects a code hash from its reviewed, network-specific recovery registry and writes that exact hash into the immutable intent. Recovery compares V4/replay evidence to the intent's hash. Later registry changes do not affect existing intents. A code upgrade is not automatically approved: add a new hash through the delayed 4-of-5 code-hash proposal only after verifying its provenance and synchronous atomic `ft_transfer` behavior. Activation can also point the active hash at one that is already approved. Old intents may be recovered under an older hash only while that hash equals the hash stored in the intent and remains in the retained allowlist. Removing a hash is impossible. A hash that is no longer retained makes a successful result `Unknown`; it does not rewrite the intent.

When `finalize_receipt_recovery_intent` removes a terminal intent, it keeps a permanent marker for that transfer ID. The key is `lcp:receipt-recovery-consumed:v1:` plus the ID as 8 little-endian bytes, and the value is a single byte `1`. There is no view method. `recover_nep141_transfer` rejects that ID before reading a certificate, with `recovery transfer id is already consumed`. A later claim, escrow refund, operations refund, or fixture allocation of the same ID fails the same way, before it writes settlement or a pending transfer. Restoring only the pending-intent bytes does not clear the marker or move the counter. If finalization has not succeeded, including when the storage reserve is not ready, the intent is still present and the ID is not marked consumed. Do not sign another outcome for that `(instance_id, transfer_id)` after it has left pending. A full state restore that removes the marker with the ledger can make the ID usable again; the contract cannot detect that restore. Do not use a restored snapshot to retry a finalized transfer. **Owner decision 2026-11-19:** a full state restore that removes the consumed marker together with the ledger is prohibited and out of scope for recovery-enabled or recovery-candidate instances. Upgrade forward-only from finalized live state, verify consumed-marker/counter/ledger continuity before bootstrap or upgrade, and treat an unavoidable restore as a new instance or an owner-approved incident reconciliation proving no finalized intent is reintroduced before recovery or cash movement is re-enabled. See [`P2-OPEN-DECISIONS-REVIEW-PACKAGE.md`](P2-OPEN-DECISIONS-REVIEW-PACKAGE.md).

Do not initialize a network's recovery registry from an unverified RPC result at runtime. Before enabling testnet, independently review the candidate testnet code hash and validate local nearcore 2.14.0 replay on the required fixtures. Mainnet additionally requires its own code provenance review and V4 receipt fixture. Any code representation other than `Local(hash)` for a successful transfer remains unsupported pending separate review.

## Required operator fixtures

For each supported network, all five operators must independently produce identical results or abstain on:

1. Same-chunk receipt order: transfer under code A then `DeployContract` B; `DeployContract` B then transfer. V4/replay must report A then B, and B then B, respectively.
2. Historical transfer under still-approved A after current account code becomes B.
3. Missing V4 metadata with successful deterministic replay; missing replay state must remain `Unknown`.
4. Failed `ft_transfer` before code execution and after partial execution, with state rollback confirmed.
5. `None`, each global-contract representation, malformed metadata, mismatched vector length, and provider disagreement.
6. Reorg/nonfinal receipt, unavailable archival data, and independent replay from separately administered operators.

## Primary references

- [nearcore 2.14.0 release](https://github.com/near/nearcore/releases/tag/2.14.0)
- [nearcore 2.14.0 execution metadata definitions](https://github.com/near/nearcore/blob/2.14.0/core/primitives/src/transaction.rs)
- [nearcore 2.14.0 runtime action execution](https://github.com/near/nearcore/blob/2.14.0/runtime/runtime/src/lib.rs)
- [nearcore 2.14.0 receipt execution semantics](https://github.com/near/nearcore/blob/2.14.0/docs/RuntimeSpec/Receipts.md)
- [NEAR protocol upgrade process](https://github.com/near/nearcore/blob/2.14.0/docs/practices/protocol_upgrade.md)
