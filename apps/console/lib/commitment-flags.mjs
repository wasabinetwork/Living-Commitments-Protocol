/**
 * Late-journey states that change what the Console shows.
 *
 * Kept dependency-free so the predicates can be tested without rendering the
 * dashboard component. `beneficiaryRegistered` is deliberately compared with
 * `true`: an unread or failed token-readiness check must keep the registration
 * note visible rather than hide a possible shortfall.
 */
export function commitmentFlags({
  pendingEvaluationId,
  activeChallengeId,
  settlementAssetKind,
  beneficiaryRegistered,
}) {
  return {
    pendingEvaluation: pendingEvaluationId !== null && pendingEvaluationId !== undefined && pendingEvaluationId !== "",
    openChallenge: activeChallengeId !== null && activeChallengeId !== undefined && activeChallengeId !== "",
    usdcRegistrationShortfall: settlementAssetKind === "nep141" && beneficiaryRegistered !== true,
  };
}
