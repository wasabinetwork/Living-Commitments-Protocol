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

**Verified on 2026-11-10:** formatting and all listed checks passed. The Rust workspace ran 56 tests; `npm test` ran 22 tests. Rust contract/evaluator WASM builds, both Worker dry runs, reviewer type generation, and the Console production build also passed.

For the private reviewer Worker, apply all local D1 migrations before starting Wrangler:

```sh
npx wrangler d1 migrations apply lcp-reviewer-access --local --config services/reviewer-access/wrangler.jsonc
```

Do not run live testnet transactions until the automated checks pass. Reviewer D1/R2 provisioning and deployment, amendment/adapter deployment, and the independent signed-operator pilot are separate integration gates; see [P1 architecture](P1-ARCHITECTURE.md).

The evaluator rebuild should be 323,213 bytes with SHA-256 `17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97`. This is the artifact pinned by the testnet fixture; see [testnet status](TESTNET-E2E-STATUS.md) for its source revision and publication details.

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

Follow [CONSOLE-GUIDE.md](CONSOLE-GUIDE.md) for wallet-driven creation, funding, activation, NEP-413 evidence signing, evaluation, challenges, claims/retries, closure, refunds, and the staged P1 workflows. Existing examples and transaction receipts are listed in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md). Refresh every health snapshot before acting: deadlines continue to advance and old fixture states can change. The live Console preview at <https://preview.lcp-preview.pages.dev> was manually checked in Firefox for wallet connection, NEAR reads, and OutLayer report lookup.

Frontend browser checks are manual rather than an automated DOM/E2E suite. A wallet, testnet funds, and an available evaluator artifact are needed for live transactions; they are not needed for the automated workspace tests. OutLayer attestation hash matching in the app is not TEE quote verification: use the linked OutLayer **Verify** report or the standalone verifier. The evaluator checks the signed statement and digest format; it does not prove the evidence file reflects real-world truth.
