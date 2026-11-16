# P2 USDC receipt-recovery implementation review

Date: 2026-11-16. Verdict: **Approve with required changes**.

Two High, two Medium, and one Low findings are recorded below. This verdict withholds approval to advance this exact candidate unchanged. Correct the accounting and bootstrap defects, supply a complete hash-pinned build package, and repeat independent contract-level checks before isolated NEAR VM/Sandbox acceptance. There is no canary, production, or mainnet acceptance. The deployed historical artifact is not this recovery candidate.

## Attribution and isolation

Reviewer: Codex automated independent worker. Requested model: `gpt-6.1-sol`. `orca orchestration worker-show --dispatch ctx_d76bedeaa4e7 --json --full` reports requested and effective model `gpt-6.1-sol`, provider `codex`, and exact live worker identity. This confirms the IDE runtime's model selection; there is no independent backend model attestation available to the reviewer.

Worker session: `orca_session_id:197b4171-db62-4943-9449-70ca02e8983e`; coordinator: `orca_session_id:codex_f100d52e_cb55_4928_b1b9_685cb9036031`; task: `task_6b6dfdc3c9a8`; dispatch: `ctx_d76bedeaa4e7`; run: `run_eb98c6f4c0e8`; runtime epoch: `586715e6-5c08-4ff8-aed3-4689eb1e7fbe`; worker handle: `structworker_3e449a42-8415-459c-9b20-1853c6f4256b`.

This was a fresh dispatched structured chat in the **same shared worktree**, not a separate checkout, VM, container, or separate host. Review/check inputs were extracted into `/var/folders/3g/71yfgry5343_3qzh7qnx413m0000gn/T/lcp-independent-review-3nds88m4`; its filesystem isolation does not imply a security sandbox. No helper agents were used and no coordinator conclusions were supplied to this review. No credentials, environment files, wallet files, network transactions, deployments, upgrades, bootstrap transactions, or issuer controls were accessed. Only this report was written in the repository; build artifacts were created in the temporary extraction.

Baseline HEAD independently checked: `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`. Manifest identifies branch `main`, dirty working tree, and uncommitted candidate. The file hashes below, rather than HEAD, identify the reviewed inputs.

Archive SHA-256: `f8861f0a0bfff0dc74f4e726879d32efcb5f34f4763f9319432e1a83de93937a`.
Manifest SHA-256: `e7e9897707193a207884ec680c6f7887d336681e1621f1705448a92e971bb43e`.

Initially and at completion, Python `zipfile`, `pathlib`, `hashlib`, and `json` verified the archive hash, exact 39-member set (38 inputs plus manifest), unique names, no absolute/traversal/backslash paths, packed manifest byte equality, and every input's hash and bytes against current repository files. Completion also checked the extracted input bytes. All matched. No candidate source or manifested input was modified.

## Prioritized findings

### H1 — Failed native refund reconciliation overwrites another credit

**High.** `contracts/lcp-core/src/contract.rs:2990`, `on_storage_refund_attempt`, specifically the failed branch at approximately line 3007; `write_service_report_refund_credit` at line 6006.

Each failed attempt removes its persisted attempt but calls `write_service_report_refund_credit(&attempt.payer, attempt.amount)`. That helper overwrites the account's 16-byte balance. It does not add any already available credit. The aggregate `StorageRefund` liability correctly remains counted, but the payer's withdrawable claim is lost.

Reachable scenario: the same payer has two excess-deposit refunds in flight; it is a named account deleted before their transfer receipts execute. Both native transfers fail. Their callbacks restore amounts A and B to the same payer key, leaving only the last amount. Alternatively an existing available credit can coexist with a failed attempt. Account deletion is not permission to forfeit these credits; the named account can subsequently be recreated and is the sole withdrawal destination. With A=10 and B=20, aggregate liability remains 30 but available credit becomes 20. The missing 10 has neither an attempt row nor a credit claim. The same aggregation problem applies to failed withdrawals concurrent with a separately accrued credit. This affects default and feature builds.

Remediation: checked-add the failed attempt to the existing payer balance, without increasing aggregate liability a second time; remove the attempt atomically. Regression: two failed excess callbacks in both orders; failed withdrawal plus independently accrued credit; duplicate callback; overflow rollback; verify available plus in-flight equals the ledger liability throughout. A source-confirmed Python state reproduction produced credit=20 and liability=30; no contract-runtime reproduction was possible with this package.

### H2 — Bootstrap changes settlement rules for transfers already in flight

**High.** `recovery_config.rs:150` (`bootstrap`), `recovery_config.rs:374` (`create_pending_intent`), `contract.rs:4045` (`settle_token_transfer_outcome`, configured check around line 4120).

The feature-enabled fresh contract can create/fund/activate commitments and call `claim_tranche` or `refund_remaining` before recovery bootstrap. `create_pending_intent` returns `None` while configuration is absent, so those transfers have ordinary v2 sidecars but no recovery intent. The captured initializer can subsequently bootstrap without checking whether commitments/transfers have already been admitted. After bootstrap, settlement uses the **current global configuration flag**, requires a recovery intent for every token transfer, and returns `None` for these older transfers.

Concrete ordering: new → create/fund/activate eligible token commitment → claim → bootstrap receipt → delayed successful or failed token callback. The callback now ignores the transfer. The certificate endpoint cannot settle it because its first step requires the absent recovery intent. `pending_raw`, tranche Pending state, and pending-transfer count remain reserved; closure and associated refunds can be blocked indefinitely. No malicious quorum is needed. A fresh deployment alone does not prevent this ordering. An atomic operational bootstrap would avoid the scenario, but the contract does not enforce that prerequisite.

Remediation: require bootstrap before token admission in recovery-enabled instances, or reject bootstrap unless the instance has admitted no business state; an explicitly persisted per-transfer mode is another possible design requiring independent review. Do not invent an intent for an already executed token transfer. Regression: pre-bootstrap attempts, delayed callback crossing bootstrap, both callback outcomes, and bootstrap rollback; confirm no inaccessible liability. This is a direct source trace, not an executed NEAR reproduction.

### M1 — Credit view reports available withdrawals without the required outflow margin

**Medium.** `recovery_accounting.rs:923` (`persisted_refund_credit_view`), lines 939–949, compared with `begin_persisted_refund_withdrawal:989`, `contract.rs:462`, and `native_cash.rs:119` (`required_balance`).

The view sets `withdrawal_available=true` and exposes the full amount when the ledger is currently solvent. Execution additionally reserves the amount in X while retaining Q. A current balance satisfying the snapshot can therefore be insufficient for the proposed withdrawal even in unchanged state. Example: S=100, other N=0, Q=20, F=10, C=130, withdrawal=20. The view's cash check passes; the withdrawal gate requires 150 and rejects. Source-confirmed Python arithmetic reproduced these exact predicates. This is stronger than the ordinary warning that views can become stale.

Remediation: include the proposed whole-row outflow in a checked read-only readiness calculation and expose necessary free margin, without changing liability accounting. Regression: C equal to the snapshot threshold, one below the withdrawal threshold, and exactly at the required withdrawal threshold; include unrelated liabilities and reserve-not-ready cases.

### M2 — Portable package cannot build or test the candidate

**Medium (review reproducibility/coverage).** Root `Cargo.toml:2` references omitted workspace members; `contracts/lcp-core/src/lib.rs:11` declares omitted `temporal.rs`.

Both default and feature-enabled offline tests and Wasm checks fail during workspace loading because `contracts/bounded-payout-adapter/Cargo.toml` is absent. The package also omits the evaluator workspace members and `contracts/lcp-core/src/temporal.rs`, a direct dependency of contract eligibility, health, and state models. Even reducing workspace membership would not supply that source. These are package omissions, not proof that the owner's complete checkout fails compilation.

Impact: candidate-level behavioral claims, full temporal eligibility review, and default/feature executable equivalence cannot be independently verified using only the manifested inputs. Remediation: publish a refreshed manifest/archive containing the complete transitive local source/build inputs and tests. Regression/acceptance: extract on a clean machine with cached dependencies and run both modes without borrowing unmanifested source. No alternate temporal implementation, stub, workspace rewrite, or dependency substitution was used here.

### L1 — Operator annex contradicts the candidate's cash-observation model

**Low.** `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`, section “NEAR runtime balance observation for solvency checks” (around line 17), versus `native_cash.rs:10` and the design's implementation follow-up.

The annex says guest balance decreases at promise construction and instructs checking after outgoing actions. The candidate/design use unchanged guest balance plus explicit X and a preflight. An implementer following the annex can select a different cash gate/order from the candidate and supplied Sandbox observations. Remediation: reconcile the normative documents with a pinned, independently reproduced guest-level test, distinguishing SDK Promise builder lifetime from host promise materialization. Regression: exact-threshold native and FT deposits, action construction order, failed gate with no emitted transfer, and all multi-outflow paths. This report does not independently establish nearcore host semantics from historical assertions.

## Answers and coverage of the six question groups

### 1. Intent and token binding

For configured production token claims/refunds, admission writes a unique transfer-ID keyed intent and preallocated credit before scheduling `ft_transfer`, increments the epoch's pending count, and charges measured storage plus one yocto. Intent fields bind network/genesis, account/instance, epoch, transfer/commitment IDs, kind/tranche epoch, token/code hash, recipient, amount, origin method, gas and deposit. `transfer_memo` uses lowercase hashes and decimal transfer ID; the event uses the same stored intent digest. Its JSON event is correlation evidence; the signed canonical representation is Borsh. The counter is checked for overflow; retries use a new transfer ID.

The v2 callback sidecars bind current contract/chain, asset, kind, recipient and amount; malformed/incomplete v2 records are not silently treated as v1. Native transfers carry positive native amounts while token records carry zero, preventing missing token state being interpreted as native. H2 is the exception to safe lifecycle classification. Token code provenance is initializer/operator supplied, not discovered or verified on-chain.

### 2. Parser and signatures

Reviewed `receipt_recovery.rs` bounded reader, envelope/certificate/intent parsing and signed governance parsing. Encoded length is checked before Base64 decode; decoded bound is calculated first; canonical re-encoding rejects padding/alternate encodings. Borsh string/vector lengths are checked before allocation, exact remaining signature bytes are required, and trailing data is rejected. Limits are 1,604 encoded / 1,202 decoded / 714 certificate / 500 intent bytes; signatures are exactly four or five, strictly raw-key sorted, pinned to the intent epoch and verified individually with Dalek `verify_strict`. Committee registration rejects duplicate and weak keys. Account syntax, enum/option tags, kind/epoch/method consistency, nonzero identities/amount and fixed 1-yocto/25-Tgas parameters are validated.

The certificate carries complete intent equality plus digest, transaction/receipt/block identity, heights, token action index zero, and outcome. Domains separate intent, certificate, rotation and cancellation. Context/intent equality prevents ordinary cross-transfer/instance/network/epoch replay; terminal state and pending removal prevent repeat settlement. Receipt origins are **signed assertions**: the contract cannot independently associate these external IDs with the outgoing action. Quorum members can attest incorrectly; strict signatures do not prove receipts. Reference-vector execution passed, but the actual candidate parser mutation suite was not executable from this package.

### 3. Receipt interpretation and trust

The design's decision procedure requires finalized origin ancestry, exact event, single direct token child, core predecessor, token receiver, single action zero, exact method/deposit/gas and duplicate-key-rejecting JSON arguments including memo. The annex requires action-time V4 Local code identity or deterministic local archival replay, not present-day code queries. Failure classification relies on pinned receipt atomicity. Missing ancestry, ambiguous mapping, unsupported metadata, missing archives/replay, provider disagreement, nonfinal/reorg uncertainty, or unsupported code upgrades require abstention and leave liability pending.

Four-of-five is an operator oracle assumption. Distinct keys do not prove distinct ownership, independent data/software, correct sign-once journaling, or honest receipt interpretation. Two unavailable members stop liveness; rotation does not replace a pending transfer's old epoch. Lost historical keys/archive data or exhausted rotation capacity can strand transfers permanently. The documents acknowledge this. No production operator implementation, administration separation, archive service, or receipt replay was tested here. Historical Sandbox and RPC observations remain supplied evidence for their stated scopes.

### 4. Races, settlement and cash

Callback and certificate paths share `settle_token_transfer_outcome`. It verifies pending transfer/tranche/settlement consistency, computes checked success counters, marks intent terminal, decrements the pinned epoch, seals the credit, updates pending and paid/refunded, and removes pending/v2 sidecars. Failure releases token pending to derived free; success increases exactly one paid/refunded bucket. The terminal record remains for separate cleanup. Later callbacks see no pending transfer; retries use distinct IDs. Missing/multiple promise results remain pending; explicit single failure is required for failure. A successful nonempty FT result is classified as success through `TooLong`, which is consistent only with the reviewed synchronous FT trust model.

Native ledger includes storage, escrow, operations, legacy refund liability, recovery Q, F and receipt X; stale/short reserves fail closed. Production outflow inventory examined: native tranche/escrow refund, operations refund, legacy excess/credit refunds, recovery credit withdrawal, FT one-yocto deposits and both OutLayer dispatches. Authority adapter calls attach zero. Claims/refunds and OutLayer dispatch use `refund_excess` to include additional outflow; configured FT admission explicitly includes one yocto; credit attempts retain liability while reserving X. OutLayer spend is charged on dispatch and not restored by evaluation failure. No omitted positive-value Promise path was identified in that inventory, but this is not VM proof of the cash invariant.

Credit rows persist exact amounts/nonces, authorize only the immutable payer, reject unexpected callback counts, and retain Withdrawing when unresolved. Successful credit payment releases Q and either closes the measured row or leaves a settled zero-credit tombstone during revaluation. Finalizers release a payer record's original bond once; credit-row bonds go to treasury rather than to the payer. Checked reserve metrics separate per-record excess and gaps. H1 breaks legacy claim conservation; M1 breaks view readiness. Missing/OOG callbacks remain non-retryable liabilities, including native credits outside token certificate recovery. A token settlement followed by the public method's cash gate can roll back when reserve maintenance is active; therefore it may require post-maintenance certificate retry rather than being immediately committed. Do not describe terminalization as unconditional across a failing method.

### 5. Bootstrap, governance and compatibility

`new` captures the predecessor; bootstrap checks this authority, consumes it once, maps supported network to the fixed USDC account, validates sorted strong keys and sorted canonical hash allowlist, and measures reserve-funded config/keyset/registry writes. Genesis and random instance ID are supplied nonzero values, not independently established runtime facts. Atomic deploy/init and independent configuration verification remain operator obligations. H2 means bootstrap is not sufficiently fresh-business-state constrained.

Rotation uses a signed exact context/current epoch, sequential epoch, checked next generation and seven-day minimum. Cancellation binds the exact proposal generation/digest and is restricted to strictly before activation; activation permits equality. Generation is consumed at proposal acceptance and never decremented. New raw keys cannot reuse activated historical keys. Old keysets remain until inactive and pending count zero; used-key registry remains permanent. Capacity is 32 epochs/160 keys; retirement does not reset it. Proposal/keyset/registry and credit storage are admitted before activation. Storage failure/OOG relies on receipt rollback; this was not executed against the integrated candidate.

The recovery endpoint/modules and optional Dalek dependency are feature gated and default off. **Native ledger/reserve initialization and cash gates are not feature gated**: default builds also change behavior. Existing deployment upgrades lacking sidecars fail closed rather than auto-initializing a zero ledger. Sidecar layouts reduce top-level reinterpretation risk but are not migration support. Do not deploy either build as an existing-instance upgrade without a separate inventory/migration review. Test-only initializer reset branches and fixture features must never be treated as production behavior or enabled release configuration.

### 6. Gas, storage and operations

Worst-case certificate parsing is bounded to 1,202 envelope bytes and five strict Ed25519 verifications plus bounded string reads/serialization. Rotation is bounded to 937 decoded bytes and five verifications, reads at most 160 used keys, and reserves next keyset/registry/credit storage. Revaluation reads at most 64 indexed records; 2,048 live registry records require at most 32 full batches. Each recovery transfer creates two registry records (intent and credit row), so capacity is below 1,024 simultaneous transfers after configuration/governance overhead. These are size/work bounds, **not measured Tgas or storage costs**. Full measured storage deltas include registry/index overhead; no defensible worst-case Tgas estimate can be certified without VM execution of Dalek and the integrated callbacks. FT 25 Tgas and callback 20 Tgas are provisional for this candidate; historical callback measurements predate integration.

Reserve revaluation blocks admission, removal and cash-sensitive operations until every batch completes and shortfall is covered. Top-ups increase treasury; when no gap exists they increase F with C and do not supply discretionary outflow margin. Separate native liquidity must therefore be funded and monitored. No amount of reserve top-up substitutes for missing operator evidence or callbacks. Low gas, deleted recipients, retained credits/intents, full registry, interrupted maintenance, or lost epochs can retain liabilities indefinitely. M1 prevents relying on the current withdrawal view even before state changes. Account deletion and callback gas starvation must be acceptance cases, not grounds to release an unknown liability.

## Executed checks and limitations

Tools: shell `rg`, `sed`, `cat`, `wc`, read-only Git identity, Python standard library integrity/state calculations, Orca status/dispatch inspection, Cargo/Rust and Node version inspection. Environment: rustc `1.100.0 (0ef1bc386 2026-11-09)`, Cargo `1.100.0 (3acc79c0c 2026-11-05)`, Node `v26.5.0`, local macOS temporary filesystem. No network bootstrap or dependency download was requested; Cargo checks used `--offline --locked`.

Executed in extracted copy:

- `cargo run --offline --locked --manifest-path tests/receipt-recovery-vectors/rust/Cargo.toml -- tests/receipt-recovery-vectors/golden-vectors.json`: **passed**, including canonical maximum 5-of-5, malformed/oversized reference parser mutations, certificate/domain mutations and strict signature negatives; this tests the standalone reference utility, not contract storage or callbacks.
- `cargo test -p lcp-core --offline --locked --features usdc-receipt-recovery`: **blocked at manifest loading**, omitted workspace member.
- `cargo test -p lcp-core --offline --locked`: same failure.
- `cargo check -p lcp-core --offline --locked --target wasm32-unknown-unknown --features usdc-receipt-recovery`: same failure.
- `cargo check -p lcp-core --offline --locked --target wasm32-unknown-unknown`: same failure.
- Python source assertions and simplified state/algebra calculations confirmed H1 overwrite and M1 readiness counterexamples; source assertions traced H2's configuration transition. These are precisely simplified reproductions, not compiled contract tests, receipt tests, or proofs of reachability under a VM scheduler.
- Initial and completion archive/manifest/all-input integrity checks: **passed**.

No temporary test modifications or source patches were made. No candidate-contract test passed or failed behaviorally because it could not be compiled from the portable inputs. No Sandbox run, gas benchmark, fresh-instance end-to-end bootstrap, cryptographic candidate mutation suite, or historical fixture regeneration was executed. Historical audit conclusions were not adopted as implementation findings.

Review coverage is strongest for the recovery modules, transfer/callback interaction, native outflow inventory, sidecar models, parser and governance paths described above. This report does **not** claim an exhaustive audit of every unrelated business method or test in the 9,979-line contract, nor a complete end-to-end temporal review: `temporal.rs` is outside the authoritative package. Full interacting-source and executable acceptance coverage remains open until the package is complete. No absence-of-vulnerability guarantee follows from this automated review.

## Required follow-up gate

Preserve uncertain liabilities pending. Correct H1/H2 and M1, reconcile L1, and repackage the complete source/test inputs under a fresh hash set. Run compiled regressions for both modes, then integrated certificate-first/callback-first/failure-retry/late-callback cases, epoch lifecycle/capacity, credit nonce and deletion races, reserve-price/revaluation/tombstone paths, and exact native cash thresholds at actual host promise scheduling. Measure worst-case parser/signature and callback gas in the pinned NEAR VM before relying on provisional limits. Independent operator receipt-policy/provenance and archive-readiness acceptance remains a separate dependency. No implementation fixes are included in this task.

## Reviewed input hashes

| Repository-relative input | SHA-256 |
| --- | --- |
| `audit/p2-receipt-recovery-implementation-2026-11-16/README.md` | `2b4425be18b18ad132c5cbacfe8921a3bb4f3b80a89276c6fbb5ebe5fe61e5a8` |
| `contracts/lcp-core/src/contract.rs` | `fbe2b9d8590a7b2057fcba0ae75d6bcb013e40f5a3c0f62ae1350ceccb77f1dc` |
| `contracts/lcp-core/src/lib.rs` | `d9aae106409779a46c58268fa8989dc03d3d3b4be4a5bf50662f5eb3f5031323` |
| `contracts/lcp-core/src/models.rs` | `220f21be25a1d93e56588693f063213ec20cf5a1da79682aa9137faa9e475603` |
| `contracts/lcp-core/src/native_cash.rs` | `aa014cb5666bbc5ef7d8f4618577441ecb49687c88fec89c57665fe939522c2d` |
| `contracts/lcp-core/src/recovery_accounting.rs` | `af430ba3819f77d8122995ea57dc238f55bdf4fb15e655bf82bb174d7138c47a` |
| `contracts/lcp-core/src/recovery_config.rs` | `4fb1c6a3fb89cc28c9d2a886344caffa34ebffb6511e026cd1c7c6764a3ebae5` |
| `contracts/lcp-core/src/receipt_recovery.rs` | `dd1417d3eea017878e9a0e07a0f45b080c3ac8c15439bcd4c7afbaf636277ddb` |
| `contracts/lcp-core/Cargo.toml` | `d5c6dc5edb37a46ed7baf522577335a2c02eef0fe0868623d9e95f5cc741f7da` |
| `Cargo.toml` | `93037e60b51cc4ef4b8e62e4bb0580ac88bbd9b82fd29dca54337bbe61091ab7` |
| `Cargo.lock` | `877a0c3370baecb3d4e8e8d27cc8edd1f46ffbd519e222e75c3168ae7a328eb2` |
| `rust-toolchain.toml` | `8ea81d2f0f2b68bec4abdd4419023c303a596abada7da66d1366191219a61c2d` |
| `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` | `b29b32e6ef44b5c2cc8272f4c40908bad3cc6c0de819a23bb0c11c56dc77e1ed` |
| `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md` | `55e827a64b433bb87ce3e3a53fe92d1ca413bc615dbbc7b5e490a6a1933dc6bf` |
| `P2-USDC-RECEIPT-RECOVERY-AUDIT.md` | `e8658be9c3afd95416313bd309a6e8c61ec030cfd9dc152e8028aa79f3187928` |
| `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-REVIEW.md` | `016e7819145a4a529b0b41e3f662f01391f21634fe3c39890abf4f7ac4b5c80c` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW.md` | `a89fbbfacf9555704e544746c43bd120ae15f7afb180f994ad8a4fe9b28d2da6` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V3-REVIEW.md` | `577c534d7f5095e2ec59a04bd8865bd3b7176a84a0668d1e0e65d2495bcababf` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V4-REVIEW.md` | `78edae35e7db1536f6ea3bf1eb780298aea3ff66c4b12d665c392ce0b075eea1` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V4-REVIEW-BRIEF.md` | `f46a8a4e03ec39d133b36de13aca4de30216e3fd95eca217c3fabb9adf52f5e3` |
| `P2-USDC-INDEPENDENT-AUDIT-REPORT.md` | `f331de22899a7017d6a8698fae997d85296fc0840abd5ebdb5bbc42be6df54ff` |
| `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md` | `6680cf5e65bb27c8f69e45572ef12d7a526bb04ef8057c97943b9f70eb594e04` |
| `P2-ASSET-ARCHITECTURE.md` | `5fdca22ba528ec54c44e96f0260076b00020d34c26d5fb009bf86aed3b45298a` |
| `TODO.md` | `0577f5ad35ad8dd90f9d78521d547d081c972ff15f02421dd2a6af4f681f6470` |
| `TESTNET-E2E-STATUS.md` | `3a54d664d8388b6bede38708deba3456e1340c166bdfb9ad2b18a300d1cd64d6` |
| `tests/receipt-recovery-vectors/README.md` | `ccc3a486b01ff4646de63b4b8292de72ce289fde24fce145bfe5a871fe7ddd88` |
| `tests/receipt-recovery-vectors/generate.mjs` | `817269beb3346bdd899ae3e581eb4d3c50da28a11c8261da95754c5d6ec712a6` |
| `tests/receipt-recovery-vectors/golden-vectors.json` | `5236c3288001d06c96166f8b539777c489fc3e5b1ebd01123bdb3794fbcd76ac` |
| `tests/receipt-recovery-vectors/rust/Cargo.toml` | `0d1211bcaa0b528322ae0d7dd324b9f025ac05e85a266a62d93d2f73f958cd67` |
| `tests/receipt-recovery-vectors/rust/Cargo.lock` | `8a24ec41dfb2a2c1fdac5d453e140b6e06330162c18235c8060c965268523731` |
| `tests/receipt-recovery-vectors/rust/src/main.rs` | `874b1a8ed823df8f0e8ef40c76c824dab2dab37b99729ea13a8460706fa493b1` |
| `tests/sandbox-usdc-callbacks/README.md` | `bc87724b525c53949c9f1ef54131e5eca7ba114ddc1ed11e9c5ba6d3e07167df` |
| `tests/sandbox-usdc-callbacks/run.mjs` | `f884cf7386dff1e9a20ef92c4c964262e27fb6d0d016af976215a294d595ee5c` |
| `tests/sandbox-usdc-callbacks/package.json` | `d5146dfb2f994d660935955a0ea10c80efcd9377a8ed480225d7c2e25ead6548` |
| `tests/sandbox-usdc-callbacks/package-lock.json` | `c14ba6bb421a3bc4c14909ba301c7e49a7e46ba5cf16c39fa097caaff6d6e39e` |
| `contracts/sandbox-mock-ft/Cargo.toml` | `e29062846a172e88c4b58aabfb4b8f33333535a0472687ac02256aecfdd5c3aa` |
| `contracts/sandbox-mock-ft/src/lib.rs` | `1e8d9a239aa01fb6c005bc3bfe11d1c96ce6da7b3016585c3bff403760087ffe` |
| `audit/p2-receipt-recovery-2026-11-15/spec-v4-review-manifest.json` | `ccd5514485f8f377a090073794ed8cb4e53fdc05fc1e7a87ad519f632fc8fc87` |
