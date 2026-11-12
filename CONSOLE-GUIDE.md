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

1. Connect the intended creator testnet wallet and create a draft; that wallet becomes the recorded creator. Choose an editable starter template for open-source maintenance or community-service continuity, then review the subject, temporal windows, epoch schedule, and tranche values. The community-service preset is illustrative: the current evaluator checks the signed heartbeat and digest format, not whether the real-world service is operating. Connect the maintainer wallet, click **Pin connected wallet key**, and approve the NEP-413 request. Set the sponsor, maintainer, arbiter, beneficiary, evaluator HTTPS URL and matching WASM digest, temporal policy, tranche amount, and maximum epochs. The arbiter must be a different account from the maintainer, sponsor, and beneficiary. The form shows the total escrow target.
2. Fund escrow to the displayed target and fund evaluator operations with at least one execution deposit. These are separate transactions. Activate after both are funded.
3. In the evidence card, choose the evidence file (up to 25 MiB). The browser calculates its SHA-256 locally; the file is not uploaded. Confirm the displayed digest, then prepare the canonical payload. Connect the maintainer wallet, click **Sign with maintainer wallet**, approve the NEP-413 request, then request evaluation. The app checks the returned account and public-key fingerprint against policy. Refresh after the OutLayer callback to read the accepted result and updated health. The evaluator verifies the signature and digest format; it does not inspect the local file contents. If the evidence later expires, a fresh compliant evaluation can recover a Breached commitment only when its policy permits recovery; the sponsor can add operations funds while it remains active.
4. Connect the configured beneficiary wallet and claim only when the contract reports an eligible tranche. If a transfer fails and the callback restores eligibility, retry from the same action card.
5. Resolve pending evaluations, challenges, and transfers before closing. The beneficiary may close voluntarily; doing so forfeits any eligible tranche and future support. Another authorized party cannot close while a tranche is eligible. After closure, connect the sponsor wallet to request any residual escrow refund.

### Audit finding 4: challenge timeout and closure

After the updated core is deployed, create a short-lived test commitment with distinct maintainer, sponsor, beneficiary, and arbiter accounts. Confirm creation rejects an arbiter equal to any of those three roles. Accept compliant evidence and open a challenge before its challenge window ends. Let the challenge resolution deadline pass, then connect any testnet account and click **Expire after deadline**. The result should be `TimedOut`, accepted evidence should remain recorded, and the reserved epoch should become claimable for the remaining duration of its normal claim window after timeout. Submit the claim from the beneficiary wallet. On a separate fresh commitment, explicitly invalidate a challenge and confirm its reserved claim does not resume. Also confirm a sponsor cannot close over an eligible tranche, the beneficiary can claim it, and the beneficiary can choose **Close and forfeit eligible tranche** after the confirmation prompt.

## Staged P1 Workflows

The transaction-authenticated source-policy v2 contract is deployed to testnet, its evaluator is published to R2, and the updated Console is deployed at <https://f989c150.lcp-preview.pages.dev> with stable alias <https://preview.lcp-preview.pages.dev>. Both `/health` routes returned HTTP 200 on 2026-11-12. The preview includes ordered read-RPC fallback, the single-line wallet badge, and testnet-only adapter deploy/initialize and pool-funding controls; manual Firefox review of the latest changes is pending. The contract code hash is `FR3TS4oyqGRtHxjo8y7jLRi13ruWwJ3Cs9gdcKgT3mvG`. The evaluator SHA-256 is `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`; use <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm>. Service-policy creation attaches a fixed 0.05 NEAR storage bond; the contract retains the measured requirement and refunds the unused amount. Existing source-policy v1 commitments keep their NEP-413 flow. Commitment `26` remains a separate legacy-evaluator fixture. The testnet reviewer Worker is deployed, but its Console integration remains gated pending independent security review.

### Independent service probes

Create a fresh v3 commitment with at least two distinct operator account IDs and the v2 evaluator URL/digest above. Pin only the maintainer key during creation; the operators do not need to join the creator's browser or provide public keys. Each operator opens the commitment on their own device, connects the listed NEAR account, enters the authorized HTTPS URL and private target salt, runs the health check, then submits the report in one wallet transaction. The contract authenticates the transaction account and records the report in the public NEAR inbox. The probe works only when the Console and health endpoint share an HTTPS origin; other origins retain the standalone tool fallback for legacy source-policy v1 in [the evaluator guide](evaluators/service-availability/README.md). Operators fund a temporary storage bond and can withdraw its credit after consumption, replacement, or expiry. The sponsor reviews the inbox and requests evaluation from unexpired reports. Reports are public; never include the URL, salt, response body, credentials, or personal data. The Console shows the configured denominator, valid/up/down/abstain counts, and agreement coverage.

Exact report replay rejection and expiry reclaim/refund were confirmed in Firefox on commitment `27` on 2026-11-11. To reproduce, open <https://preview.lcp-preview.pages.dev/?lcpReplayTest=1> and use a v2 test commitment with no pending evaluation or challenge. Connect a listed operator, run one health check, submit it, then click **Repeat identical report · test replay rejection** before the sponsor requests evaluation. Approve the second wallet transaction. The contract should reject it with `this exact signed report is already staged`; check the wallet transaction details rather than treating any generic submission error as a pass. The preview-only control stores the just-submitted payload in page memory and is hidden unless the preview or localhost URL includes `lcpReplayTest=1`.

### Private reviewer access

The testnet Worker, private D1 database, and private R2 bucket are deployed as described in [the service guide](services/reviewer-access/README.md), but the Console integration remains disabled pending independent security review. Do not set `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL` until that gate is complete. When enabled, the maintainer creates a salted digest receipt from a local file and shares the digest and receipt with the intended reviewer over a private channel. The reviewer creates a local key, keeps the downloaded encrypted backup and passphrase, and signs an access request with their NEAR wallet. The maintainer loads the pending request, selects the matching file and receipt, and signs **Encrypt file and approve**. The reviewer signs the download and decrypts the artifact in their browser; the UI verifies the salted digest. The maintainer can then revoke the grant. Revocation prevents future downloads and purges stored ciphertext, but cannot recall a decrypted copy. This workflow shares supplemental evidence; it does not prove the file was used by the evaluator.

### Policy amendment and authority adapter

The deployed LCP contract contains the amendment methods. Audit findings 1, 4, and 5 require an updated core before resuming adapter or governance testnet validation. The reproducible core WASM from source commit `8792e9c7a621aea9fce87f72ee83a4a27c289b92` is 684,710 bytes with SHA-256 `e630900a8b88734b43c2edb0292fc8bede632ad81a0b880fe44d2b323fa59329`; deploy it through the authorized contract wallet. Persisted Borsh state layout is unchanged. On a dedicated v3 commitment, propose an amendment at least one hour in the future and have each distinct sponsor, maintainer, beneficiary, and arbiter connect their own wallet and approve. Confirm any required approver can reject before expiry, including one who already approved; the view should show `rejected`, the active policy digest should remain unchanged, and a new proposal should be accepted immediately. Also verify a non-approver cannot reject, then exercise proposer cancellation, permissionless expiry, successful activation, and evidence-clock reset on separate proposals.

For this testnet fixture, `lcppool.testnet` is the adapter contract account and `lcpsponsor.testnet` is the pool manager; `lcprecipient.testnet` is the fixed recipient. A finalized read at block `277258864` showed that `lcppool.testnet` had no deployed code. Rebuild `lcp-bounded-payout-adapter` and verify SHA-256 `f98a1361ad81c460ad694843926e8ce86334e21f641b052f11a8456d1c1b1e33` for `target/wasm32-unknown-unknown/release/lcp_bounded_payout_adapter.wasm`; deploy and initialize it with `livingcommitmentsprotocol.testnet`, `lcprecipient.testnet`, and `lcpsponsor.testnet` as the respective LCP, recipient, and manager arguments. Meteor blocked the Console's dApp-originated `DeployContract` request, so use a deliberate local deployment signer rather than retrying that prompt. Then connect `lcpsponsor.testnet` in the Console, refresh pool status, fund `0.05 NEAR`, and confirm the pool balance. This test account retains a FullAccess key that can replace its code; keep this setup on testnet and use a separate, secured adapter account in production.

On a dedicated v3 commitment whose sponsor or beneficiary is `lcpsponsor.testnet`, create a bounded grant naming the adapter and fixed recipient, with per-action and cumulative limits and an expiry. The grant creator must equal the adapter's configured pool manager. Refresh adapter status first, then connect the manager wallet to create the grant. Only execute after NEAR reports normal claim eligibility as true. Verify that a non-manager grant is rejected, plus an empty-pool rejection, successful payout, failed-transfer reconciliation where a disposable failed recipient is available, revocation, one-action-per-epoch limits, and manager withdrawal of available funds after pending transfers settle. A failed adapter call consumes the LCP grant allowance conservatively.

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
