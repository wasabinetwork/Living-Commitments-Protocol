# Independent NEP-141 / USDC Settlement Audit Brief

**Status:** The requested source review was delivered on 2026-11-15 in [P2-USDC-INDEPENDENT-AUDIT-REPORT.md](P2-USDC-INDEPENDENT-AUDIT-REPORT.md). Its findings, testnet follow-up, and remaining release gates are tracked in [P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md](P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md). The original request and scope below are retained as the audit record.

## Request

Conduct an independent, adversarial review of LCP's NEP-141 settlement implementation, with emphasis on token custody, escrow accounting, asynchronous transfers, and compatibility with the existing NEAR settlement path. Treat this as a financial smart-contract review. The implementation team's review and passing local tests are useful evidence, but they are not substitutes for independent analysis.

The review should establish whether the exact candidate preserves value and authorization invariants across partial, excess, failed, repeated, and asynchronous token operations. Report confirmed vulnerabilities, plausible risks, assumptions, coverage gaps, and any cases that need testnet reproduction. Do not use credentials or attempt transactions with production funds.

## Exact candidate and review boundary

The reproducible core built from source commit `e9074ddced4be9dce4dd4c1061909f7869054cf1` is deployed on NEAR testnet. Its WASM SHA-256 is `5c01aa15fee13a03a71fdada304f358f22e608c424525f37892182ac1e649bff`, and its NEAR code hash is `7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`; deployment transaction and acceptance receipts are in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md). Review this exact source and artifact identity. If the proposed review uses another commit or WASM, identify the difference and repeat the relevant checks against the deployed artifact.

The deployed candidate combines P0 refund/recovery changes with the P2 USDC path. Review the shared escrow and callback interactions as they exist in that combined artifact; reviewing only an isolated USDC diff would miss relevant state interactions. The goal is to clear the independent accounting gate before further USDC testnet acceptance or mainnet release. Mainnet immutable-deployment controls and unrelated reviewer-service internals are outside this brief.

Primary code and integration scope:

- `contracts/lcp-core/src/contract.rs` and `contracts/lcp-core/src/models.rs`: asset selection and digest binding, sidecar state, funding, activation, claims, refunds, callbacks, and public views/events.
- `contracts/lcp-core` tests: NEP-141 funding, activation, claim/refund, failure recovery, and legacy behavior.
- `packages/sdk/src/index.ts` and settlement SDK tests: raw amount serialization, `ft_transfer_call`, and NEP-145 registration arguments.
- `apps/console/components/dashboard.tsx`: asset selection, decimal conversion, metadata checks, storage registration preflight, and display of raw asset values.
- `contracts/bounded-payout-adapter/src/lib.rs` only as an integration boundary: confirm that its NEAR-denominated authority grants cannot spend or misinterpret a USDC commitment.

The public event indexer is optional and non-authoritative. Check its parsing/display path only where new `amount_raw` or `settlement_asset` fields could mislead users or reviewers; contract state remains canonical.

## Implementation model

Each new commitment selects either native NEAR or the allowlisted USDC contract for its NEAR network. Testnet USDC is `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`; mainnet USDC is `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. Both are configured with six decimals. The contract allowlist and pinned policy are authoritative; token metadata is a client-side consistency check.

Native NEAR accounting remains in legacy `*_yocto` fields. NEP-141 commitments use a versioned settlement sidecar keyed by commitment ID, with raw token-unit fields for tranche amount, funded, paid, refunded, and pending balances. A separate transfer-amount sidecar binds an asynchronous token transfer to its callback ID. A missing settlement sidecar is interpreted as a legacy NEAR commitment. NEAR remains necessary for gas, contract storage, token-account registration, and OutLayer execution operations.

Token funding arrives through `ft_transfer_call`; `ft_on_transfer` authenticates the calling token contract and sponsor, accepts only the remaining escrow allowance, and returns unused units to the NEP-141 resolver. Claims and residual refunds reserve token units in pending state before calling `ft_transfer`; private callbacks then settle the transfer or restore retryable state. The NEAR-only operations budget and bounded payout adapter are separate from USDC escrow.

## Invariants to establish

1. **Asset identity:** only the correct allowlisted token account for the current chain can fund or settle a token commitment. Account IDs, six-decimal units, asset kind, and raw tranche amount cannot be substituted after creation or confused across networks.
2. **Policy binding:** the policy digest binds all settlement-relevant values. Native NEAR fields and NEP-141 raw-unit fields cannot disagree, overflow, round, or be reinterpreted by a view, event, SDK call, adapter, or Console formatter.
3. **Per-commitment conservation:** for every token commitment, `funded_raw = paid_raw + refunded_raw + pending_raw + free_raw`, with checked arithmetic. No sequence can make paid, refunded, or pending units exceed funded units or the `max_epochs × tranche_amount_raw` cap. Analyze custody and liabilities across asynchronous token calls, including the interval between token execution and LCP callback.
4. **Single authorization and settlement:** only the configured sponsor funds or receives residual escrow; only the configured beneficiary can receive a claim; temporal eligibility and one-tranche-per-epoch rules apply identically to NEAR and USDC. A failed or duplicate callback cannot create a second payout, erase a liability, or permanently consume a retryable balance.
5. **Async failure safety:** before an external transfer, the amount is reserved exactly once. On success it becomes paid/refunded exactly once; on failure it returns to free escrow and can be retried. Stale, replayed, malformed, wrong-kind, or wrong-ID callbacks cannot settle another transfer. Assess callback gas, storage use, token resolver behavior, and permanently pending states.
6. **Funding correctness:** malformed messages, unknown commitments, wrong token, wrong sender, zero amounts, closed commitments, overfunding, repeated funding, and arithmetic boundaries return or retain precisely the correct amount without corrupting state. Evaluate partial funding and resolver refunds, including resolver failure or an unexpected token implementation response.
7. **Activation and separation:** activation requires the full token escrow target and the independent NEAR evaluator-operations requirement. Refunds, storage bonds, one-yoctoNEAR transfer deposits, and OutLayer charges must never be counted as USDC or vice versa.
8. **Storage and compatibility:** NEP-145 registration shortfalls cause a recoverable transfer failure, not loss of escrow. Existing Borsh layouts and legacy commitments without sidecars continue to behave as native NEAR. New storage prefixes do not collide, and code-only upgrades preserve settlement sidecars and pending transfer records.
9. **Composed refund behavior:** sponsor residual escrow refund, unused NEAR operations recovery, storage-excess refunds, and token transfer callbacks remain correctly separated. Examine closure, pending transfers, repeated refund requests, and claims/refunds racing with callbacks.
10. **Truthful observability:** contract views and events expose the canonical asset and units; `amount_yocto` is zero or absent for token amounts where intended, and all consumers use `amount_raw` with the bound asset. No UI-only metadata or stale indexer data can authorize a transfer.

## Required adversarial analysis and tests

At minimum, independently trace and exercise:

- Asset creation on testnet and mainnet chain IDs; unsupported token, wrong-network token, mismatched raw/NEAR fields, malformed policy, zero amount, one atomic unit, six-decimal boundaries, maximum `u128`, and `max_epochs × tranche` overflow.
- Inbound `ft_transfer_call` with exact funding, partial funding, cap-crossing excess, already-funded commitments, replayed funding calls, malformed/unknown messages, wrong predecessor token, wrong sponsor, closed commitment, and zero transfer. Confirm both receiver state and the token resolver's final sender/receiver balances.
- Activation one atomic unit below and exactly at the funding target, with operations funding independently insufficient and sufficient. Confirm a refund, storage deposit, or pending transfer cannot satisfy the funding gate.
- Claim success, token rejection, unregistered beneficiary, callback failure, callback delay, duplicate callback, stale callback, wrong transfer ID/type, repeat claim while pending, and retry after beneficiary registration. Confirm temporal eligibility and epoch accounting remain intact.
- Residual sponsor refund success/failure/retry, a failed transfer followed by another refund request, multiple pending refunds if the API permits them, closure and callback ordering, and duplicate or mismatched refund callbacks.
- Sidecar absent, malformed, mismatched, or missing transfer-amount records; state after code upgrade; old NEAR commitment reads and NEAR funding/claims/refunds; mixed commitments across both assets; and NEAR-only adapter calls against a USDC commitment.
- Storage and gas edge cases for fresh and existing NEP-145 registrations, changing `storage_balance_bounds`, recipient registration removal/shortfall, callback gas, storage deposits, and the extra 1 yoctoNEAR attached to `ft_transfer` and sponsor `ft_transfer_call`.
- SDK/Console amount boundaries and on-chain view/event rendering, ensuring decimal conversion uses integer arithmetic and does not treat NEAR gas or storage as part of the USDC commitment amount.

Use unit and property/state-machine tests for conservation and callback ordering where practical. Treat mock-token tests as useful but insufficient for assumptions about Circle's deployed token behavior; identify which claims require testnet confirmation. Do not add funds or submit testnet transactions as part of the source audit without prior coordination.

## Standards and evidence

Compare behavior with the finalized [NEP-141 Fungible Token Standard](https://github.com/near/NEPs/blob/master/neps/nep-0141.md), [NEP-145 Storage Management](https://github.com/near/NEPs/blob/master/neps/nep-0145.md), [NEP-148 Fungible Token Metadata](https://github.com/near/NEPs/blob/master/neps/nep-0148.md), and [NEP-330 reproducible-build metadata](https://github.com/near/NEPs/blob/master/neps/nep-0330.md). Use token metadata only to verify user-facing consistency; verify the on-chain allowlist and token account directly.

Local evidence already documented includes focused contract and SDK tests, reproducible artifact identity, and a testnet code-only upgrade. These results do not establish independent correctness or live USDC settlement acceptance. See [P2-ASSET-ARCHITECTURE.md](P2-ASSET-ARCHITECTURE.md) and [TESTING.md](TESTING.md) for the implementation and dated build records.

## Required audit report

Return a signed or attributable report that includes:

- Exact source commit, artifact SHA-256/code hash reviewed, tools and analysis methods, and any files or behaviors excluded.
- A coverage matrix mapping each invariant above to code, tests/analysis, and verdict (`pass`, `finding`, or `not verified`).
- Each finding's severity, affected code, preconditions, concrete impact, reproduction or proof, recommended mitigation, and a regression test that would prevent recurrence.
- Explicit accounting for asynchronous NEAR promise semantics, Circle token assumptions, storage/gas assumptions, and residual risks.
- A final release opinion: safe for further testnet USDC validation, requires remediation before that validation, or not suitable for release. Separate testnet acceptance from mainnet readiness, which requires its own independent build/deployment and key-management gates.

Do not mark the audit complete solely because local tests pass. No Critical or High finding should remain open before USDC testnet acceptance; any accepted Medium/Low risk must include an owner, rationale, and mitigation or monitoring plan. The reviewer should re-check every code fix against the same invariant and confirm the final artifact identity before issuing a closeout opinion.
