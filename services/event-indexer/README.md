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

The indexer follows final blocks sequentially. Each block's event inserts and cursor advance commit in a single D1 batch, event keys are idempotent, and block parent hashes are checked after the initial cursor. A failed fetch or write leaves the cursor at the last complete block. Scheduled runs take a ten-minute D1 lease, so minute-level Cron triggers cannot overlap and multiply source requests. The current run limit is 20 blocks, with at least one second between requests. FastNear is a replaceable public block source; indexed results are a convenience layer and must be checked against finalized NEAR data when exact provenance matters.

## Cloudflare setup

The testnet D1 database is `lcp-event-indexer` (`6725b913-4c7d-4f47-b79a-7bb8f82bf3ee`). For a separate deployment, create a database, replace `database_id` in `wrangler.jsonc`, apply migrations remotely, and deploy with `npm run deploy --workspace=@lcp/event-indexer`. The one-minute Cron Trigger and up to 21 external requests per run require a Workers Paid plan: the current Free plan allows 10 ms CPU and 50 external subrequests per Cron invocation. The deployed Worker has a 30-second CPU budget. Tune `MAX_BLOCKS_PER_RUN`, `MAX_BLOCK_BYTES`, and `SOURCE_REQUEST_INTERVAL_MS` to fit the selected source's rate limits and the account's plan. See Cloudflare's current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

The Worker stores only public on-chain event records. Do not put private evidence, contact details, wallet credentials, or evidence files in D1.
