# Service Availability Evaluator

This evaluator aggregates signed HTTPS observations from independent operators for an LCP policy v3 commitment. The v3 contract and evaluator are deployed to NEAR testnet, and the Console/SDK integration is implemented locally. The live v3 commitment lifecycle has not yet been exercised; existing v1 and v2 commitments continue to use the maintenance-heartbeat evaluator. The evaluator artifact is available at https://pub-abfff274369343cdb67806b37bfc9c4b.r2.dev/da867cdca199f0c663e848a33cc0962bdeb84ca98553c45b5e11583ee6aee627.wasm with SHA-256 `da867cdca199f0c663e848a33cc0962bdeb84ca98553c45b5e11583ee6aee627`.

## Policy and outcomes

The immutable policy pins 2–8 source IDs, distinct operator IDs, and distinct Ed25519 public keys. It also fixes the salted target fingerprint, maximum report age, acceptable HTTP status range, latency limit, strict-majority quorum, and minimum corroboration in basis points. The Console accepts this policy as JSON when creating a v3 commitment.

Each report signs canonical compact JSON for `lcp.service_availability.report.v1`. It binds the contract, commitment, evaluation, v3 policy digest, source-policy digest, source and operator IDs, target fingerprint, observation time, and result. The target fingerprint is `SHA-256(salt_bytes || canonical_HTTPS_URL_UTF8)`; the endpoint URL and salt stay with the operators.

- A TLS-verified response in the configured status range and latency limit votes **up**. Other valid HTTP responses, timeouts, and TLS errors vote **down**. Signed source-side errors abstain.
- Invalid, stale, or wrongly bound reports do not count. Duplicate source reports reject the bundle.
- `Compliant` and `NonCompliant` require both the configured majority and coverage threshold. Otherwise the result is `Inconclusive`.
- Coverage is the largest agreeing vote divided by the configured roster. It measures source agreement, not probability of truth. An inconclusive result is stored but changes neither health clock nor claim eligibility.

The contract stores the v3 source policy and accepted source-count summary in prefixed raw storage keys, counts them toward storage bonds, and checks callback bindings and quorum arithmetic. Existing persisted commitment and policy Borsh layouts remain unchanged; `Inconclusive` is appended after the existing verdict variants.

## Operator setup

Generate a key independently for each operator. Keep the private PEM on that operator's machine and share only the public key with the policy author:

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

1. In **Create commitment**, choose **Independent service probes · v3**, pin the maintainer NEAR key, and enter a policy with sorted source IDs and distinct operators/keys. Generate `target_id` with the command above. Set the temporal maximum source lag at least as long as the source policy report-age limit.
2. Create, fund, and activate the commitment. For each evaluation, read the current commitment ID, `next_evaluation_id`, and policy digest from the Console. Generate reports bound to those exact values and the source-policy digest.
3. Paste the reports into **Submit signed service probes**. The Console checks their policy and evaluation bindings; the evaluator verifies signatures and aggregation. NEAR receives the report JSON publicly, so never include private URLs, salts, credentials, response bodies, or personal data.
4. The Console displays verdict, valid/up/down/abstain counts, and coverage. The contract remains authoritative for health and payouts.

The selected pilot endpoint, `https://lcp.gama.works/health`, returned HTTP 200 from two operator locations on different IP addresses on 2026-11-09. This confirms reachability from those locations only; signed report aggregation and a contract-backed testnet evaluation are still pending.

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
