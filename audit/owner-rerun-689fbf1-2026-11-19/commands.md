# Commands executed — 689fbf1 owner-machine rerun (2026-11-19)

All commands ran on the host macOS x86_64 workstation from the repository root
(`/Users/gilbertoadon/Downloads/Develop/Living Commitments Protocol`) unless
stated. Logs are in `logs/`. This answers “report the machine, OS, Docker
version, and the exact commands used” from the handoff document.

## 1. Source-tree preparation

```sh
git worktree add --detach /tmp/lcp-689fbf1-repro 689fbf1bc464248b5a6ff019983ef8b415dcd819
cd /tmp/lcp-689fbf1-repro
git status --porcelain        # empty (clean tree)
git rev-parse HEAD            # 689fbf1bc464248b5a6ff019983ef8b415dcd819

git worktree add --detach /tmp/lcp-9e08339-pin 9e08339068a1f21762beea18f27e5040060805af
```

Deviations forced by the handoff document (see `report.md`):

- The full source+tooling manifests do **not** exist at `689fbf1` (they are
  introduced by `9e08339`). They were therefore checked out in the `9e08339`
  tree instead:
  ```sh
  cd /tmp/lcp-9e08339-pin
  shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256
  shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256
  ```
  Both pass (all 21 + 9 rows OK).
- The 13 source rows of the source manifest were additionally verified in the
  correct `689fbf1` tree (all OK).

## 2. Reproducible core WASM build

```sh
mkdir -p /tmp/lcp-689fbf1-artifacts
cd /tmp/lcp-689fbf1-repro
cargo near build reproducible-wasm \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery \
  --out-dir /tmp/lcp-689fbf1-artifacts
shasum -a 256 /tmp/lcp-689fbf1-artifacts/lcp_core.wasm
```

Result (log: `logs/build-core-wasm.log`):

- WASM SHA-256 `890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80`
- NEAR code hash (bs58 of SHA-256) `ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX`

Both match the pinned values exactly. (Note: `cargo near build
reproducible-wasm` drives the pinned
`sourcescan/cargo-near:0.23.0-rust-1.100.0` image itself via
`[package.metadata.near.reproducible_build]`.)

## 3. Mock-token WASM (needed by `run.mjs`; not documented in the handoff)

```sh
cd /tmp/lcp-9e08339-pin
cargo build --locked --release --target wasm32-unknown-unknown -p sandbox-mock-ft
CARGO_TARGET_DIR=target/lcp-sandbox-variant-b cargo build --locked --release \
  --target wasm32-unknown-unknown -p sandbox-mock-ft --features variant-b
cp target/lcp-sandbox-variant-b/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm \
  target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm
```

Host (macOS, rustc 1.100.0) result — matches the recorded artifact hashes:

- `sandbox_mock_ft.wasm` variants A: `c8669f67957668888767cebb360d34c096e0654684e489377b634ab11c898619`
- variant B: `56c46e717bf7b12e41ea848b14a6b58e5c73e2c979c2f4a38cb6910561b7e489`

A Linux-in-container build of the *same* source with the *same pinned
release/deps produced different hashes
(`371222ba…` / `634d6522…`), i.e. the mock-token artifact is host-toolchain
dependent. See `report.md` deviation D.

## 4. Eight capture runs (pinned runner image)

```sh
mkdir -p /tmp/lcp-689fbf1-sandbox/bin /tmp/lcp-689fbf1-sandbox/tmp /tmp/lcp-689fbf1-sandbox/out
cp /tmp/lcp-689fbf1-artifacts/lcp_core.wasm /tmp/lcp-689fbf1-sandbox/lcp_core.wasm
cd /tmp/lcp-9e08339-pin

# per capture, from the 9e08339 tree, with the mode variable from the table:
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-689fbf1-sandbox:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && \
   NEAR_RPC_TIMEOUT_SECS=120 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin \
   TMPDIR=/sandbox-cache/tmp \
   LCP_CORE_WASM_PATH=/sandbox-cache/lcp_core.wasm \
   LCP_EXPECTED_CORE_WASM_SHA256=890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80 \
   <MODE> LCP_FIXTURE_OUTPUT=/sandbox-cache/out/<capture>.json \
   node run.mjs'
```

Modes: `protocol-88` (none), `LCP_RECOVERY_ONLY=1`,
`LCP_BOOTSTRAP_ACTIVITY_GUARD_ONLY=1`, `LCP_STORAGE_REGISTRY_OOG_ONLY=1`,
`LCP_STORAGE_REGISTRY_CAP_ONLY=1`, `LCP_STORAGE_REGISTRY_SHAPE_ONLY=1`,
`LCP_USDC_CLAIM_ONLY=1`, `LCP_USDC_REFUND_ONLY=1`.

All eight exited 0; PASS/FAIL counts and the run window are in
`logs/capture-summary.log`.

## 5. Verification of the new captures

Generated a fresh source manifest for the new set at the `9e08339` tree
(`tests/sandbox-usdc-callbacks/owner-rerun-2026-11-19.sha256`, 21 rows:
8 new captures + the same 13 pinned source rows) and a capture-only manifest
in this evidence directory (`captures.sha256`, 8 rows, repository-root-relative
so the pinned verifiers accept it from the current checkout). From the main
checkout:

```sh
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs \
  audit/owner-rerun-689fbf1-2026-11-19/captures/protocol-88.json \
  audit/owner-rerun-689fbf1-2026-11-19/captures.sha256
node tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs \
  audit/owner-rerun-689fbf1-2026-11-19/captures/bootstrap-guard.json \
  audit/owner-rerun-689fbf1-2026-11-19/captures.sha256
node tests/sandbox-usdc-callbacks/verify-storage-registry-capture.mjs \
  audit/owner-rerun-689fbf1-2026-11-19/captures/storage-registry-cap.json \
  audit/owner-rerun-689fbf1-2026-11-19/captures/storage-shape.json
node --test tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs \
  tests/sandbox-usdc-callbacks/test/storage-registry-capture.test.mjs \
  tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs
```

All three verifiers PASS and all 33 `node --test` checks PASS
(`logs/verifiers-from-main-checkout.log`).

## 6. Comparison with the committed set

```sh
node audit/owner-rerun-689fbf1-2026-11-19/compare.mjs   > logs/compare-committed-vs-rerun.log
node audit/owner-rerun-689fbf1-2026-11-19/compare3.mjs  > logs/nonvolatile-comparison.log
```

See `logs/nonvolatile-comparison.log`: 65/65 scenario payloads identical after
dropping only the handoff-documented volatile field classes.