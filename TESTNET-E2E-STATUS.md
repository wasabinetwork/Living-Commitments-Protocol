# NEAR Testnet E2E Status

**Last verified:** 2026-11-08  
**Source revision:** `b8e493d`
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

### Breach, claim rejection, and recovery

- Commitment `1` became `Breached` after the test policy's 30-minute evidence TTL and 5-minute grace period.
- A claim while breached reverted as expected: [DvEG9yhep14Bv33UVrYuFMVZrR2XJqRL54Zk8GVFb9EE](https://testnet.nearblocks.io/txns/DvEG9yhep14Bv33UVrYuFMVZrR2XJqRL54Zk8GVFb9EE). Escrow remained unpaid.
- Fresh evidence produced accepted/compliant evaluation `2` and restored `Healthy`: [6dbZVesRPA1mdv9mJe9ghVzigWDCKFxZ6fZiC792Eb8U](https://testnet.nearblocks.io/txns/6dbZVesRPA1mdv9mJe9ghVzigWDCKFxZ6fZiC792Eb8U).

### Distinct-beneficiary payout

Commitment `2` used beneficiary `payee-85d2a7.livingcommitmentsprotocol.testnet`, separate from the sponsor. Its creation transaction is [5PE5axDnSMU3jacHjetH2BKC9XbqWBSPNC1JMxTwDtJg](https://testnet.nearblocks.io/txns/5PE5axDnSMU3jacHjetH2BKC9XbqWBSPNC1JMxTwDtJg), with policy hash `b9c9e004d802ea8f61158133806e39f0524fcf85907cfad4b1eb5bb92d74834e`.

- Evaluation `1` was accepted/compliant: [E2BhabjqWkev97UHFrxe9jn5N8BbGWDH7p4uBTZK1UkP](https://testnet.nearblocks.io/txns/E2BhabjqWkev97UHFrxe9jn5N8BbGWDH7p4uBTZK1UkP).
- Tranche claim and transfer callback completed: [59Asjsm5b2KYxPhaY2tSWgCrzu7Zu1BQfVUt7so91t9y](https://testnet.nearblocks.io/txns/59Asjsm5b2KYxPhaY2tSWgCrzu7Zu1BQfVUt7so91t9y). `get_tranche` reported `Paid`; escrow showed `paid=0.01 NEAR`, `pending=0`, and the beneficiary balance increased by about `0.007065 NEAR` after transfer/storage costs.

### Challenge timeout and evidence invalidation

Commitment `1` evaluation `3` was accepted/compliant: [C5mfYMeApbCu2ENZgyCCnNmEB5c45jUTxV47yh6orFoF](https://testnet.nearblocks.io/txns/C5mfYMeApbCu2ENZgyCCnNmEB5c45jUTxV47yh6orFoF). Challenge `1` was opened in [A8nRCan3NJkSY7pYMq9c5CiRDs8oRVZEruRmXWBGwvZU](https://testnet.nearblocks.io/txns/A8nRCan3NJkSY7pYMq9c5CiRDs8oRVZEruRmXWBGwvZU) and then permissionlessly expired after its resolution deadline: [5amhA2gzcNYJBvxUQK3nSZrnFNLPwoond5qDd3zbgn1m](https://testnet.nearblocks.io/txns/5amhA2gzcNYJBvxUQK3nSZrnFNLPwoond5qDd3zbgn1m). The resulting challenge status was `TimedOut`, the active challenge pointer was cleared, `last_good_evaluation_id` became null, and effective health was `AtRisk`. Arbiter uphold/invalidate outcomes remain untested.

### Closure and escrow refund

After resolving the open challenge by timeout, commitment `1` was closed in [H5iX5ZseRCVKLnH2fgCfc4jFs1Yqf2h7M1WUHADRTPjm](https://testnet.nearblocks.io/txns/H5iX5ZseRCVKLnH2fgCfc4jFs1Yqf2h7M1WUHADRTPjm). The sponsor then requested the full unused `0.01 NEAR` refund in [3VyLLme3k8Z87fr8p5WwSxfAPLT9JnYSTnwyb9ta8Li6](https://testnet.nearblocks.io/txns/3VyLLme3k8Z87fr8p5WwSxfAPLT9JnYSTnwyb9ta8Li6). Final escrow view: `funded=0.01 NEAR`, `paid=0`, `refunded=0.01 NEAR`, `pending=0`, `free=0`. The successful refund callback reconciled the accounting.

### Mismatched evaluator digest

Commitment `3` pinned an all-zero evaluator digest while pointing at the published evaluator artifact. Its request transaction was [7YZa8jLihPDfbgSEU1NUwYntFjcu5S2tNAbzpvcLdJBA](https://testnet.nearblocks.io/txns/7YZa8jLihPDfbgSEU1NUwYntFjcu5S2tNAbzpvcLdJBA). Under the original callback code, the callback recorded `Rejected / MALFORMED_VERDICT`; the stored output hash `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b` is SHA-256 of JSON `null`. The pending evaluation pointer cleared. Operations accounting recorded the full `0.01 NEAR` execution deposit as authorized spend.

Commitment `3` was then closed in [H5BgoFiJyfWz1k6Rty92SFm8xdC5ZNpPHzQttj4qPa2t](https://testnet.nearblocks.io/txns/H5BgoFiJyfWz1k6Rty92SFm8xdC5ZNpPHzQttj4qPa2t); its unused `0.01 NEAR` escrow was refunded and reconciled in [7EJAPXLAraX13s6dFopLSfAkAkuznRvboALAzSGAbPzd](https://testnet.nearblocks.io/txns/7EJAPXLAraX13s6dFopLSfAkAkuznRvboALAzSGAbPzd).

### Callback result classification and request timeout

The callback now parses OutLayer JSON as `Option<EvaluationVerdictOutput>`. A JSON `null` becomes `Failed / MISSING_OUTLAYER_RESULT` while preserving its output hash; malformed JSON or an invalid verdict object remains `Rejected / MALFORMED_VERDICT`. This follows OutLayer's documented NEAR callback shape, `Result<Option<T>, PromiseError>` ([integration guide](https://app.outlayer.ai/docs/near-integration)). The code built and was deployed in the callback update transaction above.

Commitment `4` used the mismatched-digest fixture against the updated contract. Evaluation request [EJ5ggBHGDHEyirETdUMHGXvyrZJDV1QHHAepdcvCG1in](https://testnet.nearblocks.io/txns/EJ5ggBHGDHEyirETdUMHGXvyrZJDV1QHHAepdcvCG1in) remained pending past its 30-second request deadline. It later finalized as `TimedOut / OUTLAYER_TIMEOUT` and cleared `pending_evaluation_id`. The post-update request did not return JSON `null`, so the new `MISSING_OUTLAYER_RESULT` branch is compile-checked but not yet confirmed by a second null response.

Commitment `4` was closed in [9YwHqZyFUTtyoYgRJBpru3Boxp6adzhAZqxrKHrSenAr](https://testnet.nearblocks.io/txns/9YwHqZyFUTtyoYgRJBpru3Boxp6adzhAZqxrKHrSenAr) and its unused escrow refund reconciled in [E5ncJXMB8QdZX8KGFU5WefCcHa7ZmfcxwhsahvtPNPW](https://testnet.nearblocks.io/txns/E5ncJXMB8QdZX8KGFU5WefCcHa7ZmfcxwhsahvtPNPW).

Commitment `5` repeated the mismatched-digest scenario with a 180-second request deadline. Evaluation request [DDzr53ZFHb28qRowupk5R7EAMGH9sVZLyTy7r5LNThQf](https://testnet.nearblocks.io/txns/DDzr53ZFHb28qRowupk5R7EAMGH9sVZLyTy7r5LNThQf) returned JSON `null` before the deadline. The updated callback recorded `Failed / MISSING_OUTLAYER_RESULT`, preserved output hash `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`, and cleared the pending pointer. Commitment `5` was closed in [5NaMLAsb8JbXGf8kRkB3hLoCHmfs6aT2iM11zTtWb8pj](https://testnet.nearblocks.io/txns/5NaMLAsb8JbXGf8kRkB3hLoCHmfs6aT2iM11zTtWb8pj) and its unused escrow refund reconciled in [AFcg1Gk9QhRW9QdKWQpJaGe9eywyGQ5xUJNyPtRcYKeo](https://testnet.nearblocks.io/txns/AFcg1Gk9QhRW9QdKWQpJaGe9eywyGQ5xUJNyPtRcYKeo).

### OutLayer promise failure

Commitment `6` used a valid evaluator artifact with an execution deposit of one yoctoNEAR. The OutLayer promise failed and evaluation request [9cVCENfnAoCBY5pbyP9eVkRCVYESWteANnGhodyvJL66](https://testnet.nearblocks.io/txns/9cVCENfnAoCBY5pbyP9eVkRCVYESWteANnGhodyvJL66) completed as `Failed / OUTLAYER_EXECUTION_FAILED`. The pending pointer cleared, and operations accounting recorded one yoctoNEAR as authorized spend. Commitment `6` was closed in [B3gADB6nAKCZnWeJuYsgZZ6GNtVyVKjL4QSVV616RJm8](https://testnet.nearblocks.io/txns/B3gADB6nAKCZnWeJuYsgZZ6GNtVyVKjL4QSVV616RJm8); its unused escrow refund reconciled in [6AzNBE9UGS2BfYxePgRVgMmAu3WGLnYjKo2JJdi9DDzX](https://testnet.nearblocks.io/txns/6AzNBE9UGS2BfYxePgRVgMmAu3WGLnYjKo2JJdi9DDzX).

### Bounded commitment discovery

The contract now exposes a capped newest-first view, and the demo requests ten records per page with an exclusive `before_id` cursor. After the list update, a finalized RPC view returned commitments `6` through `1`; a second view with `before_id=5` and `limit=2` returned `4` and `3`, confirming the cursor excludes its ID and preserves descending order. The SDK and production demo builds passed. The browser UI still needs a manual run against the deployed contract.

## Current Testnet State and Remaining Work

- Commitment `1` is `Closed`; its unused escrow was fully refunded. It is no longer a recovery fixture.
- Commitment `2` remains `Active` and `Healthy`; its only tranche is `Paid` to the distinct beneficiary.
- Commitment `3` is `Closed`; its unused escrow was fully refunded after the malformed evaluator output was rejected.
- Commitment `4` is `Closed`; its unused escrow was refunded after its evaluation timed out.
- Commitment `5` is `Closed`; its unused escrow was refunded after the updated callback classified JSON `null` as a failed result.
- Commitment `6` is `Closed`; its unused escrow was refunded after an OutLayer promise failure.
- The deployed evaluator proof, malformed-output rejection under the initial callback, updated null-result classification, promise failure, request timeout, breach-gated payment, recovery, one successful beneficiary payout, challenge timeout/invalidation, closure, successful refund callbacks, and bounded discovery pagination are validated.
- Failed tranche callbacks clear pending escrow and mark the tranche `Failed`; contract eligibility permits a retry if the commitment is still healthy and the epoch remains active. The demo now labels that action `Retry payout`. The failed-transfer callback/retry path itself remains unverified on testnet.
- Still open: failed NEAR transfer recovery, arbiter uphold/invalidate challenge paths, broader temporal boundaries, and the full wallet-driven demo run (including the new browser UI).
- The bounded, newest-first commitment listing is deployed and pagination is verified through finalized RPC views. The demo browser is implemented, but its UI still needs manual validation against the deployed contract.

Recommended next sequence:

1. Exercise failed transfer callback recovery and confirm escrow/claim state remains retryable.
2. Validate arbiter uphold and invalidation on fresh test commitments, then boundary-test `AtRisk`/`Breached` transitions.
3. Run the browser against the deployed contract, validate the recent/older commitment list UI, then complete the full wallet-driven journey.

## Local Configuration and Verifier Note

`apps/demo/.env.local` contains only public testnet settings and is ignored by Git. Testnet credentials remain in the ignored `.env.testnet`; never copy them into tracked files.

The installed standalone verifier build returned HTTP 410 from its retired default testnet API. For reproduction, set `--api https://testnet-api.outlayer.ai`, `--rpc https://test.rpc.fastnear.com`, and `--archival-rpc https://archival-rpc.testnet.fastnear.com`. An example is:

```sh
outlayer-verify tx t6yZZP5hNDzvFMv2kUoXj4s1VBh4ceXgtbaHnTkrJo5 \
  --network testnet \
  --api https://testnet-api.outlayer.ai \
  --rpc https://test.rpc.fastnear.com \
  --archival-rpc https://archival-rpc.testnet.fastnear.com
```
