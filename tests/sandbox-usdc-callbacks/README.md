# USDC and native cash Sandbox acceptance

This isolated harness runs the real NEAR VM callback path against NEAR Sandbox
and a small mock NEP-141 token. It does not deploy to testnet or read
`.env.testnet`. The fixture-only core requires a Sandbox `test-chain-*` chain
and account `lcp-core-sandbox.sandbox`; never deploy its WASM to a public
network. The core initializer also creates the recovery storage-reserve
sidecar, and the native cash gate checks that it is current and solvent. The
recovery acceptance runner below creates intents and payer credits and
exercises their lifecycle in Sandbox.

From the repository root, build both artifacts:

```sh
cargo build --locked --release --target wasm32-unknown-unknown \
  -p lcp-core --features sandbox-callback-fixture
cargo build --locked --release --target wasm32-unknown-unknown \
  -p sandbox-mock-ft
CARGO_TARGET_DIR=target/lcp-sandbox-variant-b cargo build --locked --release \
  --target wasm32-unknown-unknown -p sandbox-mock-ft --features variant-b
cp target/lcp-sandbox-variant-b/wasm32-unknown-unknown/release/sandbox_mock_ft.wasm \
  target/wasm32-unknown-unknown/release/sandbox_mock_ft_variant_b.wasm
```

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
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.json node run.mjs'
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
minimum margin or a production funding rule. Delayed callback timing remains
untested; the deliberately out-of-gas callback case is described below.

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
`bc4e9e8cfb03d9e82f027883055624e18576993e`. This is local Sandbox evidence, not
a public-network receipt proof, independent reproduction, or recovery-verifier
acceptance. The fixture output contains ephemeral local-chain identifiers and
is replaced on each run. Verify the captured artifact and source hashes with
`shasum -a 256 -c tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.sha256`.
After regenerating the fixture from the repository root, regenerate the
manifest with:

```sh
shasum -a 256 tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.json \
  tests/sandbox-usdc-callbacks/run.mjs contracts/sandbox-mock-ft/src/lib.rs \
  contracts/sandbox-mock-ft/Cargo.toml contracts/lcp-core/src/contract.rs \
  contracts/lcp-core/src/lib.rs contracts/lcp-core/src/native_cash.rs \
  contracts/lcp-core/src/recovery_accounting.rs contracts/lcp-core/Cargo.toml \
  Cargo.lock rust-toolchain.toml \
  > tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.sha256
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
local Sandbox RPC server's HTTP request-body limit during deployment; Cargo
NEAR's `wasm-opt -O` output is 1,115,281 bytes and deploys successfully. This is
a local harness transport constraint, not a NEAR consensus size-limit result.
The following enables receipt recovery and the test-only ten-second governance
delay, and overwrites the core WASM from the earlier default build:

```sh
cargo install cargo-near --version 0.23.0 --locked
cargo near build non-reproducible-wasm --locked --no-abi \
  --features 'sandbox-callback-fixture usdc-receipt-recovery' \
  --manifest-path contracts/lcp-core/Cargo.toml \
  --out-dir target/wasm32-unknown-unknown/release
```

Then run only the recovery lifecycle with:

```sh
docker run --rm --init --platform linux/amd64 \
  -v "$PWD:/repo" -v /tmp/lcp-near-sandbox-cache:/sandbox-cache \
  -w /repo/tests/sandbox-usdc-callbacks node:26-trixie-slim sh -lc \
  'npm ci --ignore-scripts --no-audit --no-fund && NEAR_RPC_TIMEOUT_SECS=120 LCP_RECOVERY_ONLY=1 LCP_SANDBOX_BINARY_DIR=/sandbox-cache/bin TMPDIR=/sandbox-cache/tmp LCP_FIXTURE_OUTPUT=/repo/tests/sandbox-usdc-callbacks/receipt-recovery-sandbox-acceptance-2026-11-16.json node run.mjs'
```

This run passed a read-only contract-VM probe of a valid maximum-size
certificate envelope: 500-byte intent, 714-byte certificate, five signatures,
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
rollback after an overflow panic. A weak committee key was rejected at
bootstrap without consuming the one-time setup authority. All 56 negative
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
