#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";

const EVENT_PREFIX = "EVENT_JSON:";
const RESPONSE_LIMIT_BYTES = 32 * 1024 * 1024;
const PAGE_SIZE = 25;
const MAX_RETRIES = 3;

const NETWORKS = {
  testnet: {
    nearBlocks: "https://api-testnet.nearblocks.io",
    rpc: "https://archival-rpc.testnet.fastnear.com",
    fastNear: "https://testnet.neardata.xyz",
  },
  mainnet: {
    nearBlocks: "https://api.nearblocks.io",
    rpc: "https://archival-rpc.mainnet.fastnear.com",
    fastNear: "https://mainnet.neardata.xyz",
  },
};

function usage() {
  return `Usage:
  node scripts/nearblocks-event-audit.mjs --from-height N --to-height N [options]

Required:
  --from-height N       First finalized block height to inspect (inclusive)
  --to-height N         Last finalized block height to inspect (inclusive)

Options:
  --network testnet     Network (testnet or mainnet; default: testnet)
  --contract ACCOUNT    LCP contract (default: livingcommitmentsprotocol.testnet)
  --discovery MODE      account or block receipts (default: account)
  --limit N             NearBlocks page size, 1–25 (default: 25)
  --max-pages N         Maximum pages per account scan or per block (default: 2000)
  --delay-ms N          Minimum delay between source requests (default: 1000)
  --expect-transaction HASH  Require a known transaction to appear (repeatable)
  --help                Show this help

Credentials are read only from NEARBLOCKS_API_KEY, NEAR_RPC_URL,
NEAR_RPC_API_KEY, and FASTNEAR_API_KEY. The script only reads public APIs and
prints a JSON report; it does not write to D1 or submit transactions.

The report compares each discovered transaction's NearBlocks receipt tree with
the finalized NEAR RPC transaction outcome. Account discovery is bounded by
canonical timestamps. Block discovery also compares receipt IDs and LCP events
with FastNear canonical block outcomes. Neither mode proves provider completeness
outside the selected range.`;
}

function parseArgs(argv) {
  const values = {
    network: "testnet",
    contract: "livingcommitmentsprotocol.testnet",
    contractProvided: false,
    discovery: "account",
    limit: PAGE_SIZE,
    maxPages: 2000,
    delayMs: 1000,
    expectedTransactions: [],
    help: false,
  };
  const names = new Map([
    ["--network", "network"],
    ["--contract", "contract"],
    ["--discovery", "discovery"],
    ["--from-height", "fromHeight"],
    ["--to-height", "toHeight"],
    ["--limit", "limit"],
    ["--max-pages", "maxPages"],
    ["--delay-ms", "delayMs"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      values.help = true;
      continue;
    }
    if (arg === "--expect-transaction" || arg.startsWith("--expect-transaction=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --expect-transaction");
      values.expectedTransactions.push(value);
      continue;
    }
    const [name, inlineValue] = arg.split("=", 2);
    const key = names.get(name);
    if (!key) throw new Error(`Unknown argument: ${name}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    values[key] = value;
    if (key === "contract") values.contractProvided = true;
  }

  if (values.help) return values;
  for (const key of ["fromHeight", "toHeight", "limit", "maxPages", "delayMs"]) {
    if (values[key] === undefined) {
      if (key === "fromHeight" || key === "toHeight") continue;
      continue;
    }
    const parsed = Number(values[key]);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative safe integer`);
    values[key] = parsed;
  }
  if (!Number.isSafeInteger(values.fromHeight) || values.fromHeight < 1) {
    throw new Error("--from-height must be a positive safe integer");
  }
  if (!Number.isSafeInteger(values.toHeight) || values.toHeight < values.fromHeight) {
    throw new Error("--to-height must be a safe integer greater than or equal to --from-height");
  }
  if (!(values.network in NETWORKS)) throw new Error("--network must be testnet or mainnet");
  if (!(values.discovery === "account" || values.discovery === "block")) {
    throw new Error("--discovery must be account or block");
  }
  if (values.network === "mainnet" && !values.contractProvided) {
    throw new Error("--contract is required when --network is mainnet");
  }
  if (values.limit < 1 || values.limit > 25) throw new Error("--limit must be between 1 and 25");
  if (values.maxPages < 1) throw new Error("--max-pages must be positive");
  if (values.delayMs < 0) throw new Error("--delay-ms cannot be negative");
  if (values.expectedTransactions.some((hash) => !/^[1-9A-HJ-NP-Za-km-z]{44}$/.test(hash))) {
    throw new Error("--expect-transaction values must be 44-character NEAR transaction hashes");
  }
  if (typeof values.contract !== "string" || !/^[a-z0-9._-]{2,64}$/.test(values.contract)) {
    throw new Error("--contract must be a valid NEAR account ID");
  }
  return values;
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function safeHeight(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function safeTimestampNs(value) {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function blockFields(value) {
  const item = record(value);
  const block = record(item?.block);
  const height = safeHeight(item?.block_height)
    ?? safeHeight(item?.height)
    ?? safeHeight(block?.height)
    ?? safeHeight(block?.block_height);
  const hash = typeof item?.block_hash === "string"
    ? item.block_hash
    : typeof block?.block_hash === "string"
      ? block.block_hash
      : typeof block?.hash === "string"
        ? block.hash
        : null;
  const includedTimestampNs = safeTimestampNs(item?.included_in_block_timestamp);
  const blockTimestampNs = safeTimestampNs(block?.block_timestamp)
    ?? safeTimestampNs(item?.block_timestamp)
    ?? safeTimestampNs(block?.timestamp_nanosec);
  if (includedTimestampNs !== null && blockTimestampNs !== null && includedTimestampNs !== blockTimestampNs) {
    throw new Error("NearBlocks receipt inclusion timestamp disagrees with its block timestamp");
  }
  const timestampNs = includedTimestampNs ?? blockTimestampNs;
  return { height, hash, timestampNs };
}

function parseNearBlocksReceipt(value, contractId, fallbackBlock = null) {
  const item = record(value);
  const receiptId = typeof item?.receipt_id === "string" ? item.receipt_id : null;
  const transactionHash = typeof item?.transaction_hash === "string" ? item.transaction_hash : null;
  const receiverId = typeof item?.receiver_account_id === "string" ? item.receiver_account_id : null;
  const outcome = record(item?.outcome);
  const isSuccessful = typeof outcome?.status === "boolean" ? outcome.status : null;
  const fields = blockFields(item);
  if (fallbackBlock && (
    (fields.height !== null && fields.height !== fallbackBlock.height)
    || (fields.hash !== null && fields.hash !== fallbackBlock.hash)
  )) {
    throw new Error("NearBlocks receipt block metadata disagrees with its requested canonical block");
  }
  if (fallbackBlock && fields.timestampNs !== null && fields.timestampNs !== fallbackBlock.timestampNs) {
    throw new Error("NearBlocks receipt timestamp disagrees with its requested canonical block");
  }
  const height = fields.height ?? fallbackBlock?.height ?? null;
  const hash = fields.hash ?? fallbackBlock?.hash ?? null;
  const timestampNs = fields.timestampNs ?? fallbackBlock?.timestampNs ?? null;
  if (!receiptId || !transactionHash || !receiverId || isSuccessful === null || height === null || !hash || timestampNs === null) {
    throw new Error("NearBlocks returned a receipt without its ID, transaction hash, receiver, success status, block height, block hash, or timestamp");
  }
  return {
    receiptId,
    transactionHash,
    receiverId,
    height,
    blockHash: hash,
    timestampNs,
    isSuccessful,
    isLcp: receiverId === contractId,
  };
}

function eventLog(raw, receiptId, receiverId, logIndex, contractId) {
  if (receiverId !== contractId || typeof raw !== "string" || !raw.startsWith(EVENT_PREFIX)) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(EVENT_PREFIX.length));
  } catch {
    throw new Error(`Malformed EVENT_JSON log in receipt ${receiptId}`);
  }
  if (record(parsed)?.standard !== "lcp") return null;
  return { receiptId, logIndex, raw };
}

function readOutcomeNode(node, source, contractId) {
  const item = record(node);
  if (!item) return null;
  if (source === "nearblocks") {
    const nestedExecution = record(item.execution_outcome);
    const nestedOutcome = record(nestedExecution?.outcome);
    const outcome = record(item.outcome) ?? nestedOutcome;
    const receiverId = typeof item.receiver_account_id === "string"
      ? item.receiver_account_id
      : typeof outcome?.executor_id === "string"
        ? outcome.executor_id
        : null;
    const receiptId = typeof item.receipt_id === "string"
      ? item.receipt_id
      : typeof nestedExecution?.id === "string"
        ? nestedExecution.id
        : null;
    const logs = Array.isArray(outcome?.logs) ? outcome.logs : [];
    if (!receiptId || !receiverId) return null;
    return { receiptId, receiverId, logs, blockHash: blockFields(item).hash };
  }

  const execution = record(item.execution_outcome);
  const outcome = record(item.outcome) ?? record(execution?.outcome);
  const receiverId = typeof outcome?.executor_id === "string" ? outcome.executor_id : null;
  const receiptId = typeof item.id === "string"
    ? item.id
    : typeof item.receipt_id === "string"
      ? item.receipt_id
      : typeof execution?.id === "string"
        ? execution.id
        : null;
  const logs = Array.isArray(outcome?.logs) ? outcome.logs : [];
  const blockHash = typeof item.block_hash === "string"
    ? item.block_hash
    : typeof execution?.block_hash === "string"
      ? execution.block_hash
      : null;
  if (!receiptId || !receiverId) return null;
  return { receiptId, receiverId, logs, blockHash };
}

function walkReceiptTree(root, source, contractId) {
  const nodes = new Map();
  const events = [];
  const visited = new Set();
  function walk(value) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const item = record(value);
    if (!item || visited.has(item)) return;
    visited.add(item);
    const node = readOutcomeNode(item, source, contractId);
    if (node) {
      nodes.set(node.receiptId, node);
      node.logs.forEach((log, index) => {
        const parsed = eventLog(log, node.receiptId, node.receiverId, index, contractId);
        if (parsed) events.push(parsed);
      });
    }
    for (const child of Object.values(item)) walk(child);
  }
  walk(root);
  return { nodes, events: events.sort(compareEvent) };
}

function compareEvent(left, right) {
  return left.receiptId.localeCompare(right.receiptId)
    || left.logIndex - right.logIndex
    || left.raw.localeCompare(right.raw);
}

function eventKey(event) {
  return JSON.stringify([event.receiptId, event.logIndex, event.raw]);
}

function compareEventSets(left, right) {
  const leftCounts = new Map();
  const rightCounts = new Map();
  for (const event of left) leftCounts.set(eventKey(event), (leftCounts.get(eventKey(event)) ?? 0) + 1);
  for (const event of right) rightCounts.set(eventKey(event), (rightCounts.get(eventKey(event)) ?? 0) + 1);
  const keys = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  const mismatches = [];
  for (const key of keys) {
    const nearBlocksCount = leftCounts.get(key) ?? 0;
    const canonicalCount = rightCounts.get(key) ?? 0;
    if (nearBlocksCount !== canonicalCount) {
      mismatches.push({ event: JSON.parse(key), nearBlocksCount, canonicalCount });
    }
  }
  return mismatches;
}

function compareReceiptIds(nearBlocksIds, fastNearIds) {
  const nearBlocks = new Set(nearBlocksIds);
  const fastNear = new Set(fastNearIds);
  return {
    missing_from_nearblocks: [...fastNear].filter((receiptId) => !nearBlocks.has(receiptId)).sort(),
    unexpected_in_nearblocks: [...nearBlocks].filter((receiptId) => !fastNear.has(receiptId)).sort(),
  };
}

function findDeepString(value, names) {
  const visited = new Set();
  function walk(item) {
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    const object = record(item);
    if (!object || visited.has(object)) return null;
    visited.add(object);
    for (const name of names) {
      if (typeof object[name] === "string") return object[name];
    }
    for (const child of Object.values(object)) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  return walk(value);
}

function findSignerAccount(payload, transactionHash) {
  const roots = Array.isArray(payload?.data) ? payload.data : [payload?.data ?? payload];
  for (const root of roots) {
    const item = record(root);
    if (!item) continue;
    const itemHash = item.transaction_hash ?? item.hash;
    if (typeof itemHash === "string" && itemHash !== transactionHash) continue;
    const direct = item.signer_account_id ?? item.signer_id
      ?? record(item.transaction)?.signer_account_id
      ?? record(item.txn)?.signer_account_id;
    if (typeof direct === "string") return direct;
    const nested = findDeepString(item, ["signer_account_id", "signer_id"]);
    if (nested) return nested;
  }
  return null;
}

function parseReceiptPage(payload) {
  const data = record(payload)?.data;
  if (!Array.isArray(data)) throw new Error("NearBlocks account-receipts response did not contain a data array");
  const meta = record(record(payload)?.meta);
  const rawCursor = meta?.next_page;
  const nextPage = rawCursor === null || rawCursor === undefined || rawCursor === ""
    ? null
    : typeof rawCursor === "string" || typeof rawCursor === "number"
      ? String(rawCursor)
      : null;
  if (rawCursor !== null && rawCursor !== undefined && rawCursor !== "" && nextPage === null) {
    throw new Error("NearBlocks returned an unsupported next_page cursor");
  }
  return { data, nextPage };
}

function parseTransactionTree(payload) {
  const data = record(payload)?.data;
  if (!data || (typeof data !== "object" && !Array.isArray(data))) {
    throw new Error("NearBlocks transaction receipt response did not contain a receipt tree");
  }
  return data;
}

function parseRpcOutcome(payload, contractId) {
  const response = record(payload);
  if (response?.error) {
    const error = record(response.error);
    throw new Error(`NEAR RPC error: ${String(error?.message ?? "unknown RPC error")}`);
  }
  const result = record(response?.result);
  if (!result || result.final_execution_status !== "FINAL") {
    throw new Error("NEAR RPC transaction has not reached FINAL execution status");
  }
  if (!Array.isArray(result.receipts_outcome)) {
    throw new Error("NEAR RPC transaction response did not contain receipts_outcome");
  }
  const values = [result.transaction_outcome, ...result.receipts_outcome].filter(Boolean);
  return walkReceiptTree(values, "rpc", contractId);
}

function retryDelay(response, attempt) {
  const raw = response.headers.get("Retry-After");
  const backoffMs = Math.min(30_000, 1000 * (2 ** attempt));
  if (!raw) return backoffMs;
  const retryAfterMs = /^\d+(\.\d+)?$/.test(raw)
    ? Math.ceil(Number(raw) * 1000)
    : Date.parse(raw) - Date.now();
  if (!Number.isFinite(retryAfterMs)) return backoffMs;
  return Math.min(60_000, Math.max(backoffMs, retryAfterMs));
}

function createRequestPacer(delayMs) {
  let lastStartedAt = 0;
  return async () => {
    const waitMs = delayMs - (Date.now() - lastStartedAt);
    if (lastStartedAt && waitMs > 0) await sleep(waitMs);
    lastStartedAt = Date.now();
  };
}

async function requestJson(url, init, pace) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await pace();
    let response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      if (attempt === MAX_RETRIES) throw new Error(`Request failed for ${new URL(url).pathname}: ${error.message}`);
      await sleep(Math.min(30_000, 1000 * (2 ** attempt)));
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}`);
    }
    if (Buffer.byteLength(text, "utf8") > RESPONSE_LIMIT_BYTES) {
      throw new Error(`Response from ${new URL(url).pathname} exceeded ${RESPONSE_LIMIT_BYTES} bytes`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Response from ${new URL(url).pathname} was not valid JSON`);
    }
  }
  throw new Error("Request retry limit reached");
}

function makeNearBlocksClient(baseUrl, apiKey, pace) {
  const base = new URL(baseUrl);
  return async (path, query = {}) => {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return requestJson(url, { method: "GET", headers }, pace);
  };
}

function makeRpcClient(rpcUrl, apiKey, pace) {
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("NEAR_RPC_URL must be HTTPS without embedded credentials, query parameters, or fragments");
  }
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let requestId = 0;
  return async (method, params) => requestJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: `lcp-audit-${++requestId}`, method, params }),
  }, pace);
}

function makeFastNearClient(baseUrl, apiKey, pace) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("FastNear block source must be HTTPS without embedded credentials, query parameters, or fragments");
  }
  return async (path) => {
    const headers = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return requestJson(new URL(path, base), { method: "GET", headers }, pace);
  };
}

async function canonicalBlockBoundary(rpc, expectedHeight) {
  const payload = await rpc("block", { block_id: expectedHeight });
  const response = record(payload);
  if (response?.error) {
    const error = record(response.error);
    throw new Error(`NEAR RPC could not read block ${expectedHeight}: ${String(error?.message ?? "unknown RPC error")}`);
  }
  const header = record(record(response?.result)?.header);
  const height = safeHeight(header?.height);
  const timestampNs = safeTimestampNs(header?.timestamp_nanosec);
  const hash = typeof header?.hash === "string" ? header.hash : null;
  if (height !== expectedHeight || timestampNs === null || !hash) {
    throw new Error(`NEAR RPC returned incomplete canonical metadata for block ${expectedHeight}`);
  }
  return { height, timestampNs, hash };
}

function parseFastNearBlock(payload, expectedBlock, contractId) {
  const response = record(payload);
  const block = record(response?.block);
  const header = record(block?.header);
  const height = safeHeight(header?.height);
  const hash = typeof header?.hash === "string" ? header.hash : null;
  const timestampNs = safeTimestampNs(header?.timestamp_nanosec);
  if (height !== expectedBlock.height || hash !== expectedBlock.hash || timestampNs !== expectedBlock.timestampNs) {
    throw new Error(`FastNear returned non-canonical metadata for block ${expectedBlock.height}`);
  }
  if (!Array.isArray(response?.shards)) {
    throw new Error(`FastNear block ${expectedBlock.height} did not contain shard outcomes`);
  }

  const receiptIds = new Set();
  const events = [];
  for (const shardValue of response.shards) {
    const shard = record(shardValue);
    if (!Array.isArray(shard?.receipt_execution_outcomes)) continue;
    for (const receiptValue of shard.receipt_execution_outcomes) {
      const receipt = record(receiptValue);
      const execution = record(receipt?.execution_outcome);
      const outcome = record(execution?.outcome);
      if (!execution || outcome?.executor_id !== contractId) continue;
      const status = record(outcome.status);
      if (!status || !("SuccessValue" in status || "SuccessReceiptId" in status)) continue;
      const receiptId = typeof execution.id === "string" ? execution.id : null;
      if (!receiptId) throw new Error(`FastNear block ${expectedBlock.height} contains an LCP outcome without a receipt ID`);
      receiptIds.add(receiptId);
      const logs = Array.isArray(outcome.logs) ? outcome.logs : [];
      logs.forEach((raw, index) => {
        const event = eventLog(raw, receiptId, contractId, index, contractId);
        if (event) events.push(event);
      });
    }
  }

  return { height, hash, timestampNs, receiptIds, events: events.sort(compareEvent) };
}

async function collectAccountReceipts({ nearBlocks, contractId, fromHeight, toHeight, fromTimestampNs, toTimestampNs, limit, maxPages }) {
  let cursor = null;
  const seenCursors = new Set();
  const receiptsByTransaction = new Map();
  let pages = 0;
  let scannedReceipts = 0;
  let scannedLcpReceipts = 0;
  let previousPageLastTimestampNs = null;
  let oldestScannedTimestampNs = null;
  let termination = null;

  while (true) {
    if (pages >= maxPages) throw new Error(`Stopped at --max-pages=${maxPages}; receipt pagination is incomplete`);
    const payload = await nearBlocks(`/v3/accounts/${encodeURIComponent(contractId)}/receipts`, {
      receiver: contractId,
      limit,
      before_ts: (toTimestampNs + 1n).toString(),
      next: cursor,
    });
    const { data, nextPage } = parseReceiptPage(payload);
    if (data.length === 0 && nextPage) {
      throw new Error("NearBlocks returned an empty receipt page with a pagination cursor; scan order cannot be verified");
    }
    pages += 1;
    let pageLastTimestampNs = previousPageLastTimestampNs;
    for (const value of data) {
      const receipt = parseNearBlocksReceipt(value, contractId);
      scannedReceipts += 1;
      if (pageLastTimestampNs !== null && receipt.timestampNs > pageLastTimestampNs) {
        throw new Error("NearBlocks account receipts were not returned in descending timestamp order");
      }
      pageLastTimestampNs = receipt.timestampNs;
      oldestScannedTimestampNs = receipt.timestampNs;
      if (!receipt.isLcp) continue;
      scannedLcpReceipts += 1;
      if (!receipt.isSuccessful) continue;
      if (receipt.height < fromHeight || receipt.height > toHeight) continue;
      const transaction = receiptsByTransaction.get(receipt.transactionHash) ?? {
        transactionHash: receipt.transactionHash,
        receipts: new Map(),
      };
      const previous = transaction.receipts.get(receipt.receiptId);
      if (previous && (previous.height !== receipt.height || previous.blockHash !== receipt.blockHash)) {
        throw new Error(`NearBlocks returned conflicting block metadata for receipt ${receipt.receiptId}`);
      }
      transaction.receipts.set(receipt.receiptId, receipt);
      receiptsByTransaction.set(receipt.transactionHash, transaction);
    }
    previousPageLastTimestampNs = pageLastTimestampNs;

    if (pageLastTimestampNs !== null && pageLastTimestampNs < fromTimestampNs) {
      termination = "lower_timestamp_boundary_reached";
      break;
    }

    if (!nextPage) {
      if (data.length === limit) {
        throw new Error("NearBlocks returned a full page without next_page; pagination completeness is unknown");
      }
      termination = "nearblocks_history_exhausted";
      break;
    }
    if (seenCursors.has(nextPage)) throw new Error("NearBlocks repeated a pagination cursor");
    seenCursors.add(nextPage);
    cursor = nextPage;
  }

  return {
    method: "account",
    pages,
    scannedReceipts,
    scannedLcpReceipts,
    oldestScannedTimestampNs,
    termination,
    blocks: [],
    transactions: [...receiptsByTransaction.values()],
  };
}

async function collectBlockReceipts({ nearBlocks, fastNear, rpc, contractId, fromHeight, toHeight, limit, maxPages }) {
  const transactionsByHash = new Map();
  const blocks = [];
  let pages = 0;
  let scannedReceipts = 0;
  let scannedLcpReceipts = 0;

  for (let height = fromHeight; height <= toHeight; height += 1) {
    const canonicalBlock = await canonicalBlockBoundary(rpc, height);
    const seenCursors = new Set();
    const seenReceiptIds = new Set();
    const blockReceipts = new Map();
    let cursor = null;
    let blockPages = 0;
    let blockScannedReceipts = 0;

    while (true) {
      if (blockPages >= maxPages) {
        throw new Error(`Stopped block ${height} at --max-pages=${maxPages}; receipt pagination is incomplete`);
      }
      const payload = await nearBlocks("/v3/receipts", {
        block: canonicalBlock.hash,
        limit,
        next: cursor,
      });
      const { data, nextPage } = parseReceiptPage(payload);
      if (data.length === 0 && nextPage) {
        throw new Error(`NearBlocks returned an empty receipt page with a cursor for block ${height}`);
      }
      blockPages += 1;
      pages += 1;
      blockScannedReceipts += data.length;
      scannedReceipts += data.length;

      for (const value of data) {
        const receipt = parseNearBlocksReceipt(value, contractId, canonicalBlock);
        if (seenReceiptIds.has(receipt.receiptId)) {
          throw new Error(`NearBlocks repeated receipt ${receipt.receiptId} across pages for block ${height}`);
        }
        seenReceiptIds.add(receipt.receiptId);
        if (!receipt.isLcp) continue;
        scannedLcpReceipts += 1;
        if (!receipt.isSuccessful) continue;
        const previous = blockReceipts.get(receipt.receiptId);
        if (previous && (previous.transactionHash !== receipt.transactionHash || previous.blockHash !== receipt.blockHash)) {
          throw new Error(`NearBlocks returned conflicting metadata for receipt ${receipt.receiptId}`);
        }
        blockReceipts.set(receipt.receiptId, receipt);
        const transaction = transactionsByHash.get(receipt.transactionHash) ?? {
          transactionHash: receipt.transactionHash,
          receipts: new Map(),
        };
        const priorTransactionReceipt = transaction.receipts.get(receipt.receiptId);
        if (priorTransactionReceipt && (priorTransactionReceipt.height !== receipt.height || priorTransactionReceipt.blockHash !== receipt.blockHash)) {
          throw new Error(`NearBlocks returned conflicting block metadata for receipt ${receipt.receiptId}`);
        }
        transaction.receipts.set(receipt.receiptId, receipt);
        transactionsByHash.set(receipt.transactionHash, transaction);
      }

      if (!nextPage) {
        break;
      }
      if (seenCursors.has(nextPage)) throw new Error(`NearBlocks repeated a block-receipt cursor for block ${height}`);
      seenCursors.add(nextPage);
      cursor = nextPage;
    }

    const fastNearBlock = parseFastNearBlock(await fastNear(`/v0/block/${height}`), canonicalBlock, contractId);
    blocks.push({
      height,
      hash: canonicalBlock.hash,
      timestampNs: canonicalBlock.timestampNs,
      nearBlocksPages: blockPages,
      scannedReceipts: blockScannedReceipts,
      nearBlocksLcpReceiptIds: [...blockReceipts.keys()].sort(),
      fastNearBlock,
    });
  }

  return {
    method: "block",
    pages,
    scannedReceipts,
    scannedLcpReceipts,
    oldestScannedTimestampNs: null,
    termination: "requested_block_range_scanned",
    blocks,
    transactions: [...transactionsByHash.values()],
  };
}

async function verifyTransaction({ transaction, nearBlocks, rpc, contractId, rpcBlockCache }) {
  const { transactionHash, receipts } = transaction;
  const detail = await nearBlocks(`/v3/txns/${encodeURIComponent(transactionHash)}`);
  const signer = findSignerAccount(detail, transactionHash);
  if (!signer) throw new Error(`Could not determine signer account for transaction ${transactionHash}`);

  const [nearBlocksTreePayload, rpcPayload] = await Promise.all([
    nearBlocks(`/v3/txns/${encodeURIComponent(transactionHash)}/receipts`),
    rpc("tx", {
      tx_hash: transactionHash,
      sender_account_id: signer,
      wait_until: "FINAL",
    }),
  ]);
  const nearBlocksTree = walkReceiptTree(parseTransactionTree(nearBlocksTreePayload), "nearblocks", contractId);
  const canonicalTree = parseRpcOutcome(rpcPayload, contractId);
  const eventMismatches = compareEventSets(nearBlocksTree.events, canonicalTree.events);
  const receiptMismatches = [];

  for (const [receiptId, expected] of receipts) {
    const explorerNode = nearBlocksTree.nodes.get(receiptId);
    const canonicalNode = canonicalTree.nodes.get(receiptId);
    if (!explorerNode || explorerNode.receiverId !== contractId) {
      receiptMismatches.push({ receiptId, issue: "missing_from_nearblocks_tree" });
    } else if (explorerNode.blockHash && explorerNode.blockHash !== expected.blockHash) {
      receiptMismatches.push({
        receiptId,
        issue: "nearblocks_tree_block_hash_mismatch",
        accountReceiptBlockHash: expected.blockHash,
        transactionTreeBlockHash: explorerNode.blockHash,
      });
    }
    if (!canonicalNode || canonicalNode.receiverId !== contractId) {
      receiptMismatches.push({ receiptId, issue: "missing_from_finalized_rpc_outcomes" });
      continue;
    }
    if (!canonicalNode.blockHash) {
      receiptMismatches.push({ receiptId, issue: "finalized_rpc_receipt_block_hash_missing" });
    } else if (canonicalNode.blockHash !== expected.blockHash) {
      receiptMismatches.push({
        receiptId,
        issue: "receipt_block_hash_mismatch",
        accountReceiptBlockHash: expected.blockHash,
        canonicalBlockHash: canonicalNode.blockHash,
      });
    }
    if (!rpcBlockCache.has(expected.blockHash)) {
      const blockPayload = await rpc("block", { block_id: expected.blockHash });
      const header = record(record(blockPayload)?.result)?.header;
      const height = safeHeight(header?.height);
      const hash = typeof header?.hash === "string" ? header.hash : null;
      rpcBlockCache.set(expected.blockHash, { height, hash });
    }
    const canonicalBlock = rpcBlockCache.get(expected.blockHash);
    if (canonicalBlock.height !== expected.height || canonicalBlock.hash !== expected.blockHash) {
      receiptMismatches.push({
        receiptId,
        issue: "receipt_block_header_mismatch",
        accountReceiptHeight: expected.height,
        canonicalHeight: canonicalBlock.height,
        accountReceiptBlockHash: expected.blockHash,
        canonicalBlockHash: canonicalBlock.hash,
      });
    }
  }

  return {
    report: {
      transactionHash,
      signer,
      inRangeLcpReceipts: receipts.size,
      nearBlocksLcpEvents: nearBlocksTree.events.length,
      canonicalLcpEvents: canonicalTree.events.length,
      eventMismatches,
      receiptMismatches,
    },
    evidence: {
      nearBlocksEvents: nearBlocksTree.events,
      canonicalEvents: canonicalTree.events,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const network = NETWORKS[args.network];
  const rpcUrl = process.env.NEAR_RPC_URL || network.rpc;
  const pace = createRequestPacer(args.delayMs);
  const nearBlocks = makeNearBlocksClient(network.nearBlocks, process.env.NEARBLOCKS_API_KEY, pace);
  const rpc = makeRpcClient(rpcUrl, process.env.NEAR_RPC_API_KEY, pace);
  const fastNear = makeFastNearClient(network.fastNear, process.env.FASTNEAR_API_KEY, pace);
  const fromBoundary = await canonicalBlockBoundary(rpc, args.fromHeight);
  const toBoundary = args.toHeight === args.fromHeight
    ? fromBoundary
    : await canonicalBlockBoundary(rpc, args.toHeight);
  if (fromBoundary.timestampNs > toBoundary.timestampNs) {
    throw new Error("Canonical block timestamps moved backwards across the requested height range");
  }
  const discovered = args.discovery === "block"
    ? await collectBlockReceipts({
      nearBlocks,
      fastNear,
      rpc,
      contractId: args.contract,
      fromHeight: args.fromHeight,
      toHeight: args.toHeight,
      limit: args.limit,
      maxPages: args.maxPages,
    })
    : await collectAccountReceipts({
      nearBlocks,
      contractId: args.contract,
      fromHeight: args.fromHeight,
      toHeight: args.toHeight,
      fromTimestampNs: fromBoundary.timestampNs,
      toTimestampNs: toBoundary.timestampNs,
      limit: args.limit,
      maxPages: args.maxPages,
    });
  const discoveredTransactionHashes = new Set(
    discovered.transactions.map((transaction) => transaction.transactionHash),
  );
  const missingExpectedTransactions = [...new Set(args.expectedTransactions)]
    .filter((transactionHash) => !discoveredTransactionHashes.has(transactionHash));

  const rpcBlockCache = new Map();
  const transactionReports = [];
  const transactionEvidence = [];
  for (const transaction of discovered.transactions) {
    const verified = await verifyTransaction({
      transaction,
      nearBlocks,
      rpc,
      contractId: args.contract,
      rpcBlockCache,
    });
    transactionReports.push(verified.report);
    transactionEvidence.push(verified.evidence);
  }
  const blockReports = discovered.blocks.map((block) => {
    const nearBlocksReceiptIds = new Set(block.nearBlocksLcpReceiptIds);
    const nearBlocksEvents = transactionEvidence.flatMap((evidence) =>
      evidence.nearBlocksEvents.filter((event) => nearBlocksReceiptIds.has(event.receiptId)));
    const receiptIdMismatches = compareReceiptIds(
      block.nearBlocksLcpReceiptIds,
      [...block.fastNearBlock.receiptIds],
    );
    const eventMismatches = compareEventSets(nearBlocksEvents, block.fastNearBlock.events);
    return {
      height: block.height,
      block_hash: block.hash,
      nearblocks_receipt_pages: block.nearBlocksPages,
      scanned_receipts: block.scannedReceipts,
      nearblocks_lcp_receipts: block.nearBlocksLcpReceiptIds.length,
      fastnear_lcp_receipts: block.fastNearBlock.receiptIds.size,
      nearblocks_lcp_events: nearBlocksEvents.length,
      fastnear_lcp_events: block.fastNearBlock.events.length,
      receipt_id_mismatches: receiptIdMismatches,
      event_mismatches: eventMismatches,
    };
  });
  const blockMismatchCount = blockReports.reduce(
    (sum, item) => sum
      + item.receipt_id_mismatches.missing_from_nearblocks.length
      + item.receipt_id_mismatches.unexpected_in_nearblocks.length
      + item.event_mismatches.length,
    0,
  );
  const transactionMismatchCount = transactionReports.reduce(
    (sum, item) => sum + item.eventMismatches.length + item.receiptMismatches.length,
    0,
  );
  const mismatchCount = transactionMismatchCount + blockMismatchCount + missingExpectedTransactions.length;
  const report = {
    schema: "lcp.nearblocks_event_audit.v1",
    network: args.network,
    contract_id: args.contract,
    from_height: args.fromHeight,
    to_height: args.toHeight,
    range_boundary_blocks: {
      from: { height: fromBoundary.height, hash: fromBoundary.hash, timestamp_ns: fromBoundary.timestampNs.toString() },
      to: { height: toBoundary.height, hash: toBoundary.hash, timestamp_ns: toBoundary.timestampNs.toString() },
    },
    discovery_method: discovered.method,
    account_receipt_pages: discovered.method === "account" ? discovered.pages : null,
    block_receipt_pages: discovered.method === "block" ? discovered.pages : null,
    blocks_scanned: discovered.blocks.length,
    scanned_receipts: discovered.scannedReceipts,
    scanned_lcp_receipts: discovered.scannedLcpReceipts,
    oldest_scanned_timestamp_ns: discovered.oldestScannedTimestampNs?.toString() ?? null,
    account_receipt_scan_termination: discovered.method === "account" ? discovered.termination : null,
    block_receipt_scan_termination: discovered.method === "block" ? discovered.termination : null,
    in_range_lcp_receipts: discovered.transactions.reduce((sum, item) => sum + item.receipts.size, 0),
    unique_transactions: discovered.transactions.length,
    expected_transactions: {
      requested: [...new Set(args.expectedTransactions)],
      missing_from_discovery: missingExpectedTransactions,
    },
    discovery_mismatches: missingExpectedTransactions.map((transactionHash) => ({
      transaction_hash: transactionHash,
      issue: `expected_transaction_not_discovered_in_${discovered.method}_receipts`,
    })),
    rpc_block_headers_checked: rpcBlockCache.size,
    mismatches: mismatchCount,
    transaction_mismatches: transactionMismatchCount,
    block_mismatches: blockMismatchCount,
    block_reports: blockReports,
    transaction_reports: transactionReports,
    limitations: [
      discovered.method === "account"
        ? "The account-receipt scan is bounded by canonical timestamps and fails closed on out-of-order pages, but NearBlocks may omit records from this endpoint."
        : "Block receipts are compared with FastNear canonical block outcomes, but this selected-range check does not prove the providers never omit records elsewhere.",
      "Transaction receipt parity verifies discovered transactions; use block discovery to compare every selected block's LCP receipt IDs and event logs with FastNear.",
      "This report is read-only and is not an import authorization or a replacement for finalized block reconciliation.",
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (mismatchCount > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`NearBlocks audit failed: ${error.message}\n`);
  process.exitCode = 1;
});
