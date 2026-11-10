# Service Availability Evaluator (P1 prototype)

This standalone evaluator is the first domain-specific P1 slice: a community service is checked by independent HTTPS probe operators, and signed reports are aggregated under a threshold policy. It is not connected to `lcp-core` yet. Existing v1 and v2 commitments continue to use `maintenance-heartbeat` unchanged.

## Rule model

The request contains a source policy and signed probe reports. The policy pins each `source_id`, `operator_id`, and Ed25519 public key; it requires 2–8 sources sorted by unique source ID, distinct operator IDs, and distinct keys. `minimum_agreeing_sources` must be a strict majority. `minimum_corroboration_bps` adds an independent agreement floor from 0 to 10000; for three sources, a 7000-bps floor means all three must agree. The source-policy digest is SHA-256 over compact JSON in the Rust struct field order. `probe.mjs policy-hash <policy.json>` emits that digest and canonical serialization.

Each report signs compact JSON for `lcp.service_availability.report.v1` with Ed25519. It binds the contract, commitment, evaluation, full policy digest, source-policy digest, source/operator IDs, salted target fingerprint, observation time, and probe result. The target fingerprint is `SHA256(salt_bytes || canonical_HTTPS_URL_UTF8)`; the URL and salt stay with the operators and are not put in the report.

- A verified HTTP response is **up** when TLS validates, its status is in the configured range, and latency is within the limit. Other valid HTTP responses and timeouts are **down**.
- A signed `source_error` abstains. Invalid, stale, replayed, or wrongly bound reports do not count; duplicate reports for one source reject the bundle.
- Both the strict-majority count and corroboration floor must be met for a positive or negative quorum. A split or insufficient quorum returns `Inconclusive`.
- `corroboration_bps` is the maximum agreeing vote count divided by configured operators. It measures source agreement, not the probability that the service is truthful.

## Probe operator commands

Generate a source key once; keep the private PEM on the operator's machine and place only its public key in policy:

```sh
node evaluators/service-availability/probe.mjs keygen ./probe-private.pem
```

Create a salted target fingerprint and calculate a policy digest with:

```sh
node evaluators/service-availability/probe.mjs target-id https://status.example.org/health <64-hex-salt>
node evaluators/service-availability/probe.mjs policy-hash ./source-policy.json
```

Prepare a `lcp.service_availability.probe_config.v1` JSON file with the policy-bound IDs and hashes, HTTPS target URL, salt, pinned public key, and timeout. Then produce the signed report:

```sh
node evaluators/service-availability/probe.mjs probe ./probe-config.json ./probe-private.pem
```

The probe tool rejects IP literals, private/reserved IPv4 results, non-HTTPS URLs, embedded credentials, nonstandard ports, and redirects. It pins the validated public IPv4 address for the request. DNS timeouts and ordinary source-side DNS/network errors are signed as abstentions; an HTTPS request timeout or TLS failure is a `down` observation. The operator should still run probes only for targets allowed by the policy and under their control or authorization.

## Offline pilot procedure

This procedure exercises signed, multi-source service evidence against an authorized public health endpoint. It does not create or update a NEAR commitment: policy_hash is an external commitment digest in the eventual v3 flow. For an isolated evaluator exercise, use the source-policy digest as policy_hash and label the run as local-only.

1. The service maintainer chooses an HTTPS health endpoint they control, generates a private 32-byte salt, and computes its target_id. Share the URL and salt privately with each operator. Do not publish the salt.
2. Each operator runs keygen on their own machine, then sends only their public key, operator ID, and source ID to the policy author. Use distinct operators on distinct networks for a meaningful independence check.
3. The policy author creates the source policy, sorts sources by source_id, and runs policy-hash. Each operator receives a private probe config containing the URL, salt, policy hashes, IDs, and their own public key. The operator keeps the private key local and runs probe, saving the output as one report JSON file.
4. Create metadata with the contract account, commitment and evaluation IDs, policy hash, and request timestamp. In the offline exercise, set policy_hash to the source_policy_hash printed by policy-hash; for a contract-backed request, the v3 contract must supply its actual digest and block timestamp.
5. Assemble the canonical request and evaluate it:

       node evaluators/service-availability/probe.mjs assemble-request ./metadata.json ./source-policy.json ./reports/probe-a.json ./reports/probe-b.json ./reports/probe-c.json > ./request.json
       cargo run -p service-availability-evaluator < ./request.json

   The result should be Compliant when the up quorum and coverage floor are met, NonCompliant when the down quorum and floor are met, and Inconclusive otherwise.

For a useful pilot record the operator networks, endpoint owner, policy digest, report timestamps, outcome, and reason code. Do not claim independent validation when keys or probes were controlled from one operator or network. The contract v3 path, Console display, and testnet lifecycle are still pending.

## Build and integration boundary

Build the prototype with `cargo build -p service-availability-evaluator`. The evaluator accepts canonical compact JSON up to 32 KiB on stdin, allows one final line feed for shell piping, and emits a bounded JSON verdict. Contract integration requires the separately designed v3 schema to store and hash this source policy, accept `Inconclusive` without refreshing evidence, and preserve old serialized commitment state. Do not deploy this prototype as a commitment evaluator until that contract path exists.

Reports in this pilot describe a public service. The current NEAR evaluation flow publishes request arguments, so do not put confidential URLs, response bodies, credentials, or private user data in these reports.
