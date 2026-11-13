# Living Commitments Protocol

Living Commitments Protocol (LCP) is a NEAR protocol for obligations that must remain true over time. A commitment's effective health is derived from accepted evidence, its immutable temporal policy, and NEAR block time. That health gates recurring budget tranches.

The MVP follows this verification path:

1. A maintainer submits a signed maintenance heartbeat.
2. A hash-pinned OutLayer WASM evaluator checks the evidence and returns a verdict.
3. The NEAR contract binds the result to its pending request and policy.
4. Evidence freshness moves the commitment through `Healthy`, `AtRisk`, and `Breached`.
5. The contract blocks claims while the commitment is not healthy or a blocking challenge is open; fresh qualifying evidence can restore future eligibility when policy allows.

TEE attestation demonstrates that the configured evaluator ran with particular inputs and outputs. It does not prove the evaluator is logically correct or that the external evidence source is truthful.

The P2 multi-asset extension adds a local NEP-141 settlement path for Circle USDC alongside native NEAR. Focused contract and SDK checks and local builds passed on 2026-11-13. It preserves existing NEAR state layouts and keeps gas, storage, token registration, and evaluator costs in NEAR. Independent review, reproducible build, testnet deployment, and live acceptance remain pending; see [P2-ASSET-ARCHITECTURE.md](P2-ASSET-ARCHITECTURE.md).

## Current implementation

The `contracts/lcp-core` crate contains the pure temporal engine and NEAR state layer for commitment creation, separate escrow and operations funding, activation, OutLayer evaluation requests, bounded evaluation history, challenges, health-gated tranche claims, asynchronous transfer reconciliation, closure/refunds, and read views. The immutable policy pins the maintainer's heartbeat signing key and OutLayer WASM digest. Evaluation requests bind canonical signed heartbeat evidence to a commitment, evaluation ID, policy digest, and timestamp; a private callback validates the returned verdict before updating temporal evidence. Request-time storage deposits reserve enough space for callback state changes.

The `evaluators/maintenance-heartbeat` crate reads one canonical JSON request, verifies legacy raw Ed25519 and versioned NEP-413 wallet signatures, checks request binding, then writes one JSON verdict carrying OutLayer's originating NEAR transaction hash. The v3 `evaluators/service-availability` path verifies HTTPS probe reports from distinct operators, applies a pinned quorum and corroboration threshold, and records `Inconclusive` without changing health clocks. New source-policy schema v2 reports are authenticated by each operator's NEAR transaction and stored in a bounded public inbox with expiry, replacement, replay protection, and refundable storage credits; source-policy v1 and existing NEP-413 commitments keep their original behavior. The current testnet contract code hash is `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN`, deployed in transaction [`6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA`](https://testnet.nearblocks.io/txns/6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA); the evaluator SHA-256 is `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`. `packages/sdk` provides typed contract calls and views, canonical heartbeat construction, NEP-413 key fingerprints, challenge lookup, and event parsing. Its `NearJsonRpcTransport` performs finalized read-only views through NEAR JSON-RPC and delegates transaction submission to an injected wallet sender. `apps/console` supports testnet commitment creation with editable starter templates for open-source maintenance and community-service continuity, wallet-based maintainer-key pinning, separate sponsor funding for escrow and evaluator operations, activation, bounded commitment browsing, health timelines, permissionless expiry, challenges, claims and retries, closure/refunds, separate-device operator setup, wallet restoration across page refreshes, and a persistent light/dark theme toggle. Templates only prefill subject and policy values; the maintenance-heartbeat evaluator checks signed bindings and digest format, while the service-availability evaluator checks public endpoint observations but does not prove underlying service quality. `services/event-indexer` is a Cloudflare Worker that stores finalized LCP events in D1 for paginated public history; contract reads remain authoritative for health, eligibility, and settlement. The connector receives the configured NEAR network and uses the wallet `signMessage` capability without vendor-specific code. Existing base-policy v1 commitments retain raw Ed25519 verification; base-policy v2 pins a fingerprint of the typed NEAR public key. Commitment `22` demonstrates an invalidation-and-recovery history; its timeline and OutLayer hash bindings were confirmed. TEE quote verification remains in OutLayer's Verify report or standalone `outlayer-verify`. See [P1-ARCHITECTURE.md](P1-ARCHITECTURE.md), [TODO.md](TODO.md), [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md), and [HACKATHON-SUBMISSION-PREP.md](HACKATHON-SUBMISSION-PREP.md).

Additional P1 paths include v3 service-policy amendments, a bounded payout adapter, and the consent-based reviewer-access Worker. The independent reviewer identified nine findings, and local source remediations are in place; the deployed Workers predate them, and migration 0004 and acceptance remain pending. Keep Console access gated until deployment, acceptance, and follow-up review are complete. A testnet-only Console flow now deploys and initializes the checked adapter WASM, funds its pool, and reads pool status through a connected NEAR wallet. Amendment and adapter lifecycle validation on testnet also remain pending. Private evaluator retrieval remains gated on a separately verified OutLayer secret flow. See [P1-ARCHITECTURE.md](P1-ARCHITECTURE.md) for their boundaries, and [SECURITY-REVIEW.md](services/reviewer-access/SECURITY-REVIEW.md) for the reviewer-access audit scope.

## Contract upgrade authority and mainnet policy

The LCP core and bounded payout adapter do not expose owner, key-management, migration, or self-upgrade methods. NEAR account-level `FullAccess` keys still control code deployment; a key holder could replace a value-holding contract's code. For v1 mainnet, the chosen policy is **immutable deployment**: after independent audit and reproducible build verification, deploy the core and each value-holding adapter, verify code and initialization, remove every access key from those contract accounts, and confirm their finalized access-key lists are empty. This gate has not been performed; testnet accounts remain upgradeable for development.

There will be no administrator or emergency upgrade path for v1. A future protocol release must use a new account and version; existing v1 commitments remain on the original contract and are not migrated automatically. This trades emergency repair flexibility for eliminating account-key code replacement after launch. The mainnet release checklist and exact build commands are in [TESTING.md](TESTING.md).

The contract pins `near-sdk` 5.29.1. Rust 1.100.0 is the selected and minimum supported compiler for local development, CI, and reproducible contract builds; `rust-toolchain.toml`, `Cargo.toml`, and both NEP-330 build images use that exact version. The Borsh policy layout stays fixed: v1 stores the raw public key, while v2 uses its existing 32-byte key slot for the SHA-256 fingerprint of a typed NEAR public key. Evaluator input JSON has its own canonical byte digest. Follow [CONSOLE-GUIDE.md](CONSOLE-GUIDE.md) to tour the testnet fixtures and wallet flow.

## Development

Check the contracts and build the evaluators locally with:

```sh
cargo near check --locked --manifest-path contracts/lcp-core/Cargo.toml
cargo near check --locked --manifest-path contracts/bounded-payout-adapter/Cargo.toml
cargo build -p maintenance-heartbeat --target wasm32-wasip2 --release --locked
cargo build -p service-availability-evaluator --target wasm32-wasip2 --release --locked
```

`cargo near check` validates contracts with NEAR's on-chain host configuration. Use the [pinned reproducible build](TESTING.md#reproducible-contract-builds-and-mainnet-key-gate) for release artifacts.

Install the JavaScript workspaces, then build the TypeScript SDK:

```sh
npm install
npm --prefix packages/sdk run build
```

Run the LCP Console locally after installing its dependencies and setting a deployed testnet contract ID in `apps/console/.env.local`:

```sh
cp apps/console/.env.example apps/console/.env.local
npm run dev --workspace=@lcp/console
```

The LCP Console can inspect a commitment by ID or browse recent records in bounded pages of up to ten. Contract health and claim eligibility come from NEAR views. Configure `NEXT_PUBLIC_LCP_CONTRACT_ID` with the deployed testnet contract before using wallet-signing actions; v3 creation additionally requires the v3 contract upgrade and a reachable service-evaluator WASM URL. New commitments pin the connected maintainer's typed key through NEP-413 and request heartbeat signatures from the wallet; users choose a compatible wallet, and the app passes the configured network explicitly. Existing v1 commitments retain their original raw Ed25519 evidence format.

The testnet Console configuration enables the public indexed event archive at `https://lcp-event-indexer.wasabinetwork.workers.dev`. For local development, set `NEXT_PUBLIC_LCP_EVENT_INDEXER_URL=http://127.0.0.1:8787`, apply the local D1 migration, and start the Worker as described in [the event indexer guide](services/event-indexer/README.md). The archive is paginated and informational; the LCP Console continues to read health, eligibility, and settlement from NEAR.

The reviewer Worker security remediations are deployed to production and preview, and migration 0004 is applied. Manual acceptance and independent follow-up review remain open, so keep the Console panel disabled and `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL` blank. Preview and production currently share the private D1 database, its rate counters, and the R2 bucket; see the queued isolation decision in [TODO.md](TODO.md). Follow [the reviewer-access guide](services/reviewer-access/README.md); do not enable a public bucket.

### Cloudflare Pages

The LCP Console builds as a static Next.js export; no Next.js server or VPS is required. It also exports `/health` as a JSON endpoint for static-edge availability; this does not check NEAR RPC, the contract, or OutLayer. From the repository root, configure the Pages build command as `npm run build --workspace=@lcp/console` and the output directory as `apps/console/out`. The root `.nvmrc` selects Node.js 22. For a direct-upload preview, deploy the built files with `npx wrangler pages deploy apps/console/out --project-name=lcp-preview --branch=preview`. Set `NEXT_PUBLIC_LCP_CONTRACT_ID`, `NEXT_PUBLIC_NEAR_NETWORK_ID`, and `NEXT_PUBLIC_NEAR_RPC_URL` as build variables; the testnet build can use the public indexer URL from `.env.example`. These are public browser configuration, not secrets. Never add maintainer private keys or `.env.testnet` to a Pages build.

The evaluator accepts its request on standard input and prints the verdict on standard output. Use only test keys and testnet funding while validating the full callback path.

The engineering baseline and product requirements are in the two specification documents at the repository root. See [TESTING.md](TESTING.md) for automated checks and reproducible builds, [CONSOLE-GUIDE.md](CONSOLE-GUIDE.md) for the browser journey, and [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md) for live testnet receipts. `NEAR-HACKATHON-SKILL.md` is a snapshot of the supplied workflow; recheck the official live instructions before submission.

## License

Project-authored software and documentation are licensed under Apache-2.0; see [LICENSE](LICENSE). `NEAR-HACKATHON-SKILL.md` is an upstream snapshot and is excluded from this license. It remains subject to applicable rights and terms from [the source](https://nearhackathon.com/HACKATHON.md).
