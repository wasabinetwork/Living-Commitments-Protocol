# Independent reproduction: `689fbf1` recovery captures

This is the handoff procedure for a second operator to reproduce the pinned
`689fbf1` capture set and compare it with the committed evidence. It exists
because the current captures are owner-run. Following this document does not by
itself make the evidence independent: the run must be performed by a different
person, on different infrastructure, with no access to the original operator's
keys, machine, or shell history, and the result must be reported as that
operator's own work.

Do not regenerate or overwrite any committed capture or `.sha256` manifest.
Write every new artifact to a new directory and record new manifests.

## Independence rules

- A different operator account and a different machine or CI runner.
- No shared `.env`, wallet keys, RPC credentials, or `LCP_SANDBOX_BINARY_DIR`
  cache with the original run.
- Report the machine, OS, Docker version, and the exact commands used.
- If any step is skipped or any value differs, say so. A partial match is not a
  reproduction.

## Source commit (resolved)

`9e08339` is the commit "test: pin 689fbf1 local recovery acceptance captures".
It adds the manifests for captures produced at `689fbf1`; it is not their
source. The normative source commit is therefore `689fbf1`, as pinned below.
Reproduce the captures from `689fbf1` and compare against the manifests
introduced by `9e08339`.

## Pinned inputs

| Item | Value |
| --- | --- |
| Source commit | `689fbf1bc464248b5a6ff019983ef8b415dcd819` |
| Build image | `sourcescan/cargo-near:0.23.0-rust-1.100.0` |
| Build image digest | `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1` |
| Expected WASM SHA-256 | `890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80` |
| Expected NEAR code hash | `ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX` |
| Runner image | `node:26-trixie-slim` at `sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` |
| NEAR Sandbox | 2.14.0, protocol 88 |
| Committed set | `tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1/` |

The committed manifest for this set is
`tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256`
and its tooling manifest is
`tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256`.
Both are root-relative and apply to the `689fbf1` source tree, not to later
commits.

## 1. Prepare a clean source tree

```sh
git worktree add --detach /tmp/lcp-689fbf1-repro 689fbf1bc464248b5a6ff019983ef8b415dcd819
cd /tmp/lcp-689fbf1-repro
git status --porcelain   # must be empty
```

Confirm the manifest in that tree matches the committed source (from the
worktree root):

```sh
shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256
```

If either check fails, stop: the tree is not the pinned source.

## 2. Build the reproducible fixture core

```sh
cargo near build reproducible-wasm \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery \
  --out-dir /tmp/lcp-689fbf1-artifacts
shasum -a 256 /tmp/lcp-689fbf1-artifacts/lcp_core.wasm
```

The digest must equal `890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80`.
NEP-330 embeds the commit, so building any other commit changes this digest even
with identical Rust sources.

## 3. Generate the eight captures

Prepare an isolated Sandbox cache, then run each mode separately with the
reproducible artifact pinned:

```sh
mkdir -p /tmp/lcp-689fbf1-sandbox/bin /tmp/lcp-689fbf1-sandbox/tmp
export LCP_CORE_WASM_PATH=/tmp/lcp-689fbf1-artifacts/lcp_core.wasm
export LCP_EXPECTED_CORE_WASM_SHA256=890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80
```

Run from the worktree root, `-w /repo/tests/sandbox-usdc-callbacks`, with
`-v "$PWD:/repo"` and `-v /tmp/lcp-689fbf1-sandbox:/sandbox-cache`:

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
   LCP_FIXTURE_OUTPUT=/sandbox-cache/out/<capture>.json \
   node run.mjs'
```

Copy the built WASM to `/tmp/lcp-689fbf1-sandbox/lcp_core.wasm` first, and set
the mode variable for that run. Write outputs outside
`/repo/tests/sandbox-usdc-callbacks/` unless you are deliberately writing to a
new, uniquely named directory.

## 4. Verify each new capture

Run every verifier against the new file and its own new manifest:

```sh
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs <capture> <manifest>
node tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs <capture> <manifest>
node tests/sandbox-usdc-callbacks/verify-storage-registry-capture.mjs <capture> <manifest>
```

The recovery, claim, and refund captures are checked by
`tests/sandbox-usdc-callbacks/test/*.test.mjs` and the assertions inside
`run.mjs`; run:

```sh
node --test tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs
node --test tests/sandbox-usdc-callbacks/test/storage-registry-capture.test.mjs
node --test tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs
```

## 5. Compare with the committed set

A match requires all of the following:

- WASM SHA-256 and NEAR code hash equal the pinned values above.
- Every scenario name present in the committed capture exists in the new one.
- Every assertion the verifier enforces passes on the new capture.
- `fixture_schema`, contract code hash, and mock-token code hashes match.

These fields are expected to differ and are not a mismatch:

- `node.chain_id`, `node.genesis_hash`, sandbox account IDs.
- Transaction and receipt hashes, block hashes, block heights.
- Account balances and storage-usage numbers that depend on the fresh chain.
- `captured_at`.

Do not compare the JSON files byte for byte. Report the comparison as a table of
scenario, verifier result, and any field-level difference that is not in the
expected-to-differ list.

## 6. Report

Record in the report:

- Operator identity and affiliation, and a statement that the run used separate
  infrastructure.
- Source commit, build digest, WASM SHA-256, code hash, runner image digest.
- The eight capture paths and their new manifests.
- Verifier output.
- Any deviation, skipped mode, or unexplained field difference.

Attach the report to the P2 recovery evidence, and leave the `TODO.md`
independent-reproduction item unchecked until an operator other than the owner
has signed it.
