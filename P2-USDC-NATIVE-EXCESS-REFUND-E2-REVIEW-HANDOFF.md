# Native Excess-Refund E2 Independent Review Handoff

## Purpose

This package is for an independent defensive review of the E2 evidence fixes for the native excess-storage-refund path in LCP. Review the candidate artifact provenance, saved NEAR Sandbox receipt evidence, and capture verifier. Separate evidence-checker defects from contract behavior. The current owner acceptance is local; independent acceptance remains open.

## Candidate and review revisions

- Repository: `https://github.com/wasabinetwork/Living-Commitments-Protocol`
- Review branch: `codex/p2-native-refund-e2-review`
- Review package revision: `646f9c082f09f59b829fa2685a5535c939ae0699`
- Contract source/build revision embedded in NEP-330 metadata: `950e3cb50fd79f559f5b6ff725fbfa32db70a063`
- Build variant: `sandbox-recovery`; cargo-near 0.23.0, Rust 1.100.0, SourceScan image digest `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1`
- Candidate core WASM SHA-256: `4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad`
- Candidate NEAR code hash: `6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212`
- Sandbox capture: `tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json`; its 24-row manifest is adjacent.
- Runtime: NEAR Sandbox 2.14.0, protocol 88. No public-chain transaction or deployment is in scope.

Two pinned container builds from the contract source revision produced the same candidate hashes. The earlier plain builds (`0f194b…` and `33997e…`) are retained as diagnostic history and are not the candidate under review. Verify the NEP-330 build yourself; do not infer reproducibility from the owner’s results.

## Review materials

Read these files from the review branch:

- `P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-INDEPENDENT-REVIEW.md` — prior E1/E2 findings.
- `P2-USDC-NATIVE-EXCESS-REFUND-FOLLOWUP-REVIEW.md` — current owner handoff and reproduction procedure.
- `tests/sandbox-usdc-callbacks/README.md` — build and local Sandbox instructions.
- `tests/sandbox-usdc-callbacks/run.mjs` — fixture runner and explicit artifact-path/digest guard.
- `tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs` and `test/native-excess-refund-capture.test.mjs` — saved-evidence verifier and mutation suite.
- `tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.json` and its `.sha256` manifest — current native-refund capture.
- `tests/sandbox-usdc-callbacks/bootstrap-activity-guard-sandbox-acceptance-2026-11-17-reproducible.json` and its `.sha256` manifest — related bootstrap guard capture using the same core artifact.
- `audit/p2-native-excess-refund-followup-independent-2026-11-17/` — prior reviewer’s checksum-bound report evidence.

The review package currently has 13 native capture tests (one positive control, twelve mutations). The native verifier checks finalized transaction graphs, receipt/body uniqueness and reachability, terminal statuses, transfer actions, callback events, accounting, and replay behavior. Confirm those claims from the implementation and data, not only from test names or PASS output.

## Additional probes to validate

A local preliminary probe recorded three mutations as `ACCEPTED` in `audit/p2-native-excess-refund-e2-independent-2026-11-17/additional-mutations.log`:

1. `replay-other-recipient`: replay graph includes an LCP-originated transfer to an account other than the expected payer.
2. `payout-executor-mismatch`: payout receipt body and execution outcome disagree about the executor/receiver identity.
3. `failure-callback-failed`: the failed-refund callback receipt itself has a failed execution status.

The supplemental folder is local and contains no reproducible mutation script or command record. Treat these as unverified leads. Reconstruct each mutation independently against the exported validator and determine whether it represents a genuine verifier weakness, an invalid synthetic mutation, or a malformed capture. Do not silently edit the committed capture or its manifest.

## Copy-ready prompt

```text
You are conducting an authorized, defensive review of the Living Commitments Protocol repository’s native excess-refund E2 evidence remediation. The owner requested this review. This is a source-and-evidence assessment only.

Use repository branch codex/p2-native-refund-e2-review. Review package commit is 646f9c082f09f59b829fa2685a5535c939ae0699. The contract artifact’s NEP-330 source revision is 950e3cb50fd79f559f5b6ff725fbfa32db70a063. The target artifact is built with the `sandbox-recovery` variant using cargo-near 0.23.0, Rust 1.100.0, and the SourceScan image pinned in contracts/lcp-core/Cargo.toml. The claimed WASM SHA-256 is 4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad; the claimed NEAR code hash is 6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212.

Review the two prior independent reports, the current review handoff, README, runner, verifier, mutation tests, reproducible capture and 24-row manifest. Verify the manifest and inspect the raw receipt graph. If tooling is available, rebuild the exact source revision in the pinned local Docker image and compare both hashes. If the build cannot be performed, state that limitation and distinguish it from source review.

Scope:
1. Verify that the reproducible build configuration and artifact provenance are coherent. Explain whether the prior 33997e… versus 0f194b… difference is adequately resolved for the current 4cb5… candidate, or remains an evidence gap.
2. Independently evaluate receipt graph integrity: every root and child reference should resolve exactly once to an outcome and raw receipt body; reject disconnected/orphan records, duplicate IDs, missing bodies/outcomes, malformed or missing statuses, and incorrect body/outcome identity bindings.
3. Check the failed excess-refund path: distinguish the failed transfer from system refunds; verify the LCP callback that records the payer credit itself succeeded and is bound to the correct receipt/executor; confirm exact amount and accounting.
4. Check the underfunded withdrawal and successful withdrawal paths: an underfunded request must not produce any LCP-originated payout to any recipient. A successful payout body must bind to the matching outcome, executor/receiver, direct success status, expected recipient, and exact amount. Every receipt in a successful withdrawal graph must have a valid successful status.
5. Check replay exclusion: after settlement, the graph must contain no LCP-originated transfer of any amount to any recipient, no second settlement event, and no reopened credit. Include one-yocto and alternate-recipient cases.
6. Independently recreate the three preliminary mutations listed in the handoff: replay transfer to another recipient; payout body/outcome executor mismatch; failed failure-callback outcome. Decide whether each is a true verifier defect, a malformed mutation, or a false positive. Add other minimal mutations if needed to establish the boundary.
7. Review whether the 13-test suite covers the material cases. Identify any remaining gaps with exact file/line references and minimal local test cases.

Keep contract findings separate from evidence-checker findings. Do not access `.env*` files or credentials, contact NEAR RPC/testnet/mainnet, submit transactions, deploy code, or alter tracked sources, expected captures, or checksum manifests. Local read-only analysis and local builds/tests are permitted. If your environment’s safety policy blocks this defensive task, stop and report the limitation; do not attempt to bypass that policy.

Return:
- A verdict on E2 evidence acceptance, with each prior finding marked closed/open/partially closed.
- The exact checked-out commits and independently built WASM/code hashes, or a clear note that rebuild was not performed.
- Manifest and receipt-graph results, including counts and status/body identity checks.
- Results for each named mutation, whether it is valid, and a minimal reproduction description.
- Any new findings with severity, impact, source locations, and a focused remediation suggestion.
- Commands/checks run, deviations, and checksummed paths for any new evidence. Do not claim contract-runtime acceptance from checker-only mutations.
```

## Prior independent report provenance

The prior report identified E1 as closed and E2 as partially open. Its supplied evidence checksum manifest is at `audit/p2-native-excess-refund-followup-independent-2026-11-17/evidence.sha256` and currently verifies. The current owner remediation has not yet received independent follow-up acceptance.
