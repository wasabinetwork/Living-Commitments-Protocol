# Independent Follow-Up Review Brief: USDC Receipt-Recovery Specification v3

## Objective

Review [P2-USDC-RECEIPT-RECOVERY-DESIGN.md](P2-USDC-RECEIPT-RECOVERY-DESIGN.md) and its [operator-policy annex](P2-USDC-RECEIPT-RECOVERY-OPERATOR-POLICY.md) against the exact files and hashes in [the v3 manifest](audit/p2-receipt-recovery-2026-11-15/spec-v3-review-manifest.json). Determine whether the design is sufficiently precise and safe to authorize implementation planning. Do not implement code, modify repository files, send transactions, use wallet keys, or treat design approval as testnet/mainnet acceptance.

The worktree contains unrelated local modifications. Review only the manifested versions. The owner accepts an isolated GPT-Sol session as an independent automated design review for this project gate. Identify reviewer/runtime, isolation, date, baseline commit, file hashes, checks, and limitations. Do not describe the result as a signed security-firm audit, independent hardware review, or cryptographic receipt-proof verification.

Write the report to `P2-USDC-RECEIPT-RECOVERY-SPEC-V3-REVIEW.md`.

## Required review questions

1. **V2-1 — execution-time code identity:** Does the annex correctly pin nearcore 2.14.0 / protocol 88, distinguish client from protocol version, interpret metadata V4 per action, reject unsupported/global forms, define local replay/finality and same-chunk action order, handle failed pre-execution receipts, and compare execution code to the hash in the immutable intent? Are the testnet/mainnet observations and the limits of those observations presented accurately? Should either observed USDC hash be approved, or remain gated?
2. **V2-2 — storage and credit solvency:** Are `RefundCreditV1` preallocation, measured storage bonds, payer ownership, rotation/epoch credits, excess handling, dedicated reserve, the solvency equation, storage-price increases, and withdrawal success/failure/unknown states precise and implementable? Can low storage, OOG, failed/uncertain callbacks, many distinct payers, or token settlement create unfunded storage or double-pay risk? Identify any missing distinction between NEAR account balance, storage lock, liabilities, and pending promises.
3. **V2-3 — rotation replay:** Does the monotonic `last_rotation_generation` bind proposal and cancellation signatures and remain consumed across cancellation/activation? Are V2 wire types/domains, size limits, canonical parsing, golden vectors, overflow and snapshot/migration behavior complete? Can any pre-signed, cancelled, competing, stale, or replayed proposal/cancellation still occupy the slot?
4. **Full specification consistency:** Check certificate/envelope arithmetic, failure-vs-success receipt semantics, 4-of-5 assumptions, retained epochs, counter/instance migration continuity, and acceptance cases. Identify contradictions, omitted failure modes, or claims not established by the reviewed artifacts.
5. **Gates:** State exactly what may begin if approved. Keep implementation review, cross-language vectors, VM/Sandbox tests, local replay exercises, testnet canary, artifact reproduction, and mainnet release as separate gates. Do not infer recovery behavior from existing callback tests.

## Verdict and finding format

Choose **approve for implementation**, **approve with required changes**, or **reject the design**. For each finding, provide severity, exact section, concrete failure scenario, required remediation, and a regression/acceptance test. Explicitly distinguish verified observations, protocol/source facts, design assumptions, and unresolved operational dependencies. If any safety-critical detail is unknown, recommend leaving uncertain liabilities pending and identify the blocker.

## Review inputs

Use only the paths and SHA-256 identities in the manifest as the exact review baseline. The manifest records `HEAD` and a dirty worktree; do not imply the reviewed working tree is committed. The prior v2 report is historical and must remain unchanged.
