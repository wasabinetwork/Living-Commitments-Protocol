# Testnet Demo Walkthrough

This guide follows a commitment from its policy and evidence through time-based health and budget eligibility. Use NEAR testnet only. The demo never asks for a private key; new commitments use the connected NEAR wallet's NEP-413 message-signing capability.

## Start the Demo

Set the public app configuration in the ignored `apps/demo/.env.local` file:

```dotenv
NEXT_PUBLIC_LCP_CONTRACT_ID=livingcommitmentsprotocol.testnet
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_RPC_URL=https://test.rpc.fastnear.com
```

Run `npm run dev --workspace=@lcp/demo` and open `http://localhost:3000`. The demo follows the system color preference and lets you switch between dark and light mode from the top bar. Connect a testnet wallet when signing or submitting an action. Browse recent commitments to inspect existing records; the user has confirmed the recent list, older-page control, wallet connection, and disconnection.

## Follow Existing Testnet Examples

1. Inspect commitment `22` and refresh **Health clock**. It shows evaluation `1`, challenge `4` invalidation, and evaluation `2` recovery, followed by policy-derived evidence expiry and grace deadlines. Its latest snapshot showed the next claim blocked during the challenge window.
2. Open evaluation `2` and confirm the OutLayer public record's transaction, input, output, and WASM hashes match the contract record. This panel checks hash bindings; use the linked OutLayer report's **Verify** action or standalone verifier for the TEE quote.
3. Inspect commitment `21` and refresh **Health clock** for the short initial evidence window. Its initial deadline was Nov 9, 2026 at 00:21:40 AST, and grace ended at 01:21:40 AST. The cron monitor records finalized health once a minute in `/private/tmp/lcp-temporal-monitor-21.jsonl`; check the current state because the deadline may have passed.
4. Inspect commitment `8` for an upheld challenge and `9` for an invalidation followed by recovery. Inspect `19` for the completed payout, closure, and residual escrow refund.

The dashboard's health is contract-derived. The timeline distinguishes recorded commitment timestamps from deadlines derived using the immutable policy and finalized NEAR block time. It also shows accepted-evidence age, expiration, and time remaining to the next deadline; refresh it to update that snapshot. Outcomes from challenges created before completion timestamps were stored cannot be placed at an exact time and are labeled accordingly.

## Walk Through Wallet Transactions

Use a test commitment and the appropriate role wallet for each action:

1. Connect the intended creator testnet wallet and create a draft; that wallet becomes the recorded creator. Connect the maintainer wallet, click **Pin connected wallet key**, and approve the NEP-413 request. Set the sponsor, maintainer, arbiter, beneficiary, evaluator HTTPS URL and matching WASM digest, temporal policy, tranche amount, and maximum epochs. The form shows the total escrow target.
2. Fund escrow to the displayed target and fund evaluator operations with at least one execution deposit. These are separate transactions. Activate after both are funded.
3. In the evidence card, choose the evidence file (up to 25 MiB). The browser calculates its SHA-256 locally; the file is not uploaded. Confirm the displayed digest, then prepare the canonical payload. Connect the maintainer wallet, click **Sign with maintainer wallet**, approve the NEP-413 request, then request evaluation. The app checks the returned account and public-key fingerprint against policy. Refresh after the OutLayer callback to read the accepted result and updated health. The evaluator verifies the signature and digest format; it does not inspect the local file contents.
4. Connect the configured beneficiary wallet and claim only when the contract reports an eligible tranche. If a transfer fails and the callback restores eligibility, retry from the same action card.
5. Resolve pending evaluations, challenges, and transfers before closing. Connect an authorized party to close, then connect the sponsor wallet to request any residual escrow refund.

## Remaining Manual Check

The user has confirmed wallet connect/disconnect, older-page browsing, commitment `21`'s health clock, commitment `22`'s historical timeline and attestation hash-binding status, and commitment `24` creation/funding/activation/evaluation plus local artifact hashing in Firefox. The remaining P0 browser journey is beneficiary claim, closure, and sponsor refund. Transfer failure/retry is already validated in contract tests and on a separate testnet fixture; its wallet UI path remains unverified. Do not use mainnet funds for this walkthrough.
