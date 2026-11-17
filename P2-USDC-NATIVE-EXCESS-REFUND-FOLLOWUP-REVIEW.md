# Native Excess-Refund Evidence Follow-up Review

## Objective

Independently verify that the two low-severity evidence gaps (E1/E2) from
[`P2-USDC-NATIVE-EXCESS-REFUND-INDEPENDENT-REVIEW.md`](P2-USDC-NATIVE-EXCESS-REFUND-INDEPENDENT-REVIEW.md)
are closed in the refreshed capture and runner. The earlier report accepted the
scoped contract behavior; this follow-up reviews evidence completeness and the
capture checker, not a broader contract audit.

## Candidate and artifacts

- Source commit: `6b32824a5be6156fe1afa696a76991c696a00309`.
- Runtime: NEAR Sandbox 2.14.0, protocol 88; use a clean, independently managed
  runtime and fresh chain.
- Core fixture SHA-256: `33997ebb2f48d2ebb82db46d6f6625476ac963f71b71257aaee288c1a5671872`.
- NEAR code hash: `4URYaJBxtUGhYbafSHMRkVyGcHcY8Zs1uwugpRM1p76Z`.
- Capture and 23-row source manifest:
  [`November 17 capture`](tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17.json),
  [`manifest`](tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17.sha256).
- Runner and checker:
  [`run.mjs`](tests/sandbox-usdc-callbacks/run.mjs),
  [`capture verifier`](tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs),
  [`seven mutation checks`](tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs).

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
   callback, duplicate payout, missing payout, altered amount, and incomplete
   receipt graph. Report any additional mutation weakness found.

## Scope and report format

Use only the local Sandbox. Do not send testnet/mainnet transactions or deploy
WASM. Receipt inclusion proofs against block headers, Circle USDC, public
network behavior, and deployment safety remain outside this review.

Return a verdict, full commit hash, independently built artifact hash and code
hash, Sandbox/runtime identity, receipt-graph closure results, transaction
hashes, exact accounting observations, mutation results, deviations, and
checksummed evidence paths. Do not edit expected captures or source hashes to
make a mismatch pass.
