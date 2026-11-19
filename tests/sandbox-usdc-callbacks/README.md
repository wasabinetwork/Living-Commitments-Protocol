# USDC and native cash Sandbox acceptance

This isolated harness runs the real NEAR VM callback path against NEAR Sandbox
and a small mock NEP-141 token. It does not deploy to testnet or read
`.env.testnet`. The fixture-only core requires a Sandbox `test-chain-*` chain
and account `lcp-core-sandbox.sandbox`; never deploy its WASM to a public
network. The core initializer also creates the recovery storage-reserve
sidecar, and the native cash gate checks that it is current and solvent. The
recovery acceptance runner below creates intents and payer credits and
exercises their lifecycle in Sandbox.

## Quarantine recovery capture — 2026-11-17

Source commit `29ed5853e9b49b23018a6434b16768ba956bf9f8` quarantines a
certificate `Failure` and releases it only when the shared token balance
covers every gross unit. The pinned reproducible `sandbox-recovery` build
used `sourcescan/cargo-near:0.23.0-rust-1.100.0` at image digest
`sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`
and produced WASM SHA-256
`0fee5f62932238054322e4817fc9e0dcc9b271f6d8a10f2b51e9df3e6c31ca0b` and
NEAR code hash `25Bw8xcjfSQoAUzABmrpNd9zGLrs65Nj2tLxciFnAVsG`. The owner
ran `LCP_RECOVERY_ONLY=1` in `node:26-trixie-slim` at
`sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc`
on Sandbox 2.14.0, protocol 88. No public network or `.env.testnet`
credentials were used.

The capture is
[`recovery-acceptance-2026-11-17-29ed585/recovery.json`](recovery-acceptance-2026-11-17-29ed585/recovery.json).
Commitment 104 ends the failed transfer with `quarantined_raw` `1000000`
and `free_raw` `0`, then `release_usdc_certificate_quarantine` restores
`free_raw` `1000000`, and the retry pays `1000000` once. Its source
manifest is
[`recovery-acceptance-2026-11-17-29ed585.sha256`](recovery-acceptance-2026-11-17-29ed585.sha256)
and its tooling manifest is
[`recovery-acceptance-2026-11-17-29ed585.tooling.sha256`](recovery-acceptance-2026-11-17-29ed585.tooling.sha256).
This is owner-run local evidence. It does not replace an independent
reproduction, and it is not canary approval. The `689fbf1` captures below
remain the evidence for that older source. Do not regenerate their
manifests.

## Gate 5 method-gas capture — 2026-11-19

The older capture sets record summarized scenario fields, not the transaction
outcomes for every recovery method. This separate capture fills the Gate 5 gas
rows that had no committed figure: `finalize_receipt_recovery_intent`,
`finalize_receipt_recovery_credit`, `propose`/`cancel`/`activate_usdc_code_hash_change`,
`release_usdc_certificate_quarantine`, `withdraw_receipt_recovery_credit`, and
`retire_receipt_recovery_epoch`. It was produced from source `a1d4fdc` with the
reproducible `sandbox-recovery` build (WASM SHA-256
`e1ed579097c82e212d2d5b75cbaf7253657c602210118ccbf9d0c1225dc19cef`) on isolated
Sandbox 2.14.0, protocol 88; no public network was used. Each figure is the gas
burnt by the outer contract-call receipt, which is the execution a caller's
prepaid gas must cover.

The capture is [`gate5-method-gas-2026-11-19/recovery.json`](gate5-method-gas-2026-11-19/recovery.json)
with provenance in its [README](gate5-method-gas-2026-11-19/README.md), a source
manifest in [`gate5-method-gas-2026-11-19.sha256`](gate5-method-gas-2026-11-19.sha256),
and a tooling manifest in
[`gate5-method-gas-2026-11-19.tooling.sha256`](gate5-method-gas-2026-11-19.tooling.sha256).
`node tests/sandbox-usdc-callbacks/derive-method-gas.mjs` reads it together with
the `689fbf1` captures and now reports every policy method as measured. The
`689fbf1` and `29ed585` captures were not regenerated.

## Rotation with a live intent and in-place upgrade — 2026-11-19

Source commit `e47b19440aa71def96f3a0ccd349c0f11b0fbd79` adds a Gate 4
scenario that rotates the committee while a tranche intent is still pending,
redeploys the same core artifact over the live state, and settles that intent
with the retained epoch's signatures before the keyset can be retired. The
pinned reproducible `sandbox-recovery` build produced WASM SHA-256
`de9dc7cfed3e6f9b9b47350e257381a77ddc7f765b347173e89e926cde06a192` (NEAR code
hash `Fz13ws3yxBWcuAd7FHtYvR3EwpfpaJTcVi8BxbBHkWxH`). The run used
`LCP_RECOVERY_ONLY=1` in `node:26-trixie-slim` at
`sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` on
Sandbox 2.14.0, protocol 88; no public network was used.

The capture is
[`rotation-live-intent-acceptance-2026-11-19/recovery.json`](rotation-live-intent-acceptance-2026-11-19/recovery.json)
with provenance in its [README](rotation-live-intent-acceptance-2026-11-19/README.md).
Transfer 9 is pending under epoch 1, `retire_receipt_recovery_epoch(1)` returns
`false`, generation 3 activates epoch 2, the unchanged artifact is redeployed,
and the instance ID, epoch, used-key count, generation, pending intent, storage
record count, and native cash ledger compare equal across the upgrade. Transfer
10 then allocates after the upgrade, the epoch-1 committee settles transfer 9
(`paid_raw` `1000000`), and retiring epoch 1 finally returns `true`. Its source
manifest is
[`rotation-live-intent-acceptance-2026-11-19.sha256`](rotation-live-intent-acceptance-2026-11-19.sha256)
and its tooling manifest is
[`rotation-live-intent-acceptance-2026-11-19.tooling.sha256`](rotation-live-intent-acceptance-2026-11-19.tooling.sha256).
The `689fbf1`, `29ed585`, and Gate 5 captures were not regenerated. This is
same-operator local evidence; the production seven-day rotation cycle and an
independent reproduction remain open.

## Historical local acceptance candidate — 689fbf1

The recovery source for this older capture set is commit
`689fbf1bc464248b5a6ff019983ef8b415dcd819`. The pinned reproducible build
used `sourcescan/cargo-near:0.23.0-rust-1.100.0` at image digest
`sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`
and produced WASM SHA-256
`890daa7778517b949232e62efb1cdb75b3290858f578920758c53d3761e3be80` and
NEAR code hash `ADzwZkqufSWSr5S3SBYCh885tiFzCeuYoTBHyh9G5yEX`. Eight fresh
captures were generated with this artifact on isolated Sandbox 2.14.0,
protocol 88, using the pinned Node runner image documented below. No public
network or `.env.testnet` credentials were used.

That capture set is in
[`recovery-acceptance-2026-11-17-689fbf1/`](recovery-acceptance-2026-11-17-689fbf1/):

- `protocol-88.json` — native callback rollback, token transfer failure and
  retry, concurrent claims, action ordering, and escrow conservation.
- `recovery.json` — certificate parsing and rejection cases, committee
  rotation, callback and certificate races, native cash accounting, and
  recovery-credit settlement.
- `bootstrap-guard.json` — bootstrap rejection after commitment activity.
- `storage-oog.json` — 64-record reserve-revaluation out-of-gas rollback,
  invalid cursor and batch rejection, then successful retry.
- `usdc-claim.json` and `usdc-refund.json` — NEP-141 claim/refund cash gates,
  failed transfer recovery, retry, and excess-deposit credit withdrawal.
- `storage-registry-cap.json` — admission through 2,048 registry records,
  rejection of record 2,049, 32 revaluation batches, reserve-view transitions,
  and idempotent completion. The measured 2,045 short-payer rows used 961,150
  bytes; the highest 64-record revaluation batch used 11.805 Tgas.
- `storage-shape.json` — 64 rows with a 64-character payer ID used 33,728
  bytes (527 bytes per row); its largest revaluation batch used 11.805 Tgas.

These captures validate the contract and accounting paths, not receipt-to-intent
mapping. They use fixture-signed recovery certificates; the implementation
does not yet provide a production signer/operator that maps real NEAR receipt
metadata to an intent. The independent review found eight normative mapping
cases remain untestable, including multiple origins, batched actions, V4 action
ordering, failing child receipts, missing ancestry, and unsupported metadata.
Do not treat these local results as a testnet-canary or deployment approval.
The false-`Failure` quorum risk for pooled USDC and frozen token/hash settings
after bootstrap remain explicit design gates.

Regenerate the current capture/source manifest from the repository root after
changing a capture or its contract/build inputs:

```sh
shasum -a 256 \
  tests/sandbox-usdc-callbacks/recovery-acceptance-2026-11-17-689fbf1/*.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  > tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256
```

The separate tooling manifest pins the runner, package lock, verifier tests,
and README. Regenerate both manifests only after the capture and tooling edits
are complete:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/run.mjs \
  tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs \
  tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs \
  tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs \
  tests/sandbox-usdc-callbacks/verify-storage-registry-capture.mjs \
  tests/sandbox-usdc-callbacks/test/storage-registry-capture.test.mjs \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  > tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/p2-usdc-recovery-local-acceptance-2026-11-17.tooling.sha256
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs
node tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs
node tests/sandbox-usdc-callbacks/verify-storage-registry-capture.mjs
node --test tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs \
  tests/sandbox-usdc-callbacks/test/storage-registry-capture.test.mjs
```

The source manifest intentionally excludes mutable planning/review documents;
the Git commit records their revision. Historical captures and their manifests
remain available below and retain their original dates and artifact identities.

From the repository root, build the optimized fixture core and both mock-token
artifacts. The local Sandbox RPC rejects the larger unoptimized core artifact.

```sh
cargo install cargo-near --version 0.23.0 --locked
mkdir -p /tmp/lcp-near-sandbox-cache/wasm-opt-default \
  target/wasm32-unknown-unknown/release
cargo near build non-reproducible-wasm --locked --no-abi \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --features sandbox-callback-fixture \
  --out-dir /tmp/lcp-near-sandbox-cache/wasm-opt-default
cp /tmp/lcp-near-sandbox-cache/wasm-opt-default/lcp_core.wasm \
  target/wasm32-unknown-unknown/release/lcp_core.wasm
tests/sandbox-usdc-callbacks/build-mock-tokens-pinned.sh
```

The mock-token script builds both NEP-141 artifacts inside the pinned
`sourcescan/cargo-near:0.23.0-rust-1.100.0` image and prints their digests. A
host `cargo build` of the same source produces different digests and is not the
canonical reproduction build.

The harness uses the pinned `near-sandbox` package to start NEAR Sandbox 2.14.0
inside a Linux x86_64 container with glibc 2.38 or newer. It signs local test
transactions with Node's built-in Ed25519 support; no external wallet key is
needed. A `tar` override pins the transitive archive library to a patched
release, avoiding the legacy `near-workspaces`/`near-api-js` dependency stack.

```sh
mkdir -p /tmp/lcp-near-sandbox-cache/bin /tmp/lcp-near-sandbox-cache/tmp
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/sandbox-cache/protocol-88-receipt-fixture-local.json node run.mjs'
```

To run only the native cash boundary probe, add `LCP_CASH_GATE_ONLY=1` before
`node run.mjs`. The probe distinguishes creation of the lazy Rust SDK `Promise`
builder from materialization of its host action: it samples balance before and
after builder creation, explicitly drops the builder, then samples again. The
pinned nearcore host deducts the attached transfer value when the action is
materialized. The contract therefore records the complete planned receipt
outflow in `X` and gates before creating/dropping the corresponding builders. The
probe rejects a one-yocto shortfall, accepts the exact-balance control, and
confirms the recipient is credited after settlement. The historical receipt
fixture predates this builder-versus-host measurement and must be regenerated
when the follow-up Sandbox acceptance is run.

To run only the actual OutLayer `request_evaluation` dispatch matrix, use the
same optimized fixture core and mock-token artifacts, then run:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_OUTLAYER_DISPATCH_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_OUTLAYER_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/outlayer-dispatch-sandbox-acceptance-2026-11-16.json node run.mjs'
```

This focused protocol-88 run seeds one commitment with exactly 0.01 NEAR of
operations funding and a second one yocto below that amount. It discovers the
first commitment's storage bond through an expected, rolled-back underpayment,
rejects a one-yocto-short retry without dispatch, then submits with the exact
bond at zero pre-existing free cash. The evaluator receiver intentionally has
no code. Its request receipt fails, the failed action's 0.01 NEAR deposit is
returned to the core, the callback marks the evaluation failed, and the
operations-spend counter remains charged for that amount. The capture checks
the evaluator's unchanged balance and the core's exact retained storage bond;
the underfunded commitment is rejected before evaluation state or an evaluator
receipt is created. This heartbeat acceptance capture does not test service
scheduling, hosted OutLayer behavior, or real-network latency and refunds. Its
receipt and state capture is
[`outlayer-dispatch-sandbox-acceptance-2026-11-16.json`](outlayer-dispatch-sandbox-acceptance-2026-11-16.json), with its [checksum manifest](outlayer-dispatch-sandbox-acceptance-2026-11-16.sha256). This proves local LCP dispatch accounting and failure handling; it
does not validate the hosted OutLayer service or real-network latency and
refunds.

To exercise the service-source evaluator scheduler separately, run:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_SERVICE_OUTLAYER_DISPATCH_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_SERVICE_OUTLAYER_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/service-outlayer-dispatch-sandbox-acceptance-2026-11-16.json node run.mjs'
```

This mode fixture-seeds an active v3 service commitment because the canonical
OutLayer account cannot be installed in Sandbox. It creates an ephemeral
Ed25519 source key, confirms the policy pins it, and verifies a validly signed,
policy-bound report before calling the production
`request_service_evaluation` entry point and shared
`schedule_service_evaluation` implementation. At zero free cash, the exact
measured storage bond dispatches to an evaluator account with no code; its
failed receipt returns the 0.01 NEAR deposit while operations spend remains
charged. A one-yocto-short storage bond and one-yocto-short operations balance
both reject without dispatch. This covers the legacy signed-report route; it
does not cover hosted OutLayer execution or service evaluator result
validation. See the captured
[service-dispatch receipt and state](service-outlayer-dispatch-sandbox-acceptance-2026-11-16.json)
and its [checksum manifest](service-outlayer-dispatch-sandbox-acceptance-2026-11-16.sha256).

To exercise the transaction-authenticated service report inbox path, run:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_SERVICE_INBOX_OUTLAYER_DISPATCH_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_SERVICE_INBOX_OUTLAYER_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/service-inbox-outlayer-dispatch-sandbox-acceptance-2026-11-16.json node run.mjs'
```

This mode fixture-seeds a v2 service policy with transaction-authenticated
operator provenance, then stages a report from each configured operator
account through the production `submit_service_report` method. An
underfunded-operations attempt and a one-yocto-short evaluation storage bond
both fail without consuming either staged report. The exact evaluation storage
bond dispatches through production `request_service_evaluation_from_inbox` and
`schedule_service_evaluation` to the same no-code evaluator. Successful
scheduling consumes both reports and converts their separately measured
storage deposits (0.012 and 0.01238 NEAR in this fixture) into account-specific
operator refund credits. The failed evaluator action returns its 0.01 NEAR
execution deposit, while operations spend remains charged and both refund
liabilities stay accounted. This verifies the local multi-operator inbox
dispatch and cash-accounting path, not evaluator quorum/verdict validation or
hosted OutLayer execution. See the captured
[inbox-dispatch receipt and state](service-inbox-outlayer-dispatch-sandbox-acceptance-2026-11-16.json)
and its [checksum manifest](service-inbox-outlayer-dispatch-sandbox-acceptance-2026-11-16.sha256).

Regenerate the service-dispatch capture manifest after a rerun or any source
or document change:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/service-outlayer-dispatch-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  evaluators/service-availability/src/main.rs evaluators/service-availability/probe.mjs \
  evaluators/service-availability/test/probe.test.mjs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  TODO.md P2-USDC-RECEIPT-RECOVERY-DESIGN.md \
  > tests/sandbox-usdc-callbacks/service-outlayer-dispatch-sandbox-acceptance-2026-11-16.sha256
```

Regenerate the inbox-dispatch capture manifest after a rerun or any source or
document change:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/service-inbox-outlayer-dispatch-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  evaluators/service-availability/src/main.rs evaluators/service-availability/probe.mjs \
  evaluators/service-availability/test/probe.test.mjs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  TODO.md P2-USDC-RECEIPT-RECOVERY-DESIGN.md \
  > tests/sandbox-usdc-callbacks/service-inbox-outlayer-dispatch-sandbox-acceptance-2026-11-16.sha256
```

Regenerate the capture manifest after a rerun or any source/document change:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/outlayer-dispatch-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  > tests/sandbox-usdc-callbacks/outlayer-dispatch-sandbox-acceptance-2026-11-16.sha256
```

The full run also funds the isolated core account with a plain NEAR `Transfer`
action and checks that its balance increases by at least the transferred
amount; the observed delta can also include an unrelated pending gas refund. This
demonstrates the test-instance liquidity top-up path without calling a contract
method or crediting escrow, USDC, or evaluator operations state.

The harness also seeds a fixture-only claimable native tranche and exercises the
production `claim_tranche` path. It first routes the payment to a missing account,
then confirms the callback marks the tranche `Failed`, restores the escrow to
`free`, and retains the native escrow liability. Retrying the same epoch pays the
beneficiary, marks the tranche `Paid`, and releases that liability. The attached
storage-deposit excess is returned through its callback and its temporary refund
liability is confirmed cleared. A 24-hour epoch and one-hour evidence lifetime
keep the retry eligible across Sandbox receipt delays.

The same run exercises the production `refund_remaining`,
`refund_unused_operations`, and `withdraw_storage_refund` entry points using
fixture-only missing-recipient overrides. Each failed callback restores the
sponsor's free escrow, unused-operations balance, or storage-refund credit and
keeps its liability accounted. A retry to the intended sponsor or payer settles
once and clears the matching liability. The receipt fixture stores all four
native-flow trees under `native_claim_callback`,
`native_escrow_refund_callback`, `native_operations_refund_callback`, and
`native_storage_credit_callback`. A fixture-only recovery-credit liability
also measures free-cash margins without moving funds. With a 0.01 NEAR escrow
refund and a 1 NEAR attached deposit, a 0.01 NEAR free margin is rejected
before the refund request is emitted and leaves the escrow and cash snapshot
unchanged; a conservative 1.07 NEAR margin allows the failure/retry flow to
settle. A 0.005 NEAR storage credit likewise rejects a 0.005 NEAR margin and
passes failure/retry at 0.06 NEAR. These checks bound tested behavior, not the
minimum margin or a production funding rule. An eight-receipt delayed callback
case is measured below; it does not establish real-network callback latency or
a production funding rule. The deliberately out-of-gas callback case is also
described below.

The harness confirms callback out-of-gas reservation behavior, explicit token
failure and retry, missing-code failure before contract execution, and rollback
after the mock token writes balances and panics. It also withdraws a 0.005 NEAR
native refund with a deliberately underfunded 1 Tgas callback: the transfer
succeeds, the callback runs out of gas, the available credit remains zero, and
the 0.005 NEAR liability remains recorded. The measured free cash after that
transfer was 0.05482 NEAR from a 0.06 NEAR pre-withdrawal margin. This is local
evidence of the pending state, not a funding recommendation or proof that an
arbitrarily delayed native callback can be recovered; native-cash receipt-proof
recovery is not implemented. USDC-specific receipt recovery is a separate,
feature-gated path covered below. The harness captures raw receipt outcomes and protocol-88 V4
contract metadata in
[`protocol-88-receipt-fixture.json`](protocol-88-receipt-fixture.json). A second
mock WASM code hash checks both action orders: `FunctionCall A → Deploy B` and
`Deploy B → FunctionCall`; V4 metadata identifies the code active for each
action. The capture records each WASM SHA-256 alongside its NEAR code hash.
Four concurrently submitted equal-amount transfers for distinct commitments
also settle independently. Token balances, tranche states, and raw-unit
conservation are asserted. The cache path may be changed to any writable
directory outside the checkout.

The captured node reports NEAR Sandbox 2.14.0, protocol 88, nearcore commit
`bc4e9e8cfb03d9e82f027883055624e18576993e`. The original
[`protocol-88-receipt-fixture.json`](protocol-88-receipt-fixture.json) is a
historical capture pinned to source commit `1a894926ecc6d0d6705594b7add2b21d7fff5f86`;
verify it at that detached revision because later runner and contract changes
intentionally make its historical manifest differ from the current checkout.
Keep that capture and manifest unchanged.

The 2026-11-17 follow-up reran the callback/rollback and receipt-order matrix
with the reproducible recovery WASM SHA-256
`4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad` / NEAR
code hash `6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212`. The capture set includes
the [raw protocol-88 fixture](protocol-88-receipt-fixture-followup-reproducible-2026-11-17.json),
[recovery lifecycle](receipt-recovery-sandbox-acceptance-followup-reproducible-2026-11-17.json),
[bootstrap-after-activity guard](bootstrap-activity-guard-followup-reproducible-2026-11-17.json),
and [storage revaluation OOG rollback/retry](storage-registry-oog-followup-reproducible-2026-11-17.json).
All four use Sandbox 2.14.0/protocol 88. The source manifest pins the captures
and contract/build inputs; the tooling manifest separately pins the runner,
both capture verifiers, the bootstrap-verifier test, and package metadata.
Verify them from the repository root:

```sh
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs \
  tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture-followup-reproducible-2026-11-17.json \
  tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.tooling.sha256
```

The integrity checker confirms source hashes, Base58/SHA-256 code-hash
agreement, receipt hash encodings, rollback and conservation outcomes, exact
cash boundary, and action order. It validates saved records; it does not
independently rerun Sandbox or verify receipt Merkle proofs against block
headers. This recapture remains owner-side local evidence and is not an
independent operator-receipt review, testnet canary, or deployment approval.

The [independent follow-up review package](../../audit/p2-protocol88-followup-2026-11-17/README.md)
contains the pinned reproducible core and Node container digests, acceptance
scope, and review questions. It is the handoff for an independent local rerun.
Regenerate the two follow-up manifests only when intentionally replacing or
revising this capture set:

```sh
shasum -a 256 \
  tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture-followup-reproducible-2026-11-17.json \
  tests/sandbox-usdc-callbacks/receipt-recovery-sandbox-acceptance-followup-reproducible-2026-11-17.json \
  tests/sandbox-usdc-callbacks/bootstrap-activity-guard-followup-reproducible-2026-11-17.json \
  tests/sandbox-usdc-callbacks/storage-registry-oog-followup-reproducible-2026-11-17.json \
  Cargo.toml Cargo.lock rust-toolchain.toml \
  contracts/lcp-core/Cargo.toml contracts/lcp-core/src/contract.rs \
  contracts/lcp-core/src/lib.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs \
  contracts/lcp-core/src/recovery_config.rs contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  > tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.sha256
shasum -a 256 \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs \
  tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs \
  tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs \
  tests/sandbox-usdc-callbacks/package.json \
  tests/sandbox-usdc-callbacks/package-lock.json \
  > tests/sandbox-usdc-callbacks/protocol-88-followup-reproducible-2026-11-17.tooling.sha256
```

## Native callback and rollback VM/Sandbox acceptance

The November 16, 2026 full run passed the native cash gate, failed and successful
claim/refund callbacks, storage-credit callback and its 1 Tgas out-of-gas case,
liquidity margin checks, NEP-141 pre-execution and post-mutation rollback cases,
successful transfer control, and both transfer/deploy action orders. Its
captured Sandbox protocol-88 results and exact WASM digests are in
[`native-callbacks-sandbox-acceptance-2026-11-16.json`](native-callbacks-sandbox-acceptance-2026-11-16.json);
source and artifact hashes are in
[`native-callbacks-sandbox-acceptance-2026-11-16.sha256`](native-callbacks-sandbox-acceptance-2026-11-16.sha256).
This run uses the default fixture build without `usdc-receipt-recovery`.

To reproduce it, build the default fixture artifacts using the commands above,
then run from the repository root:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/native-callbacks-sandbox-acceptance-2026-11-16.json node run.mjs'
```

Regenerate the checksum manifest after a new run or source change:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/native-callbacks-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/native_cash.rs contracts/lcp-core/src/recovery_accounting.rs \
  contracts/lcp-core/src/recovery_config.rs contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  > tests/sandbox-usdc-callbacks/native-callbacks-sandbox-acceptance-2026-11-16.sha256
```

## Receipt-recovery VM/Sandbox acceptance

Build the fixture-enabled recovery core and both mock-token variants. Install
the pinned Cargo NEAR CLI if needed, then use its Wasm optimization step for the
recovery core. Plain `cargo build` output is 1,575,617 bytes and exceeds the
local Sandbox RPC server's HTTP request-body limit during deployment; the
optimized fixture from the November 16 run is 1,129,401 bytes and deploys
successfully. This is a local harness transport constraint, not a NEAR
consensus size-limit result.
The following enables receipt recovery and the test-only ten-second governance
delay, and overwrites the core WASM from the earlier default build:

```sh
cargo install cargo-near --version 0.23.0 --locked
mkdir -p /tmp/lcp-near-sandbox-cache/wasm-opt-output target/wasm32-unknown-unknown/release
cargo near build non-reproducible-wasm --locked --no-abi \
  --features 'sandbox-callback-fixture usdc-receipt-recovery' \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --out-dir /tmp/lcp-near-sandbox-cache/wasm-opt-output
cp /tmp/lcp-near-sandbox-cache/wasm-opt-output/lcp_core.wasm \
  target/wasm32-unknown-unknown/release/lcp_core.wasm
```

Then run only the recovery lifecycle with:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/receipt-recovery-sandbox-acceptance-2026-11-16.json node run.mjs'
```

To verify that the production `create_commitment` entry point blocks recovery
bootstrap on a fresh instance after a commitment has been recorded, run the
focused activity-guard case:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_BOOTSTRAP_ACTIVITY_GUARD_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_CORE_WASM_PATH=/sandbox-cache/reproducible-core/lcp_core.wasm LCP_EXPECTED_CORE_WASM_SHA256=4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad LCP_FIXTURE_OUTPUT=/sandbox-cache/bootstrap-activity-guard-local.json node run.mjs'
```

The fixture deploys a second fresh core, calls `new`, creates a real draft
through `create_commitment`, then submits recovery bootstrap. The bootstrap
transaction must fail, the commitment must remain queryable, and recovery
configuration must remain absent. This is local Sandbox evidence for the
commitment counter guard; challenge and transfer counters have separate
feature-gated unit tests because those actions require a commitment first.
It does not contact testnet or alter a deployed contract.

The earlier [bootstrap guard capture](bootstrap-activity-guard-sandbox-acceptance-2026-11-17-reproducible.json)
is retained as a historical record with its original manifest; that manifest
also pinned mutable documentation and is no longer the canonical verification
path. The current [follow-up capture](bootstrap-activity-guard-followup-reproducible-2026-11-17.json)
stores both finalized transaction graphs, including the receipt body fetched by
receipt ID when `EXPERIMENTAL_tx_status` omitted it. The verifier defaults to
the follow-up capture and the split source/tooling manifests:

```sh
node tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs
node --test tests/sandbox-usdc-callbacks/test/bootstrap-activity-guard-capture.test.mjs
```

The earlier `bootstrap-activity-guard-sandbox-acceptance-2026-11-17-clean-build.json`
is retained as a diagnostic capture from the plain Rust build. The verifier and
mutation tests use the pinned reproducible artifact capture above. The native
plain-build comparison remains available as a [diagnostic capture](native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-clean-build.json)
with its [manifest](native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-clean-build.sha256).

To run only the production NEP-141 tranche-claim cash-gate case, add
`LCP_USDC_CLAIM_ONLY=1` while keeping `LCP_RECOVERY_ONLY=1`:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_USDC_CLAIM_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.json node run.mjs'
```

The isolated case seeds a claimable NEP-141 tranche, discovers the exact
measured storage plus transfer deposit, then calls production `claim_tranche`
with no free native-cash margin. It confirms the mock token receives the
required 1 yoctoNEAR for `ft_transfer`, the beneficiary receives one tranche,
the callback settles the intent, and the native cash ledger remains solvent.
This validates local action accounting; it does not measure a real USDC
contract's gas or storage behavior. The November 16, 2026 run passed at
Sandbox protocol 88: the claim settled `1,234,567` raw token units, the token
callback recorded success, and the contract retained `0.00436 NEAR` after
storage accounting. The receipt capture and source hashes are in
[`nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.json`](nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.json)
and its [checksum manifest](nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.sha256).

Regenerate and verify the receipt/source manifest after rerunning or changing
the acceptance inputs:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  TODO.md P2-USDC-RECEIPT-RECOVERY-DESIGN.md P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md \
  > tests/sandbox-usdc-callbacks/nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/nep141-claim-cash-gate-sandbox-acceptance-2026-11-16.sha256
```

To run the production NEP-141 escrow-refund path in the same recovery-enabled
fixture build, use `LCP_USDC_REFUND_ONLY=1`:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_USDC_REFUND_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.json node run.mjs'
```

The refund case seeds a closed NEP-141 commitment, discovers the exact storage
plus transfer deposit, then calls production `refund_remaining` from the
sponsor with zero starting free native-cash margin. It first forces a token
failure and confirms the callback restores the full refundable balance and
marks that attempt terminal-failure. A new transfer ID then retries with the
measured storage and 1 yoctoNEAR transfer deposit plus `0.01 NEAR` excess. The
mock token enforces its 1 yoctoNEAR `ft_transfer` deposit, the sponsor receives
the remaining token escrow, and the callback records the refund and
terminal-success intent. Finalizing that intent releases its storage bond to
the same persisted payer credit as the deposit excess. The credit is larger
than the available free margin, so it is not withdrawable yet. After setting
exactly the credit amount as free margin, the sponsor withdraws it through
the production callback, and the balance delta reconciles after measured
transaction fees. On November 16,
2026, the protocol-88 Sandbox retry settled `2,345,678` raw units, produced a
`0.01742 NEAR` payer credit (`0.01 NEAR` excess plus its released storage bond),
and had `0.0041 NEAR` free margin after token settlement; the exact-margin
credit withdrawal then completed while preserving native solvency. This
validates the local mock-token path, not Circle USDC's runtime.
Capture and source hashes:
[`nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.json`](nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.json)
and [checksum manifest](nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.sha256).

Regenerate and verify the refund receipt/source manifest after rerunning or
changing the acceptance inputs:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  TODO.md P2-USDC-RECEIPT-RECOVERY-DESIGN.md P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md \
  > tests/sandbox-usdc-callbacks/nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/nep141-refund-cash-gate-sandbox-acceptance-2026-11-16.sha256
```

To exercise a failed native excess-storage-refund callback and recover through
the production legacy payer-credit withdrawal, set
`LCP_NATIVE_EXCESS_REFUND_ONLY=1` and select the pinned reproducible core:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_NATIVE_EXCESS_REFUND_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_CORE_WASM_PATH=/sandbox-cache/reproducible-core/lcp_core.wasm LCP_EXPECTED_CORE_WASM_SHA256=4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json node run.mjs'
```

The feature-gated fixture sends an attached `0.01 NEAR` deposit through the
production `refund_excess` accounting and callback, but directs the transfer to
a deliberately nonexistent Sandbox account. The callback restores the exact
amount as a withdrawable payer credit. A withdrawal with only `0.01 NEAR` free
margin is rejected before scheduling the transfer because the persisted
withdrawal attempt increases measured storage by `0.00026 NEAR`. With exactly
`0.01026 NEAR` free margin, the production withdrawal and callback settle once;
the final payer balance reconciles to the `0.01 NEAR` credit after measured
transaction fees, and the native cash ledger remains solvent. A second
withdrawal after settlement fails without requesting another transfer. The
runner requests `EXPERIMENTAL_tx_status` with `wait_until: "FINAL"` and stores
every raw receipt body and execution outcome; the verifier requires a closed
child graph. Recent nearcore versions do not wait for gas-refund receipts by
default, so this explicit finality setting prevents partial receipt captures
([nearcore changelog](https://github.com/near/nearcore/blob/master/CHANGELOG.md)).
The first November 17 capture is retained as historical evidence; it records
WASM hash `33997ebb…781872`. The independent follow-up and an owner clean build
both produced `0f194b53…714963` (NEAR code hash
`21wVBHeifP1dEmASeZgxurf554cwyPVyvfDK6QecDQjt`). These plain builds did not
embed NEP-330 source metadata. The pinned `sandbox-recovery` NEP-330 build from
contract source commit `950e3cb50fd79f559f5b6ff725fbfa32db70a063` produced
`4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad` (NEAR
code hash `6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212`) on two independent
build invocations. NEP-330 embeds the source revision and build environment,
so this exact output is tied to that commit and pinned container digest. The
plain-build captures remain diagnostic and are not used as the current
acceptance candidate.
The runner accepts `LCP_CORE_WASM_PATH` and
`LCP_EXPECTED_CORE_WASM_SHA256`; it rejects a digest mismatch before deploying.
The fresh protocol-88 run using the pinned reproducible binary is captured in
[`native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json`](native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json)
with its [source checksum manifest](native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256).
The E1/E2 independent follow-up scope and reproduction checklist are in the
[review handoff](../../P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-REVIEW.md).
The original November 16 capture and manifest remain unchanged; verify that
historical manifest at its pinned source revision rather than against refreshed
files.
The missing-recipient method and override exist only in the
`sandbox-callback-fixture` build; this is local Sandbox evidence, not a testnet
transfer or a production deployment.

Run the separate capture checker and its mutation checks from the repository root:

```sh
node tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs
node --test tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs
```

The checker pins the NEP-330 reproducible fixture WASM hash and code hash, exact storage
growth, transaction roots, final execution status, root-reachable receipt
outcome/body graphs with a recognized status for every receipt, callback events,
successful payout-receipt status, contract transfer actions, cash snapshots,
payer balance and credit reconciliation, replay rejection for any payout amount,
and the capture/source manifest. Verify the separate tooling manifest with the
`shasum` command below. Mutation checks reject a changed artifact, removed failure
event, duplicate, missing or altered payout, incomplete or disconnected receipt
graphs, missing or failed withdrawal status, promise-only payout status, a
one-yocto replay payout, a replay or underfunded contract transfer to any
recipient, a payout receipt body that disagrees with its outcome executor, a
failed excess-refund callback receipt, an extra third-party transfer in either
the successful withdrawal or failed-refund graph, duplicate settlement events,
and a settlement event in the replay graph.
To check another capture, pass its repository path and manifest as arguments. The
checker validates saved Sandbox RPC records; it does not rerun the Sandbox or
validate cryptographic receipt inclusion proofs against block headers.

Regenerate and verify the capture/source manifest from the repository root. It
pins only the evidence capture and the contract/build inputs used by the Sandbox
fixture. Verifier, tests, runner, package metadata, and README hashes live in a
separate tooling manifest so edits to mutable tooling and docs do not invalidate
the capture/source manifest. Root planning and review documents, including
`TODO.md` and `P2-USDC-*`, are intentionally excluded from both manifests; the
Git commit identifies their revision, while these manifests pin the capture
inputs and executable verification tooling:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs contracts/sandbox-mock-ft/Cargo.toml \
  contracts/sandbox-mock-ft/src/lib.rs \
  > tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256

shasum -a 256 tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs \
  tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  > tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.tooling.sha256
shasum -a 256 -c tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.tooling.sha256
```

For a fresh, source-built fixture, pass the build output directly and pin its
digest instead of relying on the default `target` path:

```sh
CARGO_TARGET_DIR=/tmp/lcp-near-sandbox-cache/recovery-target cargo near build \
  non-reproducible-wasm --locked --no-abi \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --features 'sandbox-callback-fixture usdc-receipt-recovery' \
  --out-dir /tmp/lcp-near-sandbox-cache/recovery-core
shasum -a 256 /tmp/lcp-near-sandbox-cache/recovery-core/lcp_core.wasm
```

The committed recovery variant uses the digest-pinned SourceScan image for a
NEP-330 build. Build from the exact clean contract source commit; NEP-330
includes that commit in the WASM, so a different commit produces a different
digest even when the Rust sources are unchanged:

```sh
git worktree add --detach /tmp/lcp-p2-repro-source 950e3cb50fd79f559f5b6ff725fbfa32db70a063
cd /tmp/lcp-p2-repro-source
cargo near build reproducible-wasm --manifest-path contracts/lcp-core/Cargo.toml \
  --variant sandbox-recovery --out-dir /tmp/lcp-near-sandbox-cache/reproducible-core
shasum -a 256 /tmp/lcp-near-sandbox-cache/reproducible-core/lcp_core.wasm
```

The pinned image is `sourcescan/cargo-near:0.23.0-rust-1.100.0` at
`sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`.
Two builds from the commit above yielded the same hash and NEAR code hash. A
`non-reproducible-wasm` build remains useful for quick iteration, but is not the
artifact pinned by the acceptance captures.

Set `LCP_CORE_WASM_PATH=/sandbox-cache/reproducible-core/lcp_core.wasm` and
`LCP_EXPECTED_CORE_WASM_SHA256=4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad`
in the isolated Docker runner environment when generating the reproducible capture:

```sh
mkdir -p /tmp/lcp-near-sandbox-cache/bin /tmp/lcp-near-sandbox-cache/tmp
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_NATIVE_EXCESS_REFUND_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_CORE_WASM_PATH=/sandbox-cache/reproducible-core/lcp_core.wasm LCP_EXPECTED_CORE_WASM_SHA256=4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json node run.mjs'
```

The owner captures from the plain `0f194b…` clean build are retained at the
[`native clean-build capture`](native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-clean-build.json),
[`bootstrap clean-build capture`](bootstrap-activity-guard-sandbox-acceptance-2026-11-17-clean-build.json),
and their checksum manifests. The original `33997e…` capture and manifest are
historical; neither is the pinned reproducible candidate.

The broader November 16 recovery-lifecycle run passed a read-only contract-VM
probe of a valid maximum-size certificate envelope: 500-byte intent, 714-byte certificate, five signatures,
1,202 decoded bytes, and 1,604 Base64 characters. This synthetic probe uses the
configured committee and real parser/signature verifier, but it is not a
pending transfer and cannot settle escrow. The same run passed callback-first
finality, certificate-first settlement after a
1 Tgas callback runs out of gas, rejection of mutations to every one of the 28
`RecoveryCertificateV1` fields, 0–3-signature and five-invalid-signature
certificates, valid 4-of-5 and 5-of-5 certificates, wrong-domain and replayed
certificate rejection, duplicate/unsorted/unpinned signer rejection,
noncanonical Ed25519 `S`, small-order `R`, malformed Base64/Borsh and
size-boundary rejection, callback/certificate races,
failed-transfer recovery and retry, storage-reserve revaluation, failed and
exact-margin credit withdrawals, two simultaneous native outflows, aggregation
of multiple failed refund callbacks, committee rotation, canceled-proposal
replay rejection, permanent key non-reuse after old epoch retirement, and
rollback after an overflow panic. It also rejects a conflicting failure
certificate after success is terminal, and rejects a valid certificate for
transfer A when submitted against transfer B. Both intents remain unchanged
after the rejected cross-transfer attempt and later settle with their own
certificates. A direct callback from another account, a different account's
recovery-credit withdrawal, and a payer withdrawal carrying one yoctoNEAR were
also rejected with the complete credit view unchanged; the payer's later
exact-margin withdrawal succeeded. The payer-authorized Sandbox fixture also
placed a credit in flight, then called the production private callback with a
mismatched amount and a mismatched nonce; each callback preserved the complete
credit view. Zero-result, two-result, and one successful result with an
unexpected nonempty payload also left it unchanged. The latter confirms the
production callback accepts only the empty result expected from a native
transfer. A test-only predecessor failure followed by the production callback restored the
exact credit to `refund_pending` with its accrued amount unchanged and no
transfer scheduled. After a second attempt began, the prior nonce could not
settle it; a subsequent exact failed callback restored the credit again, and a
duplicate callback left that retryable state unchanged. The later real payer
withdrawal succeeded at the exact cash margin. For the delayed case, the
production withdrawal path sent the NEAR transfer in block 406, ran eight
fixture receipts in blocks 407–414, and settled the production callback in
block 415. Each intermediate receipt confirmed the exact credit remained
`withdrawing` and asserted `C = S + N + Q + F + X`; observed free cash was zero
at every step, with no storage shortfall. The 1-yocto-short withdrawal still
failed before payout. This proves the tested phase accounting at that exact
boundary, not a safe funding recommendation for real or arbitrarily delayed
callbacks. A duplicate successful callback after settlement also left the
deleted credit row absent. A separate case used an actual
Sandbox transfer followed by a production callback limited to 1 Tgas. The
transfer succeeded, the callback failed with `Exceeded the prepaid gas.`, the
payer received exactly the accrued amount after transaction gas, and the credit
remained `withdrawing` and unavailable. A second withdrawal was rejected
without changing the credit. This fail-closed case leaves an unknown callback
pending; it does not provide receipt-proof recovery. A replay after successful
settlement found no credit, emitted only its failed method receipt, and scheduled no second
transfer or callback. A weak committee key was rejected at bootstrap without
consuming the one-time setup
authority. All 56 negative
envelope cases were rejected without changing the pending intent, escrow, or
token balance. A 1,202-byte decoded input
passed the outer size gate and failed structural parsing, while 1,203 bytes and
1,608 Base64 characters were rejected by their respective limits. The positive
maximum-size parser probe used 14.024 Tgas. Permissionless intent
finalization was forced to fail at 1 Tgas; its
terminal intent and payer credit remained unchanged, then finalization
succeeded on retry. The optimized fixture's captured recovery settlement
receipts used 15.092 Tgas for 4-of-5 and 17.003 Tgas for 5-of-5. These are observed cases, not a
worst-case method gas bound. The runner escalates a lingering local Sandbox
process from SIGTERM to SIGKILL after five seconds so Docker exits after results
are written; this affects only the isolated local process. The capture is
[`receipt-recovery-sandbox-acceptance-2026-11-16.json`](receipt-recovery-sandbox-acceptance-2026-11-16.json),
with hashes in
[`receipt-recovery-sandbox-acceptance-2026-11-16.sha256`](receipt-recovery-sandbox-acceptance-2026-11-16.sha256).

### Storage-bond registry capacity and revaluation batch

With the same optimized fixture-enabled recovery core and mock-token artifacts
above, run the focused capacity probe:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_STORAGE_REGISTRY_CAP_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/storage-registry-sandbox-acceptance-2026-11-16.json node run.mjs'
```

The protocol-88 Sandbox run began with three registry entries and added 2,045
fixture-seeded zero-value payer-credit rows to reach the provisional 2,048
record cap. Those rows used the same short Sandbox payer ID and fixed record
shape; measured storage growth was 961,150 bytes. The next admission failed,
leaving the count at 2,048 and its credit row absent. A 65-record revaluation
request failed; 32 production calls revalued 64 records each and restored
reserve readiness only after the final batch. Maximum observed gas was 45.279
Tgas for a 32-row seed transaction and 11.785 Tgas for a 64-record revaluation
transaction. A separate maximum-length payer probe is described below. These
are fixture observations, not worst-case gas estimates or permanent production
limits; other record states, independent reproduction, and the rest of the
acceptance matrix remain open. The capture is
[`storage-registry-sandbox-acceptance-2026-11-16.json`](storage-registry-sandbox-acceptance-2026-11-16.json).
Its source-and-capture manifest records the source revision committed as
`7f7c66eeb5c3fdda78f5b4afc84484bb7ab5d722`; verify the manifest against that
revision because the runner has since gained another fixture mode.

### Maximum-length payer storage shape

Use the same optimized fixture-enabled recovery core and mock-token artifacts
to measure the longest valid NEAR account identifier in a credit row:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_STORAGE_REGISTRY_SHAPE_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/storage-registry-shape-sandbox-acceptance-2026-11-16.json node run.mjs'
```

The run seeded 64 zero-value rows for the synthetic valid AccountId
`a` repeated 64 times. The ID was not provisioned as an account; this fixture
measures persisted identifier size only. Starting from three records, it
reached 67 records and measured 33,728 bytes of storage growth (527 bytes per
row). Seeding used 86.972 Tgas; the largest observed 64-record revaluation
batch used 11.786 Tgas. Reserve readiness stayed off during revaluation and
returned after both batches completed. These values are observations for this
row shape and local VM, not a worst-case gas bound or a production limit. See
the [capture](storage-registry-shape-sandbox-acceptance-2026-11-16.json) and
[checksum manifest](storage-registry-shape-sandbox-acceptance-2026-11-16.sha256).
That manifest records its source snapshot at commit
`55126f386d058af085cb334c91ea876fe1fe14bf`; verify it at that revision.

### Funded Pending credits at maximum payer length

The funded variant also checks that admission excess is backed by the exact
attached deposit and remains non-withdrawable while credits are `Pending`:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_STORAGE_REGISTRY_SHAPE_ONLY=1 LCP_STORAGE_REGISTRY_FUNDED_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/storage-registry-funded-pending-sandbox-acceptance-2026-11-16.json node run.mjs'
```

The run attached 0.01 NEAR for each of 64 rows (0.64 NEAR total) using the
synthetic 64-character payer ID above. The aggregate attached deposit exactly
matched the 0.64 NEAR pending-credit liability (`Q`). The sample remained
`Pending`, non-withdrawable, and cash-solvent before and after the reserve
revaluation; readiness was disabled only while records were being repriced.
The measured storage growth remained 33,728 bytes, seed gas was 86.986 Tgas,
and the largest 64-record revaluation batch used 11.786 Tgas. These are local
fixture measurements, not production limits. See the
[capture](storage-registry-funded-pending-sandbox-acceptance-2026-11-16.json)
and [checksum manifest](storage-registry-funded-pending-sandbox-acceptance-2026-11-16.sha256).

### Storage-reserve revaluation out-of-gas rollback and retry

Run the focused rollback probe with the same optimized fixture core and mock
token artifacts:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_STORAGE_REGISTRY_OOG_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/storage-registry-oog-sandbox-acceptance-2026-11-16.json node run.mjs'
```

The probe seeds 64 funded measured rows for a synthetic 64-character AccountId
with 0.01 NEAR of admission excess per row (0.64 NEAR total), starts reserve
revaluation, and submits the maximum 64-record batch with a 10 Tgas limit. It
requires a runtime out-of-gas receipt, then compares the credit, `Q` liability,
and registry state. It also rejects a zero-length batch and a noncontiguous
cursor without changing that state. It then retries from record zero; the retry
must advance to record 64 and a second batch must complete, restoring reserve
readiness. This verifies transaction rollback, validation, and retry on the
pinned local Sandbox; it does not establish a production gas limit. See the
[capture](storage-registry-oog-sandbox-acceptance-2026-11-16.json) and
[source checksum manifest](storage-registry-oog-sandbox-acceptance-2026-11-16.sha256).

### Release artifact feature boundary

Build the normal core release artifact without fixture features, using a
separate target directory so the optimized Sandbox artifact remains intact:

```sh
CARGO_TARGET_DIR=target/lcp-release-check cargo build --locked -p lcp-core \
  --no-default-features --target wasm32-unknown-unknown --release
node tests/sandbox-usdc-callbacks/verify-release-feature-exclusion.mjs
```

The verifier parses the actual Wasm export section, requires representative
production methods, and rejects any `sandbox_*` exports, including the fixture
storage seeding and registry methods. The captured release artifact has no
Sandbox fixture exports. This checks the default non-fixture build boundary; it
is not a reproducible-build verification. See the
[release capture](release-feature-exclusion-2026-11-16.json) and its
[source checksum manifest](release-feature-exclusion-2026-11-16.sha256). Verify
the captured source files from the repository root with:

```sh
shasum -a 256 -c tests/sandbox-usdc-callbacks/release-feature-exclusion-2026-11-16.sha256
```

Regenerate the OOG manifest after rerunning or changing any listed input:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/storage-registry-oog-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  TODO.md P2-USDC-RECEIPT-RECOVERY-DESIGN.md \
  > tests/sandbox-usdc-callbacks/storage-registry-oog-sandbox-acceptance-2026-11-16.sha256
```

Regenerate the manifest after rerunning or changing the captured inputs:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/storage-registry-funded-pending-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/models.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/src/recovery_config.rs \
  contracts/lcp-core/src/receipt_recovery.rs \
  evaluators/service-availability/src/main.rs evaluators/service-availability/probe.mjs \
  evaluators/service-availability/test/probe.test.mjs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  TODO.md P2-USDC-RECEIPT-RECOVERY-DESIGN.md \
  > tests/sandbox-usdc-callbacks/storage-registry-funded-pending-sandbox-acceptance-2026-11-16.sha256
```

To keep the governance timing check fast, `sandbox-callback-fixture` sets the
rotation minimum to ten seconds and tests rejection before the deadline and
acceptance after it. Release builds retain the seven-day minimum. This verifies
the NEAR VM timing and state-transition path; the full seven-day elapsed period
was not simulated in Sandbox. The fixture WASM includes test-only entry points
and the shortened delay and must never be deployed. Verify this capture and its
source hashes with
[`receipt-recovery-sandbox-acceptance-2026-11-16.sha256`](receipt-recovery-sandbox-acceptance-2026-11-16.sha256).
Regenerate that manifest after rerunning the acceptance command or changing
inputs:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/receipt-recovery-sandbox-acceptance-2026-11-16.json \
  tests/sandbox-usdc-callbacks/run.mjs tests/sandbox-usdc-callbacks/README.md \
  tests/sandbox-usdc-callbacks/package.json tests/sandbox-usdc-callbacks/package-lock.json \
  Cargo.toml Cargo.lock rust-toolchain.toml contracts/lcp-core/Cargo.toml \
  contracts/lcp-core/src/contract.rs contracts/lcp-core/src/lib.rs \
  contracts/lcp-core/src/native_cash.rs contracts/lcp-core/src/recovery_accounting.rs \
  contracts/lcp-core/src/recovery_config.rs contracts/lcp-core/src/receipt_recovery.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/sandbox-mock-ft/src/lib.rs \
  > tests/sandbox-usdc-callbacks/receipt-recovery-sandbox-acceptance-2026-11-16.sha256
```

From this directory, `npm audit --audit-level=high` currently reports zero
vulnerabilities.

### Native-cash margin for late cash-asserting scenarios

The recovery-only fixture deliberately drives the native ledger to its solvency
edge in the scenarios after governance. That is intentional for those
measurements. A future cash-asserting scenario added at the tail (or after any
scenario that consumes the margin) must fund and assert its own native-cash
margin first; do not assume free headroom remains. The Gate 5 `code_hash_change`
scenario is the pattern: it runs before the solvency-edge scenarios and records
its own plain root-to-core margin top-up (`margin_top_up_transaction_hash`,
`margin_top_up_yocto`) plus the free native cash before and after
(`free_native_cash_before_yocto`, `free_native_cash_after_yocto`).

Use a plain NEAR transfer for that margin, not
`sandbox_set_native_free_margin`: the fixture setter rebalances synthetic
liabilities and does not add real account cash, so a cash-gated call measured
against it would not exercise the same balance path as a funded deploy.

