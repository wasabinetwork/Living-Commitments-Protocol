# Service Availability Evaluator

This evaluator aggregates HTTPS observations from independent operators for an LCP commitment-policy v3. Service source-policy schema v1 uses pinned Ed25519 keys and raw or NEP-413-signed reports. Schema v2 removes operator keys and authenticates each report through the operator's NEAR transaction and the contract inbox. The schema v2 contract is deployed on testnet and the evaluator is published at <https://artifacts.lcp.gama.works/service-availability/908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611.wasm> (SHA-256 `908ed60d3eeceb9e57b8cfebda6d3eed37a21f02aed4d192dda298073b87d611`, 410,392 bytes). Existing v1 and v2 base commitments continue to use the maintenance-heartbeat evaluator. Older service v3 commitments, including commitment `26`, remain pinned to their original legacy evaluator at <https://artifacts.lcp.gama.works/da867cdca199f0c663e848a33cc0962bdeb84ca98553c45b5e11583ee6aee627.wasm> (SHA-256 `da867cdca199f0c663e848a33cc0962bdeb84ca98553c45b5e11583ee6aee627`). The prior NEP-413 build remains available at <https://artifacts.lcp.gama.works/service-availability/eec7211dec72b0066e649564edb9d8943ef69236e6a6e62cb47de23abe2363c6.wasm> (SHA-256 `eec7211dec72b0066e649564edb9d8943ef69236e6a6e62cb47de23abe2363c6`) for commitments pinned to it. The branded host is a same-bucket alias; deployed commitments keep their immutable originally recorded URLs.

## Policy and outcomes

Both policy schemas pin 2–8 source IDs and distinct operator account IDs. Schema v1 also pins a distinct Ed25519 public key per source. Schema v2 omits operator keys and instead requires each report transaction to be submitted by the configured account. Both schemas fix the salted target fingerprint, maximum report age, acceptable HTTP status range, latency limit, strict-majority quorum, and minimum corroboration in basis points.

Every report payload binds the contract, commitment, evaluation, v3 policy digest, source-policy digest, source and operator IDs, target fingerprint, observation time, and result. Schema v1 wraps the payload in a raw Ed25519 or NEP-413 signature. Schema v2 submits the unsigned payload in a NEAR wallet transaction; the contract stores the transaction predecessor account and inserts that trusted submitter into evaluator input. The evaluator checks that the submitter matches the source policy. The contract allows schema v2 evaluation only from stored inbox reports, preventing a sponsor from fabricating the submitter field through the public raw-report method. This proves which account submitted the report, not that its observation is true. The target fingerprint is `SHA-256(salt_bytes || canonical_HTTPS_URL_UTF8)`; the endpoint URL and salt stay with the operators.

- A TLS-verified response in the configured status range and latency limit votes **up**. Other valid HTTP responses, timeouts, and TLS errors vote **down**. Signed source-side errors abstain.
- Invalid, stale, or wrongly bound reports do not count. Duplicate source reports reject the bundle.
- `Compliant` and `NonCompliant` require both the configured majority and coverage threshold. Otherwise the result is `Inconclusive`.
- Coverage is the largest agreeing vote divided by the configured roster. It measures source agreement, not probability of truth. An inconclusive result is stored but changes neither health clock nor claim eligibility.

The contract stores the v3 source policy and accepted source-count summary in prefixed raw storage keys, counts them toward storage bonds, and checks callback bindings and quorum arithmetic. Existing persisted commitment and policy Borsh layouts remain unchanged; `Inconclusive` is appended after the existing verdict variants.

## Operator setup

### Console and NEAR wallet

For legacy schema v1, policy creation pins an operator public key; reports may be signed with NEP-413 or an offline Ed25519 key. For new schema v2 policies, the creator enters operator account IDs only. The operators can connect later from separate devices; the creator does not need access to their wallets. The target fingerprint and random 32-byte salt can be created in the browser. The Console keeps the endpoint URL and salt in component memory and never puts them in the policy transaction.

For schema v2, each operator opens the commitment in the Console on their own device, connects the listed account, enters the authorized endpoint and salt, runs the browser health check, then submits the report with one NEAR transaction. The wallet transaction both authorizes the account and stages the report. The probe is limited to the same HTTPS origin as the Console, sends no credentials, follows no redirects, and reads no body. A browser fetch error is reported as an abstention because the browser cannot distinguish DNS, TLS, or routing failures safely. The inbox stores at most one 4 KiB report per source for the upcoming evaluation, and each entry expires within 15 minutes or at the policy freshness deadline, whichever comes first. The 4 KiB cap is an application choice to bound storage and evaluator costs, not a NEAR chain limit; [NEP-509](https://github.com/near/NEPs/blob/master/neps/nep-0509.md) specifies a much larger transaction-size limit, and [NEP-145](https://github.com/near/NEPs/blob/master/neps/nep-0145.md) defines the storage-staking model. The evaluator request has a separate 32 KiB cap. Operators fund the storage bond; consuming, replacing, or reclaiming an entry credits that bond to the original operator for withdrawal. Reports and observations are public on NEAR, but the endpoint URL and salt are not part of the report.

Evaluator URL and digest are immutable after creation. A fresh schema v2 commitment should pin the transaction-authenticated artifact above; existing commitments keep the evaluator version recorded in their original policy. The artifact is published, but this does not substitute for live two-operator testnet validation.

### Standalone operator tool (legacy fallback)

For targets on a different origin, the current browser probe is not available. The CLI tool remains the fallback and still uses a separate Ed25519 key. Generate one independently for each operator, keep its private PEM on that operator's machine, and share only the public key with the policy author:

```sh
node evaluators/service-availability/probe.mjs keygen ./probe-private.pem
node evaluators/service-availability/probe.mjs target-id https://status.example.org/health <64-hex-salt>
node evaluators/service-availability/probe.mjs policy-hash ./source-policy.json
```

The policy author pins the resulting public keys and shares each operator a private `lcp.service_availability.probe_config.v1` containing the authorized HTTPS URL, salt, source IDs, commitment/evaluation IDs, policy digests, and the operator's public key. Then each operator runs:

```sh
node evaluators/service-availability/probe.mjs probe ./probe-config.json ./probe-private.pem > ./probe-report.json
```

The probe rejects IP literals, private/reserved IPv4 results, non-HTTPS URLs, credentials, nonstandard ports, and redirects. Keep operator clocks synchronized; the evaluator checks report age against the request's NEAR block timestamp. Only probe endpoints the policy author is authorized to check.

## Console pilot flow

1. In **Create commitment**, choose **Independent service probes · v3**, set the evaluator URL and SHA-256 to the transaction-authenticated artifact above, pin the maintainer key, and list at least two distinct operator account IDs. Operator public keys are not needed. Create the target fingerprint and private salt in the browser, and set the temporal maximum source lag at least as long as the source-policy report-age limit.
2. Create, fund, and activate the commitment. For each evaluation, operators open that commitment in the Console; it binds a new report to the current `next_evaluation_id`, policy digest, and source-policy digest.
3. For same-origin targets, each operator connects their listed account, uses **Run health check**, then **Submit report to NEAR**. The wallet transaction puts the report directly in the public inbox; no report key or JSON handoff is needed. Use the legacy signed JSON flow only with a schema v1 commitment.
4. The maintainer or sponsor reviews the inbox and requests evaluation from its unexpired reports. Reports expire after at most 15 minutes and are bound to the next evaluation ID; report storage deposits become withdrawable credits after evaluation, replacement, or expiry. The Console displays verdict, valid/up/down/abstain counts, and coverage. The contract remains authoritative for health and payouts.

The selected pilot endpoint, `https://preview.lcp-preview.pages.dev/health`, returned HTTP 200 from two operator locations on different IP addresses on 2026-11-09 and continues to return the static health response after the latest preview deployment. The production `https://lcp.gama.works/health` route returned HTTP 503 on 2026-11-10. These checks confirm reachability only; the fresh schema v2 commitment and contract-backed two-operator testnet evaluation are still pending.

OutLayer's WASI Preview 2 runtime can also make HTTPS requests. A future single-source TEE probe could remove operator coordination, but it would replace the independent network quorum with the OutLayer probe environment and needs a private endpoint-input path. Keep it as an explicitly labeled option, not a silent replacement for multi-source evidence.

## Offline evaluator checks

`probe.mjs assemble-request` builds the same canonical evaluator request shape for local runs. The metadata JSON must include `contract_id`, `commitment_id`, `evaluation_id`, `policy_hash`, `requested_at_ns`, and `subject`; use the actual commitment digest and request timestamp for a contract-backed exercise. Evaluate with a valid base58 encoding of a 32-byte transaction hash:

```sh
node evaluators/service-availability/probe.mjs assemble-request ./metadata.json ./source-policy.json ./reports/probe-a.json ./reports/probe-b.json > ./request.json
NEAR_TRANSACTION_HASH=<32-byte-base58-tx-hash> cargo run -p service-availability-evaluator < ./request.json
```

Run regression coverage and builds with:

```sh
cargo test -p lcp-core -p service-availability-evaluator
node --test evaluators/service-availability/test/probe.test.mjs
npm --prefix packages/sdk run build
npm --workspace=@lcp/console run build
```
