# Independent automated receipt-recovery specification v3 review

Date: 2026-11-15. **Verdict: approve with required changes.** Findings: **0 Critical, 0 High, 2 Medium**. V3-1 and V3-2 below must be resolved before freezing the implementation contract. Specification reconciliation and implementation are subsequent tasks; this review changes neither. Uncertain token and NEAR liabilities remain pending.

## Reviewer, isolation and baseline

Reviewer: OpenAI Codex; requested model `gpt-6.1-sol`. Independently queried `orca orchestration worker-list --json --full --limit 10`: this dispatch's execution-host projection reports provider `codex`, model `gpt-6.1-sol`, host `local`, activity `working`. This confirms reported runtime identity, not a cryptographic attestation of model weights or hardware. Orca runtime ID: `586715e6-5c08-4ff8-aed3-4689eb1e7fbe`.

Worker session: `orca_session_id:654a0b57-8d4e-4ec1-9a07-b104c2c09f32`; Codex session: `01a1e0b8-00df-71f0-8d6a-dad0a20f52ea`; task: `task_659d3274cfe6`; dispatch: `ctx_a3e92ffbb499`; run: `run_eb98c6f4c0e8`; coordinator: `orca_session_id:codex_f100d52e_cb55_4928_b1b9_685cb9036031`.

This fresh worker conversation received the task and supplied historical review package, without coordinator conversation history. Analysis was performed by this worker alone; no helper agents. Filesystem, execution host, tools and historical evidence are shared. Independence is conversational and analytical, not independent operator ownership, hardware, a signed security-firm audit, or receipt-proof verification.

HEAD independently checked: `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`, matching manifest baseline. The dirty working tree is the baseline, not a claim that reviewed contents are committed. Read the v3 brief and manifest first; independently verified all **22/22** input hashes before substantive review. Final recheck recorded below. Historical manifests describe older designs and intentionally differ from current input identities; those historical versions were not substituted.

## Evidence and checks

Reviewed the manifested design and annex, v2 report/brief/manifest, original and follow-up recovery reviews, original USDC audit and follow-up, asset architecture, relevant TODO/status acceptance records, contract transfer/callback/sidecar/counter/storage code and models, Cargo configuration/lock identities, and Sandbox harness/readme/package/lock. This is a focused specification and integration review, not an exhaustive audit of unrelated contract features or dependencies. Large outputs were narrowed to relevant code and paragraphs; dependency locks were checked for identity/configuration, not independently vulnerability-audited.

Independently executed: Python SHA-256 comparisons; git HEAD query; Orca runtime metadata query; Python width/Base64/domain calculations and exhaustive quorum intersections; a numerical negative solvency scenario; `node --check tests/sandbox-usdc-callbacks/run.mjs` (exit 0); primary-source reads through web and read-only HTTPS at the exact nearcore release commit. An attempted supplemental source path `runtime/near-vm-runner/src/logic/logic/actions.rs` returned HTTP 404; no conclusion relies on that unavailable path.

Did not rerun Rust tests, Sandbox, builds or live network token queries. Supplied 82-test results, historical artifact matches, Sandbox OOG/failure/concurrency results, and live token observations are inspected supplied evidence, not independently reproduced checks in this session. No recovery implementation exists in the manifested code. No keys, wallet access, funds, transactions, deployments, issuer experiments or fixes were used. Only this report was written.

## Prioritized findings

### V3-1 — Medium: solvency equation mixes cash and in-flight obligations, and excludes funded Pending credits

**Location:** design, “State, storage, migration, and atomic settlement,” RefundCreditV1 and solvency bullets; rotation paragraph on reserve-retained bonds.

Preallocation resolves unfunded credit-row creation, but the new equation is not yet an executable balance specification. It includes all `Withdrawing` credits and pending native payouts against `contract_NEAR_balance`, without defining whether that balance includes amounts already deducted into outgoing receipts. Example independently calculated: balance 110, storage lock 10, Available credit 100 satisfies the equation. Scheduling its withdrawal leaves cash 10 and Withdrawing credit 100: the written equation now demands 110. A successful transfer followed by callback OOG leaves that artificial deficit indefinitely. Native pending payouts and operations refunds have the same distinction. Counting remote funds as liquid instead would allow spending money that has already left.

Additionally, admission excess may be credited into a row while it is `Pending`, but `credit_liabilities` explicitly includes only Available and Withdrawing. The row's nonzero future payable excess must remain reserved. `recovery_storage_reserve` is defined as a computed shortfall while other bullets describe it as a retained pool of non-withdrawable funds; these are different quantities. At increased byte price, deleting storage and promising its original bond can consume the released price-increase backing unless that backing is reclassified consistently. Checking admissions alone does not state how other native outflows preserve recovery backing.

**Required remediation:** define actual account cash at a precise VM observation point, outgoing deposit reservations, in-flight claims/refunds, incoming failure refunds awaiting delivery, storage lock, all unpaid credit states, native escrow/operations/legacy storage-refund obligations, and separately funded reserve balance versus required top-up. Supply a transition table for each promise schedule, success, explicit failure, absent/unknown callback and later refund delivery. Count Pending excess exactly once. Do not count in-flight assets as spendable; do not assume failure callback delivery proves the separate deposit refund is already cash. Either adopt a rigorously stated conservative double-backing policy and fund it, or use distinct cash/in-flight coverage inequalities. Preserve backing across all native outflows, not just recovery admissions; uncertain withdrawals stay non-retryable. Specify how retained row bonds and freed price-increase backing remain owned by the reserve without refunding legacy commitment bonds twice.

**Acceptance test:** minimum-funded account, simultaneous native payout/operations refund/recovery withdrawal, token settlement, callback OOG after successful native send, failed send with delayed refund receipt, many Pending rows with admission excess, storage-price rise followed by intent deletion, and reserve top-up. Assert both cash coverage and total obligations at every asynchronous phase. The numerical counterexample is specification evidence, not an executed NEAR exploit.

### V3-2 — Medium: withdrawal authorization and callback identity remain implicit

**Location:** design, “State, storage, migration, and atomic settlement,” credit row and withdrawal bullets.

Rows store payer and immutable withdrawal amount/nonce, and explicitly preserve Withdrawing on unknown results. However, no normative entry-point rule binds the caller, receiver, row, nonce and callback. A literal implementation could accept a caller-selected recipient for someone else's row, or accept an old failure callback after a new withdrawal has begun. A statement that one callback is “explicit” does not authenticate its origin or identify its attempt. This is a specification omission, not a demonstrated code exploit.

**Required remediation:** state payer-only withdrawal authorization (or permissionless triggering exclusively to immutable payer), fixed receiver and amount, positive-amount checks, checked monotonic nonce, atomic Available→Withdrawing before promise creation, private self callback, exactly one promise result, and equality of row/state/nonce/amount before any update. Old/duplicate/mismatched callbacks write nothing. Explicit failure restores only that attempt's amount; unknown leaves it locked. Define any payer/receiver change policy explicitly, with no unilateral redirection. Apply this identically to transfer, proposal and epoch credits.

**Acceptance test:** unauthorized caller and altered receiver, callback called directly, duplicate success/failure, old failure delivered after failure/retry, wrong nonce/amount/row, zero/multiple results, nonce overflow, recipient deletion and callback OOG. No path redirects a credit, restores value twice or retries an unknown transfer.

## Answers to the five question groups

### 1. V2-1: execution-time identity and operator policy

**Closed as a specification dependency, with the annex's evidence gates retained.** The annex correctly distinguishes client 2.14.0 from network protocol 88 and pins release commit `bc4e9e8cfb03d9e82f027883055624e18576993e`. Independently queried GitHub's tag reference and confirmed that exact commit. Source interpretation is pinned to that commit, not mutable master.

Independent primary-source inspection confirms stable protocol constant 88; ExecutionMetadataV4 is enabled from protocol 85 and therefore is available at 88. V4 is a metadata version, not “protocol version 4.” The metadata definition and runtime capture receiver AccountContract before each action, append entries in action order, and pad unexecuted entries with None. Thus the single-action SuccessValue + one Local(hash) rule fits the source. None on a pre-execution failure must not be misread as evidence of executed code. Failed receipt processing rolls back receipt state; a failure of a separate later callback does not roll back the original transfer. Runtime also checks final storage stake and can convert execution into failure before commit. Sources: [version mapping](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/core/primitives-core/src/version.rs), [V4 definition](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/core/primitives/src/transaction.rs), [runtime capture/merge/commit](https://github.com/near/nearcore/blob/bc4e9e8cfb03d9e82f027883055624e18576993e/runtime/runtime/src/lib.rs).

The annex requires local validated archival execution/replay, exact protocol configuration, preceding receipts in runtime order, finalized ancestry and independent corroboration. This addresses both same-chunk orders A-transfer→Deploy B and Deploy B→transfer; block-state code queries alone cannot do so. Global/GlobalByAccount/None/unknown successful forms remain unsupported. Execution hash must equal immutable intent hash; current registry values cannot reinterpret an old intent. Successful historical A remains eligible only under retained approved A policy. Failed exact atomic action may classify Failure even before code execution; required rollback fixtures remain unexecuted here. SuccessReceiptId, delegated work and child failure stay Unknown.

**Neither observed USDC hash is approved by this review.** Testnet `ccfb5ad61c10b5a364d405eb404926f31b37bf636897ab9c7cfc3e74ffbf12ab` and mainnet `b98ccd530f7e643cfef32f4529ade060ef87ff73b0101536399470777b86cfe6` remain candidate, gated hashes. The annex accurately labels point-in-time view_code observations and one testnet RPC V4 sample, without claiming validator client identity, Circle provenance, local replay or mainnet receipt coverage. This session did not requery them. Require separate code provenance/atomic synchronous ft_transfer review, local fixtures, and mainnet's own finalized receipt fixture. Metadata establishes identity, not correctness of those bytes.

### 2. V2-2: storage and credit solvency

**Partially closed; V3-1/V3-2 remain.** Preallocated measured credit records, immutable payer, separate proposal/epoch records, permanent registry bonds and retained row bonds remove the prior terminal-allocation problem. Many distinct payers can create many credits, but storage is caller-funded; the 32-epoch cap does not cap cancelled-proposal credit count. Settlement can update/remove funded records without a successful NEAR credit transfer. Failed/OOG settlement must roll back token mutation; successful token settlement and failed credit withdrawal must remain independent.

Fixed original monetary bonds versus current storage price are now explicit. A dedicated treasury must cover increases, and new admissions pause if it cannot. The ledger still needs the corrections above to distinguish storage lock, balance, native liabilities and promises. VM measurements must establish fixed-size/preallocated mutation behavior including maximum payer length, changed serialization state and every low-gas boundary. Row preallocation alone is not solvency proof.

### 3. V2-3: monotonic rotation generation and bytes

**Closed at design level.** Accepted proposal consumes checked `last_rotation_generation+1` atomically. Cancellation and activation retain it. Both V2 messages bind chain/genesis/core/instance/old/new epoch/generation; cancellation additionally binds proposal digest. Rejected/OOG admission does not consume generation. Exact cancelled-bundle replay and cancellation against a successor fail even within the original seven-day window. Competing bundles cannot occupy an already occupied slot; once the generation is consumed they cannot return. A previously signed but never admitted bundle for the still-current next generation remains potentially admissible by design; consumption only starts on accepted admission. Its absolute activation timestamp must still satisfy seven days from submission. Cancelling that exact pending generation permanently consumes it. Overflow rejects further proposals.

Snapshot continuity must include generation as well as transfer counter, instance, pending ledger and terminal history; the acceptance matrix includes generation reset/restore. No stale snapshot is safe merely because an ID counter survived. Strict schema=2, old V1 rejection, sorted unique keys, common bounded envelope plus tighter message-specific caps are coherent. Golden vectors remain required deliverables, not present evidence.

Independently recomputed maxima:

| Message | Borsh message | Envelope 4 signatures / Base64 | Envelope 5 signatures / Base64 |
| --- | ---: | ---: | ---: |
| Intent | 500 | n/a | n/a |
| Recovery certificate | 714 | 1106 / 1476 | 1202 / 1604 |
| Rotation V2 | 449 | 841 / 1124 | 937 / 1252 |
| Cancellation V2 | 313 | 705 / 940 | 801 / 1068 |

Intent sum: `1+132+32+68+32+4+8+8+1+5+68+68+16+1+32+16+8=500`; certificate adds 214; each envelope adds two u32 prefixes and 96 bytes per signer. Refund intent is four bytes shorter. All four documented domain hex strings independently equal their ASCII names plus exactly one NUL. Canonical Base64, bounded preallocation length parsing, exact slices/re-serialization, account roundtrip, invalid tags/versions and trailing-byte rejection are consistent. Bound the outer JSON argument as well, since generated JSON decoding may allocate before Base64 checks. Strict Ed25519 host/key/scalar behavior and cross-language signed vectors remain prerequisites; arithmetic checks do not verify signatures.

### 4. Full-spec consistency, quorum, state and migration

Exhaustive Python enumeration confirms minimum intersection 3 for 4-of-5. At most two malicious keys plus honest objective validation and durable sign-once journals prevents conflicting quorums; four available/cooperative members are still needed for liveness. Two unavailable/withholding members can halt recovery forever. Shared faults remain a trust assumption. Journals must persist before releasing signatures and survive parallel processes and backup restore. Exact canonical origin/block selection must agree across operators so equivalent interpretations do not split signatures across different digests.

Rotation boundary is cancellation strictly before activation time and permissionless activation at/after; active epoch changes on actual activation, not passage of time alone. Retain pinned historical keys until their pending count is zero; do not prune the active epoch merely because it has zero current pending transfers. Initial epoch configuration needs initializer-funded keyset/registry/config/credit records under the general admission-funding rule. Define initial epoch numbering/count in implementation vectors so 32 means 32 total epochs including the initial epoch. Raw activated key storage maxima are 5120 bytes registry plus 5120 keysets, excluding overhead and caller-funded credits. Key loss and exhausted capacity have no administrative escape.

Current code confirms `next_transfer_id` is the last allocated value despite its name: creation uses checked +1 and stores the result. Design `last_allocated_transfer_id` must map to it, preserving maximum historical allocation. Existing v2 sidecars bind asset/amount/recipient/chain/core but do not contain the new recovery genesis/instance/committee binding. They remain recovery-ineligible; migration cannot invent eligibility. A fresh instance cannot recover another deployment's liabilities. Upgrade authority remains capable of bypassing all of this and needs a separate governance decision.

Inspected callbacks at `contract.rs` on_tranche_transfer/on_refund_transfer and helpers require matching pending state and exactly one explicit promise result. TooLong successful return data remains success; unknown counts remain pending. Missing/mismatched token sidecars do not become native payment. Current token JSON has no proposed memo, current callbacks are separate paths, and there is no proposed recovery verifier/event/credit implementation. One shared internal settlement function is therefore a future requirement. Callback-first/recovery-first must consume one intent, remove one reservation and decrement precisely its epoch once; late callbacks cannot consume a retry's fresh ID.

Origin event→unique direct child, exact predecessor/receiver/action/memo/deposit/gas/JSON checks are coherent oracle mapping rules. Failed origin receipts with tentative logs cannot authenticate outgoing work: require the actual canonical child ancestry. No transaction-wide summary, balance delta, child failure or timeout substitutes for exact receipt outcome. Unknown/conflicting evidence writes nothing. The mutable-hash language in the annex is constrained by the design's fixed initial registry and separately reviewed future configuration-upgrade path; it grants no current permission to edit that registry.

### 5. Acceptance coverage and exact gate scope

This verdict permits specification reconciliation, planning, vector preparation and bounded offline evidence work. It is conditional design approval, not permission to skip the design's own pre-implementation prerequisites: resolve V3-1/V3-2, publish cross-language recovery/governance vectors, select strict host-verifier behavior, and establish the required protocol-88 rollback fixtures before verifier implementation begins. Then implementation may proceed behind a feature gate under separate authorization. No network recovery registry is approved or enabled.

| Acceptance family | Evidence actually established here | Remaining gate |
| --- | --- | --- |
| Bytes/domains/limits/quorum | Independent arithmetic and enumeration | Cross-language signatures, malformed JSON/Borsh/Base64, weak keys/scalars, 0–5 signatures, bounded allocation |
| Receipt/finality/code order | Pinned source interpretation | Local validated replay and all annex fixtures; A/B same-chunk order, no-code/pre/post-execution failure, globals, archive gaps, nonfinal/source conflict |
| Token code semantics | Candidate observations inspected only | Separate provenance and synchronous exact-delivery code review for each hash; mainnet receipt fixture |
| Settlement | Current callback source only | Both kinds/outcomes and both callback/recovery orders; duplicate/conflict/cross-ID receipts, late retry; unchanged state on rejection |
| Credits/native solvency | Negative numerical model; preallocation review | V3-1/V3-2, native pending/refund delivery matrix, many payers, current byte price, reserve, authorization and callback races in VM |
| Rotation | Consumed-generation reasoning | Signed replay/cancel/successor fixtures, activation boundary, overflow, 32-epoch cap, key non-reuse/pruning and old-epoch recovery |
| Migration | Existing last-ID and v2-sidecar source | In-place live upgrade, legacy exclusion, mixed/malformed/interrupted migration, instance/counter/generation and terminal continuity; stale restore refusal |
| VM/gas | No recovery execution | Maximum valid/invalid envelopes, four/five signatures, each write boundary and OOG rollback, storage measurements and margin |
| Operators | Requirements inspected | Five independent owners, funded archives, sign-once crash/backup drills, one-offline progress/two-offline pending, lost historical keys |
| Release/artifacts | Historical supplied evidence only | Independent implementation review, isolated Sandbox, proposed disposable canary, exact new artifact reproduction; separate testnet upgrade and mainnet owner gates |

Existing callback harness tests OOG preservation, explicit failure/retry and four concurrent equal transfers, not recovery. Historical callback artifact reproduction cannot approve new recovery bytes. No design verdict here implies implementation, artifact, canary, release, deployment or mainnet approval. If a required fixture or liability cannot be established, retain the reservation and report the blocker.

## Input identities and final verification

Manifest SHA-256: `f6742d2a28fee36ce0e1730e09eccaf4a2cb86e81b6309fa5f70b934eedcdbe2`.

| Input | SHA-256 independently verified |
| --- | --- |
| `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` | `3660c9887540704c4610cd81ddeaef0724c465b89669a91341bff8dde189f406` |
| `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md` | `ed0dac7e000c94c5a71af4508d94fb3d3df64600c6ff4c13036fee94be2f6438` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V3-REVIEW-BRIEF.md` | `f21e2902e2e6ba7c7e588ff34845c028f1279bac95511df9ed0214ad417b8c4d` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW.md` | `a89fbbfacf9555704e544746c43bd120ae15f7afb180f994ad8a4fe9b28d2da6` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW-BRIEF.md` | `d88f6d41a552708fb2dc3fd2a3f5b821262f742870a6b84512d5f61acf88f31a` |
| `audit/p2-receipt-recovery-2026-11-15/spec-v2-review-manifest.json` | `a8cdc0c32b4eb294fed4bc9f5eb1e3ed29ce5cd339f88997c913b8ada28fba63` |
| `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-REVIEW.md` | `016e7819145a4a529b0b41e3f662f01391f21634fe3c39890abf4f7ac4b5c80c` |
| `P2-USDC-RECEIPT-RECOVERY-AUDIT.md` | `e8658be9c3afd95416313bd309a6e8c61ec030cfd9dc152e8028aa79f3187928` |
| `P2-USDC-INDEPENDENT-AUDIT-REPORT.md` | `f331de22899a7017d6a8698fae997d85296fc0840abd5ebdb5bbc42be6df54ff` |
| `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md` | `c3f5196123e1a36b8b4e822ca0e690f469e0e88b35bef43f6f49735ac3f0c01b` |
| `P2-ASSET-ARCHITECTURE.md` | `e3323c1c31894de6ea2d81246822960c6970075dd763c2be3711966a71971ff0` |
| `TODO.md` | `a9a54cb3d98d2a21375886d3df523944737bbbc46c33388ab875cf0feaccced2` |
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

Final pre-completion recheck: **22/22 hashes match**, no mismatch and no changed input silently substituted. Only `P2-USDC-RECEIPT-RECOVERY-SPEC-V3-REVIEW.md` was intentionally created/written. Open dependencies are the two Medium specification changes, vectors/strict-verifier policy, protocol fixtures, token provenance and all subsequent implementation/operational/release gates above.
