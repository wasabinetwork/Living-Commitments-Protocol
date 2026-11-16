# Independent automated review of receipt-recovery specification v2

Date: 2026-11-15. **Verdict: approve with required changes.** Findings: **0 Critical, 0 High, 3 Medium** specification findings. Resolve V2-1–V2-3 and publish the already-required vectors/verifier-policy decisions before treating the specification as frozen for implementation. Keep uncertain liabilities pending. This verdict does not approve an implementation, artifact, testnet canary, deployment, or mainnet release.

## Attribution and evidence boundary

Reviewer: OpenAI Codex. Requested model: `gpt-6.1-sol`; actual Orca execution-host projection independently queried with `orca orchestration worker-list --json --full --limit 10` reports provider `codex`, model `gpt-6.1-sol`, host `local` for this dispatch. This is runtime metadata, not a hardware attestation. Worker session `orca_session_id:23ef933f-bed3-4064-8b92-bb1ff74bd930`; Codex session `01a1e085-dc6b-7b73-859f-edbb757374cc`; task `task_a040ae53515d`; dispatch `ctx_637a56d2bb39`; run `run_eb98c6f4c0e8`; coordinator `orca_session_id:codex_f100d52e_cb55_4928_b1b9_685cb9036031`.

This fresh dispatched conversation did not receive the coordinator's conclusions. It shares the filesystem, local tools, historical reports and execution host; independence is conversational and analytical, not independent hardware, operator ownership, or a signed security-firm audit. No helper agents were used.

HEAD: `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`, matching the manifest baseline. Dirty inputs were reviewed as manifested, rather than treating HEAD as their entire identity. The brief and manifest were read first. All 16 input SHA-256 values matched before review; none was substituted. Manifest SHA-256: `a8cdc0c32b4eb294fed4bc9f5eb1e3ed29ce5cd339f88997c913b8ada28fba63`. Exact input identities appear below.

Methods: review of the design, prior findings and follow-up history, asset architecture, relevant TODO acceptance claims, contract transfer creation/callback/storage helpers and models, mock token, Sandbox harness/configuration; manual receipt/race/rotation/storage analysis; independent mathematical size/domain/quorum checks; primary-source NEAR inspection. Large source/context outputs were narrowed to relevant sections after tool truncation; this is a focused recovery-specification review, not an exhaustive audit of unrelated evaluator, Console, or contract functionality. Package-lock was hash-verified as input identity, not a dependency security audit.

Independently executed checks:

- Python SHA-256 comparison for every manifested input, plus manifest identity and git HEAD.
- `cargo test -p lcp-core --locked`: **82 passed, 0 failed**, 0 doc tests; six deprecated test-helper warnings. This reruns supplied tests, not independently authored recovery tests.
- `node --check tests/sandbox-usdc-callbacks/run.mjs`: exit 0.
- Python field-width summation, Base64 bound calculation, all four ASCII-plus-NUL domain hex comparisons, and exhaustive 4-of-5 quorum subset intersections: all agree with the design.

No Sandbox execution, recovery implementation, historical artifact rebuild/download, live token-code audit, finality-proof validation, issuer experiment, key access, funds, blockchain transactions or deployment occurred. Prior Sandbox and live-test results are supplied evidence only. A historical reproducible callback artifact cannot verify recovery that it does not contain.

## Prioritized findings

### V2-1 — Medium: execution-time token-code evidence remains an unspecified operator dependency

Exact locations: “Receipt-to-intent decision procedure,” opening paragraph and step 5; “V1 committee and trust assumptions,” version-pinned finality procedure; “Canonical wire format,” intent field 13.

The policy correctly requires the code hash **at execution** and abstention otherwise. It does not yet identify a supported node/protocol version, an evidence extraction procedure, or a pinned audited Circle bytecode/hash per network. A historical block account/code query returns a block state, not by itself the contract attached immediately before a particular action. Scenario: a receipt executes under code A and another receipt upgrades to B in the same chunk; post-block code B is insufficient to classify the former receipt. Reversing deployment order can create the opposite mismatch. Honest operators can therefore disagree or permanently abstain even with archives; accepting a convenient block hash risks false certification if an unreviewed implementation returns success without exact delivery.

Required change: publish an operator-policy annex that names the actual supported nearcore/protocol versions, exact approved code/hash, source of per-action execution code evidence, receipt order and state-replay fallback, including how failed actions that never execute code are handled. Explicitly compare observed execution code to the stored intent hash, rather than today's mutable configuration. If necessary use local archival deterministic replay with the deployed protocol configuration. Forbid substitution of latest/pre-block/post-block account views. Specify whether historical transfers under an earlier approved hash remain recoverable after a later upgrade; an unsupported execution stays Unknown. The on-chain certificate remains an oracle assertion, not a code-execution proof.

Regression/acceptance: two same-chunk orders (A transfer then deploy B; deploy B then transfer), historical approved A after current B, missing replay data, failed pre-execution receipt, unsupported/global contract representation, and provider disagreement. Operators must independently produce identical evidence or abstain. Block signer-policy completion before canary and freeze the supported policy before verifier implementation.

Primary-source basis: [NEAR account/code RPC](https://docs.near.org/api/rpc/contracts) exposes block-addressed state/code queries. Current [nearcore execution definitions](https://github.com/near/nearcore/blob/master/core/primitives/src/transaction.rs) include execution-metadata V4 with per-action attached-contract information, which is a promising evidence source, but this review did **not** establish availability or semantics on the intended network/version. Do not assume mutable master features exist in the deployed protocol; pin and validate the actual implementation.

### V2-2 — Medium: refund-credit storage and withdrawal liabilities are not fully funded or specified

Exact locations: “State, storage, migration, and atomic settlement,” third bullet; “Committee rotation and retained epochs,” final paragraph.

Measured growth for an intent/proposal is necessary but does not by itself fund later persistent pull-credit records and withdrawal bookkeeping. Scenario: cancelling a proposal refunds its entire temporary bond while creating a new payer credit entry, and repeated distinct payers leave outstanding credit records. The new credit consumes storage and represents a NEAR liability simultaneously; refunding all deleted bytes without reserving credit storage either subsidizes growth from operations funds or makes terminal operations fail under low liquid balance. The same issue applies when settling the last intent and refunding its bond. The design does not define credit-record rent ownership or withdrawal failure/OOG recovery. Existing refund helpers/tests are not an implementation of this new policy.

Required change: define a measured accounting equation for configuration, proposal, epoch, registry, intent, payer-credit and in-flight withdrawal storage. Reserve credit/withdrawal overhead at admission, or deduct and retain its measured bond from refundable value with a specified final release rule. Identify who funds initial keyset/registry/counter metadata, and prevent refunding commitment storage twice through both old and new accounting. Define authenticated pull withdrawal, atomic debit/reservation, single-use callback, failed-transfer recredit, and unknown callback handling. Ensure token settlement never needs a new unfunded storage allocation or successful NEAR refund. Specify original monetary bonds versus current byte price and who funds a price increase.

Regression/acceptance: minimum-deposit creation and terminal settlement for a previously unseen 64-byte payer; many cancelled proposals with distinct payers and unclaimed credits; repeated settle/withdraw/retry; deleted recipient account; withdrawal callback failure/OOG; storage-price change; unchanged token accounting on refund failures. Assert liquid NEAR covers bonded storage plus outstanding refundable liabilities separately from operations funds. Benchmark these cases in the VM.

### V2-3 — Medium: cancelled-proposal replay prevention has no bounded persisted mechanism

Exact location: “Committee rotation and retained epochs,” cancellation paragraph (“pending slot is then free” and “Repeated, competing, reused, or stale epoch proposals are rejected”), and final storage/cap paragraph.

The rejection requirement is explicit, so this is an implementation-specification gap rather than an assertion that replay is authorized. Scenario: quorum signs a far-future activation; the proposal is submitted and cancelled well before that date. Its original signature bundle still satisfies the seven-day admission check for some time. If cancellation only deletes the pending slot, any holder can resubmit it, reversing cancellation and obstructing a replacement. Remembering every cancelled digest solves replay but admits an unbounded history within one active epoch; the 32 activated-epoch cap does not bound cancelled proposals or their storage.

Required change: choose a persisted monotonic proposal generation/nonce, bind it into proposal and cancellation signatures, and consume it on cancellation/activation; alternatively specify a bounded funded tombstone design and its safe expiry. Define replay rejection state, payer, overflow, and interaction with cancellation signatures obtained before submission. Epoch numbering alone cannot distinguish multiple cancelled proposals for the same successor. Reuse the same bounded signature envelope/strict key-validation rules for governance messages and publish their size limits and vectors.

Regression/acceptance: cancel then resubmit the exact signed bundle while its deadline still qualifies; submit competing bundle; replay cancellation against a successor; many cancellations without activation; boundary minus one/exact activation; overflow; snapshot/migration continuity. Old bundles must remain inert and persistent storage must meet a documented bound.

## Answers to the five required question groups

### 1. F1: canonical bytes, signatures and maximum lengths

**Substantially closed as a schema finding.** Ordered types, enum tags, raw byte fields, endian rules, domain hex, digest construction, raw Ed25519 signing, exact-slice/trailing-byte rejection, canonical Base64, sorted distinct authorized keys and bounded allocation are coherent. Each domain hex independently matches ASCII plus exactly one NUL. NEAR hash strings must be decoded, not serialized as textual base58. `TransferKindV1` is a new wire enum; do not reuse the existing three-variant `TransferKind` blindly even though its first two ordinals currently align.

Maximum Tranche intent calculation, in field order, is:

```text
1 + (4+128) + 32 + (4+64) + 32 + 4 + 8 + 8 + 1 + (1+4)
  + (4+64) + (4+64) + 16 + 1 + 32 + 16 + 8 = 500 bytes
certificate = 1 + 500 + 6*32 + 2*8 + 4 + 1 = 714 bytes
envelope(5) = 4 + 714 + 4 + 5*(32+64) = 1202 bytes
Base64 = 4*ceil(1202/3) = 1604 characters
```

Refund intent is four bytes shorter. Four signatures reduce the maximum envelope to 1,106 bytes (1,476 Base64 characters). The caps are sufficient and tight; increasing any field or adding a tag requires recalculation. The JSON wrapper is additional transport overhead and must have an independently bounded entry-point input, because generated JSON parsing may allocate a String before the method's Base64 check. The vector length prefixes must be checked before allocation even inside a short outer envelope.

Remaining gates expressly deferred by the design remain open: machine-readable cross-language valid signature vectors, malformed/noncanonical scalar and weak-key cases, selected host verifier semantics and explicit additional checks. These are concrete prerequisites, not reasons to repeat the resolved missing-schema finding. Governance envelope limits also need V2-3 clarification.

### 2. F2: receipt interpretation and finality

**Mostly closed, conditional on V2-1.** Origin action/commitment plus the exact event and memo, unique direct-child token receipt, predecessor, receiver, one action, exact method/deposit/25 Tgas, duplicate-key rejecting exact argument set, recipient and amount provide a workable one-to-one operator mapping. Memo is correlation only; authenticated ancestry comes from the operator's validated archive. Multiple matching events/actions mean abstention, including multiple invocations batched into one LCP receipt if the mapping is ambiguous. Test failed origin receipts with tentative logs: logs alone cannot establish a committed outgoing action. No balance-delta inference is permitted.

`Failure` of the exact atomic token receipt can justify failure; a later failed callback/child cannot. `SuccessValue` is acceptable only for the exact reviewed synchronous token code, not arbitrary NEP-141 bytecode. `SuccessReceiptId` is deliberately Unknown. These distinctions agree with [nearcore status definitions](https://github.com/near/nearcore/blob/master/core/primitives/src/transaction.rs); returned promises and final action values are separate statuses. Receipt failure does not undo earlier successful receipts.

Locally validated canonical archival chain plus independent corroboration and abstention is an appropriate stated oracle policy. It still needs the named version-pinned procedure and evidence fixtures; neither an RPC `finality: final` string nor several endpoints is cryptographic verification. [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions) distinguishes inclusion, execution and finalization milestones; default optimistic execution must not be accepted as finality. This report has not verified any actual historical receipt or Circle atomic semantics.

### 3. F3: quorum safety, liveness and committee lifecycle

**Trust-model reasoning closed; lifecycle closure conditional on V2-3.** For q=4,n=5, intersection is at least `2q-n=3`, confirmed by enumeration. With at most two malicious members, every pair intersects in an honest signer, so durable sign-once over the exact digest prohibits conflicting certified digests. Objective correct validation is still required to make the single certified outcome true. This is not consensus and cannot remove shared-client/provider errors. Two withholding Byzantine members stop progress: safety under two malicious members is compatible with liveness requiring four cooperative available members; it does not promise both under two faults.

Separate administration, keys, ownership records, local chain validation, independent cross-checks, disagreement abstention, journals and indefinite archives address the earlier operational omissions as requirements. No roster or drill is supplied. Journal persistence must precede releasing a signature and survive backup restoration/concurrent signing processes. Signing once per digest is stricter than once per outcome: operators must use the same canonical origin/block representation or can split 3/2 across equivalent digests and permanently lose quorum. Add deterministic fixture agreement and crash/restart drills.

Seven-day delay and cancellation strict-before/activation-at-or-after form a coherent boundary. Transfers pin the currently active on-chain epoch until permissionless activation actually happens; time passage alone must not switch epochs. Historical keys remain authorized only for their pinned pending intents, and cannot be pruned early. Loss/compromise is permanent pending or a trust failure, not solved by rotation. Key non-reuse and 32 total epochs bound activated raw key data to 10,240 bytes across registry and retained sets, excluding metadata, proposal and credits. Exhaustion blocks future rotations, not automatically new transfers: disclose continued dependence on the last committee. Decide the exact initial epoch/count convention in implementation vectors. No emergency override is warranted.

### 4. F4: state, migration, atomicity and resources

**Replay/migration requirements substantially closed; storage closure conditional on V2-2/V2-3.** Only post-configuration complete recovery intents qualify. Current local v2 records lack genesis/instance/committee binding and remain recovery-ineligible; legacy callback compatibility is separate. Genesis/account/unique instance plus a preserved monotonic counter bind incarnation and attempt. The present counter stores the last allocated ID and creation checks `+1`; the revised phrase “counter ... greater than every transfer ID” should explicitly refer to the next allocatable value, or say last allocated counter is at least the historical maximum. Do not reset/bump it through a type reinterpretation.

A stale snapshot of the entire pending ledger cannot be made safe merely by preserving a counter: it can resurrect an already settled liability. The rule refusing recovery when continuity cannot be proven is essential. Migration must refuse stale-ledger restoration and verify liabilities/terminal history, not only a maximum ID. Fresh instance redeployment cannot inherit recovery authority for old liabilities. Upgrade authority can bypass all rules, as the design correctly states.

One synchronous verified-outcome function, first serialized pending consume, exact amount/state matching, one epoch decrement and fresh IDs on retries provide the right atomic architecture. Every rejecting/OOG receipt must roll back all writes, including refund-credit bookkeeping and events; gas charges themselves are not rolled back. Conservation alone cannot prove token custody. No recovery settlement function exists yet.

Current source independently confirms checked transfer-ID increments, immutable v2 transfer binding and `callback_promise_succeeded` requiring exactly one result; missing/mismatched token records do not become native NEAR. The callback success helper treats TooLong result bytes as successful execution rather than token failure. Claim and refund currently have their own settlement paths and outgoing JSON lacks the proposed memo/event. These are existing implementation facts, not v1 recovery compliance.

### 5. Implementation gates and acceptance coverage

**The expanded matrix is strong but not sufficient without the findings and drills above.** Freeze V2-1–V2-3 plus vectors/host-verifier policy before implementation approval is treated as unconditional. Then implement behind a feature gate, review the actual code, benchmark VM resources, and complete isolated Sandbox acceptance before proposing a canary. No current test validates recovery.

| Acceptance family | Existing independent evidence in this review | Required remaining coverage |
| --- | --- | --- |
| Callback authorization/state/result counts | Relevant source + 82 supplied core tests rerun | Full corrupt/mixed sidecar matrix in VM; legacy native continuity |
| Callback OOG, exact failure/retry, four equal transfers | Harness inspected; historical pass supplied only | Independently execute isolated harness against identified artifacts when accepting implementation |
| Canonical bytes and signatures | Width/domain arithmetic only | Cross-language vectors, weak keys, bad scalars, signatures 0–5, order/duplicate/mixed-message rejection, bounded JSON/Borsh fuzzing |
| Receipt ancestry/action policy | Manual analysis | Equal attempts/origins, tentative origin logs, wrong sender/token/action/args/memo, duplicate JSON keys, batches, no-log failure, success with failing child, delegated promise, nonfinal/conflicting archives |
| Code identity/finality | Primary-source inspection only | V2-1 execution-order fixtures, supported protocol replay/metadata, audited Circle hash and signed operator-policy version |
| Settlement races/accounting | Current callback guards only | Claim/refund × Success/Failure × callback-first/recovery-first; conflict/replay, same receipt across IDs, late old callback after retry; aggregate conservation and token deltas |
| Committee lifecycle | Exhaustive quorum intersection arithmetic | Rotation/cancel boundary races, V2-3 replay/nonce, keys/epochs 31/32/exhaustion, historical pruning, key loss/compromise, journal crash/restore and equivalent-digest agreement |
| Storage/refund solvency | Manual finding only | V2-2 credit and withdrawal cases, exact byte costs, initial registry funding, price changes, many payers, failed/OOG refunds; no double refund |
| Migration/replay | Current v2 binding source/tests | Interrupted initialization, malformed/mixed sidecars, counter overflow, next-ID convention, stale entire-ledger restore, fresh instance refusal, preserved old pending counts |
| VM budget | None for recovery | Maximum valid/invalid envelopes, four/five signature verification including worst failing position, all retained keysets, max account lengths, credit allocation/pruning, low gas at every write boundary, margin from measurements |
| Operations | Requirements only | Five independent owners, funded indefinite archives, one-offline success/two-offline freeze, source disagreement, old key loss and backup restoration; no administrator release |

## F1–F4 closure assessment

| Prior finding | Assessment for v2 |
| --- | --- |
| F1 High: signed bytes unspecified | Substantially resolved by normative schema and correct caps; vectors and strict host-verifier behavior remain expressly gated deliverables |
| F2 High: receipt interpretation unspecified | Core mapping/outcome policy resolved; V2-1 leaves execution-code evidence and supported node policy incomplete |
| F3 Medium: committee lifecycle incomplete | Threshold/independence/loss/boundaries improved and mathematically coherent; V2-3 and operational drills still required |
| F4 Medium: migration/resource budgets absent | Legacy exclusion, instance continuity, atomicity and bounded certificates resolved as requirements; V2-2/V2-3 leave storage accounting incomplete and VM evidence remains future work |

These are design closure assessments only. They do not retroactively certify prior deployed artifacts or implement fixes. No deployed recovery exploit was demonstrated. Pending uncertain transfers must remain reserved until a reviewed implementation and its operational gates are accepted.

## Exact input hashes

| Input | SHA-256 independently checked |
| --- | --- |
| `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` | `42b6e2b43fd4f0252cf7fb4e97982c7c57451baf9b23b4a63d96c47152269545` |
| `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-REVIEW.md` | `016e7819145a4a529b0b41e3f662f01391f21634fe3c39890abf4f7ac4b5c80c` |
| `P2-USDC-RECEIPT-RECOVERY-AUDIT.md` | `e8658be9c3afd95416313bd309a6e8c61ec030cfd9dc152e8028aa79f3187928` |
| `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW-BRIEF.md` | `d88f6d41a552708fb2dc3fd2a3f5b821262f742870a6b84512d5f61acf88f31a` |
| `P2-USDC-INDEPENDENT-AUDIT-REPORT.md` | `f331de22899a7017d6a8698fae997d85296fc0840abd5ebdb5bbc42be6df54ff` |
| `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md` | `440a6ddc1914fb07422fba41564c7d4eb391f1c12f408c150584d4e648fb5ebc` |
| `P2-ASSET-ARCHITECTURE.md` | `e0afd8aaf1d94e417c99bb281a363930357a2eed5279b66b8e70b976ebf048d3` |
| `TODO.md` | `0431532336a8f3d51212325e0df50d1782e3a0479e0ea468947274833bfef99f` |
| `contracts/lcp-core/src/contract.rs` | `aa2cf07e8e8b1782a20be576fff19771de2b498560563fe444d2878eb7581b28` |
| `contracts/lcp-core/src/models.rs` | `220f21be25a1d93e56588693f063213ec20cf5a1da79682aa9137faa9e475603` |
| `contracts/lcp-core/Cargo.toml` | `db5377ddaecf04182ed6838b76a837d459e45d579544826d837b9b60b3a25c22` |
| `contracts/sandbox-mock-ft/src/lib.rs` | `3e62024a827f997ea66ad7e43e72b6dc924320d0c527d94bcc93f8b6df9f6933` |
| `tests/sandbox-usdc-callbacks/run.mjs` | `535db5cec8e9a4bc9f6281067f6d35a6ae2dc70bcfda28be438e7a5a81f32038` |
| `tests/sandbox-usdc-callbacks/README.md` | `bd22206bf2486c4e0635ac84546442d1741da622c29f4aae57428c3d24c1e481` |
| `tests/sandbox-usdc-callbacks/package.json` | `d5146dfb2f994d660935955a0ea10c80efcd9377a8ed480225d7c2e25ead6548` |
| `tests/sandbox-usdc-callbacks/package-lock.json` | `c14ba6bb421a3bc4c14909ba301c7e49a7e46ba5cf16c39fa097caaff6d6e39e` |

Final input recheck: all 16 still match; no input mismatch or review blocker prevented report production. Only this report was intentionally written in the repository; build-cache effects from the authorized local test run are not source changes.
