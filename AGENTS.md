# Repository Guidelines

## Project Structure & Module Organization

The product requirements document (`Living_Commitments_Protocol_[LCP]-PRD.md`), engineering baseline (`Living Commitments Protocol - Technical Specification.md`), and NEAR hackathon instructions (`NEAR-HACKATHON-SKILL.md`) live at the root. The NEAR contract is in `contracts/lcp-core`; the OutLayer WASI evaluator is in `evaluators/maintenance-heartbeat`; the TypeScript client and NEAR JSON-RPC view transport are in `packages/sdk`; the Next.js LCP Console is in `apps/console`; the Cloudflare D1 event indexer is in `services/event-indexer`.

## Build, Test, and Development Commands

Build the Rust workspace with `cargo build -p lcp-core -p maintenance-heartbeat`. Build the evaluator WASM with `cargo build -p maintenance-heartbeat --target wasm32-wasip2 --release`. Install JavaScript workspaces with `npm install`, then build the SDK with `npm --prefix packages/sdk run build`. Run the LCP Console with `npm run dev --workspace=@lcp/console` after configuring `apps/console/.env.local` from `.env.example`. Run the indexer locally with `npm run dev:indexer`; apply D1 migrations with Wrangler. Run contract unit tests with `cargo test -p lcp-core`; keep examples reproducible against NEAR testnet.

## Coding Style & Naming Conventions

For Markdown, use descriptive ATX headings, short paragraphs, and fenced code blocks labeled with their language. Preserve the specifications' terms and capitalization for commitment states (`Healthy`, `AtRisk`, `Breached`, `Challenged`, `Recovered`). In code, follow the formatter and linter configured by each module; use Rust snake_case for functions and fields, and TypeScript camelCase for functions and variables. Quote root document paths in shell commands because filenames contain spaces and brackets.

## Testing Guidelines

Add tests alongside each implementation module. Contract tests use NEAR's mock runtime and deterministic timestamps to cover state transitions, callback handling, and escrow accounting. Cover temporal boundaries, stale or mismatched evaluation results, authorization, recovery, and escrow accounting as specified in the technical baseline. Run `cargo test -p lcp-core` for contract changes; report checks run and any that could not be run.

## Commit & Pull Request Guidelines

The first commit uses a Conventional Commit subject (`feat: add NEAR commitment evaluation core`). Continue with concise `<type>: <imperative summary>` subjects, such as `docs: clarify recovery semantics`. PRs should summarize behavior or specification changes, identify affected documents or modules, link related issues, and include test evidence. Add screenshots only for user-interface changes.

## Architecture & Configuration Notes

Treat the technical specification as the engineering baseline and keep it consistent with the PRD. NEAR blockchain time is authoritative for on-chain transitions; evaluator verdicts do not directly transfer funds. Keep credentials, signing keys, and personal submission data out of committed files.
