# Gate 5 method-gas capture, 2026-11-19

Local isolated NEAR Sandbox run that supplies the method gas figures the earlier
`recovery-acceptance-2026-11-17-689fbf1` captures do not record. It measures
`finalize_receipt_recovery_intent`, `finalize_receipt_recovery_credit`,
`propose_usdc_code_hash_change`, `cancel_usdc_code_hash_change`,
`activate_usdc_code_hash_change`, `release_usdc_certificate_quarantine`,
`withdraw_receipt_recovery_credit`, and `retire_receipt_recovery_epoch`.

This is a separate artifact on purpose: the committed `689fbf1` and `29ed585`
captures are historical and were not regenerated.

## Provenance

| Item | Value |
| --- | --- |
| Source commit | `a1d4fdc` (plus the uncommitted `run.mjs`/`derive-method-gas.mjs` instrumentation in this change) |
| Core WASM input | reproducible `sandbox-recovery` variant, SHA-256 `e1ed579097c82e212d2d5b75cbaf7253657c602210118ccbf9d0c1225dc19cef`, NEAR code hash `GCve2wgGAyuMLRvCzgkPTaN7kR6iRkvRaPjATAET4UfG` |
| Sandbox | `2.14.0`, protocol 88, nearcore commit `bc4e9e8cfb03d9e82f027883055624e18576993e` |
| Capture | `recovery.json`, SHA-256 listed in `../gate5-method-gas-2026-11-19.sha256` |
| Network | none; `test-chain-` Sandbox only, no public RPC and no testnet funds |
| Reproduction check | 2026-11-19: core artifact rebuilt to the same digest from `a1d4fdc` and the suite re-ran green (159 `PASS`) against the committed runner — see [Reproduction check](#reproduction-check-2026-11-19) |

Run command (from the repository root):

```bash
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc '
    npm ci --ignore-scripts --no-audit --no-fund &&
    NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 \
    LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp \
    LCP_CORE_WASM_PATH=/sandbox-cache/head-core/lcp_core.wasm \
    LCP_EXPECTED_CORE_WASM_SHA256=e1ed579097c82e212d2d5b75cbaf7253657c602210118ccbf9d0c1225dc19cef \
    LCP_FIXTURE_OUTPUT=/repo/target/gate5-method-gas-capture-2026-11-19.json \
    node run.mjs'
```

The run printed `All isolated receipt-recovery Sandbox checks passed; no public
network was used.` and exited 0 (159 `PASS` lines).

## Gas fields added by this capture

Each value is the gas burnt by the **outer care-of contract-call receipt**
(`receipts_outcome[0]`, executor `lcp-core-sandbox.sandbox`), which is the
execution a caller's prepaid gas must cover. Callback and delayed receipts carry
their own gas allocations and are not summed.

| Scenario | Field | Method |
| --- | --- | --- |
| `failed_transfer_recovery` | `quarantine_release_receipt_gas_burnt` | `release_usdc_certificate_quarantine` |
| `recovery_credit` | `storage_release_receipt_gas_burnt` | `finalize_receipt_recovery_intent` |
| `recovery_credit` | `exact_withdrawal_receipt_gas_burnt` | `withdraw_receipt_recovery_credit` |
| `recovery_credit_tombstone_finalize` | `intent_finalization_receipt_gas_burnt` | `finalize_receipt_recovery_intent` |
| `recovery_credit_tombstone_finalize` | `finalize_receipt_gas_burnt` | `finalize_receipt_recovery_credit` |
| `governance` | `retire_epoch_receipt_gas_burnt` | `retire_receipt_recovery_epoch` |
| `code_hash_change` | `propose_receipt_gas_burnt` | `propose_usdc_code_hash_change` |
| `code_hash_change` | `cancel_receipt_gas_burnt` | `cancel_usdc_code_hash_change` |
| `code_hash_change` | `activation_propose_receipt_gas_burnt` | `propose_usdc_code_hash_change` |
| `code_hash_change` | `activate_receipt_gas_burnt` | `activate_usdc_code_hash_change` |

## Measurement notes

- `recovery_credit_tombstone_finalize` creates a settled zero-credit tombstone:
  a payer withdrawal is settled by the fixture while the storage reserve is
  marked stale, so the callback leaves the row settled at zero accrued credit
  until maintenance runs. The capture records the blocked finalize, the
  revaluation batches, and the final close.
- The code-hash flow runs after governance and before the scenarios that
  deliberately drive the native ledger to its solvency floor. It funds a local
  two-NEAR margin first (`margin_top_up_*`, `free_native_cash_*` in the capture)
  so the production-shaped one-NEAR proposal deposit is measured against a
  healthy ledger. Existing intents keep the hash copied at creation, so the
  later activation only affects intents created afterwards.
- Gas figures are Sandbox measurements, not worst-case guarantees. Apply the
  margin with `node tests/sandbox-usdc-callbacks/derive-method-gas.mjs`.

## Reproduction check, 2026-11-19

The pinned core artifact was rebuilt from the recorded source commit in a fresh
worktree, which reproduces the digest in the provenance table rather than
trusting the cache:

```sh
git worktree add --detach /tmp/lcp-p2-repro-a1d4fdc a1d4fdc
cd /tmp/lcp-p2-repro-a1d4fdc
cargo near build reproducible-wasm \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery --out-dir /tmp/lcp-near-sandbox-cache/head-core
```

The build reported 1,226,309 bytes, SHA-256
`e1ed579097c82e212d2d5b75cbaf7253657c602210118ccbf9d0c1225dc19cef`, and NEAR code
hash `GCve2wgGAyuMLRvCzgkPTaN7kR6iRkvRaPjATAET4UfG` — the same artifact the
primary capture pinned, rebuilt from the same commit through the digest-pinned
`sourcescan/cargo-near` image.

The recovery-only suite was then re-run against that artifact with the run
command above (only `LCP_FIXTURE_OUTPUT` pointed at a scratch path). It exited
0, printed 159 `PASS` lines plus `All isolated receipt-recovery Sandbox checks
passed; no public network was used.`, and wrote
[`reproduction-recovery.json`](reproduction-recovery.json) (SHA-256
`639388e424ff7531d43617e483342ecb6441937f9c7928ce1e0f535ac538f3e7`, listed in
`../gate5-method-gas-2026-11-19.reproduction.sha256`). The run covers the tail:
`recovery_credit_tombstone_finalize` passed with its existing assertions
unchanged, so the tail-margin rule in `../README.md` still applies to any new
cash-asserting call added there.

Gas is not bit-identical across runs. All 14 `*_gas_burnt` fields were compared:
3 match the primary capture exactly and the other 11 differ by 0.03%–0.48%
(largest: `code_hash_change.propose_receipt_gas_burnt`), with account balances
tracking those differences. That spread is an order of magnitude below the 1.5×
floors in `derive-method-gas.mjs`, and the values quoted above still come from
the primary capture, which remains the authoritative measurement sample. Use
this second capture to check that a change did not move a method, not as a
replacement sample.
