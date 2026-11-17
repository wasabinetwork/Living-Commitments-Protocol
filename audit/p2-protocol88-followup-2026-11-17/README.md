# Protocol-88 Follow-Up Acceptance Review

## Purpose

Independently reproduce and review the fresh local Sandbox acceptance for the
receipt-recovery candidate. This package does not authorize a testnet canary or
deployment. No public-network transaction is part of the procedure.

The recovery core is the NEP-330 `sandbox-recovery` build of source commit
`950e3cb50fd79f559f5b6ff725fbfa32db70a063`, expected SHA-256
`4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad` and NEAR
code hash `6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212`. Build metadata pins
`sourcescan/cargo-near:0.23.0-rust-1.100.0` at digest
`sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`.
The harness uses `node:26-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` and
the lockfile-pinned `near-sandbox` dependency.

## Captures and verification

The four new captures are in
[`tests/sandbox-usdc-callbacks`](../../tests/sandbox-usdc-callbacks/):

- `protocol-88-receipt-fixture-followup-reproducible-2026-11-17.json` — native
  cash gate, callback failures/retries, token rollback, code-action order, and
  four concurrent transfers.
- `receipt-recovery-sandbox-acceptance-followup-reproducible-2026-11-17.json` —
  certificate parsing and settlement, callback/certificate races, recovery
  retries, payer credits, governance rotation, and delayed callback solvency.
- `bootstrap-activity-guard-followup-reproducible-2026-11-17.json` — recovery
  bootstrap is rejected after a commitment has been created.
- `storage-registry-oog-followup-reproducible-2026-11-17.json` — a 64-record
  storage revaluation OOG rolls back, invalid cursors/sizes reject, and retry
  completes.

The source manifest has 16 rows: four captures plus contract, workspace, and
toolchain inputs. The tooling manifest pins the runner, verifier, harness
README, and package metadata. From the repository root, verify both manifests
and the raw receipt fixture:

```sh
shasum -a 256 -c tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.tooling.sha256
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs \
  tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture-followup-reproducible-2026-11-17.json \
  tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.sha256
```

The raw-fixture verifier checks saved record structure, source hashes,
Base58/SHA-256 code-hash agreement, receipt encodings, rollback and token
conservation, the exact native cash boundary, and action ordering. It does not
recreate the run or verify receipt Merkle proofs against block headers. Review
all four JSON captures, not only the summary from the runner.

## Reproduction

In a clean checkout, build the exact contract artifact at the pinned source
commit. Do not use the non-reproducible host build for this review:

```sh
git worktree add --detach /tmp/lcp-protocol88-core-950e3cb 950e3cb50fd79f559f5b6ff725fbfa32db70a063
cd /tmp/lcp-protocol88-core-950e3cb
cargo near build reproducible-wasm \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery \
  --out-dir /tmp/lcp-protocol88-review-cache/reproducible-core
shasum -a 256 /tmp/lcp-protocol88-review-cache/reproducible-core/lcp_core.wasm
```

Require the expected digest above. Build the two mock token WASMs with the
checked-out Rust toolchain using the commands in
[`tests/sandbox-usdc-callbacks/README.md`](../../tests/sandbox-usdc-callbacks/README.md).
Create the cache directories and run each harness mode in a clean Docker-backed
Sandbox. Use the pinned Node image above, mount the repository at `/repo` and
the cache at `/sandbox-cache`, and pass
`LCP_CORE_WASM_PATH=/sandbox-cache/reproducible-core/lcp_core.wasm` together
with `LCP_EXPECTED_CORE_WASM_SHA256=4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad`.
Run these four modes separately, writing outputs to fresh paths:

1. Default callback and receipt-order run; set `LCP_FIXTURE_OUTPUT` to a
   temporary JSON path.
2. `LCP_RECOVERY_ONLY=1` for the recovery lifecycle.
3. `LCP_RECOVERY_ONLY=1 LCP_BOOTSTRAP_ACTIVITY_GUARD_ONLY=1` for the
   post-commitment bootstrap guard.
4. `LCP_RECOVERY_ONLY=1 LCP_STORAGE_REGISTRY_OOG_ONLY=1` for revaluation
   rollback and retry.

Compare the behavior and code digest, not ephemeral chain IDs or transaction
hashes. The captures are generated from test fixtures; they are not public
receipt proofs.

For the independent rerun, use the full image reference above in each Docker
command. The harness guide includes runnable commands for each mode; direct
all `LCP_FIXTURE_OUTPUT` values to fresh files under `/sandbox-cache`, not to
the checked-in historical capture paths. The checked-in follow-up captures
must remain unchanged during review.

## Independent review questions

Report each case as reproduced, contradicted, or not exercised. Include exact
commands, tool versions, source and WASM hashes, and receipt-level evidence.

1. Do the four clean reruns pass against the pinned WASM? Does every capture
   agree with its manifest and the asserted final state?
2. Does the raw receipt graph support the recorded transfer mapping, rollback,
   and code-at-action-order claims? Identify any proof or ancestry assumption
   that the captured RPC data cannot establish.
3. Apply the normative receipt-to-intent procedure in
   [`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`](../../P2-USDC-RECEIPT-RECOVERY-DESIGN.md)
   and operator policy annex. Exercise or document the untested cases: multiple
   outgoing token actions/origins, duplicate or ambiguous intent events,
   missing ancestry, conflicting provider data, `SuccessReceiptId` with a
   failing child, unsupported contract-code metadata, historical token code,
   and duplicate-key or noncanonical action arguments. Unsupported or
   ambiguous evidence must yield `Unknown`/abstain.
4. Review migration boundaries beyond the captured activity guard: missing,
   malformed, and mixed sidecars; interrupted initialization; counter/generation
   overflow and restoration; and no resurrection of settled liabilities.
5. Assess the limits of current gas/storage evidence. The 64-row OOG fixture
   shows rollback and retry for that input; it is not a worst-case gas bound or
   production funding recommendation. Identify remaining boundary cases before
   a canary.

The remaining gates include independent review of receipt interpretation and
mapping, migration and worst-case gas/storage boundaries, independent operator
administration and quorum drills, and a separately owner-approved disposable
testnet canary. Do not interpret this package as deployment approval.
