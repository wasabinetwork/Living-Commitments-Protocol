# Repository Guidelines

## Project Structure & Module Organization

The product requirements document (`Living_Commitments_Protocol_[LCP]-PRD.md`), engineering baseline (`Living Commitments Protocol - Technical Specification.md`), and NEAR hackathon instructions (`NEAR-HACKATHON-SKILL.md`) live at the root. NEAR contracts are in `contracts/lcp-core` and `contracts/bounded-payout-adapter`; OutLayer evaluators are in `evaluators/maintenance-heartbeat` and `evaluators/service-availability`; the TypeScript client is in `packages/sdk`; the Next.js LCP Console is in `apps/console`; and Cloudflare Workers are in `services/event-indexer` and `services/reviewer-access`.

## Build, Test, and Development Commands

Use the pinned Rust toolchain in `rust-toolchain.toml`. Build NEAR contracts with `cargo build -p lcp-core -p lcp-bounded-payout-adapter --target wasm32-unknown-unknown --release --locked` and evaluator WASM with `cargo build -p maintenance-heartbeat -p service-availability-evaluator --target wasm32-wasip2 --release --locked`. Install JavaScript workspaces with `npm ci`, then build the SDK with `npm run build:sdk`. Run the LCP Console with `npm run dev --workspace=@lcp/console` after configuring `apps/console/.env.local` from `.env.example`. Run Workers locally with `npm run dev:indexer` or `npm run dev:reviewer-access`; apply D1 migrations with Wrangler. Run the Rust suite with `cargo test --workspace`, evaluator probe checks with `node --test evaluators/service-availability/test/probe.test.mjs`, and local dependency audits with `cargo audit --file Cargo.lock` and `npm audit --audit-level=high`. Keep examples reproducible against NEAR testnet.

## Coding Style & Naming Conventions

For Markdown, use descriptive ATX headings, short paragraphs, and fenced code blocks labeled with their language. Preserve the specifications' terms and capitalization for commitment states (`Healthy`, `AtRisk`, `Breached`, `Challenged`, `Recovered`). In code, follow the formatter and linter configured by each module; use Rust snake_case for functions and fields, and TypeScript camelCase for functions and variables. Quote root document paths in shell commands because filenames contain spaces and brackets.

## Testing Guidelines

Add tests alongside each implementation module. Contract tests use NEAR's mock runtime and deterministic timestamps to cover state transitions, callback handling, authorization, and escrow accounting. Include exact temporal boundaries, stale or mismatched evaluation results, amendment consent, adapter limits, and transfer recovery. Worker and SDK changes should cover signed request binding, privacy retention, encryption, replay protection, and error handling. Report checks run and any that could not be run.

GitHub Actions uses the pinned toolchain in `rust-toolchain.toml`; it runs Rust and JavaScript tests, WASM builds, Worker dry-run checks, `cargo audit`, and `npm audit`. Dependabot updates npm, Cargo, and workflow dependencies weekly.

## Commit & Pull Request Guidelines

The first commit uses a Conventional Commit subject (`feat: add NEAR commitment evaluation core`). Continue with concise `<type>: <imperative summary>` subjects, such as `docs: clarify recovery semantics`. PRs should summarize behavior or specification changes, identify affected documents or modules, link related issues, and include test evidence. Add screenshots only for user-interface changes.

## Architecture & Configuration Notes

Treat the technical specification as the engineering baseline and keep it consistent with the PRD. NEAR blockchain time is authoritative for on-chain transitions; evaluator verdicts do not directly transfer funds. Keep credentials, signing keys, and personal submission data out of committed files.
