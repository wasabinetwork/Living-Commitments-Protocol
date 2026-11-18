import { test } from "node:test";
import assert from "node:assert/strict";
import { commitmentFlags } from "./commitment-flags.mjs";

const base = {
  pendingEvaluationId: null,
  activeChallengeId: null,
  settlementAssetKind: "near",
  beneficiaryRegistered: undefined,
};

test("recognizes a pending evaluation", () => {
  const flags = commitmentFlags({ ...base, pendingEvaluationId: "3" });
  assert.equal(flags.pendingEvaluation, true);
  assert.equal(flags.openChallenge, false);
});

test("treats null, undefined, and empty evaluation IDs as idle", () => {
  for (const pendingEvaluationId of [null, undefined, ""]) {
    assert.equal(commitmentFlags({ ...base, pendingEvaluationId }).pendingEvaluation, false);
  }
});

test("recognizes an open challenge even while an evaluation is pending", () => {
  const flags = commitmentFlags({ ...base, pendingEvaluationId: "4", activeChallengeId: "10" });
  assert.equal(flags.pendingEvaluation, true);
  assert.equal(flags.openChallenge, true);
});

test("flags a USDC commitment whose beneficiary is not registered", () => {
  const flags = commitmentFlags({
    ...base,
    settlementAssetKind: "nep141",
    beneficiaryRegistered: false,
  });
  assert.equal(flags.usdcRegistrationShortfall, true);
});

test("keeps the registration note when readiness was not read", () => {
  for (const beneficiaryRegistered of [undefined, null]) {
    const flags = commitmentFlags({
      ...base,
      settlementAssetKind: "nep141",
      beneficiaryRegistered,
    });
    assert.equal(flags.usdcRegistrationShortfall, true);
  }
});

test("does not flag a registered USDC beneficiary or a NEAR commitment", () => {
  assert.equal(
    commitmentFlags({ ...base, settlementAssetKind: "nep141", beneficiaryRegistered: true })
      .usdcRegistrationShortfall,
    false,
  );
  assert.equal(
    commitmentFlags({ ...base, settlementAssetKind: "near", beneficiaryRegistered: false })
      .usdcRegistrationShortfall,
    false,
  );
});
