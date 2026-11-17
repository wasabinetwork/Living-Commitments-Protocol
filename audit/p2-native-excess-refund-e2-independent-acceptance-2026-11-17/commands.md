# E2 acceptance reproduction commands

All commands ran locally in this repository. No NEAR RPC, testnet, mainnet,
deployment, or credential access was involved.

## Artifact reproduction (pinned SourceScan image, cargo-near 0.23.0, Rust 1.100.0)

```sh
git worktree add --detach /tmp/lcp-e2-src-950e3cb 950e3cb
cd /tmp/lcp-e2-src-950e3cb
cargo near build reproducible-wasm --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery --out-dir /tmp/lcp-e2-reviewer-build-950/core
# 4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad / 6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212
# log: build-950e3cb.log

git worktree add --detach /tmp/lcp-e2-review-verify 2f3ba1c
cd /tmp/lcp-e2-review-verify
cargo near build reproducible-wasm --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery --out-dir /tmp/lcp-e2-reviewer-build-2f/core
# e798e30351c64c66c856135f3c68e6158ff1b0d3d982ccdebbcbaa20b4d3af5f / Gb4PjkAxEr915uMybRi3UJikcwoxsKtmE6Sw7U5JwSmc
# log: build-2f3ba1c.log (the artifact embeds the source revision, so a different
# source commit necessarily yields a different digest)
```

## Evidence probe

```sh
node audit/p2-native-excess-refund-e2-independent-acceptance-2026-11-17/reviewer-probe.mjs /tmp/lcp-e2-review-verify
# 24/24 manifest rows, 23/23 independent checks pass, 3 listed leads rejected, 4 new mutants accepted
# log: reviewer-probe.log
node --test tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs
# 17 pass / 0 fail
node tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs
# PASS ... 24 source hashes ...
```

The probe is deliberately independent of the committed assertion helpers: graph
closure, terminal statuses, body/outcome identity, transfer and event
exclusivity, storage growth, fees, and solvency are all recomputed from the raw
capture JSON. The committed verifier is imported only to compare verdicts on
synthetic mutants.
