# Tests and Reproduction

This guide covers deterministic Rust checks, reproducible WASM builds, and the testnet LCP Console. Automated checks use synthetic test keys and need no wallet credentials or NEAR funds. Live wallet actions must stay on NEAR testnet.

## Requirements

- Rust 1.94 and Cargo for workspace development; add the WASM targets with `rustup target add wasm32-unknown-unknown wasm32-wasip2`.
- Rust 1.95 or newer, Docker, and `cargo-near` 0.23.0 for reproducible contract artifacts. The contract manifests pin the Sourcescan image by both version and digest; its build toolchain is Rust 1.99.1.
- Node.js 22 and npm, selected by the root `.nvmrc`.
- A testnet wallet only for manual on-chain actions.

## Automated checks

From the repository root, run:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo build -p lcp-core -p lcp-bounded-payout-adapter --target wasm32-unknown-unknown --release
cargo build -p maintenance-heartbeat --target wasm32-wasip2 --release
cargo build -p service-availability-evaluator --target wasm32-wasip2 --release
node --check evaluators/service-availability/probe.mjs
npm test
npm run check --workspace=@lcp/event-indexer
npm run check --workspace=@lcp/reviewer-access
npm run build --workspace=@lcp/console
npm run types --workspace=@lcp/reviewer-access
shasum -a 256 target/wasm32-wasip2/release/maintenance-heartbeat.wasm
```

These direct `cargo build` commands are development checks. They do not establish third-party reproducibility for NEAR contract WASM.

## Reproducible contract builds and mainnet key gate

Install the pinned Cargo NEAR CLI, ensure the workspace source is committed, and run these commands from the repository root:

```sh
rustup toolchain install 1.95.0 --profile minimal
cargo +1.95.0 install --locked --version 0.23.0 cargo-near
cargo near build reproducible-wasm --manifest-path contracts/lcp-core/Cargo.toml --out-dir target/reproducible/lcp-core
cargo near build reproducible-wasm --manifest-path contracts/bounded-payout-adapter/Cargo.toml --out-dir target/reproducible/bounded-payout-adapter
shasum -a 256 target/reproducible/lcp-core/lcp_core.wasm target/reproducible/bounded-payout-adapter/lcp_bounded_payout_adapter.wasm
```

Each contract manifest records the repository URL, image version and immutable image digest, and locked container build command required by NEP-330. ABI generation is disabled because the existing contract API types do not implement `JsonSchema`; the reproducible build still compiles optimized WASM with `--locked`. The `--no-abi` build does not embed ABI or NEP-330 source metadata in the contract bytes, so release verification compares an independent rebuild's code hash with the deployed code hash. `cargo near build reproducible-wasm` builds committed Git source inside the pinned image; it ignores uncommitted edits and requires the checked-in `Cargo.lock`. The repository is public, so independent reproduction is possible. Publish the source commit and resulting WASM hashes alongside a mainnet release so independent reviewers can repeat the build.

**Verified on 2026-11-12 from source commit `0d7073b00ddf49920104bea5bff4f9c69c1d4075`:** the LCP core reproducible WASM is 679,397 bytes with SHA-256 `99d7c8b599fb8587b8aa31d4e92415a5f78990f7b01a9193da25295c74238f64`, built with `cargo-near 0.23.0` in the manifest-pinned `sourcescan/cargo-near:0.23.0-rust-1.99.1` image (`sha256:8013f039e8005627f10ae66b5519d1a6eeeed7d7aef4b5067d5e9a86c4302fcc`). The previous verified build from `dff30851ddb1b6756ab1ce4500265b54bdbc9142` produced core WASM of 674,997 bytes (`0769c96ac9779b5c7c722da1f7ef370fcfeb3063d44d9afe444adc408377811a`) and bounded payout adapter WASM of 144,203 bytes (`c33dbf40b581d87653f98a04bfcd763d195c69130db248ecaa4a22d1fef9c594`).

**Mainnet release gate:** LCP v1 uses immutable contract accounts. Only after independent audit, reproducible builds, deployment, initialization, and deployed-code verification, remove every access key from the LCP core and each value-holding adapter account. Query finalized `view_access_key_list` for each account and confirm that no keys remain. Do not use this procedure on the development testnet accounts. There is no v1 owner, migration, or emergency upgrade method; a later release uses a new account, while existing commitments continue on v1 without automatic migration. Record the deployed code hash, source commit, reproducible WASM SHA-256, and finalized key-list evidence in the release record.

Use NEAR CLI to inspect keys at finalized state: `near account list-keys <contract-account-id> network-config mainnet now`. Remove the remaining keys only after confirming the deployed WASM and initialization; removal of the final key is irreversible. A keyless account's deployed contract remains callable by other accounts, but the account has no owner able to originate transactions.

The Rust workspace tests cover exact temporal boundaries, lifecycle and overflow handling, source timestamps, recovery policy, challenges, claim eligibility, callback binding/replay, failed-transfer reconciliation, v3 source aggregation, consent amendments, and authority adapter limits and settlement. `npm test` runs SDK encryption/signature tests, reviewer Worker/API tests, and the service-probe Node tests. `npm run check` for each Worker type-checks its bindings and performs a Wrangler dry run. The Console production build catches Next.js and TypeScript integration errors.

**Verified on 2026-11-11:** `cargo fmt --all -- --check`, the Rust workspace (67 tests), and `npm test` (32 JavaScript tests) passed. Contract and evaluator WASM builds, the Console production build, Worker checks, and `git diff --check` also passed. The transaction-authenticated contract and evaluator are deployed to testnet; commitment `27` passed the separate-device operator journey, compliant quorum evaluations, replacement/refund, exact replay rejection, expiry reclaim, and wallet-session checks.

**Verified on 2026-11-12:** the Console production build passed, SDK tests passed (11), and the updated Pages preview `/health` returned HTTP 200. The preview now includes testnet-only wallet-based adapter deployment and pool funding. The indexer backfill, manual WCAG review, amendment/adapter testnet lifecycle, and reviewer-service independent security review remain open.

For the private reviewer Worker, apply all local D1 migrations before starting Wrangler:

```sh
npx wrangler d1 migrations apply lcp-reviewer-access --local --config services/reviewer-access/wrangler.jsonc
```

Do not run live testnet transactions until the automated checks pass. Amendment lifecycle validation, adapter-account deployment and settlement, reviewer D1/R2 provisioning, and independent security review are separate integration gates; see [P1 architecture](P1-ARCHITECTURE.md). The current LCP contract build matches the deployed code hash, so the amendment methods need no contract upgrade. Testnet remains intentionally upgradeable; the immutable-key gate applies only to audited mainnet releases.

The legacy-signature evaluator pinned by existing testnet commitments is 323,213 bytes with SHA-256 `17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97`. The prior NEP-413 inbox evaluator is 408,367 bytes with SHA-256 `eec7211dec72b0066e649564edb9d8943ef69236e6a6e62cb47de23abe2363c6`. New source-policy v2 commitments use the transaction-authenticated evaluator: 410,392 bytes, SHA-256 `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`, published at <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm>. Existing commitments retain their originally pinned URL and digest.

## Run the LCP Console locally

```sh
npm ci
cp apps/console/.env.example apps/console/.env.local
```

Set `NEXT_PUBLIC_LCP_CONTRACT_ID` to the deployed testnet contract, then run:

```sh
npm run build --workspace=@lcp/console
npm run dev --workspace=@lcp/console
```

Open `http://localhost:3000`. The LCP Console uses finalized testnet reads and the explicitly configured testnet wallet connector. `.env.local` and `.env.testnet` are local-only; never publish credentials or private keys. The app hashes a chosen evidence file in the browser and does not upload it.

## Manual testnet reproduction

Follow [CONSOLE-GUIDE.md](CONSOLE-GUIDE.md) for wallet-driven creation, funding, activation, NEP-413 evidence signing, evaluation, challenges, claims/retries, closure, refunds, and the staged P1 workflows. Existing examples and transaction receipts are listed in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md). Refresh every health snapshot before acting: deadlines continue to advance and old fixture states can change. The live Console preview at <https://preview.lcp-preview.pages.dev> includes the transaction-authenticated operator flow and wallet-session restoration; commitment `27` passed the separate-device Firefox journey.

Frontend browser checks are manual rather than an automated DOM/E2E suite. A wallet, testnet funds, and an available evaluator artifact are needed for live transactions; they are not needed for the automated workspace tests. OutLayer attestation hash matching in the app is not TEE quote verification: use the linked OutLayer **Verify** report or the standalone verifier. The evaluator checks the signed statement and digest format; it does not prove the evidence file reflects real-world truth.
