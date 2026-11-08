"use client";

import {
  LcpClient,
  NearJsonRpcTransport,
} from "@lcp/sdk";
import type {
  ChallengeView,
  ClaimEligibilityView,
  CommitmentPolicyView,
  CommitmentView,
  EvaluationRecordView,
  EscrowStatusView,
  NearTransactionRequest,
  NearTransactionSender,
  TrancheView,
} from "@lcp/sdk";
import { useRef, useState } from "react";

interface WalletAction {
  type: "FunctionCall";
  params: {
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  };
}

interface NearWalletPort {
  signAndSendTransaction(input: {
    receiverId: string;
    actions: WalletAction[];
  }): Promise<unknown>;
}

interface ConnectorAccountEvent {
  accounts: Array<{ accountId: string }>;
}

interface NearConnectorPort {
  on(event: "wallet:signIn", handler: (event: ConnectorAccountEvent) => void): unknown;
  on(event: "wallet:signOut", handler: () => void): unknown;
  connect(): Promise<unknown>;
  wallet(): Promise<NearWalletPort>;
}

interface CommitmentData {
  commitment: CommitmentView;
  policy: CommitmentPolicyView | null;
  evaluation: EvaluationRecordView | null;
  challenge: ChallengeView | null;
  eligibility: ClaimEligibilityView | null;
  escrow: EscrowStatusView | null;
  epoch: string | null;
  tranche: TrancheView | null;
}

const CONTRACT_ID = process.env.NEXT_PUBLIC_LCP_CONTRACT_ID?.trim() ?? "";
const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL?.trim() || "https://test.rpc.fastnear.com";
const DEFAULT_STORAGE_DEPOSIT = "0.01";

export function Dashboard() {
  const connectorRef = useRef<NearConnectorPort | null>(null);
  const [commitmentId, setCommitmentId] = useState("");
  const [data, setData] = useState<CommitmentData | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [depositNear, setDepositNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function loadCommitment(id = commitmentId) {
    const normalizedId = id.trim();
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/demo/.env.local to connect this demo to a deployed contract.");
      return;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(normalizedId)) {
      setError("Enter a commitment ID as a whole number, such as 1.");
      return;
    }

    setCommitmentId(normalizedId);
    setLoading(true);
    setData(null);
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
      const [commitment, policy, evaluation, eligibility, escrow, epoch] = await Promise.all([
        client.getCommitment(normalizedId),
        client.getPolicy(normalizedId),
        client.getLatestEvaluation(normalizedId),
        client.canClaimTranche(normalizedId),
        client.getEscrowStatus(normalizedId),
        client.getCurrentEpoch(normalizedId),
      ]);

      if (!commitment) {
        setData(null);
        setError(`Commitment ${normalizedId} was not found on ${CONTRACT_ID}.`);
        return;
      }

      const [challenge, tranche] = await Promise.all([
        commitment.active_challenge_id
          ? client.getChallenge(commitment.active_challenge_id)
          : Promise.resolve(null),
        epoch ? client.getTranche(normalizedId, epoch) : Promise.resolve(null),
      ]);
      setData({ commitment, policy, evaluation, challenge, eligibility, escrow, epoch, tranche });
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "The commitment could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function connectWallet() {
    setConnecting(true);
    setError(null);
    try {
      let connector = connectorRef.current;
      if (!connector) {
        const { NearConnector } = await import("@hot-labs/near-connect");
        connector = new NearConnector({ features: { testnet: true } }) as unknown as NearConnectorPort;
        connector.on("wallet:signIn", (event) => setAccountId(event.accounts[0]?.accountId ?? null));
        connector.on("wallet:signOut", () => setAccountId(null));
        connectorRef.current = connector;
      }
      await connector.connect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection was not completed.");
    } finally {
      setConnecting(false);
    }
  }

  async function claimTranche() {
    if (!data) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the beneficiary wallet before submitting a claim.");
      return;
    }
    if (accountId !== data.commitment.policy.budget.beneficiary) {
      setError(`Only ${data.commitment.policy.budget.beneficiary} can claim this tranche.`);
      return;
    }

    let attachedDeposit: string;
    try {
      attachedDeposit = parseNearToYocto(depositNear);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid storage deposit.");
      return;
    }

    setClaiming(true);
    setError(null);
    setActionMessage(null);
    try {
      const transport = new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      });
      await new LcpClient(CONTRACT_ID, transport).claimTranche(data.commitment.id, {
        attachedDepositYocto: attachedDeposit,
        gas: "150000000000000",
      });
      await loadCommitment(data.commitment.id);
      setActionMessage("Claim transaction submitted. The contract will update the tranche after transfer reconciliation.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The claim transaction failed.");
    } finally {
      setClaiming(false);
    }
  }

  const health = data?.commitment.effective_health;
  const claimAllowed = data?.eligibility?.eligible === true;
  const correctBeneficiary = Boolean(accountId && data && accountId === data.commitment.policy.budget.beneficiary);
  const canSubmitClaim = Boolean(data && claimAllowed && correctBeneficiary && !claiming);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Living Commitments Protocol home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-name">living commitments<span>protocol</span></span>
        </a>
        <div className="topbar-right">
          <span className="network-chip"><span className="network-dot" />NEAR TESTNET</span>
          <button className={`wallet-button ${accountId ? "wallet-button-connected" : ""}`} onClick={connectWallet} disabled={connecting || Boolean(accountId)}>
            <span className="wallet-icon" aria-hidden="true">◈</span>
            {connecting ? "Connecting…" : accountId ? shortenAccount(accountId) : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="intro" id="top">
        <div className="intro-copy">
          <p className="eyebrow"><span className="eyebrow-line" />ONGOING PROMISES, MADE VERIFIABLE</p>
          <h1>Trust that keeps<br /><em>showing up.</em></h1>
          <p className="intro-description">
            Commitments stay alive through fresh evidence. On NEAR, that evidence can unlock support while the promise is being kept.
          </p>
          <div className="intro-proof"><span className="proof-icon">↗</span><span>Health and eligibility are read from the contract.</span></div>
        </div>
        <div className="intro-art" aria-hidden="true">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-core"><span className="art-leaf">↗</span></div>
          <span className="art-label label-top">EVIDENCE</span>
          <span className="art-label label-right">TIME</span>
          <span className="art-label label-bottom">CONSEQUENCE</span>
          <span className="art-label label-left">TRUST</span>
        </div>
      </section>

      <section className="explorer-section" aria-labelledby="explorer-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE COMMITMENT EXPLORER <span className="heading-index">01 / 03</span></p>
            <h2 id="explorer-title">A promise, in the open.</h2>
          </div>
          <span className="read-source"><span className="live-pulse" />LIVE CONTRACT READ</span>
        </div>

        <form className="lookup-bar" onSubmit={(event) => { event.preventDefault(); void loadCommitment(); }}>
          <label className="lookup-label" htmlFor="commitment-id">COMMITMENT ID</label>
          <div className="lookup-field">
            <span className="lookup-prefix">LCP /</span>
            <input
              id="commitment-id"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter an on-chain ID"
              value={commitmentId}
              onChange={(event) => setCommitmentId(event.target.value)}
              aria-describedby="contract-hint"
            />
            <button className="lookup-button" type="submit" disabled={loading || !CONTRACT_ID}>
              {loading ? <><span className="spinner" />Reading</> : <>Inspect commitment <span aria-hidden="true">↗</span></>}
            </button>
          </div>
          <p id="contract-hint" className="lookup-hint">
            {CONTRACT_ID ? <>Reading <code>{CONTRACT_ID}</code> via NEAR Testnet RPC.</> : <>Configure <code>NEXT_PUBLIC_LCP_CONTRACT_ID</code> to begin.</>}
          </p>
        </form>

        {error && <div className="notice notice-error" role="alert"><span className="notice-icon">!</span>{error}</div>}
        {actionMessage && <div className="notice notice-success" role="status"><span className="notice-icon">✓</span>{actionMessage}</div>}

        {data ? (
          <div className="record-view">
            <section className={`health-panel health-${health?.toLowerCase() ?? "unknown"}`}>
              <div className="health-panel-top">
                <div>
                  <p className="eyebrow">EFFECTIVE HEALTH <span className="chain-source">NEAR · {data.commitment.lifecycle.toUpperCase()}</span></p>
                  <div className="health-title-row"><span className="health-indicator" /><h3>{healthLabel(health)}</h3></div>
                  <p className="health-copy">{healthDescription(health, data.eligibility)}</p>
                </div>
                <span className="commitment-number">#{data.commitment.id}</span>
              </div>
              <div className="health-divider" />
              <div className="health-facts">
                <Fact label="SUBJECT" value={data.commitment.subject} />
                <Fact label="MAINTAINER" value={data.commitment.maintainer} mono />
                <Fact label="BENEFICIARY" value={data.commitment.policy.budget.beneficiary} mono />
                <Fact label="POLICY VERSION" value={`v${data.commitment.policy_version}`} mono />
              </div>
            </section>

            <div className="metrics-grid">
              <MetricCard
                eyebrow="LAST COMPLIANT EVIDENCE"
                title={data.commitment.last_good_observed_at_ns ? formatDate(data.commitment.last_good_observed_at_ns) : "No accepted evidence"}
                detail={data.evaluation ? `Evaluation #${data.evaluation.evaluation_id} · ${data.evaluation.status}` : "Awaiting a completed evaluation"}
                icon="◷"
              />
              <MetricCard
                eyebrow="NEXT TRANCHE"
                title={data.eligibility?.eligible ? `${formatNear(data.eligibility.amount_yocto)} NEAR` : "Not eligible"}
                detail={data.eligibility?.reason ?? (data.epoch ? `Current epoch ${data.epoch}` : "No active budget epoch")}
                icon="↗"
              />
              <MetricCard
                eyebrow="AVAILABLE ESCROW"
                title={`${formatNear(data.escrow?.free_yocto ?? "0")} NEAR`}
                detail={`${formatNear(data.escrow?.paid_yocto ?? "0")} NEAR released so far`}
                icon="◈"
              />
            </div>

            <div className="details-grid">
              <section className="content-card policy-card">
                <div className="card-heading">
                  <div><p className="eyebrow">THE RULES THAT HOLD</p><h3>Policy &amp; evaluator</h3></div>
                  <span className="card-index">01</span>
                </div>
                {data.policy ? (
                  <>
                    <div className="policy-lines">
                      <Fact label="FRESHNESS WINDOW" value={formatDuration(data.policy.temporal.evidence_ttl_ns)} />
                      <Fact label="GRACE PERIOD" value={formatDuration(data.policy.temporal.grace_ns)} />
                      <Fact label="RECOVERY" value={data.policy.temporal.recovery_allowed ? "Allowed by policy" : "Breach remains latched"} />
                      <Fact label="EVALUATOR" value={data.policy.evaluator.outlayer_account} mono />
                      <Fact label="MAINTAINER KEY" value={data.policy.evidence.maintainer_public_key_hex} mono />
                    </div>
                    <div className="digest-row"><span>POLICY DIGEST</span><code>{data.commitment.policy_hash}</code></div>
                    <div className="digest-row"><span>WASM SHA-256</span><code>{data.policy.evaluator.wasm_sha256_hex}</code></div>
                  </>
                ) : <p className="empty-copy">Policy details are unavailable for this commitment.</p>}
              </section>

              <section className="content-card evaluation-card">
                <div className="card-heading">
                  <div><p className="eyebrow">EVIDENCE, CHECKED</p><h3>Latest evaluation</h3></div>
                  <span className="card-index">02</span>
                </div>
                {data.evaluation ? (
                  <>
                    <div className="evaluation-topline">
                      <span className={`status-pill status-${data.evaluation.status.toLowerCase()}`}>{data.evaluation.status}</span>
                      <span className="evaluation-id">EVALUATION #{data.evaluation.evaluation_id}</span>
                    </div>
                    <div className="evaluation-verdict">
                      <span className="verdict-label">VERDICT</span>
                      <strong>{data.evaluation.verdict ?? "Pending"}</strong>
                    </div>
                    <div className="digest-row"><span>OBSERVED</span><code>{formatDate(data.evaluation.observed_at_ns)}</code></div>
                    <div className="digest-row"><span>EVIDENCE HASH</span><code>{data.evaluation.evidence_hash}</code></div>
                    <div className="digest-row"><span>INPUT HASH</span><code>{data.evaluation.input_hash}</code></div>
                    {data.evaluation.output_hash && <div className="digest-row"><span>OUTPUT HASH</span><code>{data.evaluation.output_hash}</code></div>}
                    <div className="attestation-note"><span>↗</span><p>OutLayer execution reference is not included in the current on-chain evaluation view.</p></div>
                  </>
                ) : <p className="empty-copy">No evaluation has been recorded yet. Evaluation history is not indexed by this demo.</p>}
              </section>
            </div>

            <div className="bottom-grid">
              <section className="content-card consequence-card">
                <div className="card-heading">
                  <div><p className="eyebrow">CONSEQUENCE, NOT PROMISE</p><h3>Recurring support</h3></div>
                  <span className="card-index">03</span>
                </div>
                <div className="escrow-stats">
                  <Fact label="FUNDED" value={`${formatNear(data.escrow?.funded_yocto ?? "0")} NEAR`} />
                  <Fact label="PAID" value={`${formatNear(data.escrow?.paid_yocto ?? "0")} NEAR`} />
                  <Fact label="PENDING" value={`${formatNear(data.escrow?.pending_yocto ?? "0")} NEAR`} />
                  <Fact label="REFUNDED" value={`${formatNear(data.escrow?.refunded_yocto ?? "0")} NEAR`} />
                </div>
                <div className="claim-box">
                  <div className="claim-copy">
                    <span className={`eligibility-mark ${claimAllowed ? "is-eligible" : "is-blocked"}`}>{claimAllowed ? "✓" : "×"}</span>
                    <div><strong>{claimAllowed ? "A tranche can be claimed" : "A tranche is blocked"}</strong><span>{data.eligibility?.reason ?? "The contract has no current claim."}</span></div>
                  </div>
                  {data.eligibility?.eligible && (
                    <div className="claim-controls">
                      <label htmlFor="storage-deposit">Temporary storage deposit <span>NEAR</span></label>
                      <div className="claim-form-row">
                        <input id="storage-deposit" inputMode="decimal" value={depositNear} onChange={(event) => setDepositNear(event.target.value)} aria-label="Storage deposit in NEAR" />
                        <button className="claim-button" onClick={() => void claimTranche()} disabled={!canSubmitClaim}>
                          {claiming ? "Submitting…" : !accountId ? "Connect to claim" : !correctBeneficiary ? "Beneficiary wallet required" : "Claim tranche"}
                          <span aria-hidden="true">↗</span>
                        </button>
                      </div>
                      <p className="claim-disclaimer">The contract calculates its required storage bond and refunds any excess attached deposit.</p>
                    </div>
                  )}
                  {!data.eligibility?.eligible && <p className="eligibility-reason">{data.eligibility?.reason ?? "Claim eligibility is not available."}</p>}
                </div>
                {data.tranche && <div className="tranche-line"><span>CURRENT EPOCH · {data.tranche.epoch}</span><strong>{data.tranche.status}</strong></div>}
              </section>

              <section className="content-card integrity-card">
                <div className="card-heading">
                  <div><p className="eyebrow">WHAT THIS MEANS</p><h3>Evidence has limits.</h3></div>
                  <span className="integrity-symbol" aria-hidden="true">✳</span>
                </div>
                <p className="integrity-copy">A valid signature binds submitted data to the configured key. Even an attested evaluator can show only that configured code checked that data; it cannot prove the evidence source tells the truth about real-world service quality.</p>
                <div className="integrity-footer"><span className="integrity-dot" />POLICY ENFORCED ON NEAR</div>
              </section>
            </div>
            {data.challenge && <div className="notice notice-warning" role="status">Challenge #{data.challenge.id} is {data.challenge.status.toLowerCase()} and is linked to evaluation #{data.challenge.evaluation_id}.</div>}
          </div>
        ) : (
          <section className="empty-state">
            <div className="empty-orbit" aria-hidden="true"><span>↗</span></div>
            <p className="eyebrow">NO COMMITMENT SELECTED</p>
            <h3>Start with an on-chain promise.</h3>
            <p>Enter a commitment ID above to inspect its current health, policy, latest evaluation, and tranche eligibility.</p>
            <div className="empty-state-foot"><span className="tiny-check">✓</span> No sample data · reads come directly from NEAR Testnet</div>
          </section>
        )}
      </section>

      <footer className="footer">
        <a className="footer-brand" href="#top"><span className="brand-mark brand-mark-small"><span /></span>LCP <span>·</span> LIVING COMMITMENTS PROTOCOL</a>
        <p>Health is time-derived. The contract is the authority.</p>
      </footer>
    </main>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="fact"><span>{label}</span><strong className={mono ? "mono" : ""} title={value}>{value}</strong></div>;
}

function MetricCard({ eyebrow, title, detail, icon }: { eyebrow: string; title: string; detail: string; icon: string }) {
  return (
    <section className="metric-card">
      <div className="metric-top"><p className="eyebrow">{eyebrow}</p><span>{icon}</span></div>
      <strong className="metric-title">{title}</strong>
      <p className="metric-detail">{detail}</p>
    </section>
  );
}

function createWalletSender(connector: NearConnectorPort): NearTransactionSender {
  return async function send<T = unknown>(request: NearTransactionRequest): Promise<T> {
    const wallet = await connector.wallet();
    const outcome = await wallet.signAndSendTransaction({
      receiverId: request.contractId,
      actions: [{
        type: "FunctionCall",
        params: {
          methodName: request.methodName,
          args: request.args,
          gas: request.gas ?? "150000000000000",
          deposit: request.attachedDepositYocto ?? "0",
        },
      }],
    });
    return decodeTransactionOutcome<T>(outcome);
  };
}

function decodeTransactionOutcome<T>(outcome: unknown): T {
  if (!isRecord(outcome) || !isRecord(outcome.status)) return outcome as T;
  const status = outcome.status;
  if ("Failure" in status) throw new Error("NEAR transaction failed. Check the wallet transaction details.");
  if (typeof status.SuccessValue !== "string") return outcome as T;
  if (!status.SuccessValue) return undefined as T;

  const binary = atob(status.SuccessValue);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const output = new TextDecoder().decode(bytes);
  return JSON.parse(output) as T;
}

function parseNearToYocto(amount: string): string {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{0,24}))?$/.exec(amount.trim());
  if (!match) throw new Error("Enter a non-negative NEAR amount with up to 24 decimal places.");
  const fraction = (match[2] ?? "").padEnd(24, "0");
  return `${match[1]}${fraction}`.replace(/^0+(?=[0-9])/, "");
}

function formatNear(yocto: string): string {
  const value = BigInt(yocto);
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

function formatDuration(nanoseconds: string): string {
  const seconds = BigInt(nanoseconds) / 1_000_000_000n;
  if (seconds < 60n) return `${seconds} sec`;
  const minutes = seconds / 60n;
  if (minutes < 60n) return `${minutes} min`;
  const hours = minutes / 60n;
  if (hours < 48n) return `${hours} hr`;
  const days = hours / 24n;
  return `${days} days`;
}

function formatDate(nanoseconds: string): string {
  const milliseconds = Number(BigInt(nanoseconds) / 1_000_000n);
  return new Date(milliseconds).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function healthLabel(health?: string): string {
  switch (health) {
    case "Healthy": return "Healthy, for now";
    case "AtRisk": return "Evidence aging";
    case "Breached": return "Commitment breached";
    case "AwaitingEvidence": return "Awaiting evidence";
    case "Closed": return "Commitment closed";
    default: return "Unknown health";
  }
}

function healthDescription(health?: string, eligibility?: ClaimEligibilityView | null): string {
  if (eligibility?.eligible) return "Current evidence satisfies the policy, and this epoch is eligible for its configured support.";
  switch (health) {
    case "Healthy": return "Current evidence satisfies the policy. The contract still checks the active epoch and challenge window before a claim.";
    case "AtRisk": return "Evidence has reached its freshness boundary. A fresh compliant evaluation may restore eligibility if policy allows.";
    case "Breached": return "The configured grace period has elapsed. The contract blocks future claims until its recovery policy is satisfied.";
    case "AwaitingEvidence": return "The commitment has not received qualifying evidence within its initial window yet.";
    case "Closed": return "This commitment is closed. Its lifecycle no longer advances.";
    default: return "Effective health is calculated by the contract from accepted evidence, policy, and NEAR block time.";
  }
}

function shortenAccount(accountId: string): string {
  return accountId.length > 22 ? `${accountId.slice(0, 9)}…${accountId.slice(-8)}` : accountId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
