# Native Excess-Refund E2 Acceptance Review

Date: 2026-11-17. Local source-and-evidence review of the native excess-storage-refund
E2 remediation on branch `codex/p2-native-refund-e2-review`.

## Independence statement (read first)

This pass was performed by the same assistant session that authored the remediation
commits `6329aaf`, `78f4f5c`, and `2f3ba1c`. It is therefore **owner-adjacent
verification, not third-party independent review**. Every check below is reproducible
from the pinned commits and the sealed evidence folder, so an external reviewer can
re-derive all of it; until that happens, treat this as a hardened self-check rather
than independent acceptance.

Environment: local worktrees only. Docker 29.9.3, cargo-near 0.23.0, Rust 1.100.0,
pinned image `sourcescan/cargo-near:0.23.0-rust-1.100.0@sha256:265b662a…49f1`. No NEAR
RPC, testnet, mainnet, deployment, credential, or `.env` access.

## Verdict

| Item | Status |
| --- | --- |
| E1 — closed finalized receipt graphs, raw bodies, system refunds | **Closed** (re-confirmed) |
| E2 — artifact provenance (`4cb5c001…` / `6ASj694…`) | **Closed** — independently rebuilt and matched |
| E2 — checker mutation gaps reported at `96d27c1` | **Closed** — all three leads now rejected |
| E2 — checker mutation coverage overall | **Partially closed** — four further mutations are still accepted (F4–F7) |
| Contract runtime behaviour | Unchanged; prior narrow protocol-88 Sandbox acceptance still stands |
| Release / canary / deployment | **Not approved** |

E2 is narrower than before but not closed: the four remaining gaps are the same
"exclusivity" class as the three reported leads, so evidence acceptance cannot be
signed off on this commit.

## Artifact provenance

Two clean builds, each in its own detached worktree, using the variant and image
pinned in `contracts/lcp-core/Cargo.toml`:

| Source commit | WASM SHA-256 | NEAR code hash |
| --- | --- | --- |
| `950e3cb50fd79f559f5b6ff725fbfa32db70a063` | `4cb5c001110a83cc4f360b67fab25ea5332fb00394ce446f72e4593e3b269cad` | `6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212` |
| `2f3ba1c8855c17fd68ee16f35b47f8a1a3bfc3aa` (twice) | `e798e30351c64c66c856135f3c68e6158ff1b0d3d982ccdebbcbaa20b4d3af5f` | `Gb4PjkAxEr915uMybRi3UJikcwoxsKtmE6Sw7U5JwSmc` |

The pinned candidate reproduces exactly at `950e3cb`. NEP-330 embeds the source
revision in the artifact, so a build at any other commit must differ; two independent
clean builds at `2f3ba1c` produced the same `e798e303…`, which shows the pipeline is
deterministic per revision rather than nondeterministic. This also explains the earlier
`0f194b…` and `33997e…` history: different source revisions and build variants, not
build flakiness. All builds are 1,172,839 bytes.

Consequence for the handoff: the candidate hash is only meaningful together with
`950e3cb`, and any `contracts/` change requires a new pin.

## Manifest and receipt-graph results

`native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256`
verifies **24/24** rows in a clean checkout of `2f3ba1c`. Outside a clean checkout it
reads 23/24 because the owner working tree currently holds unrelated in-flight
`TODO.md` edits (see F3).

Independent graph recomputation from raw capture JSON (no owner helper code):

| Graph | Receipts | Roots | Contract transfers | Events | Final / tx status |
| --- | --- | --- | --- | --- | --- |
| failed excess refund | 7 | 1 | 1 (to forced missing account, exact `10^22`) | `excess_storage_refund_failed` | FINAL / SuccessReceiptId |
| underfunded withdrawal | 2 | 1 | 0 | none | FINAL / SuccessReceiptId |
| successful withdrawal | 6 | 1 | 1 (to payer, exact `10^22`) | requested + sent | FINAL / SuccessReceiptId |
| replayed withdrawal | 2 | 1 | 0 | none | FINAL / Failure |

All four graphs are closed and reachable, with unique outcome and body IDs, matching
body/outcome ID sets, no orphans, one terminal status per receipt, and body
`receiver_id` bound to outcome `executor_id`. Accounting re-derived independently:
failed refund keeps a `10^22` liability with zero scheduled outflow and zero shortfall;
underfunded withdrawal leaves the cash snapshot byte-identical and rejects at
`C=… S=… X=10^22`; measured storage growth is exactly `260000000000000000000` and the
retry margin is exactly amount + growth; withdrawal fees equal transaction plus receipt
gas, payer balance plus fees equals prior balance plus the credit, and final cash covers
all liabilities plus storage.

## Mutation results

Every mutation below is well formed — root reachability, unique IDs, and body/outcome
sets remain consistent — so acceptance means the semantic rule is genuinely absent.

| Mutation | At `96d27c1` | At `2f3ba1c` | Classification |
| --- | --- | --- | --- |
| replay transfer to another recipient | ACCEPTED | REJECTED | genuine checker gap, now closed |
| payout body/outcome executor mismatch | ACCEPTED | REJECTED | genuine checker gap, now closed |
| failed failure-callback receipt status | ACCEPTED | REJECTED | genuine checker gap, now closed |
| extra contract transfer in withdrawal graph (1 yocto, third party) | — | **ACCEPTED** | new gap F4 |
| extra contract transfer in failed-refund graph (third party) | — | **ACCEPTED** | new gap F5 |
| duplicate settlement event in withdrawal graph | — | **ACCEPTED** | new gap F6 |
| settlement event in replay graph (no transfer) | — | **ACCEPTED** | new gap F7 |

The three reported leads are closed by `6329aaf`; the four new ones are not.

## New findings

**F4 — successful withdrawal is not exclusive to the payer transfer.** Severity: Low.
`verify-native-excess-refund-capture.mjs:257-267` filters contract transfers to
`receiver_id === scenario.payer` and asserts that list equals the credit amount, so an
additional LCP-originated transfer to any third party passes. Impact: a capture that
pays a third party during settlement still validates as "exactly one payer transfer".
Remediation: assert that all contract-originated transfers in the withdrawal graph are
exactly the single payer payout.

**F5 — failed-refund graph is not exclusive to the forced transfer.** Severity: Low.
Lines 215-221 assert the forced missing-account transfer is present with the exact
amount but never bound the total number of contract transfers. Impact: a capture in
which LCP also pays a third party while the refund fails validates unchanged.
Remediation: require exactly one contract-originated transfer in the failure graph.

**F6 — settlement event multiplicity is unverified.** Severity: Low. Line 252 uses
`findEvent`, which returns the first match, and no count is asserted. Impact: duplicated
`service_report_refund_sent` events validate. Remediation: assert exactly one settlement
event in the withdrawal graph.

**F7 — replay may claim settlement.** Severity: Medium. Lines 285-287 only reject a
`service_report_refund_requested` event in the replay graph. Impact: a replayed
transaction carrying a `service_report_refund_sent` event with no transfer validates,
which contradicts the handoff claim of "no second settlement event". Remediation: reject
any settlement event in the replay graph.

**F3 (carried) — the manifest pins mutable tooling and documents.** Severity: Low.
The 24-row manifest pins `TODO.md`, the checker, its tests, and the README next to the
evidence and contract sources, so checker or planning-document edits invalidate it. The
refresh in `78f4f5c` changed exactly three rows and left the capture and all 17
contract-source rows byte-identical, which keeps evidence integrity, but any `TODO.md`
edit repeats the problem. Remediation: keep the capture manifest to evidence plus
contract sources and hold tooling hashes in a separate `tooling.sha256`.

## Limits

No cryptographic receipt inclusion proof, no Circle/issuer assessment, no public-network
test, no deployment or canary approval. Behavioral acceptance remains limited to the
earlier isolated protocol-88 Sandbox run of the independently rebuilt `950e3cb` binary.
This review does not authorize any gate beyond E2 evidence closure.

## Evidence

`audit/p2-native-excess-refund-e2-independent-acceptance-2026-11-17/` (`evidence.sha256`,
6 files): `reviewer-probe.mjs` and `reviewer-probe.log` (independent recomputation and
mutant verdicts), `build-950e3cb.log`, `build-2f3ba1c.log`,
`build-working-tree-2f3ba1c-dirty.log` (the revision-bound comparison), and `commands.md`.
Owner-side checksum-bound E2 folder: `audit/p2-native-excess-refund-e2-independent-2026-11-17/`
(12 files, sealed).

## Recommended next steps

1. Owner fixes F4–F7 as one checker commit with four mutation tests (17 → 21) and a
   manifest refresh; F3 can ride along or follow separately.
2. Re-run this probe; expected end state is 21/21 tests, 24/24 manifest, and zero
   accepted mutants.
3. Hand the branch to a genuinely external reviewer for the acceptance signature, since
   this pass shares authorship with the change under review.
