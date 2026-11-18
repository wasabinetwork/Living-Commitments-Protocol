/**
 * Off-chain decision for one pending USDC recovery transfer.
 *
 * The function applies the normative receipt-to-intent procedure. It does not
 * verify NEAR receipt proofs, talk to an RPC, or choose a certificate by
 * looking at the current code-hash registry. Success uses the hash stored in
 * the intent and the retained historical allowlist only.
 */

const TRANSFER_GAS_TGAS = 25;
const TRANSFER_DEPOSIT_YOCTO = "1";

export function decide(evidence) {
  const unknown = (reason) => ({ outcome: "unknown", reason });
  const intent = evidence?.intent;
  if (!evidence || evidence.pending !== true || !intent) return unknown("not_pending");
  if (!contextMatches(evidence.observed, intent)) return unknown("context_mismatch");
  if (intent.depositYocto !== TRANSFER_DEPOSIT_YOCTO || intent.gasTgas !== TRANSFER_GAS_TGAS) {
    return unknown("context_mismatch");
  }
  if (intent.amountRaw === "0" || !canonicalAmount(intent.amountRaw)) return unknown("context_mismatch");

  const origins = evidence.origins;
  if (!Array.isArray(origins) || origins.length === 0) return unknown("missing_ancestry");
  if (origins.length !== 1) return unknown("multiple_origins");
  const origin = origins[0];
  if (origin.receiver !== intent.coreAccountId) return unknown("another_core");
  if (origin.commitmentId !== intent.commitmentId) return unknown("wrong_commitment");
  if (origin.method !== methodFor(intent.originMethod)) return unknown("wrong_method");
  if (origin.final !== true) return unknown("nonfinal");
  const event = origin.event ?? {};
  if (
    event.transferId !== intent.transferId
    || event.intentHash !== intent.intentHash
    || event.commitmentId !== intent.commitmentId
    || event.standard !== "lcp"
    || event.version !== "1.0.0"
    || event.event !== "token_transfer_intent"
    || event.schemaVersion !== 1
  ) {
    return unknown("wrong_commitment");
  }

  const children = origin.tokenReceiptIds ?? [];
  if (children.some((id, index) => children.indexOf(id) !== index)) return unknown("identical_transfers");
  if (children.length === 0) return unknown("missing_ancestry");
  if (children.length !== 1) return unknown("multiple_token_actions");
  if (evidence.ancestryComplete !== true) return unknown("missing_ancestry");
  if (evidence.providersAgree !== true) return unknown("provider_disagreement");
  if (evidence.replayAvailable !== true) return unknown("missing_replay");

  const receipt = evidence.tokenReceipt;
  if (!receipt || receipt.id !== children[0]) return unknown("missing_ancestry");
  if (receipt.final !== true) return unknown("nonfinal");
  if (receipt.predecessor !== intent.coreAccountId) return unknown("wrong_sender");
  if (receipt.receiver !== intent.tokenAccountId) return unknown("wrong_token");
  if (receipt.outcome === "SuccessReceiptId") return unknown("success_receipt_id");
  if (receipt.outcome !== "SuccessValue" && receipt.outcome !== "Failure") return unknown("nonfinal");

  const actions = Array.isArray(receipt.actions) ? receipt.actions : [];
  const transferIndexes = actions.flatMap((action, index) => (
    action?.method === "ft_transfer" ? [index] : []
  ));
  if (transferIndexes.length === 0) return unknown("wrong_method");
  if (transferIndexes.length > 1) return unknown("identical_transfers");
  if (transferIndexes[0] !== 0) return unknown("wrong_action_index");
  if (actions.length !== 1) return unknown("batched_actions");

  let args;
  try {
    args = parseJsonExact(receipt.argsText);
  } catch (error) {
    return unknown(error?.code === "duplicate_key" ? "duplicate_json_keys" : "malformed_arguments");
  }
  if (!isExactTransferArgs(args)) return unknown("malformed_arguments");
  const action = actions[0];
  if (String(action.depositYocto) !== TRANSFER_DEPOSIT_YOCTO) return unknown("wrong_deposit");
  if (action.gasTgas !== TRANSFER_GAS_TGAS) return unknown("wrong_gas");
  if (args.receiver_id !== intent.recipient) return unknown("wrong_recipient");
  if (!canonicalAmount(args.amount)) return unknown("bad_amount_encoding");
  if (args.amount !== intent.amountRaw) return unknown("wrong_amount");
  if (args.memo !== transferMemo(intent)) return unknown("wrong_memo");

  if (receipt.outcome === "Failure") return { outcome: "failure", reason: null };

  const metadata = receipt.executionMetadata;
  if (!metadata || metadata.version !== 4 || !Array.isArray(metadata.contracts)) {
    return unknown("unsupported_metadata");
  }
  if (metadata.contracts.length !== actions.length) return unknown("metadata_length");
  const code = metadata.contracts[0];
  if (!code || code.kind !== "Local" || typeof code.hash !== "string" || code.hash.length === 0) {
    return unknown("unsupported_metadata");
  }
  if (code.hash !== intent.tokenCodeHash) return unknown("code_hash_mismatch");
  if (!Array.isArray(evidence.historicalAllowlist) || !evidence.historicalAllowlist.includes(intent.tokenCodeHash)) {
    return unknown("hash_not_in_allowlist");
  }
  return { outcome: "success", reason: null };
}

/**
 * Records one outcome and digest for an instance transfer. The same pair may
 * be replayed. A different outcome or digest is rejected and leaves the
 * journal unchanged.
 */
export function remember(journal, entry) {
  const key = `${entry.instanceId}:${entry.transferId}`;
  const existing = journal.get(key);
  if (!existing) {
    journal.set(key, { outcome: entry.outcome, digest: entry.digest });
    return "recorded";
  }
  if (existing.outcome === entry.outcome && existing.digest === entry.digest) return "replay";
  return "rejected";
}

export function commitDecision(journal, evidence, digest) {
  const decision = decide(evidence);
  if (decision.outcome === "unknown") return { ...decision, journal: "abstained" };
  const status = remember(journal, {
    instanceId: evidence.intent.instanceId,
    transferId: evidence.intent.transferId,
    outcome: decision.outcome,
    digest,
  });
  return { ...decision, journal: status };
}

export function transferMemo(intent) {
  return `LCP1:${intent.instanceId}:${intent.transferId}:${intent.intentHash}`;
}

function contextMatches(observed, intent) {
  if (!observed) return false;
  return observed.chainId === intent.chainId
    && observed.genesisHash === intent.genesisHash
    && observed.coreAccountId === intent.coreAccountId
    && observed.instanceId === intent.instanceId
    && observed.transferId === intent.transferId;
}

function methodFor(originMethod) {
  if (originMethod === "claim_tranche") return "claim_tranche";
  if (originMethod === "refund_remaining") return "refund_remaining";
  return "";
}

function canonicalAmount(value) {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function isExactTransferArgs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 3
    && Object.hasOwn(value, "receiver_id")
    && Object.hasOwn(value, "amount")
    && Object.hasOwn(value, "memo");
}

export function parseJsonExact(text) {
  if (typeof text !== "string") {
    const error = new Error("JSON text required");
    error.code = "malformed";
    throw error;
  }
  let index = 0;
  const skip = () => {
    while (index < text.length && " \n\r\t".includes(text[index])) index += 1;
  };
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  const parseValue = () => {
    skip();
    const marker = text[index];
    if (marker === "{") return parseObject();
    if (marker === "[") return parseArray();
    if (marker === '"') return parseString();
    if (marker === "t" || marker === "f") return parseLiteral(marker === "t" ? "true" : "false");
    if (marker === "n") return parseLiteral("null");
    if (marker === "-" || (marker >= "0" && marker <= "9")) return parseNumber();
    fail("malformed", "unsupported JSON value");
  };
  const parseObject = () => {
    index += 1;
    const value = {};
    const seen = new Set();
    skip();
    if (text[index] === "}") {
      index += 1;
      return value;
    }
    while (index < text.length) {
      skip();
      if (text[index] !== '"') fail("malformed", "JSON object key must be a string");
      const key = parseString();
      if (seen.has(key)) fail("duplicate_key", `duplicate JSON key ${key}`);
      seen.add(key);
      skip();
      if (text[index] !== ":") fail("malformed", "JSON object is missing a colon");
      index += 1;
      value[key] = parseValue();
      skip();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "}") {
        index += 1;
        return value;
      }
      fail("malformed", "JSON object is not closed");
    }
    fail("malformed", "JSON object ended early");
  };
  const parseArray = () => {
    index += 1;
    const value = [];
    skip();
    if (text[index] === "]") {
      index += 1;
      return value;
    }
    while (index < text.length) {
      value.push(parseValue());
      skip();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        return value;
      }
      fail("malformed", "JSON array is not closed");
    }
    fail("malformed", "JSON array ended early");
  };
  const parseString = () => {
    index += 1;
    let value = "";
    while (index < text.length) {
      const marker = text[index];
      if (marker === '"') {
        index += 1;
        return value;
      }
      if (marker === "\\") {
        const escaped = text[index + 1];
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (!Object.hasOwn(simple, escaped)) fail("malformed", "unsupported JSON string escape");
        value += simple[escaped];
        index += 2;
        continue;
      }
      if (marker < " ") fail("malformed", "unescaped control character in JSON string");
      value += marker;
      index += 1;
    }
    fail("malformed", "JSON string ended early");
  };
  const parseLiteral = (literal) => {
    if (text.slice(index, index + literal.length) !== literal) fail("malformed", "invalid JSON literal");
    index += literal.length;
    if (literal === "true") return true;
    if (literal === "false") return false;
    return null;
  };
  const parseNumber = () => {
    const start = index;
    if (text[index] === "-") index += 1;
    if (text[index] === "0") index += 1;
    else if (text[index] >= "1" && text[index] <= "9") {
      while (text[index] >= "0" && text[index] <= "9") index += 1;
    } else fail("malformed", "invalid JSON number");
    if (text[index] === ".") {
      index += 1;
      if (!(text[index] >= "0" && text[index] <= "9")) fail("malformed", "invalid JSON fraction");
      while (text[index] >= "0" && text[index] <= "9") index += 1;
    }
    if (text[index] === "e" || text[index] === "E") {
      index += 1;
      if (text[index] === "+" || text[index] === "-") index += 1;
      if (!(text[index] >= "0" && text[index] <= "9")) fail("malformed", "invalid JSON exponent");
      while (text[index] >= "0" && text[index] <= "9") index += 1;
    }
    return Number(text.slice(start, index));
  };

  const value = parseValue();
  skip();
  if (index !== text.length) fail("malformed", "trailing JSON input");
  return value;
}
