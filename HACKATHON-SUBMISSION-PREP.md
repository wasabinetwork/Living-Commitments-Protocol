# NEAR HACKATHON Submission Prep

## Project description draft

Living Commitments Protocol turns ongoing commitments into time-aware agreements enforced by a NEAR smart contract. A sponsor defines an immutable evidence policy, funding schedule, and arbiter. The maintainer signs a heartbeat; an OutLayer WASM evaluator checks its binding and signature in a TEE and returns a verdict to NEAR. The contract derives health from evidence timestamps, applies challenge windows, and gates recurring payouts. Testnet exercises cover expiry, recovery, arbiter outcomes, failed-transfer retries, and escrow refunds. The LCP Console links evaluation transactions to OutLayer's public attestation report and compares its input, output, WASM, and transaction hashes with the contract record. OutLayer's TEE quote still requires its report verifier or the standalone `outlayer-verify` tool. The current evaluator verifies a signed maintenance statement; it does not independently prove real-world service quality.

## Recording outline

1. State the problem: recurring support often relies on dashboards or manual follow-up rather than evidence and deadlines that control settlement.
2. Open commitment `22` and show the recorded path from accepted evidence through challenge invalidation to recovery, then point out the policy-derived freshness and grace deadlines.
3. Open evaluation `2`, show that its public OutLayer transaction, input, output, and WASM hashes match the contract record, then open the report's **Verify** action and the NEAR transaction.
4. Show a completed payout/refund fixture (`19`) and its escrow totals. End with the contract-owned rule: the client reports state, while NEAR authorizes settlement.

Keep the recording focused on one user action and its on-chain consequence. Refresh snapshots before recording and verify every fixture is still in the expected state.

## Draft project post

> Recurring commitments should respond to evidence and deadlines, not a dashboard's promise. I built Living Commitments Protocol at NEAR HACKATHON: signed evidence, time-derived health, arbiter challenges, and payouts enforced by a NEAR contract. Open the LCP Console on testnet: [video] · [public repository]. @NEARProtocol #NEARHackathon

## Human decisions required before submission

Fill these from the official application form; do not guess: team lead name, contact email, team size, eligible track IDs, mainnet NEAR payout account, public repository URL, public project-post URL, and agreement to the contact notice. The human must review the exact payload and explicitly confirm it before submission. The project-authored code and documentation are licensed under Apache-2.0; `NEAR-HACKATHON-SKILL.md` is explicitly excluded. Verify that the repository and project post are public before submission; do not submit this draft itself.
