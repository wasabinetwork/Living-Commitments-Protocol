"use client";

import { createRandomNonceHex, validateServiceAvailabilityPolicyInput } from "@lcp/sdk";
import type {
  BoundedPayoutAuthorityGrantView,
  BoundedPayoutAdapterPoolStatusView,
  ClaimEligibilityView,
  CommitmentPolicyView,
  CommitmentView,
  ServiceAvailabilityPolicyInput,
  ServicePolicyAmendmentView,
} from "@lcp/sdk";
import { useEffect, useState } from "react";

const YOCTO_PER_NEAR = 10n ** 24n;
const NS_PER_HOUR = 60n * 60n * 1_000_000_000n;
const BOUNDED_ADAPTER_WASM_SHA256 = "4e29182e075ff2ee94b0b1a67550e8741f5fa38b69d7fe8454dca8908fe17f86";

interface AmendmentProps {
  accountId: string | null;
  commitment: CommitmentView;
  commitmentPolicy: CommitmentPolicyView;
  policy: ServiceAvailabilityPolicyInput;
  amendment: ServicePolicyAmendmentView | null;
  chainTimeNs: string | null;
  contractSupported: boolean;
  onRefresh: () => Promise<boolean>;
  onPropose: (policy: ServiceAvailabilityPolicyInput, effectiveAtNs: string, expiresAtNs: string, nonceHex: string) => Promise<string>;
  onApprove: (amendmentId: string) => Promise<boolean>;
  onActivate: (amendmentId: string) => Promise<void>;
  onExpire: (amendmentId: string) => Promise<void>;
  onCancel: (amendmentId: string) => Promise<void>;
}

export function ServicePolicyAmendmentCard(props: AmendmentProps) {
  const policyJson = JSON.stringify(props.policy, null, 2);
  const [newPolicyJson, setNewPolicyJson] = useState(policyJson);
  const [activationHours, setActivationHours] = useState("24");
  const [expiryHours, setExpiryHours] = useState("72");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const amendment = props.amendment;
  const pending = amendment?.status === "proposed";
  const isApprover = Boolean(props.accountId && amendment?.required_approvers.includes(props.accountId));
  const alreadyApproved = Boolean(props.accountId && amendment?.approved_by.includes(props.accountId));
  const isExpired = Boolean(amendment && props.chainTimeNs && BigInt(props.chainTimeNs) >= BigInt(amendment.expires_at_ns));
  const canActivate = Boolean(pending && props.chainTimeNs && BigInt(props.chainTimeNs) >= BigInt(amendment!.effective_at_ns)
    && amendment!.required_approvers.every((account) => amendment!.approved_by.includes(account)) && !isExpired
    && !props.commitment.pending_evaluation_id && !props.commitment.active_challenge_id
    && props.commitment.lifecycle !== "Closed");
  const isAffectedParty = Boolean(props.accountId && [
    props.commitment.maintainer,
    props.commitment.arbiter,
    props.commitmentPolicy.budget.sponsor,
    props.commitmentPolicy.budget.beneficiary,
  ].includes(props.accountId));

  useEffect(() => setNewPolicyJson(policyJson), [policyJson]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    if (!props.accountId) throw new Error("Connect a commitment party wallet before proposing an amendment.");
    if (!props.chainTimeNs) throw new Error("Refresh finalized NEAR time before proposing an amendment.");
    if (!isAffectedParty) throw new Error("Only the sponsor, maintainer, beneficiary, or arbiter may propose this amendment.");
    const parsedHours = Number(activationHours);
    const parsedExpiryHours = Number(expiryHours);
    if (!Number.isInteger(parsedHours) || parsedHours < 1 || parsedHours > 719
        || !Number.isInteger(parsedExpiryHours) || parsedExpiryHours <= parsedHours || parsedExpiryHours > 720) {
      throw new Error("Choose an activation delay of 1–719 hours and an expiry after activation, up to 720 hours.");
    }
    let newPolicy: unknown;
    try {
      newPolicy = JSON.parse(newPolicyJson) as unknown;
    } catch {
      throw new Error("The amended source policy must be valid JSON.");
    }
    validateServiceAvailabilityPolicyInput(newPolicy);
    if (BigInt(newPolicy.max_source_lag_ns) > BigInt(props.commitmentPolicy.temporal.max_source_lag_ns)
        || BigInt(newPolicy.max_source_lag_ns) > BigInt(props.commitmentPolicy.temporal.evidence_ttl_ns)) {
      throw new Error("The amended report-age limit cannot exceed this commitment’s temporal source-lag or evidence-freshness bound.");
    }
    const now = BigInt(props.chainTimeNs);
    const effectiveAt = now + BigInt(parsedHours) * NS_PER_HOUR;
    const expiresAt = now + BigInt(parsedExpiryHours) * NS_PER_HOUR;
    await props.onPropose(newPolicy, effectiveAt.toString(), expiresAt.toString(), createRandomNonceHex());
  }

  return (
    <section className="content-card governance-card" aria-labelledby="amendment-title">
      <div className="card-heading">
        <div><p className="eyebrow">CONSENT-BASED GOVERNANCE</p><h3 id="amendment-title">Policy amendments</h3></div>
        <span className="card-index">05</span>
      </div>
      <p className="governance-intro">A v3 source-policy amendment needs separate wallet approval from the sponsor, maintainer, beneficiary, and arbiter. The current policy stays active until the approved future boundary; activation starts a fresh evidence clock and requires new compliant evidence before claims resume.</p>
      {!props.contractSupported && <p className="reviewer-notice reviewer-notice-error">The selected contract does not expose amendment methods yet. Deploy the updated LCP contract before using this control.</p>}
      {amendment && (
        <div className="governance-state">
          <div className="reviewer-section-title"><strong>Latest amendment · {amendment.status}</strong><code>{amendment.amendment_id}</code></div>
          <div className="digest-row"><span>OLD POLICY DIGEST</span><code>{amendment.old_policy_hash}</code></div>
          <div className="digest-row"><span>PROPOSED DIGEST</span><code>{amendment.new_policy_hash}</code></div>
          <div className="digest-row"><span>ACTIVATION BOUNDARY</span><code>{formatNs(amendment.effective_at_ns)}</code></div>
          {amendment.activated_at_ns && <div className="digest-row"><span>ACTIVATED AT</span><code>{formatNs(amendment.activated_at_ns)}</code></div>}
          <div className="digest-row"><span>APPROVALS</span><code>{amendment.approved_by.length} / {amendment.required_approvers.length} · {amendment.approved_by.join(", ") || "none yet"}</code></div>
          {pending && (
            <div className="reviewer-inline-actions governance-actions">
              {isApprover && !alreadyApproved && <button type="button" className="browser-button" disabled={busy || !props.contractSupported} onClick={() => void run(async () => { await props.onApprove(amendment.amendment_id); await props.onRefresh(); }, "Approval recorded on NEAR.")}>Approve with wallet</button>}
              {canActivate && <button type="button" className="browser-button" disabled={busy || !props.contractSupported} onClick={() => void run(async () => { await props.onActivate(amendment.amendment_id); await props.onRefresh(); }, "The amended source policy is active.")}>Activate amendment</button>}
              {isExpired && <button type="button" className="browser-text-button" disabled={busy || !props.contractSupported} onClick={() => void run(async () => { await props.onExpire(amendment.amendment_id); await props.onRefresh(); }, "Expired proposal recorded; the active policy was unchanged.")}>Record expiry</button>}
              {props.accountId === amendment.proposed_by && <button type="button" className="browser-text-button" disabled={busy || !props.contractSupported} onClick={() => void run(async () => { await props.onCancel(amendment.amendment_id); await props.onRefresh(); }, "Amendment proposal cancelled; the active policy is unchanged.")}>Cancel proposal</button>}
              {!isApprover && <small>Connect one of the listed affected accounts to approve.</small>}
            </div>
          )}
        </div>
      )}
      <div className="governance-proposal-form">
        <label>New source policy JSON<textarea spellCheck={false} value={newPolicyJson} onChange={(event) => setNewPolicyJson(event.target.value)} rows={8} /></label>
        <div className="governance-timing-grid">
          <label>Activation delay · hours<input type="number" min="1" max="719" value={activationHours} onChange={(event) => setActivationHours(event.target.value)} /></label>
          <label>Proposal expiry · hours from now<input type="number" min="2" max="720" value={expiryHours} onChange={(event) => setExpiryHours(event.target.value)} /></label>
        </div>
        <button type="button" className="browser-button" disabled={busy || !props.contractSupported || !props.accountId || !isAffectedParty || !props.chainTimeNs || pending || props.commitment.lifecycle === "Closed" || Boolean(props.commitment.pending_evaluation_id || props.commitment.active_challenge_id)} onClick={() => void run(async () => { await propose(); await props.onRefresh(); }, "Amendment proposal recorded on NEAR. All affected parties must approve before activation.")}>Propose future amendment</button>
        <small>Storage bond · 0.05 NEAR attached; the contract refunds any excess. A proposal expires without effect if required approvals are missing.</small>
      </div>
      {error && <p className="reviewer-notice reviewer-notice-error" role="alert">{error}</p>}
      {message && <p className="reviewer-notice reviewer-notice-success" role="status">{message}</p>}
    </section>
  );
}

interface AuthorityProps {
  accountId: string | null;
  commitment: CommitmentView;
  contractId: string;
  testnet: boolean;
  policy: CommitmentPolicyView;
  latestGrant: BoundedPayoutAuthorityGrantView | null;
  eligibility: ClaimEligibilityView | null;
  contractSupported: boolean;
  chainTimeNs: string | null;
  onRefresh: () => Promise<boolean>;
  onLoadGrant: (grantId: string) => Promise<BoundedPayoutAuthorityGrantView | null>;
  onLoadAdapterStatus: (adapterAccount: string) => Promise<BoundedPayoutAdapterPoolStatusView | null>;
  onDeployAdapter: (adapterAccount: string, resourceAccount: string, poolManagerAccount: string, code: Uint8Array) => Promise<void>;
  onFundAdapterPool: (adapterAccount: string, amountNear: string) => Promise<void>;
  onWithdrawAdapterPool: (adapterAccount: string, recipient: string, amountNear: string) => Promise<void>;
  onCreateGrant: (grantId: string, adapter: string, resource: string, perAction: string, cumulative: string, expiresAtNs: string) => Promise<string>;
  onRevokeGrant: (grantId: string) => Promise<void>;
  onExecuteGrant: (grantId: string, nonce: string, amount: string) => Promise<void>;
}

export function AuthorityAdapterCard(props: AuthorityProps) {
  const [adapterAccount, setAdapterAccount] = useState("");
  const [resourceAccount, setResourceAccount] = useState(props.policy.budget.beneficiary);
  const [poolManagerAccount, setPoolManagerAccount] = useState(props.policy.budget.sponsor);
  const [adapterWasmFile, setAdapterWasmFile] = useState<File | null>(null);
  const [adapterWasmSha256, setAdapterWasmSha256] = useState("");
  const [perAction, setPerAction] = useState(() => yoctoToNearInput(props.policy.budget.tranche_yocto));
  const [cumulative, setCumulative] = useState(() => yoctoToNearInput((BigInt(props.policy.budget.tranche_yocto) * BigInt(props.policy.budget.max_epochs)).toString()));
  const [expiryMinutes, setExpiryMinutes] = useState("60");
  const [grantIdInput, setGrantIdInput] = useState(props.latestGrant?.grant_id ?? "");
  const [grant, setGrant] = useState<BoundedPayoutAuthorityGrantView | null>(props.latestGrant);
  const [adapterStatus, setAdapterStatus] = useState<BoundedPayoutAdapterPoolStatusView | null>(null);
  const [adapterStatusAccount, setAdapterStatusAccount] = useState<string | null>(null);
  const [adapterStatusError, setAdapterStatusError] = useState("");
  const [loadingAdapterStatus, setLoadingAdapterStatus] = useState(false);
  const [poolFundingAmount, setPoolFundingAmount] = useState("0.05");
  const [actionAmount, setActionAmount] = useState(() => yoctoToNearInput(props.policy.budget.tranche_yocto));
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canGrant = Boolean(props.accountId && [props.policy.budget.sponsor, props.policy.budget.beneficiary].includes(props.accountId));
  const canTrigger = Boolean(props.accountId && grant && [grant.granting_account, grant.adapter_account].includes(props.accountId));
  const maxExpiryMinutes = maxAuthorityGrantMinutes(props.commitment, props.policy, props.chainTimeNs);
  const grantActive = Boolean(grant && props.chainTimeNs && !grant.revoked
    && BigInt(props.chainTimeNs) < BigInt(grant.expires_at_ns));
  const canExecute = Boolean(canTrigger && props.contractSupported && props.eligibility?.eligible
    && props.commitment.lifecycle === "Active" && grantActive
    && props.commitment.effective_health === "Healthy");

  useEffect(() => {
    setGrant(props.latestGrant);
    setGrantIdInput(props.latestGrant?.grant_id ?? "");
  }, [props.latestGrant]);

  useEffect(() => {
    const selectedMinutes = Number(expiryMinutes);
    if (maxExpiryMinutes > 0 && Number.isSafeInteger(selectedMinutes) && selectedMinutes > maxExpiryMinutes) {
      setExpiryMinutes(String(maxExpiryMinutes));
    }
  }, [expiryMinutes, maxExpiryMinutes]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createGrant() {
    if (!props.accountId || !canGrant) throw new Error("Connect the configured sponsor or beneficiary wallet to grant authority.");
    if (!props.chainTimeNs) throw new Error("Refresh finalized NEAR time before creating a grant.");
    if (!validAccount(adapterAccount) || !validAccount(resourceAccount)) throw new Error("Enter valid NEAR adapter and resource account IDs.");
    const perActionYocto = parseNearAmount(perAction);
    const cumulativeYocto = parseNearAmount(cumulative);
    const trancheYocto = BigInt(props.policy.budget.tranche_yocto);
    const programLimitYocto = trancheYocto * BigInt(props.policy.budget.max_epochs);
    if (perActionYocto <= 0n || perActionYocto > trancheYocto) {
      throw new Error("The per-action amount must be positive and no greater than one configured tranche.");
    }
    if (cumulativeYocto <= 0n || cumulativeYocto > programLimitYocto || cumulativeYocto < perActionYocto) {
      throw new Error("The cumulative limit must cover one action and stay within the commitment’s total budget.");
    }
    const minutes = Number(expiryMinutes);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > maxExpiryMinutes) {
      throw new Error("Choose a whole-minute grant lifetime that fits the remaining commitment budget horizon.");
    }
    const id = createRandomNonceHex();
    const expiresAt = (BigInt(props.chainTimeNs) + BigInt(minutes) * 60n * 1_000_000_000n).toString();
    const createdId = await props.onCreateGrant(id, adapterAccount, resourceAccount, perAction, cumulative, expiresAt);
    setGrantIdInput(createdId);
    await loadGrant(createdId);
    await props.onRefresh();
  }

  async function deployAdapter() {
    if (!props.testnet) throw new Error("The adapter deployment helper is restricted to NEAR testnet.");
    if (!props.accountId || props.accountId !== adapterAccount) {
      throw new Error("Connect the adapter contract account wallet before deployment.");
    }
    if (!validAccount(resourceAccount) || !validAccount(poolManagerAccount)) {
      throw new Error("Enter valid fixed-recipient and pool-manager NEAR account IDs.");
    }
    if (!adapterWasmFile || adapterWasmSha256 !== BOUNDED_ADAPTER_WASM_SHA256) {
      throw new Error("Select the bounded adapter WASM built from this repository and verify its SHA-256 digest.");
    }
    await props.onDeployAdapter(
      adapterAccount,
      resourceAccount,
      poolManagerAccount,
      new Uint8Array(await adapterWasmFile.arrayBuffer()),
    );
    await refreshAdapterStatus(adapterAccount, resourceAccount);
  }

  async function selectAdapterWasm(file: File | null) {
    setAdapterWasmFile(file);
    setAdapterWasmSha256("");
    if (!file) return;
    if (file.size > 1024 * 1024 || !file.name.toLowerCase().endsWith(".wasm")) {
      setAdapterWasmFile(null);
      throw new Error("Select a WASM file no larger than 1 MiB.");
    }
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    setAdapterWasmSha256(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  }

  async function loadGrant(grantId: string) {
    const loaded = await props.onLoadGrant(grantId.trim());
    if (!loaded) throw new Error("No authority grant was found for that ID and commitment.");
    setGrant(loaded);
    setGrantIdInput(loaded.grant_id);
    await refreshAdapterStatus(loaded.adapter_account, loaded.resource_account);
  }

  async function refreshAdapterStatus(adapterAccount: string, expectedResource?: string) {
    setLoadingAdapterStatus(true);
    setAdapterStatusError("");
    try {
      const loaded = await props.onLoadAdapterStatus(adapterAccount);
      if (!loaded) throw new Error("The adapter does not expose a pool status view.");
      if (loaded.lcp_contract_id !== props.contractId) throw new Error("The adapter is configured for a different LCP contract.");
      if (expectedResource && loaded.resource_account !== expectedResource) throw new Error("The adapter recipient does not match this authority grant.");
      setAdapterStatus(loaded);
      setAdapterStatusAccount(adapterAccount);
    } catch (cause) {
      setAdapterStatus(null);
      setAdapterStatusAccount(adapterAccount);
      setAdapterStatusError(errorText(cause));
    } finally {
      setLoadingAdapterStatus(false);
    }
  }

  async function executeGrant() {
    if (!grant || !canTrigger) throw new Error("Connect the grantor or the named adapter wallet to trigger this grant.");
    const nextNonce = (BigInt(grant.last_action_nonce) + 1n).toString();
    await props.onExecuteGrant(grant.grant_id, nextNonce, actionAmount);
    await props.onRefresh();
    await loadGrant(grant.grant_id);
  }

  async function withdrawAdapterPool() {
    if (!adapterStatus || adapterStatusAccount !== adapterAccount) throw new Error("Refresh the adapter pool before requesting a withdrawal.");
    if (!props.accountId || props.accountId !== adapterStatus.pool_manager) throw new Error("Connect the adapter pool manager wallet to withdraw its available balance.");
    const amount = parseNearAmount(withdrawalAmount);
    if (amount <= 0n || amount > BigInt(adapterStatus.available_yocto)) throw new Error("Enter a positive amount no greater than the adapter's available pool balance.");
    await props.onWithdrawAdapterPool(adapterAccount, props.accountId, withdrawalAmount);
    await refreshAdapterStatus(adapterAccount, resourceAccount);
  }

  async function fundAdapterPool() {
    const amount = parseNearAmount(poolFundingAmount);
    if (amount <= 0n) throw new Error("Enter a positive amount to add to the adapter pool.");
    await props.onFundAdapterPool(adapterAccount, poolFundingAmount);
    await refreshAdapterStatus(adapterAccount, resourceAccount);
  }

  return (
    <section className="content-card governance-card" aria-labelledby="authority-adapter-title">
      <div className="card-heading">
        <div><p className="eyebrow">CONTRACT-GATED CONSEQUENCE</p><h3 id="authority-adapter-title">Bounded payout adapter</h3></div>
        <span className="card-index">06</span>
      </div>
      <p className="governance-intro">The sponsor or beneficiary can authorize one named adapter to pay one fixed NEAR resource from funds deposited into that adapter. An action is available only when the same full tranche eligibility checks pass, including the challenge window.</p>
      <p className="governance-caution">The grant controls only the adapter’s own prefunded pool. It never controls a wallet, account keys, or LCP escrow. Authorized amounts count against the grant when LCP calls the adapter, even if that adapter call fails.</p>
      <p className="governance-caution">Review the adapter code and its upgrade authority before granting access. The grant binds an account ID; it does not pin that account’s code hash.</p>
      {!props.contractSupported && <p className="reviewer-notice reviewer-notice-error">The selected contract does not expose bounded authority methods yet. Deploy the updated LCP contract before using this control.</p>}
      <div className="governance-proposal-form">
        <div className="governance-timing-grid">
          <label>Adapter contract account<input value={adapterAccount} onChange={(event) => setAdapterAccount(event.target.value.trim())} placeholder="bounded-adapter.testnet" /></label>
          <label>Fixed recipient account<input value={resourceAccount} onChange={(event) => setResourceAccount(event.target.value.trim())} /></label>
          <label>Per-action limit · NEAR<input inputMode="decimal" value={perAction} onChange={(event) => setPerAction(event.target.value)} /></label>
          <label>Cumulative limit · NEAR<input inputMode="decimal" value={cumulative} onChange={(event) => setCumulative(event.target.value)} /></label>
          <label>Grant lifetime · minutes<input type="number" min="1" max={maxExpiryMinutes || undefined} value={expiryMinutes} onChange={(event) => setExpiryMinutes(event.target.value)} /></label>
        </div>
        {props.testnet && (
          <details className="guided-advanced adapter-deployment-panel">
            <summary>Deploy the testnet adapter with your NEAR wallet</summary>
            <p>This one-time action deploys and initializes the checked adapter WASM on the adapter account. It will refuse accounts that already have code. The account’s full-access key can still replace the code, so use this testnet fixture only and secure its upgrade key before any production use.</p>
            <div className="governance-timing-grid">
              <label>Adapter pool manager<input value={poolManagerAccount} onChange={(event) => setPoolManagerAccount(event.target.value.trim())} /></label>
              <label>Adapter contract WASM<input type="file" accept=".wasm,application/wasm" onChange={(event) => void selectAdapterWasm(event.target.files?.[0] ?? null).catch((cause) => setError(errorText(cause)))} /></label>
            </div>
            <div className="digest-row"><span>EXPECTED WASM SHA-256</span><code>{BOUNDED_ADAPTER_WASM_SHA256}</code></div>
            {adapterWasmFile && <div className="digest-row"><span>SELECTED FILE</span><code>{adapterWasmFile.name} · SHA-256 {adapterWasmSha256 || "checking…"}</code></div>}
            <button type="button" className="browser-button" disabled={busy || !props.contractSupported || !props.accountId || props.accountId !== adapterAccount || !adapterWasmFile || adapterWasmSha256 !== BOUNDED_ADAPTER_WASM_SHA256} onClick={() => void run(deployAdapter, "Adapter deployment and initialization were submitted to NEAR.")}>Deploy and initialize adapter</button>
            <small>The connected wallet must be the adapter account. This action sends a standard NEAR `DeployContract` action followed by the adapter’s `new` call.</small>
          </details>
        )}
        <div className="governance-state">
          <div className="reviewer-section-title"><strong>Adapter pool</strong><button type="button" className="browser-text-button" disabled={busy || loadingAdapterStatus || !validAccount(adapterAccount)} onClick={() => void refreshAdapterStatus(adapterAccount, resourceAccount)}>{loadingAdapterStatus ? "Refreshing…" : "Refresh status"}</button></div>
          {adapterStatus && adapterStatusAccount === adapterAccount
            ? <div className="digest-row"><span>AVAILABLE / PENDING</span><code>{formatNear(adapterStatus.available_yocto)} / {formatNear(adapterStatus.pending_yocto)} NEAR{adapterStatus.pending_kind ? ` · ${adapterStatus.pending_kind.replaceAll("_", " ")} ${adapterStatus.pending_action_nonce ?? ""} settling` : ""}</code></div>
            : <p className="empty-copy">Load pool status after deploying or entering an adapter account.</p>}
          {adapterStatusError && <p className="reviewer-notice reviewer-notice-error" role="alert">{adapterStatusError}</p>}
          <div className="reviewer-inline-actions governance-actions">
            <label className="governance-amount">Fund adapter pool · NEAR<input inputMode="decimal" value={poolFundingAmount} onChange={(event) => setPoolFundingAmount(event.target.value)} /></label>
            <button type="button" className="browser-button" disabled={busy || !props.accountId || !adapterStatus || adapterStatusAccount !== adapterAccount} onClick={() => void run(fundAdapterPool, "Adapter pool funding submitted to NEAR.")}>Fund pool</button>
          </div>
          {adapterStatus && adapterStatusAccount === adapterAccount && props.accountId === adapterStatus.pool_manager && (
            <div className="reviewer-inline-actions governance-actions">
              <label className="governance-amount">Withdraw available pool · NEAR<input inputMode="decimal" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} /></label>
              <button type="button" className="browser-text-button" disabled={busy || BigInt(adapterStatus.available_yocto) === 0n || BigInt(adapterStatus.pending_yocto) > 0n} onClick={() => void run(withdrawAdapterPool, "Adapter pool withdrawal submitted to the connected manager wallet.")}>Withdraw to manager wallet</button>
            </div>
          )}
          <small>Anyone may fund the pool. Only the configured manager can withdraw its available balance; both transfers settle asynchronously.</small>
        </div>
        <button type="button" className="browser-button" disabled={busy || !props.contractSupported || !canGrant || !props.chainTimeNs || maxExpiryMinutes < 1 || props.commitment.lifecycle !== "Active"} onClick={() => void run(createGrant, "Bounded payout authority recorded on NEAR.")}>Create wallet-signed grant</button>
        <small>Grant storage bond · 0.05 NEAR attached; the contract refunds excess. Deploy and fund the adapter separately before execution.</small>
      </div>
      <div className="governance-state">
        <div className="reviewer-section-title"><strong>Inspect or operate a grant</strong><div className="reviewer-inline-actions"><input className="authority-grant-id-input" value={grantIdInput} onChange={(event) => setGrantIdInput(event.target.value.trim())} placeholder="Grant ID · 64 lowercase hex" /><button type="button" className="browser-text-button" disabled={busy || !props.contractSupported || !grantIdInput} onClick={() => void run(() => loadGrant(grantIdInput), "Authority grant state loaded from NEAR.")}>Load</button></div></div>
        {grant && (
          <>
            <div className="digest-row"><span>GRANT STATUS</span><code>{grant.revoked ? "revoked" : props.chainTimeNs && BigInt(props.chainTimeNs) >= BigInt(grant.expires_at_ns) ? "expired" : "active"}</code></div>
            <div className="digest-row"><span>ADAPTER / RESOURCE</span><code>{grant.adapter_account} → {grant.resource_account}</code></div>
            <div className="digest-row"><span>AUTHORIZED / CAP</span><code>{formatNear(grant.authorized_yocto)} / {formatNear(grant.cumulative_limit_yocto)} NEAR</code></div>
            <div className="digest-row"><span>PER ACTION / EXPIRES</span><code>{formatNear(grant.per_action_limit_yocto)} NEAR · {formatNs(grant.expires_at_ns)}</code></div>
            <div className="reviewer-inline-actions governance-actions">
              <label className="governance-amount">Action amount · NEAR<input inputMode="decimal" value={actionAmount} onChange={(event) => setActionAmount(event.target.value)} /></label>
              <button type="button" className="browser-button" disabled={busy || !canExecute} onClick={() => void run(executeGrant, "LCP authorized the bounded action; adapter settlement is asynchronous.")}>Authorize eligible epoch action</button>
              {props.accountId === grant.granting_account && !grant.revoked && <button type="button" className="browser-text-button" disabled={busy || !props.contractSupported} onClick={() => void run(async () => { await props.onRevokeGrant(grant.grant_id); await props.onRefresh(); await loadGrant(grant.grant_id); }, "Authority grant revoked on NEAR.")}>Revoke grant</button>}
            </div>
            <small>Actions require the same eligibility as a tranche claim, including a closed challenge window. {props.eligibility?.eligible ? "The current tranche is eligible." : props.eligibility?.reason ?? "Refresh finalized commitment state to determine eligibility."} The adapter transfers only to its initialized recipient and can fail if its pool is empty.</small>
            <small>Only the configured adapter pool manager can recover unspent pool funds. Withdrawals are asynchronous and failed transfers return to the available pool.</small>
          </>
        )}
      </div>
      {error && <p className="reviewer-notice reviewer-notice-error" role="alert">{error}</p>}
      {message && <p className="reviewer-notice reviewer-notice-success" role="status">{message}</p>}
    </section>
  );
}

function validAccount(value: string): boolean {
  return /^[a-z0-9._-]{2,64}$/.test(value);
}

function maxAuthorityGrantMinutes(
  commitment: CommitmentView,
  policy: CommitmentPolicyView,
  chainTimeNs: string | null,
): number {
  if (!commitment.activated_at_ns || !chainTimeNs) return 0;
  try {
    const endNs = BigInt(commitment.activated_at_ns)
      + BigInt(policy.budget.epoch_ns) * BigInt(policy.budget.max_epochs);
    const remainingNs = endNs - BigInt(chainTimeNs);
    const minuteNs = 60n * 1_000_000_000n;
    if (remainingNs < minuteNs) return 0;
    return Number(remainingNs / minuteNs);
  } catch {
    return 0;
  }
}

function yoctoToNearInput(value: string): string {
  const amount = BigInt(value);
  const whole = amount / YOCTO_PER_NEAR;
  const fraction = (amount % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, 6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatNear(value: string): string {
  return yoctoToNearInput(value);
}

function formatNs(value: string): string {
  try { return `${new Date(Number(BigInt(value) / 1_000_000n)).toISOString().replace("T", " ").slice(0, 19)} UTC`; } catch { return "unknown"; }
}

function parseNearAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/.test(value.trim())) return 0n;
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole) * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0") || "0");
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "This governance action could not complete.";
}
