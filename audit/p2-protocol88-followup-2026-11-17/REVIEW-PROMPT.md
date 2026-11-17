# Independent Review Prompt

You are reviewing a local NEAR Sandbox acceptance package for LCP's feature-gated
USDC receipt-recovery code. Work from a fresh checkout of the candidate branch
tip that contains this package. Treat the review as independent: verify source
and capture hashes yourself, and do not rely on a prior agent's verdict.

## Safety and scope

- Review and test only in an isolated local NEAR Sandbox. Do not use testnet,
  mainnet, `.env.testnet`, wallet credentials, or deploy public contracts.
- Do not edit, commit, push, or deploy candidate code. Keep any probes and the
  final report outside the candidate checkout or in a separate review worktree.
- This is not a deployment approval. The LCP contract does not verify receipt
  Merkle proofs; independent operators attest to a receipt interpretation.

## Required review

1. Read this package's [`README.md`](README.md), the recovery design and
   operator-policy annex, `contracts/lcp-core/src/receipt_recovery.rs`,
   `contracts/lcp-core/src/recovery_config.rs`, the Sandbox runner, and all four
   linked follow-up captures.
2. Verify the source and tooling manifests. Independently reproduce the pinned
   NEP-330 core SHA-256 and NEAR code hash from source commit
   `950e3cb50fd79f559f5b6ff725fbfa32db70a063` using the pinned container image.
3. Run the default protocol-88 fixture, full recovery lifecycle,
   bootstrap-after-activity guard, and storage-revaluation OOG/retry cases from
   a clean local Sandbox. Save exact commands, environment versions, build
   hashes, and complete output logs. Compare assertions and final state; local
   chain IDs and transaction/receipt IDs will differ.
4. Independently inspect raw receipt bodies and outcomes. Test or analyze the
   normative receipt-to-intent cases in the design, especially multiple
   outgoing actions/origins, duplicate or ambiguous intent events, action
   argument canonicality, action-order code identity, missing ancestry,
   `SuccessReceiptId` with a failing child, provider disagreement, unsupported
   contract metadata, and token rollback semantics. Any unsupported or
   ambiguous observation must remain `Unknown`/abstain.
5. Review migration and storage claims beyond the supplied captures: missing,
   malformed, or mixed sidecars; interrupted initialization; counter/generation
   overflow and restoration; stale-state restoration; maximum-size envelopes;
   and worst-case gas/storage boundaries. Distinguish tested bounds from
   production recommendations.

## Report format

Return a separate Markdown report containing:

- Candidate commit, contract source commit, WASM SHA-256/code hash, Sandbox and
  tool versions.
- Commands run and pass/fail results for each capture.
- A table of each receipt-mapping, migration, and gas/storage case marked
  reproduced, contradicted, not exercised, or blocked.
- New findings with severity, source path/line, impact, reproduction, and a
  narrow remediation suggestion. State explicitly when a result is a static
  inference rather than a runtime reproduction.
- A scoped verdict: approve or withhold the next local acceptance gate. Do not
  approve a testnet canary, mainnet deployment, or production use based on this
  review.
