# Independent NEP-141 settlement review

**Reviewer:** OpenAI Codex, acting as an independent source-review agent relative to the implementation changes. This is an attributable automated review, not a cryptographically signed third-party audit certification.

**Date:** 2026-11-15. **Opinion:** safe for further tightly controlled testnet USDC validation within the limits below; **not approved for mainnet release**. No Critical or High vulnerability was confirmed in the examined flows. The full accounting/acceptance gate is **not cleared**: resolver balance settlement, actual-token gas and failure behavior, and an independent reproducible build remain unverified. Passing local tests does not resolve these gaps.

## Candidate identity and methods

Reviewed source: `e9074ddced4be9dce4dd4c1061909f7869054cf1`, exported with `git archive` into `/tmp/lcp-usdc-audit-candidate`. Source review used the exact exported contract, models, SDK, Console, and adapter boundary rather than current working-tree implementations. Current HEAD was `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`; the relevant contract/model/SDK/adapter paths have no diff between these commits. Dashboard has subsequent wallet synchronization and field-help changes; those changes were outside the candidate review.

A finalized, read-only RPC download of `livingcommitmentsprotocol.testnet` at block **277757296**, hash `3gJe6h4A2qbgEECwdZ1YuDP3vtaQN8dwgYkEKEwgRX2g`, produced:

- WASM bytes: **759,388**.
- SHA-256: **`5c01aa15fee13a03a71fdada304f358f22e608c424525f37892182ac1e649bff`**.
- NEAR account code hash: **`7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`**.

These match the requested candidate. This establishes deployed bytes against the supplied artifact identity; it does **not** independently reproduce the build or prove source-to-binary correspondence. The source/build linkage relies on the existing dated reproducible-build receipt until an independent rebuild is performed. The RPC evidence used one provider, not a light-client proof.

Methods: manual state-transition and authorization tracing, exact-candidate unit tests, independently added adversarial tests, integer-boundary probes, finalized code and token views, and comparison with NEP-141/145/148/330. Tools: git, Rust/Cargo using the pinned toolchain, Node.js, npm/TypeScript, and NEAR JSON-RPC. No credentials, funds, or state-changing blockchain calls were used. No implementation fixes were made.

Evidence resides in [audit/p2-usdc-2026-11-15](audit/p2-usdc-2026-11-15). Independent Rust tests were inserted only into the exported candidate's existing test module. Their fixture helpers deliberately construct funded/healthy states; they do not simulate token custody or a real token resolver. The initial harness insertion failed compilation, was corrected, and all final reported checks below passed.

## Results and coverage

Exact unmodified candidate core suite: **73 passed**. Independent added core tests: **9 passed**. Exact-candidate SDK suite: **16 passed**. The combined rerun passed **82 core tests** (73 existing + 9 added), plus the adapter tests recorded in `combined-tests.txt`. Console decimal-boundary probes: **9 passed**. Outputs and test sources are retained with the evidence. No exhaustive fuzzing, sandbox receipt execution, or interactive browser test was performed.

`pass` below means the stated source/local property was established within the described model, not that every live scenario in the brief passed. Each incomplete component is explicitly `not verified`.

| Invariant | Code and evidence | Verdict |
| --- | --- | --- |
| 1. Asset identity | `contract.rs:5057` derives the allowlist from `env::chain_id()` through policy construction. NEP-141 requires zero native tranche and a positive raw tranche. `ft_on_transfer:1053` requires the bound token predecessor and sponsor. Wrong-network, wrong token/sender and native-funding rejection tests pass. Circle's published token addresses match the constants. | **pass** for source authorization; mainnet execution **not verified**. |
| 2. Policy/units binding | `commitment_policy_digest:4437` and `service_availability_asset_policy_digest:4461` length-prefix domain-separated policy/asset serialization. Asset account, decimals, and raw tranche enter the digest; mutable funded/paid counters do not. Legacy NEAR digests are preserved. `build_budget_policy` checks multiplication overflow. Console uses string/BigInt conversion; one atomic unit, six-decimal and u128 boundaries pass. SDK forwards string amounts and one-yocto deposits. | **pass** for examined construction and integer paths. Exhaustive malformed policy/SDK inputs **not verified**. |
| 3. Conservation | `claim_tranche:2628`, `refund_remaining:3069`, callbacks `2805/2909`, and `get_escrow_status:3351`. Reservations subtract from free before calls; success moves pending to paid/refunded, failure restores free. Independent funding and callback traces assert `F=P+R+pending+free`. | **pass** in local model; actual aggregate token custody and resolver balances **not verified**. |
| 4. Single authorization/settlement | Beneficiary-only claim, sponsor-only funding/refund; closed lifecycle and temporal eligibility checks shared with NEAR. Tranche callback checks kind, epoch, Pending status and transfer ID; consumed pending records make duplicate callbacks inert. Wrong-kind/unknown-ID/failure/retry/duplicate sequences pass. | **pass** for traced/local sequences. Cross-epoch randomized scheduling **not verified**. |
| 5. Async failure safety | Reserved amount sidecar, per-transfer ID, private callbacks, and 25 Tgas token call / 20 Tgas callback. Successful receipt is accepted even if result bytes exceed the inspection bound, avoiding false rollback after a successful transfer. Missing token amount is conservatively left pending. | **pass** for executed callbacks; permanently failed callbacks and real gas margins **not verified**, see R1. |
| 6. Funding correctness | `ft_on_transfer` returns full amount for invalid/unknown/wrong sender/token/closed/zero and caps cumulative funded at max-epochs × tranche. Independent sequence includes zero, one, partial, cap crossing with `u128::MAX`, and additional calls after cap. Malformed/unknown message checks pass. | **pass** for receiver bookkeeping; actual sender/receiver balances after resolver, including resolver failure **not verified**, see R2. |
| 7. Activation/separation | `activate_commitment:1144` requires free token escrow at full target plus independently available NEAR evaluator funding. Token legacy `*_yocto` values stay zero; token transfers require an extra one yocto separate from storage bond. Adapter creation rejects a token sidecar at `729`. | **pass** for source and existing activation/independent separation tests. Full mixed-asset receipt scenarios **not verified**. |
| 8. Storage/compatibility | Distinct ASCII sidecar prefixes plus fixed-width ID suffixes; existing Borsh state fields remain the legacy layout and sidecars live in raw storage. Absent sidecar selects NEAR; malformed settlement data panics, malformed/missing token transfer amount refuses settlement. Existing NEAR tests pass. | **pass** for source layout strategy; adversarial migration/upgrade round trips and real NEP-145 failure/retry **not verified**, see R1/R3. |
| 9. Composed refunds | `close_commitment:3028` blocks pending transfers/evaluations/challenges. Residual free excludes all pending token units. Operations refunds use a distinct kind and native accounting, and wait for pending transfers. Existing success/failure/retry/refund tests pass. | **pass** for traced/local paths; exhaustive concurrent operations/refund/callback combinations **not verified**. |
| 10. Observability | Escrow/commitment/tranche views include bound asset and raw units; token legacy amounts are zero, callback event native amount is null and `amount_raw` is explicit. Console uses raw fields with asset-aware formatting. Indexer source inspected does not convert token raw values into native amounts or authorize payouts. | **pass** for examined source paths. Browser rendering and end-to-end indexer ingestion **not verified**. |

## Findings and conditional risks

**Confirmed exploitable implementation vulnerabilities:** none established by this review. This is a bounded negative result, not proof of absence. The following are unresolved risks/acceptance requirements, not demonstrated attacks reachable by an ordinary caller.

### R1 — Conditional Medium: indefinitely pending transfers have no reconciliation mechanism

**Affected code:** `contract.rs:2805–2884`, `2909–2969`, and `3028`. A successful token transfer followed by an LCP callback that exhausts gas or otherwise fails leaves the amount reserved and the pending count nonzero. A private callback cannot simply be replayed by a user with its original promise result. There is no public receipt-proof-based reconciliation path. Consequently further claims/refunds/closure may remain blocked even though token custody changed.

The independent missing-amount-sidecar test confirms conservative non-settlement: the pending 1,500,000-unit liability and transfer record remain. This corruption test does **not** prove that normal operation can lose the sidecar, nor that the actual callback exceeds 20 Tgas. It establishes the absence of self-recovery in that state. Malformed settlement records panic rather than silently becoming native NEAR. A missing entire settlement sidecar is ambiguous by design because legacy commitments use absence as NEAR; upgrades must preserve these keys.

**Recommendation:** measure actual worst-case callback gas and reserve a documented margin; define an authenticated, receipt-proven recovery procedure for an interrupted callback and audit it before implementation. Do not free pending units solely on a timeout: the token transfer may already have succeeded, allowing double settlement. Suggested regression: execute token success then force callback OOG in a sandbox; establish that recovery settles the original receipt exactly once. **Proposed owner:** contract maintainer. **Acceptance status:** unaccepted; conditional impact and mitigation require explicit owner review before mainnet.

### R2 — Required live verification: resolver and issuer assumptions

**Affected code:** `ft_on_transfer:1053` and token transfer construction at `2730/3160`. LCP trusts the allowlisted token's receipt success to mean exact delivery, and trusts its receiver/resolver semantics. It does not query recipient balances as settlement proof. This is appropriate only for the intended token implementation: a successful no-op, fee-on-transfer, unexpected partial transfer, upgrade or custody intervention could invalidate the local conservation-to-custody relationship.

NEP-141 resolver processing is a separate receipt from LCP's receiver. Accepted units are accounted by LCP before resolution. Partial funding can return unused units while retaining accepted units; resolver failure/refund restrictions need token-specific reproduction. Direct `ft_transfer` donations or other untracked token receipts are not attributed to a commitment and have no reviewed recovery path; instruct users to use `ft_transfer_call`.

**Recommendation/test:** on coordinated testnet, record sponsor/LCP balances before and after exact, partial and excess transfers; verify all resolver outcomes, receiver failure, sender unregistration and pending concurrent funding. Confirm actual token rejection for unregistered beneficiary, retry after registration, exact recipient delta, and issuer pause/restriction behavior where safely testable. **Proposed owner:** settlement integration maintainer. **Status:** not verified; no transactions authorized or performed in this source audit.

### R3 — Required live verification: storage and callback budgets

Read-only token views returned `USDC`, six decimals, fixed `storage_balance_bounds` min/max **1250000000000000000000 yoctoNEAR**, and LCP storage total equal to that bound with available zero. This confirms current registration, not that future bounds cannot change or that all recipients are registered. The Console reads fresh bounds and offers `registration_only=false` for existing-account top-ups; NEP-145 permits token-specific fixed-size registration behavior and implementations may refund deposits for already registered accounts.

**Recommendation/test:** fresh and existing-account registration, bounds changes, recipient removal, failed transfer/retry, and actual gas usage must be checked against the deployed token. A client preflight is advisory and can become stale. Keep token accounting independent of NEAR storage/deposit refunds. **Proposed owner:** integration/Console maintainer. **Status:** not verified; requires coordinated testnet testing.

## Standards and asynchronous assumptions

Compared against [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md), [NEP-145](https://github.com/near/NEPs/blob/master/neps/nep-0145.md), [NEP-148](https://github.com/near/NEPs/blob/master/neps/nep-0148.md), and [NEP-330](https://github.com/near/NEPs/blob/master/neps/nep-0330.md). Allowlist consistency uses [Circle's official address documentation](https://developers.circle.com/stablecoins/usdc-contract-addresses), not mutable token metadata as authorization.

NEAR transaction/receipt failures roll back the failing receipt's writes, not previous successful external receipts. Callback receipt failure cannot undo a completed token transfer. The accounting pending bucket therefore represents an unsettled liability and may temporarily exceed current on-token custody after successful token execution but before callback; do not classify that interval as insolvency or make a second payout from those units. Mock unit contexts do not model atomic receipt rollback or actual token account balances. A panic test alone cannot establish refund custody after rollback.

NEP-141 receiver inputs are authenticated by predecessor token and sender, return values use decimal-string U128, and outgoing `ft_transfer` attaches one yocto. Token implementations and issuer privileges remain external trust assumptions. This review did not audit Circle's token code, admin keys, sanctions/pause controls, infrastructure, or mainnet deployment. The pinned build metadata records an image and command; independent NEP-330 reproduction remains a separate missing assurance.

## Release and closeout requirements

Further **coordinated, disposable testnet validation** is reasonable because this pass found no confirmed Critical/High authorization or local-accounting defect. That opinion permits testing, not acceptance or deployment with production value. No Medium risk has been accepted on the owner's behalf. Mainnet readiness is **not established**.

Before clearing the full accounting gate: complete R1–R3 receipt/gas/resolver checks, add randomized multi-commitment conservation/callback-order tests, execute legacy/new state upgrade round trips, and independently reproduce the exact artifact. Record every excluded invariant as resolved or explicitly accepted with owner/rationale/monitoring. If fixes change code, rebuild and repeat affected tests against the resulting artifact; do not transfer this review's artifact identity to a later build.
