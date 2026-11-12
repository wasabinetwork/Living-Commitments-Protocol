# Bounded Payout Adapter

This NEAR contract is the first LCP-compatible consequence adapter. Each deployed instance is initialized with one LCP contract, one fixed recipient account, and an explicit pool-manager account. It accepts public pool funding, but a payout requires both the configured LCP caller and an LCP-recorded grantor equal to the pool manager. The adapter checks its fixed recipient and available pool before transferring NEAR, then restores the pool balance if NEAR transfer reconciliation fails. The pool manager can withdraw available funds to their connected account; that asynchronous transfer is also reconciled if it fails.

The LCP grant binds this adapter account and recipient to one commitment. It sets the exact `bounded_payout` capability, per-action limit, cumulative limit, expiry, and replay nonce. LCP authorizes at most one action per commitment epoch, only while that commitment is Active and Healthy with no pending evaluation or challenge. To spend this adapter's pool, the grant creator must also be its configured pool manager; therefore that account must be the commitment sponsor or beneficiary. An authorized amount is charged against the LCP grant when the adapter call is issued; if the adapter call itself fails, that authorization remains consumed as a conservative limit.

An adapter instance does not control a user's NEAR account or keys. It can only spend funds deposited into its own pool and send them to its configured recipient. The pool manager can recover only the unreserved available pool, and cannot withdraw a payout or withdrawal already settling. Deploy and fund an instance separately, inspect its account and code, and grant only the capability and limits intended for that recipient. LCP binds the grant to the adapter account ID, not its code hash. A `FullAccess` key on the adapter account can replace its code. For v1 mainnet, follow the immutable-account release gate in the repository's [TESTING.md](../../TESTING.md): audit and reproducibly build first, deploy and verify, then remove every adapter-account access key and confirm the finalized key list is empty. Keep testnet adapter accounts upgradeable during development.

```sh
cargo build -p lcp-bounded-payout-adapter --target wasm32-unknown-unknown --release
```

This direct build is for local development. Build release WASM with `cargo near build reproducible-wasm --manifest-path contracts/bounded-payout-adapter/Cargo.toml` from the repository root.
