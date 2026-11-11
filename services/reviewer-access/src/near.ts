import { decodeBase64, encodeBase64, utf8 } from "./encoding.js";

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

async function rpc(env: Env, method: string, params: unknown): Promise<unknown> {
  const urls = [...new Set([
    env.NEAR_RPC_URL,
    ...(env.NEAR_RPC_FALLBACK_URLS ?? "").split(","),
  ].map((url) => url.trim()).filter(Boolean))];
  const failures: string[] = [];
  for (const url of urls) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "lcp-reviewer-access", method, params }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      failures.push("provider unreachable or timed out");
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403, 408, 429].includes(response.status) || response.status >= 500) {
        failures.push(`provider returned HTTP ${response.status}`);
        continue;
      }
      throw new NearUnavailableError("Finalized NEAR state is unavailable.");
    }

    let payload: { result?: unknown; error?: unknown };
    try {
      payload = await response.json() as { result?: unknown; error?: unknown };
    } catch {
      failures.push("provider returned invalid JSON");
      continue;
    }
    if (payload.error) {
      if (isTransientRpcError(payload.error)) {
        failures.push("provider is temporarily unavailable");
        continue;
      }
      throw new NearUnavailableError("Finalized NEAR state is unavailable.");
    }
    if (payload.result === undefined) {
      failures.push("provider response is missing its result");
      continue;
    }
    return payload.result;
  }
  throw new NearUnavailableError(`Finalized NEAR state is unavailable (${failures.length} providers failed).`);
}

function isTransientRpcError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) return false;
  const message = typeof error.message === "string" ? error.message : "";
  return /rate.?limit|too many requests|temporar|timed? ?out|unavailable|overload|capacity|server error|internal error/i.test(message);
}

export async function finalizedTimeNs(env: Env): Promise<bigint> {
  const result = await rpc(env, "block", { finality: "final" }) as {
    header?: { timestamp_nanosec?: string | number };
  };
  const timestamp = result.header?.timestamp_nanosec;
  if (typeof timestamp !== "string" || !/^[1-9][0-9]*$/.test(timestamp)) {
    throw new NearReadError("NEAR returned an invalid finalized block timestamp.");
  }
  return BigInt(timestamp);
}

export async function viewContract<T>(env: Env, methodName: string, args: Record<string, string>): Promise<T | null> {
  const result = await rpc(env, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: env.CONTRACT_ID,
    method_name: methodName,
    args_base64: encodeBase64(utf8(JSON.stringify(args))),
  }) as { result?: number[] };
  if (!Array.isArray(result.result)) throw new NearReadError("NEAR returned a malformed contract view result.");
  const bytes = Uint8Array.from(result.result);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T | null;
  } catch {
    throw new NearReadError("NEAR returned malformed contract view JSON.");
  }
}

async function readAccessKeyPermission(env: Env, accountId: string, publicKey: string): Promise<unknown> {
  if (!/^[a-z0-9._-]{2,64}$/.test(accountId) || !publicKey.startsWith("ed25519:")) {
    throw new NearReadError("The signed account or key format is unsupported.");
  }
  const result = await rpc(env, "query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: publicKey,
  }) as { permission?: unknown };
  return result.permission;
}

export async function requireCurrentAccessKey(env: Env, accountId: string, publicKey: string): Promise<void> {
  const permission = await readAccessKeyPermission(env, accountId, publicKey);
  if (permission !== "FullAccess" && (typeof permission !== "object" || permission === null || !("FunctionCall" in permission))) {
    throw new NearReadError("The signing key is not a current access key for this NEAR account.");
  }
}

export async function requireFullAccessKey(env: Env, accountId: string, publicKey: string): Promise<void> {
  if (await readAccessKeyPermission(env, accountId, publicKey) !== "FullAccess") {
    throw new NearReadError("The signing key is not a current full-access key for this NEAR account.");
  }
}

export function parseNearAccountId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9._-]{2,64}$/.test(value) ? value : null;
}

export function parseSha256(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
