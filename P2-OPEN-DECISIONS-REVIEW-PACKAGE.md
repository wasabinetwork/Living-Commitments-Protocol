# P2 Open Decisions and Independent Review Package

**Status (2026-11-19):** Review package for the remaining P2 closeout items in
[`P0-P1-P2-CLOSEOUT-PLAN.md`](P0-P1-P2-CLOSEOUT-PLAN.md). This document does
not change protocol behavior, does not enable recovery, and does not authorize a
testnet canary or production upgrade. It packages the evidence, open decisions,
recommendations, and sign-off records needed to close Workstreams A–E.

**Owner decisions (2026-11-19):** the owner accepted the recommendations for
decisions 2–5 below. **A1 evidence (2026-11-19):** an owner-machine mechanical
rerun of the handoff procedure was recorded at
[`audit/owner-rerun-689fbf1-2026-11-19/`](audit/owner-rerun-689fbf1-2026-11-19/report.md)
(not independent; see §3). Acceptance below records direction and required gates;
it does not by itself close elapsed-run, measurement, independence, drill, or
owner-numeric sign-offs.

Normative behavior remains defined by
[`Living_Commitments_Protocol_[LCP]-PRD.md`](Living_Commitments_Protocol_%5BLCP%5D-PRD.md),
[`Living Commitments Protocol - Technical Specification.md`](Living%20Commitments%20Protocol%20-%20Technical%20Specification.md),
and [`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`](P2-USDC-RECEIPT-RECOVERY-DESIGN.md).
Row-level evidence status is tracked in
[`P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md`](P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md).
Funding-buffer inputs are in
[`P2-PENDING-CALLBACK-FUNDING-BUFFER.md`](P2-PENDING-CALLBACK-FUNDING-BUFFER.md).
Operator rules are in
[`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md).
The second-operator reproduction procedure is
[`tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md`](tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md).

## 1. Scope and current state

| Area | State | This package covers |
| --- | --- | --- |
| P0 | Complete; regression gate only | No P0 action except rerunning the baseline gate after P2 changes |
| P1 | Console acceptance items recorded; mainnet gates deferred/reclassified | No P1 Console action recorded |
| P2 | Design/review gates pass; evidence gates remain | Open decisions 2–5, Workstreams A–D closure inputs, and canary preconditions |

Recovery is disabled in deployed testnet and production artifacts. It stays
disabled until Workstreams A–D pass and the owner approves a canary (Workstream
E). No production-domain contract upgrade is planned before the separately stated
release gate.

## 2. Open decisions

Decision 1 in the original list is resolved: `689fbf1` is the normative capture
source and `9e08339` pins its manifests. The remaining open decisions are below.

### Decision 2 — Seven-day rotation delay

**Owner decision (2026-11-19):** accepted the recommendation below.

**Question:** Run the real seven-day rotation delay, or record it as an accepted
operational gap?

**Evidence**
- Production committee rotation and USDC code-hash proposal delays are seven days
  (`604_800_000_000_000` ns) in the design
  ([`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`](P2-USDC-RECEIPT-RECOVERY-DESIGN.md),
  committee rotation / code-hash sections).
- Sandbox/fixture governance timing uses ten seconds for local acceptance; the
  design and traceability table explicitly state the seven-day period was not
  elapsed ([`P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md`](P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md),
  Gate 4: "Seven-day production delay elapsed" = `OWNER`).
- The delay check is deterministic timestamp arithmetic (`activate_at_ns >=
  checked_add(now, seven_days)` on proposal/admission paths and `now >=
  activate_at_ns` on activation), so the 10-second fixture provides logic/timing
  boundary evidence but not real elapsed-duration operational evidence.

**Recommendation (best practice / evidence-based): do not accept a permanent
operational gap for canary or production; treat the 10-second fixture as logic
evidence only and require one real 7-day elapsed run as a pre-canary acceptance
gate.**

Rationale:
- Web3 governance/change-delay controls exist to create a review/cancel window;
  proving only the comparison logic does not prove operator procedures, monitoring,
  cancellation drills, clock/epoch handling, and sustained pending-state behavior
  over the actual delay.
- The cost is elapsed time on an isolated, disposable instance, not code risk.

**Required action**
1. On the isolated recovery-enabled child instance (e.g.
   `dev.livingcommitmentsprotocol.testnet`) run a real committee-rotation and/or
   code-hash proposal with the production 7-day delay: propose, verify it cannot
   activate early, perform/record the cancellation-or-activation decision path as
   applicable, and activate only after the real delay.
2. Record chain, instance, proposal generation/digest, `activate_at_ns`, observed
   activation timestamp/block, operator actions, and tx hashes.
3. If a 7-day run has not yet completed, record the status as **not elapsed**
   (open), not as an accepted gap. An "accepted operational gap" may be recorded
   only by explicit owner sign-off for a specific non-production context, and must
   still be closed before production enablement.

**Sign-off:** owner + operator record linked from `TODO.md` / traceability.

### Decision 3 — Full state restore that deletes the consumed marker

**Owner decision (2026-11-19):** accepted the recommendation below.

**Question:** Is a full state restore that deletes the consumed marker in scope,
or should it remain rejected?

**Evidence**
- The design states: "A full state restore that deletes the consumed marker
  together with the ledger is not detected. ... Upgrade only from the finalized
  live state; do not restore a stale snapshot of the pending ledger..." and
  "Rewinding the counter onto a consumed ID refuses..." but "a full state restore
  that deletes the consumed marker together with the ledger is not rejected."
  ([`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`](P2-USDC-RECEIPT-RECOVERY-DESIGN.md)).
- Implementation markers: consumed marker key
  `lcp:receipt-recovery-consumed:v1:<transfer_id_le_u64>` with value `0x01`,
  written only when finalization removes the intent
  (`contracts/lcp-core/src/receipt_recovery.rs`). `recover_nep141_transfer`
  checks the marker before reading a certificate; consumed IDs cannot be settled
  or reallocated after finalization.
- Tests assert restored pending intent cannot settle a consumed transfer and a
  rewound counter cannot allocate a consumed ID
  (`contract::tests::restored_pending_intent_cannot_settle_a_consumed_transfer`,
  `contract::tests::rewound_transfer_counter_cannot_allocate_a_consumed_id`,
  traceability Gate 4).
- If the entire contract state is restored to a pre-finalization snapshot, both
  the marker and ledger revert together; the contract has no external anchor to
  detect that the restore resurrected a finalized obligation.

**Recommendation (Web3/state-safety best practice, based on code/design evidence):
treat full state restore that deletes/reverts consumed markers as out of scope and
prohibited for any recovery-enabled or recovery-candidate instance. Do not add an
on-chain "detect arbitrary restore" mechanism as a prerequisite for canary; rely
on forward-only operational controls and reconciliation.**

Rationale:
- Restoring mutable financial contract state can resurrect settled liabilities,
  re-open spent/quarantined transfers, or desynchronize counters/epochs from
  external reality. For receipt recovery this directly conflicts with
  exactly-once settlement and the consumed-transfer invariant.
- On-chain detection of a whole-state rollback is not generally possible without
  an external monotonic commitment (separate contract, checkpoint hash anchored
  off-chain, or chain-data proof), which is a design change outside the current
  scope and would itself need review.
- Safer practice: forward-only upgrades, no state-snapshot rollback of live
  ledgers; if disaster recovery requires restore, treat as a new instance and
  perform independent reconciliation proving no finalized/recovered intent is
  resurrected before any recovery/cash-moving operation is enabled.

**Required action**
1. Record this decision in `TODO.md` / `P0-P1-P2-CLOSEOUT-PLAN.md` as: "Full
   state restore that deletes consumed markers is **out of scope and prohibited**;
   recovery-enabled instances must be upgraded forward-only from finalized live
   state."
2. Add an operational precondition to canary/release runbooks: before
   bootstrap/enablement or upgrade, verify consumed-marker continuity and that no
   pending ledger/counter snapshot predates finalized settlement (compare against
   finalized chain state and operator records).
3. If a restore is ever unavoidable, require owner-approved incident procedure:
   new instance or explicit reconciliation artifact proving no finalized intent is
   reintroduced, then independent sign-off before re-enabling recovery.
4. Keep traceability Gate 4 row explicit as "prohibited/not supported" rather
   than "open implementation gap", unless the owner chooses to fund a redesign.

**Sign-off:** owner decision recorded; operator/runbook acknowledgment.

### Decision 4 — Canary risk: false `Failure` locking certificate quarantines

**Owner decision (2026-11-19):** accepted the recommendation below (bounded
canary risk with controls and explicit exposure/acceptance record).

**Question:** What is the accepted canary risk for a false `Failure` locking all
quarantines until the shared token balance covers gross units?

**Evidence**
- Design: USDC escrow is pooled in one shared token account. A 4-of-5 certificate
  that falsely reports `Failure` for a token transfer that actually succeeded
  quarantines that amount instead of returning it to free escrow; release checks
  that `ft_balance_of` covers every gross unit (spendable + all certificate
  quarantines). "If any certificate quarantine is a false Failure and those
  tokens have left, no certificate quarantine releases until the pool is fully
  backed again... This is a liveness limit. It does not let one commitment spend
  another's tokens. Callback failures are not quarantined. A plain token
  transfer that remains in the contract can restore full backing..." and "No
  timeout, emergency key, or per-commitment token split." "Unknown, provider
  disagreement, or unavailable evidence must produce no certificate..."
  ([`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`](P2-USDC-RECEIPT-RECOVERY-DESIGN.md),
  safety invariant / pooled-escrow consequence / V1 committee sections).
- Operator policy repeats the same liveness/safety tradeoff and requires
  abstention on uncertainty
  ([`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md)).
- Code/tests: global full-pool backing check on quarantine release
  (`contracts/lcp-core/src/usdc_pool.rs`,
  `contracts/lcp-core/src/contract.rs` release path) and tests
  `one_false_certificate_blocks_release_of_every_certificate_quarantine`,
  `certificate_failure_quarantines_one_commitment_until_the_pool_is_fully_backed`.

**Recommendation (evidence-based): accept this liveness risk for a limited canary,
with explicit controls, rather than adding an override/timeout/split-balance
escape hatch. Record owner acceptance of the specific risk.**

Rationale:
- The behavior is a deliberate safety choice: the contract cannot distinguish a
  true failure from a false certificate on-chain, so releasing on partial evidence
  would risk double-spend or cross-commitment loss. A global lock is safer than a
  wrong release.
- "Better approach" alternatives have tradeoffs: per-commitment segregation is a
  major redesign (and constrained by shared token-account semantics); admin
  override/timeout/emergency key reintroduces trusted recovery power that the
  design explicitly avoids; automatic attribution is not provable from balance
  alone. None is a drop-in improvement without new trust/review surface.
- Mitigations already present in design: abstain-on-uncertainty (no certificate
  on `Unknown`/disagreement/unavailable evidence), 4-of-5 with independently
  administered sign-once operators, and the fact that restoring full backing
  (e.g. returning tokens to the pool) can unblock release.

**Canary controls (required if accepted)**
1. **Exposure limit:** canary uses disposable, low-value commitments/amounts on a
   fresh isolated instance with no migrated liabilities.
2. **Operator discipline:** named, independently administered operators with
   sign-once journals, distinct archive/finality sources, and abstention on any
   disagreement/uncertainty (Workstream D gates).
3. **Monitoring/runbook:** alert on certificate-failure quarantine events and on
   `ft_balance_of` shortfall vs gross quarantined+spendable units; document a
   response runbook (investigate evidence, do not issue conflicting certificates;
   if false failure confirmed and tokens left pool, restore backing only through
   an explicitly authorized, auditable path or accept liveness halt for affected
   quarantines).
4. **Scope statement:** canary acceptance record must state "a false certificate
   Failure can lock all certificate quarantines until full backing is restored; no
   timeout or admin override exists" and name the maximum accepted exposure.
5. **Promotion gate:** do not expand beyond canary limits until independent
   verifier review (A3), drill evidence (D3), and owner review of any quarantine
   incidents are complete.

**Sign-off:** owner explicitly accepts or rejects this canary risk with named
limits; operator lead acknowledges runbook.

### Decision 5 — Buffer value and method gas limits (B2)

**Owner decision (2026-11-19):** accepted the recommendation framework below;
numeric values, policy inputs, and gas limits remain to be fixed and approved.

**Question:** What buffer value and method gas limits does the owner accept from
B2?

**Evidence / source of truth:**
[`P2-PENDING-CALLBACK-FUNDING-BUFFER.md`](P2-PENDING-CALLBACK-FUNDING-BUFFER.md)
is the complete B2 working note. It provides the model and measured inputs but
explicitly leaves the production buffer unset pending policy choices.

Measured inputs (comparable mock probes, 8,192-byte envelope assertion):
- USDC tranche claim pending: 617 bytes; success settlement delta −418; retained
  199 bytes.
- USDC tranche claim failure: 617 bytes pending; 199 bytes net retained.
- USDC residual refund pending: 512 bytes; success delta −398; retained 114 bytes.
- Native credit withdrawal pending: 26 bytes; success delta −114; failure delta
  −26 with the payer credit restored (measured 2026-11-19).
- Token callback with an unresolved (OOG) receipt: 617 bytes pending, 0 bytes
  committed delta, 617 bytes retained, because a failed receipt reverts its
  writes (measured 2026-11-19).
- Worst case used by the model: 617 pending / 617 retained; the 199-byte terminal
  record is the settled case, not the stuck case.

Model: `subtotal = (largest_outflow × max_pending) + (largest_outflow ×
stuck_callbacks) + 10^19 yocto × (pending_bytes × max_pending + retained_bytes ×
stuck_callbacks)`; `recommended_buffer = subtotal × (1 + margin)`. Gas is a
separate prepaid float, not solvency capital.

Illustrative sample only (not a recommendation): `max_pending=64`,
`max_outflow=1 NEAR`, `stuck_callbacks=4`, `margin=25%` => 85.52445 NEAR buffer
+ 0.128 NEAR gas float.

**Recommendation:** do not publish a final buffer/gas-limit value from this
package. Resolve B2 by fixing the four policy inputs in the policy/deployment
documents, completing the remaining measurements, then computing and owner-
approving the result. For a canary, use conservative policy caps sized to the
canary's actual maximum authorized outflow.

**Owner/policy inputs that must be fixed (from the buffer doc)**
1. **Maximum concurrent pending payouts per commitment** (contract enforces no
   cap; set as an operational/enforced limit).
2. **Stuck-callback allowance in hours**, converted to a count under a stated
   correlation assumption (not "all pending stuck forever" unless intentionally
   chosen).
3. **Largest single authorized payout or refund** (replace the 1 NEAR fixture
   value with the real policy maximum for the target environment).
4. **Margin** (percentage or flat) above subtotal, with rationale.

**Technical closure needed before finalizing values/gas limits**
- ~~Measure recovery-credit withdrawal and OOG-retention storage with the same
  comparable probe and add to the table.~~ Measured 2026-11-19: credit
  withdrawal 26 pending / −114 success / −26 failure; unresolved token callback
  617 pending / 0 committed delta / 617 retained.
- Replace fixture outflow with the largest policy-authorized single payout/refund.
- Re-run `node tests/sandbox-usdc-callbacks/measure-funding-buffer.mjs` with
  approved inputs and record JSON/artifact.
- Derive method gas limits from measured worst cases plus margin (traceability
  Gate 5 open row), covering both sides of SDK-builder/host-materialization and
  per-path action order where required.
- Record approved buffer and gas limits in `TODO.md` and the deployment/runbook;
  keep gas float monitored separately.

**Suggested canary starting point (owner must approve/adjust):** cap concurrent
pending payouts tightly (e.g. ≤ 8–16 per commitment for a disposable canary),
set stuck allowance from an explicit hour bound (e.g. 24h worth under expected
latency) rather than equating it to max pending, use the actual canary maximum
payout/refund, and apply a conservative margin (e.g. ≥ 25%) until worst-case
measurements are complete. This is guidance, not an approved value.

**Sign-off:** owner approves numeric buffer, concurrency cap, stuck allowance,
and method gas limits; engineering records the calculator output and measurement
artifacts.

## 3. Workstream A — independent evidence checklist

A1 source-commit ambiguity is resolved (`689fbf1` source, `9e08339` pins
manifests).

**A1 progress (2026-11-19, owner rerun — not independent):**
[`audit/owner-rerun-689fbf1-2026-11-19/`](audit/owner-rerun-689fbf1-2026-11-19/report.md)
records an end-to-end mechanical rerun on the owner's machine (same account,
workstation, and Docker daemon). Pinned inputs/artifacts were re-derived (WASM
`890daa77…` / `ADzwZkqu…`, matching mock-token hashes on that host), all eight
captures regenerated, all verifiers passed, and 65/65 non-volatile scenario
payloads matched the committed set. This **does not** satisfy the A1 independence
requirement. The report also records handoff defects a second operator must
address (manifests/verifier defaults tied to later commits or older captures,
undocumented mock-token artifacts, and host-dependent mock-token hashes). A
different operator on different infrastructure must still reproduce, sign, and
attach the result.

| ID | Goal | Procedure / artifact | Exit criteria | Sign-off |
| --- | --- | --- | --- | --- |
| A1 | Independently reproduce pinned capture set | [`tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md`](tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md); owner rerun: [`audit/owner-rerun-689fbf1-2026-11-19/`](audit/owner-rerun-689fbf1-2026-11-19/report.md) | Different operator, different infrastructure, no shared keys/cache; WASM/code hashes match pinned values; verifiers pass; scenario-level comparison reported with expected-to-differ fields explained | Independent operator report attached; `TODO.md` item updated |
| A2 | Independently rebuild candidate `sandbox-recovery` artifact | Same source commit/build inputs as A1 handoff; build in a separate environment | Two builds from the same commit match on WASM SHA-256 and NEAR code hash; a second party reproduces | Independent builder report with digests/toolchain/image |
| A3 | Independent review of verifier and settlement path | Review `receipt_recovery`, `recovery_config`, `recovery_accounting`, `native_cash`, `usdc_pool`, settlement/callback/quarantine paths, and traceability rows against design | Zero open Critical/High findings; Mediums fixed or explicitly owner-accepted with rationale | Signed review report linked from TODO/traceability |

**Comparison notes (from A1 handoff):** match on WASM SHA-256, NEAR code hash,
scenario names, verifier-enforced assertions, fixture schema, and contract/mock
token code hashes. Expected to differ: chain IDs/genesis, account IDs, tx/receipt
/block hashes and heights, fresh-chain balances/storage, timestamps. Do not
byte-compare JSON captures.

## 4. Workstream D — operator and committee readiness checklist

| ID | Requirement | Evidence to produce | Status gate |
| --- | --- | --- | --- |
| D1 | Five independently administered operators | Named operators, ownership/admin separation, key custody/backup, software/finality-verifier version, archive sources, chain/genesis/instance binding | Required before canary |
| D2 | Funded archive-retention plan for unresolved intents | Retention owner, storage/location, funding, retention duration tied to pending epochs/intents | Required before canary (policy states committee is not operational without it) |
| D3 | Drills | Sign-once journaling, conflicting-source abstention, 1 signer down (quorum survives), 2 signers down (recovery pending), lost historical key handling; outcomes recorded | Required before canary |
| D4 | Sign-off table | Attach to [`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md) or a linked record | Required before canary |

## 5. Canary preconditions (Workstream E)

Record the acceptance in
[`P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md`](P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md),
which carries the false-`Failure` exposure limits, the seven-day delay evidence
fields, the buffer/gas approval fields, and the stop conditions.

Start only after A–D pass and the open decisions above are recorded with owner
approval:

1. Deploy a fresh child instance (e.g. `dev.livingcommitmentsprotocol.testnet`)
   with recovery enabled, zero migrated state, and no inherited liabilities.
2. Run a disposable canary within the accepted exposure/risk limits (Decision 4)
   and approved buffer/gas settings (Decision 5).
3. Complete the real 7-day rotation/code-hash delay evidence for that
   environment (Decision 2) before production enablement.
4. Keep mainnet as a separate gate: independent rebuild, independent verifier
   review, access-key/removal and governance posture per release plan, and
   third-party reproducibility. Do not upgrade a production domain instance
   before the owner-approved release.

## 6. Sign-off template

| Item | Decision / gate | Owner / operator / reviewer | Date | Evidence link | Notes / accepted risk |
| --- | --- | --- | --- | --- | --- |
| D2 | 7-day rotation delay: real run completed (pre-canary gate); not elapsed yet | owner (accepted 2026-11-19) |  | recommendation accepted; 7-day evidence pending |  |
| D3 | Full state restore deleting consumed marker: prohibited/out of scope (or approved redesign) | owner (accepted 2026-11-19) |  | runbook/policy enforcement required |  |
| D4 | False-`Failure` quarantine lock: canary risk accepted with limits | owner (accepted 2026-11-19) |  | max exposure/controls record required |  |
| D5 | Buffer, concurrency cap, stuck allowance, margin, method gas limits approved | owner (framework accepted 2026-11-19) |  | numeric inputs/measurements/sign-off pending |  |
| A1 | Independent reproduction of `689fbf1` captures |  |  |  |  |
| A2 | Independent rebuild (WASM/code hash match) |  |  |  |  |
| A3 | Independent verifier/settlement review |  |  |  |  |
| D1–D4 | Operator readiness and drills |  |  |  |  |
| E | Canary approved (scope, instance, limits) |  |  |  |  |

## 7. Related documents

- [`P0-P1-P2-CLOSEOUT-PLAN.md`](P0-P1-P2-CLOSEOUT-PLAN.md)
- [`TODO.md`](TODO.md)
- [`P2-USDC-RECEIPT-RECOVERY-DESIGN.md`](P2-USDC-RECEIPT-RECOVERY-DESIGN.md)
- [`P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md`](P2-USDC-RECEIPT-RECOVERY-TRACEABILITY.md)
- [`P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md`](P2-USDC-RECEIPT-RECOVERY-CANARY-ACCEPTANCE.md)
- [`P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md)
- [`P2-PENDING-CALLBACK-FUNDING-BUFFER.md`](P2-PENDING-CALLBACK-FUNDING-BUFFER.md)
- [`tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md`](tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md)
- [`tests/sandbox-usdc-callbacks/README.md`](tests/sandbox-usdc-callbacks/README.md)
- [`P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md`](P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md)
- [`TESTNET-E2E-STATUS.md`](TESTNET-E2E-STATUS.md)
