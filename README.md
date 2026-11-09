# Living Commitments Protocol

Living Commitments Protocol (LCP) is a NEAR protocol for obligations that must remain true over time. A commitment's effective health is derived from accepted evidence, its immutable temporal policy, and NEAR block time. That health gates recurring budget tranches.

The MVP follows this verification path:

1. A maintainer submits a signed maintenance heartbeat.
2. A hash-pinned OutLayer WASM evaluator checks the evidence and returns a verdict.
3. The NEAR contract binds the result to its pending request and policy.
4. Evidence freshness moves the commitment through `Healthy`, `AtRisk`, and `Breached`.
5. The contract blocks claims while the commitment is not healthy or a blocking challenge is open; fresh qualifying evidence can restore future eligibility when policy allows.

TEE attestation demonstrates that the configured evaluator ran with particular inputs and outputs. It does not prove the evaluator is logically correct or that the external evidence source is truthful.

## Current implementation

The `contracts/lcp-core` crate contains the pure temporal engine and NEAR state layer for commitment creation, separate escrow and operations funding, activation, OutLayer evaluation requests, bounded evaluation history, challenges, health-gated tranche claims, asynchronous transfer reconciliation, closure/refunds, and read views. The immutable policy pins the maintainer's heartbeat signing key and OutLayer WASM digest. Evaluation requests bind canonical signed heartbeat evidence to a commitment, evaluation ID, policy digest, and timestamp; a private callback validates the returned verdict before updating temporal evidence. Request-time storage deposits reserve enough space for callback state changes.

The `evaluators/maintenance-heartbeat` crate reads one canonical JSON request, verifies the Ed25519 heartbeat signature and request binding, then writes one JSON verdict carrying OutLayer's originating NEAR transaction hash. `packages/sdk` provides typed contract calls and views, canonical heartbeat signing-message construction, challenge lookup, and event parsing. Its `NearJsonRpcTransport` performs finalized read-only views through NEAR JSON-RPC and delegates transaction submission to an injected wallet sender. `apps/demo` supports testnet commitment creation, separate sponsor funding for escrow and evaluator operations, activation, bounded recent-commitment browsing, commitment inspection, a health timeline that reconstructs recent status transitions and separates recorded events from policy-derived deadlines, evidence age and expiration, canonical heartbeat preparation, signed evaluation requests, permissionless expiry of timed-out requests, challenge opening and resolution, recent on-chain evaluation history, eligible beneficiary tranche claims and retries, commitment closure, sponsor refund of residual escrow, and a persistent light/dark theme toggle that follows the system preference by default. The wallet connector receives the configured NEAR network explicitly. The timeline uses a refreshable finalized-block timestamp; challenge outcomes from before completion timestamps were recorded are identified as missing exact times. Completed evaluations link to NEAR and display whether an OutLayer record was found and whether its transaction, input, output, and WASM hashes match the contract. The TEE quote still requires cryptographic verification through OutLayer's report or standalone `outlayer-verify` tool. Commitment `22` demonstrates a recorded invalidation-and-recovery history with derived freshness and grace deadlines; its browser timeline and hash-binding status were confirmed. The creation form pins the maintainer public key and evaluator WASM digest in the immutable policy. Maintainers sign prepared payloads outside the app; private key material never enters the demo. Testnet validation covers a verified OutLayer evaluation, evaluator failures and timeouts, breach-gated claims, healthy recovery, payout and transfer retry, arbiter outcomes, challenge timeout, closure/refund, and bounded pagination. Wallet connection/disconnection and older-page browsing are confirmed; the full wallet transaction journey and natural temporal transitions remain in progress. See [TODO.md](TODO.md), [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md), and [HACKATHON-SUBMISSION-PREP.md](HACKATHON-SUBMISSION-PREP.md).

The contract currently pins `near-sdk` 5.29.1 and declares Rust 1.94. The policy digest is SHA-256 over the Borsh serialization of the v1 policy struct; evaluator input JSON has its own canonical byte digest. Follow [DEMO-WALKTHROUGH.md](DEMO-WALKTHROUGH.md) to tour the testnet fixtures and wallet flow. Testnet receipts, the live temporal monitor, and remaining browser checks are tracked in [TODO.md](TODO.md) and [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md).

After preparing a heartbeat payload in the demo, copy it and run `pbpaste | node scripts/sign-heartbeat.mjs <maintainer-public-key-hex>` from the repository root on macOS, replacing the placeholder with the policy-pinned public key. The local helper reads `LCP_MAINTAINER_PRIVATE_KEY` or `NEAR_PRIVATE_KEY` from the ignored `.env.testnet` file or shell environment, verifies the derived public key against the policy pin, and writes only the signature to stdout. The private key never enters the browser or repository history.

## Development

Build the contract and evaluator with:

```sh
cargo build -p lcp-core -p maintenance-heartbeat
cargo build -p maintenance-heartbeat --target wasm32-wasip2 --release
```

Install the JavaScript workspaces, then build the TypeScript SDK:

```sh
npm install
npm --prefix packages/sdk run build
```

Run the demo locally after installing its dependencies and setting a deployed testnet contract ID in `apps/demo/.env.local`:

```sh
cp apps/demo/.env.example apps/demo/.env.local
npm run dev --workspace=@lcp/demo
```

The demo can inspect a commitment by ID or browse recent records in bounded pages of up to ten. Contract health and claim eligibility come from NEAR views. The list view requires the contract version that exposes `list_commitments`; configure `NEXT_PUBLIC_LCP_CONTRACT_ID` with a deployed testnet contract before using wallet actions. Draft creation, sponsor funding, activation, evaluation requests, challenge actions, permissionless timeout expiry, beneficiary claims, closure, and residual escrow refunds each use explicit wallet transactions. For evidence, the app uses a finalized NEAR block timestamp to prepare the exact UTF-8 heartbeat payload; sign it externally with the policy-pinned maintainer key, then paste the lowercase hexadecimal signature.

The evaluator accepts its request on standard input and prints the verdict on standard output. Use only test keys and testnet funding while validating the full callback path.

The engineering baseline and product requirements are in the two specification documents at the repository root. See `NEAR-HACKATHON-SKILL.md` for the supplied hackathon workflow snapshot; recheck the official live instructions before submission.
