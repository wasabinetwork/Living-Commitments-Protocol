# Independent Follow-up Review: USDC Receipt Recovery

## Review objective

Review the local receipt-recovery candidate after remediation of the five findings in [`P2-USDC-RECEIPT-RECOVERY-IMPLEMENTATION-REVIEW.md`](../../P2-USDC-RECEIPT-RECOVERY-IMPLEMENTATION-REVIEW.md). Decide whether the code and documentation are ready to proceed to isolated NEAR VM/Sandbox acceptance. This is not a testnet canary or deployment approval.

Use the exact paths and SHA-256 values in [`review-manifest.json`](review-manifest.json). The source comes from a dirty worktree based at commit `f4c4fccf5f6d0a2d268425e9722eaeea2fd49bed`; the baseline commit does not identify the candidate. Verify all hashes before reviewing. The portable archive contains the complete root Cargo workspace, all workspace member sources and tests, locked dependencies, recovery vectors, Sandbox harness source, and the prior findings and normative documents. It excludes `.env*`, credentials, `node_modules`, Git history, and build outputs.

## Required follow-up checks

1. **H1 — Failed native-refund callback credits:** verify that failure checked-adds the attempt amount to any existing payer credit, leaves aggregate liability unchanged because the attempt was already counted, and rolls back atomically on overflow. Check duplicate and stale callback handling.
2. **H2 — Bootstrap safety:** verify bootstrap fails once any commitment, challenge, or transfer ID has been allocated. Include an FT transfer already in flight before attempted bootstrap and confirm it cannot become an untracked recovery liability.
3. **M1 — Withdrawal readiness:** verify `withdrawal_available` requires both current baseline solvency and cash for the full proposed credit outflow. Check the view's `cash_solvency_ready`, `withdrawal_cash_margin_ready`, and `withdrawal_outflow_yocto` against execution at exact and one-yocto-short boundaries.
4. **L1 — Runtime observation guidance:** distinguish lazy Rust SDK `Promise` builder creation from host-action materialization on drop. Confirm the candidate's cash check includes all planned outflows in `X` before materialization, including staged action construction and multiple outflows. The updated Sandbox probe has not been run; assess whether its assertions correctly measure both phases.
5. **Package reproducibility:** Cargo previously could not load the workspace because package members and `contracts/lcp-core/src/temporal.rs` were omitted. This archive contains every root workspace member. Run the relevant contract tests and default/feature Wasm checks in this extracted package; report exact commands, toolchain, and any dependency or target limitations.

Suggested compile/test commands from the extracted archive root:

```sh
cargo test --locked -p lcp-core
cargo test --locked -p lcp-core --features usdc-receipt-recovery
cargo check --locked -p lcp-core --target wasm32-unknown-unknown --lib
cargo check --locked -p lcp-core --target wasm32-unknown-unknown --lib --features usdc-receipt-recovery
cargo check --locked -p lcp-core --target wasm32-unknown-unknown --lib --features sandbox-callback-fixture
```

Do not run the Sandbox acceptance matrix as part of this source-review gate. If the implementation review approves advancement, the next phase separately runs the updated isolated VM/Sandbox cases in the design, including runtime host-action timing and callback/credit reproductions.

## Reviewer constraints and deliverable

- Do not deploy, upgrade, bootstrap a network contract, submit transactions, or inspect credentials.
- Do not modify the candidate. If a manifest hash differs, stop and request a refreshed archive.
- Separate source findings, commands actually run, assumptions, and unresolved runtime behavior. The prior receipt-proof trust boundary remains: the contract verifies threshold attestations, not NEAR receipt proofs.
- Write the follow-up report at repository root as `P2-USDC-RECEIPT-RECOVERY-IMPLEMENTATION-FOLLOWUP-REVIEW.md`.
- Choose **Approve for isolated NEAR VM/Sandbox acceptance**, **Approve with required changes**, or **Reject**. Approval means only that isolated acceptance may begin; it does not approve a testnet canary, production upgrade, or mainnet release.
