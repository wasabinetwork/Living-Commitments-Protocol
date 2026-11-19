# Environment record — 689fbf1 owner-machine rerun (2026-11-19)

## Operator and infrastructure

- Operator: the repository owner's coding agent (`free-pi` / Particle-1) running
  in the owner's shell on the owner's workstation.
- Infrastructure: the same physical machine and the same user account that
  produced the committed `689fbf1` captures. No separate account, key store, CI
  runner, or network path was used.
- Consequence: this run does **not** satisfy the independence requirement in
  `tests/sandbox-usdc-callbacks/INDEPENDENT-REPRODUCTION-689FBF1.md`. It is a
  mechanical reproduction attempt on the owner's side.

## Host

| Item | Value |
| --- | --- |
| Machine | `Gilbertos-iMac` (iMac, x86_64) |
| OS | macOS 15.8.3, build 24H241, Darwin 24.6.0 |
| Docker | 29.9.3, build 5457199 (Server architecture `x86_64`) |
| Host rustc | `1.100.0 (0ef1bc386 2026-11-09)` (from `rust-toolchain.toml`) |
| Host cargo-near | `0.23.0` |
| Host Node (verifiers only) | `v26.5.0` |
| Credentials used | none; no `.env`, `.env.testnet`, wallet key, or RPC credential was read |

## Containers (pulled locally, digests checked against the handoff pins)

| Image | Local digest | Pinned digest | Match |
| --- | --- | --- | --- |
| `sourcescan/cargo-near:0.23.0-rust-1.100.0` | `sha256:265b662a03642196c8a1b97cb8e1bff9156488b584a9e040e9ef1f264e1049f1` | same | yes |
| `node:26-trixie-slim` | `sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc` | same | yes |

- Container rustc (`sourcescan/cargo-near`): `1.100.0 (0ef1bc386 2026-11-09)`.
- Container Node (`node:26-trixie-slim`): `v26.13.1`.
- NEAR Sandbox 2.14.0, protocol 88, nearcore commit
  `bc4e9e8cfb03d9e82f027883055624e18576993e` (asserted by the verifiers and
  recorded inside each capture).

## Source trees used

| Purpose | Path | Commit | State |
| --- | --- | --- | --- |
| Reproducible WASM build | `/tmp/lcp-689fbf1-repro` (detached worktree) | `689fbf1bc464248b5a6ff019983ef8b415dcd819` | clean (`git status --porcelain` empty) |
| Capture runner + verifiers + `package-lock.json` | `/tmp/lcp-9e08339-pin` (detached worktree) | `9e08339068a1f21762beea18f27e5040060805af` | only the newly written capture directory and manifest are untracked |

The `9e08339` tree is used for the runner because `689fbf1` does not contain the
pinned `run.mjs`, `package-lock.json`, or verifiers; `9e08339` touches only
`TODO.md`, the test README, and `tests/sandbox-usdc-callbacks/**`, so the
contract sources in that tree are byte-identical to `689fbf1` (verified by the
source manifest, below).

## Isolation

- Sandbox cache, temporary directory, and downloaded `near-sandbox` binary were
  confined to `/tmp/lcp-689fbf1-sandbox` (`bin/`, `tmp/`, `out/`) mounted at
  `/sandbox-cache`, never to the host default or the original run's cache.
- Capture output was written to `/sandbox-cache/out` (outside the repository)
  and only afterwards copied into this evidence directory.
- No committed capture, manifest, or verifier under
  `tests/sandbox-usdc-callbacks/` was modified; `git status` on the main
  checkout shows this directory as new and untracked.
