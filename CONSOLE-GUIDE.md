# LCP Console User Guide

This guide follows a commitment from its policy and evidence through time-based health and budget eligibility. Use NEAR testnet only. The LCP Console never asks for a private key; new commitments use the connected NEAR wallet's NEP-413 message-signing capability.

## Start the LCP Console

Set the public app configuration in the ignored `apps/console/.env.local` file:

```dotenv
NEXT_PUBLIC_LCP_CONTRACT_ID=livingcommitmentsprotocol.testnet
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_RPC_URL=https://test.rpc.fastnear.com
NEXT_PUBLIC_NEAR_RPC_FALLBACK_URLS=https://near-testnet.drpc.org,https://testnet-rpc.intea.rs
NEXT_PUBLIC_LCP_EVENT_INDEXER_URL=https://lcp-event-indexer.wasabinetwork.workers.dev
```

Run `npm run dev --workspace=@lcp/console` and open `http://localhost:3000`. The LCP Console follows the system color preference and lets you switch between dark and light mode from the top bar. Contract reads and finalized time use the primary RPC, then the configured fallback URLs in order. All endpoints must be for the selected network. Connect a testnet wallet when signing or submitting an action; on reload, the Console restores a saved connector session without opening the wallet prompt again. The recent list, older-page control, wallet connection, and explicit disconnection have been manually checked in Firefox.

## Follow Existing Testnet Examples

1. Inspect commitment `22` and refresh **Health clock**. It shows evaluation `1`, challenge `4` invalidation, and evaluation `2` recovery, followed by policy-derived evidence expiry and grace deadlines. Its latest snapshot showed the next claim blocked during the challenge window.
2. Open evaluation `2` and confirm the OutLayer public record's transaction, input, output, and WASM hashes match the contract record. This panel checks hash bindings; use the linked OutLayer report's **Verify** action or standalone verifier for the TEE quote.
3. Inspect commitment `21` and refresh **Health clock** for the short initial evidence window. Finalized samples first reported `AtRisk` at 00:21:58 AST and `Breached` at 01:21:59 AST on Nov 9. This is now a historical boundary example; see the recorded samples noted in the testnet status document.
4. Inspect commitment `8` for an upheld challenge and `9` for an invalidation followed by recovery. Inspect `19` for the completed payout, closure, and residual escrow refund.

The dashboard's health is contract-derived. The timeline distinguishes recorded commitment timestamps from deadlines derived using the immutable policy and finalized NEAR block time. It also shows accepted-evidence age, expiration, and time remaining to the next deadline; refresh it to update that snapshot. Outcomes from challenges created before completion timestamps were stored cannot be placed at an exact time and are labeled accordingly.

## Optional Indexed Event Archive

The independent event archive appears only when `NEXT_PUBLIC_LCP_EVENT_INDEXER_URL` is configured. Start it with the local D1 migration and Worker steps in [the indexer guide](services/event-indexer/README.md), then load a commitment in Firefox. Confirm the archive reports its indexing status, lists finalized LCP events with transaction links, and expands public event data. If the indexer is behind, its lag appears in the archive; the contract-derived health timeline and settlement panels remain separate. Use **Load older events** when the selected commitment has more than one page.

## Walk Through Wallet Transactions

Use a test commitment and the appropriate role wallet for each action:

1. Connect the intended creator testnet wallet and create a draft; that wallet becomes the recorded creator. Choose an editable starter template for open-source maintenance or community-service continuity, then review the subject, temporal windows, epoch schedule, and tranche values. The community-service preset is illustrative: the current evaluator checks the signed heartbeat and digest format, not whether the real-world service is operating. Connect the maintainer wallet, click **Pin connected wallet key**, and approve the NEP-413 request. Set the sponsor, maintainer, arbiter, beneficiary, evaluator HTTPS URL and matching WASM digest, temporal policy, tranche amount, and maximum epochs. The form shows the total escrow target.
2. Fund escrow to the displayed target and fund evaluator operations with at least one execution deposit. These are separate transactions. Activate after both are funded.
3. In the evidence card, choose the evidence file (up to 25 MiB). The browser calculates its SHA-256 locally; the file is not uploaded. Confirm the displayed digest, then prepare the canonical payload. Connect the maintainer wallet, click **Sign with maintainer wallet**, approve the NEP-413 request, then request evaluation. The app checks the returned account and public-key fingerprint against policy. Refresh after the OutLayer callback to read the accepted result and updated health. The evaluator verifies the signature and digest format; it does not inspect the local file contents. If the evidence later expires, a fresh compliant evaluation can recover a Breached commitment only when its policy permits recovery; the sponsor can add operations funds while it remains active.
4. Connect the configured beneficiary wallet and claim only when the contract reports an eligible tranche. If a transfer fails and the callback restores eligibility, retry from the same action card.
5. Resolve pending evaluations, challenges, and transfers before closing. Connect an authorized party to close, then connect the sponsor wallet to request any residual escrow refund.

## Staged P1 Workflows

The transaction-authenticated source-policy v2 contract is deployed to testnet, its evaluator is published to R2, and the updated Console is deployed at <https://ed6d81cc.lcp-preview.pages.dev> with stable alias <https://preview.lcp-preview.pages.dev>. Both `/health` routes returned HTTP 200 on 2026-11-11. The preview includes ordered read-RPC fallback and the connected-wallet badge wrapping fix; the latter still needs a manual narrow-screen Firefox check. The contract code hash is `FR3TS4oyqGRtHxjo8y7jLRi13ruWwJ3Cs9gdcKgT3mvG`. The evaluator SHA-256 is `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`; use <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm>. Service-policy creation attaches a fixed 0.05 NEAR storage bond; the contract retains the measured requirement and refunds the unused amount. Existing source-policy v1 commitments keep their NEP-413 flow. Commitment `26` remains a separate legacy-evaluator fixture. Reviewer access remains disabled until its private Worker resources are provisioned and deployed.

### Independent service probes

Create a fresh v3 commitment with at least two distinct operator account IDs and the v2 evaluator URL/digest above. Pin only the maintainer key during creation; the operators do not need to join the creator's browser or provide public keys. Each operator opens the commitment on their own device, connects the listed NEAR account, enters the authorized HTTPS URL and private target salt, runs the health check, then submits the report in one wallet transaction. The contract authenticates the transaction account and records the report in the public NEAR inbox. The probe works only when the Console and health endpoint share an HTTPS origin; other origins retain the standalone tool fallback for legacy source-policy v1 in [the evaluator guide](evaluators/service-availability/README.md). Operators fund a temporary storage bond and can withdraw its credit after consumption, replacement, or expiry. The sponsor reviews the inbox and requests evaluation from unexpired reports. Reports are public; never include the URL, salt, response body, credentials, or personal data. The Console shows the configured denominator, valid/up/down/abstain counts, and agreement coverage.

Exact report replay rejection and expiry reclaim/refund were confirmed in Firefox on commitment `27` on 2026-11-11. To reproduce, open <https://preview.lcp-preview.pages.dev/?lcpReplayTest=1> and use a v2 test commitment with no pending evaluation or challenge. Connect a listed operator, run one health check, submit it, then click **Repeat identical report · test replay rejection** before the sponsor requests evaluation. Approve the second wallet transaction. The contract should reject it with `this exact signed report is already staged`; check the wallet transaction details rather than treating any generic submission error as a pass. The preview-only control stores the just-submitted payload in page memory and is hidden unless the preview or localhost URL includes `lcpReplayTest=1`.

### Private reviewer access

After provisioning the private Worker, D1 database, and private R2 bucket as described in [the service guide](services/reviewer-access/README.md), set `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL` and run the Console on its configured HTTPS origin. The maintainer creates a salted digest receipt from a local file and shares the digest and receipt with the intended reviewer over a private channel. The reviewer creates a local key, keeps the downloaded encrypted backup and passphrase, and signs an access request with their NEAR wallet. The maintainer loads the pending request, selects the matching file and receipt, and signs **Encrypt file and approve**. The reviewer signs the download and decrypts the artifact in their browser; the UI verifies the salted digest. The maintainer can then revoke the grant. Revocation prevents future downloads and purges stored ciphertext, but cannot recall a decrypted copy. This workflow shares supplemental evidence; it does not prove the file was used by the evaluator.

### Policy amendment and authority adapter

The deployed LCP contract already contains the amendment methods; the current local 938,518-byte build has the same code hash. On a dedicated v3 commitment, prepare the new source-policy JSON and propose an amendment at least one hour in the future. Each distinct sponsor, maintainer, beneficiary, and arbiter connects their own wallet and approves. Once the activation time and all approvals are satisfied, activate the amendment; confirm the policy digest changes and the evidence clock restarts. Also exercise proposer cancellation and permissionless expiry on separate proposals.

For the adapter, deploy an instance with the LCP contract, fixed resource recipient, and pool-manager account, then prefund its pool. A sponsor or beneficiary can create a bounded grant with an adapter account, recipient, per-action and cumulative limits, and expiry. Only execute after NEAR reports the normal claim eligibility as true. Verify that an empty pool or failed recipient transfer restores the adapter's available pool, that the LCP grant allowance remains consumed on a failed adapter call, and that the pool manager can withdraw only available funds after pending transfers settle.

### Dedicated governance testnet accounts

Use separate Firefox wallet sessions for each role; never sign for one role from another role's wallet. These accounts were checked against finalized testnet state on 2026-11-11 17:16 UTC and each had `0 NEAR`, so fund them from the official testnet faucet before creating fixtures or signing transactions.

| Test role | NEAR account | Use |
| --- | --- | --- |
| Sponsor | `lcpsponsor.testnet` | Propose or approve policy changes; fund escrow and create adapter grants |
| Maintainer | `lcpmaintainer.testnet` | Approve amendments and control maintenance evidence |
| Beneficiary | `lcpbeneficiary.testnet` | Approve amendments and exercise beneficiary grant authority |
| Arbiter | `lcparbiter.testnet` | Approve amendments and resolve disputes |
| Adapter pool manager | `lcppool.testnet` | Prefund the sample adapter and recover only unreserved pool funds |
| Adapter recipient | `lcprecipient.testnet` | Receive the adapter's bounded payout |

Use the first four accounts for amendment approval and cancellation/expiry fixtures. Use the last two only after a separate adapter account has been deployed and its upgrade authority is reviewed. No private keys are needed by the Console or repository.

## Verified Browser Journeys

These flows were manually verified in Firefox on NEAR testnet:

- Commitment `24`: create, fund, activate, pin the maintainer key with NEP-413, hash a local evidence file, request evaluation, recover with fresh evidence, close, and refund residual escrow. The three funded epochs ended before a tranche became claimable, so this fixture verifies refund rather than payout.
- Isolated failed-transfer fixture commitment `2`: the first payout transfer failed, the UI showed retry eligibility, and retry completed the payment.
- Commitment `19`: a tranche was paid, then the commitment was closed and remaining escrow refunded.
- Commitments `21` and `22`: the health countdown and historical invalidation/recovery timeline were checked. Commitment `21` naturally reached `AtRisk` and `Breached` on finalized testnet time.
- The Cloudflare Pages preview: wallet connect/disconnect, NEAR reads, and OutLayer report lookup worked from Firefox.
- Commitment `27`: two independent operator wallets completed two compliant quorum evaluations; replacement/refunds, exact-report replay rejection, expired-report reclaim/refund, wallet restoration, and persistent explicit disconnect were confirmed. Transaction references are in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md).

See [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md) for receipts and [TESTING.md](TESTING.md) for automated checks and build reproduction. Fixture health is time-dependent; refresh snapshots before using an existing commitment. Keep all manual transactions on testnet.
