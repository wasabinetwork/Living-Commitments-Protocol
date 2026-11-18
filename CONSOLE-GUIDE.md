# LCP Console User Guide

This guide follows a commitment from its policy and evidence through time-based health and budget eligibility. Use NEAR testnet only. The LCP Console never asks for a private key; new commitments use the connected NEAR wallet's NEP-413 message-signing capability.

## Start the LCP Console

Set the public app configuration in the ignored `apps/console/.env.local` file:

```dotenv
NEXT_PUBLIC_LCP_CONTRACT_ID=livingcommitmentsprotocol.testnet
NEXT_PUBLIC_NEAR_NETWORK_ID=testnet
NEXT_PUBLIC_NEAR_RPC_URL=https://test.rpc.fastnear.com
NEXT_PUBLIC_NEAR_RPC_FALLBACK_URLS=https://near-testnet.drpc.org,https://testnet-rpc.intea.rs
NEXT_PUBLIC_LCP_EVENT_INDEXER_URL=http://127.0.0.1:8787
```

Run `npm run dev --workspace=@lcp/console` and open `http://localhost:3000`. The LCP Console follows the system color preference and lets you switch between dark and light mode from the top bar. Contract reads and finalized time use the primary RPC, then the configured fallback URLs in order. All endpoints must be for the selected network. Connect a testnet wallet when signing or submitting an action; on reload, the Console restores a saved connector session without opening the wallet prompt again. The recent list, older-page control, wallet connection, and explicit disconnection have been manually checked in Firefox.

### Empty-state local fixture

The shared testnet contract cannot show a truly empty commitment list because its existing commitments are permanent. Use the isolated fixture to inspect that state:

```sh
npm ci
npm ci --prefix tests/sandbox-usdc-callbacks
cargo build -p lcp-core --target wasm32-unknown-unknown --release --locked
npm run fixture:empty-console
```

The script requires Docker. On first use it downloads the pinned NEAR Sandbox 2.14.0 binary into a temporary cache, starts a fresh chain, deploys the current `lcp_core.wasm` to `test.near`, initializes it with `new()`, verifies the deployed code hash, and asserts that `list_commitments` returns `[]`. It then serves the Console at `http://localhost:3000` with only the sandbox RPC configured; no testnet wallet or public-network transaction is used. Open **Browse recent commitments** and confirm **No commitments found yet.** The same fixture is the local acceptance path for the narrow and dark states: at 320 CSS px the panel fits without horizontal scrolling, and the empty text meets contrast in both themes. The script stops the Console and sandbox on Ctrl-C. Use `--no-console` for RPC-only fixtures, `--rpc-port` or `--console-port` to avoid port conflicts, or `--wasm` to select another build. The Console runs through `next dev`, so it does not overwrite `apps/console/out`.

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

For NEP-413, `callbackUrl` is optional. The wallet connector may return a valid signature with no callback URL even when the Console requests one; the heartbeat evaluator accepts either standard encoding. Commitment `31` exposed this mismatch. Its first corrected WASI P2 artifact failed to instantiate on OutLayer for commitment `32`; that build imports a newer WASI component interface than the previously working artifact. The heartbeat evaluator now uses WASI P1 because it needs no HTTP. The testnet Console pins evaluator build target `wasm32-wasip1`, URL <https://artifacts.lcp.gama.works/2bf6e040e091a967fa5dc1129a9fe083b693d02474ea12531a76b0bcfed5b15b.wasm>, and SHA-256 `2bf6e040e091a967fa5dc1129a9fe083b693d02474ea12531a76b0bcfed5b15b`. Commitment `33` completed the retest as Accepted / Compliant; its evaluator hashes match the testnet attestation. The displayed `outlayer-verify` command includes `--api https://testnet-api.outlayer.ai`, since the CLI default still targets a retired testnet API host. Commitments `31` and `32` retain their original evaluator digests. Testnet OutLayer links open the network-specific API record so a colliding mainnet task ID cannot misidentify the execution.
4. Connect the configured beneficiary wallet and claim only when the contract reports an eligible tranche. If a transfer fails and the callback restores eligibility, retry from the same action card.
5. Resolve pending evaluations, challenges, and transfers before closing. The beneficiary may close voluntarily; doing so forfeits any eligible tranche and future support. Another authorized party cannot close while a tranche is eligible. After closure, connect the sponsor wallet to request any residual escrow refund or return unused evaluator operations. These are separate asynchronous transfers; the Console shows a fixed storage bond and the sponsor receives any excess. The updated core is deployed on testnet, and unused-operations recovery passed acceptance on commitment `38`; see the dated receipts in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md).

### USDC testnet acceptance (partial, 2026-11-15)

The independent source review and initial testnet funding, resolver, registration, and sponsor-refund retry checks are complete. The NEP-141 path remains a testnet validation flow; beneficiary payout/retry, callback stress, concurrent funding, and independent reproducible rebuild remain open. Use only the Circle USDC testnet account `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`; each UI amount accepts up to six decimal places. Confirm the sponsor and beneficiary wallets hold testnet USDC and enough NEAR for gas and token storage before starting. See [the audit follow-up](P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md) for completed receipts.

1. Create a fresh commitment, choose USDC, set a small tranche such as `0.01`, and review that the epoch count times the tranche is shown as the total USDC escrow. Keep operations funding separate in NEAR.
2. Connect the sponsor. If the LCP contract is not registered with USDC, use **Prepare LCP contract for USDC** and approve the NEAR storage deposit. Then use **Fund escrow** and approve the token wallet's `ft_transfer_call`; it attaches the required 1 yoctoNEAR security deposit plus gas, separate from the USDC amount. Confirm funded raw units match the six-decimal amount and that any excess was returned. Try activation before full funding on a disposable draft; it must fail. After full USDC escrow and NEAR evaluator operations funding, activate.
3. Complete evaluation and wait until the Console reports the beneficiary tranche eligible. Connect the beneficiary and use **Prepare beneficiary to receive USDC** if its token storage is missing or below the current NEP-145 minimum. Claim, then confirm the on-chain raw ledger moves through pending to paid only after the transfer callback succeeds.
4. On a separate disposable commitment, leave the sponsor unregistered for a residual refund to exercise failed-transfer recovery. Confirm the refund returns to free escrow after callback failure; register the sponsor, retry, and confirm the refunded balance increments once. Also run a successful refund and duplicate-callback check.
5. Record transaction hashes, token storage totals/minimum, NEAR deposits for gas/storage, and raw USDC funded/paid/refunded values. Re-run the existing NEAR payout and refund journeys to check legacy behavior.

The bounded payout adapter remains NEAR-only; do not create an authority grant for a USDC commitment.

### P0 challenge safeguards — testnet acceptance complete

On 2026-11-15, the outstanding challenge and closure checks passed on testnet. Commitments `35`/`36` covered role separation, non-beneficiary close protection, timeout evidence preservation, and explicit invalidation. Commitment `38` verified recovery after explicit invalidation, a second unresolved challenge timing out while preserving evidence, claim-window resumption for epoch `1`, and beneficiary voluntary close while the tranche was claimable. That close intentionally forfeited the eligible tranche; it did not test payout. The reproducible core was upgraded before the run, and sponsor-directed OutLayer refunds, unused-operations recovery, and successful excess-storage refunds also passed on `38`.

The historical OutLayer reliability issue is characterized but not fixed: 11 of 13 dispatched executions on commitments `35`/`36` failed during OutLayer resolution with `Execution request not found`; all three fresh evaluations on `38` succeeded. The resolver expects a pending execution request, but why the request was absent remains unconfirmed and is an external follow-up. Full transaction receipts and code hashes are in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md) and [TODO.md](TODO.md).

## Staged P1 Workflows

The transaction-authenticated source-policy v2 contract and evaluator are deployed to testnet. The two-operator inbox pilot on commitment `27` passed with two Accepted / Compliant evaluations; report replacement/refund, exact replay rejection, and expiry reclaim also passed. Production is live at <https://lcp.gama.works> and preview at <https://preview.lcp-preview.pages.dev>; both returned HTTP 200 from `/health` and `/version.json` on 2026-11-15 and report clean source revision `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`. The production footer includes GAMA Works, WasabiNetwork, and GitHub links. The current testnet core hash is `7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`; deployment and historical upgrade receipts are in `TESTNET-E2E-STATUS.md`. The service evaluator remains at SHA-256 `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611` under `https://artifacts.lcp.gama.works/service-availability/`. The optional indexer is currently degraded by `SOURCE_RATE_LIMITED`; it is not authoritative, and the Console hides archive history while it is unhealthy.

### Independent service probes

Create a fresh v3 commitment with at least two distinct operator account IDs and the v2 evaluator URL/digest above. Pin only the maintainer key during creation; the operators do not need to join the creator's browser or provide public keys. Each operator opens the commitment on their own device, connects the listed NEAR account, enters the authorized HTTPS URL and private target salt, runs the health check, then submits the report in one wallet transaction. The contract authenticates the transaction account and records the report in the public NEAR inbox. The probe works only when the Console and health endpoint share an HTTPS origin; other origins retain the standalone tool fallback for legacy source-policy v1 in [the evaluator guide](evaluators/service-availability/README.md). Operators fund a temporary storage bond and can withdraw its credit after consumption, replacement, or expiry. The sponsor reviews the inbox and requests evaluation from unexpired reports. Reports are public; never include the URL, salt, response body, credentials, or personal data. The Console shows the configured denominator, valid/up/down/abstain counts, and agreement coverage.

Exact report replay rejection and expiry reclaim/refund were confirmed in Firefox on commitment `27` on 2026-11-11. To reproduce, open <https://preview.lcp-preview.pages.dev/?lcpReplayTest=1> and use a v2 test commitment with no pending evaluation or challenge. Connect a listed operator, run one health check, submit it, then click **Repeat identical report · test replay rejection** before the sponsor requests evaluation. Approve the second wallet transaction. The contract should reject it with `this exact signed report is already staged`; check the wallet transaction details rather than treating any generic submission error as a pass. The preview-only control stores the just-submitted payload in page memory and is hidden unless the preview or localhost URL includes `lcpReplayTest=1`.

### Private reviewer access

The reviewer Worker remediations and D1 migration 0004 are deployed to preview and production as described in [the service guide](services/reviewer-access/README.md); the environments use isolated private D1/R2 resources. Owner-approved current-stage acceptance is complete; remaining exact-preview and independent review work is deferred to mainnet readiness. Console integration remains optional and controlled by `NEXT_PUBLIC_LCP_REVIEWER_ACCESS_URL`. When enabled, the maintainer creates a salted digest receipt from a local file and shares the digest and receipt with the intended reviewer over a private channel. The reviewer creates a local key, keeps the downloaded encrypted backup and passphrase, and signs an access request with their NEAR wallet. The maintainer loads the pending request, selects the matching file and receipt, and signs **Encrypt file and approve**. The reviewer signs the download and decrypts the artifact in their browser; the UI verifies the salted digest. The maintainer can then revoke the grant. Revocation prevents future downloads and purges stored ciphertext, but cannot recall a decrypted copy. This workflow shares supplemental evidence; it does not prove the file was used by the evaluator.

### Policy amendment and authority adapter

**Testnet acceptance complete:** commitment `28` passed required-approver rejection, slot reuse, unanimous approval, delayed activation/evidence-clock restart, proposer cancellation, and permissionless expiry. Full proposal and activation receipts remain in [TODO.md](TODO.md). The initial v3 rollout was deployed in transaction [`6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA`](https://testnet.nearblocks.io/txns/6apoYUqwfUe7d7K41wbygULrkW3gY8wmvyc9kis8yNaA) with historical core code hash `GUCWTrBEyhUBNFsPFvDLRmxsSi5V3rmbDJafKUvrZ1zN`; current core code hash is recorded above. For a future regression run, use a dedicated v3 commitment and separate sponsor, maintainer, beneficiary, and arbiter accounts; base budget, evaluator, and role terms remain immutable.

The adapter fixture uses contract `lcppool.testnet`, manager `lcpsponsor.testnet`, and fixed recipient `lcprecipient.testnet`. The reproducible adapter artifact from source commit `02ccc7306b0d7b312be316569ef6af72f711e9e9` is 152,235 bytes, SHA-256 `3379e0b6bddb6b5da2fdf78e6b1fe5bc5216a2d4ab09fad9a525ef5140d87cd0`, and NEAR code hash `4TwakaXT7iSEuLStKGBwphKBSkULRGYXsax2N9bNZyyq`; its deployment receipt is [`Edi3T6byMdj38Vqp3ojQMAUgHSvnx8Dcm2kMaz18W4TC`](https://testnet.nearblocks.io/txns/Edi3T6byMdj38Vqp3ojQMAUgHSvnx8Dcm2kMaz18W4TC). The pool was funded for acceptance, then manager payout and withdrawal scenarios were exercised; its latest finalized test status is 0 available / 0 pending. The funding and withdrawal receipts are preserved in `TODO.md`. Recheck and fund the pool before any new payout test.

Adapter acceptance passed on commitments `33`/`34`: manager-authorized payout, same-epoch rejection, failed-pool rollback/recovery, non-manager rejection with LCP allowance restoration, beneficiary revocation, and manager withdrawal. For a future regression test, create a fresh eligible commitment and a grant naming the adapter and fixed recipient; the grant creator must equal the configured pool manager. Wait until NEAR reports normal claim eligibility before acting, and allow pending settlement callbacks to finish before another action.

The non-manager guard passed on commitment `34`: the adapter rejected the beneficiary-created grant and LCP restored authorization to zero, nonce to zero, no last epoch, and no pending action. For a future local/preview-only regression check, open `https://preview.lcp-preview.pages.dev/?lcpAdapterAuthTest=1`; the live preview now reports clean source revision `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`. Connect the beneficiary, create the labeled non-manager test grant against the sponsor-managed adapter, and click **Test adapter manager rejection** once. Expected state is restored allowance/nonce with no pool or recipient balance change. The control is disabled on production.

### Dedicated governance testnet accounts

Use separate Firefox wallet sessions for each role; never sign for one role from another role's wallet. After the owner funded them, finalized testnet reads on 2026-11-11 showed 5 NEAR in each account (block `277257669`; recipient read at block `277257668`). Recheck balances before creating fixtures or signing transactions.

| Test role | NEAR account | Use |
| --- | --- | --- |
| Sponsor | `lcpsponsor.testnet` | Propose or approve policy changes; fund escrow and create adapter grants |
| Maintainer | `lcpmaintainer.testnet` | Approve amendments and control maintenance evidence |
| Beneficiary | `lcpbeneficiary.testnet` | Approve amendments and exercise beneficiary grant authority |
| Arbiter | `lcparbiter.testnet` | Approve amendments and resolve disputes |
| Adapter test contract | `lcppool.testnet` | Testnet sample adapter; code hash `4TwakaXT7iSEuLStKGBwphKBSkULRGYXsax2N9bNZyyq` |
| Adapter pool manager | `lcpsponsor.testnet` | Fund the sample adapter and recover only unreserved pool funds in this fixture |
| Adapter recipient | `lcprecipient.testnet` | Receive the adapter's bounded payout |

Use the sponsor, maintainer, beneficiary, and arbiter accounts for amendment approval, rejection, activation, cancellation, and expiry fixtures. Use the adapter test account only on testnet; keep its FullAccess upgrade authority secured. No private keys are needed by the Console or repository.

### Firefox accessibility acceptance

Run this pass on the preview or local Console before closing the WCAG 2.1 review:

1. Set the viewport to 320 CSS px and then browser zoom to 200%. Confirm primary actions remain visible, controls and text do not overlap, and the page has no horizontal scrolling.
2. Reload and use only Tab, Shift+Tab, Enter, and Space. Confirm the first Tab reveals **Skip to commitment tools** and Enter moves focus to the explorer heading. Then confirm focus is visible and reaches wallet controls, journey navigation, form fields, helper disclosures, and advanced sections in a logical order. Recent commitment entries should be announced as list items containing keyboard-operable buttons.
3. In Firefox DevTools, add this temporary text-spacing rule and confirm no labels, instructions, or actions are clipped:

   ```css
   * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
   p { margin-bottom: 2em !important; }
   ```
4. With a screen reader, confirm action success, errors, wallet/session changes, completed evaluation results, health changes, and claim-eligibility changes are announced without moving focus unexpectedly. Routine 30-second snapshot timestamps should stay silent; a sync failure should be announced. Check light and dark text, controls, and focus indicators against WCAG 2.1 AA contrast targets.
5. With a wallet connected, click **Change account**, choose another account in the same wallet, and confirm the Console updates without disconnecting first. Refresh and confirm the selected account is restored.

Record browser version, viewport/zoom, theme, screen reader if used, and any failing element before closing this item.

## Verified Browser Journeys

These flows were manually verified in Firefox on NEAR testnet:

- Commitment `24`: create, fund, activate, pin the maintainer key with NEP-413, hash a local evidence file, request evaluation, recover with fresh evidence, close, and refund residual escrow. The three funded epochs ended before a tranche became claimable, so this fixture verifies refund rather than payout.
- Isolated failed-transfer fixture commitment `2`: the first payout transfer failed, the UI showed retry eligibility, and retry completed the payment.
- Commitment `19`: a tranche was paid, then the commitment was closed and remaining escrow refunded.
- Commitments `21` and `22`: the health countdown and historical invalidation/recovery timeline were checked. Commitment `21` naturally reached `AtRisk` and `Breached` on finalized testnet time.
- The Cloudflare Pages preview: wallet connect/disconnect, NEAR reads, and OutLayer report lookup worked from Firefox.
- Commitment `27`: two independent operator wallets completed two compliant quorum evaluations; replacement/refunds, exact-report replay rejection, expired-report reclaim/refund, wallet restoration, and persistent explicit disconnect were confirmed. Transaction references are in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md).

See [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md) for receipts and [TESTING.md](TESTING.md) for automated checks and build reproduction. Fixture health is time-dependent; refresh snapshots before using an existing commitment. Keep all manual transactions on testnet.
