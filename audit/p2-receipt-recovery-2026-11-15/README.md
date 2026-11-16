# Receipt recovery review evidence

Report: [P2-USDC-RECEIPT-RECOVERY-AUDIT.md](../../P2-USDC-RECEIPT-RECOVERY-AUDIT.md).

- `review-manifest.json`: hashes of the exact working-tree proposal, context and implementation inputs.
- `callback-probes.rs`: three test functions inserted before the closing brace of the current contract's existing `mod tests` in an isolated export. They use existing test fixtures; no implementation statements were altered. The first two prove integration hazards, not successful safety properties or externally reachable exploits.
- `callback-probes.log`: focused probe run, 3 passed.
- `current-core-tests.log`: complete current suite with the probes, 79 passed.
- `core-rebuild.log`, `rebuild-result.json`: fresh clean detached-worktree core reproduction and exact artifact comparison.
- `adapter-rebuild.log`: separate adapter reproduction using the same requested revision and pinned build procedure.

To rerun tests, export HEAD into a separate directory, copy the current contract/models matching the manifest hashes, insert `callback-probes.rs` inside the existing test module, then run `cargo test --locked --manifest-path <export>/Cargo.toml -p lcp-core`. The review used the pinned Rust 1.100.0 toolchain.

To reproduce the build, create a clean detached worktree at `e9074ddced4be9dce4dd4c1061909f7869054cf1` and run the two `cargo near build reproducible-wasm` commands in `TESTING.md`. Do not use the test export (which has injected tests and lacks a fresh clean Git checkout) as the reproducible-build source. The historical artifact does not include any receipt-recovery implementation.
