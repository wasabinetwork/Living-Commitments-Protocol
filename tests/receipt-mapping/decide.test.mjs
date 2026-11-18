import assert from "node:assert/strict";
import test from "node:test";
import { commitDecision, decide, transferMemo } from "./decide.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const INTENT_HASH = "c".repeat(64);
const INSTANCE = "d".repeat(64);

function validEvidence(overrides = {}) {
  const intent = {
    chainId: "testnet",
    genesisHash: "g".repeat(64),
    coreAccountId: "lcp.core.testnet",
    instanceId: INSTANCE,
    transferId: "7",
    commitmentId: "11",
    originMethod: "claim_tranche",
    amountRaw: "1500000",
    recipient: "beneficiary.testnet",
    tokenAccountId: "usdc.testnet",
    tokenCodeHash: HASH_A,
    intentHash: INTENT_HASH,
    depositYocto: "1",
    gasTgas: 25,
    ...overrides.intent,
  };
  const base = {
    pending: true,
    intent,
    observed: {
      chainId: intent.chainId,
      genesisHash: intent.genesisHash,
      coreAccountId: intent.coreAccountId,
      instanceId: intent.instanceId,
      transferId: intent.transferId,
    },
    historicalAllowlist: [HASH_A],
    currentActiveHash: HASH_B,
    ancestryComplete: true,
    providersAgree: true,
    replayAvailable: true,
    origins: [{
      receiver: intent.coreAccountId,
      method: "claim_tranche",
      commitmentId: intent.commitmentId,
      final: true,
      tokenReceiptIds: ["receipt-1"],
      event: {
        standard: "lcp",
        version: "1.0.0",
        event: "token_transfer_intent",
        schemaVersion: 1,
        transferId: intent.transferId,
        intentHash: intent.intentHash,
        commitmentId: intent.commitmentId,
      },
    }],
    tokenReceipt: {
      id: "receipt-1",
      predecessor: intent.coreAccountId,
      receiver: intent.tokenAccountId,
      final: true,
      outcome: "SuccessValue",
      actions: [{
        method: "ft_transfer",
        depositYocto: "1",
        gasTgas: 25,
      }],
      argsText: JSON.stringify({
        receiver_id: intent.recipient,
        amount: intent.amountRaw,
        memo: transferMemo(intent),
      }),
      executionMetadata: {
        version: 4,
        contracts: [{ kind: "Local", hash: HASH_A }],
      },
    },
  };
  return merge(base, overrides);
}

function merge(base, overrides) {
  return {
    ...base,
    ...overrides,
    intent: overrides.intent ? { ...base.intent, ...overrides.intent } : base.intent,
    observed: overrides.observed ? { ...base.observed, ...overrides.observed } : base.observed,
    origins: overrides.origins ?? base.origins,
    tokenReceipt: overrides.tokenReceipt
      ? { ...base.tokenReceipt, ...overrides.tokenReceipt }
      : base.tokenReceipt,
  };
}

test("success requires the intent hash at action zero and in the retained allowlist", () => {
  const decision = decide(validEvidence());
  assert.deepEqual(decision, { outcome: "success", reason: null });
  assert.equal(
    decide(validEvidence({
      tokenReceipt: {
        executionMetadata: { version: 4, contracts: [{ kind: "Local", hash: HASH_B }] },
      },
    })).reason,
    "code_hash_mismatch",
  );
  assert.equal(decide(validEvidence({ historicalAllowlist: [HASH_B] })).reason, "hash_not_in_allowlist");
});

test("failure does not require a code hash, including pre-execution failure", () => {
  const failed = decide(validEvidence({
    tokenReceipt: {
      outcome: "Failure",
      executionMetadata: null,
      codeAvailable: false,
    },
  }));
  assert.deepEqual(failed, { outcome: "failure", reason: null });
});

test("abstains on the normative ambiguous receipt shapes", () => {
  const cases = [
    ["multiple_origins", validEvidence({
      origins: [validEvidence().origins[0], validEvidence().origins[0]],
    })],
    ["identical_transfers", validEvidence({
      origins: [{ ...validEvidence().origins[0], tokenReceiptIds: ["receipt-1", "receipt-1"] }],
    })],
    ["batched_actions", validEvidence({
      tokenReceipt: {
        actions: [
          { method: "ft_transfer", depositYocto: "1", gasTgas: 25 },
          { method: "storage_deposit", depositYocto: "1", gasTgas: 25 },
        ],
      },
    })],
    ["wrong_action_index", validEvidence({
      tokenReceipt: {
        actions: [
          { method: "storage_deposit", depositYocto: "1", gasTgas: 25 },
          { method: "ft_transfer", depositYocto: "1", gasTgas: 25 },
        ],
        executionMetadata: {
          version: 4,
          contracts: [
            { kind: "Local", hash: HASH_B },
            { kind: "Local", hash: HASH_A },
          ],
        },
      },
    })],
    ["success_receipt_id", validEvidence({
      tokenReceipt: { outcome: "SuccessReceiptId", childOutcome: "Failure" },
    })],
    ["missing_ancestry", validEvidence({ ancestryComplete: false })],
    ["unsupported_metadata", validEvidence({
      tokenReceipt: { executionMetadata: { version: 4, contracts: [{ kind: "Global" }] } },
    })],
    ["unsupported_metadata", validEvidence({
      tokenReceipt: { executionMetadata: { version: 4, contracts: [{ kind: "None" }] } },
    })],
    ["metadata_length", validEvidence({
      tokenReceipt: {
        executionMetadata: {
          version: 4,
          contracts: [{ kind: "Local", hash: HASH_A }, { kind: "Local", hash: HASH_A }],
        },
      },
    })],
    ["another_core", validEvidence({
      origins: [{ ...validEvidence().origins[0], receiver: "other.core.testnet" }],
    })],
    ["wrong_sender", validEvidence({ tokenReceipt: { predecessor: "other.core.testnet" } })],
    ["wrong_token", validEvidence({ tokenReceipt: { receiver: "other.token.testnet" } })],
    ["wrong_method", validEvidence({
      tokenReceipt: { actions: [{ method: "ft_transfer_call", depositYocto: "1", gasTgas: 25 }] },
    })],
    ["wrong_deposit", validEvidence({
      tokenReceipt: { actions: [{ method: "ft_transfer", depositYocto: "2", gasTgas: 25 }] },
    })],
    ["wrong_gas", validEvidence({
      tokenReceipt: { actions: [{ method: "ft_transfer", depositYocto: "1", gasTgas: 30 }] },
    })],
    ["wrong_recipient", validEvidence({
      tokenReceipt: {
        argsText: JSON.stringify({
          receiver_id: "other.testnet",
          amount: "1500000",
          memo: transferMemo(validEvidence().intent),
        }),
      },
    })],
    ["wrong_amount", validEvidence({
      tokenReceipt: {
        argsText: JSON.stringify({
          receiver_id: "beneficiary.testnet",
          amount: "1500001",
          memo: transferMemo(validEvidence().intent),
        }),
      },
    })],
    ["bad_amount_encoding", validEvidence({
      tokenReceipt: {
        argsText: JSON.stringify({
          receiver_id: "beneficiary.testnet",
          amount: "01500000",
          memo: transferMemo(validEvidence().intent),
        }).replace("01500000", "01500000"),
      },
    })],
    ["wrong_memo", validEvidence({
      tokenReceipt: {
        argsText: JSON.stringify({
          receiver_id: "beneficiary.testnet",
          amount: "1500000",
          memo: "nope",
        }),
      },
    })],
    ["duplicate_json_keys", validEvidence({
      tokenReceipt: {
        argsText: '{"receiver_id":"beneficiary.testnet","amount":"1500000","amount":"1500000","memo":"x"}',
      },
    })],
    ["provider_disagreement", validEvidence({ providersAgree: false })],
    ["missing_replay", validEvidence({ replayAvailable: false })],
    ["wrong_commitment", validEvidence({
      origins: [{ ...validEvidence().origins[0], commitmentId: "99" }],
    })],
    ["not_pending", validEvidence({ pending: false })],
    ["context_mismatch", validEvidence({ observed: { transferId: "8" } })],
    ["nonfinal", validEvidence({ tokenReceipt: { final: false } })],
  ];

  for (const [reason, evidence] of cases) {
    assert.equal(decide(evidence).outcome, "unknown", reason);
    assert.equal(decide(evidence).reason, reason, reason);
  }
});

test("a SuccessReceiptId child failure is never a token-action failure", () => {
  const decision = decide(validEvidence({
    tokenReceipt: { outcome: "SuccessReceiptId", childOutcome: "Failure" },
  }));
  assert.equal(decision.outcome, "unknown");
  assert.notEqual(decision.outcome, "failure");
});

test("the sign-once journal replays one digest and rejects a different outcome", () => {
  const journal = new Map();
  const evidence = validEvidence();
  const first = commitDecision(journal, evidence, "digest-a");
  assert.equal(first.journal, "recorded");
  assert.equal(commitDecision(journal, evidence, "digest-a").journal, "replay");

  const conflicting = commitDecision(journal, validEvidence({
    tokenReceipt: { outcome: "Failure", executionMetadata: null },
  }), "digest-b");
  assert.equal(conflicting.outcome, "failure");
  assert.equal(conflicting.journal, "rejected");
  assert.deepEqual(journal.get(`${INSTANCE}:7`), { outcome: "success", digest: "digest-a" });

  const abstained = commitDecision(journal, validEvidence({ providersAgree: false }), "digest-c");
  assert.equal(abstained.journal, "abstained");
  assert.equal(journal.size, 1);
});
