# USDC receipt-recovery design audit

**Reviewer:** GPT-Sol in an isolated session, as confirmed by the repository owner. **Date:** 2026-11-15. Treat this as an independent automated design/code review for the project gate; it is not a signed security-firm audit certification.

**Decision: do not implement or enable recovery from this proposal yet.** Its conservation and fail-closed requirements are sound, but it is an options paper rather than a complete proof protocol. It does not yet establish exact receipt-to-transfer binding, a chosen source of finality/trust, or an atomic reconciliation interface. No recovery method is implemented, so the design gaps below are not claims of an exploitable deployed recovery verifier.

## Scope and evidence

Primary: `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` (especially lines 23–36 and 45–61). Context: the original independent audit and its implementation-team testnet follow-up. Reviewed implementation: current working-tree `contracts/lcp-core/src/contract.rs` and `models.rs` at HEAD `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`, including uncommitted comments/tests. Input SHA-256 values are recorded in [review-manifest.json](audit/p2-receipt-recovery-2026-11-15/review-manifest.json). The exact historical build check is separate and targets only commit `e9074ddced4be9dce4dd4c1061909f7869054cf1`.

Methods: manual promise/receipt and state-transition analysis; comparison with NEAR receipt and outcome-proof definitions; three added adversarial unit probes in an isolated copy of the current source; a current core-suite rerun; and a new pinned-container rebuild in a clean detached worktree. The added probes bypass generated private wrappers deliberately and do not model validator execution or verify a real cryptographic proof. No keys, funds, issuer controls, or blockchain writes were used. No recovery implementation or contract fix was introduced. The follow-up's live receipts and gas samples are contextual claims; this review did not independently replay those transactions.

## Findings

### PR-1 — High design blocker: an execution-outcome proof is not an exact transfer-intent proof

**Location:** design lines 45–50; `models.rs:159` (`PendingTransfer`); `contract.rs:2730` and `3160` (outgoing token calls).

NEAR's authenticated execution outcome identifies an outcome/receipt, executor, status, generated receipt IDs and logs. It does not itself carry the original receipt's predecessor and `ft_transfer` argument bytes. A valid outcome proof for the USDC executor is therefore insufficient to prove an LCP-origin transfer of a particular amount to a particular recipient. RPC-supplied receipt bodies do not become authenticated merely because an outcome proof is valid. See the [NEAR proof guide](https://near.github.io/nearcore/architecture/how/proofs.html) and [nearcore outcome definitions](https://github.com/near/nearcore/blob/2.13.0/core/primitives/src/transaction.rs).

Current pending records hold ID, commitment, kind, epoch, recipient and native amount; token units are in a separate amount sidecar and the token account is derived from the commitment's settlement sidecar. The token call contains recipient/amount only: there is no ID-bearing memo, persisted authenticated receipt-ID mapping, or recovery intent hash. Claim/refund events carry an LCP ID but an unproved association between an event and a token receipt is not enough. Numeric ID uniqueness within LCP does not establish receipt provenance.

**Failure scenario if implemented incompletely:** two attempts have identical token/recipient/amount, or an attacker supplies an unrelated successful transfer at the same token contract. A verifier that matches only this tuple can settle the wrong pending ID. A prior failed attempt's proof can release a later attempt while its actual transfer has succeeded, enabling another payout. Proving the account executor alone also admits unrelated methods or another sender's transfers.

**Required change:** specify an authenticated chain from the originating LCP operation and its immutable intent to the exact child action receipt, and from that receipt ID to a finalized execution outcome. Verify origin/predecessor, token receiver account, method, full relevant action arguments, attached deposit, action/batch constraints, receipt identity, commitment/kind/epoch and attempt identity. Specify how receipt contents and provenance are committed and proven; do not assume the execution-outcome Merkle proof provides them. A memo may supplement this binding but does not authenticate an unproved receipt body, prove a failed call that emitted no log, or establish the sender. Retrofitting older pending records requires its own proven historical linkage; ambiguous legacy records must remain pending.

**Regression gate:** two equal-amount attempts, two commitments, different LCP deployments, an unrelated sender, unrelated USDC method, substituted unproved args, and a failed receipt without logs must all fail cross-association. Exactly one correctly linked outcome must settle only its intended ID. No verifier exists to execute this gate today.

### PR-2 — High design blocker: the authority for accepting the outcome is unspecified

**Location:** design lines 45–61 (three unselected options).

A Merkle path rooted in a submitter-selected header proves membership under that header, not canonical finalized NEAR execution. A self-consistent counterfeit header/outcome tree must not authorize a ledger mutation. The proposal does not choose a verifier, bootstrap checkpoint, network/genesis domain, validator-update/finality algorithm, permitted historical roots, or light-client upgrade policy. Likewise, the threshold alternative has no signed message schema, membership epochs, threshold, distinct-signer rules, revocation/rotation handling, or verifier authorization boundary. The token-status alternative has no identified implemented extension or verified response semantics.

**Impact if implemented incompletely:** a forged root, stale/replaced signer configuration, cross-network certificate, duplicate signatures counted as quorum, or permissive verifier callback could release unpaid escrow or mark an unrelated transfer paid. Compromising a selected attestation threshold remains an explicit custody assumption even with correct cryptography.

**Required change:** select one option and provide a byte-level verification specification and trust model. For a light client, pin the network and trusted bootstrap, validate finalized headers and the complete outcome/root/block ancestry paths using a reviewed protocol/version, and bound proof decoding/resources. For attestations, bind network/genesis, LCP account/deployment incarnation, schema/verifier version, committee epoch, full immutable transfer intent, exact receipt/action identity, finalized block and terminal outcome. Count distinct authorized keys, define rotation/revocation and conflicting certificate policy, and authenticate any asynchronous verifier response to the same transfer/attempt. Committee approval is not equivalent to a trustless receipt proof. If the token extension is chosen, identify and audit it first; absence or query failure cannot mean transfer failure.

**Regression gate:** counterfeit/untrusted root, invalid finality, wrong chain/incarnation, wrong committee epoch, repeated signer, insufficient quorum, wrong verifier callback and unknown token-status result all leave the reservation unchanged.

### PR-3 — Medium: atomic single-settlement and replay consumption remain requirements, not a specified mechanism

**Location:** design lines 23–36; tranche/refund callbacks at `contract.rs:2810` and `2916`.

Current callbacks use pending-record existence and, for tranches, status plus transfer-ID matching to prevent repeat settlement. They remove pending records on terminal processing. There is no shared verified-outcome settlement function, terminal proof record, or proof-to-intent consumption rule. These are not needed for today's single normal callback, but recovery adds a second authority path that must coordinate with it. Deleting the pending record can remain an adequate local replay barrier if IDs are never reused; it does not by itself prevent a receipt being attributed to another operation or establish safety across state restoration/redeployment.

**Required change:** define an internal `VerifiedOutcome` boundary and one atomic settlement operation. Both normal callbacks and validated recovery outcomes must compare the same immutable pending intent, subtract one reservation, record/retain sufficient terminal identity, and consume the exact receipt/action proof once under a defined namespace. Do not expose a public success boolean or reuse a callback as a generic setter. Reject contradictory terminal outcomes without ledger mutation. Specify whether one receipt may contain multiple actions and, if permitted, how action index and accounting isolate them; one receipt cannot be reused to discharge multiple independent full reservations. If proof verification is asynchronous, reread pending/terminal state after verification and compare the stored request nonce/intent hash before applying it. A late callback must not modify a newer retry.

**Evidence:** `recovery_review_conflicting_late_callback_cannot_settle_retry` passed: an old callback did not consume the newer pending reservation; duplicate success settled only once. This establishes the current callback guard for the tested sequence, not an unimplemented recovery race.

**Regression gate:** callback-first and recovery-first for success and failure, proof submitted twice, conflicting proof, one proof across two IDs, delayed verifier response after a retry, and concurrent submissions must preserve conservation and one terminal transition. Include historical transfer-ID and consumed-proof retention/migration rules.

### PR-4 — Medium integration hazard: unknown result/state is not consistently fail-closed in the existing callbacks

**Location:** `contract.rs:2833–2858` and the equivalent refund code around `2930–2957`.

Two independent unit probes confirmed:

1. Calling a pending tranche callback with **zero promise results** classifies the result as failure, clears pending and restores free. The expression `count == 1 && result_is_success` conflates an absent/malformed result context with a proven failed external transfer. Normal promise callbacks should have exactly one result and the public generated wrapper is private; the probe intentionally bypasses it. This is a recovery integration hazard, not a demonstrated normal external entry-point exploit.
2. Deleting the **entire settlement sidecar** before a successful token callback causes native-NEAR fallback using `amount_yocto=0`. The callback marks the tranche Paid, removes the pending transfer and decrements its count, while the token amount sidecar remains. The new comments saying a missing token sidecar keeps the reservation do not describe this whole-sidecar case. Missing only the transfer-amount sidecar while settlement state still exists does keep the reservation. No ordinary caller-side sidecar-deletion route was identified; the precondition is state loss/corruption or an unsafe upgrade.

**Required change before recovery integration:** distinguish `ProvenFailure` from `Unknown/Invalid`. Reject any unexpected promise-result count without ledger mutation. Freeze a token-aware immutable intent at creation and require its token/amount/settlement state to exist and match before settlement. Preserve the legacy NEAR layout with versioned sidecars and migration checks rather than inferring a pending token operation's asset from missing state. Do not try to repair missing accounting from unverified RPC data. Correct the misleading comments in a separate implementation change.

**Regression gate:** zero/multiple result contexts, malformed or missing settlement and transfer records, mismatched token/amount/kind/epoch, and interrupted migration all leave the same pending liability intact. Test native legacy commitments separately. These probes demonstrate the two hazardous branches; they do not simulate actual storage corruption or callback OOG in a validator.

## Assessment of the requested properties

| Property | Verdict |
| --- | --- |
| Bind exact NEP-141 outcome to one LCP transfer ID | **Not established**; PR-1/PR-2 require an authenticated intent/receipt linkage and selected trust mechanism. |
| Prevent replay and conflicting settlement | **Partly established for current callbacks only**; the added stale/retry test passed. Recovery requires PR-3 and verifier tests. |
| Fail closed with missing/ambiguous proof | **Correct stated policy, no recovery verifier to validate**. Keep pending when proof is unavailable. Existing callback adapters must address PR-4 before reuse. |
| Retain conservation while delayed | **Current intended reservation model is sound**. OOG stress and real proof/callback races remain untested; accounting equality alone cannot prove token delivery. |
| Threshold or token-extension alternatives | **Not selected, not approved**. They require their own concrete specification and audit. |

## Additional requirements for the next design revision

- Freeze a versioned recovery intent containing deployment/network domain, transfer ID/attempt, commitment, kind, epoch, token, recipient, raw amount and action linkage. Transfer IDs must never be reused. Preserve existing pending transfers explicitly during upgrades.
- Authenticate **the actual external transfer outcome**, not the originating LCP call's success, a callback's failure, a transaction-wide summary, a token log alone, or a missing receipt. `SuccessReceiptId` may delegate completion to another receipt; specify which final promise result corresponds to the token action and prove the required dependency chain. `Unknown`, nonfinal, missing or ambiguous data stays pending. For future token upgrades, define the token semantics under which receipt success means exact delivery.
- Explain stale-proof handling. A years-old but canonical finalized proof for the exact still-pending attempt may be the desired recovery evidence. Wrong-attempt, wrong-incarnation or invalid trust-anchor proofs are different from old execution timestamps. An arbitrary freshness TTL can recreate permanent pending funds; specify historical header availability and archival access.
- Bound proof/certificate sizes, parsing, signature counts, storage costs and verifier gas. A failed verification must roll back provisional state or leave pending untouched. Define who pays for repeated invalid proof submissions and how evidence remains available after archival pruning.
- Add sandbox forced-OOG after successful token execution, explicit token failure and both callback/recovery orderings. Then run the small disposable testnet canary. The implementation-team follow-up's ordinary 3.00–3.25 Tgas observations do not establish worst-case behavior or cryptographic linkage.

## Verification and closeout

The three added callback probes are retained at [callback-probes.rs](audit/p2-receipt-recovery-2026-11-15/callback-probes.rs), with their output in [callback-probes.log](audit/p2-receipt-recovery-2026-11-15/callback-probes.log). Two tests intentionally confirm unsafe-to-reuse branches and the third confirms stale-callback isolation; passing them is evidence of the described behavior, not that all recovery requirements pass.

**Build pass:** the reviewer executed a fresh build from a clean detached worktree at the exact requested commit with Cargo NEAR 0.23.0 and the manifest-pinned container/digest. Core output was 759,388 bytes, SHA-256 `5c01aa15fee13a03a71fdada304f358f22e608c424525f37892182ac1e649bff`, code hash `7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`, matching the record exactly. The separate adapter build also matched: 152,247 bytes, SHA-256 `148f752999a6613c39675540717b3cb21feee4ae1c8618703513712912a6b0a6`, code hash `2PG2fMTQ1MTmyCGskL2446kZ4dEimT3swmWRzQnpfra9`. This was independently executed by the reviewer in the shared environment; it is not an independent operator/hardware attestation. The current source suite plus the three probes passed **79 tests**.

The separate build result is recorded in `audit/p2-receipt-recovery-2026-11-15/rebuild-result.json` and the core build log. It must be read independently of this design verdict: matching historical deployed bytes does not approve a recovery implementation that those bytes do not contain. A new recovery contract would require new source/artifact identity and review.

**Closeout:** the high-priority binding/trust design gaps must be resolved before recovery implementation approval. The current conservative operational limitation remains: do not release uncertain pending token funds by timeout, balance deltas or discretionary administrator choice. Keep mainnet recovery gated. No live recovery vulnerability, actual double payment, issuer failure or exploit transaction was demonstrated during this review.
