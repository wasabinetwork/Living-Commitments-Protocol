# NEAR Testnet E2E Status

**Last reconciled:** 2026-11-11
**Repository base revision:** `332f647`
**Testnet evaluator source revision:** `57165a5`
**Network:** NEAR testnet

## Deployment

- **Contract account:** `livingcommitmentsprotocol.testnet`
- **Deployment transaction:** [BStkSef7JLuuHT6tECZ14zBJ1y5Hh9KU577AjvtFTgth](https://testnet.nearblocks.io/txns/BStkSef7JLuuHT6tECZ14zBJ1y5Hh9KU577AjvtFTgth)
- **Initial on-chain code hash:** `3oerWX4Ta3tg1MgnR7Hwq1PuwN4wyQZhrGurCPXNocez`
- **Evaluator SHA-256:** `a38de26a27df0c81dbc8fa099b6f5f3bd32f56dff335afad74686620e58cf44a`
- **FastFS URL:** <https://test.fastfs.io/livingcommitmentsprotocol.testnet/outlayer.testnet/a38de26a27df0c81dbc8fa099b6f5f3bd32f56dff335afad74686620e58cf44a.wasm>
- The published evaluator was fetched from FastFS and its bytes matched the local artifact digest.
- Callback update transaction: [DH1vPf8XAN4pCvK5c3xyqbApXzJdbDCpw3BuzHbKofuK](https://testnet.nearblocks.io/txns/DH1vPf8XAN4pCvK5c3xyqbApXzJdbDCpw3BuzHbKofuK). The current code hash is `At6Xz7m8ULZJyFKEGfM4bqDr3xWNV84e6kLnB34HASiZ` (570,002-byte WASM); the update preserved contract state.
- Bounded-list update transaction: [BnNAwjHHECiFvqcSavm9oRpnk8kQn3kzWbTyyfEXGkWC](https://testnet.nearblocks.io/txns/BnNAwjHHECiFvqcSavm9oRpnk8kQn3kzWbTyyfEXGkWC). The current code hash is `HBnF7bhE6BPBkRqFSnAPU9KT7kXv988ZVXffqTKdgzX` (576,800-byte WASM); initialized state was preserved. The contract account retained approximately `21.4412 NEAR` after the update.
- Historical-timeline update transaction: [6md8rayhN3WmiMEP8dGgUyVYUowkBciovGr2Kppdx9cF](https://testnet.nearblocks.io/txns/6md8rayhN3WmiMEP8dGgUyVYUowkBciovGr2Kppdx9cF). The deployed code hash is `4ycAFEtJryaNGUSMd76rWWxSoEAqqRHPrYtkdWZVHMk3` (577,506-byte WASM). It preserved contract state; finalized reads confirmed commitments `8`, `9`, `19`, and `21` remained intact. Storage usage after the update was `603195` bytes. Older challenge `3` returns `completed_at_ns: null`, as its completion time predates the new storage slot.
- NEP-413 wallet-evidence update transaction: [HPhtBQgHYgCzJBobDxx3MiGkCzP9WnW6v6MGpKWzeTjc](https://testnet.nearblocks.io/txns/HPhtBQgHYgCzJBobDxx3MiGkCzP9WnW6v6MGpKWzeTjc). The deployed code hash is `bK4nSCpE52DF4b2AbNunaEMy2FCfRDbsgwjZAVaWfDR` (608,567-byte WASM). The deployment helper verified the prior code hash, signer permissions, storage balance, and new code hash. Finalized reads afterward confirmed commitments `8`, `9`, `19`, and `21` plus the legacy challenge remained intact.
- NEP-413 evaluator SHA-256: `17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97`. The OutLayer CLI submitted FastFS transaction [FKu4oqhLLY9kLqpBEdtrDiP8EDUCy34kzV3n96vEyGoy](https://testnet.nearblocks.io/txns/FKu4oqhLLY9kLqpBEdtrDiP8EDUCy34kzV3n96vEyGoy) and returned <https://test.fastfs.io/livingcommitmentsprotocol.testnet/outlayer.testnet/17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97.wasm>. The URL follows OutLayer's documented testnet FastFS route. The CLI deliberately submits a 1-gas call and treats a returned transaction hash as successful publication submission; RPC shows the expected top-level `Failure` and refund receipt. The transaction arguments decode fully to the expected path, MIME type, 323,213-byte WASM, and matching SHA-256. As of **2026-11-09 14:20 UTC**, FastFS still returned HTTP 404 with an empty body and `cf-cache-status: DYNAMIC`, while the previously published evaluator returned HTTP 200. The cause is unconfirmed.
- **Testnet evaluator mirror:** to unblock NEP-413 validation without exposing the private source repository, the exact WASM was uploaded to a dedicated public R2 bucket at <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97.wasm>. A public fetch on **2026-11-09 14:56 UTC** returned HTTP 200, `Content-Type: application/wasm`, and 323,213 bytes; the downloaded bytes match the expected SHA-256. Use this URL for the testnet v2 fixture while FastFS is unresolved. The `r2.dev` endpoint is a development fallback; configure a custom artifact domain before production use.
- **Evaluator rebuild:** `cargo build -p maintenance-heartbeat --target wasm32-wasip2 --release` at source revision `57165a5` reproduced the R2 artifact exactly: 323,213 bytes and SHA-256 `17803b881810e20ef2dbedb7e93c62be0894a7073de72d9aef86d5a0d9163a97`.

### Service-availability v3 deployment

- Contract update transaction: [95xbUuYR7Do7mvLTaykB6v97Tra29Pz7Ge7gcjatknvE](https://testnet.nearblocks.io/txns/95xbUuYR7Do7mvLTaykB6v97Tra29Pz7Ge7gcjatknvE) upgraded `livingcommitmentsprotocol.testnet` from code hash `bK4nSCpE52DF4b2AbNunaEMy2FCfRDbsgwjZAVaWfDR` to `4JGf12vUcHKQnUPG3tuCudfPJKfurPBKnfqMhGiiiXm7`. The contract WASM is 743,349 bytes; the estimated code-storage cost was 7.43349 NEAR.
- Service evaluator SHA-256: `da867cdca199f0c663e848a33cc0962bdeb84ca98553c45b5e11583ee6aee627`. It is hosted at <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/da867cdca199f0c663e848a33cc0962bdeb84ca98553c45b5e11583ee6aee627.wasm>; a public GET returned HTTP 200 with `Content-Type: application/wasm` and 381,920 bytes; the downloaded bytes have the same SHA-256 as the local artifact.
- Finalized post-upgrade reads confirm the new code hash and preserve commitments `8`, `9`, `19`, and `21` plus the legacy challenge. The `get_service_availability_policy` view is callable and returned `null` for nonexistent commitment `0` at finalized block `277019011`. The v3 signed-report lifecycle and callback outcomes still need a pilot.

### NEP-413 source-policy v1 inbox deployment (2026-11-10 baseline)

- On 2026-11-10, the inbox-enabled LCP contract was upgraded on testnet. A finalized code read returned hash `8WQsNjGgUX6ucMu1LeYrqudNbU4TfYqmSGoHEnEw58QS` for the 935,263-byte WASM. Post-upgrade view calls succeeded for `get_service_report_inbox` and `get_service_report_refund_balance`; the inbox for commitment `26` was empty, as expected. Finalized reads preserved commitments `8`, `9`, `19`, `21`, `22`, `24`, `25`, and `26`.
- The wallet-signed service evaluator is 408,367 bytes with SHA-256 `eec7211dec72b0066e649564edb9d8943ef69236e6a6e62cb47de23abe2363c6`. It is published at <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/service-availability/eec7211dec72b0066e649564edb9d8943ef69236e6a6e62cb47de23abe2363c6.wasm>; a fetched copy matched the byte count and digest. This historical artifact remains available to commitments pinned to it; new source-policy v2 commitments use the transaction-authenticated evaluator listed in the 2026-11-11 deployment below.
- The updated Console was deployed to the `lcp-preview` Cloudflare Pages project at <https://preview.lcp-preview.pages.dev> (latest deployment <https://80e5d347.lcp-preview.pages.dev>). The `/health` route returned `{"status":"ok","service":"lcp-console","scope":"static-edge"}` after the latest deployment. This is a static reachability response, not a commitment health oracle.
- The contract upgrade and artifact publication are verified. The fresh commitment and two-operator Firefox journey passed on commitment `27`, including public inbox review, evaluation, storage refund withdrawal, and report replacement. Expiry reclaim also passed; exact replay rejection remains for a later validation pass.

### Transaction-authenticated source-policy v2 deployment (2026-11-11)

- Contract upgrade transaction: [Gz1iwoeaVc7YhQsWuQcV2ZE6QBtv8SJhxKMrh3ZqmfkC](https://testnet.nearblocks.io/txns/Gz1iwoeaVc7YhQsWuQcV2ZE6QBtv8SJhxKMrh3ZqmfkC). Finalized contract code hash: `FR3TS4oyqGRtHxjo8y7jLRi13ruWwJ3Cs9gdcKgT3mvG` (938,518-byte WASM), replacing `8WQsNjGgUX6ucMu1LeYrqudNbU4TfYqmSGoHEnEw58QS`. The deployment preflight checked the signer permission, existing code hash, transaction size, and projected storage reserve.
- The transaction-authenticated service evaluator is 410,392 bytes, SHA-256 `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`, at <https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm>. The remote R2 object was downloaded and its SHA-256 matched the local build.
- The Console is deployed to the `lcp-preview` Pages project on the `preview` branch: <https://28f86b41.lcp-preview.pages.dev>, with alias <https://preview.lcp-preview.pages.dev>. The page returns HTTP 200; `/health` returns `{"status":"ok","service":"lcp-console","scope":"static-edge"}`. This endpoint is static reachability information, not a commitment health oracle.
- Finalized reads succeeded for commitments `8`, `9`, `19`, `21`, `22`, `24`, `25`, and `26`; the existing commitment policies and evaluator versions remain in place. Commitment `26`'s inbox is empty and its older timed-out evaluation remains a separate legacy case.
- Commitment `27` was created with the corrected 0.05 NEAR draft bond, funded with 0.03 NEAR escrow and 0.01 NEAR evaluator operations, and activated. Finalized read at block `277172228` shows policy version 3, `AwaitingEvidence`, next evaluation `1`, and the v2 source policy. The service inbox for evaluation `1` was empty at block `277172305`. The recorded commitment storage bond is 0.01271 NEAR.
- The separate-device Firefox submission and evaluation succeeded. Evaluation `#1` passed with 2/2 valid UP reports and 100% corroboration. Evaluation `#2` exercised replacement: Operator A replaced the first report and withdrew its storage refund ([replacement submission](https://testnet.nearblocks.io/txns/8ZCTL16rJ7ckiVFGK1rHT5yxZPj52sESx6K5sRAtRQR1), [refund withdrawal](https://testnet.nearblocks.io/txns/8EKiyqtcFPezstiLvcskSZCHbYiZzRenK8JLcbsrtq9M)); Operator B then submitted and the sponsor requested evaluation.

### Service-policy draft storage bond correction (2026-11-11)

- The first draft transaction, [5QsRm9jKGKKyLj6kjh6Bd4Kz5cRSWWNGp7V62dmugLsb](https://testnet.nearblocks.io/txns/5QsRm9jKGKKyLj6kjh6Bd4Kz5cRSWWNGp7V62dmugLsb), called `create_service_availability_commitment` with the correct v2 policy but attached the old 0.01 NEAR storage default. A local reproduction using the transaction's policy and two operator accounts calculated a minimum of 0.01263 NEAR, so the contract trapped before committing state.
- A finalized `get_commitment(27)` query at block `277171058` returned `null`; no draft was created. The failed call charged gas, while its attached deposit was not committed.
- The Console now uses a fixed 0.05 NEAR draft storage bond for service-policy creation; the contract retains the measured requirement and refunds unused deposit. The field explains this behavior. The correction was deployed at <https://8fa4ca2f.lcp-preview.pages.dev>; the latest wording update is deployed at <https://28f86b41.lcp-preview.pages.dev> and the stable preview alias. Contract tests verify that 0.01 fails and 0.05 covers the reproduced policy. Commitment `27` was successfully created with the corrected bond.

### Commitment 27 evaluation 1 (2026-11-11)

- Evaluation `1` was requested from the two v2 inbox reports. Finalized read at block `277174020` shows `Accepted / Compliant`, reason `UPTIME_QUORUM_MET`, 2 valid reports, 2 UP, 0 DOWN, 0 abstained, and 10,000 basis points of corroboration. The request transaction hash recorded by the contract is `cbaebea50c2fbda925f5b75d0dfe2925b81c8b0773167db118df970f076286d6`; evidence hash: `fe3b6526fdfe44efae9c74e343d8c6507cc360ec5e69e5e4c027171602ac3359`.
- Finalized commitment read at block `277174091` shows `Active`, `Healthy`, no pending evaluation, and next evaluation `2`.
- Evaluation consumption credited report-storage refunds: `0.0124 NEAR` for `wasabinetwork.testnet` and `0.01233 NEAR` for `lcptester.testnet`. Both were successfully withdrawn: [Operator A](https://testnet.nearblocks.io/txns/4KAVAenYecVfCp8dY6qD88SqycfxZ1yHKNWqBHer7T4g) and [Operator B](https://testnet.nearblocks.io/txns/EFKYG4xTGopeFQ5ztCJaBSxj7kvADapinw393uQXEFEy). Finalized refund-balance views for both accounts are zero.
- The two-operator submission, quorum, and initial refund paths passed. Evaluation `#2` then verified report replacement and its refund withdrawal; wallet restoration and explicit-disconnect persistence after refresh also passed. Expiry reclaim was subsequently verified; only exact replay rejection remains pending live validation.
- The Console's request notice now describes these as NEAR wallet-authenticated reports for schema v2; older schema v1 still uses signed reports. The updated wording is deployed at <https://28f86b41.lcp-preview.pages.dev>.

### Commitment 27 evaluation 2 and report replacement (2026-11-11)

- Finalized `get_latest_evaluation(27)` at block `277177419` reports evaluation `2` as `Accepted / Compliant`, reason `UPTIME_QUORUM_MET`: 2 configured and valid reports, both UP, none DOWN or abstained, and 10,000 basis points of corroboration. The request transaction hash recorded by the contract is `f88f94a59cc4cb9948eff7711e6f9e850a930e5c42679022488d87a7469eb456`; evidence hash: `61be5358dfc3934202c00f845bbc4d626ee0ed25125c612d8011f0f886b3362a`.
- A finalized `get_commitment(27)` read at block `277177378` shows `Active`, `Healthy`, no pending evaluation, and next evaluation `3`. The connected wallet remained connected after a page refresh, as confirmed in Firefox.
- Report replacement, Operator A's refund withdrawal, Operator B's separate-device submission, and the sponsor's evaluation request all completed. Firefox also confirmed both connected-wallet restoration and that explicit disconnect remains disconnected after refresh. Expiry reclaim passed on testnet as recorded below. The exact-replay contract test passes locally, but live replay remains unverified; the regular Console probe generates a fresh payload each time, so exact replay requires a controlled repeat of the same report payload.

### Commitment 27 evaluation 3 report expiry and reclaim (2026-11-11)

- Operator A (`wasabinetwork.testnet`) submitted one report for evaluation `3`: [submission](https://testnet.nearblocks.io/txns/zVk67TCasUZhXYwqE2sBQyP4faoKpR6wnoZkrk1T9qF). The contract event records source `operator-a`, a 0.0124 NEAR storage bond, and the expiry timestamp. No evaluation was requested.
- After the report expired, the Firefox UI showed the expected expired state and reclaim action. Reclaim succeeded: [transaction](https://testnet.nearblocks.io/txns/7rYuQgzCwkQnxMWpzJJpiK82fgpNshsHMZjV7y9cY4DW). The contract emitted `service_report_reclaimed` for commitment `27`, evaluation `3`, source `operator-a`, crediting the original submitter with 0.0124 NEAR.
- Operator A withdrew the accumulated 0.0248 NEAR report-storage credit: [refund transaction](https://testnet.nearblocks.io/txns/5bd3roFyrecppFESXDeurBn9TzAVRMkAyMeJFR6mFBM). Finalized reads show an empty evaluation-3 inbox at block `277181600` and zero refund balance at block `277181770`.
- At finalized block `277181526`, commitment `27` was `Active` / `Breached`, with no pending evaluation and next evaluation `3`. The previous qualifying evidence had aged past its policy window while the test waited; the expired report was reclaimed without evaluation and did not restore health.

### Distributed operator authorization and wallet-session redesign

- The deployed v2 source-policy path removes operator public-key pinning. The creator lists distinct NEAR accounts; each operator uses their own device and submits the report through a wallet transaction. The contract checks the transaction predecessor against policy, stores the submitting account, and only allows v2 evaluation from inbox state. The evaluator verifies the contract-derived submitter. Legacy source-policy v1 and existing NEP-413 commitments remain supported.
- The Console now restores a previously selected connector session with `NearConnector.getConnectedWallet()` on page load. A visible restoring state avoids showing a disconnected button while the persisted session is being read; manual disconnect still clears the connector session.
- Local contract tests cover successful v2 inbox submission and evaluation scheduling, reject a mismatched submitter in the evaluator, and reject raw public-method bypass. The updated contract, evaluator, and Console are deployed; hashes and URLs are recorded above. The separate-device pilot passed on commitment `27`, including two compliant evaluations and report replacement.
- The remaining live inbox check is exact replay rejection. The endpoint URL and salt remain private, while report contents are public.

### NEP-413 fixture: commitment 24

The user pinned `wasabinetwork.testnet`'s maintainer key through the Firefox wallet flow and created commitment `24`. The commitment was funded with `0.03 NEAR` escrow and `0.01 NEAR` evaluator operations, then activated. Evaluation `1` was requested in Firefox in [7WDJecZtyZx9rJvPUraDTvcAznRDAof4UjYEkT3y1Lnc](https://testnet.nearblocks.io/txns/7WDJecZtyZx9rJvPUraDTvcAznRDAof4UjYEkT3y1Lnc) and accepted as **Compliant**. The OutLayer callback cleared the pending request. OutLayer executed the evaluator from the R2 mirror and returned `SIGNATURE_VALID` and `ARTIFACT_HASH_FORMAT_VALID`; this verifies the NEP-413 signature and digest formatting, not the evidence file's contents. The first request attached `0.01 NEAR` and trapped because it did not cover the maximum callback storage reservation. The Console default is now `0.05 NEAR`; the successful retry used that amount, and the contract refunds excess storage deposit.

Commitment `24` later recovered with fresh compliant evidence, then was closed and its residual refund requested. Finalized state at block `276955602` confirms it is `Closed`, refund transfer `#9` settled, all `0.03 NEAR` escrow was refunded, and no transfer remains pending. Its three five-minute epochs had ended before a tranche became claimable, so no budget tranche was paid. The claim/retry UI was exercised separately on the failed-transfer fixture.

## Verified Evaluation

Commitment `1` was created, funded, and activated. Evaluation `1` returned **Accepted / Compliant** with reason codes `SIGNATURE_VALID` and `ARTIFACT_HASH_FORMAT_VALID`.

- **Policy hash:** `79d8371efa4f20c376f713890c14feef3f0443826354143eab07c68ac802ff3e`
- **Evaluation request transaction:** [t6yZZP5hNDzvFMv2kUoXj4s1VBh4ceXgtbaHnTkrJo5](https://testnet.nearblocks.io/txns/t6yZZP5hNDzvFMv2kUoXj4s1VBh4ceXgtbaHnTkrJo5)
- **OutLayer task:** `28566`
- **Input SHA-256:** `bd44ec6604c35b2aeb381c835a6415074d47cc7638ea3046f1482606947af144`
- **Output SHA-256:** `b1f8beee07b263d47d333b25f9b37c420568e9f7be3aae9082fe552bfd82971d`
- LCP stored the originating request transaction hash in the accepted evaluation record. The standalone verifier recovered the request and response from NEAR and reported **PROVEN** for Intel authenticity, on-chain worker identity, execution binding, input, and output. Intel TCB status was `UpToDate`.
- The proof bundle was saved outside the repository at `/private/tmp/lcp-artifacts/lcp-evaluation-proof.json` and passed an offline re-check. The verifier docs describe the `tx` and offline `bundle` workflows: <https://app.outlayer.ai/docs/trust-verification>.

## Additional Lifecycle Validation

### Live temporal boundaries (commitment 21)

The monitor sampled finalized NEAR time once per minute. The initial-evidence deadline was 00:21:40.528 AST; the first finalized block after it, at 00:21:58.485 AST, reported `AtRisk`. Grace ended at 01:21:40.528 AST; the first finalized block after it, at 01:21:59.057 AST, reported `Breached`. The monitor recorded completion at 05:22:02 UTC and removed only its own cron entry. Raw samples remain at `/private/tmp/lcp-temporal-monitor-21.jsonl`.

### Breach, claim rejection, and recovery

- Commitment `1` became `Breached` after the test policy's 30-minute evidence TTL and 5-minute grace period.
- A claim while breached reverted as expected: [DvEG9yhep14Bv33UVrYuFMVZrR2XJqRL54Zk8GVFb9EE](https://testnet.nearblocks.io/txns/DvEG9yhep14Bv33UVrYuFMVZrR2XJqRL54Zk8GVFb9EE). Escrow remained unpaid.
- Fresh evidence produced accepted/compliant evaluation `2` and restored `Healthy`: [6dbZVesRPA1mdv9mJe9ghVzigWDCKFxZ6fZiC792Eb8U](https://testnet.nearblocks.io/txns/6dbZVesRPA1mdv9mJe9ghVzigWDCKFxZ6fZiC792Eb8U).

### Distinct-beneficiary payout

Commitment `2` used beneficiary `payee-85d2a7.livingcommitmentsprotocol.testnet`, separate from the sponsor. Its creation transaction is [5PE5axDnSMU3jacHjetH2BKC9XbqWBSPNC1JMxTwDtJg](https://testnet.nearblocks.io/txns/5PE5axDnSMU3jacHjetH2BKC9XbqWBSPNC1JMxTwDtJg), with policy hash `b9c9e004d802ea8f61158133806e39f0524fcf85907cfad4b1eb5bb92d74834e`.

- Evaluation `1` was accepted/compliant: [E2BhabjqWkev97UHFrxe9jn5N8BbGWDH7p4uBTZK1UkP](https://testnet.nearblocks.io/txns/E2BhabjqWkev97UHFrxe9jn5N8BbGWDH7p4uBTZK1UkP).
- Tranche claim and transfer callback completed: [59Asjsm5b2KYxPhaY2tSWgCrzu7Zu1BQfVUt7so91t9y](https://testnet.nearblocks.io/txns/59Asjsm5b2KYxPhaY2tSWgCrzu7Zu1BQfVUt7so91t9y). `get_tranche` reported `Paid`; escrow showed `paid=0.01 NEAR`, `pending=0`, and the beneficiary balance increased by about `0.007065 NEAR` after transfer/storage costs.

### Challenge timeout and evidence invalidation

Commitment `1` evaluation `3` was accepted/compliant: [C5mfYMeApbCu2ENZgyCCnNmEB5c45jUTxV47yh6orFoF](https://testnet.nearblocks.io/txns/C5mfYMeApbCu2ENZgyCCnNmEB5c45jUTxV47yh6orFoF). Challenge `1` was opened in [A8nRCan3NJkSY7pYMq9c5CiRDs8oRVZEruRmXWBGwvZU](https://testnet.nearblocks.io/txns/A8nRCan3NJkSY7pYMq9c5CiRDs8oRVZEruRmXWBGwvZU) and then permissionlessly expired after its resolution deadline: [5amhA2gzcNYJBvxUQK3nSZrnFNLPwoond5qDd3zbgn1m](https://testnet.nearblocks.io/txns/5amhA2gzcNYJBvxUQK3nSZrnFNLPwoond5qDd3zbgn1m). The resulting challenge status was `TimedOut`, the active challenge pointer was cleared, `last_good_evaluation_id` became null, and effective health was `AtRisk`.

Live arbiter outcomes were later verified on playground commitments `8` and `9`: challenge `2` on `8` was upheld, preserving `Healthy` evidence ([resolution](https://testnet.nearblocks.io/txns/Cb9URBfVDVqUJH5qJgJzzUWGEuNP9kLA7RhsG4YoTewC)); challenge `3` on `9` was invalidated, clearing last-good evidence and moving the commitment to `AtRisk` ([resolution](https://testnet.nearblocks.io/txns/HAyVNDmVXjww68nzVQdAammtoqLmZXnmaZLopt4e87WC)). A fresh compliant evaluation restored `Healthy` on `9` ([recovery evaluation](https://testnet.nearblocks.io/txns/8p47a9eqNUicY99hT1VuqUxdYKqnjMuSMY6KXNYQR2TL).

### Closure and escrow refund

After resolving the open challenge by timeout, commitment `1` was closed in [H5iX5ZseRCVKLnH2fgCfc4jFs1Yqf2h7M1WUHADRTPjm](https://testnet.nearblocks.io/txns/H5iX5ZseRCVKLnH2fgCfc4jFs1Yqf2h7M1WUHADRTPjm). The sponsor then requested the full unused `0.01 NEAR` refund in [3VyLLme3k8Z87fr8p5WwSxfAPLT9JnYSTnwyb9ta8Li6](https://testnet.nearblocks.io/txns/3VyLLme3k8Z87fr8p5WwSxfAPLT9JnYSTnwyb9ta8Li6). Final escrow view: `funded=0.01 NEAR`, `paid=0`, `refunded=0.01 NEAR`, `pending=0`, `free=0`. The successful refund callback reconciled the accounting.

### Mismatched evaluator digest

Commitment `3` pinned an all-zero evaluator digest while pointing at the published evaluator artifact. Its request transaction was [7YZa8jLihPDfbgSEU1NUwYntFjcu5S2tNAbzpvcLdJBA](https://testnet.nearblocks.io/txns/7YZa8jLihPDfbgSEU1NUwYntFjcu5S2tNAbzpvcLdJBA). Under the original callback code, the callback recorded `Rejected / MALFORMED_VERDICT`; the stored output hash `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b` is SHA-256 of JSON `null`. The pending evaluation pointer cleared. Operations accounting recorded the full `0.01 NEAR` execution deposit as authorized spend.

Commitment `3` was then closed in [H5BgoFiJyfWz1k6Rty92SFm8xdC5ZNpPHzQttj4qPa2t](https://testnet.nearblocks.io/txns/H5BgoFiJyfWz1k6Rty92SFm8xdC5ZNpPHzQttj4qPa2t); its unused `0.01 NEAR` escrow was refunded and reconciled in [7EJAPXLAraX13s6dFopLSfAkAkuznRvboALAzSGAbPzd](https://testnet.nearblocks.io/txns/7EJAPXLAraX13s6dFopLSfAkAkuznRvboALAzSGAbPzd).

### Callback result classification and request timeout

The callback now parses OutLayer JSON as `Option<EvaluationVerdictOutput>`. A JSON `null` becomes `Failed / MISSING_OUTLAYER_RESULT` while preserving its output hash; malformed JSON or an invalid verdict object remains `Rejected / MALFORMED_VERDICT`. This follows OutLayer's documented NEAR callback shape, `Result<Option<T>, PromiseError>` ([integration guide](https://app.outlayer.ai/docs/near-integration)). The code built and was deployed in the callback update transaction above.

Commitment `4` used the mismatched-digest fixture against the updated contract. Evaluation request [EJ5ggBHGDHEyirETdUMHGXvyrZJDV1QHHAepdcvCG1in](https://testnet.nearblocks.io/txns/EJ5ggBHGDHEyirETdUMHGXvyrZJDV1QHHAepdcvCG1in) remained pending past its 30-second request deadline. It later finalized as `TimedOut / OUTLAYER_TIMEOUT` and cleared `pending_evaluation_id`. That request did not return JSON `null`; a subsequent request on commitment `5` confirmed the `MISSING_OUTLAYER_RESULT` branch.

Commitment `4` was closed in [9YwHqZyFUTtyoYgRJBpru3Boxp6adzhAZqxrKHrSenAr](https://testnet.nearblocks.io/txns/9YwHqZyFUTtyoYgRJBpru3Boxp6adzhAZqxrKHrSenAr) and its unused escrow refund reconciled in [E5ncJXMB8QdZX8KGFU5WefCcHa7ZmfcxwhsahvtPNPW](https://testnet.nearblocks.io/txns/E5ncJXMB8QdZX8KGFU5WefCcHa7ZmfcxwhsahvtPNPW).

Commitment `5` repeated the mismatched-digest scenario with a 180-second request deadline. Evaluation request [DDzr53ZFHb28qRowupk5R7EAMGH9sVZLyTy7r5LNThQf](https://testnet.nearblocks.io/txns/DDzr53ZFHb28qRowupk5R7EAMGH9sVZLyTy7r5LNThQf) returned JSON `null` before the deadline. The updated callback recorded `Failed / MISSING_OUTLAYER_RESULT`, preserved output hash `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`, and cleared the pending pointer. Commitment `5` was closed in [5NaMLAsb8JbXGf8kRkB3hLoCHmfs6aT2iM11zTtWb8pj](https://testnet.nearblocks.io/txns/5NaMLAsb8JbXGf8kRkB3hLoCHmfs6aT2iM11zTtWb8pj) and its unused escrow refund reconciled in [AFcg1Gk9QhRW9QdKWQpJaGe9eywyGQ5xUJNyPtRcYKeo](https://testnet.nearblocks.io/txns/AFcg1Gk9QhRW9QdKWQpJaGe9eywyGQ5xUJNyPtRcYKeo).

### OutLayer promise failure

Commitment `6` used a valid evaluator artifact with an execution deposit of one yoctoNEAR. The OutLayer promise failed and evaluation request [9cVCENfnAoCBY5pbyP9eVkRCVYESWteANnGhodyvJL66](https://testnet.nearblocks.io/txns/9cVCENfnAoCBY5pbyP9eVkRCVYESWteANnGhodyvJL66) completed as `Failed / OUTLAYER_EXECUTION_FAILED`. The pending pointer cleared, and operations accounting recorded one yoctoNEAR as authorized spend. Commitment `6` was closed in [B3gADB6nAKCZnWeJuYsgZZ6GNtVyVKjL4QSVV616RJm8](https://testnet.nearblocks.io/txns/B3gADB6nAKCZnWeJuYsgZZ6GNtVyVKjL4QSVV616RJm8); its unused escrow refund reconciled in [6AzNBE9UGS2BfYxePgRVgMmAu3WGLnYjKo2JJdi9DDzX](https://testnet.nearblocks.io/txns/6AzNBE9UGS2BfYxePgRVgMmAu3WGLnYjKo2JJdi9DDzX).

### OutLayer fee and callback gas audit

Finalized receipt outcomes were queried on 2026-11-09 for the accepted evaluation on commitment `19` ([4wKuNoznN3xjJJmXWjZox38CWVSCMniinewwyR21ZuGG](https://testnet.nearblocks.io/txns/4wKuNoznN3xjJJmXWjZox38CWVSCMniinewwyR21ZuGG)), the JSON `null` evaluation on `5` ([DDzr53ZFHb28qRowupk5R7EAMGH9sVZLyTy7r5LNThQf](https://testnet.nearblocks.io/txns/DDzr53ZFHb28qRowupk5R7EAMGH9sVZLyTy7r5LNThQf)), the failed OutLayer promise on `6` ([9cVCENfnAoCBY5pbyP9eVkRCVYESWteANnGhodyvJL66](https://testnet.nearblocks.io/txns/9cVCENfnAoCBY5pbyP9eVkRCVYESWteANnGhodyvJL66)), and the timed-out request on `4` ([EJ5ggBHGDHEyirETdUMHGXvyrZJDV1QHHAepdcvCG1in](https://testnet.nearblocks.io/txns/EJ5ggBHGDHEyirETdUMHGXvyrZJDV1QHHAepdcvCG1in)).

- The `0.01 NEAR` deposit for the accepted execution charged `0.0010706002 NEAR` and refunded `0.0089293998 NEAR` to the LCP contract. The JSON `null` execution charged `0.001 NEAR` and refunded `0.009 NEAR`. The one-yocto promise failure produced no OutLayer refund. The timed-out request also returned `0.009 NEAR` after its contract callback had finalized the evaluation as timed out.
- LCP records the entire configured deposit as authorized spend. It does not recredit OutLayer refunds to the commitment operations budget or include them in sponsor escrow refunds. These returned amounts remain unassigned contract balance under the documented v0.1 conservative-accounting limitation.
- The configured 20 Tgas LCP callback used at most `2.889554002453 Tgas` across the sampled accepted, JSON-null, failure, and timeout outcomes. The configured 100 Tgas OutLayer request used at most `4.340434640545 Tgas`. Maximum-size output and stress-load tests remain open.

At finalized block `276853449`, `get_commitment` reported storage bonds of `0.02738 NEAR` for commitment `8` (one evaluation and challenge), `0.04377 NEAR` for `9` (two evaluations and challenge), `0.0286 NEAR` for closed commitment `19` (one evaluation and payout/refund), and `0.00869 NEAR` for `21` (no evaluation). The completion timestamp slot is included in challenge-open storage measurement. Commitment `22`, with two evaluations and one challenge, reports total `storage_deposit_yocto` of `0.04432 NEAR`; this total includes the commitment and all retained records, so it does not isolate the timestamp slot's marginal cost.

### Bounded commitment discovery

The contract now exposes a capped newest-first view, and the LCP Console requests ten records per page with an exclusive `before_id` cursor. After the list update, a finalized RPC view returned commitments `6` through `1`; a second view with `before_id=5` and `limit=2` returned `4` and `3`, confirming the cursor excludes its ID and preserves descending order. The SDK and production Console builds passed. In Brave, the recent list rendered against the deployed contract and selecting a row loaded its detail panel. Later Firefox checks verified the older-page control across all 21 records, wallet connect/disconnect, and the transaction flows detailed below.

### Playground payout, closure, and refund

Commitment `19` was topped up with `0.002 NEAR` surplus ([top-up](https://testnet.nearblocks.io/txns/5cQn2n6N9a7eHg6kJdYaCXj7Jiat1VdY778BNvoLo4Vs)), then evaluation `1` was accepted/compliant ([evaluation request](https://testnet.nearblocks.io/txns/4wKuNoznN3xjJJmXWjZox38CWVSCMniinewwyR21ZuGG)). Once its five-minute challenge window elapsed, the beneficiary claimed the `0.001 NEAR` tranche ([claim](https://testnet.nearblocks.io/txns/GuqCpRMHJ1XpQA6CTCEbNqQ1N7kk3U5HRjRREaLYFyeY)); the tranche view reported `Paid`. The sponsor closed the commitment ([close](https://testnet.nearblocks.io/txns/Gk3uN4kwqffLwCwyiXZ5CBaXgtVt2qgMJ2NwSE5GRDc1)) and received the remaining `0.002 NEAR` escrow ([refund](https://testnet.nearblocks.io/txns/65bFzqkKXuQdYW1STcaNkXzpWM6foKSH5HpWECHHnzV5)). Final state: `Closed`, `funded=0.003 NEAR`, `paid=0.001 NEAR`, `refunded=0.002 NEAR`, `pending=0`, `free=0`.

### Isolated failed-transfer recovery

A separate testnet contract, `failed-transfer-fixture.livingcommitmentsprotocol.testnet`, was deployed with the compile-time-only `testnet-transfer-failure-fixture` feature from commit `b29468a`. The fixture method is restricted to that exact testnet account and the commitment sponsor; the production contract was not upgraded. Deployment: [4EAop8Gc2Ji87txgXQzLpApCvFw1VUwiFUWHy2nCtsRC](https://testnet.nearblocks.io/txns/4EAop8Gc2Ji87txgXQzLpApCvFw1VUwiFUWHy2nCtsRC). The 570,675-byte WASM SHA-256 is `aff7530e3e28943acf6f679fb0f748c23c09ea668702d4e0e0d3fd7448c089dd`, with code hash `Cqu5mAP8cqtEUQospmxS3H4W6mzFmgaYqndjMmkaQtUC`. The account received 8 NEAR; estimated code storage was 5.70675 NEAR.

Fixture commitment `1` was created, funded with one `0.001 NEAR` tranche and `0.01 NEAR` evaluator operations, activated, and evaluated `Accepted / Compliant`. After its 30-second challenge window elapsed, the sponsor armed a one-shot transfer to the verified nonexistent account `missing-lcp-transfer-a335793427.testnet` ([arm failure target](https://testnet.nearblocks.io/txns/3AkoRVG4GkprNJc4uzrhQt4JwSJirNEeMYeVNNH33DFj)). The first claim ([claim](https://testnet.nearblocks.io/txns/4XkVJfh2ZZWsoVb14w4YLNJhBbkxDv6p6xU31vh7PEZ6), transfer `1`) settled as `Failed`; escrow returned to `pending=0`, `free=0.001 NEAR`, and `can_claim_tranche` returned `eligible=true`. The retry ([claim](https://testnet.nearblocks.io/txns/DJf9KLicUYrjSceoFiNGaCoK33AwV7cM4eVTRZ7481xx), transfer `2`) paid the configured beneficiary exactly once: `paid=0.001 NEAR`, `pending=0`, `free=0`. The commitment was then closed in [6szdotnoETu5xy9b8VEoDLUJY1PYA6eouWpgfTm4m4LN](https://testnet.nearblocks.io/txns/6szdotnoETu5xy9b8VEoDLUJY1PYA6eouWpgfTm4m4LN).

### Historical health timeline and attestation status

Commitment `22` was created specifically to exercise the timestamped history. Evaluation `1` was accepted/compliant ([request](https://testnet.nearblocks.io/txns/CmbGzHs1yjHvGrjaYpVPGoWUXh4ASWaHMtcfTiqvoPQR)); challenge `4` invalidated it ([resolution](https://testnet.nearblocks.io/txns/DDNY49TayK1AecJqbVApayorqvv6rGFakuBs7z6BpeYA)); accepted/compliant evaluation `2` restored `Healthy` ([request](https://testnet.nearblocks.io/txns/G7LUfKBenLQKQNZ2Ngg6XFyXmZsEWzzVaEQPH5Frb1Qq)). Firefox checks confirmed the dashboard orders those recorded transitions correctly. At the Nov 8, 2026 21:51 AST snapshot, it showed evidence freshness ending Nov 9 at 03:48 AST and the grace period ending at 04:48 AST; claims remained blocked while the challenge window was open.

The evaluation `2` panel found the public OutLayer record and matched its transaction, input, output, and WASM hashes against the contract record. This is a binding check, not TEE quote verification; the quote still needs OutLayer's report **Verify** action or standalone verifier. Commitment `22` has two evaluations, one challenge, `0.001 NEAR` escrow, and a reported storage deposit of `0.04432 NEAR`.

## Observed Testnet State and Fixture Notes

These are the last verified lifecycle observations. Time-derived health keeps changing, so refresh each snapshot before taking an action.

- Commitment `1` is `Closed`; its unused escrow was fully refunded. It is no longer a recovery fixture.
- Commitment `2` was `Active` with effective health `Breached` at the last noted read because its accepted heartbeat evidence had aged beyond freshness. Its only funded tranche was `Paid` to the distinct beneficiary.
- Commitment `3` is `Closed`; its unused escrow was fully refunded after the malformed evaluator output was rejected.
- Commitment `4` is `Closed`; its unused escrow was refunded after its evaluation timed out.
- Commitment `5` is `Closed`; its unused escrow was refunded after the updated callback classified JSON `null` as a failed result.
- Commitment `6` is `Closed`; its unused escrow was refunded after an OutLayer promise failure.
- Commitment `24` is `Closed`; evaluation `1` was accepted through the NEP-413 wallet flow, fresh evidence later restored `Healthy`, and residual escrow refund transfer `#9` settled. The sponsor added operations funds before requesting recovery evaluation `2`.
- Commitments `7`–`21` are a 15-record playground cohort, funded for one to three tranches and initially provisioned with one evaluator run each. Commitment `9` received an additional run for recovery, and `19` completed payout, closure, and refund. The other records remain in chain for inspection; refresh their snapshots before taking actions because their time-derived state continues to change.
- Commitment `22` is a historical-timeline fixture. At its Nov 8 snapshot, challenge `4` had invalidated evaluation `1`, evaluation `2` had restored `Healthy`, and the claim was still blocked by the challenge window. Refresh its health snapshot before relying on its current state.

The contract models an initial evidence deadline as `activated_at_ns + initial_window_ns`; it has no separate absolute-expiry field. These are the derived deadlines for the playground cohort:

| ID | Scenario | Initial evidence deadline (UTC) |
| --- | --- | --- |
| 7 | Healthy evidence and payout | Nov 13, 22:17 |
| 8 | Upheld challenge | Nov 13, 16:18 |
| 9 | Invalidated challenge and recovery | Nov 13, 10:19 |
| 10 | Challenge timeout | Nov 12, 22:19 |
| 11 | Evidence expiry and recovery | Nov 12, 10:19 |
| 12 | Initial deadline and grace | Nov 11, 22:19 |
| 13 | Non-recoverable breach | Nov 11, 10:19 |
| 14 | Recoverable breach | Nov 10, 22:20 |
| 15 | Short evidence freshness | Nov 10, 16:20 |
| 16 | Single epoch budget | Nov 10, 10:20 |
| 17 | Three epoch budget | Nov 10, 04:20 |
| 18 | Long evidence freshness | Nov 9, 22:21 |
| 19 | Short challenge window | Nov 9, 16:21 |
| 20 | Extended resolution window | Nov 9, 10:21 |
| 21 | Short initial evidence window | Nov 9, 04:21 |

- Playground commitment `8` accepted compliant evaluation `1`; challenge `2` was upheld, preserving `Healthy` evidence. Claims were held during the configured post-evaluation challenge window. [Evaluation request](https://testnet.nearblocks.io/txns/5or7nERU8uk2qKobG2WxaxCWyP7tesqVnuz7wACZSLYe) · [Upheld resolution](https://testnet.nearblocks.io/txns/Cb9URBfVDVqUJH5qJgJzzUWGEuNP9kLA7RhsG4YoTewC).
- Playground commitment `9` accepted evaluation `1`, then challenge `3` invalidated that evidence and put it `AtRisk`. A fresh compliant evaluation `2` restored `Healthy` and cleared the negative period. [Invalidation resolution](https://testnet.nearblocks.io/txns/HAyVNDmVXjww68nzVQdAammtoqLmZXnmaZLopt4e87WC) · [Recovery evaluation](https://testnet.nearblocks.io/txns/8p47a9eqNUicY99hT1VuqUxdYKqnjMuSMY6KXNYQR2TL).
- The workspace now has 44 Rust tests: contract/temporal coverage for exact initial-window, evidence-expiry, grace, challenge-window, and timeout boundaries; source timestamp validation; recovery policy; upheld and invalidated challenges; claim gating and escrow limits; failed-transfer recovery/retry; refund settlement; failed/malformed/timed-out OutLayer results; callback acceptance, binding rejection, stale callback handling, and replay idempotency; plus service-availability policy, quorum, and summary checks. The evaluator CLI tests cover v1 and NEP-413 signatures, invalid signatures, recipient and payload binding, canonical JSON, digest mismatch, transaction-hash requirements, and v3 aggregation thresholds. Node probe tests cover canonical request assembly and `u64` input bounds. See `TESTING.md` for commands and coverage.
- Live temporal boundaries were observed on commitment `21`: finalized samples moved from `AwaitingEvidence` to `AtRisk` at 00:21:58 AST and from `AtRisk` to `Breached` at 01:21:59 AST. The monitor removed its own cron entry after breach. Other future cohort observations remain useful exploratory data, not an open P0 requirement.
- The user completed Firefox wallet journeys across fixtures: commitment `24` create/fund/activate/evaluate/recover/close/refund; failed-transfer claim/retry on the isolated fixture; and the dashboard's historical and payout views. Commitment `24` had no claimable tranche because its funded epochs had ended. Commitment `19` independently verifies successful payout and residual refund.
- The static LCP Console preview is live at <https://preview.lcp-preview.pages.dev>. On Nov 9, Firefox checks confirmed wallet connection, NEAR reads, and OutLayer report lookup from this Cloudflare Pages origin. The production domain `lcp.gama.works` is not attached yet.
- A user-level cron monitor sampled finalized block time and commitment `21` health once per minute in `America/Santo_Domingo`; it removed its own entries after breach. Raw samples remain at `/private/tmp/lcp-temporal-monitor-21.jsonl`. The tracked monitor implementation is `scripts/monitor_near_temporal.py`.
- The Console dashboard includes a refreshable health clock timeline: recorded activation/evidence/negative-health timestamps are distinguished from policy-derived initial-evidence, freshness, and grace deadlines. It also displays evidence age, expiration, and a countdown to the next deadline. Firefox checks confirmed commitment `21`'s pre-deadline timeline and commitment `22`'s invalidation/recovery history, evidence age, countdown, and OutLayer hash status.
- Testnet RPC pagination returns IDs `21`–`12`, then `11`–`2`, then `1`, confirming the exclusive cursor. The user subsequently confirmed the browser older-page control works with all 21 records and the wallet connector connects.

P0 implementation, testnet acceptance checks, and browser journeys are complete. The automated tests and reproduction material are prepared, and project-authored material is licensed under Apache-2.0 in `LICENSE`. The upstream `NEAR-HACKATHON-SKILL.md` snapshot is explicitly excluded. PRD requirement LCP-017 remains publication-pending until these files are publicly accessible; making the repository public satisfies the remaining P0 access gate. The Git-integrated production Pages project and `lcp.gama.works` domain are separate deployment tasks, not protocol P0 acceptance criteria; the public preview has already passed the manual browser checks.

## Local Configuration and Verifier Note

`apps/console/.env.local` contains only public testnet settings and is ignored by Git. Testnet credentials remain in the ignored `.env.testnet`; never copy them into tracked files.

The installed standalone verifier build returned HTTP 410 from its retired default testnet API. For reproduction, set `--api https://testnet-api.outlayer.ai`, `--rpc https://test.rpc.fastnear.com`, and `--archival-rpc https://archival-rpc.testnet.fastnear.com`. An example is:

```sh
outlayer-verify tx t6yZZP5hNDzvFMv2kUoXj4s1VBh4ceXgtbaHnTkrJo5 \
  --network testnet \
  --api https://testnet-api.outlayer.ai \
  --rpc https://test.rpc.fastnear.com \
  --archival-rpc https://archival-rpc.testnet.fastnear.com
```
