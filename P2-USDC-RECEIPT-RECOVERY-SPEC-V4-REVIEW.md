# Independent automated receipt-recovery specification v4 review

Date: 2026-11-15. **Verdict: approve for implementation planning.** New specification findings: **0 Critical, 0 High, 0 Medium, 0 Low**. V3-1 and V3-2 are closed at the specification level. This is permission to plan against the specified conservative policy, not evidence that current code implements it or authorization to deploy it. Uncertain liabilities remain pending.

## Identity, independence, and input boundary

Reviewer: OpenAI Codex, requested and recorded runtime model `gpt-6.1-sol`, medium effort. Independently read this session's first `turn_context` record and queried `orca orchestration worker-list --json --full --limit 10`: this dispatch's live execution-host projection identifies provider `codex`, model `gpt-6.1-sol`, host `local`, activity `working`. This confirms runtime reporting, not cryptographic model-weight or hardware identity.

Worker: `orca_session_id:5bd7f6d5-b6ae-46ca-aa96-cee24e782613`; Codex session: `01a1e0e6-06ff-7783-ae56-12c2ccb961ef`; task: `task_e62484645eca`; dispatch: `ctx_396ade25d9c7`; run: `run_eb98c6f4c0e8`; coordinator: `orca_session_id:codex_f100d52e_cb55_4928_b1b9_685cb9036031`; Orca runtime: `586715e6-5c08-4ff8-aed3-4689eb1e7fbe`.

This fresh worker conversation received the review task and repository instructions without the coordinator's conversation history. I performed the analysis alone, with no helper workers. The repository, host, tools, and supplied historical reviews are shared. Independence is conversational and analytical; this is neither separate operator ownership nor a signed security-firm audit, independent hardware review, or cryptographic receipt-proof verification. The runtime listing was used for identity, not to inherit another review's conclusions.

Read the v4 brief and manifest first. Independently verified all 25 SHA-256 input identities before substantive review. Independently queried HEAD: `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`, matching the manifest. The reviewed baseline is a dirty working tree; the hashes below identify its exact contents, not a claim that those contents are committed. Historical manifests intentionally identify earlier revisions and were not substituted for v4 inputs.

## Methods and evidence limits

Reviewed the manifested design/operator annex, historical v3 and v2 findings/briefs/manifests, original recovery audit and follow-up, USDC audit/follow-up, asset architecture, relevant TODO/status records, contract transfer creation/callback/native refund/storage/sidecar/counter paths, models, Cargo configuration and lock, and Sandbox harness/readme/package/lock. Large outputs were narrowed to relevant passages after truncation. This is a focused specification and integration review, not an exhaustive unrelated-feature or dependency audit; lockfiles establish identity and pins, not dependency security.

Executed read-only SHA-256 and HEAD checks, runtime metadata queries, JSON parsing of historical manifests/package-lock, Cargo pin inspection, `node --check tests/sandbox-usdc-callbacks/run.mjs` (exit 0), primary-source HTTPS reads, exhaustive small-integer storage accounting (1,331 combinations), 25 quorum-pair intersections, and envelope/Base64 arithmetic. Manual adversarial transitions below are calculations, not VM execution. No recovery implementation exists in the manifested code. Historical Rust tests, WASM builds, artifact reproduction, Sandbox runs and network observations were not rerun. Supplied 82-test results and callback OOG/failure/concurrency evidence establish existing behavior only. No recovery signatures, host-verifier conformance, archival replay, issuer behavior, keys, funds, transactions, deployments, or fixes were exercised. Only this report was written.

## Pinned source facts

At commit `bc4e9e8cfb03d9e82f027883055624e18576993e`, `ExecutionResultState::new` adds the attached deposit to context balance, and `deduct_balance` subtracts outgoing amounts with checked arithmetic. These establish the cash observation model. [VM accounting source](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/logic.rs).

The host reads current balance; native transfer construction deducts its deposit, as does ordinary function-call construction. Function calls include a special zero-balance one-yocto subsidy branch, which is not usable as backing under this design's funded storage/liability policy. The required implementation must observe actual host construction, not merely creation of a lazy Rust Promise value. [Host implementation](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/near-vm-runner/src/logic/host.rs).

The runtime checks storage stake before commit, clears generated work on action failure and rolls back failed receipt state. This supports atomic rejection of a scheduling receipt whose final invariant fails. It cannot roll back an earlier successful token receipt because a later LCP callback fails. [Runtime source](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/runtime/src/lib.rs).

Deposit refunds are separate system transfer receipts directed to the predecessor; callback failure information does not establish delivery of that refund. [Refund rules](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/docs/RuntimeSpec/Refunds.md).

Pinned version mapping enables metadata V4 from protocol 85 and sets stable protocol 88. V4 records receiver contract identity per action; runtime merge preserves action order, including failed execution metadata. Thus action-time Local identity and replay are necessary, and a post-block code query is insufficient for same-chunk deployment races. [Version mapping](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/core/primitives-core/src/version.rs), [metadata definition](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/core/primitives/src/transaction.rs).

## Findings and closure

No new severity-ranked specification defect was established. The following closure is about normative proposed behavior, and does not certify existing native helpers.

**V3-1: closed at design level.** In “State, storage, migration, and atomic settlement,” the Pending-credit, conservative solvency, and storage-bond bullets now define the missing cash point, include Pending excess, separate original bonds from current storage and funded treasury, and expressly include all native outflows. Extra cash for outgoing transfers is an intentional liquidity requirement. It must be budgeted before implementation; an unfunded deployment will reject legitimate payouts safely.

**V3-2: closed at design level.** The “Payer and callback authorization” bullet defines caller, receiver, amount, nonce, row and callback binding. Explicit failure enters RefundPending; retry requires the cash gate and a new nonce. Unknown or OOG does not become retryable. These are adequate specification rules for transfer, proposal and epoch credits; exact storage layout and actual VM tests remain later deliverables.

## Answers to the five question groups

### 1. Cash, liabilities, and promises

The VM observation point is correct: after credited attachments, actual host promise actions and state writes. A final check before Rust Promise destruction or unflushed storage would not implement that requirement. Implementers must force construction and flush affected collections before checking, with no subsequent native action bypassing the gate.

Let H denote S+N+Q+F. Example: S=10, Q=100, other obligations zero. C=110 can hold the credit but cannot send it. C=210 can send 100, leaving C=110, Q=100 and H=110. Exact success removes Q=100; the remaining cash 110 covers storage 10 and restores 100 of usable liquidity. Callback OOG leaves C=110, Q=100, Withdrawing, with no retry. The margin remains locked; it is not false free balance.

Explicit transfer failure before its automatic refund leaves C=110, Q=100, RefundPending. Retrying 100 now would leave C=10<H=110 and must reject. Refund delivery raises C to 210 and permits the retry. Refund-before-callback also works: C=210, Q=100, Withdrawing remains non-retryable until exact failure is recorded. With additional unencumbered cash, the inequality can permit a retry even before the earlier refund arrives; this is safe because the earlier attempt has proved failure, the entire liability remains, and the new send is double-backed. A balance delta alone must never be used as proof of failure or permission to retry Withdrawing. The wording “post-refund solvency check” must be implemented as the specified cash gate, not as unauthenticated refund attribution.

For native escrow payouts and operations refunds, keep the unpaid obligation in N while its outgoing amount has already left C. Multiple sends X must be checked in aggregate. Explicit failure must preserve the obligation, with any retry satisfying the same cash gate; OOG/missing outcome remains non-retryable. The 1 yocto FT deposit belongs in X even though token principal is not a NEAR liability. It is not a refundable payer credit unless separately owed; any still-owed native deposit obligation remains in N until resolved. A failed FT call's automatic yocto refund is cash only on delivery. Never count USDC as NEAR backing.

Legacy excess must remain a liability through its own pending send, including a fire-and-forget route if one survives. The actual `refund_excess` helper currently schedules `on_excess_refund`, so describing this implementation itself as fire-and-forget would be inaccurate. It does not persist the proposed non-retryable attempt ledger. Its callback may create legacy credit on failure; those amounts must not also become new recovery Q. This is an integration obligation expressly required by v4, not implemented evidence.

### 2. Storage bonds and reserve

Write B_live=sum(b_i), G=sum(max(0,r_i-b_i)), O=sum(max(0,b_i-r_i)). Since S_R=B_live-O+G, the proposed equations imply:

```text
S_R + F = B_live + T + shortfall
shortfall=0 => S_R+F = B_live+T
```

The identity was independently checked for all b,r,T in 0..10 (1,331 cases). Summing per-record contributions extends it to multiple records. One payer's excess stays in O rather than offsetting another's G.

| Transition | Independent calculation / implication |
| --- | --- |
| Admission at current price | Deposit funding original live and credit-row bonds increases C with S_R; excess e goes into Pending Q immediately. No excess is free liquidity. |
| Price decrease | b=100, r=60, T=40: S_R+F=60+(40+40)=140. Original payer entitlement is preserved. |
| Crossing G=0 | r=100 gives 100+40=140; r=120 gives 120+20=140. Crossing the original price neither creates nor loses backing. |
| Reserve exhaustion | r=150,T=40 gives shortfall=10, S_R+F=150. Admissions/outflows pause, even if unrelated native liabilities have cash. |
| Top-up | Add 10 to C and T: shortfall becomes zero; retry release under the recomputed full invariant. |
| Terminal intent release | Remove r and its O/G, add original b once to Q; B_live falls b, Q rises b, so total required backing is unchanged when solvent. Price-increase reserve is freed to F, not paid to the payer. |
| Delayed release | If shortfall exists, retain the record/bond and Pending excess; commit proven token settlement without creating the bond credit. Later exact idempotent release must not settle the token twice. |
| Credit-row deletion | Remove row r/O/G and move original b into T. B_live falls b while T rises b; storage-plus-reserve backing is conserved. Paid Q is removed only on exact success. |

The numerical cases treat units as arbitrary NEAR amounts; they do not claim a live storage-price change was observed. Permanent registry/configuration/counter bonds stay locked. Epoch and proposal credits use their preallocated rows; cancelled-proposal count is not bounded by the activated epoch cap but each row must be funded. Initial configuration/epoch records also require admission funding.

Interpret the instruction to retain proven token settlement during reserve shortfall as the explicit exception to enforcing zero shortfall on cash-spending receipts: recording a proven outcome with the live bond retained is not a new native outflow. A blanket panic in this branch would violate the design. All eventual releases still require solvency. Failed/OOG migration/release rolls back local mutations; it cannot establish eligibility or consume a bond twice. Legacy commitment storage deposits stay solely in their existing ledger; new recovery records require separate measured funding, never a second claim on an old deposit.

### 3. Authorization and withdrawal state machine

The proposed machine binds immutable payer and fixed receiver, full positive amount, row ID, checked next nonce and current attempt. Only payer initiates. Available becomes Withdrawing atomically before send. Private self callback requires exactly one result and matching row/payer/state/amount/nonce. Exact success deletes once and retains the row bond in T; exact failure retains Q and marks RefundPending. Direct, stale, duplicate and mismatched callbacks write nothing. Missing/multiple/unknown results and callback OOG retain Withdrawing indefinitely. RefundPending retry requires the same payer, cash gate, and new checked nonce. Automatic refund delivery itself changes cash, not the row's authorization or nonce. There is no timeout, redirect, split, or arbitrary “restore” entry point.

This prevents the earlier authorization and stale-callback ambiguities. Regression coverage must reject nonce overflow before mutation, exercise stale failure after retry, success after deletion, zero/multiple results, deleted payer, missing callbacks and OOG at each mutation boundary. Preallocation must cover maximum serialized Withdrawing/RefundPending size, not only smaller Pending encoding. These are mandated VM acceptance cases, not claims of passing tests.

### 4. Consistency and integration

One serialized VerifiedTransferOutcome path consumes an exact pending token intent once, decrements its pinned epoch once and preserves immutable terminal settlement. Callback-first and recovery-first cannot both consume it; a retry receives a fresh ID. Reserve shortage delays bond release, not the established token outcome. Admission excess remains Q throughout Pending. Failed scheduling receipts roll back their generated promises and writes; failed later callbacks cannot reverse remote token success. Tentative failure logs do not prove committed work.

Every native outflow needs integration into the shared gate: native claims, native escrow refunds, unused-operations refunds, legacy storage withdrawals, excess refunds at all admission sites, new credit withdrawals and attached function-call deposits, including evaluator calls where applicable. No normative v4 exemption permits bypass. Existing `withdraw_storage_refund_for_caller` removes its credit before sending and legacy callbacks lack the new attempt binding; existing operations accounting moves balances into pending state. The new N ledger must include those pending obligations without both omitting and double-counting them. Reusing these helpers unchanged would fail v4 acceptance. Scope exclusion of operations *recovery* does not exclude operations outflows from solvency checks.

The annex's immutable execution-time hash policy, unsupported/global success abstention, protocol-88-only replay and exact finalized single-action Failure interpretation remain coherent. Failure fixtures are still prerequisites. Candidate hashes `ccfb5ad61c10b5a364d405eb404926f31b37bf636897ab9c7cfc3e74ffbf12ab` (testnet) and `b98ccd530f7e643cfef32f4529ade060ef87ff73b0101536399470777b86cfe6` (mainnet) are **not approved here**. Supplied RPC observations do not establish Circle provenance, validator client identity, local finality, or mainnet receipt behavior.

Canonical widths remain consistent: intent 500 bytes, certificate 714; 4/5-signature recovery envelopes 1106/1202 (Base64 1476/1604), rotation 841/937 (1124/1252), cancellation 705/801 (940/1068). Four-of-five quorums intersect in at least three members, independently enumerated; sign-once journals and objective independent validation remain trust assumptions. Two unavailable operators can halt recovery. Rotation generations remain consumed after cancellation/activation; overflow rejects; retained epochs and used keys prevent reinterpretation. Current v2 sidecars remain ineligible. Preserve last allocated transfer ID, instance, generation, pending ledger and terminal continuity; restoring a stale snapshot cannot be made safe with a preserved counter alone. No migration backfill or fresh-instance takeover is authorized.

### 5. Gates, coverage, and precise permission

This verdict permits implementation planning and preparation of the already-required offline artifacts. It supplies the requested design-review gate only. It does not waive the explicit pre-implementation requirements or authorize an implementation, network configuration or operational action in this task.

| Acceptance family | Established here | Still required |
| --- | --- | --- |
| Canonical bytes and quorum | Width/Base64 calculations and intersection enumeration | Cross-language signed recovery/governance vectors; all domain/field mutations; bounded JSON/Base64/Borsh parsing; 0–5 signatures, duplicate keys, weak keys/scalars; freeze strict host-verifier behavior |
| Protocol semantics | Exact pinned source inspection | Protocol-88 pre/post-execution rollback fixtures and same-chunk A/B order; globals, ancestry, nonfinality, child failure, code upgrade and missing data cases |
| Cash and storage | Manual transitions and 1,331 arithmetic cases | Real VM host timing, aggregate outflows, all legacy helpers, FT/evaluator deposits, lazy promises and storage flushes, many Pending excess rows, exact maximum state sizes, price rise/decrease, reserve exhaustion/top-up/release, callback/refund order and OOG |
| State and authorization | Proposed guards and existing callback source inspected | Both token kinds/outcomes, callback/recovery race orders, cross-ID reuse, stale retry callbacks, unauthorized/redirection/zero/nonce-overflow tests, unchanged state on rejection |
| Migration and governance | Design reasoning and current ID/sidecar source | Interrupted/mixed/malformed upgrades, stale restoration refusal, counter/generation overflow, epoch cap, initial funding, replay/cancel/activation boundaries and old-key loss |
| Existing Sandbox evidence | Harness and supplied results inspected; syntax check passed | Feature-gated recovery implementation, gas measurements, implementation review and isolated VM/Sandbox recovery acceptance; historical OOG/failure/concurrency runs contain no recovery implementation |
| Operations and network | Annex requirements inspected | Five independent operators, durable sign-once/crash/backup drills, funded archives, local archival replay by each operator, independent corroboration, approved token code provenance; mainnet-specific V4 fixture |
| Release | No new artifact accepted | Separately proposed disposable testnet canary after implementation review/Sandbox, exact reproducible recovery artifact and independent reproduction; separate upgrade/deployment/mainnet owner gates |

If evidence, cash backing, keys, archival replay, host behavior or continuity cannot be established, keep the relevant liability pending and report the dependency. No timeout or administrative override follows from this verdict. Historical build reproduction cannot accept new recovery bytes.

## Exact input identities

The table below is generated from independently rehashed bytes matching the v4 manifest, not from historical reports.

Manifest SHA-256: `ccd5514485f8f377a090073794ed8cb4e53fdc05fc1e7a87ad519f632fc8fc87`.

| Input | SHA-256 |
| --- | --- |
| `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` | `35770a4c5a04cf666baf811a09e690a039effe13b803a0d4da936efd52ace64b` |
| `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md` | `89344f054fa0eaa2059ac11657eced3e094afebe9c0f4a2a9af32736c1a363a1` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V4-REVIEW-BRIEF.md` | `f46a8a4e03ec39d133b36de13aca4de30216e3fd95eca217c3fabb9adf52f5e3` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V3-REVIEW.md` | `577c534d7f5095e2ec59a04bd8865bd3b7176a84a0668d1e0e65d2495bcababf` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V3-REVIEW-BRIEF.md` | `f21e2902e2e6ba7c7e588ff34845c028f1279bac95511df9ed0214ad417b8c4d` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW.md` | `a89fbbfacf9555704e544746c43bd120ae15f7afb180f994ad8a4fe9b28d2da6` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW-BRIEF.md` | `d88f6d41a552708fb2dc3fd2a3f5b821262f742870a6b84512d5f61acf88f31a` |
| `audit/p2-receipt-recovery-2026-11-15/spec-v2-review-manifest.json` | `a8cdc0c32b4eb294fed4bc9f5eb1e3ed29ce5cd339f88997c913b8ada28fba63` |
| `audit/p2-receipt-recovery-2026-11-15/spec-v3-review-manifest.json` | `f6742d2a28fee36ce0e1730e09eccaf4a2cb86e81b6309fa5f70b934eedcdbe2` |
| `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-REVIEW.md` | `016e7819145a4a529b0b41e3f662f01391f21634fe3c39890abf4f7ac4b5c80c` |
| `P2-USDC-RECEIPT-RECOVERY-AUDIT.md` | `e8658be9c3afd95416313bd309a6e8c61ec030cfd9dc152e8028aa79f3187928` |
| `P2-USDC-INDEPENDENT-AUDIT-REPORT.md` | `f331de22899a7017d6a8698fae997d85296fc0840abd5ebdb5bbc42be6df54ff` |
| `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md` | `d2fafeed1cf808adcb32478cc8240bc7c2ce4dd319fbc46f28aeb9c471639522` |
| `P2-ASSET-ARCHITECTURE.md` | `ece05e7104a6c0ac55146b7d79ef29b668a26358d9b181250fbc49fb7b6b1a22` |
| `TODO.md` | `99482a19c1e9073e3eedf6988fc629177063f0d48c750a79777e70f56d856864` |
| `TESTNET-E2E-STATUS.md` | `3a54d664d8388b6bede38708deba3456e1340c166bdfb9ad2b18a300d1cd64d6` |
| `contracts/lcp-core/src/contract.rs` | `aa2cf07e8e8b1782a20be576fff19771de2b498560563fe444d2878eb7581b28` |
| `contracts/lcp-core/src/models.rs` | `220f21be25a1d93e56588693f063213ec20cf5a1da79682aa9137faa9e475603` |
| `contracts/lcp-core/Cargo.toml` | `db5377ddaecf04182ed6838b76a837d459e45d579544826d837b9b60b3a25c22` |
| `Cargo.toml` | `93037e60b51cc4ef4b8e62e4bb0580ac88bbd9b82fd29dca54337bbe61091ab7` |
| `Cargo.lock` | `a577d52d1783060a64b00e9a6acb9f30078ee81309d480cffd8e2bd3eadb367d` |
| `tests/sandbox-usdc-callbacks/run.mjs` | `535db5cec8e9a4bc9f6281067f6d35a6ae2dc70bcfda28be438e7a5a81f32038` |
| `tests/sandbox-usdc-callbacks/README.md` | `bd22206bf2486c4e0635ac84546442d1741da622c29f4aae57428c3d24c1e481` |
| `tests/sandbox-usdc-callbacks/package.json` | `d5146dfb2f994d660935955a0ea10c80efcd9377a8ed480225d7c2e25ead6548` |
| `tests/sandbox-usdc-callbacks/package-lock.json` | `c14ba6bb421a3bc4c14909ba301c7e49a7e46ba5cf16c39fa097caaff6d6e39e` |

Final pre-completion verification: **25/25 inputs match; zero mismatches**, no changed input substituted. Only `P2-USDC-RECEIPT-RECOVERY-SPEC-V4-REVIEW.md` was intentionally created/written; unrelated user modifications and all historical reports remain untouched. Open dependencies are the acceptance gates above, not unresolved V3-1/V3-2 specification findings.
