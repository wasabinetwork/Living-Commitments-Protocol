# Independent reproduction: rotation with a live pending intent

This is the handoff procedure for a second operator to re-run the
rotation-with-live-intent capture
([`rotation-live-intent-acceptance-2026-11-19/`](rotation-live-intent-acceptance-2026-11-19/))
and compare the result with the committed evidence. It exists because that
capture is owner-run. Following this document does not by itself make the
evidence independent: the run has to be performed by a different person, on
different infrastructure, without access to the original operator's keys,
machine, cache, or shell history, and the result has to be reported as that
operator's own work.

Do not regenerate or overwrite any committed capture or `.sha256` manifest.
Write every new artifact to a new uniquely named directory and record a new
manifest for it.

## Independence rules

- A different operator account and a different machine or CI runner.
- No shared `.env`, wallet keys, RPC credentials, or `LCP_SANDBOX_BINARY_DIR`
  cache with the original run.
- Report the machine, OS, Docker version, target triple, and the exact commands
  used.
- If any step is skipped or any value differs, say so. A partial match is not a
  reproduction.

## Pinned inputs

| Item | Value |
| --- | --- |
| Source commit (contract sources, fixture, core WASM) | `e47b19440aa71def96f3a0ccd349c0f11b0fbd79` |
| Runner/verifier commit | the revision that introduced this document; resolve with `git log -1 --format=%H -- tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-ROTATION-LIVE-INTENT.md` |
| Build image | `sourcescan/cargo-near:0.23.0-rust-1.100.0` |
| Build image digest | `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1` |
| Expected core WASM | 1,226,309 bytes, SHA-256 `de9dc7cfed3e6f9b9b47350e257381a77ddc7f765b347173e89e926cde06a192` |
| Expected NEAR code hash | `Fz13ws3yxBWcuAd7FHtYvR3EwpfpaJTcVi8BxbBHkWxH` |
| Expected mock token WASM (variant A / B) | SHA-256 `d01d4434643ebc9a240abe9d4522408dc7f6636d38f07bd809713d9255a178ad` / `91c7ba424c9ca159a4e5117aae3211864c289eff0d695b5fe750c0f1711e4848` |
| Expected mock token code hash (variant A / B) | `F1PghgpN3UQmRhjm6hmoB9na3dfW9NNaW7cTKAoDdTfA` / `Ap4ks3KUK5Dm93SacgHEEbZRgZ78bRmjuNHXppttiBUB` |
| Mock token build | `tests/sandbox-usdc-callbacks/build-mock-tokens-pinned.sh` in the same pinned image |
| Runner image | `node:26-trixie-slim` at `sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` |
| NEAR Sandbox | 2.14.0, protocol 88, isolated `test-chain-*` |
| Committed capture | `tests/sandbox-usdc-callbacks/rotation-live-intent-acceptance-2026-11-19/recovery.json` |
| Source manifest | `tests/sandbox-usdc-callbacks/rotation-live-intent-acceptance-2026-11-19.sha256` |
| Tooling manifest | `tests/sandbox-usdc-callbacks/rotation-live-intent-acceptance-2026-11-19.tooling.sha256` |

`e47b194` is the source of the contract code and of the harness scenario; the
runner, verifier, and this checklist live in later commits that touch only
`tests/sandbox-usdc-callbacks/**`. The source manifest is checked in step 1, so
source drift between those commits is detected rather than assumed.

## 1. Start from a clean tree

```sh
git clone https://github.com/wasabinetwork/Living-Commitments-Protocol.git /tmp/lcp-reproduction
cd /tmp/lcp-reproduction
git worktree add --detach /tmp/lcp-rotation-repro e47b194
cd /tmp/lcp-rotation-repro
shasum -a 256 -c tests/sandbox-usdc-callbacks/rotation-live-intent-acceptance-2026-11-19.sha256
```

Every row must print `OK`: the contract sources, toolchain pins, mock token
crate, and the capture file itself are the ones the committed evidence recorded.
If a row fails, stop and report it; do not substitute a different artifact.

## 2. Rebuild the core artifact

Run the build on the host, not inside the pinned image: `cargo near build` fails
its docker sanity check inside that image.

```sh
cargo near build reproducible-wasm \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery --out-dir /tmp/lcp-near-sandbox-cache/head-core
shasum -a 256 /tmp/lcp-near-sandbox-cache/head-core/lcp_core.wasm
```

The digest, byte count, and NEAR code hash must equal the three values in the
table above. Then build both mock NEP-141 variants with the pinned image:

```sh
tests/sandbox-usdc-callbacks/build-mock-tokens-pinned.sh
```

## 3. Run the recovery-only harness

`run.mjs` drives a Linux Sandbox binary, so run it in the pinned container even
on macOS. Write the capture to a new directory that does not exist in the
repository:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 \
     LCP_RECOVERY_ONLY=1 \
     LCP_CORE_WASM_PATH=/sandbox-cache/head-core/lcp_core.wasm \
     LCP_EXPECTED_CORE_WASM_SHA256=de9dc7cfed3e6f9b9b47350e257381a77ddc7f765b347173e89e926cde06a192 \
     LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp \
     LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/rotation-independent-<your-stem>/recovery.json \
     node run.mjs'
```

The command must exit `0`, print `PASS` for every check, and end with
`All isolated receipt-recovery Sandbox checks passed; no public network was
used.` The run deploys its own isolated chain; no testnet account, RPC
endpoint, or `.env.testnet` credential is involved.

## 4. Compare with the committed evidence

Run the verifier from the clone that carries it — the `lcp-reproduction`
checkout, not the detached worktree — and point `--fresh` at the capture the
worktree wrote:

```sh
cd /tmp/lcp-reproduction
node tests/sandbox-usdc-callbacks/verify-rotation-live-intent-capture.mjs \
  --fresh /tmp/lcp-rotation-repro/tests/sandbox-usdc-callbacks/rotation-independent-<your-stem>/recovery.json
```

The verifier first validates the fresh capture on its own (pinned artifact,
scenario order, generation and epoch continuity, retirement ordering, preserved
identity and counters, escrow payout, repaid pool), then compares it with the
committed capture. A successful run prints `PASS fresh rotation capture …` with
the compared and excluded field counts. Any difference outside the volatile set
fails with the field name.

| Must match | May differ between runs |
| --- | --- |
| Artifact digests and code hashes for the core and both mock tokens | The six transaction hashes in the rotation scenario |
| Sandbox release, protocol version, and build (`version` block) | The instance ID and the chain ID/genesis hash |
| Fixture schema and scenario set and order | `activate_at_ns` and `observed_activation_time_ns` |
| Governance generations, epochs, retirement, and replay results | `captured_at` |
| Rotation generation, retained and active epochs, settlement epoch | Gas burnt and absolute account balances in the other scenarios |
| Retirement blocked while pending, then retired after settlement | |
| In-place upgrade code hash and every preservation flag | |
| Transfer counter continuing past the pending intent | |
| Escrow asset, funded and paid raw amounts, zeroed remaining buckets | |
| Recipient balance and repaid mock pool | |

Then record your own manifest for your capture — never the committed one:

```sh
shasum -a 256 /tmp/lcp-rotation-repro/tests/sandbox-usdc-callbacks/rotation-independent-<your-stem>/recovery.json \
  > /tmp/lcp-rotation-repro/tests/sandbox-usdc-callbacks/rotation-independent-<your-stem>.sha256
```

## 5. Report

Open a pull request or issue that states the operator, machine, OS, Docker
version, target triple, and the exact commands used, and includes a table of the
compared fields with `match` or `differ` for each row. Say plainly whether the
run passed, which fields differed, and which steps you skipped. Your artifacts
belong in your own directory with your own manifest; the committed capture and
its manifests stay unchanged.

A matching run is evidence of reproducibility on different infrastructure. It
is not canary approval, not a production rotation, and not a transfer of funds.

## Limits of this reproduction

- The fixture shortens the rotation delay to ten seconds; the production
  seven-day cycle is not elapsed by this run.
- The upgrade is a `DeployContract` of the same artifact over live state. It
  does not exercise a reinitializer, a state migration function (the contract
  has none), or a ledger-deleting restore.
- The verifier compares recorded scenario fields. It does not re-derive
  receipt-level execution, and `--fresh` compares the rotation scenario plus
  governance continuity and the artifact and node blocks, not the values of the
  other seventeen scenarios.
- Gas burnt is not bit-identical across runs, so any comparison of
  `*_gas_burnt` fields in the other scenarios is expected to differ.
