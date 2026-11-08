# NEAR Testnet E2E Status

**Last verified:** 2026-11-08  
**Source revision:** `caf1f8f`  
**Network:** NEAR testnet

## Deployment

- **Contract account:** `livingcommitmentsprotocol.testnet`
- **Deployment transaction:** [BStkSef7JLuuHT6tECZ14zBJ1y5Hh9KU577AjvtFTgth](https://testnet.nearblocks.io/txns/BStkSef7JLuuHT6tECZ14zBJ1y5Hh9KU577AjvtFTgth)
- **On-chain code hash:** `3oerWX4Ta3tg1MgnR7Hwq1PuwN4wyQZhrGurCPXNocez`
- **Evaluator SHA-256:** `a38de26a27df0c81dbc8fa099b6f5f3bd32f56dff335afad74686620e58cf44a`
- **FastFS URL:** <https://test.fastfs.io/livingcommitmentsprotocol.testnet/outlayer.testnet/a38de26a27df0c81dbc8fa099b6f5f3bd32f56dff335afad74686620e58cf44a.wasm>
- The published evaluator was fetched from FastFS and its bytes matched the local artifact digest.

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

Commitment `3` pinned an all-zero evaluator digest while pointing at the published evaluator artifact. Its request transaction was [7YZa8jLihPDfbgSEU1NUwYntFjcu5S2tNAbzpvcLdJBA](https://testnet.nearblocks.io/txns/7YZa8jLihPDfbgSEU1NUwYntFjcu5S2tNAbzpvcLdJBA). The callback completed with evaluation status `Rejected` and reason `MALFORMED_VERDICT`; the stored output hash `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b` is SHA-256 of the JSON bytes `null`. The pending evaluation pointer cleared. Operations accounting recorded the full `0.01 NEAR` execution deposit as authorized spend.

Commitment `3` was then closed in [H5BgoFiJyfWz1k6Rty92SFm8xdC5ZNpPHzQttj4qPa2t](https://testnet.nearblocks.io/txns/H5BgoFiJyfWz1k6Rty92SFm8xdC5ZNpPHzQttj4qPa2t); its unused `0.01 NEAR` escrow was refunded and reconciled in [7EJAPXLAraX13s6dFopLSfAkAkuznRvboALAzSGAbPzd](https://testnet.nearblocks.io/txns/7EJAPXLAraX13s6dFopLSfAkAkuznRvboALAzSGAbPzd). This records the observed malformed-output path. It does not simulate an OutLayer promise rejection or a missing callback past the request deadline.

## Current Testnet State and Remaining Work

- Commitment `1` is `Closed`; its unused escrow was fully refunded. It is no longer a recovery fixture.
- Commitment `2` remains `Active` and `Healthy`; its only tranche is `Paid` to the distinct beneficiary.
- Commitment `3` is `Closed`; its unused escrow was fully refunded after the malformed evaluator output was rejected.
- The deployed evaluator proof, malformed-output rejection, breach-gated payment, recovery, one successful beneficiary payout, challenge timeout/invalidation, closure, and successful refund callbacks are validated.
- Still open: OutLayer promise rejection and no-callback timeout behavior, failed NEAR transfer recovery, arbiter uphold/invalidate challenge paths, broader temporal boundaries, and a full wallet-driven demo run.
- Historical commitment discovery is still ID-based; design a bounded index or event-backed discovery path before expanding the public demo.

Recommended next sequence:

1. Reproduce a genuine OutLayer promise rejection and a no-callback request timeout; confirm callback status and permissionless expiry semantics.
2. Exercise failed transfer callback recovery and confirm escrow/claim state remains retryable.
3. Validate arbiter uphold and invalidation on fresh test commitments, then boundary-test `AtRisk`/`Breached` transitions.
4. Run the complete browser-wallet journey and decide on a bounded discovery/indexing design.

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
