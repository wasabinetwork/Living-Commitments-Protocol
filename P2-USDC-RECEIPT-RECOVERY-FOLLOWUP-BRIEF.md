# Independent Follow-Up Review Brief: USDC Receipt Recovery

## Review objective

Independently assess whether the proposed threshold-attestation design in [P2-USDC-RECEIPT-RECOVERY-DESIGN.md](P2-USDC-RECEIPT-RECOVERY-DESIGN.md) closes the design blockers PR-1 through PR-3 in [P2-USDC-RECEIPT-RECOVERY-AUDIT.md](P2-USDC-RECEIPT-RECOVERY-AUDIT.md), without introducing a path to release unpaid USDC or double-settle a transfer. Review the design and current code; do not implement changes or send blockchain transactions.

For this project, the owner accepts a review performed by GPT-Sol in a fresh isolated session as an independent automated review. Identify the reviewer, model/session isolation, date, files and hashes reviewed, tools/checks used, and limitations. Do not describe it as a signed security-firm audit or validator-level proof verification.

## Materials to inspect

- `P2-USDC-RECEIPT-RECOVERY-DESIGN.md`
- `P2-USDC-RECEIPT-RECOVERY-AUDIT.md`
- `contracts/lcp-core/src/contract.rs` and `contracts/lcp-core/src/models.rs`
- `tests/sandbox-usdc-callbacks/run.mjs`, `README.md`, and `contracts/sandbox-mock-ft/src/lib.rs`
- `P2-USDC-INDEPENDENT-AUDIT-REPORT.md`, `P2-USDC-INDEPENDENT-AUDIT-FOLLOWUP.md`, and the USDC section of `TODO.md`

The working tree may include unrelated changes. Record the current commit and source hashes. Treat the local Sandbox harness as evidence only for the cases it actually runs; no receipt-proof verifier or recovery entry point exists.

The review input commit, file SHA-256 values, and local Sandbox artifact hashes are captured in [the follow-up review manifest](audit/p2-receipt-recovery-2026-11-15/followup-review-manifest.json). The worktree is intentionally uncommitted, so use those hashes when identifying the exact review inputs.

## Required review questions

1. **Receipt linkage:** Can a 3-of-5 signer certificate unambiguously bind one LCP-created transfer intent to the exact NEP-141 action receipt and finalized result? Identify missing receipt ancestry, action, predecessor, token, method, memo, or intent fields. Consider duplicate identical transfers, another LCP deployment, unrelated senders, and failed receipts with no token log.
2. **Trust and finality:** Is the attestation model's trust boundary honestly and completely described? Review operator independence, canonical chain/genesis selection, finality and reorg handling, signatures over the exact same canonical bytes, distinct signer counting, compromised/lost keys, liveness, rotation delay, retained epochs, and committee failure. State whether 3-of-5 provides adequate safety for escrow recovery or recommend a different threshold/model.
3. **Signature/certificate format:** Is the domain-separated Borsh schema canonical and versioned? Are account IDs, hashes, transfer kind, epoch, amount, outcome, and contract instance bound without ambiguity or cross-network replay? Are bounds and malformed input handling specified?
4. **Settlement races:** Does one atomic internal settlement path safely arbitrate callback-first and recovery-first outcomes? Test the reasoning for duplicate certificates, contradictory outcomes, old callback after retry, repeated receipt/action proof, pending-record removal, terminal replay, storage migration, and missing/mismatched sidecars.
5. **Failure semantics:** Are unknown/malformed promise results always pending? Does any callback path still treat missing results/state as a proven failure or native NEAR transfer? Does a certified failure prove that the original token transfer did not execute?
6. **Operational feasibility:** Estimate verification gas, persistent storage, certificate size, invalid-submission cost, archival receipt availability, committee key operations, and user-facing handling of permanently pending legacy v1 transfers. Identify prerequisites that block implementation.
7. **Tests:** Propose a concrete adversarial acceptance matrix for the design and its implementation. Mark which cases are already covered by the Sandbox harness and which remain untested.

## Expected report

Return one of: **approve for implementation**, **approve with required changes**, or **reject the design**. List each finding with severity, exact file/section, a concrete failure scenario, required remediation, and a regression test. Separate verified observations from assumptions and untested claims. If the design is not safe enough, recommend retaining pending reservations and explain the blocker.

Save the response as `P2-USDC-RECEIPT-RECOVERY-FOLLOWUP-REVIEW.md`. Do not mark recovery accepted or mainnet-ready merely because the design review passes; implementation, Sandbox acceptance, and review of the actual verifier remain separate gates.
