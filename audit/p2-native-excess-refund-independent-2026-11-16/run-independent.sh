#!/bin/sh
set -eu
cp /tmp/lcp-independent-b05365/build/lcp_core.wasm target/wasm32-unknown-unknown/release/lcp_core.wasm
shasum -a 256 target/wasm32-unknown-unknown/release/*.wasm > /tmp/lcp-independent-b05365/evidence/artifacts.sha256
docker run --name lcp-independent-b05365 --init --platform linux/amd64 -v "$PWD:/repo" -v /tmp/lcp-independent-b05365:/sandbox-cache -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc 'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_NATIVE_EXCESS_REFUND_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/sandbox-cache/evidence/independent-native-excess-refund.json node run.mjs' > /tmp/lcp-independent-b05365/evidence/sandbox.log 2>&1
