"use client";

import {
  buildHeartbeatSigningPayload,
  createRandomNonceHex,
  createNep413HeartbeatEvidence,
  LcpClient,
  NearJsonRpcTransport,
  nearPublicKeyFingerprintHex,
  requestNearJsonRpc,
  validateServiceAvailabilityPolicyInput,
} from "@lcp/sdk";
import type {
  BoundedPayoutAuthorityGrantView,
  ChallengeView,
  ClaimEligibilityView,
  CommitmentSummaryView,
  CreateCommitmentArgs,
  CreateServiceAvailabilityCommitmentArgs,
  HeartbeatSigningInput,
  CommitmentPolicyView,
  CommitmentView,
  EvaluationRecordView,
  EscrowStatusView,
  NearTransactionRequest,
  NearTransactionSender,
  NearEd25519PublicKey,
  NearSignedMessage,
  Nep413ProbeSignature,
  LcpEvent,
  SignedHeartbeatEvidence,
  SignedProbeReport,
  ServiceProbeReport,
  ServiceAvailabilityPolicyInput,
  ServiceReportInboxView,
  ServicePolicyAmendmentView,
  ServiceAvailabilitySourceInput,
  TrancheView,
} from "@lcp/sdk";
import { ReviewerAccessPanel } from "./reviewer-access-panel";
import { AuthorityAdapterCard, ServicePolicyAmendmentCard } from "./governance-panels";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

type WalletAction =
  | {
      type: "FunctionCall";
      params: {
        methodName: string;
        args: Record<string, unknown>;
        gas: string;
        deposit: string;
      };
    }
  | { type: "DeployContract"; params: { code: Uint8Array } };

interface NearWalletPort {
  signAndSendTransaction(input: {
    receiverId: string;
    actions: WalletAction[];
  }): Promise<unknown>;
  signMessage?(input: { message: string; recipient: string; nonce: Uint8Array; callbackUrl?: string; network?: "mainnet" | "testnet" }): Promise<NearSignedMessage | void>;
}

interface ConnectorAccountEvent {
  accounts: Array<{ accountId: string }>;
}

interface NearConnectorPort {
  whenManifestLoaded?: Promise<void>;
  on(event: "wallet:signIn", handler: (event: ConnectorAccountEvent) => void): unknown;
  on(event: "wallet:signOut", handler: () => void): unknown;
  getConnectedWallet(): Promise<{ wallet: unknown; accounts: Array<{ accountId: string }> }>;
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  wallet(): Promise<NearWalletPort>;
}

interface CommitmentData {
  commitment: CommitmentView;
  policy: CommitmentPolicyView | null;
  serviceAvailabilityPolicy: ServiceAvailabilityPolicyInput | null;
  serviceReportInbox: ServiceReportInboxView[];
  serviceReportInboxAvailable: boolean;
  serviceReportRefundBalance: string;
  servicePolicyAmendment: ServicePolicyAmendmentView | null;
  latestAuthorityGrant: BoundedPayoutAuthorityGrantView | null;
  governanceMethodsAvailable: boolean;
  chainTimeNs: string | null;
  chainTimeCapturedAtMs: number;
  evaluation: EvaluationRecordView | null;
  evaluationHistory: EvaluationRecordView[];
  evaluationTimeoutNs: string | null;
  challenge: ChallengeView | null;
  challengeHistory: ChallengeView[];
  eligibility: ClaimEligibilityView | null;
  escrow: EscrowStatusView | null;
  epoch: string | null;
  tranche: TrancheView | null;
}

type SetupAction = "escrow" | "operations" | "activate";
type ChallengeAction = "open" | "uphold" | "invalidate" | "expire";
type ClosureAction = "close" | "refund";

const CONTRACT_ID = process.env.NEXT_PUBLIC_LCP_CONTRACT_ID?.trim() ?? "";
const NEAR_NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK_ID?.trim() === "mainnet" ? "mainnet" : "testnet";
const DEFAULT_RPC_URLS = NEAR_NETWORK_ID === "mainnet"
  ? ["https://free.rpc.fastnear.com", "https://near.drpc.org", "https://rpc.intea.rs"]
  : ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org", "https://testnet-rpc.intea.rs"];
const RPC_FALLBACK_URLS = (process.env.NEXT_PUBLIC_NEAR_RPC_FALLBACK_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const RPC_URL = [...new Set([
  process.env.NEXT_PUBLIC_NEAR_RPC_URL?.trim() || DEFAULT_RPC_URLS[0],
  ...RPC_FALLBACK_URLS,
  ...DEFAULT_RPC_URLS.slice(1),
])];
const EVENT_INDEXER_URL = process.env.NEXT_PUBLIC_LCP_EVENT_INDEXER_URL?.trim().replace(/\/+$/, "") ?? "";
const DEFAULT_STORAGE_DEPOSIT = "0.01";
const DEFAULT_SERVICE_COMMITMENT_STORAGE_DEPOSIT = "0.05";
const DEFAULT_EVALUATION_STORAGE_DEPOSIT = "0.05";
const MAX_EVIDENCE_ARTIFACT_BYTES = 25 * 1024 * 1024;
const EVALUATION_HISTORY_LIMIT = 10;
const COMMITMENT_PAGE_SIZE = 10;
const THEME_STORAGE_KEY = "lcp-color-theme";

type ColorTheme = "light" | "dark";

export function Dashboard() {
  const connectorRef = useRef<NearConnectorPort | null>(null);
  const connectorInitRef = useRef<Promise<NearConnectorPort> | null>(null);
  const [theme, setTheme] = useState<ColorTheme | null>(null);
  const [commitmentId, setCommitmentId] = useState("");
  const [commitments, setCommitments] = useState<CommitmentSummaryView[]>([]);
  const [commitmentsVisible, setCommitmentsVisible] = useState(false);
  const [commitmentCursor, setCommitmentCursor] = useState<string | null>(null);
  const [hasMoreCommitments, setHasMoreCommitments] = useState(false);
  const [loadingCommitments, setLoadingCommitments] = useState(false);
  const [data, setData] = useState<CommitmentData | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletRestoring, setWalletRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [requestingEvaluation, setRequestingEvaluation] = useState(false);
  const [serviceInboxAction, setServiceInboxAction] = useState<"submit" | "refund" | "reclaim" | null>(null);
  const [expiringEvaluation, setExpiringEvaluation] = useState(false);
  const [challengeAction, setChallengeAction] = useState<ChallengeAction | null>(null);
  const [closureAction, setClosureAction] = useState<ClosureAction | null>(null);
  const [setupAction, setSetupAction] = useState<SetupAction | null>(null);
  const [escrowFundingNear, setEscrowFundingNear] = useState("0.03");
  const [operationsFundingNear, setOperationsFundingNear] = useState("0.01");
  const [activationStorageNear, setActivationStorageNear] = useState(DEFAULT_STORAGE_DEPOSIT);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const ensureConnector = useCallback(async (): Promise<NearConnectorPort> => {
    if (connectorRef.current) return connectorRef.current;
    if (connectorInitRef.current) return connectorInitRef.current;

    const initialization = (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const connector = new NearConnector({
        network: NEAR_NETWORK_ID,
        features: { testnet: NEAR_NETWORK_ID === "testnet" },
      }) as unknown as NearConnectorPort;
      connector.on("wallet:signIn", (event) => setAccountId(event.accounts[0]?.accountId ?? null));
      connector.on("wallet:signOut", () => setAccountId(null));
      await connector.whenManifestLoaded?.catch(() => undefined);
      connectorRef.current = connector;
      return connector;
    })();
    connectorInitRef.current = initialization;
    try {
      return await initialization;
    } catch (cause) {
      connectorInitRef.current = null;
      throw cause;
    }
  }, []);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const connector = await ensureConnector();
        const { accounts } = await connector.getConnectedWallet();
        if (active) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // A missing persisted wallet is the normal disconnected state.
      } finally {
        if (active) setWalletRestoring(false);
      }
    })();
    return () => { active = false; };
  }, [ensureConnector]);

  function toggleTheme() {
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const nextTheme: ColorTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for this session if storage is unavailable.
    }
    setTheme(nextTheme);
  }

  async function loadCommitmentPage(beforeId: string | null, append: boolean) {
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/console/.env.local to browse commitments.");
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
    const keepCurrentData = data?.commitment.id === normalizedId;
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/console/.env.local to connect the LCP Console to a deployed contract.");
      return false;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(normalizedId)) {
      setError("Enter a commitment ID as a whole number, such as 1.");
      return false;
    }

    setCommitmentId(normalizedId);
    setLoading(true);
    if (!keepCurrentData) setData(null);
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
      const chainTimeSnapshotPromise = getFinalBlockTimestampNs(RPC_URL)
        .then((chainTimeNs) => ({ chainTimeNs, capturedAtMs: Date.now() }))
        .catch(() => ({ chainTimeNs: null, capturedAtMs: Date.now() }));
      const [commitment, policy, evaluation, eligibility, escrow, epoch, chainTimeSnapshot] = await Promise.all([
        client.getCommitment(normalizedId),
        client.getPolicy(normalizedId),
        client.getLatestEvaluation(normalizedId),
        client.canClaimTranche(normalizedId),
        client.getEscrowStatus(normalizedId),
        client.getCurrentEpoch(normalizedId),
        chainTimeSnapshotPromise,
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
      const amendmentViewPromise = policy?.version === 3
        ? client.getLatestServicePolicyAmendment(normalizedId).then((value) => ({ value, available: true }), () => ({ value: null, available: false }))
        : Promise.resolve({ value: null, available: true });
      const authorityViewPromise = client.getLatestBoundedPayoutAuthorityGrant(normalizedId)
        .then((value) => ({ value, available: true }), () => ({ value: null, available: false }));
      const [evaluationHistory, challengeHistory, evaluationTimeoutNs, activeChallenge, tranche, serviceAvailabilityPolicy, reportInboxState, serviceReportRefundBalance, amendmentView, authorityView] = await Promise.all([
        Promise.all(evaluationIds.map((evaluationId) => client.getEvaluation(normalizedId, evaluationId)))
          .then((records) => records.filter((record): record is EvaluationRecordView => record !== null)),
        Promise.all(evaluationIds.map((evaluationId) => client.getChallengeForEvaluation(normalizedId, evaluationId)))
          .then((challenges) => challenges.filter((challenge): challenge is ChallengeView => challenge !== null)),
        commitment.pending_evaluation_id
          ? client.getEvaluationTimeout(normalizedId, commitment.pending_evaluation_id)
          : Promise.resolve(null),
        commitment.active_challenge_id
          ? client.getChallenge(commitment.active_challenge_id)
          : Promise.resolve(null),
        epoch ? client.getTranche(normalizedId, epoch) : Promise.resolve(null),
        policy?.version === 3 ? client.getServiceAvailabilityPolicy(normalizedId) : Promise.resolve(null),
        policy?.version === 3
          ? client.getServiceReportInbox(normalizedId, commitment.next_evaluation_id)
            .then((value) => ({ value, available: true as const }), () => ({ value: [], available: false as const }))
          : Promise.resolve({ value: [], available: false as const }),
        accountId && policy?.version === 3
          ? client.getServiceReportRefundBalance(accountId).catch(() => "0")
          : Promise.resolve("0"),
        amendmentViewPromise,
        authorityViewPromise,
      ]);
      const servicePolicyAmendment = amendmentView.value;
      const latestAuthorityGrant = authorityView.value;
      const serviceReportInbox = reportInboxState.value;
      const allChallengeHistory = [...challengeHistory];
      if (activeChallenge && !allChallengeHistory.some((challenge) => challenge.id === activeChallenge.id)) {
        allChallengeHistory.push(activeChallenge);
      }
      const challenge = activeChallenge ?? allChallengeHistory.find((item) => item.evaluation_id === evaluation?.evaluation_id) ?? null;
      setData({ commitment, policy, serviceAvailabilityPolicy, serviceReportInbox, serviceReportInboxAvailable: reportInboxState.available, serviceReportRefundBalance, servicePolicyAmendment, latestAuthorityGrant, governanceMethodsAvailable: amendmentView.available && authorityView.available, chainTimeNs: chainTimeSnapshot.chainTimeNs, chainTimeCapturedAtMs: chainTimeSnapshot.capturedAtMs, evaluation, evaluationHistory, evaluationTimeoutNs, challenge, challengeHistory: allChallengeHistory, eligibility, escrow, epoch, tranche });
      return true;
    } catch (cause) {
      if (!keepCurrentData) setData(null);
      setError(cause instanceof Error ? cause.message : "The commitment could not be loaded.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!accountId || !data?.commitment.id) return;
    void loadCommitment(data.commitment.id);
  }, [accountId, data?.commitment.id]);

  function connectedWalletClient(): LcpClient {
    const connector = connectorRef.current;
    if (!connector || !accountId) throw new Error("Connect the NEAR account authorized for this action.");
    return new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
      rpcUrl: RPC_URL,
      sendTransaction: createWalletSender(connector),
    }));
  }

  function readClient(): LcpClient {
    return new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
  }

  async function connectWallet() {
    setConnecting(true);
    setError(null);
    try {
      const connector = await ensureConnector();
      await connector.whenManifestLoaded?.catch(() => undefined);
      await connector.connect();
      const { accounts } = await connector.getConnectedWallet();
      setAccountId(accounts[0]?.accountId ?? null);
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

  async function signWalletMessage(message: string, nonce: Uint8Array, recipient: string, callbackUrl: string): Promise<NearSignedMessage> {
    const connector = connectorRef.current;
    if (!connector) throw new Error("Connect a NEAR wallet before requesting a message signature.");
    const wallet = await connector.wallet();
    if (!wallet.signMessage) {
      throw new Error("This connected wallet does not expose NEP-413 message signing. Choose a NEAR wallet that supports signMessage.");
    }
    const signed = await wallet.signMessage({ message, nonce, recipient, callbackUrl, network: NEAR_NETWORK_ID });
    if (!signed) {
      throw new Error("The wallet did not return a signed message in this browser session. Reconnect with a wallet that returns NEP-413 signatures directly.");
    }
    return signed;
  }

  async function pinMaintainerKey(targetAccountId: string): Promise<{
    accountId: string;
    publicKey: NearEd25519PublicKey;
    fingerprint: string;
  }> {
    if (!CONTRACT_ID) throw new Error("Set NEXT_PUBLIC_LCP_CONTRACT_ID before pinning a maintainer key.");
    const intendedAccount = targetAccountId.trim() || accountId || "";
    if (!intendedAccount) throw new Error("Enter the maintainer account or connect that account's wallet first.");
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const callbackUrl = window.location.origin;
    const signed = await signWalletMessage(
      `Pin this NEAR key for Living Commitments Protocol maintainer ${intendedAccount}.`,
      nonce,
      CONTRACT_ID,
      callbackUrl,
    );
    if (signed.accountId !== intendedAccount) {
      throw new Error(`The wallet signed as ${signed.accountId}; connect the maintainer account ${intendedAccount} to pin its key.`);
    }
    const fingerprint = await nearPublicKeyFingerprintHex(signed.publicKey);
    return {
      accountId: signed.accountId,
      publicKey: signed.publicKey as NearEd25519PublicKey,
      fingerprint,
    };
  }

  async function deployBoundedPayoutAdapter(
    adapterAccountId: string,
    resourceAccountId: string,
    poolManagerAccountId: string,
    code: Uint8Array,
  ) {
    if (NEAR_NETWORK_ID !== "testnet") throw new Error("The adapter deployment helper is restricted to NEAR testnet.");
    if (!CONTRACT_ID) throw new Error("The LCP contract account is not configured.");
    if (accountId !== adapterAccountId) throw new Error(`Connect ${adapterAccountId} to deploy code to that account.`);
    const account = await requestNearJsonRpc(RPC_URL, "query", {
      request_type: "view_account",
      finality: "final",
      account_id: adapterAccountId,
    });
    if (!isRecord(account) || account.code_hash !== "11111111111111111111111111111111") {
      throw new Error("This account already has deployed code. Refusing to replace it with the adapter.");
    }
    const connector = connectorRef.current;
    if (!connector) throw new Error("Connect the adapter account wallet first.");
    const wallet = await connector.wallet();
    const outcome = await wallet.signAndSendTransaction({
      receiverId: adapterAccountId,
      actions: [
        { type: "DeployContract", params: { code } },
        {
          type: "FunctionCall",
          params: {
            methodName: "new",
            args: {
              lcp_contract_id: CONTRACT_ID,
              resource_account: resourceAccountId,
              pool_manager: poolManagerAccountId,
            },
            gas: "100000000000000",
            deposit: "0",
          },
        },
      ],
    });
    decodeTransactionOutcome(outcome);
  }

  async function createCommitment(
    args: CreateCommitmentArgs | CreateServiceAvailabilityCommitmentArgs,
    storageDeposit: string,
  ) {
    if (!CONTRACT_ID) {
      setError("Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/console/.env.local before creating a commitment.");
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
      const client = new LcpClient(CONTRACT_ID, transport);
      const options = { attachedDepositYocto: storageDeposit, gas: "150000000000000" };
      const newId = "service_availability" in args
        ? await client.createServiceAvailabilityCommitment(args, options)
        : await client.createCommitment(args, options);
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

  async function submitSetupAction(action: SetupAction) {
    if (!data) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect a testnet wallet before funding or activating this commitment.");
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

    setSetupAction(action);
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
      setError(cause instanceof Error ? cause.message : "The commitment funding or activation action could not be completed.");
    } finally {
      setSetupAction(null);
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

  async function submitServiceEvaluation(reports: SignedProbeReport[] | null, storageDeposit: string) {
    if (!data) return;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the maintainer or sponsor wallet before requesting an evaluation.");
      return;
    }
    if (!data.policy || (accountId !== data.commitment.maintainer && accountId !== data.policy.budget.sponsor)) {
      setError(`Only ${data.commitment.maintainer} or ${data.policy?.budget.sponsor ?? "the configured sponsor"} can request evaluation.`);
      return;
    }

    setRequestingEvaluation(true);
    setError(null);
    setActionMessage(null);
    const readClient = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
    try {
      const current = await readClient.getCommitment(data.commitment.id);
      if (!current) throw new Error(`Commitment #${data.commitment.id} could not be read from NEAR.`);
      if (current.pending_evaluation_id) {
        await loadCommitment(data.commitment.id);
        setError(`Evaluation #${current.pending_evaluation_id} is already pending. Wait for its result; no new transaction was sent.`);
        return;
      }
      if (current.active_challenge_id) {
        await loadCommitment(data.commitment.id);
        setError(`Resolve challenge #${current.active_challenge_id} before requesting another evaluation. No transaction was sent.`);
        return;
      }
      const operationsAvailable = BigInt(current.operations_funded_yocto) - BigInt(current.operations_authorized_spend_yocto);
      const executionDeposit = BigInt(data.policy.evaluator.execution_deposit_yocto);
      if (operationsAvailable < executionDeposit) {
        await loadCommitment(data.commitment.id);
        setError(`Evaluator operations are exhausted. This request needs ${formatNear(executionDeposit - operationsAvailable)} NEAR; the sponsor must add funds before another evaluation.`);
        return;
      }
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      const evaluationId = reports
        ? await client.requestServiceEvaluation(data.commitment.id, reports, {
          attachedDepositYocto: storageDeposit,
          gas: "180000000000000",
        })
        : await client.requestServiceEvaluationFromInbox(data.commitment.id, {
          attachedDepositYocto: storageDeposit,
          gas: "180000000000000",
        });
      const loaded = await loadCommitment(data.commitment.id);
      const reportCount = reports?.length ?? data.serviceReportInbox.filter((item) => !item.expired).length;
      const reportAuthentication = data.serviceAvailabilityPolicy?.schema === "lcp.service_availability.policy.v2"
        ? "NEAR wallet-authenticated source report"
        : "signed source report";
      setActionMessage(loaded
        ? `Evaluation #${evaluationId} requested from ${reportCount} ${reportAuthentication}${reportCount === 1 ? "" : "s"}.`
        : `Evaluation request #${evaluationId} returned successfully. Reload commitment #${data.commitment.id} to verify its state.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The service availability evaluation request failed.";
      let current: CommitmentView | null = null;
      try {
        current = await readClient.getCommitment(data.commitment.id);
      } catch {
        // Keep the wallet error if the follow-up state read also fails.
      }
      await loadCommitment(data.commitment.id);
      if (current?.pending_evaluation_id) {
        setError(`Evaluation #${current.pending_evaluation_id} is pending on NEAR. Do not resubmit; wait for the evaluator result or refresh its status.`);
      } else if (current && BigInt(current.operations_funded_yocto) - BigInt(current.operations_authorized_spend_yocto) < BigInt(data.policy.evaluator.execution_deposit_yocto)) {
        const available = BigInt(current.operations_funded_yocto) - BigInt(current.operations_authorized_spend_yocto);
        const required = BigInt(data.policy.evaluator.execution_deposit_yocto);
        setError(`No evaluator operations remain. The sponsor must add at least ${formatNear(required - available)} NEAR before another request.`);
      } else if (/reject|cancel/i.test(message)) {
        setError("The wallet request was cancelled. No evaluation was started.");
      } else if (/WebAssembly trap|unreachable opcode/i.test(message)) {
        setError("The contract rejected this request. Commitment state was refreshed; check the pending evaluation and operations balance before trying again.");
      } else {
        setError(message);
      }
    } finally {
      setRequestingEvaluation(false);
    }
  }

  async function submitServiceReport(report: ServiceProbeReport): Promise<boolean> {
    if (!data) return false;
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the NEAR wallet listed for this operator before submitting its report.");
      return false;
    }
    const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
    const source = data.serviceAvailabilityPolicy?.sources.find((item) => item.source_id === report.payload.source_id);
    if (!source || source.operator_id !== accountId) {
      setError("Only the configured NEAR operator account can submit this report.");
      return false;
    }

    setServiceInboxAction("submit");
    setError(null);
    setActionMessage(null);
    try {
      const storageDeposit = await client.getServiceReportStorageDeposit(data.commitment.id, report);
      const walletClient = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      await walletClient.submitServiceReport(data.commitment.id, report, storageDeposit, { gas: "100000000000000" });
      await loadCommitment(data.commitment.id);
      setActionMessage(`Report for ${source.source_id} is now in the public NEAR inbox for evaluation #${report.payload.evaluation_id}. Its temporary storage bond will be credited back after use or expiry.`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The service report could not be submitted to NEAR.");
      return false;
    } finally {
      setServiceInboxAction(null);
    }
  }

  async function withdrawServiceReportRefund(): Promise<boolean> {
    const connector = connectorRef.current;
    if (!connector || !accountId) {
      setError("Connect the NEAR wallet that owns the report storage refund.");
      return false;
    }
    setServiceInboxAction("refund");
    setError(null);
    setActionMessage(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      await client.withdrawServiceReportRefund();
      if (data) await loadCommitment(data.commitment.id);
      setActionMessage("Report storage refund requested. NEAR will reconcile the transfer; refresh the commitment to check its status.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report storage refund could not be requested.");
      return false;
    } finally {
      setServiceInboxAction(null);
    }
  }

  async function reclaimServiceReport(evaluationId: string, sourceId: string): Promise<boolean> {
    const connector = connectorRef.current;
    if (!connector || !data) {
      setError("Connect a NEAR wallet to reclaim expired report storage.");
      return false;
    }
    setServiceInboxAction("reclaim");
    setError(null);
    try {
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      await client.reclaimServiceReport(data.commitment.id, evaluationId, sourceId);
      await loadCommitment(data.commitment.id);
      setActionMessage(`Expired ${sourceId} report removed. Its storage deposit is now credited to the submitting operator.`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The expired report could not be reclaimed.");
      return false;
    } finally {
      setServiceInboxAction(null);
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
      const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
      const current = await client.getCommitment(data.commitment.id);
      if (!current?.pending_evaluation_id) {
        await loadCommitment(data.commitment.id);
        setError("This evaluation is no longer pending. Its current result has been refreshed; no expiry transaction was sent.");
        return;
      }
      const timeoutNs = await client.getEvaluationTimeout(data.commitment.id, current.pending_evaluation_id);
      if (!timeoutNs) {
        await loadCommitment(data.commitment.id);
        setError("NEAR has no timeout recorded for this pending evaluation. Refresh its status before trying again.");
        return;
      }
      const nowNs = BigInt(await getFinalBlockTimestampNs(RPC_URL));
      if (nowNs < BigInt(timeoutNs)) {
        setError(`Evaluation #${current.pending_evaluation_id} is still waiting for the evaluator. You can expire it after ${formatDate(timeoutNs)}.`);
        return;
      }
      const walletClient = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({
        rpcUrl: RPC_URL,
        sendTransaction: createWalletSender(connector),
      }));
      await walletClient.expireEvaluation(data.commitment.id, current.pending_evaluation_id);
      const loaded = await loadCommitment(data.commitment.id);
      setActionMessage(loaded
        ? `Evaluation #${current.pending_evaluation_id} expired after its timeout.`
        : `The evaluation expiry transaction returned successfully. Reload commitment #${data.commitment.id} to verify its state.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The pending evaluation could not be expired.";
      let current: CommitmentView | null = null;
      let stateVerified = false;
      try {
        const client = new LcpClient(CONTRACT_ID, new NearJsonRpcTransport({ rpcUrl: RPC_URL }));
        current = await client.getCommitment(data.commitment.id);
        stateVerified = current !== null;
      } catch {
        // Keep the wallet error if the follow-up state read also fails.
      }
      await loadCommitment(data.commitment.id);
      setError(current?.pending_evaluation_id
        ? `Evaluation #${current.pending_evaluation_id} is still pending. Refresh its timeout before retrying. ${message}`
        : stateVerified
          ? "This evaluation already finished or expired. Commitment state was refreshed; no further expiry action is needed."
          : `${message} NEAR did not return the current evaluation state, so refresh before retrying.`);
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

    const attachedDeposit = parseNearToYocto(DEFAULT_STORAGE_DEPOSIT);

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
          <button
            className="theme-toggle"
            type="button"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={theme === "dark"}
            onClick={toggleTheme}
          >
            <span className="theme-toggle-icon" aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <span className="theme-toggle-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
          <span className="network-chip"><span className="network-dot" />NEAR {NEAR_NETWORK_ID.toUpperCase()}</span>
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
            <button className="wallet-button" type="button" onClick={() => void connectWallet()} disabled={connecting || walletRestoring}>
              <span className="wallet-icon" aria-hidden="true">◈</span>
              {walletRestoring ? "Restoring wallet…" : connecting ? "Connecting…" : "Connect wallet"}
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
            onPinMaintainerKey={pinMaintainerKey}
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
                busyAction={setupAction}
                onEscrowFundingChange={setEscrowFundingNear}
                onOperationsFundingChange={setOperationsFundingNear}
                onActivationStorageChange={setActivationStorageNear}
                onAction={submitSetupAction}
              />
            )}
            {data.commitment.lifecycle === "Active" && data.policy && (
              <ActiveOperationsFundingCard
                data={data}
                accountId={accountId}
                operationsFundingNear={operationsFundingNear}
                busyAction={setupAction}
                onOperationsFundingChange={setOperationsFundingNear}
                onFund={submitSetupAction}
              />
            )}
            {data.commitment.lifecycle === "Active" && data.policy && (data.policy.version === 3
              ? (
                <ServiceAvailabilityEvidenceCard
                  key={`${data.commitment.id}:${data.commitment.next_evaluation_id}:${data.commitment.policy_hash}`}
                  data={data}
                  accountId={accountId}
                  busy={requestingEvaluation || expiringEvaluation || serviceInboxAction !== null || loading}
                  pendingTimeoutNs={data.evaluationTimeoutNs}
                  onRefresh={() => loadCommitment(data.commitment.id)}
                  onExpire={expirePendingEvaluation}
                  onSubmit={submitServiceEvaluation}
                  onSubmitReport={submitServiceReport}
                  onWithdrawRefund={withdrawServiceReportRefund}
                  onReclaimReport={reclaimServiceReport}
                  onSignMessage={signWalletMessage}
                />
              )
              : (
                <EvidenceSubmissionCard
                  key={`${data.commitment.id}:${data.commitment.next_evaluation_id}:${data.commitment.policy_hash}`}
                  data={data}
                  accountId={accountId}
                  busy={requestingEvaluation || expiringEvaluation}
                  pendingTimeoutNs={data.evaluationTimeoutNs}
                  onExpire={expirePendingEvaluation}
                  onSubmit={submitEvaluation}
                  onSignMessage={signWalletMessage}
                />
              ))}
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
            {EVENT_INDEXER_URL && (
              <IndexedEventHistory
                key={data.commitment.id}
                commitmentId={data.commitment.id}
              />
            )}

            <div className="metrics-grid">
              <MetricCard
                eyebrow="LAST COMPLIANT EVIDENCE"
                title={data.commitment.last_good_observed_at_ns ? formatDate(data.commitment.last_good_observed_at_ns) : "No accepted evidence"}
                detail={lastGoodEvidenceDetail}
                icon="◷"
              />
              <NextTrancheMetric data={data} />
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
                      <Fact
                        label={data.policy.version >= 2 ? "MAINTAINER KEY FINGERPRINT" : "MAINTAINER KEY"}
                        value={data.policy.version >= 2
                          ? data.policy.evidence.maintainer_key_fingerprint_hex ?? "Unavailable"
                          : data.policy.evidence.maintainer_public_key_hex ?? "Unavailable"}
                        mono
                      />
                    </div>
                    {data.policy.version === 3 && data.serviceAvailabilityPolicy && (
                      <div className="service-policy-details">
                        <p className="eyebrow">INDEPENDENT SERVICE SOURCES</p>
                        <div className="policy-lines">
                          <Fact label="TARGET FINGERPRINT" value={data.serviceAvailabilityPolicy.target_id} mono />
                          <Fact label="EXPECTED HTTP" value={`${data.serviceAvailabilityPolicy.expected_status_min}–${data.serviceAvailabilityPolicy.expected_status_max}`} />
                          <Fact label="LATENCY LIMIT" value={`${data.serviceAvailabilityPolicy.max_latency_ms} ms`} />
                          <Fact label="REQUIRED AGREEMENT" value={`${data.serviceAvailabilityPolicy.minimum_agreeing_sources} of ${data.serviceAvailabilityPolicy.sources.length} · ${data.serviceAvailabilityPolicy.minimum_corroboration_bps} bps`} />
                        </div>
                        <ul className="service-source-list">
                          {data.serviceAvailabilityPolicy.sources.map((source) => (
                            <li key={source.source_id}><strong>{source.source_id}</strong><span>{source.operator_id}</span><code>{source.public_key_hex ?? "NEAR transaction authorization"}</code></li>
                          ))}
                        </ul>
                      </div>
                    )}
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
                      <strong>{evaluationVerdictLabel(data.evaluation)}</strong>
                    </div>
                    {evaluationExplanation(data.evaluation) && (
                      <p className="evaluation-explanation">{evaluationExplanation(data.evaluation)}</p>
                    )}
                    <div className="digest-row"><span>OBSERVED</span><code>{formatDate(data.evaluation.observed_at_ns)}</code></div>
                    <div className="digest-row"><span>EVIDENCE HASH</span><code>{data.evaluation.evidence_hash}</code></div>
                    {data.evaluation.service_availability && (
                      <div className="service-agreement-panel" aria-label="Service source agreement">
                        <div><span>VALID REPORTS</span><strong>{data.evaluation.service_availability.source_counts.valid} / {data.evaluation.service_availability.source_counts.configured}</strong></div>
                        <div><span>UP / DOWN / ABSTAIN</span><strong>{data.evaluation.service_availability.source_counts.up} / {data.evaluation.service_availability.source_counts.down} / {data.evaluation.service_availability.source_counts.abstained}</strong></div>
                        <div><span>AGREEMENT COVERAGE</span><strong>{(data.evaluation.service_availability.corroboration_bps / 100).toFixed(2)}%</strong></div>
                        <p>Coverage describes agreement among configured sources. It is not a probability that the service is truthful.</p>
                      </div>
                    )}
                    <div className="digest-row"><span>INPUT HASH</span><code>{data.evaluation.input_hash}</code></div>
                    {data.evaluation.output_hash && <div className="digest-row"><span>OUTPUT HASH</span><code>{data.evaluation.output_hash}</code></div>}
                    <EvaluationProofReference record={data.evaluation} wasmHash={data.policy?.evaluator.wasm_sha256_hex ?? null} />
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
                                <EvaluationProofReference record={record} wasmHash={data.policy?.evaluator.wasm_sha256_hex ?? null} />
                              </li>
                            ))}
                        </ol>
                      </div>
                    )}
                  </>
                ) : <p className="empty-copy">No evaluation has been recorded on chain yet.</p>}
              </section>
            </div>

            {data.evaluation && (
              <ReviewerAccessPanel
                key={`${data.commitment.id}:${data.evaluation.evaluation_id}:${accountId ?? "disconnected"}`}
                accountId={accountId}
                contractId={CONTRACT_ID}
                commitmentId={data.commitment.id}
                maintainerAccount={data.commitment.maintainer}
                chainTimeNs={data.chainTimeNs}
                evaluation={data.evaluation}
                onSignMessage={signWalletMessage}
              />
            )}
            {data.policy?.version === 3 && data.serviceAvailabilityPolicy && (
              <ServicePolicyAmendmentCard
                accountId={accountId}
                commitment={data.commitment}
                commitmentPolicy={data.policy}
                policy={data.serviceAvailabilityPolicy}
                amendment={data.servicePolicyAmendment}
                chainTimeNs={data.chainTimeNs}
                contractSupported={data.governanceMethodsAvailable}
                onRefresh={() => loadCommitment(data.commitment.id)}
                onPropose={(policy, effectiveAtNs, expiresAtNs, nonceHex) => connectedWalletClient().proposeServicePolicyAmendment(
                  data.commitment.id,
                  policy,
                  effectiveAtNs,
                  expiresAtNs,
                  nonceHex,
                  { attachedDepositYocto: parseNearToYocto("0.05"), gas: "180000000000000" },
                )}
                onApprove={(amendmentId) => connectedWalletClient().approveServicePolicyAmendment(
                  data.commitment.id,
                  amendmentId,
                  { attachedDepositYocto: parseNearToYocto("0.01"), gas: "150000000000000" },
                )}
                onActivate={(amendmentId) => connectedWalletClient().activateServicePolicyAmendment(
                  data.commitment.id,
                  amendmentId,
                  { attachedDepositYocto: parseNearToYocto("0.05"), gas: "180000000000000" },
                )}
                onExpire={(amendmentId) => connectedWalletClient().expireServicePolicyAmendment(data.commitment.id, amendmentId)}
                onCancel={(amendmentId) => connectedWalletClient().cancelServicePolicyAmendment(data.commitment.id, amendmentId)}
              />
            )}
            {data.policy && (
              <AuthorityAdapterCard
                accountId={accountId}
                commitment={data.commitment}
                contractId={CONTRACT_ID}
                testnet={NEAR_NETWORK_ID === "testnet"}
                policy={data.policy}
                latestGrant={data.latestAuthorityGrant}
                eligibility={data.eligibility}
                contractSupported={data.governanceMethodsAvailable}
                chainTimeNs={data.chainTimeNs}
                onRefresh={() => loadCommitment(data.commitment.id)}
                onLoadGrant={(grantId) => readClient().getBoundedPayoutAuthorityGrant(data.commitment.id, grantId)}
                onLoadAdapterStatus={(adapterAccount) => readClient().getBoundedPayoutAdapterPoolStatus(adapterAccount)}
                onDeployAdapter={deployBoundedPayoutAdapter}
                onFundAdapterPool={async (adapterAccount, amountNear) => {
                  await connectedWalletClient().fundBoundedPayoutAdapterPool(
                    adapterAccount,
                    parseNearToYocto(amountNear),
                  );
                }}
                onWithdrawAdapterPool={(adapterAccount, recipient, amountNear) => connectedWalletClient().withdrawBoundedPayoutAdapterPool(
                  adapterAccount,
                  recipient,
                  parseNearToYocto(amountNear),
                )}
                onCreateGrant={(grantId, adapter, resource, perAction, cumulative, expiresAtNs) => connectedWalletClient().createBoundedPayoutAuthorityGrant(
                  data.commitment.id,
                  grantId,
                  adapter,
                  resource,
                  parseNearToYocto(perAction),
                  parseNearToYocto(cumulative),
                  expiresAtNs,
                  { attachedDepositYocto: parseNearToYocto("0.05"), gas: "180000000000000" },
                )}
                onRevokeGrant={(grantId) => connectedWalletClient().revokeAuthorityGrant(data.commitment.id, grantId)}
                onExecuteGrant={(grantId, nonce, amount) => connectedWalletClient().executeAuthorityGrant(
                  data.commitment.id,
                  grantId,
                  nonce,
                  parseNearToYocto(amount),
                )}
              />
            )}

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
                      <div className="claim-form-row">
                        <div className="claim-storage-deposit"><span>CLAIM REQUEST STORAGE BOND</span><strong>{DEFAULT_STORAGE_DEPOSIT} NEAR</strong></div>
                        <button className="claim-button" onClick={() => void claimTranche()} disabled={!canSubmitClaim}>
                          {claiming ? "Submitting…" : !accountId ? "Connect to claim" : !correctBeneficiary ? "Beneficiary wallet required" : retryingFailedPayout ? "Retry payout" : "Claim tranche"}
                          <span aria-hidden="true">↗</span>
                        </button>
                      </div>
                      <p className="claim-disclaimer">The app attaches {DEFAULT_STORAGE_DEPOSIT} NEAR for claim storage, separate from the tranche payout. The contract calculates the required bond and returns any excess.</p>
                    </div>
                  )}
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
  const { commitment } = data;
  const temporalPolicy = data.policy?.temporal;
  if (!commitment.activated_at_ns || !temporalPolicy) return [];
  const temporal = temporalPolicy as NonNullable<typeof temporalPolicy>;

  const points: HealthTimelinePoint[] = [{
    label: "Commitment activated",
    detail: "The contract started the initial evidence clock.",
    atNs: commitment.activated_at_ns,
    source: "recorded",
  }];
  const sortedEvaluations = [...data.evaluationHistory].sort((left, right) => {
    const leftId = BigInt(left.evaluation_id);
    const rightId = BigInt(right.evaluation_id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const earliestEvaluationId = sortedEvaluations[0] ? BigInt(sortedEvaluations[0].evaluation_id) : 1n;
  const historyIsComplete = earliestEvaluationId === 1n;
  const actions: Array<{
    atNs: string;
    order: number;
    kind: "policy-amended" | "evaluation" | "challenge-open" | "challenge-upheld" | "challenge-invalidated";
    record?: EvaluationRecordView;
    challenge?: ChallengeView;
    amendment?: ServicePolicyAmendmentView;
  }> = [];

  for (const record of sortedEvaluations) {
    if (record.status === "Accepted" && record.verdict && record.accepted_at_ns) {
      actions.push({ atNs: record.accepted_at_ns, order: 0, kind: "evaluation", record });
    }
  }
  for (const challenge of data.challengeHistory) {
    actions.push({ atNs: challenge.opened_at_ns, order: 1, kind: "challenge-open", challenge });
    if (challenge.status === "Open") continue;
    if (!challenge.completed_at_ns) {
      continue;
    }
    actions.push({
      atNs: challenge.completed_at_ns,
      order: 2,
      kind: challenge.status === "Upheld" ? "challenge-upheld" : "challenge-invalidated",
      challenge,
    });
  }
  const activeAmendment = data.servicePolicyAmendment;
  if (activeAmendment?.status === "activated" && activeAmendment.activated_at_ns) {
    actions.push({
      atNs: activeAmendment.activated_at_ns,
      order: -1,
      kind: "policy-amended",
      amendment: activeAmendment,
    });
  }
  actions.sort((left, right) => {
    const leftNs = BigInt(left.atNs);
    const rightNs = BigInt(right.atNs);
    return leftNs < rightNs ? -1 : leftNs > rightNs ? 1 : left.order - right.order;
  });

  let lastGoodObservedNs: bigint | null = null;
  let lastGoodEvaluationId: string | null = null;
  let negativeSinceNs: bigint | null = null;
  let breachLatched = false;
  let stateIsKnown = historyIsComplete || sortedEvaluations.length === 0;
  let cursorNs = BigInt(commitment.activated_at_ns);
  let cursorActivationNs = BigInt(commitment.activated_at_ns);

  function healthAt(atNs: bigint): "AwaitingEvidence" | "Healthy" | "AtRisk" | "Breached" {
    if (breachLatched) return "Breached";
    if (negativeSinceNs !== null) {
      return atNs < negativeSinceNs + BigInt(temporal.grace_ns) ? "AtRisk" : "Breached";
    }
    if (lastGoodObservedNs !== null) {
      const expiryNs = lastGoodObservedNs + BigInt(temporal.evidence_ttl_ns);
      if (atNs < expiryNs) return "Healthy";
      return atNs < expiryNs + BigInt(temporal.grace_ns) ? "AtRisk" : "Breached";
    }
    const initialDeadlineNs = cursorActivationNs + BigInt(temporal.initial_window_ns);
    if (atNs < initialDeadlineNs) return "AwaitingEvidence";
    return atNs < initialDeadlineNs + BigInt(temporal.grace_ns) ? "AtRisk" : "Breached";
  }

  function addDerivedTransitions(untilNs: bigint) {
    if (!stateIsKnown || untilNs <= cursorNs) return;
    const makePoint = (atNs: bigint, label: string, detail: string) => {
      if (atNs > cursorNs && atNs <= untilNs) {
        points.push({ label, detail, atNs: atNs.toString(), source: "derived" });
      }
    };
    if (negativeSinceNs !== null) {
      makePoint(
        negativeSinceNs + BigInt(temporal.grace_ns),
        "Breached · grace period elapsed",
        "The contract derives Breached once the grace period reaches its exact boundary.",
      );
    } else if (lastGoodObservedNs !== null) {
      const expiryNs = lastGoodObservedNs + BigInt(temporal.evidence_ttl_ns);
      makePoint(expiryNs, "AtRisk · evidence freshness ended", "The latest compliant observation reached its policy TTL.");
      makePoint(expiryNs + BigInt(temporal.grace_ns), "Breached · grace period elapsed", "No qualifying recovery was accepted before the grace boundary.");
    } else {
      const initialDeadlineNs = cursorActivationNs + BigInt(temporal.initial_window_ns);
      makePoint(initialDeadlineNs, "AtRisk · initial evidence window ended", "No compliant evidence had been accepted by the policy deadline.");
      makePoint(initialDeadlineNs + BigInt(temporal.grace_ns), "Breached · grace period elapsed", "No qualifying evidence was accepted before the grace boundary.");
    }
  }

  for (const action of actions) {
    const atNs = BigInt(action.atNs);
    addDerivedTransitions(atNs);
    if (action.kind === "policy-amended" && action.amendment) {
      lastGoodObservedNs = null;
      lastGoodEvaluationId = null;
      cursorActivationNs = atNs;
      stateIsKnown = true;
      points.push({
        label: "Source policy amended · evidence clock restarted",
        detail: `Amendment ${action.amendment.amendment_id} took effect. New compliant evidence must satisfy policy ${action.amendment.new_policy_hash.slice(0, 12)}…`,
        atNs: action.atNs,
        source: "recorded",
      });
    } else if (action.kind === "challenge-open" && action.challenge) {
      points.push({
        label: "Challenge opened · claim paused",
        detail: `Challenge #${action.challenge.id} is recorded against evaluation #${action.challenge.evaluation_id}.`,
        atNs: action.atNs,
        source: "recorded",
      });
    } else if (action.kind === "challenge-upheld" && action.challenge) {
      points.push({
        label: "Challenge upheld · evidence retained",
        detail: `The arbiter upheld evaluation #${action.challenge.evaluation_id}; its compliant evidence remains valid.`,
        atNs: action.atNs,
        source: "recorded",
      });
    } else if (action.kind === "challenge-invalidated" && action.challenge) {
      const before = stateIsKnown ? healthAt(atNs) : null;
      if (before === "Breached" && !temporal.recovery_allowed) breachLatched = true;
      if (lastGoodEvaluationId === action.challenge.evaluation_id) {
        lastGoodObservedNs = null;
        lastGoodEvaluationId = null;
      }
      if (negativeSinceNs === null) negativeSinceNs = atNs;
      stateIsKnown = true;
      const after = healthAt(atNs);
      points.push({
        label: `${after} · challenge ${action.challenge.status === "TimedOut" ? "timed out" : "invalidated"}`,
        detail: `The challenge outcome invalidated evaluation #${action.challenge.evaluation_id} as qualifying evidence.`,
        atNs: action.atNs,
        source: "recorded",
      });
    } else if (action.kind === "evaluation" && action.record) {
      const record = action.record;
      const before = stateIsKnown ? healthAt(atNs) : null;
      if (record.verdict === "Compliant") {
        if (before === "Breached" && !temporal.recovery_allowed) breachLatched = true;
        if (temporal.recovery_allowed) negativeSinceNs = null;
        lastGoodObservedNs = BigInt(record.observed_at_ns);
        lastGoodEvaluationId = record.evaluation_id;
        stateIsKnown = true;
        const after = healthAt(atNs);
        const recovered = (before === "AtRisk" || before === "Breached") && after === "Healthy";
        points.push({
          label: recovered
            ? "Recovered · compliant evidence accepted"
            : `${after} · compliant evidence accepted`,
          detail: recovered
            ? `Evaluation #${record.evaluation_id} restored Healthy status under the recovery policy.`
            : `Evaluation #${record.evaluation_id} was accepted as compliant by the contract.`,
          atNs: action.atNs,
          source: "recorded",
        });
      } else if (record.verdict === "NonCompliant") {
        if (negativeSinceNs === null) negativeSinceNs = atNs;
        stateIsKnown = true;
        const after = healthAt(atNs);
        points.push({
          label: `${after} · noncompliant evaluation accepted`,
          detail: `Evaluation #${record.evaluation_id} started or continued a negative health period.`,
          atNs: action.atNs,
          source: "recorded",
        });
      } else {
        points.push({
          label: "Inconclusive · source quorum not met",
          detail: `Evaluation #${record.evaluation_id} did not change health clocks or claim eligibility.`,
          atNs: action.atNs,
          source: "recorded",
        });
      }
    }
    cursorNs = atNs;
  }

  const nowNs = data.chainTimeNs ? BigInt(data.chainTimeNs) : null;
  if (nowNs !== null) addDerivedTransitions(nowNs);
  const futureDeadlines: HealthTimelinePoint[] = [];
  const canShowFuture = commitment.lifecycle === "Active" && commitment.effective_health !== "Breached";
  if (canShowFuture) {
    if (commitment.negative_since_ns) {
      futureDeadlines.push({
        label: "Breached · grace period elapsed",
        detail: temporal.recovery_allowed
          ? "Breached begins here unless qualifying evidence is accepted first."
          : "Breach becomes permanent here because policy recovery is disabled.",
        atNs: (BigInt(commitment.negative_since_ns) + BigInt(temporal.grace_ns)).toString(),
        source: "derived",
      });
    } else if (commitment.last_good_observed_at_ns) {
      const expiryNs = BigInt(commitment.last_good_observed_at_ns) + BigInt(temporal.evidence_ttl_ns);
      futureDeadlines.push({
        label: "AtRisk · evidence freshness ends",
        detail: "AtRisk begins if no newer compliant evidence has been accepted by this time.",
        atNs: expiryNs.toString(),
        source: "derived",
      });
      futureDeadlines.push({
        label: "Breached · grace period elapsed",
        detail: temporal.recovery_allowed
          ? "Breached begins here unless qualifying evidence is accepted first."
          : "Breach becomes permanent here because policy recovery is disabled.",
        atNs: (expiryNs + BigInt(temporal.grace_ns)).toString(),
        source: "derived",
      });
    } else {
      const initialDeadlineNs = cursorActivationNs + BigInt(temporal.initial_window_ns);
      futureDeadlines.push({
        label: "AtRisk · initial evidence window ends",
        detail: "AtRisk begins if compliant evidence has not been accepted by this time.",
        atNs: initialDeadlineNs.toString(),
        source: "derived",
      });
      futureDeadlines.push({
        label: "Breached · grace period elapsed",
        detail: temporal.recovery_allowed
          ? "Breached begins here unless qualifying evidence is accepted first."
          : "Breach becomes permanent here because policy recovery is disabled.",
        atNs: (initialDeadlineNs + BigInt(temporal.grace_ns)).toString(),
        source: "derived",
      });
    }
  }
  for (const point of futureDeadlines) {
    if (nowNs === null || BigInt(point.atNs) > nowNs) points.push(point);
  }

  const seenPoints = new Set<string>();
  const deduplicatedPoints = points.filter((point) => {
    const key = `${point.label}:${point.atNs}`;
    if (seenPoints.has(key)) return false;
    seenPoints.add(key);
    return true;
  });
  return deduplicatedPoints.sort((left, right) => {
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
    ? points.findIndex((point) => point.source === "derived" && BigInt(point.atNs) > BigInt(chainTimeNs))
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
          <p className="timeline-explainer">Recent health transitions come from accepted evaluations, challenge outcomes, and policy amendments. Amendments restart the initial evidence clock; deadlines are derived from recorded timestamps and the active policy.</p>
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
          {data.evaluationHistory.length > 0 && BigInt(data.evaluationHistory[data.evaluationHistory.length - 1].evaluation_id) > 1n && (
            <p className="timeline-closed-note">History is limited to the most recent {EVALUATION_HISTORY_LIMIT} evaluations, so earlier transitions may be omitted.</p>
          )}
          {data.challengeHistory.some((challenge) => challenge.status !== "Open" && !challenge.completed_at_ns) && (
            <p className="timeline-closed-note">Some older challenge outcomes have no stored completion timestamp and cannot be placed precisely in the timeline.</p>
          )}
          {data.commitment.lifecycle === "Closed" && <p className="timeline-closed-note">The commitment is closed; no future health deadlines are active.</p>}
          {data.commitment.effective_health === "Breached" && <p className="timeline-closed-note">The commitment is currently Breached; the timeline shows no future automatic health changes.</p>}
          {!data.chainTimeNs && <p className="timeline-closed-note">Refresh the commitment to compare these milestones with a finalized block time.</p>}
        </>
      )}
    </section>
  );
}

interface IndexedEventRecord {
  id: string;
  block_height: string;
  block_timestamp_ns: string;
  transaction_hash: string | null;
  event: LcpEvent;
}

interface IndexedEventPage {
  events: IndexedEventRecord[];
  next_before_id: string | null;
}

interface EventIndexerHealth {
  status: "not_initialized" | "degraded" | "catching_up" | "ready";
  last_processed_height: number | null;
  lag_blocks: number | null;
  last_error_code: string | null;
}

function parseIndexedLcpEvent(value: unknown): LcpEvent | null {
  if (!isRecord(value) || value.standard !== "lcp" || typeof value.version !== "string"
    || typeof value.event !== "string" || !Array.isArray(value.data)) return null;
  const data: Record<string, unknown>[] = [];
  for (const item of value.data) {
    if (!isRecord(item)) return null;
    data.push(item);
  }
  return { standard: "lcp", version: value.version, event: value.event, data };
}

function parseIndexedEventPage(value: unknown): IndexedEventPage | null {
  if (!isRecord(value) || !Array.isArray(value.events)) return null;
  if (value.network !== NEAR_NETWORK_ID || value.contract_id !== CONTRACT_ID) return null;
  const nextBeforeId = value.next_before_id;
  if (nextBeforeId !== null && (typeof nextBeforeId !== "string" || !/^[1-9][0-9]*$/.test(nextBeforeId))) return null;

  const events: IndexedEventRecord[] = [];
  for (const candidate of value.events) {
    if (!isRecord(candidate)) return null;
    const event = parseIndexedLcpEvent(candidate.event);
    if (!event) return null;
    if (typeof candidate.id !== "string" || !/^[1-9][0-9]*$/.test(candidate.id)
      || typeof candidate.block_height !== "string" || !/^[1-9][0-9]*$/.test(candidate.block_height)
      || typeof candidate.block_timestamp_ns !== "string" || !/^[0-9]+$/.test(candidate.block_timestamp_ns)
      || (candidate.transaction_hash !== null && typeof candidate.transaction_hash !== "string")) return null;
    events.push({
      id: candidate.id,
      block_height: candidate.block_height,
      block_timestamp_ns: candidate.block_timestamp_ns,
      transaction_hash: candidate.transaction_hash,
      event,
    });
  }
  return { events, next_before_id: nextBeforeId };
}

function parseEventIndexerHealth(value: unknown): EventIndexerHealth | null {
  if (!isRecord(value) || value.network !== NEAR_NETWORK_ID || value.contract_id !== CONTRACT_ID) return null;
  const status = value.status;
  if (status !== "not_initialized" && status !== "degraded" && status !== "catching_up" && status !== "ready") return null;
  const lastHeight = value.last_processed_height;
  const lagBlocks = value.lag_blocks;
  if (lastHeight !== null && (!Number.isSafeInteger(lastHeight) || Number(lastHeight) < 0)) return null;
  if (lagBlocks !== null && (!Number.isSafeInteger(lagBlocks) || Number(lagBlocks) < 0)) return null;
  return {
    status,
    last_processed_height: lastHeight as number | null,
    lag_blocks: lagBlocks as number | null,
    last_error_code: typeof value.last_error_code === "string" ? value.last_error_code : null,
  };
}

async function fetchIndexerJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Event indexer returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
}

function eventIndexerStatusLabel(health: EventIndexerHealth): string {
  if (health.status === "ready") return "UP TO DATE";
  if (health.status === "degraded") return "INDEXER DEGRADED";
  if (health.status === "not_initialized") return "INITIALIZING";
  return health.lag_blocks === null ? "CATCHING UP" : `CATCHING UP · ${health.lag_blocks.toLocaleString()} BLOCKS`;
}

function IndexedEventHistory({ commitmentId }: { commitmentId: string }) {
  const [health, setHealth] = useState<EventIndexerHealth | null>(null);
  const [events, setEvents] = useState<IndexedEventRecord[]>([]);
  const [nextBeforeId, setNextBeforeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setHealth(null);
    setEvents([]);
    setNextBeforeId(null);
    setError(null);
    setLoading(true);

    async function loadInitialPage() {
      try {
        const eventsUrl = new URL(`${EVENT_INDEXER_URL}/v1/events`);
        eventsUrl.searchParams.set("commitment_id", commitmentId);
        eventsUrl.searchParams.set("limit", "20");
        const [rawHealth, rawPage] = await Promise.all([
          fetchIndexerJson(`${EVENT_INDEXER_URL}/health`, controller.signal),
          fetchIndexerJson(eventsUrl.toString(), controller.signal),
        ]);
        const parsedHealth = parseEventIndexerHealth(rawHealth);
        const parsedPage = parseIndexedEventPage(rawPage);
        if (!parsedHealth || !parsedPage || !isRecord(rawPage) || rawPage.commitment_id !== commitmentId) {
          throw new Error("The event indexer returned data for a different network, contract, or commitment.");
        }
        setHealth(parsedHealth);
        setEvents(parsedPage.events);
        setNextBeforeId(parsedPage.next_before_id);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "The event indexer could not be reached.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadInitialPage();
    return () => controller.abort();
  }, [commitmentId]);

  async function loadOlderEvents() {
    if (!nextBeforeId || loadingOlder || !requestControllerRef.current) return;
    const controller = requestControllerRef.current;
    setLoadingOlder(true);
    setError(null);
    try {
      const eventsUrl = new URL(`${EVENT_INDEXER_URL}/v1/events`);
      eventsUrl.searchParams.set("commitment_id", commitmentId);
      eventsUrl.searchParams.set("limit", "20");
      eventsUrl.searchParams.set("before_id", nextBeforeId);
      const rawPage = await fetchIndexerJson(eventsUrl.toString(), controller.signal);
      const parsedPage = parseIndexedEventPage(rawPage);
      if (!parsedPage || !isRecord(rawPage) || rawPage.commitment_id !== commitmentId) {
        throw new Error("The event indexer returned an invalid history page.");
      }
      setEvents((current) => [...current, ...parsedPage.events]);
      setNextBeforeId(parsedPage.next_before_id);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Older indexed events could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setLoadingOlder(false);
    }
  }

  return (
    <section className="content-card indexed-history" aria-labelledby="indexed-history-title">
      <div className="card-heading">
        <div><p className="eyebrow">PUBLIC ARCHIVE · {health ? eventIndexerStatusLabel(health) : "FINALIZED LCP EVENTS"}</p><h3 id="indexed-history-title">Indexed event history</h3></div>
        <span className="card-index">INDEX</span>
      </div>
      <p className="indexed-history-explainer">A paginated archive of LCP events from finalized NEAR blocks. Health, eligibility, and settlement continue to come directly from the contract.</p>
      {health?.last_processed_height !== null && health?.last_processed_height !== undefined && (
        <p className="indexed-history-status">Last indexed block {health.last_processed_height.toLocaleString()}{health.lag_blocks !== null ? ` · ${health.lag_blocks.toLocaleString()} blocks behind` : ""}</p>
      )}
      {health?.last_error_code && <p className="indexed-history-error">Indexer reports {health.last_error_code}.</p>}
      {error && <p className="indexed-history-error" role="status">{error}</p>}
      {loading ? <p className="empty-copy">Loading finalized event history…</p> : events.length === 0 ? (
        <p className="empty-copy">No indexed events are available for this commitment yet. The indexer may still be catching up.</p>
      ) : (
        <ol className="indexed-event-list">
          {events.map((item) => {
            const eventData = item.event.data[0] ?? {};
            const eventLabel = item.event.event.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
            return (
              <li className="indexed-event" key={item.id}>
                <div className="indexed-event-heading">
                  <strong>{eventLabel}</strong>
                  <span>BLOCK {item.block_height}</span>
                </div>
                <time>{formatDate(item.block_timestamp_ns)}</time>
                {item.transaction_hash && (
                  <a href={`https://${NEAR_NETWORK_ID === "testnet" ? "testnet." : ""}nearblocks.io/txns/${item.transaction_hash}`} target="_blank" rel="noreferrer">
                    NEAR transaction ↗
                  </a>
                )}
                <details>
                  <summary>Public event data</summary>
                  <pre>{JSON.stringify(eventData, null, 2)}</pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
      {nextBeforeId && (
        <button className="browser-more-button indexed-history-more" type="button" onClick={() => void loadOlderEvents()} disabled={loadingOlder}>
          {loadingOlder ? "Loading older events…" : "Load older events"}
        </button>
      )}
    </section>
  );
}

function MetricCard({ eyebrow, title, detail, icon }: { eyebrow: string; title: string; detail: ReactNode; icon: string }) {
  return (
    <section className="metric-card">
      <div className="metric-top"><p className="eyebrow">{eyebrow}</p><span>{icon}</span></div>
      <strong className="metric-title">{title}</strong>
      <p className="metric-detail" title={typeof detail === "string" ? detail : undefined}>{detail}</p>
    </section>
  );
}

function NextTrancheMetric({ data }: { data: CommitmentData }) {
  const [clientNowMs, setClientNowMs] = useState<number | null>(null);

  useEffect(() => {
    setClientNowMs(Date.now());
    const interval = window.setInterval(() => setClientNowMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const eligibility = data.eligibility;
  const reason = eligibility?.reason ?? (data.epoch ? `Current epoch ${data.epoch}` : "No active budget epoch");
  const activatedAtNs = data.commitment.activated_at_ns;
  const budget = data.policy?.budget;
  if (!activatedAtNs || !budget || BigInt(budget.epoch_ns) <= 0n || budget.max_epochs <= 0) {
    return (
      <MetricCard
        eyebrow="NEXT TRANCHE"
        title={eligibility?.eligible ? `${formatNear(eligibility.amount_yocto)} NEAR` : "Not eligible"}
        detail={reason}
        icon="↗"
      />
    );
  }

  const activatedNs = BigInt(activatedAtNs);
  const epochNs = BigInt(budget.epoch_ns);
  const programEndsAtNs = activatedNs + epochNs * BigInt(budget.max_epochs);
  const chainNowNs = data.chainTimeNs
    ? BigInt(data.chainTimeNs) + BigInt(Math.max(0, clientNowMs === null ? 0 : clientNowMs - data.chainTimeCapturedAtMs)) * 1_000_000n
    : null;
  const programEnded = eligibility?.reason === "the funded budget program has ended" || (chainNowNs !== null && chainNowNs >= programEndsAtNs);
  let milestone: string | null = null;

  if (programEnded) {
    milestone = chainNowNs !== null && chainNowNs >= programEndsAtNs
      ? `Ended ${formatDate(programEndsAtNs.toString())} · ${formatCountdown((chainNowNs - programEndsAtNs).toString())} ago`
      : `Ended ${formatDate(programEndsAtNs.toString())} · refresh for elapsed time`;
  } else if (chainNowNs !== null) {
    if (eligibility?.reason === "evaluation challenge window is still open") {
      const goodEvaluation = data.evaluationHistory.find((record) =>
        record.accepted_at_ns !== null &&
        record.verdict === "Compliant" &&
        record.observed_at_ns === data.commitment.last_good_observed_at_ns,
      );
      if (goodEvaluation?.accepted_at_ns && data.policy) {
        const claimOpensAtNs = BigInt(goodEvaluation.accepted_at_ns) + BigInt(data.policy.temporal.challenge_window_ns);
        if (claimOpensAtNs <= programEndsAtNs) {
          milestone = chainNowNs < claimOpensAtNs
            ? `Claim window opens in ${formatCountdown((claimOpensAtNs - chainNowNs).toString())} · ${formatDate(claimOpensAtNs.toString())}`
            : `Challenge window closed ${formatDate(claimOpensAtNs.toString())}`;
        }
      }
    } else if (eligibility?.reason === "this epoch is already paid or pending" && data.epoch) {
      const nextEpochStartsAtNs = activatedNs + (BigInt(data.epoch) + 1n) * epochNs;
      if (nextEpochStartsAtNs < programEndsAtNs) {
        milestone = nextEpochStartsAtNs > chainNowNs
          ? `Next epoch starts in ${formatCountdown((nextEpochStartsAtNs - chainNowNs).toString())} · ${formatDate(nextEpochStartsAtNs.toString())}`
          : `Next epoch has started · refresh claim eligibility`;
      } else {
        milestone = `No later tranche · program ends in ${formatCountdown((programEndsAtNs - chainNowNs).toString())}`;
      }
    }

    if (!milestone) {
      milestone = `Program ends in ${formatCountdown((programEndsAtNs - chainNowNs).toString())} · ${formatDate(programEndsAtNs.toString())}`;
    }
  } else {
    milestone = `Program ends ${formatDate(programEndsAtNs.toString())} · refresh for a live countdown`;
  }

  const detail = (
    <>
      <span>{programEnded ? "No future tranches can be claimed under this policy." : reason}</span>
      {milestone && <span className="metric-detail-secondary">{milestone}</span>}
    </>
  );

  return (
    <MetricCard
      eyebrow="NEXT TRANCHE"
      title={eligibility?.eligible ? `${formatNear(eligibility.amount_yocto)} NEAR` : programEnded ? "Program ended" : "Not eligible"}
      detail={detail}
      icon="↗"
    />
  );
}

function ServiceAvailabilityEvidenceCard({
  data,
  accountId,
  busy,
  pendingTimeoutNs,
  onRefresh,
  onExpire,
  onSubmit,
  onSubmitReport,
  onWithdrawRefund,
  onReclaimReport,
  onSignMessage,
}: {
  data: CommitmentData;
  accountId: string | null;
  busy: boolean;
  pendingTimeoutNs: string | null;
  onRefresh: () => Promise<boolean>;
  onExpire: () => Promise<void>;
  onSubmit: (reports: SignedProbeReport[] | null, storageDeposit: string) => Promise<void>;
  onSubmitReport: (report: ServiceProbeReport) => Promise<boolean>;
  onWithdrawRefund: () => Promise<boolean>;
  onReclaimReport: (evaluationId: string, sourceId: string) => Promise<boolean>;
  onSignMessage: (message: string, nonce: Uint8Array, recipient: string, callbackUrl: string) => Promise<NearSignedMessage>;
}) {
  const { commitment, policy, serviceAvailabilityPolicy } = data;
  const transactionAuthenticated = serviceAvailabilityPolicy?.schema === "lcp.service_availability.policy.v2";
  const connectedServiceSource = serviceAvailabilityPolicy?.sources.find((source) => source.operator_id === accountId) ?? null;
  const [reportsJson, setReportsJson] = useState("");
  const [selectedReportFiles, setSelectedReportFiles] = useState<string[]>([]);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [signatureCheckAvailable, setSignatureCheckAvailable] = useState<boolean | null>(null);
  const [loadingReportFiles, setLoadingReportFiles] = useState(false);
  const [validating, setValidating] = useState(false);
  const [browserProbeUrl, setBrowserProbeUrl] = useState("");
  const [browserProbeSaltHex, setBrowserProbeSaltHex] = useState("");
  const [runningBrowserProbe, setRunningBrowserProbe] = useState(false);
  const [pendingBrowserProbePayload, setPendingBrowserProbePayload] = useState<SignedProbeReport["payload"] | null>(null);
  const [pendingSignedProbeReport, setPendingSignedProbeReport] = useState<SignedProbeReport | null>(null);
  const [lastSubmittedTransactionReport, setLastSubmittedTransactionReport] = useState<ServiceProbeReport | null>(null);
  const [replayTestEnabled, setReplayTestEnabled] = useState(false);
  const [replayTestMessage, setReplayTestMessage] = useState<string | null>(null);
  const [browserProbeMessage, setBrowserProbeMessage] = useState<string | null>(null);
  const [copiedReports, setCopiedReports] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errorNoticeRef = useRef<HTMLDivElement>(null);
  const [clockNowMs, setClockNowMs] = useState<number | null>(null);
  const canRequest = Boolean(accountId && policy && (
    accountId === commitment.maintainer || accountId === policy.budget.sponsor
  ));
  const blocked = Boolean(commitment.pending_evaluation_id || commitment.active_challenge_id);
  const operationsAvailable = BigInt(commitment.operations_funded_yocto) - BigInt(commitment.operations_authorized_spend_yocto);
  const executionDeposit = BigInt(policy?.evaluator.execution_deposit_yocto ?? "0");
  const operationsReady = operationsAvailable >= executionDeposit;
  const estimatedChainNowNs = data.chainTimeNs
    ? BigInt(data.chainTimeNs) + BigInt(Math.max(0, clockNowMs === null ? 0 : clockNowMs - data.chainTimeCapturedAtMs)) * 1_000_000n
    : null;
  const timeoutRemainingNs = pendingTimeoutNs && estimatedChainNowNs !== null
    ? BigInt(pendingTimeoutNs) - estimatedChainNowNs
    : null;
  const canExpire = timeoutRemainingNs !== null && timeoutRemainingNs <= 0n;

  useEffect(() => {
    if (!commitment.pending_evaluation_id) return;
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [commitment.pending_evaluation_id]);

  useEffect(() => {
    if (formError) errorNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [formError]);

  useEffect(() => {
    const hostname = window.location.hostname;
    const previewOrLocal = hostname === "localhost" || hostname === "127.0.0.1"
      || hostname === "lcp-preview.pages.dev" || hostname.endsWith(".lcp-preview.pages.dev");
    setReplayTestEnabled(previewOrLocal && new URLSearchParams(window.location.search).get("lcpReplayTest") === "1");
  }, []);

  async function handleReportFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;

    setFormError(null);
    setSignatureCheckAvailable(null);
    setPendingBrowserProbePayload(null);
    setPendingSignedProbeReport(null);
    setBrowserProbeMessage(null);
    setLoadingReportFiles(true);
    try {
      const fileReports = await Promise.all(files.map(async (file) => {
        const parsed: unknown = JSON.parse(await file.text());
        return Array.isArray(parsed) ? parsed : [parsed];
      }));
      const candidates = fileReports.flat();
      if (candidates.length === 0 || candidates.length > (serviceAvailabilityPolicy?.sources.length ?? 0)) {
        throw new Error(`Choose between one and ${serviceAvailabilityPolicy?.sources.length ?? 0} signed reports.`);
      }
      setReportsJson(JSON.stringify(candidates, null, 2));
      setSelectedReportFiles(files.map((file) => file.name));
      setReportCount(candidates.length);
    } catch (cause) {
      setReportsJson("");
      setSelectedReportFiles([]);
      setReportCount(null);
      setFormError(cause instanceof Error ? cause.message : "One of the selected files is not valid report JSON.");
    } finally {
      setLoadingReportFiles(false);
    }
  }

  async function runBrowserProbe() {
    if (!serviceAvailabilityPolicy) return;
    setFormError(null);
    setBrowserProbeMessage(null);
    setLastSubmittedTransactionReport(null);
    setReplayTestMessage(null);
    setPendingBrowserProbePayload(null);
    setRunningBrowserProbe(true);
    try {
      if (!accountId) throw new Error("Connect the NEAR wallet for a source pinned in this commitment.");
      const source = serviceAvailabilityPolicy.sources.find((item) => item.operator_id === accountId);
      if (!source) throw new Error("The connected wallet is not one of the operator accounts pinned in this commitment.");
      if (!CONTRACT_ID) throw new Error("The LCP contract is not configured.");

      let target: URL;
      try {
        target = new URL(browserProbeUrl.trim());
      } catch {
        throw new Error("Enter the authorized HTTPS health endpoint.");
      }
      if (target.protocol !== "https:" || target.origin !== window.location.origin) {
        throw new Error("For a safe in-app probe, open the Console on the same HTTPS origin as the health endpoint. Use an operator report from an approved probe tool for other origins.");
      }
      const fingerprint = await fingerprintServiceTarget(target.href, browserProbeSaltHex.trim());
      if (fingerprint !== serviceAvailabilityPolicy.target_id) {
        throw new Error("This endpoint and salt do not match the target fingerprint pinned by the commitment.");
      }

      const controller = new AbortController();
      const timeoutMs = Math.max(5_000, Math.min(serviceAvailabilityPolicy.max_latency_ms + 1_000, 30_000));
      const startedAt = performance.now();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let observation: SignedProbeReport["payload"]["observation"];
      try {
        const response = await fetch(target.href, {
          method: "GET",
          mode: "same-origin",
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        observation = {
          kind: "http_response",
          status_code: response.status,
          latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          tls_verified: true,
        };
      } catch {
        const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
        observation = timedOut
          ? { kind: "timeout", elapsed_ms: elapsedMs }
          : { kind: "source_error", code: "browser_probe_unavailable" };
      } finally {
        window.clearTimeout(timeout);
      }

      const sourcePolicyHash = await sha256TextHex(JSON.stringify(serviceAvailabilityPolicy));
      const observedAtNs = await getFinalBlockTimestampNs(RPC_URL);
      const payload: SignedProbeReport["payload"] = {
        schema: "lcp.service_availability.report.v1",
        contract_id: CONTRACT_ID,
        commitment_id: commitment.id,
        evaluation_id: commitment.next_evaluation_id,
        policy_version: 3,
        policy_hash: commitment.policy_hash,
        source_policy_hash: sourcePolicyHash,
        source_id: source.source_id,
        operator_id: source.operator_id,
        target_id: serviceAvailabilityPolicy.target_id,
        observed_at_ns: observedAtNs,
        observation,
      };
      setPendingBrowserProbePayload(payload);
      const description = observation.kind === "http_response"
        ? `HTTP ${observation.status_code} in ${observation.latency_ms} ms`
        : observation.kind === "timeout"
          ? `No response within ${observation.elapsed_ms} ms`
          : "Browser could not read the endpoint; this report will abstain rather than call it down";
      setBrowserProbeMessage(transactionAuthenticated
        ? `Probe captured for ${source.source_id}, evaluation #${commitment.next_evaluation_id}: ${description}. Review it, then submit from this operator wallet.`
        : `Probe captured for ${source.source_id}, evaluation #${commitment.next_evaluation_id}: ${description}. Review the result, then sign it with the operator wallet.`);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The in-app probe could not be completed.");
    } finally {
      setRunningBrowserProbe(false);
    }
  }

  async function signBrowserProbe() {
    if (!pendingBrowserProbePayload || !serviceAvailabilityPolicy || !accountId) return;
    setFormError(null);
    setRunningBrowserProbe(true);
    try {
      const source = serviceAvailabilityPolicy.sources.find((item) => item.operator_id === accountId);
      if (!source || source.source_id !== pendingBrowserProbePayload.source_id) {
        throw new Error("The connected wallet must match the operator that performed this probe.");
      }
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const callbackUrl = window.location.origin;
      const signed = await onSignMessage(JSON.stringify(pendingBrowserProbePayload), nonce, CONTRACT_ID, callbackUrl);
      if (signed.accountId !== source.operator_id) {
        throw new Error(`The wallet signed as ${signed.accountId}; this report requires ${source.operator_id}.`);
      }
      const publicKeyHex = nearPublicKeyHex(signed.publicKey);
      if (!source.public_key_hex || publicKeyHex !== source.public_key_hex) {
        throw new Error("The connected wallet key differs from the key pinned for this operator. Ask the commitment creator to update the source roster.");
      }
      const envelope: Nep413ProbeSignature = {
        account_id: signed.accountId,
        public_key: signed.publicKey as NearEd25519PublicKey,
        signature: signed.signature,
        nonce_hex: Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        recipient: CONTRACT_ID,
        callback_url: callbackUrl,
      };
      const report = canonicalizeSignedProbeReport({ payload: pendingBrowserProbePayload, wallet_signature: envelope });
      const signatureValid = await verifySignedProbeReport(report, source);
      if (signatureValid === false) throw new Error("The wallet signature did not verify for this report. No report was added.");

      let previousReports: SignedProbeReport[] = [];
      if (reportsJson.trim()) {
        const parsed: unknown = JSON.parse(reportsJson);
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        previousReports = candidates.map((candidate) => canonicalizeSignedProbeReport(candidate));
      }
      const reports = [...previousReports.filter((item) => item.payload.source_id !== source.source_id), report];
      if (reports.length > serviceAvailabilityPolicy.sources.length) throw new Error("The report bundle has more reports than configured sources.");
      setReportsJson(JSON.stringify(reports, null, 2));
      setSelectedReportFiles([]);
      setReportCount(reports.length);
      setSignatureCheckAvailable(signatureValid);
      setCopiedReports(false);
      setPendingSignedProbeReport(report);
      setPendingBrowserProbePayload(null);
      setBrowserProbeMessage(`Signed ${source.source_id} report for evaluation #${commitment.next_evaluation_id}. Submit it to the NEAR inbox to avoid sending a file to the sponsor.`);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The in-app probe could not be signed.");
    } finally {
      setRunningBrowserProbe(false);
    }
  }

  async function submitSignedReportToInbox() {
    if (!pendingSignedProbeReport) return;
    const submitted = await onSubmitReport(pendingSignedProbeReport);
    if (submitted) {
      setPendingSignedProbeReport(null);
      setBrowserProbeMessage(`Report from ${pendingSignedProbeReport.payload.source_id} is in the NEAR inbox. Its endpoint URL and salt are not included.`);
    }
  }

  async function submitTransactionAuthenticatedReport() {
    if (!pendingBrowserProbePayload) return;
    const report: ServiceProbeReport = { payload: pendingBrowserProbePayload };
    const submitted = await onSubmitReport(report);
    if (submitted) {
      setLastSubmittedTransactionReport(report);
      setReplayTestMessage(null);
      setPendingBrowserProbePayload(null);
      setBrowserProbeMessage(`Report from ${pendingBrowserProbePayload.source_id} is in the NEAR inbox. The operator account was authenticated by the transaction; no separate signature or file handoff was needed.`);
    }
  }

  async function repeatTransactionAuthenticatedReport() {
    if (!lastSubmittedTransactionReport) return;
    setReplayTestMessage(null);
    const accepted = await onSubmitReport(lastSubmittedTransactionReport);
    setReplayTestMessage(accepted
      ? "Unexpected result: the identical report transaction succeeded. Check the inbox and report this replay-test failure."
      : "The identical report was rejected. Confirm the failed wallet transaction reports that the exact report is already staged.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingReportFiles || validating) return;
    setFormError(null);
    setValidating(true);
    try {
      if (!serviceAvailabilityPolicy) throw new Error("The pinned service source policy is unavailable.");
      if (blocked) throw new Error("Resolve the pending evaluation or active challenge before requesting another evaluation.");
      if (!operationsReady) {
        throw new Error(`This request needs ${formatNear(executionDeposit - operationsAvailable)} NEAR in evaluator operations. The sponsor must add funds before an evaluation can run.`);
      }
      const parsed: unknown = JSON.parse(reportsJson);
      const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      if (candidates.length === 0 || candidates.length > serviceAvailabilityPolicy.sources.length) {
        throw new Error(`Choose between one and ${serviceAvailabilityPolicy.sources.length} signed reports.`);
      }
      setReportCount(candidates.length);
      const policyHash = await sha256TextHex(JSON.stringify(serviceAvailabilityPolicy));
      const seenSources = new Set<string>();
      const reports = candidates.map((candidate): SignedProbeReport => canonicalizeSignedProbeReport(candidate));
      const chainNowNs = BigInt(await getFinalBlockTimestampNs(RPC_URL));
      const maxReportAgeNs = BigInt(serviceAvailabilityPolicy.max_source_lag_ns);
      const walletConfirmationBufferNs = 30_000_000_000n;
      let canVerifySignatures = true;
      for (const report of reports) {
        const payload = report.payload;
        const source = serviceAvailabilityPolicy.sources.find((item) => item.source_id === payload?.source_id);
        if (!source || seenSources.has(payload.source_id)) {
          throw new Error("Each report must come from a different source pinned by this policy.");
        }
        seenSources.add(payload.source_id);
        if (payload.schema !== "lcp.service_availability.report.v1"
            || payload.contract_id !== CONTRACT_ID
            || payload.commitment_id !== commitment.id
            || payload.evaluation_id !== commitment.next_evaluation_id
            || payload.policy_version !== 3
            || payload.policy_hash !== commitment.policy_hash
            || payload.source_policy_hash !== policyHash
            || payload.operator_id !== source.operator_id
            || payload.target_id !== serviceAvailabilityPolicy.target_id
            || !/^(0|[1-9][0-9]*)$/.test(payload.observed_at_ns)) {
          throw new Error(`Report ${payload.source_id} does not match this commitment and pinned policy. Ask the operator to regenerate it for evaluation #${commitment.next_evaluation_id}.`);
        }
        const observedAtNs = BigInt(payload.observed_at_ns);
        if (observedAtNs > chainNowNs) {
          throw new Error(`Report ${payload.source_id} is timestamped in the future relative to NEAR. Check the operator's system clock and regenerate the report.`);
        }
        const ageNs = chainNowNs - observedAtNs;
        if (ageNs > maxReportAgeNs) {
          throw new Error(`Report ${payload.source_id} is older than the ${formatDuration(serviceAvailabilityPolicy.max_source_lag_ns)} limit. Ask that operator to regenerate it.`);
        }
        if (ageNs + walletConfirmationBufferNs > maxReportAgeNs) {
          throw new Error(`Report ${payload.source_id} is close to the ${formatDuration(serviceAvailabilityPolicy.max_source_lag_ns)} limit. Regenerate it before opening the wallet so it will still be fresh when NEAR processes the request.`);
        }
        const signatureValid = await verifySignedProbeReport(report, source);
        if (signatureValid === false) {
          throw new Error(`Report ${payload.source_id} has an invalid signature. Ask the operator to regenerate it; no transaction was sent.`);
        }
        if (signatureValid === null) canVerifySignatures = false;
      }
      setSignatureCheckAvailable(canVerifySignatures);
      if (JSON.stringify(reports).length > 32_768) throw new Error("The signed report bundle exceeds the 32 KiB evaluator limit.");
      const deposit = parseNearToYocto(DEFAULT_EVALUATION_STORAGE_DEPOSIT);
      await onSubmit(reports, deposit);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Check the signed probe reports and try again.");
    } finally {
      setValidating(false);
    }
  }

  const formBusy = busy || loadingReportFiles || validating;
  const activeInboxReports = data.serviceReportInbox.filter((item) => !item.expired);

  return (
    <section className="content-card evidence-submission">
      <div className="card-heading">
        <div><p className="eyebrow">ACTIVE · MULTI-SOURCE EVIDENCE</p><h3>{transactionAuthenticated ? "Submit service reports" : "Submit signed service probes"}</h3></div>
        <span className="card-index">NEXT · {commitment.next_evaluation_id}</span>
      </div>
      <p className="evidence-intro">
        {transactionAuthenticated
          ? "Each operator works from their own device: connect the listed NEAR account, run the health check, and submit one wallet transaction. The sponsor can request evaluation after the reports arrive."
          : "Operators can check a same-origin health endpoint and sign a report with their NEAR wallet. For other origins, load an approved signed report file. The Console checks freshness and policy bindings before the maintainer or sponsor submits the reports on NEAR."}
      </p>
      {formError && <div ref={errorNoticeRef} className="notice notice-error form-notice" role="alert" tabIndex={-1}><span className="notice-icon">!</span>{formError}</div>}
      {serviceAvailabilityPolicy ? (
        <div className="service-agreement-panel">
          <div><span>QUORUM</span><strong>{serviceAvailabilityPolicy.minimum_agreeing_sources} of {serviceAvailabilityPolicy.sources.length}</strong></div>
          <div><span>MINIMUM COVERAGE</span><strong>{(serviceAvailabilityPolicy.minimum_corroboration_bps / 100).toFixed(2)}%</strong></div>
          <div><span>MAX REPORT AGE</span><strong>{formatDuration(serviceAvailabilityPolicy.max_source_lag_ns)}</strong></div>
        <p>{transactionAuthenticated
          ? "The endpoint URL and salt stay off-chain. Report contents are public on NEAR, and the submitting account is authenticated by its transaction. Quorum and freshness still determine whether the evidence can support a verdict."
          : "The endpoint URL and salt stay off-chain. Signed report contents are public on NEAR. The quorum and freshness rule still decide whether an evaluation can support a verdict."}</p>
        </div>
      ) : <p className="form-wallet-hint">The pinned v3 source policy could not be loaded.</p>}
      {serviceAvailabilityPolicy && (
        <section className="service-report-inbox" aria-label="NEAR service report inbox">
          <div className="service-policy-sources-heading">
            <div><p className="eyebrow">NEAR · PUBLIC REPORTS</p><h4>Report inbox · Evaluation #{commitment.next_evaluation_id}</h4></div>
            <span>{activeInboxReports.length} of {serviceAvailabilityPolicy.sources.length} sources ready</span>
          </div>
          {!data.serviceReportInboxAvailable
            ? <p className="empty-copy" role="status">The report inbox could not load from the connected contract or NEAR RPC. Check the wallet network and refresh; you can still use the signed-report file flow.</p>
            : data.serviceReportInbox.length === 0
            ? <p className="empty-copy">No operators have submitted reports for this evaluation yet.</p>
            : <ul className="service-report-inbox-list">
              {data.serviceReportInbox.map((item) => (
                <li key={`${item.evaluation_id}:${item.source_id}`}>
                  <div><strong>{item.source_id}</strong><span>{item.expired ? "Expired" : "Ready"}</span></div>
                  <p>{serviceReportObservationLabel(item.report)}</p>
                  <small>Submitted by {item.submitted_by} · {formatDate(item.submitted_at_ns)} · expires {formatDate(item.expires_at_ns)}</small>
                  {item.expired && accountId && <button type="button" className="copy-payload-button" onClick={() => void onReclaimReport(item.evaluation_id, item.source_id)} disabled={busy}>Reclaim expired report</button>}
                </li>
              ))}
            </ul>}
          {data.serviceReportInboxAvailable && canRequest && activeInboxReports.length > 0 && (
            <div className="service-inbox-request">
              <p>{activeInboxReports.length < serviceAvailabilityPolicy.minimum_agreeing_sources
                ? `This is below the configured quorum of ${serviceAvailabilityPolicy.minimum_agreeing_sources}; evaluation may be inconclusive.`
                : `The inbox meets the minimum report count of ${serviceAvailabilityPolicy.minimum_agreeing_sources}.`}</p>
              <button type="button" className="lookup-button" onClick={() => void onSubmit(null, parseNearToYocto(DEFAULT_EVALUATION_STORAGE_DEPOSIT))} disabled={busy || blocked || !operationsReady}>
                Request evaluation from {activeInboxReports.length} inbox report{activeInboxReports.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
          {data.serviceReportInboxAvailable && accountId && BigInt(data.serviceReportRefundBalance) > 0n && (
            <div className="service-inbox-refund">
              <p>Withdrawable report storage credit · {formatNear(data.serviceReportRefundBalance)} NEAR</p>
              <button type="button" className="copy-payload-button" onClick={() => void onWithdrawRefund()} disabled={busy}>Withdraw storage refund</button>
            </div>
          )}
          <small>Operators pay a temporary storage bond when submitting. It becomes a withdrawable credit after evaluation, replacement, or expiry; failed refunds can be retried.</small>
        </section>
      )}
      <details className="operator-browser-probe" open>
        <summary>{transactionAuthenticated ? "Submit an operator report" : "Create a signed report with a NEAR wallet"}</summary>
        <p>{transactionAuthenticated
          ? "Operators participate independently. Open this commitment on your own device, connect the listed account, enter the authorized endpoint and private salt, then submit. Your NEAR transaction authorizes and records the report in one wallet approval."
          : "Connect a wallet listed as an operator in this policy. This browser-only check is limited to the same HTTPS origin as the Console, sends no credentials, follows no redirects, and reads no response body. Sign with NEP-413, then submit directly to the NEAR inbox."}</p>
        <div className="form-grid">
          <FormField label="Authorized health endpoint" wide><input type="url" value={browserProbeUrl} onChange={(event) => { setBrowserProbeUrl(event.target.value); setPendingBrowserProbePayload(null); setPendingSignedProbeReport(null); setLastSubmittedTransactionReport(null); setReplayTestMessage(null); }} placeholder="https://your-console.example/health" autoComplete="url" /></FormField>
          <FormField label="Private target salt · 64 lowercase hex" wide><input className="mono-input" value={browserProbeSaltHex} onChange={(event) => { setBrowserProbeSaltHex(event.target.value); setPendingBrowserProbePayload(null); setPendingSignedProbeReport(null); setLastSubmittedTransactionReport(null); setReplayTestMessage(null); }} placeholder="Same 32-byte salt used for the pinned fingerprint" autoComplete="off" /></FormField>
        </div>
        {browserProbeMessage && <p className="form-success-message" role="status" aria-live="polite">{browserProbeMessage}</p>}
        <div className="operator-probe-actions">
          <button className="copy-payload-button" type="button" onClick={() => void runBrowserProbe()} disabled={runningBrowserProbe || busy || !connectedServiceSource || blocked || !serviceAvailabilityPolicy}>
            {runningBrowserProbe && !pendingBrowserProbePayload ? "Checking endpoint…" : "Run health check"}
          </button>
          {pendingBrowserProbePayload && (transactionAuthenticated
            ? <button className="lookup-button" type="button" onClick={() => void submitTransactionAuthenticatedReport()} disabled={runningBrowserProbe || busy || blocked || !data.serviceReportInboxAvailable}>{busy ? "Submitting from wallet…" : "Submit report with NEAR wallet"}</button>
            : <button className="lookup-button" type="button" onClick={() => void signBrowserProbe()} disabled={runningBrowserProbe || busy || blocked}>{runningBrowserProbe ? "Confirming in wallet…" : "Sign report with NEAR wallet"}</button>)}
          {transactionAuthenticated && replayTestEnabled && lastSubmittedTransactionReport && !blocked && (
            <button className="challenge-expire-button" type="button" onClick={() => void repeatTransactionAuthenticatedReport()} disabled={busy || !data.serviceReportInboxAvailable}>
              Repeat identical report · test replay rejection
            </button>
          )}
          {pendingSignedProbeReport && !transactionAuthenticated && <button className="lookup-button" type="button" onClick={() => void submitSignedReportToInbox()} disabled={busy || blocked || !data.serviceReportInboxAvailable}>{busy ? "Submitting report…" : "Submit signed report to NEAR"}</button>}
          {!transactionAuthenticated && reportsJson && <button className="browser-button" type="button" onClick={() => void navigator.clipboard.writeText(reportsJson).then(() => setCopiedReports(true)).catch(() => setFormError("Clipboard access failed. Copy the report JSON from Advanced report input."))}>{copiedReports ? "Reports copied" : "Copy report JSON to share"}</button>}
        </div>
        {!connectedServiceSource
          ? <small>Open this commitment on each operator’s own device and connect the NEAR account listed for that source.</small>
          : <small>Connected operator: {accountId}. {transactionAuthenticated ? "The account will authorize the report by submitting its NEAR transaction." : "The report is signed with that wallet’s existing key."}</small>}
        {transactionAuthenticated && replayTestEnabled && lastSubmittedTransactionReport && !blocked && (
          <small>Replay test enabled: repeat this exact report before the sponsor requests evaluation. Expected contract rejection: “this exact signed report is already staged.”</small>
        )}
        {transactionAuthenticated && replayTestEnabled && replayTestMessage && <p className="form-wallet-hint" role="status" aria-live="polite">{replayTestMessage}</p>}
      </details>
      {commitment.pending_evaluation_id && (
        <div className="pending-evaluation">
          <p className="form-wallet-hint"><strong>Evaluation #{commitment.pending_evaluation_id} is still running.</strong> Wait for the evaluator result before submitting another request{pendingTimeoutNs ? `; its ${formatDuration(data.policy?.evaluator.request_timeout_ns ?? "0")} response deadline is ${formatDate(pendingTimeoutNs)}` : ""}.</p>
          <div className="pending-evaluation-actions">
            <button className="challenge-expire-button" type="button" onClick={() => void onRefresh()} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh status"}
            </button>
            <button className="challenge-expire-button" type="button" onClick={() => void onExpire()} disabled={!accountId || busy || !canExpire}>
              {busy ? "Checking timeout…" : canExpire ? "Expire timed-out evaluation" : timeoutRemainingNs !== null && timeoutRemainingNs > 0n ? `Available in ${formatCountdown(timeoutRemainingNs.toString())}` : "Checking NEAR time…"}
            </button>
          </div>
          <small>Refresh the commitment before retrying. A timed out evaluation is not a service verdict and its evaluator operations deposit is not automatically reusable.</small>
        </div>
      )}
      {commitment.active_challenge_id && <p className="form-wallet-hint">Resolve challenge #{commitment.active_challenge_id} before requesting another evaluation.</p>}
      {!canRequest && !commitment.pending_evaluation_id && <p className="form-wallet-hint">Connect the commitment maintainer or configured sponsor wallet to submit reports.</p>}
      {!operationsReady && !commitment.pending_evaluation_id && (
        <div className="service-operations-blocker" role="status">
          <strong>Evaluator funds needed</strong>
          <span>This request needs {formatNear(executionDeposit - operationsAvailable)} NEAR in evaluator operations. Add funds in the panel above before submitting.</span>
        </div>
      )}
      <form className="service-report-form" onSubmit={(event) => void handleSubmit(event)}>
        {!transactionAuthenticated && <>
        <div className="report-file-picker">
          <label htmlFor="service-report-files">Signed reports · JSON files</label>
          <input id="service-report-files" type="file" accept=".json,application/json" multiple onChange={(event) => void handleReportFilesChange(event)} disabled={formBusy || blocked || !operationsReady} />
          <small>Choose the signed JSON reports from the configured operators. Each file can contain one report or a report array. Files stay in this browser until you submit the NEAR transaction.</small>
          {selectedReportFiles.length > 0 && <p className="report-files-ready" role="status">Loaded {reportCount} signed report{reportCount === 1 ? "" : "s"} from {selectedReportFiles.length} file{selectedReportFiles.length === 1 ? "" : "s"}.</p>}
          {reportCount !== null && reportCount < (serviceAvailabilityPolicy?.minimum_agreeing_sources ?? 0) && <small>This is below the configured quorum of {serviceAvailabilityPolicy?.minimum_agreeing_sources}. You can still submit it for a partial result, which may be inconclusive.</small>}
        </div>
        {signatureCheckAvailable === true && <p className="report-signature-status" role="status">Report signatures verified against the public keys pinned in this commitment.</p>}
        {signatureCheckAvailable === false && <p className="report-signature-status" role="status">This browser could not check Ed25519 signatures locally. The evaluator will still verify them.</p>}
        <details className="advanced-report-input">
          <summary>Advanced: paste report JSON instead</summary>
          <FormField label="Signed report JSON" wide>
            <textarea
              className="mono-input service-report-json"
              value={reportsJson}
              onChange={(event) => {
                setReportsJson(event.target.value);
                setSelectedReportFiles([]);
                setSignatureCheckAvailable(null);
                setPendingBrowserProbePayload(null);
                setPendingSignedProbeReport(null);
                setFormError(null);
                try {
                  const parsed: unknown = JSON.parse(event.target.value);
                  const candidates = Array.isArray(parsed) ? parsed : [parsed];
                  setReportCount(candidates.length);
                } catch {
                  setReportCount(null);
                }
              }}
              placeholder={'[{"payload":{...},"wallet_signature":{...}}]'}
              rows={7}
              spellCheck={false}
              disabled={formBusy || blocked || !operationsReady}
            />
            <small>Paste the complete report object or array from your operators. Wallet reports use NEP-413; legacy reports use a raw Ed25519 hex signature. Do not edit signed fields.</small>
          </FormField>
        </details>
        <div className="creation-submit-row"><p>Manual report submission uses a fixed 0.05 NEAR temporary storage deposit; unused amount is refunded. A timed out or inconclusive evaluation still uses evaluator operations funds.</p><button className="lookup-button" type="submit" disabled={formBusy || !canRequest || blocked || !operationsReady || !serviceAvailabilityPolicy || !reportsJson.trim()}>{loadingReportFiles ? <><span className="spinner" />Loading reports</> : validating && !busy ? <><span className="spinner" />Checking reports</> : busy ? <><span className="spinner" />Requesting evaluation</> : <>Request evaluation <span aria-hidden="true">↗</span></>}</button></div>
        </>}
      </form>
    </section>
  );
}

function serviceReportObservationLabel(report: ServiceProbeReport): string {
  const observation = report.payload.observation;
  switch (observation.kind) {
    case "http_response":
      return `HTTP ${observation.status_code} · ${observation.latency_ms} ms${observation.tls_verified ? " · TLS verified" : " · TLS not verified"}`;
    case "timeout":
      return `No response within ${observation.elapsed_ms} ms`;
    case "tls_error":
      return "TLS connection failed";
    case "source_error":
      return `Operator source error · ${observation.code}`;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOnlySignedReportKeys(value: Record<string, unknown>, allowedKeys: readonly string[], label: string) {
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unsupportedKey) throw new Error(`${label} includes unsupported field “${unsupportedKey}”. Ask the operator to export a fresh report.`);
}

function canonicalizeSignedProbeReport(value: unknown): SignedProbeReport {
  if (!isJsonObject(value)) throw new Error("Each selected file must contain a signed report object.");
  requireOnlySignedReportKeys(value, ["payload", "signature_hex", "wallet_signature"], "Report");
  const hasRawSignature = typeof value.signature_hex === "string" && /^[0-9a-f]{128}$/.test(value.signature_hex);
  const walletSignature = value.wallet_signature === undefined ? null : parseNep413ProbeEnvelope(value.wallet_signature);
  if (!isJsonObject(value.payload) || hasRawSignature === Boolean(walletSignature)
      || (value.signature_hex !== undefined && !hasRawSignature)
      || (value.wallet_signature !== undefined && !walletSignature)) {
    throw new Error("Each report must contain a payload and a valid raw or NEP-413 signature.");
  }

  const payload = value.payload;
  requireOnlySignedReportKeys(payload, [
    "schema", "contract_id", "commitment_id", "evaluation_id", "policy_version", "policy_hash",
    "source_policy_hash", "source_id", "operator_id", "target_id", "observed_at_ns", "observation",
  ], "Report payload");
  for (const key of [
    "schema", "contract_id", "commitment_id", "evaluation_id", "policy_hash", "source_policy_hash",
    "source_id", "operator_id", "target_id", "observed_at_ns",
  ]) {
    if (typeof payload[key] !== "string") throw new Error(`The report payload field “${key}” must be text.`);
  }
  if (payload.policy_version !== 3) throw new Error("This report is not for the service-availability policy version.");
  if (!isJsonObject(payload.observation)) throw new Error("A report is missing its observation.");
  const observation = payload.observation;
  let canonicalObservation: SignedProbeReport["payload"]["observation"];

  switch (observation.kind) {
    case "http_response":
      requireOnlySignedReportKeys(observation, ["kind", "status_code", "latency_ms", "tls_verified"], "HTTP observation");
      if (typeof observation.status_code !== "number" || !Number.isInteger(observation.status_code) || observation.status_code < 100 || observation.status_code > 599
          || typeof observation.latency_ms !== "number" || !Number.isInteger(observation.latency_ms) || observation.latency_ms < 0 || observation.latency_ms > 0xffff_ffff
          || typeof observation.tls_verified !== "boolean") {
        throw new Error("The HTTP observation has invalid status, latency, or TLS fields.");
      }
      canonicalObservation = {
        kind: "http_response",
        status_code: observation.status_code as number,
        latency_ms: observation.latency_ms as number,
        tls_verified: observation.tls_verified,
      };
      break;
    case "timeout":
      requireOnlySignedReportKeys(observation, ["kind", "elapsed_ms"], "Timeout observation");
      if (typeof observation.elapsed_ms !== "number" || !Number.isInteger(observation.elapsed_ms) || observation.elapsed_ms < 0 || observation.elapsed_ms > 0xffff_ffff) {
        throw new Error("The timeout observation has invalid elapsed time.");
      }
      canonicalObservation = { kind: "timeout", elapsed_ms: observation.elapsed_ms as number };
      break;
    case "tls_error":
      requireOnlySignedReportKeys(observation, ["kind"], "TLS observation");
      canonicalObservation = { kind: "tls_error" };
      break;
    case "source_error":
      requireOnlySignedReportKeys(observation, ["kind", "code"], "Source error observation");
      if (typeof observation.code !== "string" || !/^[a-z0-9._-]{1,64}$/.test(observation.code)) {
        throw new Error("The source error code is invalid.");
      }
      canonicalObservation = { kind: "source_error", code: observation.code };
      break;
    default:
      throw new Error("A report contains an unsupported observation type.");
  }

  const canonicalPayload: SignedProbeReport["payload"] = {
    schema: payload.schema as SignedProbeReport["payload"]["schema"],
    contract_id: payload.contract_id as string,
    commitment_id: payload.commitment_id as string,
    evaluation_id: payload.evaluation_id as string,
    policy_version: payload.policy_version as 3,
    policy_hash: payload.policy_hash as string,
    source_policy_hash: payload.source_policy_hash as string,
    source_id: payload.source_id as string,
    operator_id: payload.operator_id as string,
    target_id: payload.target_id as string,
    observed_at_ns: payload.observed_at_ns as string,
    observation: canonicalObservation,
  };
  if (walletSignature) return { payload: canonicalPayload, wallet_signature: walletSignature };
  return {
    payload: canonicalPayload,
    signature_hex: value.signature_hex as string,
  };
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("Expected lowercase hexadecimal bytes.");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function parseNep413ProbeEnvelope(value: unknown): Nep413ProbeSignature | null {
  try {
    if (!isJsonObject(value)) return null;
    const parsed = value;
    requireOnlySignedReportKeys(parsed, ["account_id", "public_key", "signature", "nonce_hex", "recipient", "callback_url"], "NEP-413 report signature");
    if (typeof parsed.account_id !== "string" || typeof parsed.public_key !== "string"
        || typeof parsed.signature !== "string" || typeof parsed.nonce_hex !== "string"
        || typeof parsed.recipient !== "string" || typeof parsed.callback_url !== "string"
        || !/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(parsed.public_key)
        || !/^[0-9a-f]{64}$/.test(parsed.nonce_hex)
        || !/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(parsed.signature)
        || !parsed.recipient || parsed.recipient.length > 64
        || !parsed.callback_url || new TextEncoder().encode(parsed.callback_url).length > 2_048) return null;
    return {
      account_id: parsed.account_id,
      public_key: parsed.public_key as NearEd25519PublicKey,
      signature: parsed.signature,
      nonce_hex: parsed.nonce_hex,
      recipient: parsed.recipient,
      callback_url: parsed.callback_url,
    };
  } catch {
    return null;
  }
}

function nearPublicKeyBytes(publicKey: string): Uint8Array {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(publicKey)) throw new Error("Expected an Ed25519 NEAR public key.");
  const encoded = publicKey.slice("ed25519:".length);
  if (encoded.length > 44) throw new Error("The NEAR public key exceeds the Ed25519 base58 size limit.");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const character of encoded) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("The wallet returned a malformed base58 NEAR public key.");
    value = value * 58n + BigInt(digit);
  }
  const decoded: number[] = [];
  while (value > 0n) {
    decoded.push(Number(value & 0xffn));
    value >>= 8n;
  }
  decoded.reverse();
  const leadingZeroes = encoded.match(/^1*/)?.[0].length ?? 0;
  if (decoded.length + leadingZeroes !== 32) throw new Error("The NEAR public key does not contain 32 Ed25519 bytes.");
  const bytes = new Uint8Array(32);
  bytes.set(decoded, 32 - decoded.length);
  return bytes;
}

function nearPublicKeyHex(publicKey: string): string {
  return Array.from(nearPublicKeyBytes(publicKey), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeCanonicalBase64(value: string, expectedBytes: number): Uint8Array {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  const encoded = btoa(String.fromCharCode(...bytes));
  if (encoded !== value || bytes.length !== expectedBytes) throw new Error("The wallet returned malformed NEP-413 signature bytes.");
  return bytes;
}

function concatenateBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u32leBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error("NEP-413 message field is too large.");
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

async function nep413MessageDigest(message: string, nonceHex: string, recipient: string, callbackUrl: string): Promise<Uint8Array> {
  const messageBytes = new TextEncoder().encode(message);
  const nonceBytes = new Uint8Array(hexToArrayBuffer(nonceHex));
  const recipientBytes = new TextEncoder().encode(recipient);
  const callbackBytes = new TextEncoder().encode(callbackUrl);
  const payload = concatenateBytes([
    u32leBytes(2 ** 31 + 413),
    u32leBytes(messageBytes.length), messageBytes,
    nonceBytes,
    u32leBytes(recipientBytes.length), recipientBytes,
    new Uint8Array([1]),
    u32leBytes(callbackBytes.length), callbackBytes,
  ]);
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(payload).buffer));
}

async function verifyNearWalletMessage(
  message: string,
  nonce: Uint8Array,
  recipient: string,
  callbackUrl: string,
  signed: NearSignedMessage,
): Promise<boolean | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const algorithm = { name: "Ed25519" } as AlgorithmIdentifier;
    const publicKey = await globalThis.crypto.subtle.importKey("raw", Uint8Array.from(nearPublicKeyBytes(signed.publicKey)).buffer, algorithm, false, ["verify"]);
    const nonceHex = Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const digest = await nep413MessageDigest(message, nonceHex, recipient, callbackUrl);
    return await globalThis.crypto.subtle.verify(algorithm, publicKey, decodeCanonicalBase64(signed.signature, 64).buffer as ArrayBuffer, Uint8Array.from(digest).buffer as ArrayBuffer);
  } catch (cause) {
    if (isJsonObject(cause) && cause.name === "NotSupportedError") return null;
    throw new Error("The NEP-413 wallet signature could not be checked in this browser.");
  }
}

async function verifySignedProbeReport(report: SignedProbeReport, source: ServiceAvailabilitySourceInput): Promise<boolean | null> {
  if (!source.public_key_hex) return false;
  const rawSignature = report.signature_hex ?? null;
  const envelope = report.wallet_signature ?? null;
  if (envelope && (envelope.account_id !== source.operator_id
      || envelope.recipient !== CONTRACT_ID
      || nearPublicKeyHex(envelope.public_key) !== source.public_key_hex)) return false;
  if (!globalThis.crypto?.subtle) return null;
  try {
    const algorithm = { name: "Ed25519" } as AlgorithmIdentifier;
    const publicKey = await globalThis.crypto.subtle.importKey("raw", hexToArrayBuffer(source.public_key_hex), algorithm, false, ["verify"]);
    const message = JSON.stringify(report.payload);
    const signatureBytes = rawSignature
      ? new Uint8Array(hexToArrayBuffer(rawSignature))
      : envelope
        ? decodeCanonicalBase64(envelope.signature, 64)
        : null;
    if (!signatureBytes) return false;
    const signedMessage = envelope
      ? await nep413MessageDigest(message, envelope.nonce_hex, envelope.recipient, envelope.callback_url)
      : new TextEncoder().encode(message);
    return await globalThis.crypto.subtle.verify(
      algorithm,
      publicKey,
      Uint8Array.from(signatureBytes).buffer,
      Uint8Array.from(signedMessage).buffer,
    );
  } catch (cause) {
    if (isJsonObject(cause) && cause.name === "NotSupportedError") return null;
    throw new Error("The report signature could not be checked in this browser.");
  }
}

async function sha256TextHex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function EvidenceSubmissionCard({
  data,
  accountId,
  busy,
  pendingTimeoutNs,
  onExpire,
  onSubmit,
  onSignMessage,
}: {
  data: CommitmentData;
  accountId: string | null;
  busy: boolean;
  pendingTimeoutNs: string | null;
  onExpire: () => Promise<void>;
  onSubmit: (evidence: SignedHeartbeatEvidence, storageDeposit: string) => Promise<void>;
  onSignMessage: (message: string, nonce: Uint8Array, recipient: string, callbackUrl: string) => Promise<NearSignedMessage>;
}) {
  const { commitment, policy } = data;
  const artifactFileInputRef = useRef<HTMLInputElement | null>(null);
  const [artifactHash, setArtifactHash] = useState("");
  const [artifactFileName, setArtifactFileName] = useState("");
  const [artifactFileSize, setArtifactFileSize] = useState(0);
  const [hashingArtifact, setHashingArtifact] = useState(false);
  const [observedAt, setObservedAt] = useState("");
  const [payload, setPayload] = useState("");
  const [signature, setSignature] = useState("");
  const [walletEvidence, setWalletEvidence] = useState<Extract<SignedHeartbeatEvidence, { signature_scheme: "near_nep413" }> | null>(null);
  const [signing, setSigning] = useState(false);
  const [storageDepositNear, setStorageDepositNear] = useState(DEFAULT_EVALUATION_STORAGE_DEPOSIT);
  const [formError, setFormError] = useState<string | null>(null);
  const canRequest = Boolean(accountId && (accountId === commitment.maintainer
    || (policy?.version === 1 && accountId === policy.budget.sponsor)));
  const blocked = Boolean(commitment.pending_evaluation_id || commitment.active_challenge_id);

  function invalidatePreparedEvidence() {
    setArtifactHash("");
    setArtifactFileName("");
    setArtifactFileSize(0);
    setPayload("");
    setObservedAt("");
    setSignature("");
    setWalletEvidence(null);
  }

  async function handleArtifactFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setFormError(null);
    invalidatePreparedEvidence();
    if (file.size === 0) {
      event.currentTarget.value = "";
      setFormError("Choose a non-empty evidence file.");
      return;
    }
    if (file.size > MAX_EVIDENCE_ARTIFACT_BYTES) {
      event.currentTarget.value = "";
      setFormError("Evidence files must be 25 MiB or smaller so the browser can hash them safely.");
      return;
    }

    setHashingArtifact(true);
    try {
      if (!globalThis.crypto?.subtle) {
        throw new Error("This browser does not support secure local file hashing.");
      }
      const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      setArtifactHash(hash);
      setArtifactFileName(file.name);
      setArtifactFileSize(file.size);
    } catch (cause) {
      if (artifactFileInputRef.current) artifactFileInputRef.current.value = "";
      setFormError(cause instanceof Error ? cause.message : "The evidence file could not be hashed.");
    } finally {
      setHashingArtifact(false);
    }
  }

  function clearArtifactFile() {
    if (artifactFileInputRef.current) artifactFileInputRef.current.value = "";
    invalidatePreparedEvidence();
    setFormError(null);
  }

  async function preparePayload() {
    setFormError(null);
    try {
      if (!policy) throw new Error("Policy details are unavailable for this commitment.");
      if (blocked) throw new Error("Resolve the pending evaluation or active challenge before preparing a new request.");
      if (!artifactFileName || !/^[0-9a-f]{64}$/.test(artifactHash)) {
        throw new Error("Choose an evidence file and wait for its SHA-256 digest to finish.");
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
        pinned_public_key_hex: policy.version === 1 ? policy.evidence.maintainer_public_key_hex : undefined,
      };
      setPayload(buildHeartbeatSigningPayload(input));
      setObservedAt(observedAtNs);
      setSignature("");
      setWalletEvidence(null);
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

  async function copyArtifactHash() {
    try {
      await navigator.clipboard.writeText(artifactHash);
    } catch {
      setFormError("Clipboard access failed. Select and copy the digest manually.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      if (!policy || !payload) throw new Error("Prepare the canonical signing payload first.");
      let evidence: SignedHeartbeatEvidence;
      if (policy.version === 2) {
        if (!walletEvidence) throw new Error("Sign this observation with the connected maintainer wallet first.");
        evidence = walletEvidence;
      } else {
        if (!policy.evidence.maintainer_public_key_hex) throw new Error("This legacy policy is missing its pinned Ed25519 public key.");
        if (!/^[0-9a-f]{128}$/.test(signature)) {
          throw new Error("Legacy v1 commitments require a 64-byte Ed25519 signature as 128 lowercase hexadecimal characters.");
        }
        evidence = {
          type: "signed_maintenance_heartbeat",
          artifact_hash: artifactHash,
          maintainer_public_key: policy.evidence.maintainer_public_key_hex,
          signature,
          payload,
        };
      }
      const deposit = parseNearToYocto(storageDepositNear);
      if (BigInt(deposit) === 0n) throw new Error("Request storage deposit must be greater than zero.");
      await onSubmit(evidence, deposit);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Check the signed evidence and try again.");
    }
  }

  async function signWithWallet() {
    setSigning(true);
    setFormError(null);
    try {
      if (!policy?.evidence.maintainer_key_fingerprint_hex) {
        throw new Error("This v2 policy does not expose its pinned NEAR key fingerprint.");
      }
      if (!accountId || accountId !== commitment.maintainer) {
        throw new Error(`Connect the maintainer wallet ${commitment.maintainer} before signing this observation.`);
      }
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const callbackUrl = window.location.origin;
      const signed = await onSignMessage(payload, nonce, CONTRACT_ID, callbackUrl);
      const nonceHex = Array.from(nonce, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const input: HeartbeatSigningInput = {
        commitment_id: commitment.id,
        evaluation_id: commitment.next_evaluation_id,
        policy_version: commitment.policy_version,
        policy_hash: commitment.policy_hash,
        observed_at_ns: observedAt,
        subject: commitment.subject,
        artifact_hash: artifactHash,
      };
      const evidence = await createNep413HeartbeatEvidence(
        input,
        signed,
        commitment.maintainer,
        policy.evidence.maintainer_key_fingerprint_hex,
        nonceHex,
        CONTRACT_ID,
        callbackUrl,
      );
      setWalletEvidence(evidence);
      setFormError(null);
    } catch (cause) {
      setWalletEvidence(null);
      setFormError(cause instanceof Error ? cause.message : "The connected wallet could not sign this observation.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <section className="content-card evidence-submission">
      <div className="card-heading">
        <div><p className="eyebrow">ACTIVE · HEARTBEAT EVIDENCE</p><h3>Submit a signed observation</h3></div>
        <span className="card-index">NEXT · {commitment.next_evaluation_id}</span>
      </div>
      <p className="evidence-intro">This form prepares a commitment-bound message using finalized NEAR block time. {policy?.version === 2 ? "Your connected NEAR wallet signs it with NEP-413; the private key stays in the wallet." : "This older policy uses the original raw Ed25519 format and cannot use NEP-413 wallet signing."} Submit it within the policy’s {formatDuration(policy?.temporal.max_source_lag_ns ?? "0")} source-lag window; regenerate it if it gets stale.</p>
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
      {!canRequest && !commitment.pending_evaluation_id && <p className="form-wallet-hint">{policy?.version === 2 ? `Connect the maintainer wallet ${commitment.maintainer} to sign this evaluation.` : "Connect the maintainer or sponsor wallet to submit an evaluation request."}</p>}
      {policy?.version === 2 && accountId && accountId !== commitment.maintainer && <p className="form-wallet-hint">NEP-413 evidence must be signed by the maintainer account {commitment.maintainer}.</p>}
      <div className="form-grid evidence-form-grid">
        <FormField label="Evidence artifact file" wide>
          <input ref={artifactFileInputRef} className="artifact-file-input" type="file" onChange={(event) => void handleArtifactFileChange(event)} disabled={hashingArtifact || signing || busy} aria-describedby="artifact-file-help" />
          <small id="artifact-file-help" className="artifact-help">Choose the report or record for this observation. SHA-256 is calculated in this browser; the file stays on this device and is not uploaded. Share it separately with reviewers who need to inspect it. Maximum size: 25 MiB.</small>
        </FormField>
        {hashingArtifact && <p className="artifact-file-status" role="status" aria-live="polite">Calculating SHA-256 locally…</p>}
        {artifactHash && (
          <>
            <p className="artifact-file-status" role="status" aria-live="polite">Ready: <strong>{artifactFileName}</strong> · {artifactFileSize.toLocaleString()} bytes</p>
            <div className="artifact-digest-row">
              <input className="mono-input" aria-label="Computed evidence artifact SHA-256" value={artifactHash} readOnly />
              <button className="copy-payload-button" type="button" onClick={() => void copyArtifactHash()}>Copy digest</button>
              <button className="copy-payload-button" type="button" onClick={clearArtifactFile} disabled={signing || busy}>Remove file</button>
            </div>
          </>
        )}
      </div>
      <button className="prepare-payload-button" type="button" onClick={() => void preparePayload()} disabled={!canRequest || blocked || busy || hashingArtifact || !artifactHash}>
        Prepare canonical signing payload <span aria-hidden="true">↗</span>
      </button>
      {payload && policy && (
        <form className="evidence-signing-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="digest-row"><span>OBSERVED AT · FINAL NEAR BLOCK</span><code>{observedAt}</code></div>
          <FormField label="Commitment-bound message" wide><textarea className="mono-input signing-payload" value={payload} readOnly rows={6} /></FormField>
          {policy.version === 2 ? (
            <div className="wallet-signing-panel">
              <button className="copy-payload-button" type="button" onClick={() => void copyPayload()}>Copy message</button>
              <button className="prepare-payload-button" type="button" onClick={() => void signWithWallet()} disabled={signing || busy || !canRequest || blocked}>
                {signing ? "Waiting for wallet…" : walletEvidence ? "Signed by maintainer wallet ✓" : "Sign with maintainer wallet ↗"}
              </button>
              <small>NEP-413 binds this signature to {CONTRACT_ID}, a random nonce, and this page’s callback URL.</small>
            </div>
          ) : (
            <>
              <button className="copy-payload-button" type="button" onClick={() => void copyPayload()}>Copy legacy signing payload</button>
              <div className="form-wallet-hint" role="note">This commitment predates wallet-signature policies. Preserve its raw Ed25519 signature format; new commitments use wallet signing.</div>
            </>
          )}
          <div className="form-grid evidence-form-grid">
            {policy.version === 1 && <FormField label="Legacy Ed25519 signature · 128 lowercase hex" wide><input className="mono-input" value={signature} onChange={(event) => setSignature(event.target.value)} maxLength={128} placeholder="Paste legacy signature" /></FormField>}
            <FormField label="Request storage deposit · NEAR"><input inputMode="decimal" value={storageDepositNear} onChange={(event) => setStorageDepositNear(event.target.value)} /><small>Includes the maximum evaluator callback reserve. The contract refunds any excess.</small></FormField>
          </div>
          {formError && <div className="notice notice-error form-notice" role="alert"><span className="notice-icon">!</span>{formError}</div>}
          <div className="creation-submit-row"><p>Requesting evaluation spends the evaluator execution budget and reserves callback storage. The contract validates the signature scheme, key pin, and request binding.</p><button className="lookup-button" type="submit" disabled={busy || signing || !canRequest || blocked || (policy.version === 1 ? !signature : !walletEvidence)}>{busy ? <><span className="spinner" />Requesting evaluation</> : <>Request evaluation <span aria-hidden="true">↗</span></>}</button></div>
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
  const canClose = Boolean(accountId && [commitment.creator, commitment.maintainer, commitment.arbiter, policy?.budget.sponsor].includes(accountId));
  const canRefund = accountId === policy?.budget.sponsor;
  const residualYocto = escrow?.free_yocto ?? "0";
  const hasResidual = BigInt(residualYocto) > 0n;
  const pendingYocto = escrow?.pending_yocto ?? "0";
  const hasRefundPending = BigInt(pendingYocto) > 0n;
  const refundedYocto = escrow?.refunded_yocto ?? "0";
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
                <div className="closure-refund-deposit"><span>REFUND REQUEST STORAGE BOND</span><strong>{DEFAULT_STORAGE_DEPOSIT} NEAR</strong></div>
                <button type="button" onClick={() => void onAction("refund", DEFAULT_STORAGE_DEPOSIT)} disabled={!canRefund || busyAction !== null}>{busyAction === "refund" ? "Requesting refund…" : "Refund residual escrow"}</button>
              </div>
              <small className="closure-help">The refund sends {formatNear(residualYocto)} NEAR to {policy?.budget.sponsor}. The app attaches {DEFAULT_STORAGE_DEPOSIT} NEAR for storage; the contract calculates the required bond and returns any excess. The transfer settles asynchronously.</small>
            </>
          ) : hasRefundPending ? (
            <div className="closure-refund-pending"><strong>Refund transfer in progress</strong><span>{formatNear(pendingYocto)} NEAR is awaiting transfer reconciliation. Refresh after it settles.</span></div>
          ) : BigInt(refundedYocto) > 0n ? (
            <div className="closure-refund-pending"><strong>Refund complete</strong><span>{formatNear(refundedYocto)} NEAR has been returned to the sponsor.</span></div>
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

function ActiveOperationsFundingCard({
  data,
  accountId,
  operationsFundingNear,
  busyAction,
  onOperationsFundingChange,
  onFund,
}: {
  data: CommitmentData;
  accountId: string | null;
  operationsFundingNear: string;
  busyAction: SetupAction | null;
  onOperationsFundingChange: (value: string) => void;
  onFund: (action: SetupAction) => Promise<void>;
}) {
  const { commitment, policy } = data;
  if (!policy) return null;

  const operationsFunded = BigInt(commitment.operations_funded_yocto);
  const operationsSpent = BigInt(commitment.operations_authorized_spend_yocto);
  const operationsAvailable = operationsFunded - operationsSpent;
  const executionDeposit = BigInt(policy.evaluator.execution_deposit_yocto);
  const sponsorCanFund = accountId === policy.budget.sponsor;
  const busy = busyAction !== null;

  return (
    <section className="content-card active-operations-funding">
      <div className="card-heading">
        <div><p className="eyebrow">ACTIVE · EVALUATOR OPERATIONS</p><h3>Keep evaluations funded</h3></div>
        <span className="card-index">SPONSOR FUNDED</span>
      </div>
      <div className="operations-funding-summary">
        <div><span>AVAILABLE</span><strong>{formatNear(operationsAvailable)} NEAR</strong></div>
        <div><span>PER EVALUATION</span><strong>{formatNear(executionDeposit)} NEAR</strong></div>
      </div>
      <p className="operations-funding-copy">
        {operationsAvailable >= executionDeposit
          ? "Operations funds are separate from escrow. The sponsor can add more while this commitment is active."
          : `Another evaluation needs at least ${formatNear(executionDeposit - operationsAvailable)} NEAR in additional operations funds. If policy allows recovery, fresh compliant evidence can restore a breached commitment.`}
      </p>
      {sponsorCanFund ? (
        <div className="operations-funding-row">
          <FormField label="Add evaluator operations · NEAR">
            <input inputMode="decimal" value={operationsFundingNear} onChange={(event) => onOperationsFundingChange(event.target.value)} />
          </FormField>
          <button className="lookup-button" type="button" onClick={() => void onFund("operations")} disabled={busy}>
            {busyAction === "operations" ? <><span className="spinner" />Funding operations</> : <>Add funds <span aria-hidden="true">↗</span></>}
          </button>
        </div>
      ) : <p className="form-wallet-hint">Connect sponsor wallet {policy.budget.sponsor} to add evaluator operations.</p>}
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
  busyAction: SetupAction | null;
  onEscrowFundingChange: (value: string) => void;
  onOperationsFundingChange: (value: string) => void;
  onActivationStorageChange: (value: string) => void;
  onAction: (action: SetupAction) => Promise<void>;
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

interface ServicePolicyDraft {
  targetId: string;
  sources: ServiceAvailabilitySourceInput[];
  expectedStatusMin: string;
  expectedStatusMax: string;
  maxLatencyMs: string;
  minimumAgreeingSources: string;
  minimumCorroborationPercent: string;
}

type PolicyTemplateValues = Pick<
  CreationFields,
  | "subject"
  | "initialWindowSeconds"
  | "evidenceTtlSeconds"
  | "graceSeconds"
  | "maxSourceLagSeconds"
  | "challengeWindowSeconds"
  | "resolutionTimeoutSeconds"
  | "recoveryAllowed"
  | "epochSeconds"
  | "maxEpochs"
  | "trancheNear"
>;

const POLICY_TEMPLATES: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  values: PolicyTemplateValues;
}> = [
  {
    id: "open-source-maintenance",
    name: "Open-source infrastructure maintenance · testnet",
    description: "Short windows for the recurring service-maintenance walkthrough.",
    values: {
      subject: "Open-source service maintenance",
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
    },
  },
  {
    id: "community-service-continuity",
    name: "Community service continuity · illustrative",
    description: "Longer windows for recurring public-goods operations, such as community water access.",
    values: {
      subject: "Maintain the community water access service",
      initialWindowSeconds: "604800",
      evidenceTtlSeconds: "604800",
      graceSeconds: "172800",
      maxSourceLagSeconds: "86400",
      challengeWindowSeconds: "43200",
      resolutionTimeoutSeconds: "172800",
      recoveryAllowed: true,
      epochSeconds: "2592000",
      maxEpochs: "12",
      trancheNear: "0.01",
    },
  },
];

function CreateCommitmentForm({
  connectedAccountId,
  contractConfigured,
  busy,
  onCreate,
  onPinMaintainerKey,
}: {
  connectedAccountId: string | null;
  contractConfigured: boolean;
  busy: boolean;
  onCreate: (args: CreateCommitmentArgs | CreateServiceAvailabilityCommitmentArgs, storageDeposit: string) => Promise<void>;
  onPinMaintainerKey: (accountId: string) => Promise<{ accountId: string; publicKey: NearEd25519PublicKey; fingerprint: string }>;
}) {
  const errorNoticeRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);
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
  const [selectedTemplateId, setSelectedTemplateId] = useState(POLICY_TEMPLATES[0].id);
  const [evidenceMode, setEvidenceMode] = useState<"heartbeat" | "service_availability">("heartbeat");
  const [servicePolicy, setServicePolicy] = useState<ServicePolicyDraft>({
    targetId: "",
    sources: [
      { source_id: "operator-a", operator_id: "" },
      { source_id: "operator-b", operator_id: "" },
    ],
    expectedStatusMin: "200",
    expectedStatusMax: "299",
    maxLatencyMs: "1500",
    minimumAgreeingSources: "2",
    minimumCorroborationPercent: "60",
  });
  const [targetUrl, setTargetUrl] = useState("");
  const [targetSaltHex, setTargetSaltHex] = useState("");
  const [targetFingerprintMessage, setTargetFingerprintMessage] = useState<string | null>(null);
  const [targetFingerprintError, setTargetFingerprintError] = useState<string | null>(null);
  const [generatingTargetFingerprint, setGeneratingTargetFingerprint] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pinnedKeyAccountId, setPinnedKeyAccountId] = useState<string | null>(null);
  const [keyFingerprint, setKeyFingerprint] = useState<string | null>(null);
  const [pinningKey, setPinningKey] = useState(false);

  function update<K extends keyof CreationFields>(key: K, value: CreationFields[K]) {
    if (key === "maintainer") {
      setFields((current) => current.maintainer === value
        ? current
        : { ...current, maintainer: value as string, maintainerPublicKey: "" });
      if (fields.maintainer !== value) {
        setPinnedKeyAccountId(null);
        setKeyFingerprint(null);
      }
      return;
    }
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function pinConnectedMaintainerKey() {
    setPinningKey(true);
    setFormError(null);
    try {
      const intendedAccountId = fields.maintainer.trim() || connectedAccountId || "";
      if (!intendedAccountId) throw new Error("Enter the maintainer account or connect its wallet.");
      const pinned = await onPinMaintainerKey(intendedAccountId);
      setFields((current) => ({ ...current, maintainer: pinned.accountId, maintainerPublicKey: pinned.publicKey }));
      setPinnedKeyAccountId(pinned.accountId);
      setKeyFingerprint(pinned.fingerprint);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "The maintainer wallet key could not be pinned.");
    } finally {
      setPinningKey(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      const intendedAccountId = fields.maintainer.trim() || connectedAccountId || "";
      if (!pinnedKeyAccountId || pinnedKeyAccountId !== intendedAccountId) {
        throw new Error("Pin the connected maintainer wallet key before creating this commitment.");
      }
      const baseArgs = buildCreateCommitmentArgs(fields, connectedAccountId);
      const args = evidenceMode === "service_availability"
        ? {
          ...baseArgs,
          service_availability: buildServiceAvailabilityPolicy(
            servicePolicy,
            secondsToNanoseconds(fields.maxSourceLagSeconds, "Maximum source lag"),
            secondsToNanoseconds(fields.evidenceTtlSeconds, "Evidence freshness TTL"),
          ),
        }
        : baseArgs;
      const storageDeposit = parseNearToYocto(fields.storageDepositNear);
      if (BigInt(storageDeposit) === 0n) throw new Error("Storage deposit must be greater than zero.");
      await onCreate(args, storageDeposit);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Check the commitment details and try again.");
    }
  }

  const escrowPreview = previewEscrow(fields.maxEpochs, fields.trancheNear);
  const account = (value: string) => value || connectedAccountId || "";
  const selectedTemplate = POLICY_TEMPLATES.find((template) => template.id === selectedTemplateId);

  function applyPolicyTemplate(templateId: string) {
    const template = POLICY_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) return;
    setSelectedTemplateId(template.id);
    setFields((current) => ({ ...current, ...template.values }));
    setFormError(null);
  }

  function updateServiceSources(sources: ServiceAvailabilitySourceInput[]) {
    setServicePolicy((current) => {
      const majority = Math.floor(sources.length / 2) + 1;
      const currentThreshold = Number(current.minimumAgreeingSources);
      return {
        ...current,
        sources,
        minimumAgreeingSources: String(Math.min(sources.length, Math.max(majority, Number.isInteger(currentThreshold) ? currentThreshold : majority))),
      };
    });
  }

  async function generateTargetFingerprint() {
    setGeneratingTargetFingerprint(true);
    setTargetFingerprintError(null);
    setTargetFingerprintMessage(null);
    try {
      const fingerprint = await fingerprintServiceTarget(targetUrl, targetSaltHex);
      setServicePolicy((current) => ({ ...current, targetId: fingerprint }));
      setTargetFingerprintMessage("Fingerprint generated in this browser. The URL and salt were not added to the commitment policy.");
    } catch (cause) {
      setTargetFingerprintError(cause instanceof Error ? cause.message : "The service target fingerprint could not be generated.");
    } finally {
      setGeneratingTargetFingerprint(false);
    }
  }

  function generateTargetSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    setTargetSaltHex(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    setTargetFingerprintMessage("A new 32-byte salt was generated in this browser. Save it securely and share it only with authorized operators.");
    setTargetFingerprintError(null);
  }

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (formError) errorNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [formError]);

  return (
    <form className="creation-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <div className="creation-intro"><p>Choose a starter policy, confirm who is involved, and add the evaluator artifact. Timing and runtime tuning use safe defaults and stay under Advanced settings.</p><span>GUIDED SETUP</span></div>
      {formError && <div ref={errorNoticeRef} className="notice notice-error form-notice" role="alert" tabIndex={-1}><span className="notice-icon">!</span>{formError}</div>}
      <div className="form-grid">
        <FormField label="Starter policy template" wide>
          <select value={selectedTemplateId} onChange={(event) => applyPolicyTemplate(event.target.value)}>
            {POLICY_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </FormField>
      </div>
      <p className="policy-template-note">{selectedTemplate?.description} The starter sets the schedule and budget defaults. Review the people, evidence, and total escrow before creating the draft.</p>
      <div className="form-grid">
        <FormField label="Evidence model" wide>
          <select value={evidenceMode} onChange={(event) => {
            const nextMode = event.target.value as "heartbeat" | "service_availability";
            setEvidenceMode(nextMode);
            setFields((current) => ({
              ...current,
              storageDepositNear: nextMode === "service_availability"
                ? DEFAULT_SERVICE_COMMITMENT_STORAGE_DEPOSIT
                : DEFAULT_STORAGE_DEPOSIT,
            }));
          }}>
            <option value="heartbeat">Maintainer-signed heartbeat · v2</option>
            <option value="service_availability">Independent service probes · v3</option>
          </select>
        </FormField>
      </div>
      {evidenceMode === "service_availability" && (
        <section className="service-policy-builder" aria-labelledby="service-policy-title">
          <div className="service-policy-builder-heading">
            <div><h3 id="service-policy-title">Service and operator setup</h3><p>Set the service identity and operator accounts. Each operator joins later from their own device and NEAR wallet.</p></div>
            <span>2–8 SOURCES</span>
          </div>
          <FormField label="Service target fingerprint · 64 lowercase hex" wide>
            <input className="mono-input" value={servicePolicy.targetId} onChange={(event) => setServicePolicy((current) => ({ ...current, targetId: event.target.value }))} placeholder="Generate it below or paste a fingerprint" required pattern="[0-9a-f]{64}" />
            <small>The commitment stores this fingerprint, never the health endpoint URL or its private salt.</small>
          </FormField>
          <details className="guided-advanced target-fingerprint-tool">
            <summary>Generate the fingerprint in this app</summary>
            <p>Enter the endpoint and private salt used by the operators. The browser hashes them locally and does not include either value in the NEAR transaction. Keep both private and share them only with authorized operators.</p>
            <div className="form-grid">
              <FormField label="Private HTTPS health endpoint" wide><input type="url" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://status.example.org/health" autoComplete="url" /></FormField>
              <div className="form-field form-field-wide"><label htmlFor="service-target-salt">Private target salt · 64 lowercase hex</label><div className="maintainer-key-input"><input id="service-target-salt" className="mono-input" value={targetSaltHex} onChange={(event) => setTargetSaltHex(event.target.value)} placeholder="Generate a new 32-byte salt" autoComplete="off" /><button className="browser-button" type="button" onClick={generateTargetSalt}>Generate salt</button></div></div>
            </div>
            {targetFingerprintError && <p className="notice notice-error form-notice" role="alert">{targetFingerprintError}</p>}
            {targetFingerprintMessage && <p className="form-success-message" role="status" aria-live="polite">{targetFingerprintMessage}</p>}
            <button className="copy-payload-button" type="button" onClick={() => void generateTargetFingerprint()} disabled={generatingTargetFingerprint || !targetUrl.trim() || !targetSaltHex.trim()}>
              {generatingTargetFingerprint ? "Generating…" : "Generate target fingerprint"}
            </button>
          </details>
          <div className="service-policy-sources">
            <div className="service-policy-sources-heading"><div><h4>Operator accounts</h4><p>List one distinct NEAR account per source. Operators do not need to be present during setup.</p></div>
              <button className="browser-button" type="button" onClick={() => {
                if (servicePolicy.sources.length >= 8) return;
                let suffix = 1;
                const existing = new Set(servicePolicy.sources.map((source) => source.source_id));
                while (existing.has(`operator-${suffix}`)) suffix += 1;
                updateServiceSources([...servicePolicy.sources, { source_id: `operator-${suffix}`, operator_id: "" }]);
              }} disabled={servicePolicy.sources.length >= 8}>Add operator</button>
            </div>
            {servicePolicy.sources.map((source, index) => (
              <div className="service-policy-source-row" key={`${source.source_id}:${index}`}>
                <div className="service-policy-source-row-heading"><strong>Operator {index + 1}</strong>
                  {servicePolicy.sources.length > 2 && <button className="remove-source-button" type="button" onClick={() => updateServiceSources(servicePolicy.sources.filter((_, sourceIndex) => sourceIndex !== index))} aria-label={`Remove operator ${source.source_id || index + 1}`}>Remove</button>}
                </div>
                <div className="form-grid service-operator-fields">
                  <FormField label="Source label"><input value={source.source_id} onChange={(event) => updateServiceSources(servicePolicy.sources.map((item, sourceIndex) => sourceIndex === index ? { ...item, source_id: event.target.value } : item))} placeholder="operator-a" autoComplete="off" required /></FormField>
                  <FormField label="NEAR operator account"><input value={source.operator_id} onChange={(event) => updateServiceSources(servicePolicy.sources.map((item, sourceIndex) => sourceIndex === index ? { ...item, operator_id: event.target.value } : item))} placeholder="operator-a.testnet" autoComplete="username" required /></FormField>
                </div>
                <small className="form-wallet-hint">The account name is public. Its owner authorizes each report by submitting the report transaction from that wallet.</small>
              </div>
            ))}
            <p className="service-policy-privacy-note">The operator roster and report contents are public. The service URL and salt stay private with the operators. Each operator connects only when submitting their own report.</p>
          </div>
          <details className="guided-advanced">
            <summary>Advanced service rules</summary>
            <p>A strict majority is required. Higher thresholds can reduce false conclusions when you have more operators.</p>
            <div className="form-grid form-grid-3">
              <FormField label="Expected HTTP status from"><input type="number" min="100" max="599" step="1" value={servicePolicy.expectedStatusMin} onChange={(event) => setServicePolicy((current) => ({ ...current, expectedStatusMin: event.target.value }))} required /></FormField>
              <FormField label="Expected HTTP status through"><input type="number" min="100" max="599" step="1" value={servicePolicy.expectedStatusMax} onChange={(event) => setServicePolicy((current) => ({ ...current, expectedStatusMax: event.target.value }))} required /></FormField>
              <FormField label="Maximum response time · ms"><input type="number" min="1" max="4294967295" step="1" value={servicePolicy.maxLatencyMs} onChange={(event) => setServicePolicy((current) => ({ ...current, maxLatencyMs: event.target.value }))} required /></FormField>
              <FormField label="Reports needed for a verdict"><select value={servicePolicy.minimumAgreeingSources} onChange={(event) => setServicePolicy((current) => ({ ...current, minimumAgreeingSources: event.target.value }))}>{Array.from({ length: servicePolicy.sources.length - Math.floor(servicePolicy.sources.length / 2) }, (_, index) => Math.floor(servicePolicy.sources.length / 2) + 1 + index).map((count) => <option key={count} value={count}>{count} of {servicePolicy.sources.length}</option>)}</select></FormField>
              <FormField label="Minimum agreement · percent"><input type="number" min="0" max="100" step="1" value={servicePolicy.minimumCorroborationPercent} onChange={(event) => setServicePolicy((current) => ({ ...current, minimumCorroborationPercent: event.target.value }))} required /></FormField>
            </div>
          </details>
        </section>
      )}
      <div className="creation-section-heading"><span>01</span><div><h3>People and commitment</h3><small>Choose the accountable party, sponsor, reviewer, and beneficiary.</small></div></div>
      <div className="form-grid">
        <FormField label="Commitment subject" wide><input maxLength={128} value={fields.subject} onChange={(event) => update("subject", event.target.value)} placeholder="e.g. Maintain the community API" required /></FormField>
        <FormField label="Maintainer account"><input value={account(fields.maintainer)} onChange={(event) => update("maintainer", event.target.value)} placeholder="maintainer.testnet" required /></FormField>
        <FormField label="Arbiter account"><input value={account(fields.arbiter)} onChange={(event) => update("arbiter", event.target.value)} placeholder="arbiter.testnet" required /></FormField>
        <FormField label="Sponsor account"><input value={account(fields.sponsor)} onChange={(event) => update("sponsor", event.target.value)} placeholder="sponsor.testnet" required /></FormField>
        <FormField label="Beneficiary account"><input value={account(fields.beneficiary)} onChange={(event) => update("beneficiary", event.target.value)} placeholder="beneficiary.testnet" required /></FormField>
      </div>

      <div className="creation-section-heading"><span>02</span><div><h3>Evidence and evaluator</h3><small>Pin the maintainer wallet and the exact evaluator artifact.</small></div></div>
      <div className="form-grid">
        <div className="form-field form-field-wide">
          <label htmlFor="maintainer-wallet-key">Maintainer NEAR wallet key</label>
          <div className="maintainer-key-input">
            <input id="maintainer-wallet-key" className="mono-input" value={fields.maintainerPublicKey} readOnly placeholder="Connect the maintainer wallet and pin its public key" required />
            <button className="copy-payload-button" type="button" onClick={() => void pinConnectedMaintainerKey()} disabled={!connectedAccountId || pinningKey || busy}>
              {pinningKey ? "Confirm in wallet…" : fields.maintainerPublicKey ? "Repin wallet key" : "Pin connected wallet key"}
            </button>
          </div>
          {keyFingerprint && <small className="form-wallet-hint">Pinned key fingerprint · <code>{keyFingerprint}</code> · signed by {pinnedKeyAccountId}</small>}
          {!connectedAccountId && <small className="form-wallet-hint">Connect the maintainer’s NEAR wallet first. The key is read from a NEP-413 wallet signature.</small>}
        </div>
        <FormField label="Evaluator WASM HTTPS URL" wide><input value={fields.wasmUrl} onChange={(event) => update("wasmUrl", event.target.value)} placeholder={evidenceMode === "service_availability" ? "https://…/service-availability-evaluator.wasm" : "https://…/maintenance-heartbeat.wasm"} required /></FormField>
        <FormField label="Evaluator WASM SHA-256 · 64 lowercase hex" wide><input className="mono-input" value={fields.wasmSha256} onChange={(event) => update("wasmSha256", event.target.value)} placeholder="Digest of the exact uploaded WASM file" required /></FormField>
      </div>

      <div className="creation-section-heading"><span>03</span><div><h3>Funding schedule</h3><small>Set recurring support and review the full escrow target.</small></div></div>
      <div className="form-grid form-grid-3">
        <FormField label="Payment interval · sec"><input type="number" min="1" step="1" value={fields.epochSeconds} onChange={(event) => update("epochSeconds", event.target.value)} required /></FormField>
        <FormField label="Number of payments"><input type="number" min="1" max="64" step="1" value={fields.maxEpochs} onChange={(event) => update("maxEpochs", event.target.value)} required /></FormField>
        <FormField label="Payment amount · NEAR"><input inputMode="decimal" value={fields.trancheNear} onChange={(event) => update("trancheNear", event.target.value)} required /></FormField>
      </div>

      <details className="guided-advanced creation-advanced-settings">
        <summary>Advanced policy and evaluator settings</summary>
        <p>Defaults come from the starter policy. Change them only when the commitment needs different timing or evaluator limits.</p>
        <div className="creation-section-heading"><span>A</span><div><h3>Timing and recovery</h3><small>These rules determine when evidence expires and whether health can recover.</small></div></div>
        <div className="form-grid form-grid-3">
          <FormField label="Initial evidence window · sec"><input type="number" min="1" step="1" value={fields.initialWindowSeconds} onChange={(event) => update("initialWindowSeconds", event.target.value)} required /></FormField>
          <FormField label="Evidence freshness · sec"><input type="number" min="1" step="1" value={fields.evidenceTtlSeconds} onChange={(event) => update("evidenceTtlSeconds", event.target.value)} required /></FormField>
          <FormField label="Maximum source age · sec"><input type="number" min="1" step="1" value={fields.maxSourceLagSeconds} onChange={(event) => update("maxSourceLagSeconds", event.target.value)} required /></FormField>
          <FormField label="Grace period · sec"><input type="number" min="1" step="1" value={fields.graceSeconds} onChange={(event) => update("graceSeconds", event.target.value)} required /></FormField>
          <FormField label="Challenge window · sec"><input type="number" min="1" step="1" value={fields.challengeWindowSeconds} onChange={(event) => update("challengeWindowSeconds", event.target.value)} required /></FormField>
          <FormField label="Arbiter resolution limit · sec"><input type="number" min="1" step="1" value={fields.resolutionTimeoutSeconds} onChange={(event) => update("resolutionTimeoutSeconds", event.target.value)} required /></FormField>
          <label className="recovery-toggle"><input type="checkbox" checked={fields.recoveryAllowed} onChange={(event) => update("recoveryAllowed", event.target.checked)} /><span><strong>Allow recovery</strong><small>Fresh compliant evidence can restore future eligibility after a breach.</small></span></label>
        </div>
        <div className="creation-section-heading"><span>B</span><div><h3>Evaluator runtime</h3><small>OutLayer account and WASM target are fixed by this testnet Console.</small></div></div>
        <div className="form-grid form-grid-3">
          <FormField label="Evaluator execution budget · NEAR"><input inputMode="decimal" value={fields.executionDepositNear} onChange={(event) => update("executionDepositNear", event.target.value)} required /></FormField>
          <FormField label="Maximum instructions"><input inputMode="numeric" value={fields.maxInstructions} onChange={(event) => update("maxInstructions", event.target.value)} required /></FormField>
          <FormField label="Memory limit · MB"><input type="number" min="1" max="4096" step="1" value={fields.maxMemoryMb} onChange={(event) => update("maxMemoryMb", event.target.value)} required /></FormField>
          <FormField label="Execution limit · sec"><input type="number" min="1" max="180" step="1" value={fields.maxExecutionSeconds} onChange={(event) => update("maxExecutionSeconds", event.target.value)} required /></FormField>
          <FormField label="Evaluator response deadline · sec"><input type="number" min="1" step="1" value={fields.requestTimeoutSeconds} onChange={(event) => update("requestTimeoutSeconds", event.target.value)} required /></FormField>
          <FormField label="Draft storage bond · NEAR"><input inputMode="decimal" value={fields.storageDepositNear} onChange={(event) => update("storageDepositNear", event.target.value)} readOnly={evidenceMode === "service_availability"} required /><small>{evidenceMode === "service_availability" ? "Service policies attach a conservative 0.05 NEAR bond; the contract returns the unused amount." : "Any excess is returned by the contract."}</small></FormField>
        </div>
      </details>

      <div className="creation-summary"><span>ESCROW REQUIRED AFTER DRAFT</span><strong>{escrowPreview} NEAR</strong><small>{fields.maxEpochs} payments × {fields.trancheNear} NEAR. This is funded separately after creation.</small></div>
      {!connectedAccountId && <p className="form-wallet-hint">Connect a testnet wallet to create the draft. Your wallet account becomes the on-chain creator.</p>}
      {!contractConfigured && <p className="form-wallet-hint">Set NEXT_PUBLIC_LCP_CONTRACT_ID in apps/console/.env.local before creating.</p>}
      <div className="creation-submit-row"><p>Creating stores an immutable policy and makes a Draft; it does not fund or activate it. Public policy fields and signed reports are visible on NEAR.</p><button className="lookup-button" type="submit" disabled={!hydrated || busy || !connectedAccountId || !contractConfigured}>{busy ? <><span className="spinner" />Creating draft</> : <>Review and create draft <span aria-hidden="true">↗</span></>}</button></div>
    </form>
  );
}

function FormField({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`form-field ${wide ? "form-field-wide" : ""}`}><span>{label}</span>{children}</label>;
}

function buildServiceAvailabilityPolicy(
  draft: ServicePolicyDraft,
  temporalMaxSourceLagNs: string,
  evidenceTtlNs: string,
): ServiceAvailabilityPolicyInput {
  const sources = draft.sources.map((source) => ({
    source_id: source.source_id.trim(),
    operator_id: source.operator_id.trim(),
  })).sort((left, right) => left.source_id < right.source_id ? -1 : left.source_id > right.source_id ? 1 : 0);
  const policy: ServiceAvailabilityPolicyInput = {
    schema: "lcp.service_availability.policy.v2",
    target_id: draft.targetId.trim(),
    max_source_lag_ns: temporalMaxSourceLagNs,
    expected_status_min: Number(integerString(draft.expectedStatusMin, "Expected minimum HTTP status", 100, 599)),
    expected_status_max: Number(integerString(draft.expectedStatusMax, "Expected maximum HTTP status", 100, 599)),
    max_latency_ms: Number(integerString(draft.maxLatencyMs, "Maximum response time", 1, 0xffff_ffff)),
    minimum_agreeing_sources: Number(integerString(draft.minimumAgreeingSources, "Reports needed for a verdict", 1, sources.length)),
    minimum_corroboration_bps: Number(integerString(draft.minimumCorroborationPercent, "Minimum agreement", 0, 100)) * 100,
    sources,
  };
  validateServiceAvailabilityPolicyInput(policy);
  if (BigInt(policy.max_source_lag_ns) > BigInt(evidenceTtlNs)) {
    throw new Error("Evidence freshness must be longer than the maximum report age.");
  }
  return policy;
}

async function fingerprintServiceTarget(rawUrl: string, saltHex: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(saltHex)) {
    throw new Error("Enter the 32-byte target salt as 64 lowercase hexadecimal characters.");
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid HTTPS health endpoint.");
  }
  const hostname = url.hostname.toLowerCase();
  const isIpv4Literal = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("The endpoint must use HTTPS on port 443 and must not include a username or password.");
  }
  if (isIpv4Literal || hostname.includes(":") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Use a public hostname, not an IP address or local hostname.");
  }

  const salt = new Uint8Array(hexToArrayBuffer(saltHex));
  const urlBytes = new TextEncoder().encode(url.toString());
  const fingerprintInput = new Uint8Array(salt.length + urlBytes.length);
  fingerprintInput.set(salt, 0);
  fingerprintInput.set(urlBytes, salt.length);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", fingerprintInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildCreateCommitmentArgs(fields: CreationFields, connectedAccountId: string | null): CreateCommitmentArgs {
  const subject = fields.subject.trim();
  if (!subject || subject.length > 128 || !/^[\x20-\x7e]+$/.test(subject)) {
    throw new Error("Subject must be non-empty printable ASCII and no longer than 128 characters.");
  }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(fields.maintainerPublicKey)) {
    throw new Error("Pin a valid Ed25519 public key from the connected NEAR maintainer wallet.");
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
      evidence: {
        signature_scheme: "near_nep413",
        maintainer_public_key: fields.maintainerPublicKey as NearEd25519PublicKey,
      },
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

async function getFinalBlockTimestampNs(rpcUrls: string | readonly string[]): Promise<string> {
  const result = await requestNearJsonRpc(rpcUrls, "block", { finality: "final" });
  if (!isRecord(result) || !isRecord(result.header)) {
    throw new Error("NEAR RPC block response is missing its finalized header.");
  }
  const timestamp = result.header.timestamp_nanosec;
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
  const seconds = totalSeconds % 60n;
  const totalMinutes = totalSeconds / 60n;
  const minutes = totalMinutes % 60n;
  const totalHours = totalMinutes / 60n;
  const hours = totalHours % 24n;
  const days = totalHours / 24n;
  if (days > 0n) return `${days} ${days === 1n ? "day" : "days"}${hours > 0n ? ` ${hours} hr` : ""}`;
  if (totalHours > 0n) return `${totalHours} hr${minutes > 0n ? ` ${minutes} min` : ""}`;
  if (totalMinutes > 0n) return `${totalMinutes} min${seconds > 0n ? ` ${seconds} sec` : ""}`;
  return `${totalSeconds} sec`;
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

type AttestationLookupState =
  | { kind: "idle" | "loading" | "missing" | "unavailable"; message: string }
  | { kind: "found"; message: string; reportUrl: string | null };

function evaluationVerdictLabel(record: EvaluationRecordView): string {
  if (record.verdict) return record.verdict;
  return record.status === "Pending" ? "Waiting for evaluator" : "No verdict";
}

function evaluationExplanation(record: EvaluationRecordView): string | null {
  if (record.reason_codes.includes("OUTLAYER_TIMEOUT")) {
    return "The evaluator did not return a result before the contract deadline. This is not a service health verdict; another evaluation uses evaluator operations funds.";
  }
  if (record.reason_codes.includes("SOURCE_QUORUM_NOT_MET")) {
    const summary = record.service_availability?.source_counts;
    const count = summary ? ` ${summary.valid} of ${summary.configured} reports passed the policy checks.` : "";
    return `The reports did not meet the required source quorum.${count} This does not mean the service was down.`;
  }
  if (record.reason_codes.includes("CORROBORATION_THRESHOLD_NOT_MET")) {
    return "The reports did not meet the configured agreement coverage. The result is inconclusive, not proof that the service was down.";
  }
  if (record.reason_codes.includes("OUTLAYER_EXECUTION_FAILED") || record.reason_codes.includes("MISSING_OUTLAYER_RESULT")) {
    return "The evaluator failed before returning a result. This is not a service health verdict; check the evaluator service before retrying.";
  }
  if (record.status === "Pending") return "The request is waiting for the configured evaluator to return a result.";
  return null;
}

function EvaluationProofReference({
  record,
  wasmHash,
}: {
  record: EvaluationRecordView;
  wasmHash: string | null;
}) {
  const transactionHash = record.request_transaction_hash
    ? transactionHashToBase58(record.request_transaction_hash)
    : null;
  const [attestation, setAttestation] = useState<AttestationLookupState>({ kind: "idle", message: "" });

  useEffect(() => {
    if (!transactionHash) {
      setAttestation({ kind: "idle", message: "" });
      return;
    }

    const controller = new AbortController();
    setAttestation({ kind: "loading", message: "Checking OutLayer's public attestation record…" });
    const apiUrl = NEAR_NETWORK_ID === "testnet"
      ? "https://testnet-api.outlayer.ai"
      : "https://api.outlayer.ai";

    fetch(`${apiUrl}/attestations/by-tx/${encodeURIComponent(transactionHash)}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (response.status === 404) {
        setAttestation({ kind: "missing", message: "No public OutLayer attestation record was found for this transaction." });
        return;
      }
      if (!response.ok) throw new Error(`OutLayer returned HTTP ${response.status}`);

      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("OutLayer returned an unexpected attestation response");
      }
      const attestationRecord = payload as Record<string, unknown>;
      const checks = [
        ["transaction", attestationRecord.transaction_hash, transactionHash, false],
        ["input", attestationRecord.input_hash, record.input_hash, true],
        ["output", attestationRecord.output_hash, record.output_hash, true],
        ["WASM", attestationRecord.wasm_hash, wasmHash, true],
      ] as const;
      const mismatches: string[] = [];
      const unavailableChecks: string[] = [];
      for (const [name, actual, expected, isDigest] of checks) {
        if (typeof expected !== "string" || typeof actual !== "string") {
          unavailableChecks.push(name);
        } else {
          const normalize = (value: string) => isDigest
            ? value.replace(/^0x/i, "").toLowerCase()
            : value;
          if (normalize(actual) !== normalize(expected)) mismatches.push(name);
        }
      }
      const reportId = attestationRecord.task_id;
      const reportUrl = (typeof reportId === "string" || typeof reportId === "number")
        ? `https://app.outlayer.ai/attestation/${encodeURIComponent(String(reportId))}`
        : null;
      const message = mismatches.length > 0
        ? `Record found, but ${mismatches.join(", ")} binding${mismatches.length === 1 ? " differs" : "s differ"}.`
        : unavailableChecks.length > 0
          ? `Record found; ${unavailableChecks.join(", ")} binding${unavailableChecks.length === 1 ? " could" : "s could"} not be compared.`
          : "Record found; transaction, input, output, and WASM hashes match. The TEE quote still needs OutLayer verification.";
      setAttestation({ kind: "found", message, reportUrl });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setAttestation({
        kind: "unavailable",
        message: cause instanceof Error ? "OutLayer's attestation lookup is unavailable." : "OutLayer's attestation lookup failed.",
      });
    });

    return () => controller.abort();
  }, [record.input_hash, record.output_hash, transactionHash, wasmHash]);

  if (!transactionHash) return null;

  return (
    <div className="evaluation-proof">
      <div className="evaluation-proof-links">
        <a href={`https://${NEAR_NETWORK_ID === "testnet" ? "testnet." : ""}nearblocks.io/txns/${transactionHash}`} target="_blank" rel="noreferrer">
          NEAR transaction ↗
        </a>
        {attestation.kind === "found" && attestation.reportUrl ? (
          <a href={attestation.reportUrl} target="_blank" rel="noreferrer">Open OutLayer report ↗</a>
        ) : (
          <a href="https://app.outlayer.ai/docs/trust-verification" target="_blank" rel="noreferrer">OutLayer verification guide ↗</a>
        )}
      </div>
      <p className={`attestation-status attestation-${attestation.kind}`} role="status">
        {attestation.kind === "idle" ? "" : attestation.message}
      </p>
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
  return accountId.length > 16 ? `${accountId.slice(0, 6)}…${accountId.slice(-8)}` : accountId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
