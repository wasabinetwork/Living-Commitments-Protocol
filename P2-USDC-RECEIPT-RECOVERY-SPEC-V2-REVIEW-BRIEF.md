# Independent Follow-Up Review Brief: USDC Receipt-Recovery Specification v2

## Objective

Review whether [P2-USDC-RECEIPT-RECOVERY-DESIGN.md](P2-USDC-RECEIPT-RECOVERY-DESIGN.md), revised after findings F1–F4 in the first follow-up, is now precise and safe enough to authorize implementation planning for a NEAR contract verifier. Do not implement code, change files other than the review report, send transactions, or treat approval as deployment/release acceptance. The report must distinguish a design proposal from behavior that exists in the source.

For this project, the owner accepts a fresh GPT-Sol isolated session as an independent automated review. Identify the reviewer/runtime, session isolation, date, commit, reviewed files and manifest hashes, checks performed, and limitations. Do not describe this as a signed security-firm audit or validator-level proof verification. The source worktree may contain unrelated modifications; preserve them.

Save the report as `P2-USDC-RECEIPT-RECOVERY-SPEC-V2-REVIEW.md`.

## Required review questions

1. **F1 — canonical bytes and signatures:** Are the ordered Borsh types, discriminants, fixed-width bytes, domain hex, digest construction, Ed25519 semantics, Base64 envelope, length bounds, canonical parsing, trailing-byte behavior, distinct signer counting, and golden-vector requirements complete and mutually consistent? Are the certificate and envelope caps sufficient for the maximum fields/signatures?
2. **F2 — receipt interpretation:** Can an operator apply the decision procedure to a real NEAR receipt graph without ambiguity? Is the LCP origin/event → unique token action linkage enforceable with the memo, one-transfer restriction, exact predecessor/receiver/action/deposit/gas/arguments, and finality rule? Does the `SuccessValue`/`Failure` distinction correctly exclude `SuccessReceiptId`, downstream failures, callbacks, and provider assertions? Can the exact token code hash at receipt execution be established, and should it be pinned/validated differently?
3. **F3 — committee safety and lifecycle:** Is 4-of-5 justified for escrow recovery under the stated honest-sign-once assumptions? Does quorum intersection reasoning hold? Are signer independence, canonical network/finality validation, abstention, journal/archives, rotation proposal/cancellation, activation boundary, retained epochs, permanent key loss, key non-reuse, and the 32-epoch cap coherent and implementable? Identify availability or safety failures the current rules miss.
4. **F4 — state, storage, and migration:** Do the v1 intent, deployment instance, current monotonic transfer counter, legacy v2 ineligibility, storage payer/bond/refund, retained key data, and atomic settlement rules prevent replay or stranded liabilities during in-place upgrade, reset, restore, or redeployment? Is storage accounting sufficiently exact to implement?
5. **Implementation gates:** Is the proposed acceptance matrix sufficient? Identify any missing invariant, adversarial scenario, NEAR VM benchmark, or operator drill that should block implementation or testnet canary. Do not infer that local callback tests validate recovery.

## Required verdict and finding format

Return **approve for implementation**, **approve with required changes**, or **reject the design**. For every finding, give severity, exact design section, a concrete failure scenario, required remediation, and a regression/acceptance test. Explicitly call out assumptions and unverified NEAR/USDC behavior. If not ready, recommend keeping uncertain liabilities pending and identify blockers. Approval only permits implementation work to begin; implementation review, Sandbox tests, testnet canary, reproducible artifact verification, and mainnet release remain separate gates.

## Review inputs

Use the exact versions listed in [the v2 review manifest](audit/p2-receipt-recovery-2026-11-15/spec-v2-review-manifest.json). Review the new specification against the prior review, original audit, current contract/callback code and Sandbox harness. Do not rerun deployment or use wallet keys.
