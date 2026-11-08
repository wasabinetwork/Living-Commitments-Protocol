# Repository Guidelines

## Project Structure & Module Organization

The product requirements document (`Living_Commitments_Protocol_[LCP]-PRD.md`), engineering baseline (`Living Commitments Protocol - Technical Specification.md`), and NEAR hackathon instructions (`NEAR-HACKATHON-SKILL.md`) live at the root. The NEAR contract is in `contracts/lcp-core`; the OutLayer WASI evaluator is in `evaluators/maintenance-heartbeat`. Planned SDK, schema, integration-test, and demo modules should remain in clearly named directories. Update this guide as the layout changes.

## Build, Test, and Development Commands

Build the Rust workspace with `cargo build -p lcp-core -p maintenance-heartbeat`. Build the evaluator WASM with `cargo build -p maintenance-heartbeat --target wasm32-wasip2 --release`. A test suite and deployment workflow are not configured yet. Keep examples reproducible against NEAR testnet.

## Coding Style & Naming Conventions

For Markdown, use descriptive ATX headings, short paragraphs, and fenced code blocks labeled with their language. Preserve the specifications' terms and capitalization for commitment states (`Healthy`, `AtRisk`, `Breached`, `Challenged`, `Recovered`). In code, follow the formatter and linter configured by each module; use Rust snake_case for functions and fields, and TypeScript camelCase for functions and variables. Quote root document paths in shell commands because filenames contain spaces and brackets.

## Testing Guidelines

Add tests alongside each implementation module. Cover temporal boundaries, stale or mismatched evaluation results, authorization, recovery, and escrow accounting as specified in the technical baseline. Use deterministic timestamps for state-transition tests. Before proposing a change, run the relevant module's test and lint commands once those are configured; report any checks that could not be run.

## Commit & Pull Request Guidelines

The repository is initialized but has no commit history yet, so an established commit convention cannot be verified. Use concise imperative subjects, optionally with a scope (for example, `docs: clarify recovery semantics`). PRs should summarize behavior or specification changes, identify affected documents or modules, link related issues, and include test evidence. Add screenshots only for user-interface changes.

## Architecture & Configuration Notes

Treat the technical specification as the engineering baseline and keep it consistent with the PRD. NEAR blockchain time is authoritative for on-chain transitions; evaluator verdicts do not directly transfer funds. Keep credentials, signing keys, and personal submission data out of committed files.
