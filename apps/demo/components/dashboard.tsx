"use client";

import {
  buildHeartbeatSigningPayload,
  LcpClient,
  NearJsonRpcTransport,
} from "@lcp/sdk";
import type {
  ChallengeView,
  ClaimEligibilityView,
  CommitmentSummaryView,
  CreateCommitmentArgs,
  HeartbeatSigningInput,
  CommitmentPolicyView,
  CommitmentView,
  EvaluationRecordView,
  EscrowStatusView,
  NearTransactionRequest,
  NearTransactionSender,
  SignedHeartbeatEvidence,
  TrancheView,
} from "@lcp/sdk";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

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
  disconnect(): Promise<void>;
  wallet(): Promise<NearWalletPort>;
}

interface CommitmentData {
  commitment: CommitmentView;
  policy: CommitmentPolicyView | null;
  chainTimeNs: string | null;
  evaluation: EvaluationRecordView | null;
  evaluationHistory: EvaluationRecordView[];
  evaluationTimeoutNs: string | null;
  challenge: ChallengeView | null;
  eligibility: ClaimEligibilityView | null;
  escrow: EscrowStatusView | null;
  epoch: string | null;
  tranche: TrancheView | null;
}

type DraftAction = "escrow" | "operations" | "activate";
type ChallengeAction = "open" | "uphold" | "invalidate" | "expire";
type ClosureAction = "close" | "refund";

const CONTRACT_ID = process.env.NEXT_PUBLIC_LCP_CONTRACT_ID?.trim() ?? "";
const NEAR_NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() === "mainnet" ? "mainnet" : "testnet";
const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL?.trim() || "https://test.rpc.fastnear.com";
const DEFAULT_STORAGE_DEPOSIT = "0.01";
const EVALUATION_HISTORY_LIMIT = 10;
const COMMITMENT_PAGE_SIZE = 10;

export function Dashboard() {
  const connectorRef = useRef<NearConnectorPort | null>(null);
  const [commitmentId, setCommitmentId] = useState("");
  const [commitments, setCommitments] = useState<CommitmentSummaryView[]>([]);
  const [commitmentsVisible, setCommitmentsVisible] = useState(false);
  const [commitmentCursor, setCommitmentCursor] = useState<string | null>(null);
  const [hasMoreCommitments, setHasMoreCommitments] = useState(false);
  const [loadingCommitments, setLoadingCommitments] = useState(false);
  const [data, setData] = useState<CommitmentData | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [depositNear, setDepositNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [requestingEvaluation, setRequestingEvaluation] = useState(false);
  const [expiringEvaluation, setExpiringEvaluation] = useState(false);
  const [challengeAction, setChallengeAction] = useState<ChallengeAction | null>(null);
  const [closureAction, setClosureAction] = useState<ClosureAction | null>(null);
  const [draftAction, setDraftAction] = useState<DraftAction | null>(null);
  const [escrowFundingNear, setEscrowFundingNear] = useState("0.03");
  const [operationsFundingNear, setOperationsFundingNear] = useState("0.01");
  const [activationStorageNear, setActivationStorageNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function loadCommitmentPage(beforeId: string | null, append: boolean) {
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/demo/.env.local to browse commitments.");
      return;
    }
    setLoadingCommitments(true);
    setError(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
      const page = await client.listCommitments(beforeId, COMMITMENT_PAGE_SIZE);
      setCommitments((current) => append ? [...current, ...page] : page);
      setCommitmentCursor(page.length > 0 ? page[page.length - 1].id : append ? beforeId : null);
      setHasMoreCommitments(page.length === COMMITMENT_PAGE_SIZE);
      setCommitmentsVisible(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recent commitments could not be loaded.");
    } finally {
      setLoadingCommitments(false);
    }
  }

  async function loadCommitment(id = commitmentId): Promise<boolean> {
    const normalizedId = id.trim();
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/demo/.env.local to connect this demo to a deployed contract.");
      return false;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(normalizedId)) {
      setError("Enter a commitment ID as a whole number, such as 1.");
      return false;
    }

    setCommitmentId(normalizedId);
    setLoading(true);
    setData(null);
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
      const [commitment, policy, evaluation, eligibility, escrow, epoch, chainTimeNs] = await Promise.all([
        client.getCommitment(normalizedId),
        client.getPolicy(normalizedId),
        client.getLatestEvaluation(normalizedId),
        client.canClaimTranche(normalizedId),
        client.getEscrowStatus(normalizedId),
        client.getCurrentEpoch(normalizedId),
        getFinalBlockTimestampNs(RPC_URL).catch(() => null),
      ]);

      if (!commitment) {
        setData(null);
        setError(`Commitment ${normalizedId} was not found on ${CONTRACT_ID}.`);
        return false;
      }

      const latestEvaluationId = BigInt(commitment.next_evaluation_id) - 1n;
      const firstEvaluationId = latestEvaluationId > BigInt(EVALUATION_HISTORY_LIMIT)
        ? latestEvaluationId - BigInt(EVALUATION_HISTORY_LIMIT) + 1n
        : 1n;
      const evaluationIds: string[] = [];
      for (let id = latestEvaluationId; id >= firstEvaluationId && id > 0n; id -= 1n) {
        evaluationIds.push(id.toString());
      }
      const [evaluationHistory, evaluationTimeoutNs] = await Promise.all([
        Promise.all(evaluationIds.map((evaluationId) => client.getEvaluation(normalizedId, evaluationId)))
          .then((records) => records.filter((record): record is EvaluationRecordView => record !== null)),
        commitment.pending_evaluation_id
          ? client.getEvaluationTimeout(normalizedId, commitment.pending_evaluation_id)
          : Promise.resolve(null),
      ]);

      const [activeChallenge, tranche] = await Promise.all([
        commitment.active_challenge_id
          ? client.getChallenge(commitment.active_challenge_id)
          : Promise.resolve(null),
        epoch ? client.getTranche(normalizedId, epoch) : Promise.resolve(null),
      ]);
      const challenge = activeChallenge ?? (evaluation
        ? await client.getChallengeForEvaluation(normalizedId, evaluation.evaluation_id)
        : null);
      setData({ commitment, policy, chainTimeNs, evaluation, evaluationHistory, evaluationTimeoutNs, challenge, eligibility, escrow, epoch, tranche });
      return true;
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "The commitment could not be loaded.");
      return false;
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

  async function disconnectWallet() {
    const connector = connectorRef.current;
    if (!connector || !accountId) return;

    setDisconnecting(true);
    setError(null);
    setActionMessage(null);
    try {
      await connector.disconnect();
      setAccountId(null);
      setActionMessage("Wallet disconnected.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet disconnection was not completed.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function createCommitment(args: CreateCommitmentArgs, storageDeposit: string) {
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/demo/.env.local before creating a commitment.");
      return;
    }
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect a testnet wallet before creating a commitment.");
      return;
    }

    setCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      const transport = new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      });
      const newId = await new LcpClient(CONTRACT_ID, transport).createCommitment(args, {
        attachedDepositYocto: storageDeposit,
        gas: "150000000000000",
      });
      const id = String(newId);
      setCommitmentId(id);
      const loaded = await loadCommitment(id);
      setActionMessage(loaded
        ? `Draft commitment #${id} created. Fund its escrow and evaluator budget, then activate it.`
        : `Draft creation returned ID #${id}. Reload the commitment to verify its current state.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The commitment could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function submitDraftAction(action: DraftAction) {
    if (!data) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect a testnet wallet before changing this draft.");
      return;
    }
    const { commitment, policy } = data;
    const isSponsor = accountId === policy?.budget.sponsor;
    const canActivate = accountId === commitment.creator
      || accountId === commitment.maintainer
      || isSponsor;
    if ((action === "escrow" || action === "operations") && !isSponsor) {
      setError(`Only ${policy?.budget.sponsor} can fund this commitment.`);
      return;
    }
    if (action === "activate" && !canActivate) {
      setError("Only the creator, maintainer, or sponsor can activate this commitment.");
      return;
    }

    setDraftAction(action);
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      if (action === "escrow") {
        const amount = parseNearToYocto(escrowFundingNear);
        if (BigInt(amount) === 0n) throw new Error("Escrow funding must be greater than zero.");
        await client.fundCommitment(commitment.id, amount, { gas: "100000000000000" });
      } else if (action === "operations") {
        const amount = parseNearToYocto(operationsFundingNear);
        if (BigInt(amount) === 0n) throw new Error("Operations funding must be greater than zero.");
        await client.fundOperations(commitment.id, amount, { gas: "100000000000000" });
      } else {
        const storageDeposit = parseNearToYocto(activationStorageNear);
        if (BigInt(storageDeposit) === 0n) throw new Error("Activation storage deposit must be greater than zero.");
        await client.activateCommitment(commitment.id, {
          attachedDepositYocto: storageDeposit,
          gas: "150000000000000",
        });
      }
      const loaded = await loadCommitment(commitment.id);
      setActionMessage(loaded
        ? action === "activate"
          ? `Commitment #${commitment.id} is active.`
          : `${action === "escrow" ? "Escrow" : "Evaluator operations"} funding transaction submitted.`
        : `The ${action === "activate" ? "activation" : "funding"} transaction returned successfully. Reload commitment #${commitment.id} to verify its current state.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft action could not be completed.");
    } finally {
      setDraftAction(null);
    }
  }

  async function submitEvaluation(evidence: SignedHeartbeatEvidence, storageDeposit: string) {
    if (!data) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the maintainer or sponsor wallet before requesting an evaluation.");
      return;
    }
    const policy = data.policy;
    if (!policy || (accountId !== data.commitment.maintainer && accountId !== policy.budget.sponsor)) {
      setError(`Only ${data.commitment.maintainer} or ${policy?.budget.sponsor ?? "the configured sponsor"} can request evaluation.`);
      return;
    }

    setRequestingEvaluation(true);
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      const evaluationId = await client.requestEvaluation(data.commitment.id, evidence, {
        attachedDepositYocto: storageDeposit,
        gas: "180000000000000",
      });
      const loaded = await loadCommitment(data.commitment.id);
      setActionMessage(loaded
        ? `Evaluation #${evaluationId} requested. The commitment is waiting for its evaluator callback.`
        : `Evaluation request #${evaluationId} returned successfully. Reload commitment #${data.commitment.id} to verify its state.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The evaluation request failed.");
    } finally {
      setRequestingEvaluation(false);
    }
  }

  async function expirePendingEvaluation() {
    if (!data?.commitment.pending_evaluation_id) return;
    const connector = connectorRef.current;
    if (!connector) {
      setError("Connect a testnet wallet to expire this evaluation request.");
      return;
    }
    if (!data.evaluationTimeoutNs) {
      setError("The evaluation timeout is not available from this contract view.");
      return;
    }

    setExpiringEvaluation(true);
    setError(null);
    setActionMessage(null);
    try {
      const nowNs = BigInt(await getFinalBlockTimestampNs(RPC_URL));
      if (nowNs < BigInt(data.evaluationTimeoutNs)) {
        throw new Error(`This request can be expired after ${formatDate(data.evaluationTimeoutNs)}.`);
      }
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      await client.expireEvaluation(data.commitment.id, data.commitment.pending_evaluation_id);
      const loaded = await loadCommitment(data.commitment.id);
      setActionMessage(loaded
        ? `Evaluation #${data.commitment.pending_evaluation_id} expired after its timeout.`
        : `The evaluation expiry transaction returned successfully. Reload commitment #${data.commitment.id} to verify its state.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The pending evaluation could not be expired.");
    } finally {
      setExpiringEvaluation(false);
    }
  }

  async function submitChallengeAction(action: ChallengeAction, reason = "", storageDeposit = "") {
    if (!data?.policy) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the authorized commitment wallet before changing challenge state.");
      return;
    }
    const { commitment, policy, evaluation, challenge } = data;
    if (action === "open") {
      if (accountId !== commitment.maintainer && accountId !== policy.budget.sponsor) {
        setError(`Only ${commitment.maintainer} or ${policy.budget.sponsor} can challenge an evaluation.`);
        return;
      }
      if (commitment.pending_evaluation_id || commitment.active_challenge_id || challenge) {
        setError("Resolve the pending evaluation or existing challenge before opening another challenge.");
        return;
      }
      if (!evaluation || evaluation.status !== "Accepted" || evaluation.verdict !== "Compliant" || !evaluation.accepted_at_ns) {
        setError("Only the latest accepted compliant evaluation can be challenged.");
        return;
      }
      if (!reason.trim() || new TextEncoder().encode(reason).length > 1024) {
        setError("Challenge reason must be non-empty and no longer than 1024 UTF-8 bytes.");
        return;
      }
    } else {
      if (!challenge || challenge.status !== "Open") {
        setError("There is no open challenge for this commitment.");
        return;
      }
      if ((action === "uphold" || action === "invalidate") && accountId !== commitment.arbiter) {
        setError(`Only ${commitment.arbiter} can resolve this challenge.`);
        return;
      }
    }

    setChallengeAction(action);
    setError(null);
    setActionMessage(null);
    try {
      const nowNs = BigInt(await getFinalBlockTimestampNs(RPC_URL));
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      if (action === "open") {
        const challengeDeadline = BigInt(evaluation!.accepted_at_ns!) + BigInt(policy.temporal.challenge_window_ns);
        if (nowNs >= challengeDeadline) throw new Error("The evaluation challenge window has closed.");
        const deposit = parseNearToYocto(storageDeposit);
        if (BigInt(deposit) === 0n) throw new Error("Challenge storage deposit must be greater than zero.");
        const challengeId = await client.challengeEvaluation(commitment.id, evaluation!.evaluation_id, reason, {
          attachedDepositYocto: deposit,
          gas: "140000000000000",
        });
        const loaded = await loadCommitment(commitment.id);
        setActionMessage(loaded
          ? `Challenge #${challengeId} opened for evaluation #${evaluation!.evaluation_id}.`
          : `Challenge #${challengeId} opened. Reload commitment #${commitment.id} to verify its state.`);
      } else if (action === "uphold" || action === "invalidate") {
        if (nowNs >= BigInt(challenge!.resolution_deadline_ns)) {
          throw new Error("The arbiter resolution deadline has passed; the challenge can now time out.");
        }
        await client.resolveChallenge(challenge!.id, action === "uphold");
        const loaded = await loadCommitment(commitment.id);
        setActionMessage(loaded
          ? action === "uphold"
            ? `Challenge #${challenge!.id} upheld; the evaluation remains accepted.`
            : `Challenge #${challenge!.id} invalidated; its evidence no longer qualifies.`
          : `Challenge #${challenge!.id} was resolved. Reload commitment #${commitment.id} to verify its state.`);
      } else {
        if (nowNs < BigInt(challenge!.resolution_deadline_ns)) {
          throw new Error("The challenge resolution deadline has not passed yet.");
        }
        await client.expireChallenge(challenge!.id);
        const loaded = await loadCommitment(commitment.id);
        setActionMessage(loaded
          ? `Challenge #${challenge!.id} timed out; its evidence no longer qualifies.`
          : `Challenge #${challenge!.id} timed out. Reload commitment #${commitment.id} to verify its state.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The challenge action failed.");
    } finally {
      setChallengeAction(null);
    }
  }

  async function submitClosureAction(action: ClosureAction, storageDeposit = "") {
    if (!data?.policy) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect an authorized commitment wallet before closing or refunding.");
      return;
    }
    const { commitment, policy } = data;
    if (action === "close") {
      const canClose = [commitment.creator, commitment.maintainer, commitment.arbiter, policy.budget.sponsor].includes(accountId);
      if (!canClose) {
        setError("Only the creator, maintainer, arbiter, or sponsor can close this commitment.");
        return;
      }
      if (commitment.lifecycle === "Closed") {
        setError("This commitment is already closed.");
        return;
      }
      if (commitment.pending_evaluation_id || commitment.active_challenge_id || BigInt(commitment.escrow_pending_yocto) > 0n) {
        setError("Resolve pending evaluations, challenges, and transfers before closing.");
        return;
      }
    } else {
      if (commitment.lifecycle !== "Closed") {
        setError("Close the commitment before refunding residual escrow.");
        return;
      }
      if (accountId !== policy.budget.sponsor) {
        setError(`Only ${policy.budget.sponsor} can refund residual escrow.`);
        return;
      }
      if (BigInt(data.escrow?.free_yocto ?? "0") === 0n) {
        setError("There is no residual escrow to refund.");
        return;
      }
    }

    setClosureAction(action);
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      if (action === "close") {
        await client.closeCommitment(commitment.id);
        const loaded = await loadCommitment(commitment.id);
        setActionMessage(loaded
          ? `Commitment #${commitment.id} is closed. The sponsor may request any residual escrow refund.`
          : `Commitment #${commitment.id} was closed. Reload it to verify its current state.`);
      } else {
        const deposit = parseNearToYocto(storageDeposit);
        if (BigInt(deposit) === 0n) throw new Error("Refund storage deposit must be greater than zero.");
        const refundAmount = data.escrow?.free_yocto ?? "0";
        const transferId = await client.refundRemaining(commitment.id, {
          attachedDepositYocto: deposit,
          gas: "150000000000000",
        });
        const loaded = await loadCommitment(commitment.id);
        setActionMessage(loaded
          ? `Residual refund transfer #${transferId} requested for ${formatNear(refundAmount)} NEAR.`
          : `Residual refund transfer #${transferId} requested. Reload commitment #${commitment.id} to verify its state.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The closure or refund action failed.");
    } finally {
      setClosureAction(null);
    }
  }

  async function claimTranche() {
    if (!data || !data.policy) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the beneficiary wallet before submitting a claim.");
      return;
    }
    if (accountId !== data.policy.budget.beneficiary) {
      setError(`Only ${data.policy.budget.beneficiary} can claim this tranche.`);
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
  const failedTranche = data?.tranche?.status === "Failed";
  const retryingFailedPayout = failedTranche && claimAllowed;
  const correctBeneficiary = Boolean(accountId && data?.policy && accountId === data.policy.budget.beneficiary);
  const canSubmitClaim = Boolean(data && claimAllowed && correctBeneficiary && !claiming);
  const lastGoodObservationNs = data?.commitment.last_good_observed_at_ns ?? null;
  const evidenceAgeNs = data?.chainTimeNs && lastGoodObservationNs
    ? BigInt(data.chainTimeNs) - BigInt(lastGoodObservationNs)
    : null;
  const evidenceExpiresAtNs = lastGoodObservationNs && data?.policy
    ? (BigInt(lastGoodObservationNs) + BigInt(data.policy.temporal.evidence_ttl_ns)).toString()
    : null;
  const lastGoodEvidenceDetail = lastGoodObservationNs
    ? [
      evidenceAgeNs !== null && evidenceAgeNs >= 0n ? `Age ${formatDuration(evidenceAgeNs.toString())}` : "Age unavailable",
      evidenceExpiresAtNs ? `expires ${formatDate(evidenceExpiresAtNs)}` : "expiration unavailable",
    ].join(" · ")
    : "No accepted compliant evidence";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Living Commitments Protocol home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-name">living commitments<span>protocol</span></span>
        </a>
        <div className="topbar-right">
          <span className="network-chip"><span className="network-dot" />NEAR TESTNET</span>
          {accountId ? (
            <>
              <span className="wallet-account" title={accountId} aria-label={`Connected wallet ${accountId}`}>
                {shortenAccount(accountId)}
              </span>
              <button
                className="wallet-button wallet-disconnect-button"
                type="button"
                onClick={() => void disconnectWallet()}
                disabled={disconnecting}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          ) : (
            <button className="wallet-button" type="button" onClick={() => void connectWallet()} disabled={connecting}>
              <span className="wallet-icon" aria-hidden="true">◈</span>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
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

        <section className="commitment-browser" aria-label="Recent commitments">
          <div className="browser-toolbar">
            <p>Browse commitments in reverse creation order.</p>
            <button
              className="browser-button"
              type="button"
              disabled={loadingCommitments || !CONTRACT_ID}
              onClick={() => {
                if (commitmentsVisible) setCommitmentsVisible(false);
                else void loadCommitmentPage(null, false);
              }}
            >
              {loadingCommitments ? "Loading recent commitments…" : commitmentsVisible ? "Hide recent commitments" : "Browse recent commitments"}
            </button>
          </div>
          {commitmentsVisible && (
            <div className="browser-panel">
              <div className="browser-panel-heading">
                <div><strong>Recent commitments</strong><span>Latest on-chain state · page size {COMMITMENT_PAGE_SIZE}</span></div>
                <button className="browser-text-button" type="button" disabled={loadingCommitments} onClick={() => void loadCommitmentPage(null, false)}>Latest</button>
              </div>
              {commitments.length > 0 ? (
                <div className="commitment-list" role="list">
                  {commitments.map((commitment) => (
                    <button
                      className="commitment-list-item"
                      type="button"
                      role="listitem"
                      key={commitment.id}
                      disabled={loading}
                      onClick={() => void loadCommitment(commitment.id)}
                    >
                      <span className="commitment-list-id">#{commitment.id}</span>
                      <span className="commitment-list-subject">{commitment.subject}</span>
                      <span className="commitment-list-status">{commitment.lifecycle} · {commitment.effective_health}</span>
                      <span className="commitment-list-escrow">{formatNear(commitment.escrow_paid_yocto)} / {formatNear(commitment.escrow_funded_yocto)} NEAR paid</span>
                      <span className="commitment-list-arrow" aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="browser-empty">{loadingCommitments ? "Reading recent commitments…" : "No commitments found yet."}</p>
              )}
              {hasMoreCommitments && commitmentCursor && (
                <button className="browser-more-button" type="button" disabled={loadingCommitments} onClick={() => void loadCommitmentPage(commitmentCursor, true)}>
                  {loadingCommitments ? "Loading…" : "Load older commitments"}
                </button>
              )}
            </div>
          )}
        </section>

        <details className="create-commitment">
          <summary><span className="create-plus">＋</span><span><strong>Create a commitment</strong><small>Set a policy and create a draft on NEAR Testnet</small></span><span className="summary-arrow">⌄</span></summary>
          <CreateCommitmentForm
            connectedAccountId={accountId}
            contractConfigured={Boolean(CONTRACT_ID)}
            busy={creating}
            onCreate={createCommitment}
          />
        </details>

        {error && <div className="notice notice-error" role="alert"><span className="notice-icon">!</span>{error}</div>}
        {actionMessage && <div className="notice notice-success" role="status"><span className="notice-icon">✓</span>{actionMessage}</div>}

        {data ? (
          <div className="record-view">
            {data.commitment.lifecycle === "Draft" && data.policy && (
              <DraftSetupCard
                data={data}
                accountId={accountId}
                escrowFundingNear={escrowFundingNear}
                operationsFundingNear={operationsFundingNear}
                activationStorageNear={activationStorageNear}
                busyAction={draftAction}
                onEscrowFundingChange={setEscrowFundingNear}
                onOperationsFundingChange={setOperationsFundingNear}
                onActivationStorageChange={setActivationStorageNear}
                onAction={submitDraftAction}
              />
            )}
            {data.commitment.lifecycle === "Active" && data.policy && (
              <EvidenceSubmissionCard
                key={`${data.commitment.id}:${data.commitment.next_evaluation_id}:${data.commitment.policy_hash}`}
                data={data}
                accountId={accountId}
                busy={requestingEvaluation || expiringEvaluation}
                pendingTimeoutNs={data.evaluationTimeoutNs}
                onExpire={expirePendingEvaluation}
                onSubmit={submitEvaluation}
              />
            )}
            {data.commitment.lifecycle === "Active" && data.policy && (
              <ChallengeControlsCard
                data={data}
                accountId={accountId}
                busyAction={challengeAction}
                onAction={submitChallengeAction}
              />
            )}
            {data.policy && (
              <ClosureControlsCard
                data={data}
                accountId={accountId}
                busyAction={closureAction}
                onAction={submitClosureAction}
              />
            )}
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
                <Fact label="BENEFICIARY" value={data.policy?.budget.beneficiary ?? "Unknown"} mono />
                <Fact label="POLICY VERSION" value={`v${data.commitment.policy_version}`} mono />
              </div>
            </section>

            <HealthTimeline data={data} busy={loading} onRefresh={() => void loadCommitment(data.commitment.id)} />

            <div className="metrics-grid">
              <MetricCard
                eyebrow="LAST COMPLIANT EVIDENCE"
                title={data.commitment.last_good_observed_at_ns ? formatDate(data.commitment.last_good_observed_at_ns) : "No accepted evidence"}
                detail={lastGoodEvidenceDetail}
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
                    <EvaluationProofReference transactionHashHex={data.evaluation.request_transaction_hash} />
                    {data.evaluationHistory.filter((record) => record.evaluation_id !== data.evaluation?.evaluation_id).length > 0 && (
                      <div className="evaluation-history">
                        <p className="eyebrow">PREVIOUS EVALUATIONS · RECENT 9</p>
                        <ol>
                          {data.evaluationHistory
                            .filter((record) => record.evaluation_id !== data.evaluation?.evaluation_id)
                            .map((record) => (
                              <li key={record.evaluation_id}>
                                <span className={`status-pill status-${record.status.toLowerCase()}`}>{record.status}</span>
                                <strong>#{record.evaluation_id} · {record.verdict ?? "Pending"}</strong>
                                <time>{formatDate(record.accepted_at_ns ?? record.observed_at_ns)}</time>
                                <EvaluationProofReference transactionHashHex={record.request_transaction_hash} />
                              </li>
                            ))}
                        </ol>
                      </div>
                    )}
                  </>
                ) : <p className="empty-copy">No evaluation has been recorded on chain yet.</p>}
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
                    <div>
                      <strong>{retryingFailedPayout ? "Previous payout failed; retry is available" : failedTranche ? "Previous payout failed; this epoch is currently blocked" : claimAllowed ? "A tranche can be claimed" : "A tranche is blocked"}</strong>
                      <span>{retryingFailedPayout ? "The failed transfer was released back to escrow. Retry when the beneficiary account can receive funds." : data.eligibility?.reason ?? "The contract has no current claim."}</span>
                    </div>
                  </div>
                  {data.eligibility?.eligible && (
                    <div className="claim-controls">
                      <label htmlFor="storage-deposit">Temporary storage deposit <span>NEAR</span></label>
                      <div className="claim-form-row">
                        <input id="storage-deposit" inputMode="decimal" value={depositNear} onChange={(event) => setDepositNear(event.target.value)} aria-label="Storage deposit in NEAR" />
                        <button className="claim-button" onClick={() => void claimTranche()} disabled={!canSubmitClaim}>
                          {claiming ? "Submitting…" : !accountId ? "Connect to claim" : !correctBeneficiary ? "Beneficiary wallet required" : retryingFailedPayout ? "Retry payout" : "Claim tranche"}
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

interface HealthTimelinePoint {
  label: string;
  detail: string;
  atNs: string;
  source: "recorded" | "derived";
}

function buildHealthTimeline(data: CommitmentData): HealthTimelinePoint[] {
  const { commitment, policy } = data;
  if (!commitment.activated_at_ns || !policy) return [];

  const points: HealthTimelinePoint[] = [{
    label: "Commitment activated",
    detail: "The contract started the initial evidence clock.",
    atNs: commitment.activated_at_ns,
    source: "recorded",
  }];
  if (commitment.last_good_observed_at_ns) {
    points.push({
      label: "Compliant evidence observed",
      detail: "Timestamp from the most recent accepted compliant heartbeat.",
      atNs: commitment.last_good_observed_at_ns,
      source: "recorded",
    });
  }
  if (commitment.negative_since_ns) {
    points.push({
      label: "Negative health period began",
      detail: "The contract recorded a negative evaluation or invalidated evidence.",
      atNs: commitment.negative_since_ns,
      source: "recorded",
    });
    if (commitment.lifecycle === "Active") {
      points.push({
        label: "Grace period ends",
        detail: policy.temporal.recovery_allowed
          ? "Breached begins here unless qualifying evidence is accepted first."
          : "Breach latches here because recovery is disabled by policy.",
        atNs: (BigInt(commitment.negative_since_ns) + BigInt(policy.temporal.grace_ns)).toString(),
        source: "derived",
      });
    }
  } else if (commitment.last_good_observed_at_ns) {
    const evidenceExpiryNs = BigInt(commitment.last_good_observed_at_ns)
      + BigInt(policy.temporal.evidence_ttl_ns);
    points.push({
      label: "Evidence freshness ends",
      detail: "AtRisk begins if no newer compliant evidence has been accepted.",
      atNs: evidenceExpiryNs.toString(),
      source: "derived",
    });
    if (commitment.lifecycle === "Active") {
      points.push({
        label: "Grace period ends",
        detail: policy.temporal.recovery_allowed
          ? "Breached begins here unless qualifying evidence is accepted first."
          : "Breach latches here because recovery is disabled by policy.",
        atNs: (evidenceExpiryNs + BigInt(policy.temporal.grace_ns)).toString(),
        source: "derived",
      });
    }
  } else if (commitment.lifecycle === "Active") {
    const initialDeadlineNs = BigInt(commitment.activated_at_ns)
      + BigInt(policy.temporal.initial_window_ns);
    points.push({
      label: "Initial evidence deadline",
      detail: "AtRisk begins if compliant evidence has not been accepted by this time.",
      atNs: initialDeadlineNs.toString(),
      source: "derived",
    });
    points.push({
      label: "Grace period ends",
      detail: policy.temporal.recovery_allowed
        ? "Breached begins here unless qualifying evidence is accepted first."
        : "Breach latches here because recovery is disabled by policy.",
      atNs: (initialDeadlineNs + BigInt(policy.temporal.grace_ns)).toString(),
      source: "derived",
    });
  }

  const nowNs = data.chainTimeNs ? BigInt(data.chainTimeNs) : null;
  const hideFutureDeadlines = commitment.lifecycle === "Closed" || commitment.effective_health === "Breached";
  const visiblePoints = hideFutureDeadlines
    ? points.filter((point) => point.source === "recorded" || (nowNs !== null && BigInt(point.atNs) <= nowNs))
    : points;
  return visiblePoints.sort((left, right) => {
    const leftNs = BigInt(left.atNs);
    const rightNs = BigInt(right.atNs);
    return leftNs < rightNs ? -1 : leftNs > rightNs ? 1 : 0;
  });
}

function HealthTimeline({ data, busy, onRefresh }: { data: CommitmentData; busy: boolean; onRefresh: () => void }) {
  const points = buildHealthTimeline(data);
  const chainTimeNs = data.chainTimeNs;
  const canHaveNextDeadline = data.commitment.lifecycle === "Active"
    && data.commitment.effective_health !== "Breached";
  const nextPointIndex = chainTimeNs && canHaveNextDeadline
    ? points.findIndex((point) => BigInt(point.atNs) > BigInt(chainTimeNs))
    : -1;
  const timeUntilNextPoint = chainTimeNs && nextPointIndex >= 0
    ? (BigInt(points[nextPointIndex].atNs) - BigInt(chainTimeNs)).toString()
    : null;

  return (
    <section className="content-card health-timeline" aria-labelledby="health-timeline-title">
      <div className="card-heading">
        <div><p className="eyebrow">RECORDED EVENTS &amp; POLICY TIME</p><h3 id="health-timeline-title">Health clock</h3></div>
        <div className="timeline-tools">
          <span className="timeline-snapshot">{data.chainTimeNs ? `FINALIZED · ${formatDate(data.chainTimeNs)}` : "BLOCK TIME UNAVAILABLE"}</span>
          <button className="browser-text-button timeline-refresh" type="button" onClick={onRefresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh snapshot"}
          </button>
        </div>
      </div>
      {!data.policy ? (
        <p className="empty-copy">Policy timing details are unavailable for this commitment.</p>
      ) : data.commitment.lifecycle === "Draft" ? (
        <p className="empty-copy">The evidence clock starts when the commitment is activated.</p>
      ) : points.length === 0 ? (
        <p className="empty-copy">Activation time is not available for this commitment.</p>
      ) : (
        <>
          <p className="timeline-explainer">Recorded entries come from commitment state. Deadlines are derived from recorded timestamps and the immutable policy; finalized NEAR time shows which one is next.</p>
          <ol className="timeline-list">
            {points.map((point, index) => (
              <li className={`timeline-item ${index === nextPointIndex ? "timeline-item-next" : ""}`} key={`${point.label}-${point.atNs}`}>
                <span className={`timeline-marker timeline-marker-${point.source}`} aria-hidden="true" />
                <div className="timeline-content">
                  <div className="timeline-item-top">
                    <strong>{point.label}</strong>
                    <span className={`timeline-source timeline-source-${point.source}`}>{point.source === "recorded" ? "RECORDED" : "DERIVED"}</span>
                  </div>
                  <p>{point.detail}</p>
                  <time>{formatDate(point.atNs)}{index === nextPointIndex && timeUntilNextPoint ? ` · UP NEXT IN ${formatCountdown(timeUntilNextPoint)}` : ""}</time>
                </div>
              </li>
            ))}
          </ol>
          {data.commitment.lifecycle === "Closed" && <p className="timeline-closed-note">The commitment is closed; no future health deadlines are active.</p>}
          {data.commitment.effective_health === "Breached" && <p className="timeline-closed-note">The commitment is currently Breached; the timeline shows no future automatic health changes.</p>}
          {!data.chainTimeNs && <p className="timeline-closed-note">Refresh the commitment to compare these milestones with a finalized block time.</p>}
        </>
      )}
    </section>
  );
}

function MetricCard({ eyebrow, title, detail, icon }: { eyebrow: string; title: string; detail: string; icon: string }) {
  return (
    <section className="metric-card">
      <div className="metric-top"><p className="eyebrow">{eyebrow}</p><span>{icon}</span></div>
      <strong className="metric-title">{title}</strong>
      <p className="metric-detail" title={detail}>{detail}</p>
    </section>
  );
}

function EvidenceSubmissionCard({
  data,
  accountId,
  busy,
  pendingTimeoutNs,
  onExpire,
  onSubmit,
}: {
  data: CommitmentData;
  accountId: string | null;
  busy: boolean;
  pendingTimeoutNs: string | null;
  onExpire: () => Promise<void>;
  onSubmit: (evidence: SignedHeartbeatEvidence, storageDeposit: string) => Promise<void>;
}) {
  const { commitment, policy } = data;
  const [artifactHash, setArtifactHash] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [payload, setPayload] = useState("");
  const [signature, setSignature] = useState("");
  const [storageDepositNear, setStorageDepositNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const [formError, setFormError] = useState<string | null>(null);
  const canRequest = Boolean(accountId && (accountId === commitment.maintainer || accountId === policy?.budget.sponsor));
  const blocked = Boolean(commitment.pending_evaluation_id || commitment.active_challenge_id);

  async function preparePayload() {
    setFormError(null);
    try {
      if (!policy) throw new Error("Policy details are unavailable for this commitment.");
      if (blocked) throw new Error("Resolve the pending evaluation or active challenge before preparing a new request.");
      if (!/^[0-9a-f]{64}$/.test(artifactHash)) {
        throw new Error("Enter the evidence artifact SHA-256 digest as 64 lowercase hexadecimal characters.");
      }
      const observedAtNs = await getFinalBlockTimestampNs(RPC_URL);
      const input: HeartbeatSigningInput = {
        commitment_id: commitment.id,
        evaluation_id: commitment.next_evaluation_id,
        policy_version: commitment.policy_version,
        policy_hash: commitment.policy_hash,
        observed_at_ns: observedAtNs,
        subject: commitment.subject,
        artifact_hash: artifactHash,
        pinned_public_key_hex: policy.evidence.maintainer_public_key_hex,
      };
      setPayload(buildHeartbeatSigningPayload(input));
      setObservedAt(observedAtNs);
      setSignature("");
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The signing payload could not be prepared.");
    }
  }

  async function copyPayload() {
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      setFormError("Clipboard access failed. Select and copy the payload text manually.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      if (!policy || !payload) throw new Error("Prepare the canonical signing payload first.");
      if (!/^[0-9a-f]{128}$/.test(signature)) {
        throw new Error("Paste the 64-byte Ed25519 signature as 128 lowercase hexadecimal characters.");
      }
      const deposit = parseNearToYocto(storageDepositNear);
      if (BigInt(deposit) === 0n) throw new Error("Request storage deposit must be greater than zero.");
      await onSubmit({
        type: "signed_maintenance_heartbeat",
        artifact_hash: artifactHash,
        maintainer_public_key: policy.evidence.maintainer_public_key_hex,
        signature,
        payload,
      }, deposit);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Check the signed evidence and try again.");
    }
  }

  return (
    <section className="content-card evidence-submission">
      <div className="card-heading">
        <div><p className="eyebrow">ACTIVE · HEARTBEAT EVIDENCE</p><h3>Submit a signed observation</h3></div>
        <span className="card-index">NEXT · {commitment.next_evaluation_id}</span>
      </div>
      <p className="evidence-intro">The demo builds the exact commitment-bound message using a finalized NEAR block time. Sign its UTF-8 text offline with the maintainer key pinned in policy, then paste the lowercase hex signature within the policy’s {formatDuration(policy?.temporal.max_source_lag_ns ?? "0")} source-lag window. The private key never enters this page; regenerate the payload if it gets stale.</p>
      {commitment.pending_evaluation_id && (
        <div className="pending-evaluation">
          <p className="form-wallet-hint">Evaluation #{commitment.pending_evaluation_id} is pending{pendingTimeoutNs ? ` until ${formatDate(pendingTimeoutNs)}` : ""}.</p>
          <button className="challenge-expire-button" type="button" onClick={() => void onExpire()} disabled={!accountId || busy || !pendingTimeoutNs}>
            {busy ? "Expiring evaluation…" : "Expire after timeout"}
          </button>
          {!accountId && <small>Connect any testnet wallet to expire the request.</small>}
          <small>Any connected wallet can expire the request after its deadline if the OutLayer callback has not completed.</small>
        </div>
      )}
      {commitment.active_challenge_id && <p className="form-wallet-hint">Resolve challenge #{commitment.active_challenge_id} before requesting another evaluation.</p>}
      {!canRequest && !commitment.pending_evaluation_id && <p className="form-wallet-hint">Connect the maintainer or sponsor wallet to submit an evaluation request.</p>}
      <div className="form-grid evidence-form-grid">
        <FormField label="Evidence artifact SHA-256 · 64 lowercase hex" wide>
          <input className="mono-input" value={artifactHash} onChange={(event) => { setArtifactHash(event.target.value); setPayload(""); setObservedAt(""); setSignature(""); }} placeholder="Digest of the artifact or maintenance evidence" />
        </FormField>
      </div>
      <button className="prepare-payload-button" type="button" onClick={() => void preparePayload()} disabled={!canRequest || blocked || busy}>
        Prepare canonical signing payload <span aria-hidden="true">↗</span>
      </button>
      {payload && (
        <form className="evidence-signing-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="digest-row"><span>OBSERVED AT · FINAL NEAR BLOCK</span><code>{observedAt}</code></div>
          <FormField label="Exact UTF-8 payload to sign" wide><textarea className="mono-input signing-payload" value={payload} readOnly rows={6} /></FormField>
          <button className="copy-payload-button" type="button" onClick={() => void copyPayload()}>Copy signing payload</button>
          <div className="form-grid evidence-form-grid">
            <FormField label="Ed25519 signature · 128 lowercase hex" wide><input className="mono-input" value={signature} onChange={(event) => setSignature(event.target.value)} maxLength={128} placeholder="Paste the offline signature" /></FormField>
            <FormField label="Request storage deposit · NEAR"><input inputMode="decimal" value={storageDepositNear} onChange={(event) => setStorageDepositNear(event.target.value)} /></FormField>
          </div>
          {formError && <div className="notice notice-error form-notice" role="alert"><span className="notice-icon">!</span>{formError}</div>}
          <div className="creation-submit-row"><p>Requesting evaluation spends the evaluator execution budget and reserves callback storage. The contract validates the signature and request binding.</p><button className="lookup-button" type="submit" disabled={busy || !canRequest || blocked || !signature}>{busy ? <><span className="spinner" />Requesting evaluation</> : <>Request evaluation <span aria-hidden="true">↗</span></>}</button></div>
        </form>
      )}
      {!payload && formError && <div className="notice notice-error form-notice" role="alert"><span className="notice-icon">!</span>{formError}</div>}
    </section>
  );
}

function ChallengeControlsCard({
  data,
  accountId,
  busyAction,
  onAction,
}: {
  data: CommitmentData;
  accountId: string | null;
  busyAction: ChallengeAction | null;
  onAction: (action: ChallengeAction, reason?: string, storageDeposit?: string) => Promise<void>;
}) {
  const { commitment, policy, evaluation, challenge } = data;
  const [reason, setReason] = useState("");
  const [storageDepositNear, setStorageDepositNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const canChallenge = Boolean(accountId && (accountId === commitment.maintainer || accountId === policy?.budget.sponsor));
  const canResolve = accountId === commitment.arbiter;
  const latestCompliant = Boolean(evaluation?.status === "Accepted" && evaluation.verdict === "Compliant" && evaluation.accepted_at_ns);

  if (!challenge && !latestCompliant) return null;

  async function handleOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onAction("open", reason, storageDepositNear);
  }

  return (
    <section className="content-card challenge-controls">
      <div className="card-heading">
        <div><p className="eyebrow">CHALLENGE · REVIEW &amp; RESOLVE</p><h3>Keep evidence accountable.</h3></div>
        <span className="card-index">{challenge ? `#${challenge.id}` : "REVIEW"}</span>
      </div>
      {challenge?.status === "Open" ? (
        <>
          <p className="challenge-intro">Challenge #{challenge.id} contests evaluation #{challenge.evaluation_id}. The designated arbiter may resolve it before the deadline; anyone may expire it after the deadline.</p>
          <div className="digest-row"><span>REASON HASH</span><code>{challenge.reason_hash}</code></div>
          <div className="digest-row"><span>RESOLUTION DEADLINE · NS</span><code>{challenge.resolution_deadline_ns}</code></div>
          {!canResolve && <p className="form-wallet-hint">Connect the arbiter wallet ({commitment.arbiter}) to resolve this challenge.</p>}
          <div className="challenge-actions">
            <button type="button" onClick={() => void onAction("uphold")} disabled={busyAction !== null || !canResolve}>{busyAction === "uphold" ? "Resolving…" : "Uphold evaluation"}</button>
            <button type="button" onClick={() => void onAction("invalidate")} disabled={busyAction !== null || !canResolve}>{busyAction === "invalidate" ? "Resolving…" : "Invalidate evidence"}</button>
            <button className="challenge-expire" type="button" onClick={() => void onAction("expire")} disabled={busyAction !== null}>{busyAction === "expire" ? "Expiring…" : "Expire after deadline"}</button>
          </div>
          <small className="challenge-help">Upholding leaves the accepted observation intact. Invalidating or timing out removes it from health calculations.</small>
        </>
      ) : challenge ? (
        <>
          <p className="challenge-intro">Evaluation #{challenge.evaluation_id} was already challenged. Its resolution is final and cannot be challenged again.</p>
          <div className="challenge-history"><span className={`status-pill status-${challenge.status.toLowerCase()}`}>{challenge.status}</span><span>Challenge #{challenge.id} · {formatDate(challenge.opened_at_ns)}</span></div>
          <div className="digest-row"><span>REASON HASH</span><code>{challenge.reason_hash}</code></div>
        </>
      ) : (
        <>
          <p className="challenge-intro">The latest accepted evaluation is compliant. An authorized maintainer or sponsor can open one challenge during its policy window; the reason is stored as a hash.</p>
          {!canChallenge && <p className="form-wallet-hint">Connect the maintainer or sponsor wallet to challenge this evaluation.</p>}
          <form className="challenge-open-form" onSubmit={(event) => void handleOpen(event)}>
            <FormField label="Challenge reason · max 1024 UTF-8 bytes" wide><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1024} rows={3} required placeholder="Describe the evidence concern; only its hash is stored on-chain." /></FormField>
            <div className="challenge-submit-row">
              <FormField label="Challenge storage deposit · NEAR"><input inputMode="decimal" value={storageDepositNear} onChange={(event) => setStorageDepositNear(event.target.value)} /></FormField>
              <button className="prepare-payload-button" type="submit" disabled={!canChallenge || busyAction !== null}>{busyAction === "open" ? "Opening challenge…" : "Open challenge"}</button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

function ClosureControlsCard({
  data,
  accountId,
  busyAction,
  onAction,
}: {
  data: CommitmentData;
  accountId: string | null;
  busyAction: ClosureAction | null;
  onAction: (action: ClosureAction, storageDeposit?: string) => Promise<void>;
}) {
  const { commitment, policy, escrow } = data;
  const [storageDepositNear, setStorageDepositNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const canClose = Boolean(accountId && [commitment.creator, commitment.maintainer, commitment.arbiter, policy?.budget.sponsor].includes(accountId));
  const canRefund = accountId === policy?.budget.sponsor;
  const residualYocto = escrow?.free_yocto ?? "0";
  const hasResidual = BigInt(residualYocto) > 0n;
  const hasPending = Boolean(commitment.pending_evaluation_id || commitment.active_challenge_id || BigInt(commitment.escrow_pending_yocto) > 0n);

  return (
    <section className="content-card closure-controls">
      <div className="card-heading">
        <div><p className="eyebrow">CLOSE · SETTLE REMAINING ESCROW</p><h3>{commitment.lifecycle === "Closed" ? "Commitment closed." : "End this commitment."}</h3></div>
        <span className="card-index">{commitment.lifecycle.toUpperCase()}</span>
      </div>
      {commitment.lifecycle === "Closed" ? (
        <>
          <div className="closure-balance"><span>RESIDUAL ESCROW</span><strong>{formatNear(residualYocto)} NEAR</strong></div>
          {hasResidual ? (
            <>
              {!canRefund && <p className="form-wallet-hint">Connect the sponsor wallet ({policy?.budget.sponsor}) to request the remaining refund.</p>}
              <div className="closure-refund-row">
                <FormField label="Temporary refund storage deposit · NEAR"><input inputMode="decimal" value={storageDepositNear} onChange={(event) => setStorageDepositNear(event.target.value)} /></FormField>
                <button type="button" onClick={() => void onAction("refund", storageDepositNear)} disabled={!canRefund || busyAction !== null}>{busyAction === "refund" ? "Requesting refund…" : "Refund residual escrow"}</button>
              </div>
              <small className="closure-help">The refund is asynchronous. The contract updates the balance after transfer reconciliation; excess storage deposit is refunded.</small>
            </>
          ) : <p className="closure-help">No residual escrow is available to refund.</p>}
        </>
      ) : (
        <>
          <p className="closure-intro">Closing stops future evaluations and claims. After pending work settles, the sponsor can request the remaining escrow refund.</p>
          {hasPending && <p className="form-wallet-hint">Resolve pending evaluations, challenges, and escrow transfers before closing.</p>}
          {!canClose && <p className="form-wallet-hint">Connect the creator, maintainer, arbiter, or sponsor wallet to close this commitment.</p>}
          <button className="close-commitment-button" type="button" onClick={() => void onAction("close")} disabled={!canClose || hasPending || busyAction !== null}>{busyAction === "close" ? "Closing commitment…" : "Close commitment"}</button>
        </>
      )}
    </section>
  );
}

function DraftSetupCard({
  data,
  accountId,
  escrowFundingNear,
  operationsFundingNear,
  activationStorageNear,
  busyAction,
  onEscrowFundingChange,
  onOperationsFundingChange,
  onActivationStorageChange,
  onAction,
}: {
  data: CommitmentData;
  accountId: string | null;
  escrowFundingNear: string;
  operationsFundingNear: string;
  activationStorageNear: string;
  busyAction: DraftAction | null;
  onEscrowFundingChange: (value: string) => void;
  onOperationsFundingChange: (value: string) => void;
  onActivationStorageChange: (value: string) => void;
  onAction: (action: DraftAction) => Promise<void>;
}) {
  const { commitment, policy } = data;
  if (!policy) return null;
  const escrowTarget = BigInt(policy.budget.max_epochs) * BigInt(policy.budget.tranche_yocto);
  const escrowFunded = BigInt(commitment.escrow_funded_yocto);
  const operationsTarget = BigInt(policy.evaluator.execution_deposit_yocto);
  const operationsFunded = BigInt(commitment.operations_funded_yocto);
  const escrowReady = escrowFunded >= escrowTarget;
  const operationsReady = operationsFunded >= operationsTarget;
  const sponsorCanFund = accountId === policy.budget.sponsor;
  const canActivate = accountId === commitment.creator || accountId === commitment.maintainer || sponsorCanFund;
  const busy = busyAction !== null;

  return (
    <section className="content-card draft-setup">
      <div className="card-heading">
        <div><p className="eyebrow">DRAFT · REQUIRED BEFORE EVIDENCE</p><h3>Prepare this commitment</h3></div>
        <span className="card-index">SETUP</span>
      </div>
      <p className="draft-intro">Each step is a separate wallet transaction. The contract will not activate this commitment until its full escrow and one evaluator execution are funded.</p>
      <div className="setup-grid">
        <div className="setup-step">
          <div className="setup-step-title"><span className={escrowReady ? "setup-check ready" : "setup-check"}>{escrowReady ? "✓" : "1"}</span><div><strong>Fund commitment escrow</strong><small>{formatNear(escrowFunded)} / {formatNear(escrowTarget)} NEAR</small></div></div>
          <label htmlFor="escrow-funding">Amount to attach <span>NEAR</span></label>
          <div className="setup-input-row"><input id="escrow-funding" inputMode="decimal" value={escrowFundingNear} onChange={(event) => onEscrowFundingChange(event.target.value)} /><button onClick={() => void onAction("escrow")} disabled={busy || !sponsorCanFund}>{busyAction === "escrow" ? "Sending…" : !sponsorCanFund ? "Sponsor wallet required" : escrowReady ? "Add escrow" : "Fund escrow"}</button></div>
          <small className="setup-help">Target reserves {policy.budget.max_epochs} tranches at {formatNear(policy.budget.tranche_yocto)} NEAR each.</small>
        </div>
        <div className="setup-step">
          <div className="setup-step-title"><span className={operationsReady ? "setup-check ready" : "setup-check"}>{operationsReady ? "✓" : "2"}</span><div><strong>Fund evaluator operations</strong><small>{formatNear(operationsFunded)} / {formatNear(operationsTarget)} NEAR</small></div></div>
          <label htmlFor="operations-funding">Amount to attach <span>NEAR</span></label>
          <div className="setup-input-row"><input id="operations-funding" inputMode="decimal" value={operationsFundingNear} onChange={(event) => onOperationsFundingChange(event.target.value)} /><button onClick={() => void onAction("operations")} disabled={busy || !sponsorCanFund}>{busyAction === "operations" ? "Sending…" : !sponsorCanFund ? "Sponsor wallet required" : operationsReady ? "Add operations funds" : "Fund operations"}</button></div>
          <small className="setup-help">At least one evaluator execution deposit is required before activation.</small>
        </div>
        <div className="setup-step setup-step-activate">
          <div className="setup-step-title"><span className={escrowReady && operationsReady ? "setup-check ready" : "setup-check"}>{escrowReady && operationsReady ? "✓" : "3"}</span><div><strong>Activate the commitment</strong><small>{escrowReady && operationsReady ? "Funding requirements met" : "Waiting for both funding steps"}</small></div></div>
          <label htmlFor="activation-storage">Temporary storage deposit <span>NEAR</span></label>
          <div className="setup-input-row"><input id="activation-storage" inputMode="decimal" value={activationStorageNear} onChange={(event) => onActivationStorageChange(event.target.value)} /><button onClick={() => void onAction("activate")} disabled={busy || !escrowReady || !operationsReady || !canActivate}>{busyAction === "activate" ? "Sending…" : !canActivate ? "Authorized wallet required" : "Activate"}</button></div>
          <small className="setup-help">Excess storage deposit is refunded by the contract.</small>
        </div>
      </div>
    </section>
  );
}

interface CreationFields {
  subject: string;
  maintainer: string;
  arbiter: string;
  sponsor: string;
  beneficiary: string;
  maintainerPublicKey: string;
  wasmUrl: string;
  wasmSha256: string;
  initialWindowSeconds: string;
  evidenceTtlSeconds: string;
  graceSeconds: string;
  maxSourceLagSeconds: string;
  challengeWindowSeconds: string;
  resolutionTimeoutSeconds: string;
  recoveryAllowed: boolean;
  epochSeconds: string;
  maxEpochs: string;
  trancheNear: string;
  executionDepositNear: string;
  maxInstructions: string;
  maxMemoryMb: string;
  maxExecutionSeconds: string;
  requestTimeoutSeconds: string;
  storageDepositNear: string;
}

function CreateCommitmentForm({
  connectedAccountId,
  contractConfigured,
  busy,
  onCreate,
}: {
  connectedAccountId: string | null;
  contractConfigured: boolean;
  busy: boolean;
  onCreate: (args: CreateCommitmentArgs, storageDeposit: string) => Promise<void>;
}) {
  const [fields, setFields] = useState<CreationFields>({
    subject: "Open source service maintenance",
    maintainer: "",
    arbiter: "",
    sponsor: "",
    beneficiary: "",
    maintainerPublicKey: "",
    wasmUrl: "",
    wasmSha256: "",
    initialWindowSeconds: "60",
    evidenceTtlSeconds: "240",
    graceSeconds: "120",
    maxSourceLagSeconds: "30",
    challengeWindowSeconds: "60",
    resolutionTimeoutSeconds: "120",
    recoveryAllowed: true,
    epochSeconds: "300",
    maxEpochs: "3",
    trancheNear: "0.01",
    executionDepositNear: "0.01",
    maxInstructions: "1000000000",
    maxMemoryMb: "64",
    maxExecutionSeconds: "10",
    requestTimeoutSeconds: "30",
    storageDepositNear: DEFAULT_STORAGE_DEPOSIT,
  });
  const [formError, setFormError] = useState<string | null>(null);

  function update<K extends keyof CreationFields>(key: K, value: CreationFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      const args = buildCreateCommitmentArgs(fields, connectedAccountId);
      const storageDeposit = parseNearToYocto(fields.storageDepositNear);
      if (BigInt(storageDeposit) === 0n) throw new Error("Storage deposit must be greater than zero.");
      await onCreate(args, storageDeposit);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Check the commitment details and try again.");
    }
  }

  const escrowPreview = previewEscrow(fields.maxEpochs, fields.trancheNear);
  const account = (value: string) => value || connectedAccountId || "";

  return (
    <form className="creation-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="creation-intro"><p>Creation stores an immutable policy and makes a Draft. Funding and activation are separate transactions below.</p><span>TESTNET ONLY · NO SAMPLE POLICY</span></div>
      <div className="creation-section-heading"><span>01</span><div><strong>People &amp; promise</strong><small>Who commits, funds, arbitrates, and receives support.</small></div></div>
      <div className="form-grid">
        <FormField label="Commitment subject" wide><input maxLength={128} value={fields.subject} onChange={(event) => update("subject", event.target.value)} placeholder="e.g. Maintain the community API" required /></FormField>
        <FormField label="Maintainer account"><input value={account(fields.maintainer)} onChange={(event) => update("maintainer", event.target.value)} placeholder="maintainer.testnet" required /></FormField>
        <FormField label="Arbiter account"><input value={account(fields.arbiter)} onChange={(event) => update("arbiter", event.target.value)} placeholder="arbiter.testnet" required /></FormField>
        <FormField label="Sponsor account"><input value={account(fields.sponsor)} onChange={(event) => update("sponsor", event.target.value)} placeholder="sponsor.testnet" required /></FormField>
        <FormField label="Beneficiary account"><input value={account(fields.beneficiary)} onChange={(event) => update("beneficiary", event.target.value)} placeholder="beneficiary.testnet" required /></FormField>
      </div>

      <div className="creation-section-heading"><span>02</span><div><strong>Evidence &amp; evaluator</strong><small>Pin the maintainer’s public key and the exact evaluator artifact.</small></div></div>
      <div className="form-grid">
        <FormField label="Maintainer Ed25519 public key · 64 lowercase hex" wide><input className="mono-input" value={fields.maintainerPublicKey} onChange={(event) => update("maintainerPublicKey", event.target.value)} placeholder="Public key only — never enter a private key" required /></FormField>
        <FormField label="Evaluator WASM HTTPS URL" wide><input value={fields.wasmUrl} onChange={(event) => update("wasmUrl", event.target.value)} placeholder="https://…/maintenance-heartbeat.wasm" required /></FormField>
        <FormField label="Evaluator WASM SHA-256 · 64 lowercase hex" wide><input className="mono-input" value={fields.wasmSha256} onChange={(event) => update("wasmSha256", event.target.value)} placeholder="Digest of the exact uploaded WASM file" required /></FormField>
      </div>

      <div className="creation-section-heading"><span>03</span><div><strong>Time &amp; consequence</strong><small>Short windows suit a testnet walkthrough. NEAR block time governs the real state.</small></div></div>
      <div className="form-grid form-grid-3">
        <FormField label="Initial evidence window · sec"><input type="number" min="1" step="1" value={fields.initialWindowSeconds} onChange={(event) => update("initialWindowSeconds", event.target.value)} required /></FormField>
        <FormField label="Evidence freshness TTL · sec"><input type="number" min="1" step="1" value={fields.evidenceTtlSeconds} onChange={(event) => update("evidenceTtlSeconds", event.target.value)} required /></FormField>
        <FormField label="Grace period · sec"><input type="number" min="1" step="1" value={fields.graceSeconds} onChange={(event) => update("graceSeconds", event.target.value)} required /></FormField>
        <FormField label="Max source lag · sec"><input type="number" min="1" step="1" value={fields.maxSourceLagSeconds} onChange={(event) => update("maxSourceLagSeconds", event.target.value)} required /></FormField>
        <FormField label="Challenge window · sec"><input type="number" min="1" step="1" value={fields.challengeWindowSeconds} onChange={(event) => update("challengeWindowSeconds", event.target.value)} required /></FormField>
        <FormField label="Resolution timeout · sec"><input type="number" min="1" step="1" value={fields.resolutionTimeoutSeconds} onChange={(event) => update("resolutionTimeoutSeconds", event.target.value)} required /></FormField>
        <FormField label="Budget epoch · sec"><input type="number" min="1" step="1" value={fields.epochSeconds} onChange={(event) => update("epochSeconds", event.target.value)} required /></FormField>
        <FormField label="Maximum epochs · 1–64"><input type="number" min="1" max="64" step="1" value={fields.maxEpochs} onChange={(event) => update("maxEpochs", event.target.value)} required /></FormField>
        <FormField label="Tranche per epoch · NEAR"><input inputMode="decimal" value={fields.trancheNear} onChange={(event) => update("trancheNear", event.target.value)} required /></FormField>
        <label className="recovery-toggle"><input type="checkbox" checked={fields.recoveryAllowed} onChange={(event) => update("recoveryAllowed", event.target.checked)} /><span><strong>Allow recovery</strong><small>A fresh compliant evaluation may restore future eligibility.</small></span></label>
      </div>

      <div className="creation-section-heading"><span>04</span><div><strong>OutLayer execution limits</strong><small>Configure the testnet evaluator account and execution budget.</small></div></div>
      <div className="form-grid form-grid-3">
        <FormField label="OutLayer account"><select value="outlayer.testnet" disabled><option value="outlayer.testnet">outlayer.testnet</option></select></FormField>
        <FormField label="Build target"><select value="wasm32-wasip2" disabled><option value="wasm32-wasip2">wasm32-wasip2</option></select></FormField>
        <FormField label="Execution deposit · NEAR"><input inputMode="decimal" value={fields.executionDepositNear} onChange={(event) => update("executionDepositNear", event.target.value)} required /></FormField>
        <FormField label="Maximum instructions"><input inputMode="numeric" value={fields.maxInstructions} onChange={(event) => update("maxInstructions", event.target.value)} required /></FormField>
        <FormField label="Memory limit · MB"><input type="number" min="1" max="4096" step="1" value={fields.maxMemoryMb} onChange={(event) => update("maxMemoryMb", event.target.value)} required /></FormField>
        <FormField label="Execution limit · sec"><input type="number" min="1" max="180" step="1" value={fields.maxExecutionSeconds} onChange={(event) => update("maxExecutionSeconds", event.target.value)} required /></FormField>
        <FormField label="Request timeout · sec"><input type="number" min="1" step="1" value={fields.requestTimeoutSeconds} onChange={(event) => update("requestTimeoutSeconds", event.target.value)} required /></FormField>
        <FormField label="Create storage deposit · NEAR"><input inputMode="decimal" value={fields.storageDepositNear} onChange={(event) => update("storageDepositNear", event.target.value)} required /></FormField>
      </div>

      <div className="creation-summary"><span>FULL ESCROW TARGET</span><strong>{escrowPreview} NEAR</strong><small>Calculated from max epochs × tranche size; fund this separately after creation.</small></div>
      {formError && <div className="notice notice-error form-notice" role="alert"><span className="notice-icon">!</span>{formError}</div>}
      {!connectedAccountId && <p className="form-wallet-hint">Connect a testnet wallet to create the draft. Your wallet account becomes the on-chain creator.</p>}
      {!contractConfigured && <p className="form-wallet-hint">Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/demo/.env.local before creating.</p>}
      <div className="creation-submit-row"><p>Storage bond excess is refunded. The evaluator URL and digest should refer to the same uploaded WASM artifact.</p><button className="lookup-button" type="submit" disabled={busy || !connectedAccountId || !contractConfigured}>{busy ? <><span className="spinner" />Creating draft</> : <>Create draft <span aria-hidden="true">↗</span></>}</button></div>
    </form>
  );
}

function FormField({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`form-field ${wide ? "form-field-wide" : ""}`}><span>{label}</span>{children}</label>;
}

function buildCreateCommitmentArgs(fields: CreationFields, connectedAccountId: string | null): CreateCommitmentArgs {
  const subject = fields.subject.trim();
  if (!subject || subject.length > 128 || !/^[\x20-\x7e]+$/.test(subject)) {
    throw new Error("Subject must be non-empty printable ASCII and no longer than 128 characters.");
  }
  if (!/^[0-9a-f]{64}$/.test(fields.maintainerPublicKey)) {
    throw new Error("Enter the maintainer's 32-byte Ed25519 public key as 64 lowercase hexadecimal characters.");
  }
  if (!/^[0-9a-f]{64}$/.test(fields.wasmSha256)) {
    throw new Error("Enter the evaluator WASM SHA-256 digest as 64 lowercase hexadecimal characters.");
  }
  if (new TextEncoder().encode(fields.wasmUrl).length > 512 || !fields.wasmUrl.startsWith("https://")) {
    throw new Error("Evaluator WASM URL must use HTTPS and be no longer than 512 characters.");
  }
  try {
    new URL(fields.wasmUrl);
  } catch {
    throw new Error("Enter a valid HTTPS URL for the evaluator WASM file.");
  }

  const initialWindow = secondsToNanoseconds(fields.initialWindowSeconds, "Initial evidence window");
  const evidenceTtl = secondsToNanoseconds(fields.evidenceTtlSeconds, "Evidence freshness TTL");
  const grace = secondsToNanoseconds(fields.graceSeconds, "Grace period");
  const maxSourceLag = secondsToNanoseconds(fields.maxSourceLagSeconds, "Maximum source lag");
  const challengeWindow = secondsToNanoseconds(fields.challengeWindowSeconds, "Challenge window");
  const resolutionTimeout = secondsToNanoseconds(fields.resolutionTimeoutSeconds, "Resolution timeout");
  const epoch = secondsToNanoseconds(fields.epochSeconds, "Budget epoch");
  if (BigInt(challengeWindow) >= BigInt(evidenceTtl)) throw new Error("Challenge window must be shorter than evidence TTL.");
  if (BigInt(maxSourceLag) + BigInt(challengeWindow) >= BigInt(evidenceTtl)) {
    throw new Error("Evidence TTL must exceed maximum source lag plus the challenge window.");
  }
  const maximumU64 = 0xffff_ffff_ffff_ffffn;
  if (BigInt(initialWindow) + BigInt(grace) > maximumU64 || BigInt(evidenceTtl) + BigInt(grace) > maximumU64) {
    throw new Error("Evidence windows and grace period exceed the supported timestamp range.");
  }
  const executionSeconds = integerString(fields.maxExecutionSeconds, "Maximum execution time", 1, 180);
  const requestTimeoutSeconds = integerString(fields.requestTimeoutSeconds, "Request timeout", 1, 180);
  if (BigInt(requestTimeoutSeconds) < BigInt(executionSeconds)) {
    throw new Error("Request timeout must cover the maximum execution time.");
  }
  const maxInstructions = integerString(fields.maxInstructions, "Maximum instructions", 1, 500_000_000_000);
  const maxMemoryMb = Number(integerString(fields.maxMemoryMb, "Memory limit", 1, 4096));
  const maxEpochs = Number(integerString(fields.maxEpochs, "Maximum epochs", 1, 64));
  const trancheYocto = parseNearToYocto(fields.trancheNear);
  const executionDepositYocto = parseNearToYocto(fields.executionDepositNear);
  if (BigInt(trancheYocto) === 0n) throw new Error("Tranche amount must be greater than zero.");
  if (BigInt(executionDepositYocto) === 0n) throw new Error("Evaluator execution deposit must be greater than zero.");
  if (BigInt(trancheYocto) * BigInt(maxEpochs) > 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn) {
    throw new Error("Total escrow target exceeds the supported 128-bit amount range.");
  }

  const maintainer = fields.maintainer.trim() || connectedAccountId || "";
  const arbiter = fields.arbiter.trim() || connectedAccountId || "";
  const sponsor = fields.sponsor.trim() || connectedAccountId || "";
  const beneficiary = fields.beneficiary.trim() || connectedAccountId || "";
  if (![maintainer, arbiter, sponsor, beneficiary].every(Boolean)) {
    throw new Error("Connect a wallet or enter all commitment account IDs.");
  }
  for (const account of [maintainer, arbiter, sponsor, beneficiary]) {
    if (account.length < 2 || account.length > 64 || !/^(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*|[a-f0-9]{64})$/.test(account)) {
      throw new Error(`Invalid NEAR account ID: ${account}`);
    }
  }

  return {
    subject,
    maintainer,
    arbiter,
    policy: {
      temporal: {
        initial_window_ns: initialWindow,
        evidence_ttl_ns: evidenceTtl,
        grace_ns: grace,
        max_source_lag_ns: maxSourceLag,
        challenge_window_ns: challengeWindow,
        resolution_timeout_ns: resolutionTimeout,
        recovery_allowed: fields.recoveryAllowed,
      },
      evidence: { maintainer_public_key_hex: fields.maintainerPublicKey },
      evaluator: {
        outlayer_account: "outlayer.testnet",
        wasm_url: fields.wasmUrl,
        wasm_sha256_hex: fields.wasmSha256,
        build_target: "wasm32-wasip2",
        max_instructions: maxInstructions,
        max_memory_mb: maxMemoryMb,
        max_execution_seconds: executionSeconds,
        request_timeout_ns: (BigInt(requestTimeoutSeconds) * 1_000_000_000n).toString(),
        execution_deposit_yocto: executionDepositYocto,
      },
      budget: {
        sponsor,
        beneficiary,
        epoch_ns: epoch,
        max_epochs: maxEpochs,
        tranche_yocto: trancheYocto,
      },
    },
  };
}

function secondsToNanoseconds(value: string, label: string): string {
  const seconds = integerString(value, label, 1, Number.MAX_SAFE_INTEGER);
  const nanoseconds = BigInt(seconds) * 1_000_000_000n;
  if (nanoseconds > 0xffff_ffff_ffff_ffffn) throw new Error(`${label} is too large.`);
  return nanoseconds.toString();
}

function integerString(value: string, label: string, minimum: number, maximum: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be a whole number.`);
  const parsed = BigInt(value);
  if (parsed < BigInt(minimum) || parsed > BigInt(maximum)) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function previewEscrow(maxEpochs: string, trancheNear: string): string {
  try {
    const epochs = BigInt(maxEpochs);
    return formatNear(epochs * BigInt(parseNearToYocto(trancheNear)));
  } catch {
    return "—";
  }
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

async function getFinalBlockTimestampNs(rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "lcp-heartbeat-time",
      method: "block",
      params: { finality: "final" },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status} while reading block time.`);
  const result: unknown = await response.json();
  if (!isRecord(result)) throw new Error("NEAR RPC returned an invalid block response.");
  if ("error" in result) throw new Error(`NEAR RPC block query failed: ${JSON.stringify(result.error)}`);
  if (!isRecord(result.result) || !isRecord(result.result.header)) {
    throw new Error("NEAR RPC block response is missing its finalized header.");
  }
  const timestamp = result.result.header.timestamp_nanosec;
  if (typeof timestamp !== "string" || !/^(0|[1-9][0-9]*)$/.test(timestamp)) {
    throw new Error("NEAR RPC returned an invalid finalized block timestamp.");
  }
  return timestamp;
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
  const yocto = `${match[1]}${fraction}`.replace(/^0+(?=[0-9])/, "");
  if (BigInt(yocto) > 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn) {
    throw new Error("NEAR amount exceeds the supported 128-bit range.");
  }
  return yocto;
}

function formatNear(yocto: string | bigint): string {
  const value = typeof yocto === "bigint" ? yocto : BigInt(yocto);
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

function formatCountdown(nanoseconds: string): string {
  const totalSeconds = (BigInt(nanoseconds) + 999_999_999n) / 1_000_000_000n;
  if (totalSeconds < 60n) return `${totalSeconds} sec`;
  const totalMinutes = (totalSeconds + 59n) / 60n;
  if (totalMinutes < 60n) return `${totalMinutes} min`;
  const totalHours = (totalMinutes + 59n) / 60n;
  if (totalHours < 48n) return `${totalHours} hr`;
  const totalDays = (totalHours + 23n) / 24n;
  return `${totalDays} days`;
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

function EvaluationProofReference({ transactionHashHex }: { transactionHashHex: string | null }) {
  if (!transactionHashHex) return null;
  const transactionHash = transactionHashToBase58(transactionHashHex);
  if (!transactionHash) return null;

  return (
    <div className="evaluation-proof">
      <div className="evaluation-proof-links">
        <a href={`https://${NEAR_NETWORK_ID === "testnet" ? "testnet." : ""}nearblocks.io/txns/${transactionHash}`} target="_blank" rel="noreferrer">
          NEAR transaction ↗
        </a>
        <a href="https://app.outlayer.ai/docs/trust-verification" target="_blank" rel="noreferrer">
          OutLayer verification guide ↗
        </a>
      </div>
      <code>outlayer-verify tx {transactionHash} --network {NEAR_NETWORK_ID}</code>
    </div>
  );
}

function transactionHashToBase58(hashHex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){32}$/i.test(hashHex)) return null;

  let leadingZeroBytes = 0;
  while (hashHex.slice(leadingZeroBytes * 2, leadingZeroBytes * 2 + 2) === "00") {
    leadingZeroBytes += 1;
  }

  let value = BigInt(`0x${hashHex.slice(leadingZeroBytes * 2) || "0"}`);
  let encoded = "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = alphabet[digit] + encoded;
    value /= 58n;
  }
  return `${"1".repeat(leadingZeroBytes)}${encoded}`;
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
    case "AwaitingEvidence": return "No qualifying evidence has been accepted yet; the initial evidence window is still open.";
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
