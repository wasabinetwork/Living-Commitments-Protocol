# Independent Review: Storage-Bond Registry Bounds

## Objective

Review the provisional storage-bond registry cap and revaluation batch implementation, and independently reproduce the isolated Sandbox measurements. This review does not authorize a testnet canary, contract upgrade, or production deployment.

The portable [`review-inputs.zip`](review-inputs.zip) is the complete tracked repository snapshot at commit `a7a0b2a1192711221cb723378b63f05c088aff6f`. Verify the archive and selected source/capture hashes in [`review-manifest.json`](review-manifest.json) before review. It contains no Git history, credentials, `.env.testnet`, local build output, or `node_modules`.

## Review scope

1. Confirm `MAX_STORAGE_BOND_RECORDS = 2,048` is enforced across every registry owner type, and that a failed 2,049th admission rolls back both the registry count and payer-credit row.
2. Review the fixture seed method's exact attached-deposit rule (`count × admission_excess_yocto`), checked arithmetic, and feature/chain/account/predecessor gates. Confirm it is absent from a release build that omits `sandbox-callback-fixture`.
3. Confirm each funded credit increments native recovery liability `Q` by its exact admission excess; the captured 0.64 NEAR deposit raises `Q` by exactly 0.64 NEAR, remains fully accounted while `Pending`, and is unchanged by storage revaluation.
4. Review the 64-record revaluation bound, index progression, completion behavior, reserve-ready state before/during/after revaluation, and rollback on an oversized 65-record call.
5. Assess whether the measured storage and gas evidence supports retaining these bounds. The measurements are fixture-specific; do not treat them as worst-case gas estimates or final production limits.

## Reproduction

Verify the archive hash against the manifest, then extract it and use the pinned Rust toolchain:

```sh
shasum -a 256 review-inputs.zip
unzip -q review-inputs.zip -d /tmp/lcp-storage-registry-review
cd /tmp/lcp-storage-registry-review
```

Follow the Sandbox build and run instructions in `tests/sandbox-usdc-callbacks/README.md`. The recovery-enabled contract suite was run with:

```sh
cargo test --locked -p lcp-core --features 'sandbox-callback-fixture usdc-receipt-recovery'
```

It passed 100 tests. The fixture WASM used for the funded-pending capture has SHA-256 `8bf0f73ccdd898f26089a2962dd589f908e69bc7bafeda732efd6b3054fae2db` and NEAR code hash `ARGnKRZTejPgjtLU7dkcvoAZ6NXQfmfEeMeuZCqBJ1DU`. Sandbox version 2.14.0 / protocol 88 ran locally; no public network was used.

The captures show: 2,048 records admitted; record 2,049 rejected without residue; 65-record revaluation rejected; 32 batches of 64 completed; and 64 maximum-length payer rows consuming 33,728 bytes. The funded variant attaches 0.01 NEAR per row and verifies the aggregate `Q` delta equals 0.64 NEAR, the credits remain `Pending` and non-withdrawable, and the liability is unchanged through revaluation.

The capacity and zero-value maximum-payer captures predate the current source snapshot and retain their own exact source manifests at commits `7f7c66eeb5c3fdda78f5b4afc84484bb7ab5d722` and `55126f386d058af085cb334c91ea876fe1fe14bf`. The funded-pending capture is from the package's source commit.

## Known limitations

- The 2,048-row cap run uses zero-value rows with the short `sandbox` payer ID. The separate 64-character payer runs cover a larger identifier but only 64 rows; a full-cap maximum-length distribution was not measured.
- These are local protocol-88 Sandbox observations, not real-network measurements, worst-case gas bounds, or a production funding recommendation.
- Independent reproduction, other record-state/payer distributions, and the broader receipt-recovery acceptance matrix remain open.

## Reviewer deliverable

Provide an independent report that lists the archive/source hashes verified, exact commands and toolchain used, cases reproduced, source-level findings, and unresolved limitations. Recommend whether the 2,048/64 values should remain provisional, be reduced, or receive more stress testing. Do not deploy, upgrade, bootstrap a public contract, or inspect credentials.
