# Independent remediation follow-up review

Date: 2026-11-16. Scope: source review and offline checks of the exact dirty candidate, followed only by isolated acceptance if approved.

## Attribution and isolation

Reviewer: automated Codex worker, requested model `gpt-6.1-sol`. Orca `orchestration worker-list --json` identifies this live dispatch as `codex/gpt-6.1-sol`; `status --json` confirms caller session `orca_session_id:4fd16e5f-b4f5-46c8-8988-d155b11b6e1d` and runtime `586715e6-5c08-4ff8-aed3-4689eb1e7fbe` (Orca 1.4.259). Task `task_a78a22c5b09d`, dispatch `ctx_202923d90222`; coordinator address `orca_session_id:codex_f100d52e_cb55_4928_b1b9_685cb9036031`. This is observable runtime attribution, not independent attestation of backend model weights. No effort setting was independently exposed.

This conversation began with repository instructions and the dispatch brief; no coordinator conversation history or conclusions were supplied or consulted. The provided prior reports were read as review inputs. Conversational independence does not mean filesystem isolation: this worker shares the checkout and local dependency cache. Builds used a freshly validated temporary extraction; supplemental tests used another temporary copy. No helper agents were used. Only this report was written in the repository.

## Package identity and method

The baseline `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed` is contextual metadata, not the reviewed candidate identity. The manifest says main, dirty worktree, uncommitted candidate. Candidate identity is the 51 individual SHA-256 hashes reproduced below.

ZIP SHA-256: `990b3c766ff9a06c8c30875c7be755acc0ed0b32b4a6aa830b1a8b1aedf17375`. Before review, verified ZIP digest, unique safe relative member paths, no traversal/backslash/absolute paths or symlinks, byte equality of root archived `review-manifest.json` and external manifest, and every listed file against both current repository bytes and archive bytes. Read archived `REVIEW-PACKAGE.md`. No credentials or `.env` files were inspected and no unmanifested candidate source was borrowed. Dependency code was consulted only as dependency implementation evidence.

## Remediation closure and required answers

| Finding | Source-level status | Evidence and remaining runtime boundary |
| --- | --- | --- |
| H1 High | Closed | `contract.rs:3001` `on_storage_refund_attempt` calls `accrue_service_report_refund_credit` on failure; `contract.rs:6017–6026` checked-adds existing credit without incrementing aggregate liability. |
| H2 High | Closed | `contract.rs:275` `bootstrap_receipt_recovery` requires all three monotonically allocated business counters to remain zero. |
| M1 Medium | Closed | `recovery_accounting.rs:925` `persisted_refund_credit_view` includes the full prospective outflow through `native_cash.rs` `solvency_snapshot_ready_with_outflow`. |
| M2 Medium | Closed | All five workspace members, `temporal.rs`, manifests and lockfile are packaged; offline workspace loading and requested checks execute without substitute local source. Dependencies require an existing compatible cache. |
| L1 Low | Closed at source/document level | Operator policy, native-cash comments and updated probe consistently distinguish builder creation from host materialization. Current VM execution remains an explicit acceptance gate. |

H1: each attempt remains included in `storage_refund_liability` throughout flight. Success removes its exact liability once; failure removes the attempt and adds its amount to the existing account credit, retaining total liability. Two failures in either order therefore produce A+B, plus any independently accrued credit; a failed withdrawal also restores into any intervening credit. Duplicate and unknown IDs return without crediting twice. Missing/multiple callback results retain the attempt. Checked addition panics on overflow; because attempt deletion and addition occur within the same receipt, production rollback must restore the deleted attempt too. A Rust mock panic does not independently prove VM rollback. Overflow and failed-gate atomicity must still be exercised in isolated acceptance.

H2: a pre-bootstrap FT claim/refund necessarily allocates a transfer ID and originates from an allocated commitment. Bootstrap therefore rejects before configuration mutation even while its FT receipt is in flight. Its delayed callback continues to see unconfigured mode, so the original global-configuration switch cannot strand that transfer for lack of a recovery intent. Both success and failure use ordinary unconfigured settlement; any subsequent bootstrap remains rejected because IDs do not reset after cleanup. A fresh configured instance must bootstrap before business activity; the gate deliberately provides no migration route for an already used instance. Challenge and transfer counters are checked independently, even if another counter is unexpectedly zero.

M1: write R for checked storage + all outstanding liabilities + reserve backing + already scheduled X, and q for the releasable row amount. Baseline readiness is C>=R; withdrawal readiness requires C>=R+q and reserve readiness. At C=R−1 both flags are false; at C=R baseline is true and margin false; at C=R+q−1 margin is false; at equality margin is true. Overflow fails closed. `withdrawal_outflow_yocto` exposes q for a releasable credit, even when underfunded, and zero otherwise. Although `withdrawal_available` does not separately conjoin `cash_ready`, the checked R+q predicate implies baseline solvency since q is nonnegative. Execution checks baseline first, transitions the fixed-size credit row, records q in X, then performs its final cash gate before the withdrawal Promise drops. Views do not promise future state, authorization or sufficient gas.

L1: a Rust `Promise` builder queues SDK actions; its `Drop` invokes `construct_recursively` in cached near-sdk 5.30.2. The pinned [nearcore implementation](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/logic.rs) initializes current balance with attached deposit and checked-subtracts promised value. The docs.rs source retrieval attempts failed; the locked local dependency source supplied SDK evidence. These implementation observations are distinct from acceptance of the candidate in a VM.

`refund_excess` (`contract.rs:9928`) records excess plus the later business outflow before the helper's refund builder materializes. Thus staged native claims/refunds, unused-operations refunds and both OutLayer dispatches reserve their later amounts at that first gate. The no-excess branch reserves the business outflow alone. Configured FT admission reserves one yocto explicitly; legacy storage-credit withdrawal and recovery-credit withdrawal reserve their complete transfer amounts. Authority adapter and callback calls attach zero. No omitted positive-value production outflow was identified in this inventory. Clearing X after the passing gate does not forget later outflows: the gate already reserved them against the pre-materialization balance, and the helper paths do not append an additional unreserved positive transfer.

The revised `sandbox_probe_native_cash_gate` (`contract.rs:832`) returns before-builder, after-builder, and after-explicit-drop balances. `run.mjs:530–582` asserts unchanged builder balance, a one-yocto decrease after drop, exact R+X equality, failure one short, unchanged recipient balance after failure and a one-yocto recipient gain after the successful control. These are suitable assertions for the two timing phases. The underfunded branch gates before creating the builder; it proves failure before emission if run, rather than rollback of an already emitted action. The single-transfer probe does not cover staged/multiple outflows, FT deposits, gas exhaustion, all liability classes, or integrated recovery-credit rows. Those remain separate acceptance cases. The historical fixture predates these changes and is historical evidence only.

## Interacting implementation coverage and limits

Reviewed fresh initialization, bootstrap, native cash/storage sidecars, refund attempts, recovery-credit lifecycle and views, configured/unconfigured token admission and settlement, certificate/parser binding, and relevant governance/reserve interactions. The checked native invariant includes storage, escrow, operations, legacy refunds, recovery Q, reserve F and receipt X. Outstanding payments retain liability until exact successful callback; a missing/OOG native callback can remain non-retryable. Failed FT settlement releases pending to free; success moves it to paid/refunded. Callback and certificate share the same token settlement helper, validate persisted identity and amount, terminalize once, decrement the pinned epoch count, seal the credit and remove pending sidecars. Later settlement attempts cannot pay twice; retry requires a new transfer ID. Finalization separately releases intent storage bonds into the preallocated payer credit.

The bounded parser checks encoded/decoded limits before unbounded allocations, canonical Base64/Borsh, exact intent equality, sorted unique committee keys/signatures and four or five strict Ed25519 verifications. Recovery remains threshold attestation, not verification of NEAR receipt proofs. Receipt ancestry, finality, code identity, action outcome and operator independence remain external quorum obligations. This review did not establish token code provenance or operate signers.

Storage revaluation pauses admission/release/outflows until current and backed; withdrawal success can retain a settled zero-credit tombstone while revaluation prevents row removal. Q is released once, and later cleanup must not pay again. Top-ups enter reserve backing and do not automatically supply discretionary transfer margin. Governance keeps pending transfers bound to old epochs and prevents retiring a keyset with unresolved intents. Capacity, gas costs and long-term operator/archive availability remain operational limits, not proven by these checks.

Recovery endpoints and Dalek are default-disabled. Native cash and reserve sidecars/gates also affect the default build. Production initialization rejects duplicate sidecars; test initialization has reset branches, so mocks cannot establish upgrade behavior. Existing instances without sidecars fail closed; neither default nor recovery artifacts receive upgrade approval here. Fixture features must remain isolated from release artifacts. Integrated callbacks can still roll back on a later cash gate/reserve failure, even when token outcome is externally known; an appropriate certificate can retry recovery once prerequisites are restored. Source comments about separate cleanup must not be read as unconditional terminal persistence across a failing receipt.

No additional reachable code defect was established within this focused review. This is not a full security audit of every workspace component. Runtime gas, storage deltas, receipt scheduling, VM atomic rollback, signed governance lifecycle and callback/certificate races remain unproven by source inspection and mocks.

## Executed checks and evidence

Environment: Darwin x86_64, Rust `1.100.0 (0ef1bc386 2026-11-09)`, Cargo `1.100.0 (3acc79c0c 2026-11-05)`, Node `v26.5.0`. Installed targets included wasm32-unknown-unknown, wasm32-wasip1, wasm32-wasip2 and x86_64-apple-darwin. near-sdk is locked to 5.30.2. All Cargo commands below used `--offline --locked`; no dependency/target downloads were needed. Builds used local cached dependencies, without network contract access.

| Command from unmodified extracted root | Actual result |
| --- | --- |
| `cargo test --offline --locked -p lcp-core` | Exit 0; 100 passed, 0 failed; 0 doctests |
| `cargo test --offline --locked -p lcp-core --features usdc-receipt-recovery` | Exit 0; 100 passed, 0 failed; 0 doctests |
| `cargo check --offline --locked -p lcp-core --target wasm32-unknown-unknown --lib` | Exit 0 |
| `cargo check --offline --locked -p lcp-core --target wasm32-unknown-unknown --lib --features usdc-receipt-recovery` | Exit 0 |
| `cargo check --offline --locked -p lcp-core --target wasm32-unknown-unknown --lib --features sandbox-callback-fixture` | Exit 0 |
| `node --check tests/sandbox-usdc-callbacks/run.mjs` | Exit 0; syntax only |

The baseline unit runs emitted deprecated `testing_env_with_promise_results` warnings. Both modes have the same 100 existing tests; this is not comprehensive configured-recovery acceptance. Wasm checks compile libraries; they do not execute Wasm or certify reproducible release artifacts.

Supplemental command: `cargo test --offline --locked -p lcp-core --features usdc-receipt-recovery independent_ -- --test-threads=1`, executed in a second extracted copy with only appended test modules/cases. Final result: exit 0, **6 passed**, 0 failed, 100 existing tests filtered out. These independent tests covered both failure orders with preexisting credit and duplicates/stale IDs, overflow in the credit-add helper, independent rejection of each allocated bootstrap counter, an actual mock FT claim pending across attempted bootstrap followed separately by success and failure callbacks, and baseline/exact/one-short view predicates with one-short execution rejection and exact execution acceptance. The in-flight cases assert no recovery intent/configuration appears and token pending clears into the correct paid/free buckets. This is mock execution, not receipt-runtime acceptance.

Failures/adjustments retained as evidence: the first shared-target supplemental run selected zero tests and was not counted as a pass. A package-only `cargo clean --offline -p lcp-core` and rebuild made the four initially appended tests run and pass. The expanded five-test attempt exited 101: after the failure-callback scenario passed its assertions, reusing raw mock storage for a second synthetic instance in the same test produced `storage usage unexpectedly decreased`. Splitting those cases into independent tests corrected the test setup; the final six-test run passed. No implementation change was made. The overflow helper test confirms checked failure without overwriting credit; it does not establish receipt-level rollback of a prior attempt deletion. The one-short execution mock explicitly restores its saved ledger/credit state after catching the panic, because mocks do not supply transaction rollback.

No Sandbox acceptance, deployment, upgrade, network bootstrap, transaction, issuer-control change, key operation or source fix was performed. Full workspace testing, audit database checks, production signing, gas profiling, and the complete configured-recovery runtime matrix were not run in this focused gate. Public primary-source retrieval was limited to runtime/SDK implementation documentation; docs.rs retrieval failed and was supplemented with the cached locked SDK source.

Unmodified extraction: `/var/folders/3g/71yfgry5343_3qzh7qnx413m0000gn/T/lcp-independent-review-qkwomr8z`. Supplemental copy: `/var/folders/3g/71yfgry5343_3qzh7qnx413m0000gn/T/lcp-independent-regression-n9xccddy`. Temporary logs: `/tmp/lcp-check-3.log` through `/tmp/lcp-check-7.log`, `/tmp/lcp-regression.log`, `/tmp/lcp-regression-rebuild.log`, `/tmp/lcp-inflight.log`, `/tmp/lcp-inflight-isolated.log`. These are local ephemeral evidence, not packaged deliverables.

## Findings and verdict

New or remaining source findings: **0 Critical, 0 High, 0 Medium, 0 Low** established. All five original findings are closed at the source/package level for this gate; runtime validation has not been inferred from that closure.

**Approve for isolated NEAR VM/Sandbox acceptance.** Approval permits only isolated acceptance to begin. It does not authorize a canary, testnet/public deployment, bootstrap of any network contract, production upgrade or mainnet release.

Required next gate: execute the updated timing probe and multi/staged-outflow matrix; reproduce H1 callback aggregation, stale/duplicate handling and overflow receipt rollback; exercise pre-bootstrap FT in-flight success/failure orderings; test recovery-credit exact/one-short boundaries under actual storage/gas costs; and run configured callback/certificate races, missing/OOG callbacks, parser/signature mutations, governance and reserve revaluation/tombstone cleanup in the isolated VM. Establish gas budgets and token/operator provenance separately before any later deployment decision. Recovery remains threshold attestation throughout.

## Completion integrity and candidate hashes

Completion recheck passed: unchanged ZIP digest, external/root-archived manifest equality, and all 51 current and archived file hashes. External manifest SHA-256: `69f946e0c65623d86bf61ed54e1d42b050979f0bc740f5cdcaa8c6c8dce68553`. Prior reports and all manifested inputs remain unchanged.

| Candidate path | SHA-256 |
| --- | --- |
| `.cargo/audit.toml` | `a709332b9c042f3714ecfb5a1c4d111017e8d1fa29140740bbbb3a6e258f52ce` |
| `Cargo.lock` | `877a0c3370baecb3d4e8e8d27cc8edd1f46ffbd519e222e75c3168ae7a328eb2` |
| `Cargo.toml` | `93037e60b51cc4ef4b8e62e4bb0580ac88bbd9b82fd29dca54337bbe61091ab7` |
| `P2-ASSET-ARCHITECTURE.md` | `5fdca22ba528ec54c44e96f0260076b00020d34c26d5fb009bf86aed3b45298a` |
| `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md` | `6680cf5e65bb27c8f69e45572ef12d7a526bb04ef8057c97943b9f70eb594e04` |
| `P2-USDC-INDEPENDENT-AUDIT-REPORT.md` | `f331de22899a7017d6a8698fae997d85296fc0840abd5ebdb5bbc42be6df54ff` |
| `P2-USDC-RECEIPT-RECOVERY-AUDIT.md` | `e8658be9c3afd95416313bd309a6e8c61ec030cfd9dc152e8028aa79f3187928` |
| `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` | `76d41c6c5553567f74a4fc9650fd838849ccfd25ff5bda433c6f4d8d0de8ad4d` |
| `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-REVIEW.md` | `016e7819145a4a529b0b41e3f662f01391f21634fe3c39890abf4f7ac4b5c80c` |
| `P2-USDC-RECEIPT-RECOVERY-IMPLEMENTATION-REVIEW.md` | `dcaa951d7462794bd535bbae1c76e2d09cbc4d9ba52acb1876d26eb9c4600d55` |
| `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md` | `3252e09897f2571feba3b17ca0619fbe9986995289f8082802ca924bca85c4ed` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V4-REVIEW-BRIEF.md` | `f46a8a4e03ec39d133b36de13aca4de30216e3fd95eca217c3fabb9adf52f5e3` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V4-REVIEW.md` | `78edae35e7db1536f6ea3bf1eb780298aea3ff66c4b12d665c392ce0b075eea1` |
| `README.md` | `e2bd03c067f03f227dd92ddeade070f9800c15b6b8b0202c04c648ee1740df0d` |
| `TESTNET-E2E-STATUS.md` | `3a54d664d8388b6bede38708deba3456e1340c166bdfb9ad2b18a300d1cd64d6` |
| `TODO.md` | `8e178820c4a2a440227cd57c59400a129364b28fbd88f5a305d9892a94d3496c` |
| `contracts/bounded-payout-adapter/Cargo.toml` | `c56bd8409f6527103384f475571e340c32535e8889855870ce0998b7067bb854` |
| `contracts/bounded-payout-adapter/README.md` | `fde3190e76d487e75706c0cda626fe319f20a750996bb0b88fe1dcf174dc9151` |
| `contracts/bounded-payout-adapter/src/lib.rs` | `c4ac2ec12731d6619e0c0e7cbf95e9da7bc063518cf2fe9a74dc9cf28b1d7659` |
| `contracts/lcp-core/Cargo.toml` | `d5c6dc5edb37a46ed7baf522577335a2c02eef0fe0868623d9e95f5cc741f7da` |
| `contracts/lcp-core/src/contract.rs` | `d97b907f02ad1ed40a60727bee291a75674d9d1e1fbf0082e1fce64350010a4c` |
| `contracts/lcp-core/src/lib.rs` | `d9aae106409779a46c58268fa8989dc03d3d3b4be4a5bf50662f5eb3f5031323` |
| `contracts/lcp-core/src/models.rs` | `220f21be25a1d93e56588693f063213ec20cf5a1da79682aa9137faa9e475603` |
| `contracts/lcp-core/src/native_cash.rs` | `48d5a841392e9d87e51fc286e4a1b95d1c382c01d0484a5518e7623ef1f4e114` |
| `contracts/lcp-core/src/receipt_recovery.rs` | `dd1417d3eea017878e9a0e07a0f45b080c3ac8c15439bcd4c7afbaf636277ddb` |
| `contracts/lcp-core/src/recovery_accounting.rs` | `f003b9ea658cf64159bf6d88400bfb0cefe4128a4c259cb626f8a36b70b01ac6` |
| `contracts/lcp-core/src/recovery_config.rs` | `4fb1c6a3fb89cc28c9d2a886344caffa34ebffb6511e026cd1c7c6764a3ebae5` |
| `contracts/lcp-core/src/temporal.rs` | `e0eee14e23b1ce500a7e18b1683f5578db26fefaba617cdda710e8caec427a7d` |
| `contracts/sandbox-mock-ft/Cargo.toml` | `e29062846a172e88c4b58aabfb4b8f33333535a0472687ac02256aecfdd5c3aa` |
| `contracts/sandbox-mock-ft/src/lib.rs` | `1e8d9a239aa01fb6c005bc3bfe11d1c96ce6da7b3016585c3bff403760087ffe` |
| `evaluators/maintenance-heartbeat/Cargo.toml` | `b132402d10043ec1bff4f4e3c1ed9eb51a2e9c6931429b2744f1aaae4169971e` |
| `evaluators/maintenance-heartbeat/src/main.rs` | `90464c213d1bae1e4a9ccd25b5a5191f2d33e91a633880555aab73a32caeecb1` |
| `evaluators/maintenance-heartbeat/tests/cli.rs` | `4c6d0347a015279b6e164e16e7edba93a6ece1fdad418866557ddbb8622b7269` |
| `evaluators/service-availability/Cargo.toml` | `33076ca19a583ef02627b12a5fee7c0a9ce0abd6f9c466b34966bdac1b1db1ca` |
| `evaluators/service-availability/README.md` | `b96e7ea125c75d6861af660c5107d17f555a7fec192584a26285db83d4822d84` |
| `evaluators/service-availability/probe.mjs` | `bf18b0cf44d12c655286bb9ae3fc369d0a526fa47cc11a8dc5b5ba7e33b4bc40` |
| `evaluators/service-availability/src/main.rs` | `30260e39f7df3454c8a01d1c784cf44248c54797b7e1382d72fe95a23d118975` |
| `evaluators/service-availability/test/probe.test.mjs` | `1bb852ffbaf0e278031b8f065edaeb059e18743f3a08a0eefbc1135a414c2ab9` |
| `rust-toolchain.toml` | `8ea81d2f0f2b68bec4abdd4419023c303a596abada7da66d1366191219a61c2d` |
| `tests/receipt-recovery-vectors/README.md` | `ccc3a486b01ff4646de63b4b8292de72ce289fde24fce145bfe5a871fe7ddd88` |
| `tests/receipt-recovery-vectors/generate.mjs` | `817269beb3346bdd899ae3e581eb4d3c50da28a11c8261da95754c5d6ec712a6` |
| `tests/receipt-recovery-vectors/golden-vectors.json` | `5236c3288001d06c96166f8b539777c489fc3e5b1ebd01123bdb3794fbcd76ac` |
| `tests/receipt-recovery-vectors/rust/Cargo.lock` | `8a24ec41dfb2a2c1fdac5d453e140b6e06330162c18235c8060c965268523731` |
| `tests/receipt-recovery-vectors/rust/Cargo.toml` | `0d1211bcaa0b528322ae0d7dd324b9f025ac05e85a266a62d93d2f73f958cd67` |
| `tests/receipt-recovery-vectors/rust/src/main.rs` | `874b1a8ed823df8f0e8ef40c76c824dab2dab37b99729ea13a8460706fa493b1` |
| `tests/sandbox-usdc-callbacks/README.md` | `e73fa16ec6e726e425f987434a65be96b4eef5a2bbd340f41d4f4030675f3edb` |
| `tests/sandbox-usdc-callbacks/package-lock.json` | `c14ba6bb421a3bc4c14909ba301c7e49a7e46ba5cf16c39fa097caaff6d6e39e` |
| `tests/sandbox-usdc-callbacks/package.json` | `d5146dfb2f994d660935955a0ea10c80efcd9377a8ed480225d7c2e25ead6548` |
| `tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.json` | `b86147458ee7700a3819ecb5dd21c8514b0bcbe912e6501bf42a92d83030aabf` |
| `tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.sha256` | `e0fbcdfc4718b9cb16d867f8eafcaf073d20f590a11d2b3eb79e3d908d6066d5` |
| `tests/sandbox-usdc-callbacks/run.mjs` | `02063c4938973d49e7b930f0e569ab40301c21600243d68d524faa9e42321090` |
