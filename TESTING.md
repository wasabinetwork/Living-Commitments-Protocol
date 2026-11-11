# Tests and Reproduction

This guide covers deterministic Rust checks, reproducible WASM builds, and the testnet LCP Console. Automated checks use synthetic test keys and need no wallet credentials or NEAR funds. Live wallet actions must stay on NEAR testnet.

## Requirements

- Rust 1.94 and Cargo; add the WASM targets with `rustup target add wasm32-unknown-unknown wasm32-wasip2`.
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

The Rust workspace tests cover exact temporal boundaries, lifecycle and overflow handling, source timestamps, recovery policy, challenges, claim eligibility, callback binding/replay, failed-transfer reconciliation, v3 source aggregation, consent amendments, and authority adapter limits and settlement. `npm test` runs SDK encryption/signature tests, reviewer Worker/API tests, and the service-probe Node tests. `npm run check` for each Worker type-checks its bindings and performs a Wrangler dry run. The Console production build catches Next.js and TypeScript integration errors.

**Verified on 2026-11-11:** `cargo fmt --all -- --check`, the Rust workspace (67 tests), and `npm test` (32 JavaScript tests) passed. Contract and evaluator WASM builds, the Console production build, Worker checks, and `git diff --check` also passed. The transaction-authenticated contract and evaluator are deployed to testnet; commitment `27` passed the separate-device operator journey, compliant quorum evaluations, replacement/refund, exact replay rejection, expiry reclaim, and wallet-session checks. The indexer backfill, manual WCAG review, amendment/adapter testnet lifecycle, and reviewer-service independent review/deployment remain open.

For the private reviewer Worker, apply all local D1 migrations before starting Wrangler:

```sh
npx wrangler d1 migrations apply lcp-reviewer-access --local --config services/reviewer-access/wrangler.jsonc
```

Do not run live testnet transactions until the automated checks pass. Amendment lifecycle validation, adapter-account deployment and settlement, reviewer D1/R2 provisioning, and independent security review are separate integration gates; see [P1 architecture](P1-ARCHITECTURE.md). The current LCP contract build matches the deployed code hash, so the amendment methods need no contract upgrade.

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
