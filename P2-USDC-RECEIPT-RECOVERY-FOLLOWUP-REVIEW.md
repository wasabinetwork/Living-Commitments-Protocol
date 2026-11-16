# Independent automated USDC receipt-recovery follow-up review

Date: 2026-11-15. Reviewer: OpenAI Codex, GPT-Sol (`gpt-6.1-sol`). The actual Orca worker projection returned provider `codex`, model `gpt-6.1-sol` for this dispatch; identity is taken from that runtime record rather than inferred from the requested model. This is a fresh dispatched session without the coordinator conversation, with no helper agents. Shared filesystem and supplied historical reports remain sources of context; isolation is conversational, not independent hardware or institutional independence.

Worker session: `orca_session_id:6c969a1f-2587-4bed-9621-22943fd7b163`; coordinator: `orca_session_id:codex_f100d52e_cb55_4928_b1b9_685cb9036031`; task: `task_9d475fcf162e`; dispatch: `ctx_010ed50319a9`; run: `run_eb98c6f4c0e8`.

## Verdict

**Approve with required changes.** The threshold-oracle approach is viable in principle, but this document is not yet an executable verification specification. Resolve F1–F4 below before treating PR-1–PR-3 as closed or authorizing verifier implementation against a frozen specification. Retain uncertain reservations pending throughout. There is no implemented recovery verifier, certificate entry point, or shared callback/recovery settlement path. Design approval does not approve implementation, deployment, release acceptance, or mainnet.

Findings: **2 High, 2 Medium; no Critical finding**. These are design blockers and acceptance requirements, not demonstrated exploits in a deployed recovery method.

## Identity, methods and evidence boundaries

HEAD independently read: `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`, matching the manifest baseline. The worktree is dirty, as declared; unrelated modifications/deletions/untracked files were preserved. Read the brief and manifest first, then all listed substantive materials, Cargo/package configuration, callback helpers, transfer creation, and relevant tests. Package-lock identity was verified bytewise; dependency internals were not individually audited.

Independent checks actually run:

- Python SHA-256 verification of all 15 review inputs and both Sandbox WASM artifacts; all matched. A second pass after source inspection also found no discrepancy.
- `cargo test -p lcp-core --locked`: **82 passed, 0 failed**, plus 0 doc tests. Six deprecated test-helper warnings appeared; no test failure. Tests use the pinned repository toolchain and local mock runtime, not validator receipt execution.
- `node --check tests/sandbox-usdc-callbacks/run.mjs`: exit 0.
- Exhaustive Python enumeration of committee subsets: minimum intersection is 1 for 3-of-5, 3 for 4-of-5.
- Read-only git identity/status, source searches and manual state-transition/race analysis; official primary-source web inspection for Borsh and NEAR receipt/outcome semantics.
- `orca orchestration worker-list --json --full --limit 10` confirmed the actual model and dispatch identity.

The Sandbox harness was inspected but **not executed in this session**: its stated pass is supplied evidence, consistent with its assertions and matching artifacts. No recovery exists to test. No WASM rebuild, npm vulnerability audit, historical reproduction, testnet replay, issuer experiment, or independent committee deployment was performed. No blockchain transactions, wallet/committee keys, funds, issuer controls, deployments, or contract changes were used. Historical live balances and gas figures in the supplied follow-up were not reverified here.

## Prioritized findings

### F1 — High: canonical signed bytes are still underspecified

Location: design, “Certificate binding,” opening hash expression and numbered fields.

Borsh is canonical for a **specified type**, not for prose listing fields. Widths of version/epoch/height/index, enum ordinals, optional tranche epoch, account and chain encoding, fixed hash versus string encoding, signature envelope and intent-hash schema are not frozen. The displayed domain includes escaped backslashes before zero; independent implementers could choose a NUL byte, backslash-plus-zero, or two backslashes. This can prevent quorum formation; permissive compatibility decoders can also create replay/domain ambiguity.

Required remediation: publish normative ordered structs, exact integer widths and little-endian encoding, fixed `[u8;32]` hashes/keys and `[u8;64]` signatures, transfer-kind/outcome discriminants, `Option` encoding, account validation, exact domain **hex bytes**, intent hash construction and certificate hash definition. Specify Ed25519 over the 32-byte SHA-256 digest with no additional prefix/prehash. Pin verifier behavior for malformed/noncanonical keys/signatures, duplicate keys in committee configuration, unsupported versions, trailing bytes and length bounds. Bound the envelope before decoding and count unique authorized public keys, not supplied signer indices. Bind rotation messages under their own domain including old/new epochs, complete next keyset and activation time.

Scenario: signer software serializes amount as decimal text while verifier uses u128; an implementation adds fallback verification paths, weakening domain guarantees. Regression: cross-language golden vectors for bytes/digest/signatures; mutate every field, domain byte and enum; reject trailing bytes, invalid UTF-8/accounts, overflowing lengths, repeated keys, bad signatures, unknown versions and mixed-message signature aggregation without any accounting write.

### F2 — High: attestor receipt interpretation lacks a normative decision procedure

Location: design, “Certificate binding,” points 2–4 and attestor verification paragraph.

The certificate now names origin and token receipts, full intent, predecessor/receiver, action index and finalized result. This substantially improves PR-1, but the attestor procedure does not establish how an originating receipt is selected and mapped uniquely to an intent when one origin schedules multiple identical actions. An asserted origin ID or supplemental memo alone does not enforce that mapping. Attached deposit, number of actions, argument decoding/duplicates, action batching and returned-promise semantics remain unspecified. The phrase “terminal outcome” risks following `SuccessReceiptId` to a failing downstream receipt after the token already changed balances.

Scenario: token action commits delivery and returns a promise which later fails; an operator signs Failure from the downstream terminal result, freeing already-paid escrow. Another scenario assigns a failed identical transfer to a different attempt because all compared semantic arguments match. These are conditional integration hazards, not evidence the current allowlisted token exhibits this behavior.

Required remediation: define an operator algorithm tracing a finalized origin operation to the exact generated receipt/action and unique intent, with explicit one-action-only constraints for v1 (recommended), exactly one yocto deposit, exact method/recipient/amount and memo/attempt correlation when present. Require independently validated receipt ancestry/content against each operator's canonical chain, not common RPC assertions. Define how an origin emitting multiple transfers maps each action to its ID, or forbid that shape. Restrict token behavior to reviewed synchronous NEP-141 transfer semantics; reject delegated/ambiguous outcomes unless a separately reviewed procedure proves no prior delivery. Failure of the exact atomic token action receipt can justify release under those semantics; callback failure, missing receipt, transaction summary, absent log or downstream promise failure cannot. Treat nonfinality, provider disagreement and unsupported token versions as Unknown.

Regression: identical transfers within one origin, across commitments/attempts/deployments/senders; substituted args/predecessor/token/method/deposit; multiple actions; failed token receipt with no log; token success followed by failed callback; token success returning a failing promise. Only the exact intended atomic transfer result may settle.

### F3 — Medium: committee trust and lifecycle need implementable operating rules

Location: design, “Proposed v1 trust model” and “Committee lifecycle.”

The oracle assumption is honestly explicit. With at most two malicious keys and every honest operator validating the same objective canonical outcome, 3-of-5 cannot certify a false outcome: every certificate contains an honest signer. It is **not** a Byzantine consensus protocol tolerating two Byzantine participants plus inconsistent honest observations. Quorums `{A,B,C}` and `{C,D,E}` intersect only at C; if C equivocates and the other operators disagree about finality/interpretation, contradictory certificates are possible. Atomic first-wins accounting does not choose the true outcome. Even 4-of-5 does not remove common-provider or common-client errors.

I recommend 4-of-5 for higher-value escrow if two-key Byzantine quorum intersection is desired, accepting that only one unavailable signer is tolerated. A deliberately bounded pilot may retain 3-of-5 with explicit owner acceptance of the stronger honest-validation assumption, exposure limits, independently administered nodes/data and clients, and a sign-once journal. Three compromised retained old keys can forge outcomes forever while an old epoch has pending transfers; the seven-day rotation delay does not revoke that authority. Lost old keys likewise cannot be replaced by the current committee under the pinned-epoch rule.

Required remediation: pin network/genesis and finality verification policy per operator; define disagreement/equivocation abstention and incident procedure, independent operator ownership evidence, secure retention/backups for historical keys, durable signing journals, quorum monitoring and archive retention. Define unique epoch numbering, one active rotation proposal, signed exact activation deadline, boundary behavior, concurrent proposal cancellation, and prohibition on epoch/key reuse. Retained epoch keys must remain authorized for their own pending records despite the wording “currently authorized.” Explicitly document unavailable/compromised epoch handling as permanent pending absent a new separately reviewed trust mechanism. Delay is a notice interval, not proof an attacker cannot rotate.

Regression: duplicate key registered twice, two conflicting quorums, two/three lost keys, retained old certificates after rotation, old-key compromise, activation at delay minus one/exactly delay, competing rotations, reused epochs and network/genesis disagreement. No single administrator override.

### F4 — Medium: resource and migration acceptance budgets are absent

Location: design, “Atomic settlement design,” legacy paragraph and “Current validation and open gates.”

The synchronous atomic settlement architecture is sound as a requirement, but gas/storage limits, certificate bounds, storage payer/refund policy and migration gates are deferred. Oversized signature/field vectors can consume gas before verification; a migration that resets ID or instance state can make a consumed ID usable again. Existing local v2 intents do not include recovery genesis, persistent instance, committee epoch or recovery intent hash and must not be assumed recovery eligible merely because they are called v2.

Required remediation: freeze bounded certificate size and signature count before implementation; benchmark worst-case valid and invalid verification in the NEAR VM with margin, including rollback on OOG after attempted writes. Define storage funding for new intents/retained epoch keys/counters and archive availability costs. Specify migration to preserve ID monotonicity and instance identity, counter reconciliation from existing eligible records, and fail-closed handling of all pre-recovery records. Do not make missing new sidecars mean legacy native transfer. Freeze a fresh instance on reset/redeployment; an upgrade preserving pending records must preserve their instance. Audit upgrade authority as a separate trusted boundary capable of bypassing any verifier.

Regression: max-size valid envelope, oversized/truncated inputs, five invalid signatures, low gas at every settlement write boundary, insufficient storage deposit, missing/malformed/mixed sidecars, interrupted migration, transfer counter overflow/reset and restored stale state. All rejected transactions preserve accounting and pending records; persistent counters decrement once.

## Seven required assessments

### 1. Receipt linkage

**Conditionally sufficient concept, incomplete protocol (F2).** Three signatures can bind an exact tuple as an oracle claim; LCP cannot independently determine that the tuple represents the chain. The design includes chain/genesis, account/instance, attempt, full intent, receipt/action and finalized block. Honest operators still need an unambiguous origin-to-intent-to-action algorithm, especially for identical transfers. A failed exact receipt needs no token log. Different LCP deployments, unrelated senders and another token must be rejected through both signed-domain comparison and provenance validation. No authenticated receipt linkage exists in the present callback-only implementation.

### 2. Trust and finality

**Explicit but operationally incomplete (F3).** Finalized block hash/height fields are assertions, not finality verification. Each signer must validate canonical genesis and finality and abstain on conflicts/reorg uncertainty. An old finalized outcome for an exact still-pending intent should remain admissible; arbitrary expiry would sacrifice recovery liveness. Signatures must all verify against one identical canonical digest and distinct authorized keys of the pinned epoch. Safety after committee compromise and liveness after permanent key loss are not provided by cryptography. Recommendation and threshold tradeoff are in F3.

### 3. Signature/certificate format

**Not yet canonical at protocol level (F1).** Required semantic fields are mostly appropriate; actual ordered Borsh types, enums, bounds, hash recipe and domain bytes are missing. One epoch is committee epoch and another tranche epoch; encode and name them separately. No free-form JSON number may represent raw amounts. Account ID alone does not identify a contract incarnation; instance ID plus genesis must be stored and compared, not accepted from a certificate.

### 4. Settlement races

**Sound proposed arbitration; no executable recovery evidence.** Synchronous verification followed by one atomic pending-record consume serializes callback-first/recovery-first calls. Duplicate or contradictory terminal certificates cannot change a removed pending record. A failure followed by retry must allocate a new ID; a late callback for the old ID cannot consume the new one. Receipt reuse across two IDs remains dependent on F2's one-to-one provenance: pending deletion alone does not prevent false attribution of a different ID. Tombstones are unnecessary only if IDs/instances cannot be reused across restoration or migrations. No asynchronous external verifier should be introduced without a nonce and final reread. Byte-for-byte unchanged state on rejection is a required contract property, not established by this design review. A conflict discovered before settlement remains pending; a conflict after settlement cannot reverse the first result safely and must trigger incident handling.

### 5. Failure semantics

**Source-confirmed local hardening, with token-semantic assumption.** Current `callback_promise_succeeded` at contract.rs:4588 requires exactly one result; Failed alone returns false, unknown contexts return None. `TooLong` represents successful result bytes beyond the inspection bound, correctly treated as success; a NEP-141 transfer return value is not a verdict payload. `callback_transfer_amount` at :4456 rejects zero native amount with absent token state, inconsistent/missing versioned records, mismatched intent and policy digest. Malformed settlement deserialization can panic, which rolls back rather than releasing escrow. Claim/refund/operations callback paths use the helper. Missing commitment state can panic; it is not proof of failure.

This directly supersedes the earlier PR-4 observations for this hashed source. Independent rerun passes zero/multiple-result helper tests, missing settlement for claim/refund, amount/intent mismatch and legacy callback continuity. The existing local v2 sidecar binds chain/account, amount, asset, recipient, kind, commitment and epoch, but is not the proposed recovery certificate intent. Arbitrary state corruption or a malicious upgrade is outside these guarantees. A certificate of failure proves nonexecution only by trust in the committee's exact receipt interpretation and the reviewed atomic token semantics (F2), not by signature mathematics alone.

### 6. Operational feasibility

**Plausible, unmeasured.** Planning estimate under a compact proposed schema: eight 32-byte hashes/identifiers (genesis, instance, intent, origin, token receipt, block and comparable identifiers) are about 256 bytes; account strings and fixed numeric fields yield roughly 0.4–0.8 KiB certificate body, plus 192 bytes for three signatures and signer identifiers. Budget approximately 0.6–1.2 KiB binary, with base64/JSON overhead additional; exact sizes depend on F1. Five stored keys are 160 bytes before metadata/storage keys. A new full pending intent likely needs a few hundred bytes plus map overhead. At a *hypothetical* storage price of 10^19 yoctoNEAR/byte, 500 bytes costs 0.005 NEAR; query the actual protocol price when implementing rather than treating this estimate as a verified current constant.

Gas model is bounded decode + SHA-256 + three (or four) host Ed25519 verifications + state reads/writes/events. No honest Tgas estimate can be validated without chosen schema and NEAR VM measurement; provision a configurable benchmark target (e.g. 30–50 Tgas for investigation), not an asserted safety limit. Existing 3.24 Tgas ordinary callback samples exclude signature verification. Caller pays gas for invalid submissions; protocol must not subsidize them or leave partial storage. Reject bounds before verification and cap keys/signatures at committee size.

Operators need archival receipt bodies, originating operation data, generated receipt graph and finalized outcome evidence retained indefinitely for unresolved epochs. Five independent operators using the same free RPC are not five independent chain observations. No archival availability/SLA, operator roster or sustainable signer service was demonstrated. The Console must show pending liability, token may already be paid, reason for inability to recover, and committee/legacy limitations; no retry that releases uncertain value. Legacy pending transfers can remain blocked indefinitely. These prerequisites and F1–F4 block an implementation-ready specification.

### 7. Acceptance tests

The following matrix is a concrete gate. “Supplied Sandbox” means the matching harness asserts it and prior supplied execution says it passed; this session did not rerun Sandbox. “Independent unit” means this session reran existing tests, not that it authored them. Every recovery row remains untested because the verifier does not exist.

| Case | Required acceptance | Current coverage |
| --- | --- | --- |
| Token success + callback OOG at 2 Tgas | Token delta once; pending unchanged; no free release | Supplied Sandbox claim fixture |
| Exact token failure, then retry | Failure frees once; new ID; successful payment once | Supplied Sandbox; independent unit claim/refund |
| Four identical amounts, distinct commitments | Correct per-ID ledger and aggregate recipient delta | Supplied Sandbox; no certificate association tested |
| Zero/multiple callback results | Pending/count/sidecars unchanged | Independent unit helper; zero-result claim |
| Missing settlement, malformed/partial amount/intent, wrong asset/digest | No native fallback or terminal transition | Independent unit subset; complete matrix required |
| Valid recovery Success/Failure for claim and refund | One terminal event, correct ledger/count, remove exact intent | Untested; implement Sandbox all four |
| Wrong chain/genesis/account/instance/schema/epoch/kind/amount/recipient | Reject before ledger writes | Untested; field-by-field signed mutations |
| Canonical bytes/signatures | Rust and signer golden bytes/digest; unique authorized quorum | Untested; 0–5 signatures, duplicate indices/keys, mixed digests |
| Malformed envelope/keys/signatures/lengths/trailing bytes | Bounded gas/decode; no mutation | Untested; fuzz/property suite and VM limits |
| Identical attempts/senders/origins/deployments | No receipt cross-association | Untested; separate successful and failed attempts |
| Wrong receipt/method/deposit/action index/batched actions | Never certify or settle unsupported shape | Untested; signer fixtures plus contract checks |
| Failed receipt without token log | Exact finalized atomic failure eligible; no log inference | Untested |
| Delegated promise failure after delivery; callback failure | Remain pending, never certify token Failure | Untested; adversarial token fixture |
| Callback-first/recovery-first × success/failure | Exactly one consume and counter decrement | Untested recovery; callback idempotency unit subset |
| Duplicate/conflicting certificates; same receipt across IDs | No second settlement; wrong binding rejected | Untested recovery |
| Old callback/certificate after failed attempt and retry | New ID and reservation untouched | Untested full recovery sequence; existing ID guards source-confirmed |
| Missing pending record/terminal replay | No accounting or storage write | Callback duplicate unit subset; recovery untested |
| Rotation and retained epoch | Exact delay, authorized unique keys, old pending recoverable | Untested |
| Lost/compromised committee and inconsistent finality | Abstain/freeze; no admin override; documented liveness loss | Untested operational drills |
| Legacy v1/current local v2 migration, reset/restore | No unsupported certificate recovery; preserve IDs/instance/counters | Legacy callback unit subset; migration untested |
| Max input/low gas/storage shortage/overflow | Atomic rollback; bounded invalid cost; valid margin | Untested VM recovery benchmarks |
| Permanently pending UI and archive outage | Clear reason and no unsafe retry/release | Untested |

## Primary-source checks and assumptions

Borsh explicitly depends on declaration order and exact types, with little-endian integers and u8 enum ordinals; citing Borsh alone cannot supply the missing schema ([Borsh specification](https://borsh.io/)). NEAR separates action receipts and result/data dependencies ([nearcore receipt runtime specification](https://github.com/near/nearcore/blob/master/docs/RuntimeSpec/Receipts.md)). Its execution status distinguishes Failure, SuccessValue and SuccessReceiptId; a returned promise is not equivalent to an atomic token action's failure ([nearcore execution-status definitions](https://github.com/near/nearcore/blob/master/core/primitives/src/transaction.rs)). These official sources were consulted read-only; master references are mutable and must be version-pinned for implementation. This review does not claim validation of NEAR finality proofs or Circle token code.

PR-1 is improved but conditional on F2, PR-2 is an explicit selected oracle model requiring F1/F3, and PR-3 has a reasonable atomic architecture requiring F4 and actual verifier race tests. None is an implemented-security closure. Unknown outcomes must retain their reservations.

## Exact input identities

Manifest SHA-256: `bf3824648bea1db4defee2b4847066a758ad3af4643d91b96cb841f2fd7fe542`. All input and Sandbox artifact hashes matched; **no discrepancy found**. Hash matching establishes file identity, not source-to-WASM reproducibility or correctness.

| Input | Independently computed SHA-256 |
| --- | --- |
| `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` | `b828595d45cc2a783a86ac61958139b7246fc480e905a5b60c8fc897eaee87ba` |
| `P2-USDC-RECEIPT-RECOVERY-AUDIT.md` | `e8658be9c3afd95416313bd309a6e8c61ec030cfd9dc152e8028aa79f3187928` |
| `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-BRIEF.md` | `80bf39bde36920dc5e5d08d2e7f50d91134f6e9dc12349a6659abd3e7e5f84f0` |
| `P2-USDC-INDEPENDENT-AUDIT-REPORT.md` | `f331de22899a7017d6a8698fae997d85296fc0840abd5ebdb5bbc42be6df54ff` |
| `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md` | `e5e9dba2ebdfbc5c86405ed1c3aaedf36bd68bbde7f00a1dbfba46594d187ab7` |
| `TODO.md` | `68c187e2ab38da57dd501d2bd2d20f47edcf0b15877c3aa0440066ed87e9a6e4` |
| `contracts/lcp-core/src/contract.rs` | `aa2cf07e8e8b1782a20be576fff19771de2b498560563fe444d2878eb7581b28` |
| `contracts/lcp-core/src/models.rs` | `220f21be25a1d93e56588693f063213ec20cf5a1da79682aa9137faa9e475603` |
| `contracts/lcp-core/Cargo.toml` | `db5377ddaecf04182ed6838b76a837d459e45d579544826d837b9b60b3a25c22` |
| `contracts/sandbox-mock-ft/Cargo.toml` | `58e44ef7934350d29b5733318c755cbba77eda3a9742cf42f732807f2a788eed` |
| `contracts/sandbox-mock-ft/src/lib.rs` | `3e62024a827f997ea66ad7e43e72b6dc924320d0c527d94bcc93f8b6df9f6933` |
| `tests/sandbox-usdc-callbacks/run.mjs` | `535db5cec8e9a4bc9f6281067f6d35a6ae2dc70bcfda28be438e7a5a81f32038` |
| `tests/sandbox-usdc-callbacks/README.md` | `bd22206bf2486c4e0635ac84546442d1741da622c29f4aae57428c3d24c1e481` |
| `tests/sandbox-usdc-callbacks/package.json` | `d5146dfb2f994d660935955a0ea10c80efcd9377a8ed480225d7c2e25ead6548` |
| `tests/sandbox-usdc-callbacks/package-lock.json` | `c14ba6bb421a3bc4c14909ba301c7e49a7e46ba5cf16c39fa097caaff6d6e39e` |
| `target/wasm32-unknown-unknown/release/lcp_core.wasm` | `c4b1efaae783c2573867e39bdda7f490b1b8fd4ef1299c5d0c1c8a8c7ac9236f` |
| `target/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm` | `4e9e95bdb5ee86f220f732950d77d56e0c0a56138bfeb26567e0f803caa6f79a` |
