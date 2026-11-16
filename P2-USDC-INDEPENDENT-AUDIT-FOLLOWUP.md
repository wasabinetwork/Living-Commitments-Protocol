# USDC Independent Audit Follow-up

**Updated:** 2026-11-15
**Audit:** [P2-USDC-INDEPENDENT-AUDIT-REPORT.md](P2-USDC-INDEPENDENT-AUDIT-REPORT.md)
**Status:** Controlled testnet funding, storage, beneficiary payout/retry, and concurrent funding checks passed. Focused local callback OOG, failure/retry, and four-transfer concurrency also passed in NEAR Sandbox. Broader stress and independent artifact reproduction remain open; this is not mainnet approval.

**Local recovery work (2026-11-16):** a separate `usdc-receipt-recovery` feature now connects persisted transfer intents, strict certificate verification, callback/certificate settlement, measured payer credits, and the fresh-instance cash/storage-reserve accounting. The default and feature-enabled Wasm targets compile. This is a new local candidate, not part of the audited or deployed artifact above; it has not passed NEAR VM acceptance, an independent implementation review, or a testnet canary.

The audit report is retained unchanged as the reviewer’s record. The examined contract artifact is deployed on testnet with code hash `7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`. No contract logic was changed for these checks. Source comments now record the callback-gas observation and why pending token transfers must not be released by timeout.

## Live acceptance on testnet

Commitment **#41** was created for a disposable USDC test. A temporary child account was registered, funded, then unregistered and deleted after cleanup. Existing sponsor and LCP USDC balances both returned to their starting value of 40,000,000 atomic units.

- The token reports `USDC`, six decimals, and fixed storage bounds of `1,250,000,000,000,000,000,000` yoctoNEAR. Fresh registration returned that total with zero available. Re-registering an existing account with `registration_only: false` left its bounded balance unchanged and refunded the deposit.
- A non-sponsor attempted to fund the commitment with 100,000 units. LCP accepted zero; the token resolver returned all 100,000, and the LCP balance and escrow remained unchanged.
- Sponsor funding accepted 600,000 units, then accepted only 1,400,000 from a 1,600,000-unit call and returned the 200,000 excess. A further 50,000-unit call was returned in full. The commitment reached exactly 2,000,000 funded units.
- The sponsor was unregistered after funding. Its 2,000,000-unit refund transfer failed; LCP reconciled `pending=0`, `refunded=0`, and `free=2,000,000`. After registration, retry succeeded and reconciled `pending=0`, `refunded=2,000,000`, and `free=0`.
- The successful and failed refund callback receipts used 3.0085 and 3.0014 Tgas respectively, against the configured 20 Tgas callback allocation. This is an observed refund-path measurement, not a worst-case or claim-path measurement.

At finalized block `277761803`, commitment `41` was `Closed`, with `funded_raw=2,000,000`, `refunded_raw=2,000,000`, and `pending_raw=free_raw=paid_raw=0`. Sponsor and LCP each held 40,000,000 atomic USDC, and LCP storage remained at the token's minimum. Detailed transactions and final-state checks are recorded in [TESTNET-E2E-STATUS.md](TESTNET-E2E-STATUS.md).

### Commitment 42: beneficiary claim failure, retry, and operations refund

Commitment `42` used a disposable beneficiary subaccount. A fresh wallet-key-signed heartbeat was accepted as `Accepted / Compliant` by OutLayer. After the five-minute challenge window, the first `0.01 USDC` claim failed because the beneficiary had no NEP-145 registration. LCP's callback restored the full tranche to free escrow with no pending transfer. After registering the beneficiary, the retry settled as `Paid`; the test payout was returned to the sponsor, the storage registration was removed, and the temporary account was deleted.

| Check | Result and transaction |
| --- | --- |
| Create commitment | [Commitment 42](https://testnet.nearblocks.io/txns/CEGYFt9NvqhUj6bDoGFDBos3b8MrTbFAo7zMh2y5asXX) |
| Fund 0.01 USDC / operations | [USDC funding](https://testnet.nearblocks.io/txns/HWw5ZuRng8XYnrNZaLRsry2Z58BjAFY8VsMVQhDhwCvG) · [0.03 NEAR operations](https://testnet.nearblocks.io/txns/3VWoMYwrUqq6HhPh4DoUeu3bABUS5mem1gQdYbZH52Rg) |
| Activate / accepted evaluation | [Activation](https://testnet.nearblocks.io/txns/J7TKLBgm529RHQtxFkzajev52472MtG2qj94VGwHCd5P) · [Accepted / Compliant evaluation 1](https://testnet.nearblocks.io/txns/CfJnrg8XM8shLcfGTHjwmr2WRbAUWvZKi98AMYASNQSX) |
| Failed unregistered-beneficiary claim | [Claim and callback](https://testnet.nearblocks.io/txns/5yxQm1p3iqhrE8NEadTpSrpcAjtXvRi8S83PRF1u1zLR); `tranche_transfer_failed`, then `pending_raw=0`, `free_raw=10,000` |
| Register and retry | [NEP-145 registration](https://testnet.nearblocks.io/txns/93cVgVJrAzwnLmY5Gmeb9JfDCJ6WmmAoQJRJqR8rPiHK) · [Paid retry](https://testnet.nearblocks.io/txns/4SDsWMiWTtCaYhFi4MHXtMkVWhzRRA4s56XfUYyJsnvH) |
| Return payout and clean up | [Return 10,000 units](https://testnet.nearblocks.io/txns/DqVy7DjGHpH5c4tmRs5weNpC11Zfb3xXqg3GA9skiL6U) · [Unregister](https://testnet.nearblocks.io/txns/8L25ZdUNzS4wRq7QxkJ5P3acfsTrKGnAvcFVnpkFLrCB) · [Delete beneficiary](https://testnet.nearblocks.io/txns/AZWXBbKMCHoU26LTJyeS2KniMDNgcgCgPb4TtNUCPNr8) |
| Close and refund unused operations | [Close](https://testnet.nearblocks.io/txns/GJ2zmV2zEXvmYgtTAZs3qmNFfUrg4AbxKDNztAZQDmke) · [Refund](https://testnet.nearblocks.io/txns/Hs6MKhR4cwiDhQ6Lb8c2dnRg7G897qVeR9CSc9SJQFxA) |

The finalized commitment is `Closed`, `Paid`, with `funded_raw=paid_raw=10,000`, `pending_raw=free_raw=refunded_raw=0`, and no pending transfers. Operations accounting settled at `0.01 NEAR` authorized out of `0.03 NEAR` funded. Sponsor and LCP USDC balances returned to 40,000,000 atomic units.

The LCP callback receipts consumed **3.241328158245 Tgas** for the failed claim and **3.246526376967 Tgas** for the successful retry, against the deployed 20 Tgas callback allocation. Both ordinary paths settled; this is a single acceptance sample, not a worst-case or forced-OOG test.

### Commitment 43: overlapping funding transactions

Two `ft_transfer_call` transactions were submitted concurrently, each for 6,000 raw USDC against a 10,000-unit funding cap. Final accounting accepted exactly 10,000 units, returned 2,000 units through the resolver, and left no pending amount. Closing the unactivated commitment and refunding accepted escrow restored both established token balances to 40,000,000 units.

| Check | Result and transaction |
| --- | --- |
| Create commitment | [Commitment 43](https://testnet.nearblocks.io/txns/6KvbaMScd3rX9oVW5PeABMr4fZ3MECQweNyTrawfqhJV) |
| Concurrent funding | [Request 1](https://testnet.nearblocks.io/txns/BmgvkEh5WqH9aPposW4N4ncaTYM6jX45Nr1AxJXPkWMP) · [Request 2](https://testnet.nearblocks.io/txns/EvuKur4Y8VWfC8772T9J3SRcHDF71o5Sju9eVCeLFHbc) |
| Close and refund | [Close](https://testnet.nearblocks.io/txns/9nD81oMX2NAuSLN3crU8LYoxxJCoatkkmEQwv2GhGkK4) · [Refund](https://testnet.nearblocks.io/txns/8z7SZqGAiHawJE2wxyQ4mFAc84zTheYbuFQSf4gEWcYo) |

Final state: commitment `43` is Closed with `funded_raw=refunded_raw=10,000`; `paid_raw=pending_raw=free_raw=0`.

### Reproducible build

The exact deployed source revision `e9074ddced4be9dce4dd4c1061909f7869054cf1` was rebuilt from a clean detached worktree with the pinned `sourcescan/cargo-near:0.23.0-rust-1.100.0` image. The output matched the deployed 759,388-byte artifact exactly: SHA-256 `5c01aa15fee13a03a71fdada304f358f22e608c424525f37892182ac1e649bff`, code hash `7C9yrP36jPKdbAVaV9LgH7fLQ4yRGTZSRBQ83RgbDage`. This is a repeat build in the project environment, not an independent third-party reproduction.

## Findings and remaining gates

| Finding | Current status |
| --- | --- |
| **R1 — callback failure can leave a transfer pending** | Failed and successful beneficiary callbacks each consumed about 3.24 Tgas against 20 Tgas; both ordinary paths settled and local tests preserve pending state when a callback does not run. The Sandbox harness confirms a successful token receipt plus 2 Tgas callback OOG leaves the LCP reservation pending, explicit token failure frees the amount, retry pays once, and four same-amount concurrent transfers settle independently. On 2026-11-15, the isolated protocol-88 harness also captured missing-code failure, rollback after a token writes then panics, success code identity, and both same-receipt deploy/call orders in V4 metadata; raw output is in `tests/sandbox-usdc-callbacks/protocol-88-receipt-fixture.json`. Broader stress and certificate/recovery races remain untested. No timeout-based release was added. The targeted v2 and v3 reviews returned **Approve with required changes**; the v4 review approved implementation planning with no new findings and closed V3-1/V3-2 at specification level. Deterministic vectors have positive Rust/Node parity, and the standalone Rust utility rejects strict-Ed25519 negative cases; parser and eventual contract-verifier mutations, independent fixture reproduction, and full native Promise integration into the cash gate remain open. In particular, `refund_excess` has an `on_excess_refund` callback but no attempt-ID ledger, and `withdraw_storage_refund_for_caller` removes credit before sending. |
| **R2 — resolver and token assumptions** | Concurrent testnet funding and local receipt-order permutations preserve the cap. Exact funding, excess resolution, wrong-sponsor return, and sponsor refund/retry passed. Issuer pause/restriction remains untested and will not be deliberately triggered on the shared token. |
| **R3 — registration and outgoing transfer behavior** | Fresh registration, existing-account re-registration/refund, storage bounds, sponsor refund retry, successful beneficiary payout, failed unregistered-beneficiary claim, and retry after registration passed. |

V4 is approved for implementation planning only. Deterministic synthetic vectors now have positive Rust/Node parity, a read-only native Promise inventory is prepared, and strict signature acceptance is specified as `ed25519-dalek 2.2.0` `VerifyingKey::verify_strict` semantics. Local protocol-88 rollback and action-order fixtures are captured; parser and contract-verifier mutation acceptance and independent fixture reproduction remain open. The owner selected charge-at-dispatch accounting for OutLayer execution deposits: the cash gate reserves the attached amount in the dispatch receipt, while callback failure or timeout never restores operations budget. The local candidate now wires native cash outflows and the feature-gated recovery path to the cash ledger. Independently review the verifier and complete adversarial NEAR VM acceptance before any testnet canary. Before mainnet, expand callback stress testing and obtain an independent reproduction of the deployed artifact. Issuer pause testing remains intentionally deferred. These results do not constitute Circle token, issuer-key, or mainnet security review.

## Standards interpretation

The NEP-141 `ft_transfer_call` return value is the amount **used** by the receiver; the unused amount is returned by the resolver. For example, a result of `0` with a 100,000-unit transfer means all 100,000 units were unused and refunded. The live acceptance verified this with token transfer events and balances. See [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md) and [NEP-145](https://github.com/near/NEPs/blob/master/neps/nep-0145.md).
