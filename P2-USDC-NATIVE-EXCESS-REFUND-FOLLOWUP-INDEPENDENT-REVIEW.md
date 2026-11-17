# Native excess-refund independent follow-up review

## Verdict

Qualified local behavioral acceptance; follow-up evidence acceptance is withheld. E1 is closed for both supplied and independently executed captures. E2 is partially remediated and remains open: the pinned artifact cannot be reproduced from the specified candidate, and additional checker mutations are accepted. No contract fix, expected-capture alteration, or release approval is provided.

## Independence and revision

Reviewed exact clean source `785a51bb1338154163211e20f76d510f0a1434f1` in the dedicated checkout. Fresh conversational session `020e39e6-1805-4d0e-9582-22b301460edc`, task `task_5c36ff4a1dfe`, dispatch `ctx_c34dac28f180`; Orca live worker projection reports provider codex/model `gpt-6.1-sol` (identity.json). This is runtime orchestration identity evidence, not independent attestation of the remote model server. No coordinator review findings or previous reviewer runtime were used; historical E1/E2 were read as explicitly requested. No helper agents were used.

Read-only `git fetch origin main` succeeded; `git merge-base --is-ancestor HEAD origin/main` returned 0. origin/main and original-root HEAD were `7ddab2a3c30a28d5c1f71da9bd0ddbf16f3d63b7`. The historical handoff pins `6b32824a5be6156fe1afa696a76991c696a00309`; the original-root handoff pins the requested `785a51b…`. Their only textual difference is this pin. The current main commit also updates that handoff's checksum manifest row; there are no implementation changes between reviewed source and current main. Both briefs incorrectly say 23 rows: there are **24 actual rows**, all verified against the historical checkout before building. Original user file `untitled.md` was left untouched.

## Supplied evidence

The November 17 capture, runner, verifier, mutation tests and historical report were read. Checksum verification passed all 24 rows; supplied checker passed; test runner passed all seven tests (one positive control and six negative mutations). Changed artifact, removed failure event, duplicate/missing payout, altered amount and missing child are rejected. Separate graph traversal confirms all referenced IDs resolve once to outcomes and raw bodies and all outcomes are reachable from transaction roots, with terminal statuses and no Unknown or orphan bodies. Receipt counts are 7 failed refund, 2 underfunded, 6 successful withdrawal and 2 replay. Supplied graph records and raw capture remain unchanged.

## Independently executed evidence

Used locked README builds with pinned Rust 1.100.0 (`0ef1bc386`, 2026-11-09), preinstalled cargo-near 0.23.0, and cargo-near's wasm-opt post-step. Both mock variants independently match the supplied artifacts. An initial default fixture build was also run before the required recovery-feature build; only the recovery-feature artifact was deployed. A sequential repeat of the recovery build produced the same actual hash, confirming the mismatch independently of build-directory contention. Build logs preserve commands/tool diagnostics; commands.md records invocations.

Actual core SHA-256: `0f194b5306379eed784235b3177cabc2f9ca31f89669223961f3926d8a714963`; code hash `21wVBHeifP1dEmASeZgxurf554cwyPVyvfDK6QecDQjt`; 1,161,655 bytes. Expected: `33997ebb2f48d2ebb82db46d6f6625476ac963f71b71257aaee288c1a5671872` / `4URYaJBxtUGhYbafSHMRkVyGcHcY8Zs1uwugpRM1p76Z`. The cause is unresolved; this review does not silently substitute a historical binary.

Mock A SHA-256 `c8669f67957668888767cebb360d34c096e0654684e489377b634ab11c898619`, code hash `EVHJNjrSMLAbCFmTCtQwbqKdXzmf48HgDwioHo2GAkME`; mock B SHA-256 `56c46e717bf7b12e41ea848b14a6b58e5c73e2c979c2f4a38cb6910561b7e489`, code hash `6qhneJTJNrGbxyrp2ZHspsCa8GqX7jD6ZZDRw1jpMQ9n`.

New container `lcp-followup-020e39`, isolated data/binary directory `/tmp/lcp-followup-020e39`, output `fresh-capture.json`; no previous runtime/cache was reused. Node v26.13.1 on linux/amd64, Docker server 29.9.3, image `node:26-trixie-slim`, digest `node@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc`. Binary SHA-256 `797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13`. Sandbox 2.14.0, protocol 88, nearcore commit `bc4e9e8cfb03d9e82f027883055624e18576993e`, node rustc 1.95.0. The container exited and was removed by --rm after the runner stopped its owned Sandbox; no unrelated process was stopped. Synthetic keys/data are not delivered.

Fresh chain `test-chain-vrdts`, genesis `9v3TwatwoqWPkUHeJWnX6uc6B2aJTJQrn6NYsgs12u8w`. All four runner call sites invoke `finalTransactionStatus`, which requests `EXPERIMENTAL_tx_status` with `wait_until: FINAL`, then obtains supplemental raw bodies through `EXPERIMENTAL_receipt`. All four captured final statuses are FINAL. Raw finalized node responses are captured by the runner; this review inspected their receipt actions and outcome logs, not only PASS labels. No HTTP wire trace was added.

| Scenario | Transaction hash | Receipts |
| --- | --- | --- |
| failure | `xkTrWRJCLBVtt5W2dN8EH8trtjx3iukDYNV4izUhh5D` | 7 |
| underfunded_withdrawal | `GYsxWjdgUe7trUU2JArV6fyEF9Y1txYpXiG2Jr6xNR4Z` | 2 |
| withdrawal | `5CXESnV8hqqULiPM4JwBiArWPtvoCwCfHCZpKkxmCA7u` | 6 |
| replay | `DrY2iX7cRRweAztBkwYhHdBxxsXaVCBgvkAheXnv2NoC` | 2 |

Receipt IDs, edges, roots, statuses, action recipients/deposits and callback logs for every transaction are enumerated in fresh-graph.json and supplied-graph.json. Independent traversal asserts exact outcome/body uniqueness, reachability and terminal status for every reference. Comparison of semantic graphs (recipients, predecessors, actions, callback arguments/events, status kinds and child counts) matches all four supplied graphs, allowing IDs, balances and system gas refund amounts to differ.

The failed LCP transfer sends exactly 10000000000000000000000 yoctoNEAR to missing-excess-refund.sandbox and fails AccountDoesNotExist. A system receipt returns that amount to core; the successful production on_storage_refund_attempt callback logs excess_storage_refund_failed for recipient.sandbox and restores the full credit. The 0.01 NEAR free-margin withdrawal fails the cash solvency gate and preserves the complete cash snapshot. Measured S growth is 260000000000000000000 yoctoNEAR (26 bytes at 10^19 yoctoNEAR/byte); the next target/free margin is exactly 10260000000000000000000 yoctoNEAR. The successful withdrawal has one LCP-to-payer Transfer of 10000000000000000000000, a SuccessValue outcome, and successful on_storage_refund_attempt callback with service_report_refund_sent, attempt 2. System-predecessor gas refunds are distinct from this LCP payout. Replay fails with no storage refund credit is available, with no contract transfer and no second requested event.

Payer before 29988936484179395200000000; after 29998182498897608700000000; transaction-plus-receipt fees 753985281786500000000 yoctoNEAR. Exact equality: after + fees = before + 10000000000000000000000. Final and post-replay payer credit are zero.

Final cash vector (C,S,escrow,legacy refund,X,operations,recovery credit,F,shortfall):

```text
['30990313848374256100000000', '11644510000000000000000000', '0', '0', '0', '0', '18356083848374256100000000', '978440000000000000000000', '0']
```

Refund liabilities, X and shortfall are zero. The artificial recovery-credit fixture liability remains intentionally nonzero and is covered; this is not a claim that all liabilities vanish. Final C minus S and all liabilities is 11280000000000000000000 yoctoNEAR, so cash is solvent.

The official checker was invoked through its supported explicit capture/manifest arguments and fails at its pinned artifact assertion (fresh-checker.log). For path bookkeeping it was invoked from the original-root verifier, whose implementation matches the candidate; fresh-source.sha256 retains all 24 source rows from current original-root manifest except replacing the selected capture row with the fresh capture path/hash. Thus it reflects the original-root handoff's updated pin, not the historical handoff. Independent checksum verification passes all 24 rows; the artifact rejection occurs before manifest validation. Neither original manifest nor expected source hashes were overwritten.

## New findings

**F1 — Medium, candidate-to-artifact evidence mismatch.** Locked recovery-feature build produces a different binary/hash from the mandatory pin. Both mock hashes match. The fresh local behavior passes, but it is not a reproduction of the pinned core. Reconcile the artifact's source/tool provenance in a later owner task before claiming pinned-candidate acceptance.

**F2 — Low, checker admits unsupported success and graph claims.** Supplemental mutations accepted: a disconnected matched outcome/body pair, a failed status on the actual payout receipt, empty statuses on withdrawal receipts, and a one-yocto contract payout during replay. Closure checks only ensure referenced children exist, not that all nodes are root reachable; success checks use absence of Failure in selected summaries and do not bind successful payout actions to outcomes; replay exclusion only filters the exact expected amount. These are checker weaknesses, not observed runtime payout bugs. Independently traversed supplied/fresh captures do not exhibit them. Add reachability, explicit terminal-success and all-amount payout restrictions in a later owner task. Supplemental script/log is preserved; mutation runs call the exported validator, as the supplied tests do, and intentionally do not regenerate source manifests.

**F3 — Informational, documentation count.** Both briefs state 23 rows; actual count is 24. Reported accurately here.

## Closure and limits

E1 closed: complete finalized reachable receipt graphs, raw bodies including system refunds, verified on both saved and fresh records. E2 partially closed: artifact pin, exact storage measurement, explicit interface, callback/action/credit checks, mutation coverage and actual replay exist; artifact reproduction fails and F2 remains. Narrow behavior acceptance applies to this isolated Sandbox run of the independently built binary; overall requested evidence follow-up cannot be accepted unconditionally. No observed contract-accounting failure; no implementation modification. No cryptographic receipt inclusion proof, issuer/Circle assessment, public-network test, deployment/mainnet approval or bootstrap acceptance expansion was performed. Review reconciliation/fixes remain the owner's later task.
