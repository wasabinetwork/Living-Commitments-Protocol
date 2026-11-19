# `689fbf1` capture set — owner-machine reproduction attempt (2026-11-19)

**Status: mechanically reproduced on the owner's machine; the independence
requirement in
[INDEPENDENT-REPRODUCTION-689FBF1.md](../../tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md)
is still unmet.** This run used the owner's account, workstation, Docker daemon,
and shell. It is therefore *not* the second-operator reproduction that the
handoff procedure asks for, and it must not be reported as independent evidence
or as canary approval. The `TODO.md` item
"Obtain an independent reproduction of the `689fbf1` capture set at `9e08339`"
is deliberately left unchecked.

What this run does establish is narrower and still useful: all pinned inputs
were re-derived from scratch, every capture was regenerated, every verifier
passes on the new files, and every non-volatile field matches the committed
captures. It also found three defects in the handoff procedure itself.

## Pinned inputs re-derived

| Item | Pinned in handoff | Observed 2026-11-19 | Match |
| --- | --- | --- | --- |
| Build image digest | `sha256:265b662a…264e1049f1` | `sha256:265b662a…264e1049f1` | yes |
| Runner image digest | `sha256:e6bedef2…6b8820bc` | `sha256:e6bedef2…6b8820bc` | yes |
| Reproducible WASM SHA-256 | `890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80` | identical | yes |
| NEAR code hash | `ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX` | identical | yes |
| Mock token A SHA-256 | `c8669f67957668888767cebb360d34c096e0654684e489377b634ab11c898619` | identical (host build) | yes |
| Mock token B SHA-256 | `56c46e717bf7b12e41ea848b14a6b58e5c73e2c979c2f4a38cb6910561b7e489` | identical (host build) | yes |
| NEAR Sandbox / protocol | 2.14.0 / 88 | 2.14.0 / 88, nearcore `bc4e9e8c…` | yes |
| Source manifests (21 + 9 rows) | verified at `9e08339` | all rows OK | yes |

Environment: macOS 15.8.3 (24H241), Darwin 24.6.0, x86_64; Docker 29.9.3;
host rustc `1.100.0 (0ef1bc386 2026-11-09)`; cargo-near `0.23.0`; container Node
`v26.13.1`. Details in [environment.md](environment.md); exact commands in
[commands.md](commands.md); full logs in [logs/](logs).

## Capture results

Eight fresh captures were produced in `node:26-trixie-slim` from the pinned
artifact (`LCP_CORE_WASM_PATH`, `LCP_EXPECTED_CORE_WASM_SHA256`) against
isolated Sandbox 2.14.0. All eight exited 0 with no failing assertion.

| Capture | Mode | Assertions | Verifier on new file | New SHA-256 |
| --- | --- | --- | --- | --- |
| `protocol-88.json` | none | 51 PASS / 0 FAIL | `verify-protocol-88-fixture.mjs` PASS | `471dd7d29163b6d32b609419f3ebc1bb6ea2dc5058df0254d12ca41a53b0bce6` |
| `recovery.json` | `LCP_RECOVERY_ONLY=1` | 142 PASS / 0 FAIL | in-capture assertions + `native-excess-refund`/recovery tests | `59661acbeb2a33f15c66c5c4a088608a668ad9d60eae95f27a81abf62b6e3674` |
| `bootstrap-guard.json` | `LCP_BOOTSTRAP_ACTIVITY_GUARD_ONLY=1` | 23 PASS / 0 FAIL | `verify-bootstrap-activity-guard-capture.mjs` PASS | `19ee0d65e39e13862cced88c0dbf3f17ab6f232f1e2a5b60c6e16d4f7ed77504` |
| `storage-oog.json` | `LCP_STORAGE_REGISTRY_OOG_ONLY=1` | 26 PASS / 0 FAIL | storage-registry tests | `fa8c6c30e40074e2eaf7a76125023ee19c343ecce88f14e589b24856b09bafb4` |
| `storage-registry-cap.json` | `LCP_STORAGE_REGISTRY_CAP_ONLY=1` | 119 PASS / 0 FAIL | `verify-storage-registry-capture.mjs` PASS | `3e34d6e57bea6227575ebaf200d30e067ad597940d9dc8a7595dc3e94f731f93` |
| `storage-shape.json` | `LCP_STORAGE_REGISTRY_SHAPE_ONLY=1` | 23 PASS / 0 FAIL | `verify-storage-registry-capture.mjs` PASS | `211a1a39b5baa13140b77d3c7519f96338189d5921130e10767cb493e09a6520` |
| `usdc-claim.json` | `LCP_USDC_CLAIM_ONLY=1` | 20 PASS / 0 FAIL | in-capture assertions | `437567e1cafae807913a79170583c765e4978682cd3d48c67a783cba5eeac370` |
| `usdc-refund.json` | `LCP_USDC_REFUND_ONLY=1` | 26 PASS / 0 FAIL | in-capture assertions | `4b5c86fc41bafe1647b0055e5e968fa6b89e9714c5dd379a8e238a1476c4dbef` |

`node --test` over `bootstrap-activity-guard-capture`, `storage-registry-capture`,
and `native-excess-refund-capture`: 33 tests, 33 pass, 0 fail.

Files: [captures/](captures) with [captures.sha256](captures.sha256)
(repository-root-relative, so the pinned verifiers accept it);
`source-manifest-used.sha256` records the 21-row manifest written during the run
at the `9e08339` tree (8 new captures + the 13 pinned source rows, all OK).

## Comparison with the committed set

Committed set:
`tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1/`.

| Check | Result |
| --- | --- |
| `fixture_schema` per capture | identical for all 8 |
| `wasm_artifacts` (core + both mock tokens) | identical for all 8 |
| Scenario name sets | identical (15, 17, 5, 6, 6, 6, 5, 5) |
| Non-volatile scenario payloads | **65 / 65 identical** (`logs/nonvolatile-comparison.log`) |
| Pinned normative values (2,048-record limit, 32 revaluation batches, 527 bytes/row, highest batch gas) | identical; enforced again by the storage verifier |

Differences are confined to the classes the handoff lists as expected:
`node.chain_id`, `node.genesis_hash`, receipt/transaction/block identifiers and
heights, per-run Ed25519 committee keys (they are generated per Sandbox
instance, so `bootstrap_configuration.current_committee_keys` and the
`bootstrap` call arguments differ), absolute account balances
(`native_cash_*`, `cash_snapshot`, recovery-credit liability and fixture-margin
figures, `refund_credit_withdrawal_fee_yocto`), the derived
`recovery_intent.intent_base64`/`intent_digest`, governance activation times, and
`captured_at`. No difference was found outside those classes.
`logs/compare-committed-vs-rerun.log` lists every differing path.

## Deviations and defects in the handoff procedure

**D1 — Step 1 cannot be executed as written.** The source and tooling manifests
are introduced by `9e08339`, so at `689fbf1` the files
`tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17*.sha256`
do not exist and the "if either check fails, stop" gate aborts on a missing
file rather than a hash mismatch. Deviation taken: the two manifests were
verified in a `9e08339` worktree (all rows OK) and the 13 *source* rows were
additionally verified in the `689fbf1` worktree (all OK). The two trees differ
only in `TODO.md`, the test README, and `tests/sandbox-usdc-callbacks/**`.

**D2 — The verifiers pinned by `689fbf1` cannot check the `689fbf1` captures.**
The verifier scripts in the `689fbf1` tree default to the earlier
`recovery-acceptance-2026-11-17-18ed543` captures and the older
`0cd6a24c…` / `s7iWoJcz…` artifact, and they were amended by `9e08339` itself.
The hard-coded `891…/ADzw…` constants in the `9e08339` verifiers read from the
`recovery-acceptance-2026-11-17-689fbf1` default path. A reproduction from
`689fbf1` therefore has to borrow run-time tooling from `9e08339`. The handoff
should say so and should pin the verifier commits explicitly.

**D3 — The mock-token artifacts are not documented at all, yet step 5 requires
them to match.** `run.mjs` loads
`target/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm` and
`sandbox_mock_ft_variant_b.wasm`, which the handoff never mentions and never
pins. Deviation taken: both were built with `cargo build --locked --release
--target wasm32-unknown-unknown -p sandbox-mock-ft` (and `--features variant-b`)
using the host `1.100.0` toolchain; both hashes match the recorded artifacts.

**D4 — Mock-token hashes are not reproducible across build hosts.** The same
source, lockfile, and rustc release compiled *inside* the pinned Linux
`sourcescan/cargo-near:0.23.0-rust-1.100.0` image produced
`371222ba…` (variant A) and `634d6522…` (variant B), not the recorded
`c8669f67…` / `56c46e71…`. The pin for these two artifacts is effectively a
pin on the *host* toolchain, not on the container image. A genuinely
independent operator on Linux/CI will not match them unless the handoff states
the build host/target that produced them (or the artifacts stop being part of
the pass criteria). This is the one finding that would actually block a
second-operator match on the "mock-token code hashes match" rule.

**D5 — Reusable path conflict.** Step 4 asks for outputs in
`/sandbox-cache/out/<capture>.json` while also telling the operator not to write
inside `tests/sandbox-usdc-callbacks/`. The pinned verifiers resolve capture
paths relative to the repository root (`join(repoRoot, row)`) and reject
manifests that point outside it, so the new captures and their manifest must
live inside the repository, in a new uniquely named directory. This run used
`tests/sandbox-usdc-callbacks/owner-rerun-2026-11-19-689fbf1/` for verification
at the `9e08339` tree and stores the copies here at
`audit/owner-rerun-689fbf1-2026-11-19/captures/`.

## What still has to happen for the TODO item

1. A different human operator, on a different machine or CI runner, with no
   access to the owner's keys, shell history, or Docker cache, repeats
   [commands.md](commands.md).
2. That operator must either build the mock tokens on a host with the same
   toolchain as the original run or the pass criteria must drop the mock-token
   hashes (see D4). Otherwise criterion "mock-token code hashes match" is
   unsatisfiable for a Linux operator.
3. The report is signed by that operator and attached to the P2 recovery
   evidence; only then may the `TODO.md` checkbox be ticked.

No committed capture, manifest, verifier, or contract source was modified or
regenerated by this run.
