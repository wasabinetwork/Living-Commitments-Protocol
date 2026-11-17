# Native Excess-Refund Evidence Follow-up Review

## Objective

Independently verify the owner remediation for E2, while retaining the E1 closure
from the follow-up report. The remaining changes address the artifact mismatch
and checker mutations reported in
[`P2-USDC-NATIVE-EXCESS-REFUND-INDEPENDENT-REVIEW.md`](P2-USDC-NATIVE-EXCESS-REFUND-INDEPENDENT-REVIEW.md)
and
[`P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-INDEPENDENT-REVIEW.md`](P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-INDEPENDENT-REVIEW.md).
The earlier reports accepted the scoped contract behavior; this follow-up reviews
artifact provenance, evidence completeness, and the capture checker, not a
broader contract audit.

## Candidate and artifacts

- Contract source commit: `950e3cb50fd79f559f5b6ff725fbfa32db70a063`.
- Runtime: NEAR Sandbox 2.14.0, protocol 88; use a clean, independently managed
  runtime and fresh chain.
- Reproducible build: cargo-near 0.23.0, Rust 1.100.0, pinned image
  `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`,
  variant `sandbox-recovery`.
- Core fixture SHA-256: `4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad`.
- NEAR code hash: `6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212`.
- Two reproducible build invocations returned the same WASM and code hashes.
- Capture and 24-row source manifest:
  [`NEP-330 reproducible November 17 capture`](tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json),
  [`manifest`](tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256).
- The plain clean-build capture (`0f194b…`) and older `33997e…` capture are
  retained for comparison; neither is the candidate in this handoff.
- Runner and checker:
  [`run.mjs`](tests/sandbox-usdc-callbacks/run.mjs),
  [`capture verifier`](tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs),
  [`13 automated checks (one valid control and twelve mutations)`](tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs).

The [Sandbox guide](tests/sandbox-usdc-callbacks/README.md) contains locked
build commands and the isolated Docker invocation. Run the checker and mutation
tests from the repository root before independently rebuilding and reproducing
the scenario. Do not reuse the committed capture or another reviewer's runtime
as the reproduction.

## Required checks

1. Confirm all four scenario transactions request `EXPERIMENTAL_tx_status` at
   `wait_until: FINAL`; each receipt ID referenced by the transaction or an
   execution outcome must resolve to exactly one outcome and raw receipt body.
   No receipt outcome may remain `Unknown`, and no orphan body may be present.
2. Independently reproduce failed excess refund, cash-gate rejection,
   successful `0.01 NEAR` credit withdrawal at the measured `0.01026 NEAR`
   margin, and a post-settlement withdrawal replay. Confirm system-generated
   refund transfers (`predecessor_id: system`) are not counted as contract
   payouts.
3. Recheck the callback events, transfer action recipients/amounts, exact
   `0.00026 NEAR` storage growth, payer balance-plus-fees equation, zero final
   payer credit, and solvent final cash snapshot.
4. Confirm the mutation tests reject a changed artifact, missing failure
   callback, duplicate/missing/altered payout, missing child, disconnected
   outcome/body pair, missing receipt status, failed payout or other successful-
   withdrawal receipt, promise-only payout receipt, and any replay transfer
   amount including one yocto.
5. Independently rebuild commit `950e3cb50fd79f559f5b6ff725fbfa32db70a063`
   with the pinned `sandbox-recovery` NEP-330 variant. Run the Sandbox using
   the output path explicitly with `LCP_CORE_WASM_PATH`, set
   `LCP_EXPECTED_CORE_WASM_SHA256` to the digest above, and confirm the result
   before deployment. Do not rely on the cached `target/.../lcp_core.wasm`.

## Scope and report format

Use only the local Sandbox. Do not send testnet/mainnet transactions or deploy
WASM. Receipt inclusion proofs against block headers, Circle USDC, public
network behavior, and deployment safety remain outside this review.

Return a verdict, full commit hash, independently built artifact hash and code
hash, Sandbox/runtime identity, receipt-graph closure results, transaction
hashes, exact accounting observations, mutation results, deviations, and
checksummed evidence paths. Do not edit expected captures or source hashes to
make a mismatch pass.
