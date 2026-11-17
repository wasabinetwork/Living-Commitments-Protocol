# Executed commands

Commands run from the dedicated checkout unless stated; shell redirects sent logs to this evidence directory. Skills loaded with `orca skills get orchestration` and `orca skills get orca-cli`. Read-only identity discovery used `orca worktree show --worktree current --json` and `orca orchestration worker-list --json --full`; only the current worker record is delivered.

```sh
git rev-parse HEAD
git status --short
git fetch origin main
git merge-base --is-ancestor HEAD origin/main
git rev-parse origin/main
git diff 785a51b origin/main --stat
diff -u P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-REVIEW.md '/Users/gilbertoadon/Downloads/Develop/Living Commitments Protocol/P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-REVIEW.md'
shasum -a 256 -c tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17.sha256
node tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs
node --test tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs
cargo near --version
rustc --version
mkdir -p /tmp/lcp-followup-020e39/optimized /tmp/lcp-followup-020e39/bin /tmp/lcp-followup-020e39/tmp target/wasm32-unknown-unknown/release
cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/lcp-core/Cargo.toml --features sandbox-callback-fixture --out-dir /tmp/lcp-followup-020e39/optimized
cargo build --locked --release --target wasm32-unknown-unknown -p sandbox-mock-ft
CARGO_TARGET_DIR=target/lcp-sandbox-variant-b cargo build --locked --release --target wasm32-unknown-unknown -p sandbox-mock-ft --features variant-b
cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/lcp-core/Cargo.toml --features 'sandbox-callback-fixture usdc-receipt-recovery' --out-dir /tmp/lcp-followup-020e39/recovery
cp /tmp/lcp-followup-020e39/recovery/lcp_core.wasm target/wasm32-unknown-unknown/release/lcp_core.wasm
cp target/lcp-sandbox-variant-b/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm
# Sequential confirmation:
cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/lcp-core/Cargo.toml --features 'sandbox-callback-fixture usdc-receipt-recovery' --out-dir /tmp/lcp-followup-020e39/recheck
# EVIDENCE denotes the original-root audit/p2-native-excess-refund-followup-independent-2026-11-17 directory.
docker run --name lcp-followup-020e39 --rm --init --platform linux/amd64 -v "$PWD:/repo" -v /tmp/lcp-followup-020e39:/sandbox-cache -v "$EVIDENCE:/evidence" -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc 'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_NATIVE_EXCESS_REFUND_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/evidence/fresh-capture.json node run.mjs'
node "$EVIDENCE/supplemental-mutations.mjs"
python3 "$EVIDENCE/inspect-graph.py" tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17.json
python3 "$EVIDENCE/inspect-graph.py" "$EVIDENCE/fresh-capture.json"
node '/Users/gilbertoadon/Downloads/Develop/Living Commitments Protocol/tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs' "$EVIDENCE/fresh-capture.json" "$EVIDENCE/fresh-source.sha256"
# From original root:
shasum -a 256 -c "$EVIDENCE/fresh-source.sha256"
docker ps -a --filter name=lcp-followup-020e39 --format '{{.ID}} {{.Status}}'
```

An early copy attempted before the recovery build completed returned file-not-found; the subsequent successful copy supplied the deployed hash. `wasm-opt --version` was unavailable on PATH; cargo-near performed its bundled optimizer step. No installation, public transaction or credential import was run.
