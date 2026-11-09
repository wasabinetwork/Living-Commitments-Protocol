# Testnet Demo Walkthrough

This guide follows a commitment from its policy and evidence through time-based health and budget eligibility. Use NEAR testnet only. The demo never needs a maintainer private key; sign the exact payload offline and paste only the resulting signature.

## Start the Demo

Set the public app configuration in the ignored `apps/demo/.env.local` file:

```dotenv
NEXT_PUBLIC_LCP_CONTRACT_ID=livingcommitmentsprotocol.testnet
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_RPC_URL=https://test.rpc.fastnear.com
```

Run `npm run dev --workspace=@lcp/demo` and open `http://localhost:3000`. Connect a testnet wallet only when a transaction is needed. Browse recent commitments to inspect existing records; the user has confirmed the recent list, older-page control, wallet connection, and disconnection.

## Follow Existing Testnet Examples

1. Inspect commitment `21` and refresh **Health clock**. It began as `AwaitingEvidence`; its initial deadline is Nov 9, 2026 at 00:21:40 AST, and grace ends at 01:21:40 AST. The cron monitor records finalized health once a minute in `/private/tmp/lcp-temporal-monitor-21.jsonl`. State may have advanced since those initial observations, so use the current on-chain view.
2. Inspect commitment `8` for an upheld challenge; the compliant evaluation remains valid.
3. Inspect commitment `9` for its later compliant recovery evaluation. The earlier invalidation and recovery receipts are linked in `TESTNET-E2E-STATUS.md`.
4. Inspect commitment `19` for the completed payout, closure, and residual escrow refund.

The dashboard's health is contract-derived. The timeline distinguishes recorded commitment timestamps from deadlines derived using the immutable policy and finalized NEAR block time.

## Walk Through Wallet Transactions

Use a test commitment and the appropriate role wallet for each action:

1. Connect the intended creator testnet wallet and create a draft; that wallet becomes the recorded creator. Set the sponsor, maintainer, arbiter, beneficiary, evaluator HTTPS URL and matching WASM digest, temporal policy, tranche amount, and maximum epochs. The form shows the total escrow target.
2. Fund escrow to the displayed target and fund evaluator operations with at least one execution deposit. These are separate transactions. Activate after both are funded.
3. In the evidence card, enter the artifact SHA-256 and prepare the canonical payload. Sign that exact UTF-8 payload offline with the maintainer key pinned in policy, paste the 128-character lowercase hex signature, and request evaluation. Refresh after the OutLayer callback to read the accepted result and updated health.
4. Connect the beneficiary wallet and claim only when the contract reports an eligible tranche. If a transfer fails and eligibility returns, retry from the same action card.
5. Resolve pending evaluations, challenges, and transfers before closing. Then connect the sponsor wallet to request any residual escrow refund.

## Remaining Manual Check

The user has confirmed wallet connect/disconnect and the health clock display. The remaining browser journey is to exercise draft creation, separate funding, activation, signed evidence submission, beneficiary claim or retry, closure, and sponsor refund. Do not use a real wallet key or mainnet funds for this walkthrough.
