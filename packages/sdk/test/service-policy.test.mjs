import assert from "node:assert/strict";
import test from "node:test";
import { validateServiceAvailabilityPolicyInput } from "../dist/index.js";

function policy() {
  return {
    schema: "lcp.service_availability.policy.v1",
    target_id: "a".repeat(64),
    max_source_lag_ns: "60000000000",
    expected_status_min: 200,
    expected_status_max: 299,
    max_latency_ms: 500,
    minimum_agreeing_sources: 2,
    minimum_corroboration_bps: 6_000,
    sources: [
      { source_id: "eu-1", operator_id: "operator-eu", public_key_hex: "1".repeat(64) },
      { source_id: "us-1", operator_id: "operator-us", public_key_hex: "2".repeat(64) },
      { source_id: "us-2", operator_id: "operator-us-2", public_key_hex: "3".repeat(64) },
    ],
  };
}

test("service source policy accepts a sorted independent majority roster", () => {
  assert.doesNotThrow(() => validateServiceAvailabilityPolicyInput(policy()));
});

test("service source policy rejects duplicate operators, unsorted sources, and non-majority quorum", () => {
  const duplicateOperator = policy();
  duplicateOperator.sources[2].operator_id = duplicateOperator.sources[1].operator_id;
  assert.throws(() => validateServiceAvailabilityPolicyInput(duplicateOperator), /Each source ID and NEAR operator account must be unique/);

  const unsorted = policy();
  unsorted.sources.reverse();
  assert.throws(() => validateServiceAvailabilityPolicyInput(unsorted), /sorted/);

  const nonMajority = policy();
  nonMajority.minimum_agreeing_sources = 1;
  assert.throws(() => validateServiceAvailabilityPolicyInput(nonMajority), /strict majority/);
});

test("service source policy rejects out-of-range decimal timestamps and extra fields", () => {
  const outOfRange = policy();
  outOfRange.max_source_lag_ns = "18446744073709551616";
  assert.throws(() => validateServiceAvailabilityPolicyInput(outOfRange), /source-age limit/);

  const extra = { ...policy(), reviewer_email: "person@example.test" };
  assert.throws(() => validateServiceAvailabilityPolicyInput(extra), /unsupported or missing fields/);
});

test("transaction-authenticated source policy lists accounts without pinning wallet keys", () => {
  const current = policy();
  current.schema = "lcp.service_availability.policy.v2";
  current.sources = current.sources.map(({ source_id, operator_id }) => ({ source_id, operator_id }));
  assert.doesNotThrow(() => validateServiceAvailabilityPolicyInput(current));

  current.sources[0].public_key_hex = "1".repeat(64);
  assert.throws(() => validateServiceAvailabilityPolicyInput(current), /must not pin wallet keys/);
});
