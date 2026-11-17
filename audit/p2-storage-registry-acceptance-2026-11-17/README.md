# Independent Review: Storage-Bond Registry Bounds

## Objective

Review the provisional storage-bond registry cap and revaluation batch implementation, and independently reproduce the isolated Sandbox measurements. This review does not authorize a testnet canary, contract upgrade, or production deployment.

The portable [`review-inputs.zip`](review-inputs.zip) contains the tracked repository source snapshot at commit `bd6ac7a` (full hash in [`review-manifest.json`](review-manifest.json)), excluding this review-package directory to avoid nesting the archive. It contains no Git history, credentials, `.env.testnet`, local build output, or `node_modules`.

## Review scope

1. Confirm `MAX_STORAGE_BOND_RECORDS = 2,048` is enforced across every registry owner type, and a failed 2,049th admission rolls back both the registry count and payer-credit row.
2. Review the fixture seed method's exact attached-deposit rule (`count × admission_excess_yocto`), checked arithmetic, and feature/chain/account/predecessor gates. Confirm it is absent from a release build that omits `sandbox-callback-fixture`.
3. Confirm funded credits increment recovery liability `Q` by their exact admission excess; the captured 0.64 NEAR deposit remains accounted while `Pending` and unchanged by storage revaluation.
4. Review the 64-record revaluation bound, index progression, completion, and reserve readiness before, during, and after maintenance. Confirm the oversized 65-record batch rejects.
5. Independently reproduce the 10 Tgas out-of-gas batch. Verify the pending credit, `Q`, and registry remain unchanged; zero-length and out-of-sequence calls reject without state changes; retry from record zero advances to 64 and the next batch completes.
6. Rebuild the default release artifact without features, inspect its Wasm exports, and confirm required production methods remain while all `sandbox_*` fixture exports are absent.
7. Assess whether the measured storage and gas evidence supports retaining these provisional bounds. Do not treat fixture measurements as worst-case gas or final production limits.

## Reproduction

Verify the archive hash against the manifest, then extract it and use the pinned Rust toolchain:

```sh
shasum -a 256 review-inputs.zip
unzip -q review-inputs.zip -d /tmp/lcp-storage-registry-review
cd /tmp/lcp-storage-registry-review
```

Follow the optimized Sandbox build and run instructions in `tests/sandbox-usdc-callbacks/README.md`. For the focused rollback scenario, run the command under “Storage-reserve revaluation out-of-gas rollback and retry.” For release feature exclusion, run the command under “Release artifact feature boundary.” Both captures and source checksum manifests are included.

The recovery-enabled Rust suite command is:

```sh
cargo test --locked -p lcp-core --features 'sandbox-callback-fixture usdc-receipt-recovery'
```

The recovery-enabled suite passed 100 tests in the preceding acceptance run. The contract source is unchanged from that run; repeat the command as part of independent review. The Sandbox capture uses version 2.14.0 / protocol 88. The release feature-boundary capture records its compiler, source revision, Wasm digest, and NEAR code hash. No public network was used.

The captures cover the 2,048-record cap, rejection of record 2,049 and an oversized batch, maximum-length payer rows, funded pending-credit accounting, OOG rollback, invalid batch rejection, successful retry, and the no-fixture release export set. Older capacity captures retain their own source manifests and source commits; the OOG and release captures use the package snapshot revision.

## Known limitations

- The capacity run uses short `sandbox` payer IDs; maximum-length payer runs cover only 64 records, not a full-cap distribution.
- Measurements are local protocol-88 Sandbox observations, not real-network results, worst-case gas bounds, reproducible-build verification, or a production funding recommendation.
- Independent reproduction, other record-state/payer distributions, and the broader receipt-recovery matrix remain open.

## Reviewer deliverable

Provide an independent report listing archive and source hashes verified, exact commands and toolchain, cases reproduced, source-level findings, and unresolved limitations. Recommend whether the provisional 2,048/64 bounds should remain, be reduced, or receive more stress testing. Do not deploy, upgrade, bootstrap a public contract, or inspect credentials.
