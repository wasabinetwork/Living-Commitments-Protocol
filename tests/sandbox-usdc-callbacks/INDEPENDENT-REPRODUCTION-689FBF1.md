# Independent reproduction: `689fbf1` recovery captures

This is the handoff procedure for a second operator to reproduce the pinned
`689fbf1` capture set and compare it with the committed evidence. It exists
because the current captures are owner-run. Following this document does not by
itself make the evidence independent: the run must be performed by a different
person, on different infrastructure, with no access to the original operator's
keys, machine, or shell history, and the result must be reported as that
operator's own work.

Do not regenerate or overwrite any committed capture or `.sha256` manifest.
Write every new artifact to a new uniquely named directory and record new
manifests.

> **Revision note (2026-11-19).** An owner-machine dry run of this procedure
> found five defects in the handoff itself; they are corrected below and
> summarized in
> [`audit/owner-rerun-689fbf1-2026-11-19/report.md`](../../audit/owner-rerun-689fbf1-2026-11-19/report.md).
> That run was executed by the owner's agent on the owner's workstation, so it is
> **not** the independent reproduction this document asks for.

## Independence rules

- A different operator account and a different machine or CI runner.
- No shared `.env`, wallet keys, RPC credentials, or `LCP_SANDBOX_BINARY_DIR`
  cache with the original run.
- Report the machine, OS, Docker version, target triple, and the exact commands
  used.
- If any step is skipped or any value differs, say so. A partial match is not a
  reproduction.

## Source commit (resolved)

`9e08339` is the commit "test: pin 689fbf1 local recovery acceptance captures".
It adds the manifests and verifier/tooling updates for captures produced at
`689fbf1`; it is not their source. The normative source commit is therefore
`689fbf1`. Because the pinned runner (`run.mjs`), `package-lock.json`, and the
current verifiers only exist from `9e08339`, the reproduction uses **two trees**:

- `689fbf1` for the contract source and the reproducible core WASM build;
- `9e08339` for the runner, verifiers, lockfile, and manifests.

`9e08339` touches only `TODO.md`, the Sandbox test README, and
`tests/sandbox-usdc-callbacks/**`, so contract sources and build inputs are
byte-identical between the two commits. Verify that with the source manifest
(step 1) rather than assuming it.

## Pinned inputs

| Item | Value |
| --- | --- |
| Source commit (contract sources, core WASM) | `689fbf1bc464248b5a6ff019983ef8b415dcd819` |
| Runner/verifier/manifest commit | `9e08339068a1f21762beea18f27e5040060805af` |
| Build image | `sourcescan/cargo-near:0.23.0-rust-1.100.0` |
| Build image digest | `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1` |
| Expected WASM SHA-256 | `890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80` |
| Expected NEAR code hash | `ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX` |
| Runner image | `node:26-trixie-slim` at `sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` |
| NEAR Sandbox | 2.14.0, protocol 88 |
| Committed set | `tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1/` |

Manifests (both root-relative, valid at the `9e08339` tree):

- `tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256`
  (21 rows: the 8 committed captures plus 13 source rows)
- `tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256`
  (9 tooling rows)

### Mock NEP-141 tokens (not in the manifests)

`run.mjs` deploys two test-only token contracts that the handoff previously
failed to document. Their sources live in `contracts/sandbox-mock-ft` (crate
`sandbox-mock-ft`) at the pinned source commit and must be built by the operator:

| Artifact | Build command | Owner-host digest (informational) |
| --- | --- | --- |
| `target/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm` | `cargo build --locked --release --target wasm32-unknown-unknown -p sandbox-mock-ft` | `c8669f67957668888767cebb360d34c096e0654684e489377b634ab11c898619` |
| `target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm` | `CARGO_TARGET_DIR=target/lcp-sandbox-variant-b cargo build --locked --release --target wasm32-unknown-unknown -p sandbox-mock-ft --features variant-b`, then copy the output to `target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm` | `56c46e717bf7b12e41ea848b14a6b58e5c73e2c979c2f4a38cb6910561b7e489` |

**These digests are not a reproducible-build pin.** The same source, lockfile,
and `rustc 1.100.0` compiled inside the pinned Linux image produced
`371222ba…` / `634d6522…` instead. The recorded values were produced by a host
`wasm32-unknown-unknown` build on macOS x86_64. Consequences:

- Build both tokens from the pinned source tree with Rust 1.100.0, then record
  your own two digests in the report.
- Do **not** treat a mock-token digest difference from the owner-host values as
  a failure. The substantive criteria are the contract core WASM/code hash, the
  scenario set and assertions, and the non-volatile payload comparison (step 6).
- If you build on the same host platform as the original run, state that
  explicitly; if the digests match, say so.

## 1. Prepare the two source trees and verify the manifests

```sh
git worktree add --detach /tmp/lcp-689fbf1-repro 689fbf1bc464248b5a6ff019983ef8b415dcd819
cd /tmp/lcp-689fbf1-repro && git status --porcelain   # must be empty

git worktree add --detach /tmp/lcp-9e08339-pin 9e08339068a1f21762beea18f27e5040060805af
```

The full manifests do **not** exist at `689fbf1` (they are introduced by
`9e08339`), so verify them in the pin tree:

```sh
cd /tmp/lcp-9e08339-pin
shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256
```

Both must report every row `OK`. Then confirm the contract-side source rows are
identical at `689fbf1`:

```sh
cd /tmp/lcp-689fbf1-repro
shasum -a 256 -c /tmp/lcp-9e08339-pin/tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256 \
  2>&1 | grep -v 'tests/sandbox-usdc-callbacks/'   # source rows must be OK
```

Any source-row failure means the trees are not the pinned inputs: stop.

## 2. Build the reproducible fixture core

```sh
cd /tmp/lcp-689fbf1-repro
mkdir -p /tmp/lcp-689fbf1-artifacts
cargo near build reproducible-wasm \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery \
  --out-dir /tmp/lcp-689fbf1-artifacts
shasum -a 256 /tmp/lcp-689fbf1-artifacts/lcp_core.wasm
```

The digest must equal `890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80`
and the NEAR code hash `ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX`. NEP-330
embeds the commit, so building any other commit changes this digest even with
identical Rust sources. `cargo near build reproducible-wasm` drives the pinned
`sourcescan/cargo-near` image through
`[package.metadata.near.reproducible_build]`.

## 3. Build the two mock NEP-141 tokens

From the **source** tree (mock-token source must match the core commit):

```sh
cd /tmp/lcp-689fbf1-repro
cargo build --locked --release --target wasm32-unknown-unknown -p sandbox-mock-ft
CARGO_TARGET_DIR=target/lcp-sandbox-variant-b cargo build --locked --release \
  --target wasm32-unknown-unknown -p sandbox-mock-ft --features variant-b
cp target/lcp-sandbox-variant-b/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm \
  target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm
shasum -a 256 target/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm \
              target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm
```

Record both digests. The runner resolves them relative to the mounted repository
root, so either build them in the tree you mount or copy them into it.

## 4. Generate the eight captures

Prepare an isolated Sandbox cache and write outputs to a **new uniquely named
directory inside the repository**, because the pinned verifiers resolve manifest
paths relative to the repository root and reject rows outside it:

```sh
mkdir -p /tmp/lcp-689fbf1-sandbox/bin /tmp/lcp-689fbf1-sandbox/tmp
cd /tmp/lcp-9e08339-pin
mkdir -p tests/sandbox-usdc-callbacks/repro-<operator>-<date>
```

Copy the built core WASM to `/tmp/lcp-689fbf1-sandbox/lcp_core.wasm`, then run
each mode separately, from the repository root, mounting `$PWD:/repo`:

| Capture | Mode variable | Committed file |
| --- | --- | --- |
| protocol-88 | none | `protocol-88.json` |
| recovery | `LCP_RECOVERY_ONLY=1` | `recovery.json` |
| bootstrap guard | `LCP_BOOTSTRAP_ACTIVITY_GUARD_ONLY=1` | `bootstrap-guard.json` |
| storage OOG | `LCP_STORAGE_REGISTRY_OOG_ONLY=1` | `storage-oog.json` |
| registry capacity | `LCP_STORAGE_REGISTRY_CAP_ONLY=1` | `storage-registry-cap.json` |
| registry shape | `LCP_STORAGE_REGISTRY_SHAPE_ONLY=1` | `storage-shape.json` |
| USDC claim | `LCP_USDC_CLAIM_ONLY=1` | `usdc-claim.json` |
| USDC refund | `LCP_USDC_REFUND_ONLY=1` | `usdc-refund.json` |

Template (substitute the mode variable and output name):

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-689fbf1-sandbox:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && \
   NEAR_RPC_TIMEOUT_SECS=120 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin \
   TMPDIR=/sandbox-cache/tmp \
   LCP_CORE_WASM_PATH=/sandbox-cache/lcp_core.wasm \
   LCP_EXPECTED_CORE_WASM_SHA256=890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80 \
   LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/repro-<operator>-<date>/<capture>.json \
   <MODE> node run.mjs'
```

Each run must exit 0 with no failing assertion. Never point
`LCP_CORE_WASM_PATH` at a default `target/` build; the digest check is the guard
that the pinned artifact is under test.

## 5. Verify each new capture

Use the verifiers from the pin tree. Do **not** use the `689fbf1` verifier
scripts: their defaults still point at the older `18ed543` captures and the
superseded `0cd6a24c…` / `s7iWoJcz…` artifacts, and they were amended by
`9e08339`.

```sh
# protocol-88 and bootstrap-guard take <capture> <manifest>;
# the storage verifier takes the capacity and shape captures (no manifest).
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs <capture> <manifest>
node tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs <capture> <manifest>
node tests/sandbox-usdc-callbacks/verify-storage-registry-capture.mjs \
  <storage-registry-cap capture> <storage-shape capture>
```

Write a capture-only manifest for the new directory (root-relative paths, 8
rows). Protocol-88 and the bootstrap guard require a manifest that pins the
capture; the storage verifier does not read one. The recovery, claim, and
refund captures are checked by the `node --test` suites and the in-capture
assertions:

```sh
node --test tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs \
  tests/sandbox-usdc-callbacks/test/storage-registry-capture.test.mjs \
  tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs
```

## 6. Compare with the committed set

A match requires all of the following:

- Core WASM SHA-256 and NEAR code hash equal the pinned values above.
- `fixture_schema` and the scenario name set are identical for every capture
  (15, 17, 5, 6, 6, 6, 5, and 5 scenarios respectively).
- Every assertion the verifier enforces passes on the new capture.
- Every non-volatile scenario payload matches the committed capture after
  dropping only the expected-to-differ field classes below. The owner dry run
  obtained 65/65 with a three-script comparison
  (`compare.mjs`, `compare2.mjs`, `compare3.mjs` in the audit directory).

These fields are expected to differ and are not a mismatch:

- `node.chain_id`, `node.genesis_hash`, sandbox account and contract IDs.
- Transaction, receipt, and block hashes and heights; `SuccessReceiptId` and
  `receipt_ids` entries.
- Per-instance Ed25519 fixture committee keys (each Sandbox instance generates
  its own, so `bootstrap_configuration.current_committee_keys` and the
  `bootstrap` call arguments differ).
- Absolute account balances and storage deltas that depend on the fresh chain
  (`native_cash_*`, `cash_snapshot`, recovery-credit liability, fixture margin,
  `refund_credit_withdrawal_fee_yocto`).
- Derived `recovery_intent.intent_base64` / `intent_digest` and the certificate
  digest built from per-run keys.
- Governance activation timestamps.
- `captured_at`.
- **Mock-token artifact digests** when your build host differs from the
  original owner host (see above). State the digests you produced.

Do not compare the JSON files byte for byte. Report the comparison as a table of
capture, scenario count, verifier result, and each field-level difference outside
the expected-to-differ classes, with an explanation.

## 7. Report

Record in the report:

- Operator identity and affiliation, and a statement that the run used separate
  infrastructure.
- Host machine, OS, Docker version, target triple, Rust and Node versions.
- Source and pin commits, build image digest, core WASM SHA-256, code hash,
  runner image digest, and both mock-token digests.
- The eight capture paths and their new manifests, plus the new manifest rows.
- Verifier and `node --test` output.
- Any deviation, skipped mode, or unexplained field difference.

Attach the report to the P2 recovery evidence, and leave the `TODO.md`
independent-reproduction item unchecked until an operator other than the owner
has signed it.
