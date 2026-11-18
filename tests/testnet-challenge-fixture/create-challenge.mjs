#!/usr/bin/env node
/**
 * Create a live pending challenge on NEAR testnet for the P1-2 Console check.
 *
 * Flow: sponsor creates a NEAR-denominated commitment, funds escrow and
 * evaluator operations, activates it, the maintainer signs a v1 heartbeat and
 * the sponsor requests evaluation. Once the evaluator accepts a compliant
 * verdict, the sponsor opens a challenge inside the configured challenge
 * window. The script then prints the commitment, evaluation, challenge, and
 * transaction hashes plus the preview URL to inspect.
 *
 * Usage:
 *   node tests/testnet-challenge-fixture/create-challenge.mjs [--dry-run]
 *     [--commitment-id 44] [--no-challenge] [--usdc]
 *     [--unregistered-beneficiary]
 *
 * `--usdc` settles the tranche in the verified testnet USDC token and funds
 * escrow with `ft_transfer_call`. `--unregistered-beneficiary` creates (or
 * reuses) a subaccount of the sponsor that has no USDC storage registration,
 * so the Console should show the beneficiary registration note once the
 * tranche is eligible.
 *
 * `--slow-evaluator` pins a ten-second streamed non-WASM body. The fetch delay
 * keeps the evaluation pending before instantiation fails. Use `--setup-only`
 * and then `--commitment-id=<id> --stop-after-request` to inspect that state.
 *
 * Requires `npm install --no-save near-api-js` and the testnet keys in
 * `.env.testnet` (or the same variables in the environment). Account defaults
 * are lcpmaintainer/ lcpsponsor/ lcparbiter/ lcprecipient .testnet and can be
 * overridden with MAINTAINER_ACCOUNT_ID, SPONSOR_ACCOUNT_ID, etc.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const near = require("near-api-js");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT_ID = "livingcommitmentsprotocol.testnet";
const RPC_URL = process.env.NEAR_RPC_URL?.trim() || "https://test.rpc.fastnear.com";
const PREVIEW_URL = "https://preview.lcp-preview.pages.dev/";
const OUTLAYER_ACCOUNT = "outlayer.testnet";
const HEARTBEAT_WASM_URL =
  "https://artifacts.lcp.gama.works/2bf6e040e091a967fa5dc1129a9fe083b693d02474ea12531a76b0bcfed5b15b.wasm";
const HEARTBEAT_WASM_SHA =
  "2bf6e040e091a967fa5dc1129a9fe083b693d02474ea12531a76b0bcfed5b15b";
const NEAR = 10n ** 24n;
const GAS = 250n * 10n ** 12n;
const FT_CALLBACK_GAS = 100n * 10n ** 12n;
const TESTNET_USDC_ACCOUNT =
  "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const USDC_DECIMALS = 6;
const DEFAULT_USDC_TRANCHE_RAW = 1_000_000n;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noChallenge = args.includes("--no-challenge");
const stopAfterRequest = args.includes("--stop-after-request");
const forceEvaluate = args.includes("--force-evaluate");
const useUsdc = args.includes("--usdc");
const unregisteredBeneficiary = args.includes("--unregistered-beneficiary");
const setupOnly = args.includes("--setup-only");
const slowEvaluator = args.includes("--slow-evaluator");
if (unregisteredBeneficiary && !useUsdc) {
  throw new Error("--unregistered-beneficiary requires --usdc.");
}
const commitmentArg = args.find((value) => value.startsWith("--commitment-id="));
const resumeCommitmentId = commitmentArg?.split("=")[1] ?? null;

const ROLE_DEFAULTS = {
  maintainer: ["MAINTAINER_PRIVATE_KEY", "lcpmaintainer.testnet", "MAINTAINER_ACCOUNT_ID"],
  sponsor: ["SPONSOR_PRIVATE_KEY", "lcpsponsor.testnet", "SPONSOR_ACCOUNT_ID"],
};


function parseEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]] = value;
  }
  return values;
}

const fileEnv = parseEnvFile(resolve(ROOT, ".env.testnet"));
const env = { ...fileEnv, ...process.env };
// The drip endpoint streams ten `*` bytes over ten seconds. Pinning its exact
// digest makes OutLayer wait for the fetch before rejecting the non-WASM body.
const SLOW_EVALUATOR_WASM_URL =
  env.SLOW_EVALUATOR_WASM_URL?.trim() ||
  "https://httpbingo.org/drip?duration=10&numbytes=10&delay=0";
const SLOW_EVALUATOR_WASM_SHA =
  env.SLOW_EVALUATOR_WASM_SHA?.trim() ||
  "6e9ba2d4743b72079ae971666d7e61f0587704fbcfcd4f874ebb2a6a700d4435";
const ARBITER_ACCOUNT_ID = env.ARBITER_ACCOUNT_ID?.trim() || "lcparbiter.testnet";
const BENEFICIARY_ACCOUNT_ID = env.BENEFICIARY_ACCOUNT_ID?.trim() || "lcprecipient.testnet";

function role(name) {
  const [keyVar, defaultAccount, accountVar] = ROLE_DEFAULTS[name];
  const secret = env[keyVar];
  const accountId = env[accountVar]?.trim() || defaultAccount;
  if (!secret) throw new Error(`${keyVar} is missing from .env.testnet or the environment.`);
  const key = near.KeyPair.fromString(secret.trim());
  return { name, accountId, key, keyVar, accountVar };
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function publicKeyHex(key) {
  return hex(key.getPublicKey().data);
}

function envSeconds(name, fallback) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be a positive whole number of seconds.`);
  return raw;
}

function ns(seconds) {
  return (BigInt(seconds) * 1_000_000_000n).toString();
}

async function verifyKeys(provider, roles) {
  for (const item of roles) {
    const publicKey = item.key.getPublicKey().toString();
    try {
      await provider.viewAccessKey({ accountId: item.accountId, publicKey });
    } catch (error) {
      throw new Error(
        `${item.keyVar} does not control ${item.accountId} (${publicKey.slice(0, 15)}…). ` +
          `Set ${item.accountVar} to the account that owns this key.`,
      );
    }
  }
}

async function view(provider, method, argsObject) {
  return provider.callFunction({ contractId: CONTRACT_ID, method, args: argsObject });
}

async function viewToken(provider, method, argsObject) {
  return provider.callFunction({ contractId: TESTNET_USDC_ACCOUNT, method, args: argsObject });
}

async function ensureUnregisteredBeneficiary(provider, previewOnly) {
  const configured = env.UNREGISTERED_BENEFICIARY_ACCOUNT_ID?.trim();
  const accountId = configured || `usdc-unregistered.${sponsor.accountId}`;
  if (!accountId.endsWith(`.${sponsor.accountId}`) && !configured) {
    throw new Error("The generated unregistered beneficiary is not a sponsor subaccount.");
  }
  const storage = await viewToken(provider, "storage_balance_of", { account_id: accountId });
  if (storage) {
    throw new Error(
      `${accountId} already has USDC storage (${JSON.stringify(storage)}). ` +
        `Set UNREGISTERED_BENEFICIARY_ACCOUNT_ID to a different unregistered account.`,
    );
  }
  try {
    await provider.viewAccount({ accountId });
    console.log(`${accountId} already exists without USDC storage.`);
  } catch {
    if (previewOnly) {
      console.log(`${accountId} does not exist and would be created without USDC storage.`);
    } else {
      const account = new near.Account(sponsor.accountId, provider, sponsor.key.toString());
      const outcome = await account.createAccount({
        newAccountId: accountId,
        publicKey: sponsor.key.getPublicKey().toString(),
        nearToTransfer: NEAR / 10n,
      });
      console.log(`Created unregistered beneficiary ${accountId}: ${outcome.transaction?.hash ?? "unknown"}`);
    }
  }
  return accountId;
}

async function signAndSend(provider, role, receiverId, actions, label) {
  const account = new near.Account(role.accountId, provider, role.key.toString());
  const outcome = await account.signAndSendTransaction({ receiverId, actions });
  const result = near.getTransactionLastResult(outcome);
  const txHash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? "unknown";
  console.log(`${label}: ${txHash}`);
  return { result, txHash, outcome };
}

function functionCall(method, payload, gas, deposit) {
  return near.actions.functionCall(method, payload, gas, deposit);
}

function buildHeartbeat({ commitment, maintainer, observedAtNs, evaluationId, evidenceHash }) {
  const payload = JSON.stringify({
    schema: "lcp.heartbeat.v1",
    commitment_id: commitment.id,
    evaluation_id: String(evaluationId),
    policy_version: 1,
    policy_hash: commitment.policy_hash,
    observed_at_ns: observedAtNs,
    subject: commitment.subject,
    artifact_hash: evidenceHash,
  });
  const signature = maintainer.key.sign(new TextEncoder().encode(payload));
  return {
    envelope: {
      type: "signed_maintenance_heartbeat",
      artifact_hash: evidenceHash,
      maintainer_public_key: publicKeyHex(maintainer.key),
      signature: hex(signature.signature),
      payload,
    },
    observedAtNs,
  };
}

async function waitFor(predicate, { label, timeoutMs, intervalMs = 5_000 }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last?.done) return last.value;
    process.stdout.write(`  waiting for ${label}…\n`);
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, intervalMs);
    });
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}.`);
}

const provider = new near.JsonRpcProvider({ url: RPC_URL });
const maintainer = role("maintainer");
const sponsor = role("sponsor");

await verifyKeys(provider, [maintainer, sponsor]);

let effectiveBeneficiary = BENEFICIARY_ACCOUNT_ID;
if (unregisteredBeneficiary) {
  effectiveBeneficiary = await ensureUnregisteredBeneficiary(provider, dryRun);
}

const sponsorState = await provider.viewAccount({ accountId: sponsor.accountId });
if (BigInt(sponsorState.amount) < 2n * NEAR) {
  throw new Error(`${sponsor.accountId} needs at least 2 NEAR for escrow, operations, and storage.`);
}

console.log(`Contract: ${CONTRACT_ID}`);
console.log(`Maintainer: ${maintainer.accountId} (${publicKeyHex(maintainer.key).slice(0, 16)}…)`);
console.log(`Sponsor: ${sponsor.accountId}`);
console.log(`Arbiter: ${ARBITER_ACCOUNT_ID}`);
console.log(`Beneficiary: ${effectiveBeneficiary}`);
console.log(`Settlement: ${useUsdc ? `USDC (${TESTNET_USDC_ACCOUNT})` : "NEAR"}`);

if (dryRun) {
  console.log("Dry run: keys match their accounts and the sponsor is funded; no transactions sent.");
  process.exit(0);
}

const usdcTrancheRaw = (env.USDC_TRANCHE_RAW?.trim() || DEFAULT_USDC_TRANCHE_RAW.toString());
if (useUsdc && !/^[1-9][0-9]*$/.test(usdcTrancheRaw)) {
  throw new Error("USDC_TRANCHE_RAW must be a positive whole number of raw token units.");
}

let commitmentId = resumeCommitmentId;
if (!commitmentId) {
  const policy = {
    temporal: {
      initial_window_ns: ns(envSeconds("INITIAL_WINDOW_SECONDS", 86_400)),
      evidence_ttl_ns: ns(envSeconds("EVIDENCE_TTL_SECONDS", 172_800)),
      grace_ns: ns(3_600),
      max_source_lag_ns: ns(600),
      challenge_window_ns: ns(envSeconds("CHALLENGE_WINDOW_SECONDS", 43_200)),
      resolution_timeout_ns: ns(envSeconds("RESOLUTION_TIMEOUT_SECONDS", 86_400)),
      recovery_allowed: true,
    },
    evidence: {
      signature_scheme: "ed25519_raw_v1",
      maintainer_public_key_hex: publicKeyHex(maintainer.key),
    },
    evaluator: {
      outlayer_account: OUTLAYER_ACCOUNT,
      wasm_url: slowEvaluator ? SLOW_EVALUATOR_WASM_URL : HEARTBEAT_WASM_URL,
      // A distinct digest bypasses OutLayer's artifact cache, so the delayed
      // fetch is actually exercised and the evaluation stays pending.
      wasm_sha256_hex: slowEvaluator ? SLOW_EVALUATOR_WASM_SHA : HEARTBEAT_WASM_SHA,
      build_target: "wasm32-wasip1",
      max_instructions: "1000000000",
      max_memory_mb: 64,
      max_execution_seconds: "10",
      request_timeout_ns: ns(300),
      execution_deposit_yocto: (NEAR / 100n).toString(),
    },      budget: useUsdc
        ? {
            sponsor: sponsor.accountId,
            beneficiary: effectiveBeneficiary,
            epoch_ns: ns(3_600),
            max_epochs: 1,
            tranche_yocto: "0",
            settlement_asset: {
              kind: "nep141",
              token_account_id: TESTNET_USDC_ACCOUNT,
            },
            tranche_amount_raw: usdcTrancheRaw,
          }
        : {
            sponsor: sponsor.accountId,
            beneficiary: effectiveBeneficiary,
            epoch_ns: ns(3_600),
            max_epochs: 1,
            tranche_yocto: (NEAR / 100n).toString(),
          },

  };
  const create = await signAndSend(
    provider,
    sponsor,
    CONTRACT_ID,
    [
      functionCall(
        "create_commitment",
        {
          args: {
            subject: `P1-2 deadline clarity ${new Date().toISOString()}`,
            maintainer: maintainer.accountId,
            arbiter: ARBITER_ACCOUNT_ID,
            policy,
          },
        },
        GAS,
        NEAR / 10n,
      ),
    ],
    "create_commitment",
  );
  commitmentId = String(create.result);
  console.log(`Commitment #${commitmentId}`);
}

let commitment = await view(provider, "get_commitment", { commitment_id: commitmentId });
if (!commitment) throw new Error(`Commitment #${commitmentId} was not found.`);

if (commitment.lifecycle === "Draft") {
  if (useUsdc) {
    const policyView = await view(provider, "get_policy", { commitment_id: commitmentId });
    const trancheRaw = BigInt(commitment.tranche_amount_raw);
    const requiredRaw = trancheRaw * BigInt(policyView?.budget?.max_epochs ?? 1);
    const fundedRaw = BigInt(commitment.escrow_funded_raw);
    const escrowNeededRaw = requiredRaw - fundedRaw;
    if (escrowNeededRaw > 0n) {
      const sponsorRaw = BigInt(
        await viewToken(provider, "ft_balance_of", { account_id: sponsor.accountId }),
      );
      if (sponsorRaw < escrowNeededRaw) {
        throw new Error(
          `${sponsor.accountId} has ${sponsorRaw} raw USDC but ${escrowNeededRaw} is required.`,
        );
      }
      await signAndSend(
        provider,
        sponsor,
        TESTNET_USDC_ACCOUNT,
        [
          functionCall(
            "ft_transfer_call",
            {
              receiver_id: CONTRACT_ID,
              amount: escrowNeededRaw.toString(),
              msg: JSON.stringify({ schema: "lcp.funding.v1", commitment_id: commitmentId }),
            },
            FT_CALLBACK_GAS,
            1n,
          ),
        ],
        "ft_transfer_call (USDC escrow)",
      );
      commitment = await view(provider, "get_commitment", { commitment_id: commitmentId });
      if (BigInt(commitment.escrow_funded_raw) < requiredRaw) {
        throw new Error(
          `USDC escrow funded ${commitment.escrow_funded_raw}; expected ${requiredRaw}.`,
        );
      }
    }
  } else {
    const tranche = NEAR / 100n;
    const escrowNeeded = tranche - BigInt(commitment.escrow_funded_yocto);
    if (escrowNeeded > 0n) {
      await signAndSend(
        provider,
        sponsor,
        CONTRACT_ID,
        [functionCall("fund_commitment", { commitment_id: commitmentId }, GAS, escrowNeeded)],
        "fund_commitment",
      );
    }
  }
  const operationsAvailable =
    BigInt(commitment.operations_funded_yocto) - BigInt(commitment.operations_authorized_spend_yocto);
  if (operationsAvailable < NEAR / 100n) {
    await signAndSend(
      provider,
      sponsor,
      CONTRACT_ID,
      [functionCall("fund_operations", { commitment_id: commitmentId }, GAS, NEAR / 10n)],
      "fund_operations",
    );
  }
  await signAndSend(
    provider,
    sponsor,
    CONTRACT_ID,
    [functionCall("activate_commitment", { commitment_id: commitmentId }, GAS, NEAR / 10n)],
    "activate_commitment",
  );
  commitment = await view(provider, "get_commitment", { commitment_id: commitmentId });
}

if (commitment.lifecycle !== "Active") {
  throw new Error(`Commitment #${commitmentId} is ${commitment.lifecycle}; expected Active.`);
}
console.log(`Commitment #${commitmentId} is Active; health ${commitment.effective_health}.`);

if (setupOnly) {
  console.log(`Setup complete; no evaluation requested for commitment #${commitmentId}.`);
  process.exit(0);
}

if (commitment.active_challenge_id) {
  console.log(`Challenge #${commitment.active_challenge_id} is already open; nothing to do.`);
  process.exit(0);
}

let evaluationId = commitment.pending_evaluation_id
  ?? (commitment.last_good_observed_at_ns && !commitment.negative_since_ns && !forceEvaluate
    ? (BigInt(commitment.next_evaluation_id) - 1n).toString()
    : commitment.next_evaluation_id);
if (commitment.pending_evaluation_id) {
  console.log(`Evaluation #${evaluationId} is already pending; waiting for its result.`);
} else if (forceEvaluate || !commitment.last_good_observed_at_ns || commitment.negative_since_ns) {
  const observedAtNs = (BigInt(Date.now()) * 1_000_000n).toString();
  // Fixed public marker; the evaluator checks the signature binding, not the file.
  const artifactHash = "a".repeat(64);
  const heartbeat = buildHeartbeat({
    commitment,
    maintainer,
    observedAtNs,
    evaluationId,
    evidenceHash: artifactHash,
  });
  const request = await signAndSend(
    provider,
    sponsor,
    CONTRACT_ID,
    [
      functionCall(
        "request_evaluation",
        { commitment_id: commitmentId, evidence: heartbeat.envelope },
        GAS,
        NEAR / 5n,
      ),
    ],
    `request_evaluation (#${evaluationId})`,
  );
  evaluationId = String(request.result);
  console.log(`Evaluation #${evaluationId} requested.`);
  if (stopAfterRequest) {
    console.log(`Stopping after request; inspect commitment #${commitmentId} while evaluation #${evaluationId} is pending.`);
    process.exit(0);
  }
  console.log("Waiting for the evaluator callback.");
}

const record = await waitFor(
  async () => {
    const current = await view(provider, "get_evaluation", {
      commitment_id: commitmentId,
      evaluation_id: evaluationId,
    });
    if (!current || current.status === "Pending") return null;
    if (current.status === "Accepted" && current.verdict === "Compliant") {
      return { done: true, value: current };
    }
    throw new Error(
      `Evaluation #${evaluationId} finished ${current.status} ${current.verdict ?? ""} ` +
        `(${(current.reason_codes ?? []).join(", ")}). Re-run with --commitment-id=${commitmentId} ` +
        `after funding more operations.`,
    );
  },
  { label: `evaluation #${evaluationId}`, timeoutMs: 360_000 },
);
console.log(`Evaluation #${evaluationId}: ${record.status} ${record.verdict}.`);

commitment = await view(provider, "get_commitment", { commitment_id: commitmentId });
if (commitment.active_challenge_id) {
  console.log(`Challenge #${commitment.active_challenge_id} is already open.`);
} else if (noChallenge) {
  console.log("Skipping challenge creation (--no-challenge).");
} else {
  const challenge = await signAndSend(
    provider,
    sponsor,
    CONTRACT_ID,
    [
      functionCall(
        "challenge_evaluation",
        {
          commitment_id: commitmentId,
          evaluation_id: evaluationId,
          reason: "P1-2 deadline clarity fixture: verify the challenge countdown and expiry controls.",
        },
        GAS,
        NEAR / 20n,
      ),
    ],
    "challenge_evaluation",
  );
  const challengeId = String(challenge.result);
  console.log(`Challenge #${challengeId} opened.`);
}

commitment = await view(provider, "get_commitment", { commitment_id: commitmentId });
const eligibility = await view(provider, "can_claim_tranche", { commitment_id: commitmentId });
const beneficiaryStorage = useUsdc
  ? await viewToken(provider, "storage_balance_of", { account_id: effectiveBeneficiary })
  : null;
console.log("\nFixture ready:");
console.log(`  commitment: #${commitmentId}`);
console.log(`  evaluation: #${evaluationId}`);
console.log(`  challenge: #${commitment.active_challenge_id ?? "(none)"}`);
console.log(`  beneficiary: ${effectiveBeneficiary}`);
console.log(`  beneficiary USDC storage: ${beneficiaryStorage ? "registered" : "unregistered"}`);
console.log(`  eligible: ${eligibility?.eligible === true}`);
console.log(`  preview: ${PREVIEW_URL}?commitment=${commitmentId}`);
console.log(`  inspect: ${PREVIEW_URL} (enter ${commitmentId})`);
