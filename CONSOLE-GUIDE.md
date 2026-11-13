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

After loading a commitment, start with the overview and **NEXT IN THIS COMMITMENT** message. The sticky stage bar jumps between **Setup**, **Evidence**, **Review**, and **Payout**; each stage shows its current state. Use **Choose another** to return to the ID lookup, or **Create new** to open the creation form. In Evidence, **Show full evaluation record and policy details** opens the advanced disclosure and jumps directly to the evaluation record. Source policy, reviewer access, and governance actions remain in that disclosure.

Use a test commitment and the appropriate role wallet for each action:

1. Connect the intended creator testnet wallet and create a draft; that wallet becomes the recorded creator. Choose an editable starter template for open-source maintenance or community-service continuity, then review the subject, temporal windows, epoch schedule, and tranche values. The community-service preset is illustrative: the current evaluator checks the signed heartbeat and digest format, not whether the real-world service is operating. Connect the maintainer wallet, click **Pin connected wallet key**, and approve the NEP-413 request. Set the sponsor, maintainer, arbiter, beneficiary, evaluator HTTPS URL and matching WASM digest, temporal policy, tranche amount, and maximum epochs. The arbiter must be a different account from the maintainer, sponsor, and beneficiary. The form shows the total escrow target.
2. Fund escrow to the displayed target and fund evaluator operations with at least one execution deposit. These are separate transactions. Activate after both are funded.
3. In the evidence card, choose the evidence file (up to 25 MiB). The browser calculates its SHA-256 locally; the file is not uploaded. Confirm the displayed digest, then prepare the canonical payload. Connect the maintainer wallet, click **Sign with maintainer wallet**, approve the NEP-413 request, then request evaluation. The app checks the returned account and public-key fingerprint against policy. Refresh after the OutLayer callback to read the accepted result and updated health. The evaluator verifies the signature and digest format; it does not inspect the local file contents. If the evidence later expires, a fresh compliant evaluation can recover a Breached commitment only when its policy permits recovery; the sponsor can add operations funds while it remains active.
4. Connect the configured beneficiary wallet and claim only when the contract reports an eligible tranche. If a transfer fails and the callback restores eligibility, retry from the same action card.
5. Resolve pending evaluations, challenges, and transfers before closing. The beneficiary may close voluntarily; doing so forfeits any eligible tranche and future support. Another authorized party cannot close while a tranche is eligible. After closure, connect the sponsor wallet to request any residual escrow refund.

### USDC testnet acceptance (pending)

The local NEP-141 path is not deployed or accepted on testnet yet. Complete the independent contract review and reproducible build first. Use only the Circle USDC testnet account `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`; each UI amount accepts up to six decimal places. Confirm the sponsor and beneficiary wallets hold testnet USDC and enough NEAR for gas and token storage before starting.

1. Create a fresh commitment, choose USDC, set a small tranche such as `0.01`, and review that the epoch count times the tranche is shown as the total USDC escrow. Keep operations funding separate in NEAR.
2. Connect the sponsor. If the LCP contract is not registered with USDC, use **Prepare LCP contract for USDC** and approve the NEAR storage deposit. Then use **Fund escrow** and approve the token wallet's `ft_transfer_call`; it attaches the required 1 yoctoNEAR security deposit plus gas, separate from the USDC amount. Confirm funded raw units match the six-decimal amount and that any excess was returned. Try activation before full funding on a disposable draft; it must fail. After full USDC escrow and NEAR evaluator operations funding, activate.
3. Complete evaluation and wait until the Console reports the beneficiary tranche eligible. Connect the beneficiary and use **Prepare beneficiary to receive USDC** if its token storage is missing or below the current NEP-145 minimum. Claim, then confirm the on-chain raw ledger moves through pending to paid only after the transfer callback succeeds.
4. On a separate disposable commitment, leave the sponsor unregistered for a residual refund to exercise failed-transfer recovery. Confirm the refund returns to free escrow after callback failure; register the sponsor, retry, and confirm the refunded balance increments once. Also run a successful refund and duplicate-callback check.
5. Record transaction hashes, token storage totals/minimum, NEAR deposits for gas/storage, and raw USDC funded/paid/refunded values. Re-run the existing NEAR payout and refund journeys to check legacy behavior.

The bounded payout adapter remains NEAR-only; do not create an authority grant for a USDC commitment.

### Audit finding 4: challenge timeout and closure

With the updated core deployed, create a fresh test commitment with distinct maintainer, sponsor, beneficiary, and arbiter accounts. Set the **OutLayer response deadline** to 180 seconds; commitment `28` showed a valid evaluator result can take about 65 seconds to reach the contract, while its 30-second deadline discarded that result. Confirm creation rejects an arbiter equal to any of the other roles. Accept compliant evidence and open a challenge before its challenge window ends. The Console shows the resolution deadline in local date/time with a countdown; after it passes, connect any testnet account and use **Expire after deadline** when the button becomes available. The result should be `TimedOut` and accepted evidence should remain recorded. A challenge timeout does not shorten the original evaluation challenge window: wait until that window ends and the Console reports the tranche eligible before testing that a sponsor cannot close it. Submit the claim from the beneficiary wallet. On a separate fresh commitment, explicitly invalidate a challenge and confirm its reserved claim does not resume. The beneficiary can choose **Close and forfeit eligible tranche** after the confirmation prompt.

## Staged P1 Workflows

The transaction-authenticated source-policy v2 contract is deployed to testnet, its evaluator is published to R2, and the updated Console is deployed at <https://f989c150.lcp-preview.pages.dev> with stable alias <https://preview.lcp-preview.pages.dev>. Both `/health` routes returned HTTP 200 on 2026-11-12. The preview includes ordered read-RPC fallback, the single-line wallet badge, and testnet-only adapter deploy/initialize and pool-funding controls; manual Firefox review of the latest changes is pending. The current core code hash is `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN`; it was upgraded in transaction [`6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA`](https://testnet.nearblocks.io/txns/6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA). The evaluator SHA-256 is `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`; use <https://artifacts.lcp.gama.works/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm>. The URL is a content-addressed key in the public evaluator bucket; the policy digest is still the integrity check. Service-policy creation attaches a fixed 0.05 NEAR storage bond; the contract retains the measured requirement and refunds the unused amount. Existing source-policy v1 commitments keep their NEP-413 flow. Commitment `26` remains a separate legacy-evaluator fixture. The nine reviewer Worker remediations are deployed to preview and production, and migration 0004 is applied to their shared D1 database; manual acceptance and independent follow-up review remain open, so Console integration stays gated.

### Independent service probes

Create a fresh v3 commitment with at least two distinct operator account IDs and the v2 evaluator URL/digest above. Pin only the maintainer key during creation; the operators do not need to join the creator's browser or provide public keys. Each operator opens the commitment on their own device, connects the listed NEAR account, enters the authorized HTTPS URL and private target salt, runs the health check, then submits the report in one wallet transaction. The contract authenticates the transaction account and records the report in the public NEAR inbox. The probe works only when the Console and health endpoint share an HTTPS origin; other origins retain the standalone tool fallback for legacy source-policy v1 in [the evaluator guide](evaluators/service-availability/README.md). Operators fund a temporary storage bond and can withdraw its credit after consumption, replacement, or expiry. The sponsor reviews the inbox and requests evaluation from unexpired reports. Reports are public; never include the URL, salt, response body, credentials, or personal data. The Console shows the configured denominator, valid/up/down/abstain counts, and agreement coverage.

Exact report replay rejection and expiry reclaim/refund were confirmed in Firefox on commitment `27` on 2026-11-11. To reproduce, open <https://preview.lcp-preview.pages.dev/?lcpReplayTest=1> and use a v2 test commitment with no pending evaluation or challenge. Connect a listed operator, run one health check, submit it, then click **Repeat identical report · test replay rejection** before the sponsor requests evaluation. Approve the second wallet transaction. The contract should reject it with `this exact signed report is already staged`; check the wallet transaction details rather than treating any generic submission error as a pass. The preview-only control stores the just-submitted payload in page memory and is hidden unless the preview or localhost URL includes `lcpReplayTest=1`.

### Private reviewer access

The reviewer Worker remediations and D1 migration 0004 are deployed to preview and production as described in [the service guide](services/reviewer-access/README.md); the environments currently share private D1/R2 resources. Manual acceptance and independent follow-up review remain open. Keep Console integration disabled and leave `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL` blank until both gates pass. When enabled, the maintainer creates a salted digest receipt from a local file and shares the digest and receipt with the intended reviewer over a private channel. The reviewer creates a local key, keeps the downloaded encrypted backup and passphrase, and signs an access request with their NEAR wallet. The maintainer loads the pending request, selects the matching file and receipt, and signs **Encrypt file and approve**. The reviewer signs the download and decrypts the artifact in their browser; the UI verifies the salted digest. The maintainer can then revoke the grant. Revocation prevents future downloads and purges stored ciphertext, but cannot recall a decrypted copy. This workflow shares supplemental evidence; it does not prove the file was used by the evaluator.

### Policy amendment and authority adapter

The reproducible core WASM from source commit `fa94be3535ff55820cc2ee3d54c90fbc8958341e` is 715,823 bytes with SHA-256 `e5d6ff737af8dabb8187b832fda43de8c159f6aad01dbbf541eddbb0734ed5ef` and NEAR code hash `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN`. It was deployed to testnet in transaction [`6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA`](https://testnet.nearblocks.io/txns/6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA), finalized at block `277430183`; a finalized read at block `277430259` confirmed commitment `27` remains readable with its existing state. Persisted Borsh state layout is unchanged. On a dedicated v3 commitment, propose an amendment at least one hour in the future and have each distinct sponsor, maintainer, beneficiary, and arbiter connect their own wallet and approve. Confirm any required approver can reject before expiry, including one who already approved; the view should show `rejected`, the active policy digest should remain unchanged, and a new proposal should be accepted immediately. Also verify a non-approver cannot reject, then exercise proposer cancellation, permissionless expiry, successful activation, and evidence-clock reset on separate proposals.

For this testnet fixture, `lcppool.testnet` is the adapter contract account and `lcpsponsor.testnet` is the pool manager; `lcprecipient.testnet` is the fixed recipient. A finalized read at block `277426448` showed that `lcppool.testnet` had never had code deployed. The reproducible adapter from source commit `02ccc7306b0d7b312be316569ef6af72f711e9e9` is 152,235 bytes with SHA-256 `3379e0b6bddb6b5da2fdf78e6b1fe5bc5216a2d4ab09fad9a525ef5140d87cd0`; use `target/reproducible/bounded-payout-adapter/lcp_bounded_payout_adapter.wasm`. Deploy and initialize it with `livingcommitmentsprotocol.testnet`, `lcprecipient.testnet`, and `lcpsponsor.testnet` as the respective LCP, recipient, and manager arguments. The local Console verifier pins this digest; deploy its updated build before using this artifact. Meteor blocked the Console's dApp-originated `DeployContract` request, so use a deliberate local deployment signer rather than retrying that prompt. Then connect `lcpsponsor.testnet` in the Console, refresh pool status, fund `0.05 NEAR`, and confirm the pool balance. This test account retains a FullAccess key that can replace its code; keep this setup on testnet and use a separate, secured adapter account in production.

On a dedicated v3 commitment whose sponsor or beneficiary is `lcpsponsor.testnet`, create a bounded grant naming the adapter and fixed recipient, with per-action and cumulative limits and an expiry. The grant creator must equal the adapter's configured pool manager. Refresh adapter status first, then connect the manager wallet to create the grant. Only execute after NEAR reports normal claim eligibility as true. Verify that a non-manager grant is rejected, plus an empty-pool rejection, successful payout, failed-transfer reconciliation where a disposable failed recipient is available, revocation, one-action-per-epoch limits, and manager withdrawal of available funds after pending transfers settle. LCP reserves the nonce, epoch, and cumulative allowance while the adapter call settles; the adapter must return `true` only when its action settles successfully. Its private callback restores all three grant values if the adapter call fails or reports `false`; the sample adapter also restores its pool after a failed transfer.

### Dedicated governance testnet accounts

Use separate Firefox wallet sessions for each role; never sign for one role from another role's wallet. After the owner funded them, finalized testnet reads on 2026-11-11 showed 5 NEAR in each account (block `277257669`; recipient read at block `277257668`). Recheck balances before creating fixtures or signing transactions.

| Test role | NEAR account | Use |
| --- | --- | --- |
| Sponsor | `lcpsponsor.testnet` | Propose or approve policy changes; fund escrow and create adapter grants |
| Maintainer | `lcpmaintainer.testnet` | Approve amendments and control maintenance evidence |
| Beneficiary | `lcpbeneficiary.testnet` | Approve amendments and exercise beneficiary grant authority |
| Arbiter | `lcparbiter.testnet` | Approve amendments and resolve disputes |
| Adapter test contract | `lcppool.testnet` | Receives the sample adapter WASM; its current empty account code will be replaced |
| Adapter pool manager | `lcpsponsor.testnet` | Fund the sample adapter and recover only unreserved pool funds in this fixture |
| Adapter recipient | `lcprecipient.testnet` | Receive the adapter's bounded payout |

Use the sponsor, maintainer, beneficiary, and arbiter accounts for amendment approval, rejection, activation, cancellation, and expiry fixtures. Use the adapter test account only on testnet; keep its FullAccess upgrade authority secured. No private keys are needed by the Console or repository.

## Verified Browser Journeys

These flows were manually verified in Firefox on NEAR testnet:

- Commitment `24`: create, fund, activate, pin the maintainer key with NEP-413, hash a local evidence file, request evaluation, recover with fresh evidence, close, and refund residual escrow. The three funded epochs ended before a tranche became claimable, so this fixture verifies refund rather than payout.
- Isolated failed-transfer fixture commitment `2`: the first payout transfer failed, the UI showed retry eligibility, and retry completed the payment.
- Commitment `19`: a tranche was paid, then the commitment was closed and remaining escrow refunded.
- Commitments `21` and `22`: the health countdown and historical invalidation/recovery timeline were checked. Commitment `21` naturally reached `AtRisk` and `Breached` on finalized testnet time.
- The Cloudflare Pages preview: wallet connect/disconnect, NEAR reads, and OutLayer report lookup worked from Firefox.
- Commitment `27`: two independent operator wallets completed two compliant quorum evaluations; replacement/refunds, exact-report replay rejection, expired-report reclaim/refund, wallet restoration, and persistent explicit disconnect were confirmed. Transaction references are in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md).

See [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md) for receipts and [TESTING.md](TESTING.md) for automated checks and build reproduction. Fixture health is time-dependent; refresh snapshots before using an existing commitment. Keep all manual transactions on testnet.
