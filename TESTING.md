# Tests and Reproduction

This guide covers deterministic Rust checks, reproducible WASM builds, and the testnet LCP Console. Automated checks use synthetic test keys and need no wallet credentials or NEAR funds. Live wallet actions must stay on NEAR testnet.

## Requirements

- Rust 1.100.0 and Cargo for workspace development and CI. `rust-toolchain.toml` pins the compiler, formatter, linter, and both WASM targets; `Cargo.toml` declares the same Rust version as the minimum supported compiler.
- The prebuilt `cargo-near` 0.23.0 CLI for NEAR contract checks. Docker is required for reproducible contract artifacts; both manifests pin the Sourcescan image by version and digest, using the same Rust 1.100.0 compiler as local development and CI.
- Node.js 22 and npm, selected by the root `.nvmrc`.
- A testnet wallet only for manual on-chain actions.

## Automated checks

From the repository root, run:

```sh
cargo fmt --all -- --check
cargo test --workspace
cargo near check --locked --manifest-path contracts/lcp-core/Cargo.toml
cargo near check --locked --manifest-path contracts/bounded-payout-adapter/Cargo.toml
cargo build -p maintenance-heartbeat --target wasm32-wasip1 --release
cargo build -p service-availability-evaluator --target wasm32-wasip2 --release
node --check evaluators/service-availability/probe.mjs
npm test
npm run check --workspace=@lcp/event-indexer
npm run check --workspace=@lcp/reviewer-access
npm run build --workspace=@lcp/console
npm run types --workspace=@lcp/reviewer-access
shasum -a 256 target/wasm32-wasip1/release/maintenance-heartbeat.wasm
```

These checks do not establish third-party reproducibility for NEAR contract WASM.

## Reproducible contract builds and mainnet key gate

Install the pinned Cargo NEAR CLI, ensure the workspace source is committed, and run these commands from the repository root:

```sh
rustup toolchain install 1.100.0 --profile minimal --component clippy --component rustfmt --target wasm32-unknown-unknown --target wasm32-wasip1 --target wasm32-wasip2
curl --fail --location --proto '=https' --tlsv1.2 \
  --output /tmp/cargo-near-installer.sh \
  https://github.com/near/cargo-near/releases/download/cargo-near-v0.23.0/cargo-near-installer.sh
printf '%s  %s\n' \
  '76ae71bc6a99864a09cc67c1c0bf82a2b7812d8ab4c93034b680235df6d22028' \
  '/tmp/cargo-near-installer.sh' | shasum -a 256 --check
sh /tmp/cargo-near-installer.sh
cargo near --version
cargo near build reproducible-wasm --manifest-path contracts/lcp-core/Cargo.toml --out-dir target/reproducible/lcp-core
cargo near build reproducible-wasm --manifest-path contracts/bounded-payout-adapter/Cargo.toml --out-dir target/reproducible/bounded-payout-adapter
shasum -a 256 target/reproducible/lcp-core/lcp_core.wasm target/reproducible/bounded-payout-adapter/lcp_bounded_payout_adapter.wasm
```

The installer checksum above is for the versioned official `cargo-near 0.23.0` release. Its prebuilt CLI avoids compiling the Cargo NEAR tool and its native dependencies on each developer machine; the contract build itself still runs inside the digest-pinned container. For other platforms, use the matching asset from the same [official release](https://github.com/near/cargo-near/releases/tag/cargo-near-v0.23.0) and verify its published SHA-256 before installing.

Each contract manifest records the repository URL, image version and immutable image digest, and locked container build command required by NEP-330. ABI generation is disabled because the existing contract API types do not implement `JsonSchema`; the reproducible build still compiles optimized WASM with `--locked`. `--no-abi` omits ABI generation, but the resulting artifact embeds NEP-330 build information, including the exact source commit and pinned container. The artifact hash therefore belongs to one committed source revision and build image. `cargo near build reproducible-wasm` builds committed Git source inside the pinned image; it ignores uncommitted edits and requires the checked-in `Cargo.lock`. Publish the source commit and resulting WASM hashes so an independent rebuild can be compared with the deployed code hash.

**Verified on 2026-11-12 from source commit `fa94be3535ff55820cc2ee3d54c90fbc8958341e`:** the LCP core reproducible WASM is 715,823 bytes with SHA-256 `e5d6ff737af8dabb8187b832fda43de8c159f6aad01dbbf541eddbb0734ed5ef` (NEAR code hash `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN`). The bounded payout adapter is 151,182 bytes with SHA-256 `577720aca14732881a2856ebeed48d35910df28c31e59295cd32345bb276a186` (NEAR code hash `6tRpxKQbrs3ukKeX4B89vpNznJM7KmveqJ8FxxtqDKcH`). Both used `cargo-near 0.23.0` and the manifest-pinned `sourcescan/cargo-near:0.23.0-rust-1.99.1` image (`sha256:8013f039e8005627f10ae66b5519d1a6eeeed7d7aef4b5067d5e9a86c4302fcc`). These historical artifact hashes remain tied to that earlier build image; rebuild and re-verify before using them for a new release.

**Verified on 2026-11-13 from source commit `02ccc7306b0d7b312be316569ef6af72f711e9e9`:** `cargo near build reproducible-wasm` built both contracts from the clean committed Git source inside the pinned `sourcescan/cargo-near:0.23.0-rust-1.100.0` image (`sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`). The core artifact is 754,572 bytes, SHA-256 `5d5f028f3c087fa264c9897f94d978109838dd7894513c4ebe3c2c2fa511d9b9`, NEAR code hash `7HUwhyiCTyPBYpGGhqetz4fkxo9c5YnE4Bb118hHVqNQ`. The bounded adapter is 152,235 bytes, SHA-256 `3379e0b6bddb6b5da2fdf78e6b1fe5bc5216a2d4ab09fad9a525ef5140d87cd0`, NEAR code hash `4TwakaXT7iSEuLStKGBwphKBSkULRGYXsax2N9bNZyyq`. Artifacts are in `target/reproducible/`; this build does not deploy either contract. The hashes identify this source commit and image and must be regenerated for a later code change.

**Historical build record — verified on 2026-11-14 from source commit `e9074ddced4be9dce4dd4c1061909f7869054cf1`:** `cargo near build reproducible-wasm` built both contracts in the pinned `sourcescan/cargo-near:0.23.0-rust-1.100.0` image (`sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`). The core artifact was 759,388 bytes, SHA-256 `5c01aa15fee13a03a71fdada304f358f22e608c424525f37892182ac1e649bff`, NEAR code hash `7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`. The bounded adapter was 152,247 bytes, SHA-256 `148f752999a6613c39675540717b3cb21feee4ae1c8618703513712912a6b0a6`, NEAR code hash `2PG2fMTQ1MTmyCGskL2446kZ4dEimT3swmWRzQnpfra9`. At that date, these artifacts had not been deployed; the previous live core and adapter hashes were `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN` and `4TwakaXT7iSEuLStKGBwphKBSkULRGYXsax2N9bNZyyq`. The core was subsequently upgraded on 2026-11-15; its artifact, deployment, and acceptance are recorded in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md). These historical NEP-330 hashes remain tied to commit `e9074dd`. A third-party reproduction is a mainnet release gate; it does not block development-testnet upgrades.

**Repeat-build check on 2026-11-14:** both commands were rerun from a separate detached worktree at the same source commit and with the same pinned image. Both artifact sizes and SHA-256 hashes matched exactly. This confirms repeatability in the same local environment; it is not an independent third-party reproduction, which remains required before mainnet deployment.

The initial reproducible LCP core build was deployed to `livingcommitmentsprotocol.testnet` in transaction [`6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA`](https://testnet.nearblocks.io/txns/6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA), finalized at block `277430183`; at that time its on-chain code hash was `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN`. A finalized read at block `277430259` confirmed commitment `27` remained accessible with its existing state after that code-only upgrade. This deployment was superseded by the 2026-11-15 upgrade recorded above. The testnet account retains its FullAccess upgrade key for further iteration.

**Mainnet release gate:** LCP v1 uses immutable contract accounts. Only after independent audit, reproducible builds, deployment, initialization, and deployed-code verification, remove every access key from the LCP core and each value-holding adapter account. Query finalized `view_access_key_list` for each account and confirm that no keys remain. Do not use this procedure on the development testnet accounts. There is no v1 owner, migration, or emergency upgrade method; a later release uses a new account, while existing commitments continue on v1 without automatic migration. Record the deployed code hash, source commit, reproducible WASM SHA-256, and finalized key-list evidence in the release record.

Use NEAR CLI to inspect keys at finalized state: `near account list-keys <contract-account-id> network-config mainnet now`. Remove the remaining keys only after confirming the deployed WASM and initialization; removal of the final key is irreversible. A keyless account's deployed contract remains callable by other accounts, but the account has no owner able to originate transactions.

The Rust workspace tests cover exact temporal boundaries, lifecycle and overflow handling, source timestamps, recovery policy, challenges, claim eligibility, callback binding/replay, failed-transfer reconciliation, v3 source aggregation, consent amendments, and authority adapter limits and settlement. `npm test` runs SDK encryption/signature tests, reviewer Worker/API tests, and the service-probe Node tests. `npm run check` for each Worker type-checks its bindings and performs a Wrangler dry run. The Console production build catches Next.js and TypeScript integration errors.

**Verified on 2026-11-11:** `cargo fmt --all -- --check`, the Rust workspace (67 tests), and `npm test` (32 JavaScript tests) passed. Contract and evaluator WASM builds, the Console production build, Worker checks, and `git diff --check` also passed. The transaction-authenticated contract and evaluator are deployed to testnet; commitment `27` passed the separate-device operator journey, compliant quorum evaluations, replacement/refund, exact replay rejection, expiry reclaim, and wallet-session checks.

**Verified on 2026-11-12:** the Console production build passed, SDK tests passed (11), and the updated Pages preview `/health` returned HTTP 200. The preview included testnet-only wallet-based adapter deployment and pool funding. At that date, indexer work, manual WCAG review, amendment/adapter testnet lifecycle, and reviewer-access acceptance were open. Since then, amendment and adapter testnet flows passed, and reviewer-access current-stage acceptance was owner-approved complete; see `TODO.md` and `TESTNET-E2E-STATUS.md`. The optional archive remains rate-limited and the broader WCAG review remains open.

**Verified on 2026-11-12 from current main at the time:** `cargo fmt --all -- --check`, `cargo test --workspace` (67 tests), and `npm run build --workspace=@lcp/console` passed. That Console revision checked the adapter digest from source commit `02ccc7306b0d7b312be316569ef6af72f711e9e9`; the then-current build candidate used the digest recorded for source commit `e9074dd` above. This snapshot predates the later testnet governance/adapter acceptance on commitments `28` and `33`–`34`, and the P0 testnet acceptance on commitment `38`; current receipts are linked in `TESTNET-E2E-STATUS.md`.

**Verified on 2026-11-13 from the pre-restart worktree:** under Rust 1.100.0, `cargo fmt --all -- --check` and `cargo test --workspace --locked` passed (75 Rust tests: 58 core, 5 adapter, 6 heartbeat CLI, and 6 service evaluator). `npm test` passed 37 JavaScript tests (12 SDK, 8 indexer, 15 reviewer Worker, and 2 evaluator probe). Both contracts passed `cargo near check --locked`; both evaluator WASM release builds passed. The indexer and reviewer Workers type-checked and completed production/preview Wrangler dry runs; `npm run build` passed for the Console. `npm audit --audit-level=high` found zero vulnerabilities. CI installs `cargo-audit` 0.22.2; the tool was not installed locally. USDC contract tests exercise asset policy, funding, activation gating, claim/refund callbacks, retry, callback replay, and the NEP-141 transfer deposit. The SDK test checks NEP-141 funding serialization and fresh versus existing-account storage registration.

**Verified on 2026-11-19:** `cargo fmt --all -- --check` and `cargo test -p lcp-core --locked` passed 111 default tests, and both recovery configurations passed 151 tests each (`--features usdc-receipt-recovery` and `--features sandbox-callback-fixture,usdc-receipt-recovery`). The formatting pass resolved the drift that had accumulated in untouched `lcp-core` code; it changes layout only (plus rustfmt's `mod` ordering in `lib.rs`). Twelve added tests give the committee-rotation lifecycle and its settlement boundaries deterministic contract coverage that previously existed only in the Sandbox callback suite: the activation minimum-delay boundary, proposer-only sealed storage credits on cancellation, exact cancelled-proposal and cancellation replay, successor cancellation, activation and epoch retirement guards, three generations with distinct payers, retired-key reuse, a contract-state round trip preserving the instance ID, generation counter, and pending proposal, settlement of an intent pinned to an epoch that has since been rotated away (its keyset cannot be retired until the intent settles, and only its own committee can sign for it), and the committed governance golden vectors. That last test feeds `tests/receipt-recovery-vectors/golden-vectors.json` to the contract's own rotation and cancellation parsers, which must accept the Node-generated envelopes, reproduce the stored digests, and re-serialize to the committed Borsh bytes. Rotation tests run against the fixture's 10-second delay under `sandbox-callback-fixture` and the seven-day delay otherwise.

After the Mac restart, Docker Engine 29.9.3 responded successfully and the checksum-verified `cargo-near` 0.23.0 CLI was installed. Both reproducible contract builds then succeeded from committed source `02ccc7306b0d7b312be316569ef6af72f711e9e9`; see the hashes above. That earlier build did not deploy the USDC implementation. The later reproducible core from source `e9074ddced4be9dce4dd4c1061909f7869054cf1`, which includes USDC support, is deployed to testnet. Independent invariant review and live USDC testnet checks remain pending.

For the private reviewer Worker, apply all local D1 migrations before starting Wrangler:

```sh
npx wrangler d1 migrations apply lcp-reviewer-access --local --config services/reviewer-access/wrangler.jsonc
```

Do not run live testnet transactions until the automated checks pass. Amendment lifecycle validation, adapter-account deployment and settlement, reviewer D1/R2 provisioning, and independent security review are separate integration gates; see [P1 architecture](P1-ARCHITECTURE.md). The current LCP contract build matches the deployed code hash, so the amendment methods need no contract upgrade. Testnet remains intentionally upgradeable; the immutable-key gate applies only to audited mainnet releases.

The legacy-signature evaluator pinned by existing testnet commitments is 323,213 bytes with SHA-256 `17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97`. The prior NEP-413 inbox evaluator is 408,367 bytes with SHA-256 `eec7211dec72b0066e649564edb9d8943ef69236e6a6e62cb47de23abe2363c6`. New source-policy v2 commitments use the transaction-authenticated evaluator: 410,392 bytes, SHA-256 `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`, published at <https://artifacts.lcp.gama.works/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm>. Existing commitments retain their originally pinned URL and digest.

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
