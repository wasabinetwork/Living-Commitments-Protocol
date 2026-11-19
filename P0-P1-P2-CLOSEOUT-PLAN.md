# P0, P1, and P2 closeout plan

This document turns the open checklist items in `TODO.md` into an ordered,
verifiable closing plan. It is a planning artifact, not a specification change:
`Living_Commitments_Protocol_[LCP]-PRD.md`, the technical specification, and
`P2-USDC-RECEIPT-RECOVERY-DESIGN.md` remain the sources of truth for behavior.

Scope rule: an item is closed only when `TODO.md` points at an artifact that
proves it (test name, capture directory, or recorded manual acceptance). Do not
close items by re-describing them.

## Status snapshot

| Priority | State | Remaining work |
| --- | --- | --- |
| P0 | Complete: all five public-readiness checklist items are `[x]` and the retest is recorded | Regression gate only |
| P1 | Firefox/WCAG preview acceptance, deadline clarity, broader page-state audit, and owner-confirmed Safari keyboard, VoiceOver, and connected-wallet preview pass are recorded; dark heading ink is stable before first paint; the empty on-chain list is verified locally at 320 px in both themes | None recorded for the P1 Console acceptance items; mainnet gates remain deferred |
| P2 | Design and review gates pass; evidence gates remain | Four workstreams plus committee readiness and a canary gate |

Two constraints shape the order:

- The recovery accounting (`native_cash`, `receipt_recovery`,
  `recovery_accounting`, and the recovery entry points in `contract.rs`) is
  gated behind `usdc-receipt-recovery`. Default builds keep today's behavior, so
  P1 and P0 are not blocked by P2.
- Recovery is disabled in deployed testnet and production artifacts. It stays
  disabled until Workstreams A through D pass and the owner approves a canary.

## Phase 0: P0 regression gate

P0 needs no new engineering. It needs a repeatable gate so a later change cannot
silently re-open it.

| ID | Task | Exit criteria |
| --- | --- | --- |
| P0-1 | Record a clean baseline at the starting revision | All commands below pass; revision and test counts recorded in `TESTING.md` |
| P0-2 | Re-run the affected subset after each phase lands | No regression in contract, SDK, or Console checks |

Baseline commands, in this order:

```bash
cargo test --workspace --locked
cargo near check --locked --manifest-path contracts/lcp-core/Cargo.toml
cargo near check --locked --manifest-path contracts/bounded-payout-adapter/Cargo.toml
node --test tests/receipt-mapping/decide.test.mjs
npm run check --workspace=@lcp/event-indexer
npm run check --workspace=@lcp/reviewer-access
npm run build --workspace=@lcp/console
```

Record the recovery-feature suites as well, because later P2 work depends on
them. The documented counts after the 2026-11-19 rotation tests are 111 default,
148 with `usdc-receipt-recovery`, and 148 with
`sandbox-callback-fixture,usdc-receipt-recovery`; treat them as a baseline to
compare against, not as fixed numbers.

```bash
cargo test -p lcp-core --locked
cargo test -p lcp-core --locked --features usdc-receipt-recovery
cargo test -p lcp-core --locked --features 'sandbox-callback-fixture usdc-receipt-recovery'
```

## Phase 1: close P1

P1 has one technical acceptance item and one dependent manual acceptance. The
remaining P1-section checkboxes are mainnet gates that the docs deliberately
defer; reclassify them rather than attempting them now.

### P1-1: Preview Firefox and WCAG 2.1 acceptance

Run the matrix from `CONSOLE-GUIDE.md` against the deployed preview origin, not
localhost. The local 2026-11-17 checks already covered 320 CSS px, 200% zoom,
text-spacing overrides, and the contrast fix (2.19:1 to 8.10:1); preview
acceptance must confirm the same behavior with deployed data.

Status: on 2026-11-18 the preview was redeployed from `HEAD` `46b1161`
(Pages deployment `627c63b9`) and now serves that revision. An automated pass
(Chromium, 1280/320 CSS px and approximated 200% zoom) found the skip link
activating `#explorer-title`, no horizontal or text-spacing overflow, visible
focus rings, one `main` landmark, nine live regions, and no light-theme contrast
failure. A Firefox 160 pass through geckodriver covered 1280 px, a 500 px
minimum window, 640 px at DPR 2, and dark theme with no overflow, correct skip
activation, focus rings on ten stops, and an 8.10:1 dark minimum. The earlier
1.91:1 dark reading was a closed-`<details>` transition artifact, not a defect.
A real Safari window driven through Orca Computer Use exposed the named skip
link, headings, labeled field, and controls in the macOS accessibility tree, and
rendered dark mode correctly. The owner manually confirmed VoiceOver speech on
2026-11-17. On 2026-11-18 the owner reported Safari keyboard tab traversal in
a real window as working correctly, reconfirmed VoiceOver as working (last
exercised ~24 hours earlier; no Console UI code changes in this pass), and
completed a connected-wallet preview pass on
`https://preview.lcp-preview.pages.dev` (results below). The broader page
states are audited below. Use Orca's internal browser for later UI/UX passes.

On 2026-11-18 a live state pass in Orca's internal Chromium browser against
`https://preview.lcp-preview.pages.dev` (revision `46b1161`) covered: the default
page with no commitment selected, the populated recent list (43 commitments,
10 per page with "Load older commitments"), closed/refunded `#38` (journey
`Setup Closed` → `Evidence Accepted · Compliant` → `Review TimedOut` →
`Payout Closed`), and breached `#37` (`Commitment breached`, challenge form and
close control correctly disabled without a wallet). The degraded-indexer path
was live: the preview indexer reported `catching_up` with `lag_blocks`
1,152,788, and the Console omitted the optional indexed-history section while
contract-backed health, policy, evidence, and settlement rendered normally.
The pre-fixture RPC scan of commitments 1–43 found no `pending_evaluation_id`
and no `active_challenge_id`. Commitments `44` and `45` supply the open
challenge state and passed the P1-2 check, including the deadline transition.
Commitments `47`/`48` supply the USDC registration shortfall with an
unregistered, claim-eligible beneficiary; commitment `48` is the one inspected
in the Console. Commitment `52` supplies the pending-evaluation state through a
deliberately delayed evaluator fetch. The shared testnet contract cannot supply a truly empty
on-chain list because its existing commitments are permanent. That state was
verified on 2026-11-18 against a fresh local deployment: NEAR Sandbox 2.14.0
(Linux x86_64 under Docker on the x86_64 macOS host), chain
`test-chain-FbIun`, the current `lcp_core.wasm` (SHA-256
`0f194b5306379eed784235b3177cabc2f9ca31f89669223961f3926d8a714963`)
deployed to `test.near` (`6zC5KsD6aLfzXFMo4f4PwEZ4Rq9wikkhD5z71Eo8mmu9`) and
initialized with `new` (`FMb4DQ6KBBETWK9ZnzTjA1dfwsT6rFg39Mu1Cg3NEiHM`). The
deployed code hash matched the local artifact at block 350, and
`list_commitments` returned `[]` at block 351. A local production build pointed
at that RPC made one live `list_commitments` call on “Browse recent
commitments”, decoded `[]`, and rendered “No commitments found yet.” with zero
items. The Console predicates for pending, challenge, and shortfall are covered
by `apps/console/lib/commitment-flags.test.mjs`. The theme bootstrap
is now a raw inline `<head>` script, so the dark heading rule at
`apps/console/app/globals.css:596` no longer flips after first paint.

The empty state now has a reusable local path:
`scripts/empty-console-fixture.mjs`, exposed as
`npm run fixture:empty-console`. On 2026-11-18 it started a second fresh
Docker-backed NEAR Sandbox (chain `test-chain-uI3Gb`, protocol 88), deployed
the same `lcp_core.wasm` to `test.near`, initialized it, asserted
`list_commitments` returned `[]` at block 7, and served the Console at
`http://localhost:3000`. The Console was checked in headless Chromium at
320 CSS px and DPR 2 in both themes. The empty panel was 288 px wide, the page
had no horizontal overflow (`scrollWidth === clientWidth === 320`), the list
contained zero items, and “No commitments found yet.” rendered at 8.37:1 in
light mode and 9.71:1 in dark mode. No runtime exception was recorded. The same
fixture rendered the invalid-ID error state as a 288 px `role="alert"` notice
(“Commitment 999999999 was not found on test.near.”) at 6.21:1 in light mode
and 6.87:1 in dark mode, with no overflow. This run used the development server
rather than a production export; the earlier `test-chain-FbIun` run remains the
production-build check.

#### Manual state audit

| State | Evidence | Audit result |
| --- | --- | --- |
| Default, no commitment selected | 2026-11-18 preview pass; local fixture replays the no-selection state | Covered |
| Populated recent list | 2026-11-18 preview pass: 43 commitments, 10 per page, “Load older commitments” | Covered |
| Empty on-chain list | `test-chain-FbIun` production build plus `test-chain-uI3Gb` fixture; 320 px light/dark check above | Covered |
| Degraded indexer | 2026-11-18 preview: `catching_up`, 1,152,788-block lag, archive omitted while contract reads rendered | Covered |
| Pending evaluation | Commitment `52`, delayed evaluator fetch, pending copy and evaluation ID shown | Covered; state later evolved in the 2026-11-18 wallet pass (recipient closed `#52`) |
| Open challenge | Commitments `44`/`45`; localized deadline, countdown, and expired-control transition recorded in P1-2 | Covered; arbiter/non-arbiter role gating owner-checked on preview, including unavailable resolve controls for a maintainer on `#44` |
| `Breached` | Commitment `37`; breach status and disabled challenge/close controls without a wallet | Covered as a read-only state and in wallet-gating checks |
| Closed and refunded | Commitment `38`; closed journey and refunded escrow recorded | Covered; `#52` was also closed by the recipient in the wallet pass |
| USDC registration shortfall | Commitments `47`/`48`; registration note and disabled “Beneficiary wallet required” action | Covered as a read-only and gated state; `#47` claim also stayed gated for a maintainer and an arbiter while its evaluation challenge window was open |
| Error notice | Invalid ID on the local fixture; `role="alert"`, 320 px, both themes, no overflow | Covered visually; VoiceOver owner-confirmed separately |
| Wallet-driven actions | 2026-11-18 owner-reported preview pass (below) plus earlier local wallet restore/account change, `#33` pending-grant UI, and `#27` inbox flow | Covered |

All seven broader page-state families in the acceptance list now have a dated
record. The empty and error states were additionally checked at 320 px in both
themes. Safari keyboard traversal, VoiceOver, and a connected-wallet preview
pass were owner-confirmed on 2026-11-17/18.

#### Connected-wallet preview pass (owner-reported 2026-11-18)

Preview: `https://preview.lcp-preview.pages.dev` (testnet). Environment:
Orca’s internal Chromium-based browser with the Meteor Wallet Chrome extension
(`chrome-extension://pcndjhkinnkaohffealmlmhaepkpmgkb`; exact browser and
extension version numbers were not captured). Evidence: owner-provided Chrome
DevTools Recorder export (2026-11-18 17:23:57 local, 1325×709 viewport)
showing commitment navigation (`#27`, `#33`, `#44`, `#45`), a maintainer
challenge attempt on `#33`, and a Meteor-approved “Expire after deadline”
action on `#45` followed by the copied transaction hash. Owner reported:

- **Connect/account:** connect/disconnect passed. Changing the account in the
  wallet extension does not update the app automatically; the user must click
  “Change wallet” in the Console to switch to another wallet/account.
- **Availability/role gating:** `#37` breached controls disabled (pass);
  `#38` closed/refunded unavailable as expected (pass); `#47`/`#48` USDC
  registration shortfall note and disabled “Beneficiary wallet required” action
  (pass); `#44`/`#45` challenge role states passed when checked as both arbiter
  and non-arbiter. As recipient, `#52` could be closed and showed “Commitment
  #52 is closed. The sponsor may return any residual escrow and unused
  evaluator operations.” (authorized action available/success).
- **Wallet rejection:** cancelling an action in the wallet popup showed
  “User cancelled the action.”
- **Failure/gating by state:** opening a challenge as maintainer on `#33`
  returned “The evaluation challenge window has closed.” Closing `#44` as
  maintainer was disabled because of the open challenge.
- **Success/transaction outcome:** expiring a challenge as maintainer succeeded
  with “Challenge #11 timed out and was dismissed. Accepted evidence remains in
  force; any claim window paused by the challenge resumes.” Transaction hash:
  `BaDLHSYd9YuMxQR4TyNG9etWouBoYqEtjfD5TnkwYX7a`.
- **Unauthorized-action probe:** as maintainer on `#44`, resolve controls were
  unavailable (pass); on `#47`, claim remained gated as maintainer and arbiter
  because the evaluation challenge window was still open (pass).

No unauthorized action reached the wallet beyond correctly gated/disabled
controls in the reported checks; UI role/state gating behaved as expected. If a
future check finds an enabled action that should be unauthorized, reject it in
the wallet (or let it fail safely) and record the message/tx.

- 320 CSS px and 200% zoom with no horizontal overflow, including a selected
  commitment and an open challenge.
- WCAG text-spacing overrides without clipping or overlap.
- Keyboard order, skip link, recent-list navigation, and focus retention across
  async reads, including post-load focus on the health heading.
- Accessibility-tree status text, helper-popover exclusivity, and sampled
  light/dark contrast.
- VoiceOver pass over the list, detail, challenge, and error states
  (owner-confirmed 2026-11-17/18).
- Broader page states: empty list, degraded indexer, pending evaluation, open
  challenge, `Breached`, closed and refunded, and USDC registration shortfall.
- Connected-wallet preview pass on `https://preview.lcp-preview.pages.dev`
  (owner-reported 2026-11-18): connect/disconnect and account-switch note,
  role/state gating, wallet rejection (“User cancelled the action”),
  precondition failure, and successful actions including tx
  `BaDLHSYd9YuMxQR4TyNG9etWouBoYqEtjfD5TnkwYX7a`.

Exit: results recorded in `TODO.md` and `P1-ARCHITECTURE.md` with the preview
origin, date, browser version, and any defect links. No remaining P1-1 manual
gap is recorded from this pass.

### P1-2: Console deadline clarity

This needs a live pending challenge. Verify the localized deadline, the
decreasing countdown, disabled-to-enabled expiry transition, and the technical
timestamp disclosure in both themes, then record the commitment ID and
transaction alongside the result.

Status 2026-11-18: verified on a live fixture. No existing commitment had an
open challenge, so `tests/testnet-challenge-fixture/create-challenge.mjs`
(using the pinned `near-api-js` dev dependency and the keys in `.env.testnet`)
created commitment `44`, funded it, submitted a maintainer-signed v1 heartbeat,
received evaluation `1` Accepted/Compliant, and opened challenge `10`. On the
preview, the challenge card showed the localized resolution deadline (Nov 19,
2026, 10:56 AM AST), a countdown that advanced from 23 hr 57 min to 23 hr 55
min, the “Available in 23 hr 54 min” expiry control disabled, and the technical
disclosure with the raw `1795100172677516080 ns` value. Light and dark themes
both rendered correctly. A second run with `CHALLENGE_WINDOW_SECONDS=600
RESOLUTION_TIMEOUT_SECONDS=90` created commitment `45` with challenge `11`;
its control moved from disabled “Available in 58 sec” to enabled “Expire after
deadline”, and the page stated “The deadline has passed. Any account can now
expire this challenge.” Arbiter resolution was not exercised because it needs a
connected wallet. Deterministic predicate coverage lives in
`apps/console/lib/commitment-flags.test.mjs`; the fixture workflow is documented
in `tests/testnet-challenge-fixture/README.md`.

### P1-3: Owner decisions to record

Recorded in `TODO.md` on 2026-11-18 under "Reclassified from P1". The original
list is kept here for reference:

- Optional archive backfill stays deferred; it is explicitly not a release gate.
- Finding 2 key removal, Finding 3 exact-preview fault injection with provider
  independence, and the mainnet reproducible/third-party rebuild move to the
  eventual mainnet release checklist.
- Reviewer-access Findings 1 through 9 remain mainnet-readiness work, not P1.

## Phase 2: close P2

The acceptance definition is the section 7 matrix in
`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`. The TODO bullets are summaries of that
matrix; close rows, not bullet counts.

### Workstream A: independent evidence

| ID | Task | Exit criteria |
| --- | --- | --- |
| A1 | Resolve the source-commit ambiguity, then independently reproduce the pinned capture set | A second operator, with no shared environment, reproduces every capture and diffs the manifests |
| A2 | Independently rebuild the candidate `sandbox-recovery` artifact | Two builds from the same commit match on WASM SHA-256 and NEAR code hash, and a second party reproduces them |
| A3 | Independent review of the implemented verifier and settlement path | Zero open Critical or High findings; Mediums fixed or explicitly accepted |

The operator handoff is
[`tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md`](tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md).
It was corrected on 2026-11-19 from the owner dry run: the two source trees
(`689fbf1` for contract sources/core WASM, `9e08339` for runner/verifiers/
manifests), the mock-token build and its host-dependent digests, the verifier
defaults, and the in-repository output/manifest location are now stated
explicitly.

A1's source question is resolved: `9e08339` is the commit "test: pin 689fbf1
local recovery acceptance captures", so `689fbf1` is the normative source and
`9e08339` adds only the manifests. On 2026-11-19 an owner-machine rerun
executed the handoff procedure end-to-end and recorded evidence in
[`audit/owner-rerun-689fbf1-2026-11-19/`](audit/owner-rerun-689fbf1-2026-11-19/report.md):
pinned inputs/artifacts were re-derived, all eight captures regenerated, all
verifiers passed, and 65/65 non-volatile scenario payloads matched the committed
set. This is **not** independent reproduction (same operator/workstation/Docker
daemon) and the run found handoff defects (manifest availability at `689fbf1`,
pinned verifiers targeting older captures, undocumented/host-dependent mock-token
artifacts) that a second operator must resolve. A1 remains open for a different
operator on different infrastructure. Existing manifests must not be regenerated.

### Workstream B: cash gate and liquidity

| ID | Task | Exit criteria |
| --- | --- | --- |
| B1 | Complete the cash-gate matrix | Every gate row passes at its exact threshold, one yocto short, and after materialization |
| B2 | Establish a production-safe funding buffer | Owner-approved: 40.2468 NEAR buffer and a separate 0.064 NEAR gas float (16 pending, 24 h → 16 stuck, 1 NEAR, 25%). Formula, measurements, and calculator are in [P2-PENDING-CALLBACK-FUNDING-BUFFER.md](P2-PENDING-CALLBACK-FUNDING-BUFFER.md). Remaining: fund the buffer on the canary instance, enforce the operational limits, and verify the evidence with [the funding runbook](P2-USDC-RECEIPT-RECOVERY-CANARY-FUNDING-RUNBOOK.md) and `tests/canary-funding/verify-funding-evidence.mjs` before the canary record cites them |
| B3 | Close the remaining callback semantics | Deleted recipient and unknown result with no retry now have unit evidence (`deleted_recipient_failure_keeps_reservation_recoverable_and_retries_once`, `missing_transfer_result_keeps_reservation_and_schedules_no_retry`); a deleted-account Sandbox capture, duplicate non-restoration, no redirection, and no double payment still need named assertions |

B1 rows still to exercise: native `claim_tranche`, `refund_remaining`,
`refund_unused_operations`, and `withdraw_storage_refund`; OutLayer
`request_evaluation` and service dispatch. Each row must prove no action is
emitted when the gate fails, and must sample `C` after the SDK builder and after
host materialization, since the earlier probe only covered pre-materialization.

Also assert `C >= S + N + Q + F + X`, zero storage-backing shortfall, and token
conservation at each async phase. Check action-construction order across payout,
operations refund, recovery withdrawal, token settlement, evaluator deposit, and
the FT 1-yoctoNEAR deposit.

B2 must cover worst-case storage growth, callback gas, extended receipt delay,
failed and out-of-gas callbacks, and evaluation deposits, and it must derive
method gas limits from measured worst cases plus margin.

Harness entry points:

```bash
node tests/sandbox-usdc-callbacks/run.mjs
node tests/sandbox-usdc-callbacks/verify-protocol-88-fixture.mjs
node tests/sandbox-usdc-callbacks/verify-native-excess-refund-capture.mjs
node tests/sandbox-usdc-callbacks/verify-bootstrap-activity-guard-capture.mjs
node tests/sandbox-usdc-callbacks/verify-storage-registry-capture.mjs
node tests/sandbox-usdc-callbacks/verify-release-feature-exclusion.mjs
node --test tests/sandbox-usdc-callbacks/test/*.test.mjs
```

### Workstream C: the remaining acceptance matrix

The traceability table is [`P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md`](P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md);
keep it current as rows close. Then close these groups.

- C1 Rotation and governance: proposal-generation overflow, many generations,
  distinct payers, successor cancellation replay, old-epoch recovery, legacy v2
  ineligibility, in-place upgrade preserving counter and instance, and
  state-restore semantics. The design notes that a full restore which deletes
  the consumed marker is not currently rejected; decide and document it.
- C2 Receipt mapping: run the complete `tests/receipt-mapping/decide.mjs` case
  list in the VM, including same-chunk `transfer A` then `Deploy B` and the
  reverse, historical approved code hash, batched actions, unsupported global
  contract representation, and provider disagreement.
- C3 Certificate binding: duplicate and conflicting certificates, a receipt for
  a different transfer, and a late callback after retry. Every rejection must
  leave state byte-for-byte unchanged.
- C4 Storage and gas: maximum valid and invalid envelopes, four- and
  five-signature paths, unseen 64-byte payer, many funded pending credits,
  repeated settle and withdraw, insufficient deposit, reserve shortfall, and
  low gas at every settlement write boundary.
- C5 Migration: interrupted migration, missing or malformed or mixed sidecars,
  counter and generation overflow, reset, and restore, with unchanged state on
  failure.

The design also requires a real elapsed-duration check. The sandbox uses a ten
second rotation delay while production uses seven days; a real seven-day run, or
an explicitly recorded operational gap, is required. The fixture is not
production evidence.

### Workstream D: operator and committee readiness

- Name five independently administered operators and document ownership
  separation, key custody and backup, software version, archive sources, and the
  finality-verifier version.
- Fund and document the archive-retention plan for unresolved intents. Without
  it the design states the committee is not operational.
- Drill sign-once journaling, conflicting-source abstention, one signer down with
  quorum surviving, two signers down leaving recovery pending, and handling a
  lost historical key.
- Attach a sign-off table to
  `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`.

### Workstream E: canary, then a separate release gate

Start only after A, B, C, and D pass:

1. Deploy a fresh child instance such as
   `dev.livingcommitmentsprotocol.testnet` with recovery enabled and zero
   migrated state or liability.
2. Run a disposable canary.
3. Keep the mainnet release as its own gate: independent rebuild, independent
   verifier review, access-key removal, and third-party reproducibility. Do not
   upgrade a production domain instance before the owner's stated date.

## Sequencing

```text
P0-1 baseline --------------------------------------------+  (guard, rerun per phase)
P1-1 preview WCAG -- P1-2 deadline clarity -- P1-3 decisions+
P2  A1/A2 reproduce and rebuild ---------+
    B1/B2/B3 cash gate and buffer -------+--> C traceability closeout --> D drills --> E canary --> release
    C1-C5 matrix -------------------------+
```

- A1, A2, and B1 can run in parallel. C depends on B's harness extensions.
- D can start during C but cannot finish before A2 and B2.
- E is strictly last and is an owner-approved gate, not part of implementation
  completion.

## Open decisions

Full evidence and required gates for each decision are in
[`P2-OPEN-DECISIONS-REVIEW-PACKAGE.md`](P2-OPEN-DECISIONS-REVIEW-PACKAGE.md).

1. ~~Which commit is normative for the reproduction: `689fbf1` or `9e08339`?~~
   Resolved 2026-11-18: `689fbf1` is the source; `9e08339` only pins its captures.
2. **Seven-day rotation delay (owner accepted 2026-11-19):** treat the 10-second
   sandbox fixture as logic/boundary evidence only and require one real 7-day
   elapsed run on the isolated recovery-enabled instance (propose, verify no
   early activation, complete the cancel-or-activate path, activate only after
   the real delay) as a pre-canary acceptance gate. Record chain/instance,
   proposal generation/digest, `activate_at_ns`, observed activation
   time/block, operator actions, and tx hashes. Not an accepted gap for
   canary/production; until completed, status remains not elapsed/open.
3. **Full state restore that deletes the consumed marker (owner accepted
   2026-11-19):** prohibited and out of scope for recovery-enabled or
   recovery-candidate instances. Do not restore snapshots that can resurrect
   finalized financial obligations; require forward-only upgrades from finalized
   live state and pre-upgrade/pre-enable consumed-marker/counter/ledger
   continuity checks. If a restore is ever unavoidable, treat as a new instance
   or require owner-approved incident reconciliation proving no finalized intent
   is reintroduced before re-enabling recovery. Record as a runbook/policy
   prohibition (on-chain detection of a whole-state rollback is not generally
   possible without external anchoring/redesign).
4. **False `Failure` locking certificate quarantines (owner accepted 2026-11-19
   as bounded canary risk):** accept the liveness tradeoff for a limited canary
   with explicit controls rather than an override/timeout/split-balance escape
   hatch. Controls: disposable low-value fresh instance, strict exposure limits,
   named independently administered 4-of-5 sign-once operators with
   abstain-on-uncertainty (Workstream D), monitoring/alerting on quarantine and
   backing shortfall, documented response runbook, and an owner acceptance
   record stating "a false certificate Failure can lock all certificate
   quarantines until full backing is restored; no timeout/admin override exists"
   with maximum accepted exposure. Do not expand beyond canary until A3/D3 and
   any incidents are reviewed.
5. **Buffer value and method gas limits (owner approved 2026-11-19):** the four
   policy inputs are fixed (16 simultaneous pending payouts, 24 h → 16 callbacks
   under a shared-incident assumption, 1 NEAR largest payout/refund, 25% margin),
   which computes a 40.2468 NEAR buffer with a separate 0.064 NEAR gas float.
   Method gas limits are derived from committed and local worst-case captures
   with a 1.5× margin. Close B2 by funding the buffer on the canary instance,
   enforcing the operational limits (the contract does not enforce them), and
   recording verified evidence with
   [P2-USDC-RECEIPT-RECOVERY-CANARY-FUNDING-RUNBOOK.md](P2-USDC-RECEIPT-RECOVERY-CANARY-FUNDING-RUNBOOK.md)
   and `tests/canary-funding/verify-funding-evidence.mjs`. The canary record must
   not cite the values until that evidence passes.

## Definition of done

- P0: the baseline suite is green at the release revision and the checklist is
  untouched.
- P1: preview Firefox/WCAG and deadline-clarity results are recorded, and the
  deferred items are explicitly reclassified.
- P2: independent capture reproduction, matching independent rebuild,
  independent verifier review, every section 7 row traced to an artifact, a
  documented funding buffer, and five funded and drilled operators. Only then
  propose the canary, and keep the testnet and mainnet gates separate.
