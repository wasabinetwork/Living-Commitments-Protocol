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

The `evaluators/maintenance-heartbeat` crate reads one canonical JSON request, verifies the Ed25519 heartbeat signature and request binding, then writes one JSON verdict. `packages/sdk` provides typed contract calls and views, heartbeat signing-message construction, and event parsing. Its `NearJsonRpcTransport` performs finalized read-only views through NEAR JSON-RPC and delegates transaction submission to an injected wallet sender. `apps/demo` now has a testnet commitment lookup, wallet connection, and beneficiary tranche claim flow. It does not provide sample chain data, historical indexing, or an OutLayer execution link; those parts still need integration work. The OutLayer testnet execution and its returned bytes still need live integration verification; this repository does not claim a testnet deployment.

The contract currently pins `near-sdk` 5.29.1 and declares Rust 1.94. The policy digest is SHA-256 over the Borsh serialization of the v1 policy struct; evaluator input JSON has its own canonical byte digest.

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

The demo reads a commitment by ID because the current contract does not expose a commitment list. Contract health and claim eligibility come from NEAR views. The wallet action is limited to the eligible beneficiary claiming the current tranche.

The evaluator accepts its request on standard input and prints the verdict on standard output. Use only test keys and testnet funding while validating the full callback path.

The engineering baseline and product requirements are in the two specification documents at the repository root. See `NEAR-HACKATHON-SKILL.md` for the supplied hackathon workflow snapshot; recheck the official live instructions before submission.
