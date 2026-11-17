# Native Excess-Refund Sandbox Reproduction Review

## Review objective

Independently reproduce the failed native excess-refund and payer-credit recovery scenario in an isolated NEAR Sandbox, then inspect whether the fixture and captured receipts support the stated result. Use a fresh checkout of the reviewed commit and an independently managed runtime. Do not deploy this fixture to testnet or mainnet.

## Reviewed revision and evidence

- Source revision: `519e59b` (verify the full commit from `origin/main` before starting).
- Sandbox: `near-sandbox` 0.3.5, NEAR Sandbox 2.14.0, protocol 88.
- Feature-built core SHA-256: `33997ebb2f48d2ebb82db46d6f6625476ac963f71b71257aaee288c1a5671872`.
- Corresponding NEAR code hash: `4URYaJBxtUGhYbafSHMRkVyGcHcY8Zs1uwugpRM1p76Z`.
- Primary evidence: [captured receipt tree](tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-16.json), [source manifest](tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-16.sha256), and [capture checker](tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs).

## Reproduction

Build the core with the fixture and receipt-recovery features using the pinned Rust toolchain and `cargo-near` 0.23.0. Build both mock token variants as documented in [the Sandbox guide](tests/sandbox-usdc-callbacks/README.md#receipt-recovery-vmsandbox-acceptance). Then run this command from the repository root; it writes a fresh capture outside the checkout:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_NATIVE_EXCESS_REFUND_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/sandbox-cache/independent-native-excess-refund.json node run.mjs'
```

Compare the independent output with the committed capture and review the core source path in `contracts/lcp-core/src/contract.rs` and `contracts/lcp-core/src/native_cash.rs`.

## Expected observations

1. `refund_excess` records a `0.01 NEAR` liability and attempts the native transfer. The test-only recipient override points to a missing Sandbox account; the root action and production callback run, the transfer receipt fails, and the callback restores the full amount as the payer's storage-refund credit.
2. A withdrawal with `0.01 NEAR` free margin fails at the solvency check before the transfer is requested. The credit and native cash snapshot remain unchanged.
3. The persisted withdrawal attempt adds `0.00026 NEAR` of measured storage in this fixture. A retry with exactly `0.01026 NEAR` free margin succeeds; the callback closes the liability and the payer's balance change plus measured transaction/receipt fees equals `0.01 NEAR`.
4. The final native cash snapshot has no storage shortfall, refund liability, or scheduled outflow and remains solvent.

Also build the default release Wasm and confirm that it contains no `sandbox_*` exports. The fixture method that selects a missing recipient must be absent from the release ABI. Record the independent core artifact hash, Sandbox version/protocol, transaction and receipt hashes, payer balance equation, and any deviation from the expected observations.

## Scope limits

This review concerns local receipt and accounting behavior only. It does not validate Circle USDC, public-network execution, receipt Merkle proofs against block headers, production liquidity recommendations, or deployment safety. A different runtime result should be reported with full logs and artifacts; do not “fix” the capture by editing its expected values.
