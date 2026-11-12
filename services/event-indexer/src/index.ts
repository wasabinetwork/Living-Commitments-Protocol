import { parseLcpEvents, type LcpEvent } from "@lcp/sdk";

const EVENT_PREFIX = "EVENT_JSON:";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES_FALLBACK = 16 * 1024 * 1024;
const MAX_BLOCKS_PER_RUN_FALLBACK = 20;
const SOURCE_REQUEST_INTERVAL_MS_FALLBACK = 1_000;
const BLOCK_FETCH_CONCURRENCY = 4;
const MAX_SOURCE_REDIRECTS = 3;

type IndexerErrorCode = "SOURCE_UNAVAILABLE" | "SOURCE_RATE_LIMITED" | "INVALID_BLOCK" | "CHAIN_DISCONTINUITY" | "INVALID_CONFIGURATION" | "DATABASE_ERROR" | "RATE_LIMITER_UNAVAILABLE";

class IndexerError extends Error {
  readonly code: IndexerErrorCode;

  constructor(code: IndexerErrorCode, message: string) {
    super(message);
    this.name = "IndexerError";
    this.code = code;
  }
}

interface EventRow {
  event_id: number;
  block_height: number;
  block_hash: string;
  block_timestamp_ns: string;
  shard_id: number;
  receipt_id: string;
  transaction_hash: string | null;
  event_json: string;
}

interface IndexerStateRow {
  next_block_height: number;
  last_processed_height: number | null;
  last_block_hash: string | null;
  observed_head_height: number | null;
  last_indexed_at: string | null;
  last_error_code: string | null;
}

interface IndexedEvent {
  id: string;
  network: string;
  contract_id: string;
  block_height: string;
  block_hash: string;
  block_timestamp_ns: string;
  shard_id: number;
  receipt_id: string;
  transaction_hash: string | null;
  event: LcpEvent;
}

interface ParsedEvent {
  commitmentId: string | null;
  blockTimestamp: string;
  shardId: number;
  outcomeIndex: number;
  receiptId: string;
  transactionHash: string | null;
  logIndex: number;
  event: LcpEvent;
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function decimal(value: unknown): string | null {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parsePositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : fallback;
}

function validateConfig(env: Env): { startHeight: number; maxBlocks: number; maxBlockBytes: number; sourceRequestIntervalMs: number } {
  const startHeight = parsePositiveInteger(env.START_BLOCK_HEIGHT, 0, Number.MAX_SAFE_INTEGER);
  if (startHeight === 0) throw new IndexerError("INVALID_CONFIGURATION", "START_BLOCK_HEIGHT must be a positive safe integer.");
  if (!/^[a-z0-9._-]+$/.test(env.NETWORK) || !/^[a-z0-9._-]{2,64}$/.test(env.CONTRACT_ID)) {
    throw new IndexerError("INVALID_CONFIGURATION", "NETWORK and CONTRACT_ID must be configured.");
  }
  let source: URL;
  try {
    source = new URL(env.SOURCE_BASE_URL);
  } catch {
    throw new IndexerError("INVALID_CONFIGURATION", "SOURCE_BASE_URL must be a valid HTTPS URL.");
  }
  if (source.protocol !== "https:") throw new IndexerError("INVALID_CONFIGURATION", "SOURCE_BASE_URL must use HTTPS.");
  return {
    startHeight,
    maxBlocks: parsePositiveInteger(env.MAX_BLOCKS_PER_RUN, MAX_BLOCKS_PER_RUN_FALLBACK, 400),
    maxBlockBytes: parsePositiveInteger(env.MAX_BLOCK_BYTES, MAX_RESPONSE_BYTES_FALLBACK, 64 * 1024 * 1024),
    sourceRequestIntervalMs: parsePositiveInteger(env.SOURCE_REQUEST_INTERVAL_MS, SOURCE_REQUEST_INTERVAL_MS_FALLBACK, 10_000),
  };
}

async function readJsonLimited(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new IndexerError("INVALID_BLOCK", "The block source returned an empty response body.");
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new IndexerError("INVALID_BLOCK", `The block response exceeds the ${maxBytes}-byte configured limit.`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new IndexerError("INVALID_BLOCK", `The block response exceeds the ${maxBytes}-byte configured limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new IndexerError("INVALID_BLOCK", "The block source returned malformed JSON.");
  }
}

function isFastNearHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "neardata.xyz"
    || host.endsWith(".neardata.xyz")
    || host === "fastnear.com"
    || host.endsWith(".fastnear.com");
}

export function fastNearAuthHeaders(apiKey: string | undefined): HeadersInit {
  const key = apiKey?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function fetchBlock(url: string, maxBytes: number, apiKey?: string): Promise<unknown> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(url);
  } catch {
    throw new IndexerError("INVALID_CONFIGURATION", "The finalized block source URL is invalid.");
  }
  if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) {
    throw new IndexerError("INVALID_CONFIGURATION", "The finalized block source must use HTTPS without URL credentials.");
  }
  if (apiKey && !isFastNearHost(sourceUrl.hostname)) {
    throw new IndexerError("INVALID_CONFIGURATION", "FastNear authentication requires a FastNear source host.");
  }

  let response: Response;
  for (let redirects = 0; ; redirects += 1) {
    try {
      response = await fetch(sourceUrl.toString(), {
        headers: fastNearAuthHeaders(apiKey),
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new IndexerError("SOURCE_UNAVAILABLE", "The finalized block source could not be reached.");
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location || redirects >= MAX_SOURCE_REDIRECTS) {
      throw new IndexerError("SOURCE_UNAVAILABLE", "The finalized block source returned an invalid redirect.");
    }
    try {
      sourceUrl = new URL(location, sourceUrl);
    } catch {
      throw new IndexerError("SOURCE_UNAVAILABLE", "The finalized block source returned an invalid redirect.");
    }
    if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) {
      throw new IndexerError("SOURCE_UNAVAILABLE", "The finalized block source redirected to an invalid URL.");
    }
    if (apiKey && !isFastNearHost(sourceUrl.hostname)) {
      throw new IndexerError("SOURCE_UNAVAILABLE", "The authenticated block source redirected outside FastNear.");
    }
  }

  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") ?? "unspecified";
      throw new IndexerError("SOURCE_RATE_LIMITED", `The finalized block source rate-limited this indexer invocation (Retry-After: ${retryAfter}).`);
    }
    throw new IndexerError("SOURCE_UNAVAILABLE", `The finalized block source returned HTTP ${response.status}.`);
  }
  return readJsonLimited(response, maxBytes);
}

function parseBlock(value: unknown, expectedHeight: number, contractId: string): {
  height: number;
  hash: string;
  previousHash: string;
  events: ParsedEvent[];
} {
  const response = record(value);
  const block = record(response?.block);
  const header = record(block?.header);
  const height = Number(decimal(header?.height));
  const hash = typeof header?.hash === "string" ? header.hash : null;
  const previousHash = typeof header?.prev_hash === "string" ? header.prev_hash : null;
  const headerTimestamp = decimal(header?.timestamp_nanosec);
  if (height !== expectedHeight || !hash || !previousHash || !headerTimestamp || !Array.isArray(response?.shards)) {
    throw new IndexerError("INVALID_BLOCK", `Block ${expectedHeight} is missing its expected header or shard data.`);
  }

  const events: ParsedEvent[] = [];
  for (const shardValue of response.shards) {
    const shard = record(shardValue);
    const shardId = Number(decimal(shard?.shard_id));
    if (!Number.isSafeInteger(shardId) || shardId < 0) continue;
    if (!Array.isArray(shard?.receipt_execution_outcomes)) continue;

    for (const outcomeValue of shard.receipt_execution_outcomes) {
      const receiptOutcome = record(outcomeValue);
      const execution = record(receiptOutcome?.execution_outcome);
      const outcome = record(execution?.outcome);
      if (!execution || outcome?.executor_id !== contractId) continue;
      const status = record(outcome.status);
      if (!status || !("SuccessValue" in status || "SuccessReceiptId" in status)) continue;
      if (!Array.isArray(outcome.logs)) continue;

      const receiptId = typeof execution.id === "string" ? execution.id : null;
      const outcomeIndex = Number(decimal(execution.index));
      if (!receiptId || !Number.isSafeInteger(outcomeIndex) || outcomeIndex < 0) continue;
      const transactionHash = typeof receiptOutcome?.tx_hash === "string" ? receiptOutcome.tx_hash : null;
      const blockTimestamp = decimal(execution.block_timestamp) ?? headerTimestamp;
      if (!blockTimestamp) continue;
      for (let logIndex = 0; logIndex < outcome.logs.length; logIndex += 1) {
        const log = outcome.logs[logIndex];
        if (typeof log !== "string" || !log.startsWith(EVENT_PREFIX)) continue;
        const [event] = parseLcpEvents([log]);
        if (!event) continue;
        const data = event.data[0];
        const commitmentId = decimal(data?.commitment_id);
        events.push({
          commitmentId,
          blockTimestamp,
          shardId,
          outcomeIndex,
          receiptId,
          transactionHash,
          logIndex,
          event,
        });
      }
    }
  }

  return { height, hash, previousHash, events };
}

export async function readNextCanonicalBlocks(
  requestBlockAtHeight: (height: number) => Promise<unknown>,
  startHeight: number,
  finalizedHeadHeight: number,
  maxHeightSlots: number,
  lastBlockHash: string | null,
  contractId: string,
  batchSize = BLOCK_FETCH_CONCURRENCY,
): Promise<{ blocks: ReturnType<typeof parseBlock>[]; heightSlotCount: number }> {
  const lastCandidateHeight = Math.min(finalizedHeadHeight, startHeight + maxHeightSlots - 1);
  let cursorHeight = startHeight;
  let previousHash = lastBlockHash;
  const blocks: ReturnType<typeof parseBlock>[] = [];

  while (cursorHeight <= lastCandidateHeight) {
    const batchEndHeight = Math.min(lastCandidateHeight, cursorHeight + batchSize - 1);
    const heights = Array.from({ length: batchEndHeight - cursorHeight + 1 }, (_, index) => cursorHeight + index);
    const values = await Promise.all(heights.map((height) => requestBlockAtHeight(height)));

    for (let index = 0; index < heights.length; index += 1) {
      const height = heights[index];
      const value = values[index];
      if (value === null) {
        if (!previousHash) {
          throw new IndexerError("INVALID_BLOCK", `Cannot skip missing block ${height} without a previous block hash.`);
        }
        continue;
      }

      const block = parseBlock(value, height, contractId);
      if (previousHash && block.previousHash !== previousHash) {
        throw new IndexerError("CHAIN_DISCONTINUITY", `Block ${height} does not extend the last indexed block.`);
      }
      blocks.push(block);
      previousHash = block.hash;
    }
    cursorHeight = batchEndHeight + 1;
  }

  return {
    blocks,
    heightSlotCount: Math.max(0, lastCandidateHeight - startHeight + 1),
  };
}

export function createRequestPacer(intervalMs: number): () => Promise<void> {
  let scheduledRequest = Promise.resolve();
  let lastStartedAt = 0;
  return () => {
    const nextScheduledRequest = scheduledRequest.then(async () => {
      const waitMs = intervalMs - (Date.now() - lastStartedAt);
      if (lastStartedAt > 0 && waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      lastStartedAt = Date.now();
    });
    scheduledRequest = nextScheduledRequest.catch(() => undefined);
    return nextScheduledRequest;
  };
}

async function getState(env: Env): Promise<IndexerStateRow | null> {
  return env.DB.prepare(
    `SELECT next_block_height, last_processed_height, last_block_hash,
            observed_head_height, last_indexed_at, last_error_code
     FROM indexer_state WHERE network = ? AND contract_id = ?`,
  ).bind(env.NETWORK, env.CONTRACT_ID).first<IndexerStateRow>();
}

async function fetchLatestHeight(env: Env, maxBytes: number, requestBlock: typeof fetchBlock): Promise<number> {
  const value = await requestBlock(`${env.SOURCE_BASE_URL.replace(/\/$/, "")}/v0/last_block/final`, maxBytes);
  const header = record(record(record(value)?.block)?.header);
  const height = Number(decimal(header?.height));
  if (!Number.isSafeInteger(height) || height < 1) {
    throw new IndexerError("INVALID_BLOCK", "The finalized head response did not include a valid block height.");
  }
  return height;
}

async function persistBlock(env: Env, parsed: ReturnType<typeof parseBlock>): Promise<void> {
  const statements = parsed.events.map((item) => env.DB.prepare(
    `INSERT OR IGNORE INTO indexed_lcp_events (
       network, contract_id, commitment_id, block_height, block_hash,
       block_timestamp_ns, shard_id, outcome_index, receipt_id,
       transaction_hash, log_index, event_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    env.NETWORK,
    env.CONTRACT_ID,
    item.commitmentId,
    parsed.height,
    parsed.hash,
    item.blockTimestamp,
    item.shardId,
    item.outcomeIndex,
    item.receiptId,
    item.transactionHash,
    item.logIndex,
    JSON.stringify(item.event),
  ));

  statements.push(env.DB.prepare(
    `UPDATE indexer_state
     SET next_block_height = MAX(next_block_height, ?),
         last_processed_height = CASE
           WHEN last_processed_height IS NULL OR last_processed_height < ? THEN ?
           ELSE last_processed_height END,
         last_block_hash = CASE
           WHEN last_processed_height IS NULL OR last_processed_height < ? THEN ?
           ELSE last_block_hash END,
         last_indexed_at = ?,
         last_error_code = NULL
     WHERE network = ? AND contract_id = ?`,
  ).bind(
    parsed.height + 1,
    parsed.height,
    parsed.height,
    parsed.height,
    parsed.hash,
    new Date().toISOString(),
    env.NETWORK,
    env.CONTRACT_ID,
  ));

  try {
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) {
      throw new Error("D1 rejected a block write.");
    }
  } catch {
    throw new IndexerError("DATABASE_ERROR", `D1 could not atomically persist block ${parsed.height}.`);
  }
}

async function recordIndexerError(env: Env, code: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE indexer_state SET last_error_code = ? WHERE network = ? AND contract_id = ?`,
  ).bind(code, env.NETWORK, env.CONTRACT_ID).run();
}

async function acquireScheduledLease(env: Env, token: string): Promise<boolean> {
  const now = Date.now();
  const lease = await env.DB.prepare(
    `INSERT INTO indexer_leases (network, contract_id, lease_token, lease_expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (network, contract_id) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_expires_at = excluded.lease_expires_at
     WHERE indexer_leases.lease_expires_at <= ?
     RETURNING lease_token`,
  ).bind(env.NETWORK, env.CONTRACT_ID, token, now + 10 * 60_000, now).first<{ lease_token: string }>();
  return lease?.lease_token === token;
}

async function releaseScheduledLease(env: Env, token: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM indexer_leases WHERE network = ? AND contract_id = ? AND lease_token = ?`,
  ).bind(env.NETWORK, env.CONTRACT_ID, token).run();
}

async function runIndexer(env: Env): Promise<{ processedBlocks: number; skippedHeightCount: number; indexedEvents: number; headHeight: number }> {
  const { startHeight, maxBlocks, maxBlockBytes, sourceRequestIntervalMs } = validateConfig(env);
  const sourceBase = env.SOURCE_BASE_URL.replace(/\/$/, "");
  const fastNearApiKey = (env as Env & { FASTNEAR_API_KEY?: string }).FASTNEAR_API_KEY?.trim();
  const waitForSourceSlot = createRequestPacer(sourceRequestIntervalMs);
  const requestBlock = async (url: string, maxBytes: number): Promise<unknown> => {
    await waitForSourceSlot();
    return fetchBlock(url, maxBytes, fastNearApiKey);
  };
  const stateTableReady = await env.DB.prepare(
    `INSERT OR IGNORE INTO indexer_state (
       network, contract_id, next_block_height, observed_head_height
     ) VALUES (?, ?, ?, ?)`,
  ).bind(env.NETWORK, env.CONTRACT_ID, startHeight, startHeight - 1).run();
  if (!stateTableReady.success) throw new IndexerError("INVALID_CONFIGURATION", "Indexer state could not be initialized.");

  const headHeight = await fetchLatestHeight(env, maxBlockBytes, requestBlock);
  await env.DB.prepare(
    `UPDATE indexer_state
     SET observed_head_height = MAX(COALESCE(observed_head_height, 0), ?), last_error_code = NULL
     WHERE network = ? AND contract_id = ?`,
  ).bind(headHeight, env.NETWORK, env.CONTRACT_ID).run();

  let state = await getState(env);
  if (!state) throw new IndexerError("INVALID_CONFIGURATION", "Indexer state is unavailable after initialization.");

  let processedBlocks = 0;
  let processedHeightSlots = 0;
  let skippedHeightCount = 0;
  let indexedEvents = 0;
  let scanNextHeight = state.next_block_height;
  while (scanNextHeight <= headHeight && processedHeightSlots < maxBlocks) {
    const height: number = scanNextHeight;
    const heightBudget = Math.min(BLOCK_FETCH_CONCURRENCY, maxBlocks - processedHeightSlots);
    const next = await readNextCanonicalBlocks(
      (candidateHeight) => requestBlock(`${sourceBase}/v0/block/${candidateHeight}`, maxBlockBytes),
      height,
      headHeight,
      heightBudget,
      state.last_block_hash,
      env.CONTRACT_ID,
    );
    if (next.heightSlotCount === 0) break;
    processedHeightSlots += next.heightSlotCount;
    scanNextHeight += next.heightSlotCount;
    if (next.blocks.length === 0) continue;
    for (const parsed of next.blocks) {
      if (parsed.events.length > 900) {
        throw new IndexerError("INVALID_BLOCK", `Block ${parsed.height} contains more events than one atomic D1 batch can safely write.`);
      }
      const skippedBeforeBlock = parsed.height - state.next_block_height;
      await persistBlock(env, parsed);
      indexedEvents += parsed.events.length;
      processedBlocks += 1;
      skippedHeightCount += skippedBeforeBlock;
      state = {
        ...state,
        next_block_height: parsed.height + 1,
        last_processed_height: parsed.height,
        last_block_hash: parsed.hash,
        last_indexed_at: new Date().toISOString(),
        last_error_code: null,
      };
    }
  }

  return { processedBlocks, skippedHeightCount, indexedEvents, headHeight };
}

function parsePageSize(rawValue: string | null): number | null {
  if (rawValue === null) return DEFAULT_PAGE_SIZE;
  if (!/^[1-9][0-9]*$/.test(rawValue)) return null;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) && value <= MAX_PAGE_SIZE ? value : null;
}

function parseBeforeId(rawValue: string | null): number | null | false {
  if (rawValue === null) return null;
  if (!/^[1-9][0-9]*$/.test(rawValue)) return false;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : false;
}

function parseStoredEvent(eventJson: string): LcpEvent {
  const [event] = parseLcpEvents([`${EVENT_PREFIX}${eventJson}`]);
  if (!event) throw new IndexerError("DATABASE_ERROR", "D1 contains malformed indexed event data.");
  return event;
}

async function handleHealth(env: Env): Promise<Response> {
  const state = await getState(env);
  const lagBlocks = state?.observed_head_height === null || state?.observed_head_height === undefined
    || state.last_processed_height === null || state.last_processed_height === undefined
    ? null
    : Math.max(0, state.observed_head_height - state.last_processed_height);
  const status = !state
    ? "not_initialized"
    : state.last_error_code
      ? "degraded"
      : state.last_processed_height === null || (lagBlocks ?? 0) > 0
        ? "catching_up"
        : "ready";
  return jsonResponse({
    status,
    network: env.NETWORK,
    contract_id: env.CONTRACT_ID,
    start_block_height: env.START_BLOCK_HEIGHT,
    next_block_height: state?.next_block_height ?? null,
    last_processed_height: state?.last_processed_height ?? null,
    last_block_hash: state?.last_block_hash ?? null,
    observed_head_height: state?.observed_head_height ?? null,
    lag_blocks: lagBlocks,
    last_indexed_at: state?.last_indexed_at ?? null,
    last_error_code: state?.last_error_code ?? null,
  }, 200, { "Cache-Control": "no-store" });
}

async function handleEvents(url: URL, env: Env): Promise<Response> {
  const commitmentId = url.searchParams.get("commitment_id");
  if (!commitmentId || commitmentId.length > 20 || !/^(0|[1-9][0-9]*)$/.test(commitmentId) || BigInt(commitmentId) > 0xffff_ffff_ffff_ffffn) {
    return jsonResponse({ error: "invalid_commitment_id" }, 400);
  }
  const limit = parsePageSize(url.searchParams.get("limit"));
  const beforeId = parseBeforeId(url.searchParams.get("before_id"));
  if (limit === null || beforeId === false) return jsonResponse({ error: "invalid_pagination" }, 400);

  const baseQuery = `SELECT event_id, block_height, block_hash, block_timestamp_ns,
                            shard_id, receipt_id, transaction_hash, event_json
                     FROM indexed_lcp_events
                     WHERE network = ? AND contract_id = ? AND commitment_id = ?`;
  const query = beforeId === null
    ? `${baseQuery} ORDER BY event_id DESC LIMIT ?`
    : `${baseQuery} AND event_id < ? ORDER BY event_id DESC LIMIT ?`;
  const bindings = beforeId === null
    ? [env.NETWORK, env.CONTRACT_ID, commitmentId, limit + 1]
    : [env.NETWORK, env.CONTRACT_ID, commitmentId, beforeId, limit + 1];
  const result = await env.DB.prepare(query).bind(...bindings).all<EventRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const events: IndexedEvent[] = rows.map((row) => ({
    id: String(row.event_id),
    network: env.NETWORK,
    contract_id: env.CONTRACT_ID,
    block_height: String(row.block_height),
    block_hash: row.block_hash,
    block_timestamp_ns: row.block_timestamp_ns,
    shard_id: row.shard_id,
    receipt_id: row.receipt_id,
    transaction_hash: row.transaction_hash,
    event: parseStoredEvent(row.event_json),
  }));

  return jsonResponse({
    network: env.NETWORK,
    contract_id: env.CONTRACT_ID,
    commitment_id: commitmentId,
    events,
    next_before_id: hasMore && rows.length > 0 ? String(rows[rows.length - 1].event_id) : null,
  }, 200, { "Cache-Control": "public, max-age=15" });
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    let response: Response;
    try {
      if (request.method !== "GET") response = jsonResponse({ error: "method_not_allowed" }, 405);
      else if (url.pathname === "/health") response = await handleHealth(env);
      else if (url.pathname === "/v1/events") {
        const key = request.headers.get("CF-Connecting-IP") ?? "local-development";
        let allowed: boolean;
        try {
          allowed = (await env.API_RATE_LIMITER.limit({ key })).success;
        } catch {
          throw new IndexerError("RATE_LIMITER_UNAVAILABLE", "Client request rate limiter unavailable.");
        }
        response = allowed
          ? await handleEvents(url, env)
          : jsonResponse({ error: "rate_limited" }, 429, { "Cache-Control": "no-store", "Retry-After": "60" });
      }
      else response = jsonResponse({ error: "not_found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "indexer_api_error", path: url.pathname, message: error instanceof Error ? error.message : "unknown" }));
      response = error instanceof IndexerError && error.code === "RATE_LIMITER_UNAVAILABLE"
        ? jsonResponse({ error: "service_unavailable" }, 503, { "Cache-Control": "no-store" })
        : jsonResponse({ error: "internal_error" }, 500);
    }
    cors.forEach((value, key) => response.headers.set(key, value));
    return response;
  },

  async scheduled(_controller, env): Promise<void> {
    const leaseToken = crypto.randomUUID();
    try {
      if (!await acquireScheduledLease(env, leaseToken)) {
        console.log(JSON.stringify({ event: "indexer_run_skipped", reason: "lease_held", network: env.NETWORK, contract_id: env.CONTRACT_ID }));
        return;
      }
      const result = await runIndexer(env);
      console.log(JSON.stringify({ event: "indexer_run", ...result, network: env.NETWORK, contract_id: env.CONTRACT_ID }));
    } catch (error) {
      const code = error instanceof IndexerError ? error.code : "UNEXPECTED";
      try {
        await recordIndexerError(env, code);
      } catch {
        // The original failure remains visible in the scheduled invocation log.
      }
      console.error(JSON.stringify({ event: "indexer_run_error", code, message: error instanceof Error ? error.message : "unknown" }));
      throw error;
    } finally {
      try {
        await releaseScheduledLease(env, leaseToken);
      } catch (error) {
        console.error(JSON.stringify({ event: "indexer_lease_release_error", message: error instanceof Error ? error.message : "unknown" }));
      }
    }
  },
} satisfies ExportedHandler<Env>;
