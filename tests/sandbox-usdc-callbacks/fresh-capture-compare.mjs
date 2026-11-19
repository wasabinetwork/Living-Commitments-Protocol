import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

// Fields a rerun of the same fixture is expected to change: recorded hashes and
// receipt IDs, chain identity, activation timestamps, gas, block heights, and
// absolute balances that track gas fees. Everything else, including counters,
// epochs, generations, flags, escrow buckets, and artifact digests, must match.
const VOLATILE_KEY_PATTERNS = [
  /^captured_at$/,
  /^chain_id$/,
  /^genesis_hash$/,
  /^instance_id$/,
  /^transaction_hash$/,
  /_transaction_hash$/,
  /_receipt_id$/,
  /_ns$/,
  /_block_height$/,
  /_gas_burnt$/,
  /_gas_fee_yocto$/,
  /balance/,
];

function isVolatile(path, ignore) {
  if (ignore.includes(path)) return true;
  const key = path.split(".").pop();
  return VOLATILE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function describe(value) {
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function walk(fresh, committed, path, state) {
  if (isVolatile(path, state.ignore)) {
    state.skipped += 1;
    return;
  }
  const freshIsArray = Array.isArray(fresh);
  if (freshIsArray !== Array.isArray(committed)) {
    assert.fail(`${path} is an array in only one of the two captures`);
  }
  if (freshIsArray) {
    assert.equal(fresh.length, committed.length,
      `${path} has ${fresh.length} entries in the fresh capture and ${committed.length} in the committed evidence`);
    fresh.forEach((entry, index) => walk(entry, committed[index], `${path}[${index}]`, state));
    return;
  }
  if (fresh && committed && typeof fresh === "object" && typeof committed === "object") {
    assert.deepEqual(Object.keys(fresh), Object.keys(committed),
      `${path} records different fields in the fresh capture`);
    for (const key of Object.keys(committed)) {
      walk(fresh[key], committed[key], path ? `${path}.${key}` : key, state);
    }
    return;
  }
  assert.ok(isDeepStrictEqual(fresh, committed),
    `${path} differs from the committed evidence: fresh ${describe(fresh)} vs committed ${describe(committed)}`);
  state.compared += 1;
}

/**
 * Compares a freshly captured fixture payload with the committed evidence,
 * excluding fields a rerun is expected to change. Returns the compared and
 * skipped field counts and throws at the first difference that must not move.
 */
export function compareCaptureFields(fresh, committed, { ignore = [], label = "capture" } = {}) {
  assert.ok(fresh && typeof fresh === "object", `${label}: fresh capture must be an object`);
  assert.ok(committed && typeof committed === "object",
    `${label}: committed evidence must be an object`);
  const state = { compared: 0, skipped: 0, ignore };
  walk(fresh, committed, "", state);
  assert.ok(state.compared > 0, `${label}: comparison must cover at least one field`);
  return { compared: state.compared, skipped: state.skipped };
}

/**
 * Splits `--fresh <path...>` out of a verifier's arguments. `count` is the
 * number of fresh capture paths a verifier needs (one, or two for paired
 * captures).
 */
export function extractFreshArguments(args, count = 1) {
  const positional = [];
  const freshPaths = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--fresh") {
      for (let offset = 1; offset <= count; offset += 1) {
        const value = args[index + offset];
        assert.ok(value && !value.startsWith("--"),
          `--fresh requires ${count === 1 ? "the path" : `${count} paths`} to freshly captured JSON files`);
        freshPaths.push(value);
      }
      index += count;
    } else {
      assert.ok(!args[index].startsWith("--"), `unknown option: ${args[index]}`);
      positional.push(args[index]);
    }
  }
  return { freshPaths, positional };
}
