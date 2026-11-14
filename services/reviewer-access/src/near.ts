import { canonicalJson, decodeBase58, decodeBase64, encodeBase64, utf8 } from "./encoding.js";

const RPC_PROVIDER_COUNT = 3;
const RPC_QUORUM = 2;
const RPC_TIMEOUT_MS = 8_000;
const MAX_RPC_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_FINALIZED_HEAD_SKEW_BLOCKS = 5;
const MAX_FINALIZED_AGE_NS = 60_000_000_000n;
const MAX_FINALIZED_FUTURE_SKEW_NS = 15_000_000_000n;

interface FinalizedSnapshot {
  blockHash: string;
  blockHeight: number;
  timestampNs: bigint;
}

interface RpcSuccess {
  kind: "success";
  result: unknown;
}

interface RpcError {
  kind: "rpc_error";
  error: unknown;
}

type RpcOutcome = RpcSuccess | RpcError | null;

export class NearReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NearReadError";
  }
}

export class NearUnavailableError extends NearReadError {
  constructor(message: string) {
    super(message);
    this.name = "NearUnavailableError";
  }
}

export interface NearReadSession {
  finalizedTimeNs(): Promise<bigint>;
  viewContract<T>(methodName: string, args: Record<string, string>): Promise<T | null>;
  requireCurrentAccessKey(accountId: string, publicKey: string): Promise<void>;
  requireFullAccessKey(accountId: string, publicKey: string): Promise<void>;
}

function providerUrls(env: Env): string[] {
  const configured = [env.NEAR_RPC_URL, ...(env.NEAR_RPC_FALLBACK_URLS ?? "").split(",")]
    .map((value) => value.trim())
    .filter(Boolean);
  const urls = configured.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new NearUnavailableError("Finalized NEAR state is unavailable.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new NearUnavailableError("Finalized NEAR state is unavailable.");
    }
    return url;
  });
  if (urls.length !== RPC_PROVIDER_COUNT || new Set(urls.map((url) => url.origin)).size !== RPC_PROVIDER_COUNT) {
    throw new NearUnavailableError("Finalized NEAR state is unavailable.");
  }
  return urls.map((url) => url.href);
}

async function callProvider(url: string, method: string, params: unknown): Promise<RpcOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "lcp-reviewer-access", method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  let payload: unknown;
  try {
    const declaredLength = response.headers.get("Content-Length");
    if (declaredLength && /^[0-9]+$/.test(declaredLength) && Number(declaredLength) > MAX_RPC_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RPC_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
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
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const envelope = payload as Record<string, unknown>;
  if (envelope.jsonrpc !== "2.0" || envelope.id !== "lcp-reviewer-access") return null;
  if (envelope.result !== undefined && envelope.error === undefined) return { kind: "success", result: envelope.result };
  if (envelope.error !== undefined && envelope.result === undefined && isRpcError(envelope.error)) {
    return { kind: "rpc_error", error: envelope.error };
  }
  return null;
}

function isRpcError(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
    && "code" in value && typeof value.code === "number" && Number.isInteger(value.code)
    && "message" in value && typeof value.message === "string";
}

function parseFinalizedSnapshot(value: unknown): FinalizedSnapshot | null {
  if (typeof value !== "object" || value === null || !("header" in value)) return null;
  const header = value.header;
  if (typeof header !== "object" || header === null) return null;
  const record = header as Record<string, unknown>;
  const blockHash = record.hash;
  const rawHeight = record.height;
  const rawTimestamp = record.timestamp_nanosec;
  let validBlockHash = false;
  if (typeof blockHash === "string") {
    try {
      decodeBase58(blockHash, 32);
      validBlockHash = true;
    } catch {
      validBlockHash = false;
    }
  }
  const blockHeight = typeof rawHeight === "number"
    ? rawHeight
    : typeof rawHeight === "string" && /^[1-9][0-9]*$/.test(rawHeight)
      ? Number(rawHeight)
      : NaN;
  if (typeof blockHash !== "string" || !validBlockHash
      || !Number.isSafeInteger(blockHeight) || blockHeight < 1
      || typeof rawTimestamp !== "string" || rawTimestamp.length > 20 || !/^[1-9][0-9]*$/.test(rawTimestamp)) {
    return null;
  }
  return { blockHash, blockHeight, timestampNs: BigInt(rawTimestamp) };
}

async function finalizedSnapshot(urls: string[]): Promise<FinalizedSnapshot> {
  const outcomes = await Promise.all(urls.map((url) => callProvider(url, "block", { finality: "final" })));
  const heads = outcomes.flatMap((outcome, index) => {
    if (outcome?.kind !== "success") return [];
    const snapshot = parseFinalizedSnapshot(outcome.result);
    return snapshot ? [{ url: urls[index], snapshot }] : [];
  });
  if (heads.length < RPC_QUORUM) throw new NearUnavailableError("Finalized NEAR state is unavailable.");

  const heights = heads.map(({ snapshot }) => snapshot.blockHeight).sort((left, right) => left - right);
  if (heights[heights.length - 1] - heights[0] > MAX_FINALIZED_HEAD_SKEW_BLOCKS) {
    throw new NearUnavailableError("Finalized NEAR providers are too far apart to choose a fresh checkpoint.");
  }
  // Use the highest height covered by at least two current finalized heads
  // (the median of three, or the lower of two). This tolerates ordinary
  // one-to-few block propagation skew without trusting an isolated higher
  // head or falling back to an unbounded stale quorum.
  const checkpointHeight = heights[heights.length - RPC_QUORUM];
  const sameHeightHeads = heads.filter(({ snapshot }) => snapshot.blockHeight === checkpointHeight);
  if (new Set(sameHeightHeads.map(({ snapshot }) => `${snapshot.blockHash}:${snapshot.timestampNs}`)).size > 1) {
    throw new NearUnavailableError("Finalized NEAR providers returned conflicting blocks at the same height.");
  }

  // Ask all providers for the same finalized height. Authorization reads will
  // then be pinned to a checkpoint that at least two current finalized heads cover.
  const checkpointOutcomes = await Promise.all(urls.map((url) => callProvider(url, "block", { block_id: checkpointHeight })));
  const checkpoints = new Map<string, FinalizedSnapshot>();
  for (let index = 0; index < checkpointOutcomes.length; index += 1) {
    const outcome = checkpointOutcomes[index];
    if (outcome?.kind !== "success") continue;
    const snapshot = parseFinalizedSnapshot(outcome.result);
    if (!snapshot) continue;
    if (snapshot.blockHeight !== checkpointHeight) {
      throw new NearUnavailableError("A NEAR provider returned a different height for the pinned finalized checkpoint.");
    }
    const sameProviderHead = heads.find(({ url }) => url === urls[index])?.snapshot;
    if (sameProviderHead?.blockHeight === checkpointHeight
        && (sameProviderHead.blockHash !== snapshot.blockHash || sameProviderHead.timestampNs !== snapshot.timestampNs)) {
      throw new NearUnavailableError("A NEAR provider contradicted its finalized block at the pinned height.");
    }
    checkpoints.set(urls[index], snapshot);
  }
  const values = [...checkpoints.values()];
  if (values.length < RPC_QUORUM) throw new NearUnavailableError("Finalized NEAR providers did not supply a checkpoint quorum.");
  const agreed = values[0];
  if (values.some((snapshot) => snapshot.blockHash !== agreed.blockHash || snapshot.timestampNs !== agreed.timestampNs)) {
    throw new NearUnavailableError("Finalized NEAR providers returned conflicting blocks at the pinned height.");
  }

  const ageNs = BigInt(Date.now()) * 1_000_000n - agreed.timestampNs;
  if (ageNs > MAX_FINALIZED_AGE_NS || ageNs < -MAX_FINALIZED_FUTURE_SKEW_NS) {
    throw new NearUnavailableError("The agreed finalized NEAR checkpoint is stale or has an invalid timestamp.");
  }
  return agreed;
}

function groupBy<T>(values: T[], keyFor: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function isTransientRpcError(error: unknown): boolean {
  let text: string;
  try {
    text = canonicalJson(error);
  } catch {
    return true;
  }
  return /rate.?limit|too many requests|temporar|timed? ?out|unavailable|overload|capacity|server error|internal error|unknown block|block not found/i.test(text);
}

async function quorumQuery(
  urls: string[],
  snapshot: FinalizedSnapshot,
  params: Record<string, unknown>,
): Promise<unknown> {
  const outcomes = await Promise.all(urls.map((url) => callProvider(url, "query", {
    ...params,
    block_id: snapshot.blockHash,
  })));
  const matching: Array<{ kind: "success"; result: unknown } | { kind: "rpc_error"; error: unknown }> = [];
  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.kind === "rpc_error") {
      if (isTransientRpcError(outcome.error)) continue;
      matching.push(outcome);
      continue;
    }
    if (typeof outcome.result !== "object" || outcome.result === null) continue;
    const result = outcome.result as Record<string, unknown>;
    if (typeof result.block_hash !== "string" || typeof result.block_height !== "number") continue;
    if (result.block_hash !== snapshot.blockHash || result.block_height !== snapshot.blockHeight) {
      throw new NearUnavailableError("A NEAR provider returned authorization state from a different block.");
    }
    matching.push(outcome);
  }
  const groups = groupBy(matching, (outcome) => `${outcome.kind}:${canonicalJson(outcome.kind === "success" ? outcome.result : outcome.error)}`);
  if (matching.length < RPC_QUORUM || groups.size !== 1) {
    throw new NearUnavailableError("Finalized NEAR providers did not agree on authorization state.");
  }
  const agreed = matching;
  if (agreed[0].kind === "rpc_error") throw new NearReadError("The requested NEAR state is unavailable.");
  return agreed[0].result;
}

function parsePermissionResult(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("permission" in value)) {
    throw new NearReadError("NEAR returned a malformed access-key result.");
  }
  return value.permission;
}

export function createNearReadSession(env: Env): NearReadSession {
  const urls = providerUrls(env);
  let snapshotPromise: Promise<FinalizedSnapshot> | undefined;
  const getSnapshot = (): Promise<FinalizedSnapshot> => snapshotPromise ??= finalizedSnapshot(urls);
  const query = async (params: Record<string, unknown>): Promise<unknown> => {
    const snapshot = await getSnapshot();
    return quorumQuery(urls, snapshot, params);
  };

  async function readAccessKeyPermission(accountId: string, publicKey: string): Promise<unknown> {
    if (!/^[a-z0-9._-]{2,64}$/.test(accountId) || !publicKey.startsWith("ed25519:")) {
      throw new NearReadError("The signed account or key format is unsupported.");
    }
    const result = await query({
      request_type: "view_access_key",
      account_id: accountId,
      public_key: publicKey,
    });
    return parsePermissionResult(result);
  }

  async function requireFullAccessPermission(accountId: string, publicKey: string): Promise<void> {
    if (await readAccessKeyPermission(accountId, publicKey) !== "FullAccess") {
      throw new NearReadError("NEP-413 signatures require a current full-access key for this NEAR account.");
    }
  }

  return {
    async finalizedTimeNs(): Promise<bigint> {
      return (await getSnapshot()).timestampNs;
    },
    async viewContract<T>(methodName: string, args: Record<string, string>): Promise<T | null> {
      const result = await query({
        request_type: "call_function",
        account_id: env.CONTRACT_ID,
        method_name: methodName,
        args_base64: encodeBase64(utf8(JSON.stringify(args))),
      }) as { result?: number[] };
      if (!Array.isArray(result.result) || result.result.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new NearReadError("NEAR returned a malformed contract view result.");
      }
      const bytes = Uint8Array.from(result.result);
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T | null;
      } catch {
        throw new NearReadError("NEAR returned malformed contract view JSON.");
      }
    },
    async requireCurrentAccessKey(accountId: string, publicKey: string): Promise<void> {
      // NEP-413 explicitly requires a FullAccess key; an active FunctionCall key is insufficient.
      await requireFullAccessPermission(accountId, publicKey);
    },
    async requireFullAccessKey(accountId: string, publicKey: string): Promise<void> {
      await requireFullAccessPermission(accountId, publicKey);
    },
  };
}

export function parseNearAccountId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9._-]{2,64}$/.test(value) ? value : null;
}

export function parseSha256(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
