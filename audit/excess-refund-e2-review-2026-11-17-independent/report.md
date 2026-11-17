# Independent review — native excess-refund E2 checker remediation (exclusivity gaps)

- **Review base:** `2f3ba1c8855c17fd68ee16f35b47f8a1a3bfc3aa` (`docs: record the apply-and-verify result for the E2 checker remediation`)
- **Review candidate:** `9027052fa3f2744c309171a2a7d0b8ec8cebb127` (`test: close native refund receipt exclusivity gaps`)
- **Branch tip (excluded):** `7c04c29b772788d714575f7b95728fbe378ded36` — later, unrelated Console change; kept out of scope.
- **Scope:** the checker and the saved protocol-88 Sandbox evidence only. Result: **approve for the next specified gate** (see *Next gate*).
- **Nothing was modified, committed, pushed, deployed, or transacted.** Working tree has zero tracked-file modifications (`git status --porcelain | grep -vc '^??'` = 0). The report, probe scripts, and logs below are untracked files under `audit/excess-refund-e2-review-2026-11-17-independent/`.

## Environment

- Node `v26.5.0`, git `2.50.1` (Apple Git-155), `shasum` 6.02 (macOS / coreutils-compatible `-c`).
- Reviewed at a detached checkout of the exact candidate commit `9027052…` after `git fetch origin`.

## Commands run (all from repository root)

| Command | Result |
|---|---|
| `node --test tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs` | exit 0, **21/21 pass** |
| `node tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs` | exit 0, `PASS … 14 source hashes …` |
| `shasum -a 256 -c tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256` | exit 0, 14/14 OK |
| `shasum -a 256 -c tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.tooling.sha256` | exit 0, 6/6 OK |

Byte-for-byte regeneration of both manifests from the README commands produced identical files (empty diffs — logs 09, 10).

## Contract source between base and candidate

**Unchanged.** `git diff --name-only 2f3ba1c… 9027052…` touches only the five scoped paths; the `contracts/` tree object is identical (`f5bf1c447d4e8fe60deebda94c9648bdd982242e` on both commits). The checker still pins the same NEP-330 WASM (SHA-256 `4cb5c001…b269cad`) and NEAR code hash (`6ASj694x4mbtLfdzv5tMXC1HqDMB8QWmn8fc1hp12212`), and the capture/source manifest still pins the same `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, and `contracts/lcp-core` + `contracts/sandbox-mock-ft` sources. The evidence JSON itself is byte-identical to base. The remediation is checker-side only.

## Finding disposition (F4–F7, marked closed/open/new)

All four gaps were **confirmed open at base** (the base checker extracted to scratch *accepted* all four mutations — log 07) and are **closed at candidate**. Verifier line refs below are to `tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs` at `9027052…`.

### F4 — extra LCP-originated transfer to a third party in the successful-withdrawal graph — **CLOSED**
- Old rule filtered for `predecessor_id === lcp-core … && receiver_id === payer` and only compared amounts, so an extra transfer to any *other* recipient was invisible.
- New rule (`verify-native-excess-refund-capture.mjs:267-272`): all transfers whose predecessor is `lcp-core-sandbox.sandbox` are enumerated via `nativeTransfers` and `assert.deepEqual` to exactly one entry `{receiver_id: scenario.payer, amount_yocto: amount}`.
- Independent probe: third-party transfer (with canonical payer transfer intact) → `REJECTED` at line 269, message `successful withdrawal must contain exactly one payer transfer and no other contract-originated transfers`; graph-structure stage (`assertFinalReceiptGraph`, L165) passed first.
- Tests: `native-excess-refund-capture.test.mjs:222-229` (new).

### F5 — extra LCP-originated transfer to a third party in the failed-refund graph — **CLOSED**
- New rule (`verify-native-excess-refund-capture.mjs:221-226`): all predecessor-`lcp-core` transfers in `failure_receipts` must be exactly one `{receiver_id: "missing-excess-refund.sandbox", amount_yocto: amount}`.
- Independent probe: third-party transfer → `REJECTED` at line 223, message `failed refund must contain exactly one contract-originated transfer to the forced missing account`; failure-graph structure (L160) passed first.
- Test: `native-excess-refund-capture.test.mjs:230-237` (new).

### F6 — duplicate `service_report_refund_sent` in the successful withdrawal — **CLOSED**
- New rule (`verify-native-excess-refund-capture.mjs:259-261`): `findEvents(…, "service_report_refund_sent")` must have **length exactly 1** — all matches are counted, not the first one.
- Independent probe: settlement log appended to a second withdrawal receipt (both on unrelated and on the payer-transfer receipt) → `REJECTED` at line 260 (`2 !== 1`).
- Test: `native-excess-refund-capture.test.mjs:238-251` (new).

### F7 — `service_report_refund_sent` in the replay graph with no transfer — **CLOSED**
- New rule (`verify-native-excess-refund-capture.mjs:298-299`): `findEvents(replay_receipts_outcome, "service_report_refund_sent").length === 0`; the paired `service_report_refund_requested` check (L296-297) was converted from a raw substring scan to the same exact-event counter.
- Independent probe: settlement log appended to a replay-contract receipt with **no transfer added** → `REJECTED` at line 298 (`1 !== 0`) after all earlier assertions passed; the same log appended to a non-contract replay receipt also rejected (graph-wide).
- Test: `native-excess-refund-capture.test.mjs:252-270` (new).

## Exclusivity-integrity check (scope item 3) — verified

- Transfer exclusivity filters on **predecessor only**, never on expected recipient, so an extra transfer to the *expected* recipient on a separate receipt is also rejected (probe E1: two payer transfers → rejected at L269). Duplicate Transfer actions on the same receipt are also counted per action and rejected (existing test `rejects a duplicate successful payout action`).
- Settlement exclusivity counts **all** matching events graph-wide via `findEvents` (L47-56) and requires exactly 1 in withdrawal / 0 in replay; it does not take the first match (probes E3, E4).
- Reachability, unique outcome/body IDs, receiver↔executor binding, and terminal-status recognition remain enforced unchanged in `assertFinalReceiptGraph` (L98-153), and each F-mutation was shown to fail *at the semantic assertion*, after that stage passed — no mutation fails for an unrelated graph-structure error.
- No vacuous assertions found: every one of the 21 tests mutates a concrete field/receipt and fails on a message unique to the intended rule (regexes in `assert.throws` match only the intended assertion strings).

## Manifest split (scope item 4) — verified; residual note below

- **Capture/source manifest** (`…reproducible.sha256`, 14 entries): the evidence capture plus contract/build inputs (`Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, 8 `contracts/lcp-core` files, 2 `sandbox-mock-ft` files). `verifyManifest` (L305-337) enforces in-repo paths, non-empty set, and that the capture itself is pinned (`capturePinned`, L336); an escaping path, a malformed row, an unpinned capture, or a single-byte tamper are all rejected (probe-manifest; tampered-capture log shows `does not match its captured digest`).
- **Tooling manifest** (`…reproducible.tooling.sha256`, 6 entries): `run.mjs`, `README.md`, verifier, tests, `package.json`, `package-lock.json` — exactly the set documented in the README regeneration block (README L555-585), and both manifests regenerate byte-identically from those documented commands (logs 09/10). The README’s description (“pins only the evidence capture and the contract/build inputs … Verifier, tests, runner, package metadata, and README hashes live in a separate tooling manifest”) matches the committed contents.
- **Residual / informational (not a blocker):** the base manifest also pinned `TODO.md` and the three `P2-USDC-…` design/policy docs; the candidate drops them from both manifests without the README mentioning it. They are not tooling nor fixture inputs, so the split itself is sound; consider an explicit README sentence noting they are unpinned (or listing them in the tooling manifest for continuity).
- **Informational limitation:** the `excess_storage_refund_failed` callback event is still located with `findEvent` (first match), so a *duplicate* failure-callback event would not be flagged. This is outside the F4–F7 remediation scope (which concerns transfer and `service_report_refund_sent` exclusivity) and is pre-existing; flagging for completeness.

## Reviewed paths (exact diff set)

`tests/sandbox-usdc-callbacks/README.md`, `tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs`, `tests/sandbox-usdc-callbacks/test/native-excess-refund-capture.test.mjs`, `tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.sha256`, `tests/sandbox-usdc-callbacks/native-excess-refund-cash-gate-sandbox-acceptance-2026-11-17-reproducible.tooling.sha256` (new). No other files differ between base and candidate.

## New findings

None beyond the informational notes above (none block the gate).

## Limitations of this review

- Validates saved Sandbox RPC records and manifest/checksum consistency; does not validate cryptographic receipt inclusion proofs against block headers, rerun the Sandbox, recompile the contract, or act as a testnet canary.
- The four mutations were exercised against the checker logic; no transaction was broadcast and no deployment was performed.

## Next gate

Proceed to the next specified gate for this remediation (testnet canary / deployment approval is a separate decision owned outside this review). Suggested next step: add the one-line README note about the unpinned root design docs, or fold them into the tooling manifest.

## Evidence bundle

See `evidence.sha256` in this directory (covers `report.md`, `probe.mjs`, `probe-manifest.mjs`, `probe-base-gaps.mjs`, and the `logs/` directory). The scratch subdirectory (`verify-base.mjs` and modified capture copies) is probe input/output, excluded from the bundle hash because the tampered copies mutate during probes; the deterministic probe outputs are the logs, which are covered.
