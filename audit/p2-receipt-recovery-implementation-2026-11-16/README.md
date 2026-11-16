# Independent Implementation Review: USDC Receipt Recovery

## Review objective

Independently review the implemented, feature-gated USDC receipt-recovery candidate and its native cash/storage accounting. Decide whether the code is safe to proceed to isolated NEAR VM and Sandbox acceptance. This review is for local source only; it does not authorize a testnet canary, production upgrade, or mainnet release.

Use the exact source files and SHA-256 values in [review-manifest.json](review-manifest.json). The repository is on branch `main` at baseline commit `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`, but its working tree is dirty and the candidate is uncommitted. The baseline commit alone does not identify the reviewed code. Recompute hashes before review and report any mismatch.

For a portable handoff, use [review-inputs.zip](review-inputs.zip). It contains only the 38 manifest-listed inputs and the manifest itself, preserving their repository-relative paths. It excludes environment files, wallet credentials, Git history, and build artifacts. Verify every listed SHA-256 before reviewing.

The `usdc-receipt-recovery` Cargo feature is disabled by default. The candidate targets a fresh, dedicated child contract instance; it does not migrate or upgrade the existing testnet contract. No recovery transaction or deployment was made for this candidate. The latest local checks were `cargo fmt --all`, `git diff --check`, and default plus feature-enabled Wasm `cargo check`; they are compile/format checks, not behavior acceptance. Existing Sandbox callback fixtures predate the persistent recovery-intent integration and must not be presented as recovery acceptance.

## Review scope

Review the full interaction between:

- NEP-141 tranche claims and escrow refunds that persist a transfer intent when recovery is bootstrapped.
- The FT transfer memo/event, canonical Borsh intent, bounded Base64/Borsh parser, 4-of-5 or 5-of-5 Ed25519 certificate verification, and certificate recovery endpoint.
- Callback-first and certificate-first settlement, transfer retries, terminal intent finalization, committee epoch counters, committee rotation/cancellation/retirement, and payer-credit withdrawal.
- The fresh-instance native cash ledger and recovery storage reserve, including all production promise/outflow paths affected by these sidecars.
- The operator trust boundary and receipt interpretation rules in the design and operator-policy annex.

The contract does not verify NEAR receipt proofs. Operators attest to their interpretation of finalized receipts. Evaluate that trust boundary as implemented and documented; do not assume the certificate proves a receipt by itself.

## Required review questions

### 1. Transfer intent and token binding

- Is every recovery-enabled token transfer represented by exactly one immutable intent before its FT promise is scheduled?
- Does the stored intent bind the contract instance, network/genesis, committee epoch, transfer ID, commitment, transfer kind/epoch, token account/code hash, recipient, amount, origin method, deposit, and gas?
- Are `LCP1` memo and `token_transfer_intent` event bytes/digests canonical and consistent with the signed Borsh format?
- Can a legacy or malformed pending transfer be incorrectly settled as a recovery-enabled transfer, or vice versa?

### 2. Certificate parser and signatures

- Are envelope and Borsh sizes bounded before expensive decoding/allocation? Are trailing bytes, noncanonical encodings, invalid enum/options/accounts/hashes, duplicate signers, unknown keys, and malformed signatures rejected?
- Does verification use strict Ed25519 semantics and count four distinct keys from the exact pinned epoch?
- Does the signed certificate bind every intent field and outcome, including the origin transaction/receipt, token receipt/action, block identity, and intent digest? Identify any ambiguity the contract cannot resolve without trusting the operators.
- Can a valid certificate be replayed across transfers, contract instances, networks, epochs, or origins?

### 3. Receipt interpretation and operator trust

- Do the operator rules establish finalized canonical receipt ancestry, action order, predecessor, token code identity at execution time, exact `ft_transfer` method/arguments/memo, and success/failure semantics?
- Are unsupported runtime metadata, missing ancestry/replay, provider disagreement, reorg uncertainty, archive gaps, or code-upgrade ambiguity handled by abstaining and keeping the liability pending?
- Is the 4-of-5 safety and liveness assumption adequately explained? Consider correlated operators, compromised/lost keys, unavailable signers, rotation, and permanent unresolved transfers.

### 4. Settlement races and accounting

- Can callback and certificate settlement race without double payment, double decrement, duplicate retry, or terminal-state overwrite?
- Are duplicate, stale, contradictory, missing, or multiple promise results safely rejected or kept pending? What happens when a callback arrives after certificate settlement or after a new transfer ID is allocated for retry?
- On success/failure, do `pending_raw`, `paid_raw`, `refunded_raw`, `free_raw`, tranche status, transfer count, intent state, and committee pending count remain consistent?
- Does the cash invariant `C >= S + N + Q + F + X` cover every production NEAR outflow and all liability transitions? Check promise construction/order, one-yocto FT deposits, OutLayer deposits, refunds, callbacks, top-ups, and callback OOG/delays against the pinned runtime assumptions.
- Are storage bonds, reserve revaluation, payer credits, admission excess, row tombstones, and finalization/withdrawal transitions value-conserving and non-duplicative?

### 5. Bootstrap, governance, and compatibility

- Can only the captured initializer bootstrap a fresh instance, exactly once? Are network, genesis, USDC account/code-hash allowlist, instance ID, storage reserve, and committee initialization fail-closed?
- Are rotation proposals, cancellations, generation consumption, key non-reuse, activation delay, pending epoch retention, and retirement safe under replay, boundary timestamps, overflow, and storage failure?
- Is the feature gate and fresh-instance-only policy sufficient to protect existing deployments and state layouts? Identify any upgrade, migration, or accidental enablement hazard.

### 6. Gas, storage, and operational limits

- Estimate worst-case parsing/signature gas and storage for 5-of-5 certificates, rotation, high record counts, revaluation batches, callbacks, and finalizers. Are the current limits and gas allocations defensible or clearly provisional?
- Can low gas, storage-price changes, reserve shortfall, account deletion, missing data, or a partially completed maintenance sequence strand liabilities or make recovery impossible?
- Does the payer-credit view accurately expose pending/accrued/withdrawable value and current cash/reserve readiness without making guarantees that can change before execution?

## Materials

The manifest is the authoritative list of hash-pinned inputs. Key files include:

- `contracts/lcp-core/src/contract.rs`, `models.rs`, `lib.rs`, `native_cash.rs`, `recovery_accounting.rs`, `recovery_config.rs`, and `receipt_recovery.rs`.
- `contracts/lcp-core/Cargo.toml`, root `Cargo.toml`, and `Cargo.lock`.
- `P2-USDC-RECEIPT-RECOVERY-DESIGN.md` and `P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md`.
- The original receipt-recovery audit, v4 specification review, USDC independent audit/follow-up, recovery vector generator/reference, and existing Sandbox callback fixture.
- `TODO.md` and `TESTNET-E2E-STATUS.md` for project boundaries and historical acceptance evidence.

Historical design reviews are context only. The v4 approval was for implementation planning and does not approve this code. Do not infer implementation acceptance from the previous USDC testnet acceptance or callback Sandbox fixtures.

## Reviewer constraints

- Do not deploy, upgrade, bootstrap a network contract, submit transactions, or access wallet/private-key files. Do not use `.env*` files or request credentials.
- Do not modify candidate source. You may run offline analysis and local checks in an isolated checkout if useful; identify every command, environment, and limitation in the report.
- Review the manifest's exact hashes. If the files changed, stop and request a refreshed package instead of silently reviewing a different candidate.
- Separate direct code observations, executed checks, assumptions, and unresolved protocol/runtime questions. Do not describe an automated review as a signed security-firm audit or cryptographic proof of NEAR receipt correctness.

## Deliverable

Save a report at repository root as `P2-USDC-RECEIPT-RECOVERY-IMPLEMENTATION-REVIEW.md`. Choose one verdict:

- **Approve for isolated NEAR VM/Sandbox acceptance**
- **Approve with required changes**
- **Reject**

For each finding, include severity (`Critical`, `High`, `Medium`, `Low`, or `Informational`), exact file/function/line, a concrete reachable failure scenario, impact, remediation, and a regression/acceptance case. If no findings are found, state what was actually checked and which gates remain open. Identify reviewer/model/runtime, isolation, date, baseline commit, reviewed file hashes, commands, and limitations. The report must not mark testnet canary, production, or mainnet acceptance complete.
