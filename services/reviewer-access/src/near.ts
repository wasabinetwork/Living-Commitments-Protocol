import { canonicalJson, decodeBase58, decodeBase64, encodeBase64, utf8 } from "./encoding.js";

const RPC_PROVIDER_COUNT = 3;
const RPC_QUORUM = 2;
const RPC_TIMEOUT_MS = 8_000;
const MAX_RPC_RESPONSE_BYTES = 4 * 1024 * 1024;

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
  const snapshots = outcomes
    .filter((outcome): outcome is RpcSuccess => outcome?.kind === "success")
    .map((outcome) => parseFinalizedSnapshot(outcome.result))
    .filter((snapshot): snapshot is FinalizedSnapshot => snapshot !== null);
  if (snapshots.length < RPC_QUORUM) throw new NearUnavailableError("Finalized NEAR state is unavailable.");

  // An isolated provider reporting a higher finalized height must not cause us to
  // silently authorize against a stale lower quorum. Wait until peers agree.
  const highestHeight = Math.max(...snapshots.map((snapshot) => snapshot.blockHeight));
  const candidates = snapshots.filter((snapshot) => snapshot.blockHeight === highestHeight);
  const groups = groupBy(candidates, (snapshot) => `${snapshot.blockHash}:${snapshot.timestampNs}`);
  const agreed = [...groups.values()].find((group) => group.length >= RPC_QUORUM);
  if (!agreed) throw new NearUnavailableError("Finalized NEAR providers did not agree on the current block.");
  return agreed[0];
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
  return /rate.?limit|too many requests|temporar|timed? ?out|unavailable|overload|capacity|server error|internal error/i.test(text);
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
    if (result.block_hash !== snapshot.blockHash || result.block_height !== snapshot.blockHeight) continue;
    matching.push(outcome);
  }
  const groups = groupBy(matching, (outcome) => `${outcome.kind}:${canonicalJson(outcome.kind === "success" ? outcome.result : outcome.error)}`);
  const agreed = [...groups.values()].find((group) => group.length >= RPC_QUORUM);
  if (!agreed) throw new NearUnavailableError("Finalized NEAR providers did not agree on authorization state.");
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
