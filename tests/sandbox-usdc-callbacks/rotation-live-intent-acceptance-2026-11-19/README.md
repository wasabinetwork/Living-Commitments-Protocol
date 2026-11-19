# Rotation with a live pending intent and in-place upgrade — 2026-11-19

This capture closes the two VM gaps left open by the Gate 4 rotation table: an
old-epoch intent settled after a committee rotation, and an in-place code
upgrade that preserves instance identity and counters. It is one full
`LCP_RECOVERY_ONLY=1` run of the harness, so every other recovery scenario in
`recovery.json` was re-executed against the same artifact.

## Provenance

- Source commit `e47b19440aa71def96f3a0ccd349c0f11b0fbd79`.
- Reproducible `sandbox-recovery` build: `cargo near build reproducible-wasm
  --manifest-path contracts/lcp-core/Cargo.toml --variant sandbox-recovery`
  in `sourcescan/cargo-near:0.23.0-rust-1.100.0` at image digest
  `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`.
  WASM SHA-256
  `de9dc7cfed3e6f9b9b47350e257381a77ddc7f765b347173e89e926cde06a192`, NEAR code
  hash `Fz13ws3yxBWcuAd7FHtYvR3EwpfpaJTcVi8BxbBHkWxH`, 1,226,309 bytes.
- Runner image `node:26-trixie-slim` at
  `sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc`,
  NEAR Sandbox 2.14.0 (protocol 88), isolated `test-chain-*` network.
- Command: `LCP_RECOVERY_ONLY=1` with `LCP_CORE_WASM_PATH` and
  `LCP_EXPECTED_CORE_WASM_SHA256` pinned to the artifact above. No public
  network, testnet account, or `.env.testnet` credential was used.

## What the rotation scenario shows

The harness rotates epoch 1 to epoch 2 while a tranche intent is pending
(`scenarios.rotation_live_intent`):

| Step | Recorded value |
| --- | --- |
| Live intent queued with a 1 Tgas callback (`pending_transfer_id`) | `9`, transaction `48qXWhbqvappTToE3pWq8PrpTN4oQXFffJHBzgdzPEyv` |
| Rotation proposal, generation 3, epoch 1 → 2 | `D8PVcHcwrRVziMhV7Bkweinx29qRpFqDQ7KcUzNGNtfg`, `activate_at_ns` `1795113905564308194` |
| Activation after one Sandbox fast-forward | `HDyb5fy4vPYbAcJzEEztUhtBNzXvKcB2XkbEEHnnDRXF`, observed `1795113907065277872` |
| `retire_receipt_recovery_epoch(1)` while the intent is pending | `false`; epoch 1 still returns its five keys |
| In-place redeploy of the same artifact | `9gLMiRQFUond77jbfz9W3asZVwBCpBN8dTWQKoH5Q1id`, code hash unchanged |
| State compare across the upgrade | instance ID `1e135ca3…68e76`, epoch 2, used-key count 15, generation 3, pending intent bytes, storage record count, and native cash ledger unchanged |
| Next transfer allocated after the upgrade | transfer `10`, i.e. the counter continued past the pre-upgrade intent |
| Settlement under retained epoch-1 signatures | `81EG1nFWCwfRJa2vCejRg3U7tkUh1ATGpGyRDMgWKjLA`; escrow `paid_raw` `1000000`, `pending_raw` `0`, tranche `Paid` |
| `retire_receipt_recovery_epoch(1)` after settlement | `true`; epoch 1 no longer readable |

The two payouts in this scenario leave the mock token pool and are returned in
`3fWbPKd86Hd4iD7EgzHmqDpaYSeE7LadAatUX9hvzrN1` so the later token-balance
scenarios keep their documented starting supply.

## Verify

```bash
node tests/sandbox-usdc-callbacks/verify-rotation-live-intent-capture.mjs
node --test tests/sandbox-usdc-callbacks/test/rotation-live-intent-capture.test.mjs
```

The first command rechecks every recorded field in
`scenarios.rotation_live_intent` against the pinned artifact and the committed
source manifest: the retained-epoch settlement while epoch 2 is active, the
blocked-then-successful retirement, generation and epoch continuity with the
preceding governance rotation, the preserved instance ID and counters, the
full raw payout, and the repaid mock pool. The second mutates the capture one
field at a time and expects each mutation to be rejected.

## Limits

This is local Sandbox evidence produced by the same operator, not an
independent reproduction and not canary approval. The fixture shortens the
rotation delay to ten seconds, so the production seven-day cycle was still not
elapsed; that owner gate is unchanged. The upgrade is a `DeployContract` over
existing state, which is what a forward-only upgrade does. It does not test a
reinitializer, a state migration function (the contract has none), or a
ledger-deleting restore, which the owner decision prohibits.
