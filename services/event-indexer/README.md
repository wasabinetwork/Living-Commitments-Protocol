# LCP Event Indexer

This Cloudflare Worker polls finalized NEAR blocks, stores successful `lcp` events in D1, and exposes read-only paginated history. It does not determine commitment health, eligibility, or settlement; those remain contract reads.

## Local development

1. Install the monorepo dependencies with `npm install`.
2. Generate Worker binding types with `npm run types --workspace=@lcp/event-indexer`.
3. Apply the migration to local D1 with `npx wrangler d1 migrations apply lcp-event-indexer --local --config services/event-indexer/wrangler.jsonc`.
4. Start the Worker with `npm run dev:indexer`.

The checked-in testnet configuration starts at block `276808247`, the initial deployment block for `livingcommitmentsprotocol.testnet`. For a fresh database, Wrangler initializes its cursor at this height and catches up in bounded batches. Do not reuse that start height for another network or contract; change `NETWORK`, `CONTRACT_ID`, `SOURCE_BASE_URL`, and `START_BLOCK_HEIGHT` together.

## API

- `GET /health` reports the last indexed block, observed finalized head, catch-up lag, and the last stable error code.
- `GET /v1/events?commitment_id=24&limit=50` returns newest-first events. `next_before_id` can be sent as `before_id` to fetch the next page.
- `OPTIONS` supports browser CORS preflight. Origins are limited by `ALLOWED_ORIGINS`.

The deployed testnet endpoint is `https://lcp-event-indexer.wasabinetwork.workers.dev`. The LCP Console build can use this URL through `NEXT_PUBLIC_LCP_EVENT_INDEXER_URL`; production or another NEAR network should use an indexer configured for that network and contract.

The indexer fetches finalized blocks in batches of four and validates each block's parent hash in height order before persisting it. A shared request pacer spaces all source request starts by at least one second, including requests launched concurrently in one batch. Each block's event inserts and cursor advance commit in a single D1 batch, and event keys are idempotent. When FastNear returns `null` for an absent height, the indexer accepts the next available block only when its `prev_hash` matches the last indexed block hash. A trailing null does not advance the cursor; a failed fetch, invalid block, discontinuity, or write likewise leaves the cursor at the last complete block. Scheduled runs take a ten-minute D1 lease, so minute-level Cron triggers cannot overlap. The current conservative testnet run limit is 40 height slots per scheduled invocation, with at most 41 source reads including the finalized-head lookup. Higher-throughput runs returned HTTP 429 with `Retry-After: 0`, despite FastNear's documented [180 requests/minute limit](https://github.com/fastnear/neardata-server#rate-limits); the cause may be a shared egress quota.

At 2026-11-11 17:14 UTC the deployed `/health` endpoint reported cursor `276829928`, observed head `277244631`, lag `414703`, and no current error. The read-RPC fallback pool configured in the Console and reviewer Worker does not apply here: this Worker consumes FastNear's `/v0/block/{height}` response, including receipt logs, and standard JSON-RPC or NearBlocks v3 responses are not drop-in replacements. NearBlocks testnet v3 `/accounts/{account}/receipts` returned paginated action/outcome summaries without logs. Its `/txns/{hash}/receipts` endpoint did return a nested receipt tree with LCP event logs for a sampled residual-refund transaction, making it a promising transaction-driven backfill source. Prototype that adapter and compare complete pages and receipt descendants against finalized canonical blocks before switching or merging results. Public RPC providers listed by [NEAR Docs](https://docs.near.org/api/rpc/providers) are non-archival on their free testnet tiers except the severely rate-limited NEAR archive endpoint. `https://free.rpc.fastnear.com` is mainnet; testnet RPC is `https://test.rpc.fastnear.com`. A compatible archival feed, a FastNear subscription key, or a reviewed NearBlocks adapter with complete event coverage is still needed for backfill. Never silently switch sources or skip height/hash validation.

The configured 30-second CPU and 1,000-subrequest limits require a Workers Paid plan; the Free plan's 50-subrequest invocation limit is not enough for higher-throughput backfill. FastNear is a replaceable public block source; indexed results are a convenience layer and must be checked against finalized NEAR data when exact provenance matters.

## Cloudflare setup

The testnet D1 database is `lcp-event-indexer` (`6725b913-4c7d-4f47-b79a-7bb8f82bf3ee`). For a separate deployment, create a database, replace `database_id` in `wrangler.jsonc`, apply migrations remotely, and deploy with `npm run deploy --workspace=@lcp/event-indexer`. The Worker uses a 30-second CPU budget and 1,000 subrequests, which require a Workers Paid plan; the current Free limits of 10 ms CPU and 50 subrequests per invocation are not enough for this workload. Tune `MAX_BLOCKS_PER_RUN`, `MAX_BLOCK_BYTES`, and `SOURCE_REQUEST_INTERVAL_MS` to fit both the selected source's rate limits and account plan. If you have a FastNear subscription key, add it privately with `npx wrangler secret put FASTNEAR_API_KEY` from this package directory. The Worker then sends it only to FastNear as the documented `apiKey` query parameter; do not put it in `vars`, `.env`, or committed files. After adding a key, increase the per-run limit only after confirming the authenticated rate and Worker quotas. See Cloudflare's current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

The Worker stores only public on-chain event records. Do not put private evidence, contact details, wallet credentials, or evidence files in D1.
