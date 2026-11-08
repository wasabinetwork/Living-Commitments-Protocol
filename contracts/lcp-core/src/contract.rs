use near_sdk::{
    borsh::BorshSerialize,
    env,
    json_types::{U128, U64},
    near, require,
    serde_json::{json, Value},
    store::LookupMap,
    BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

use crate::{
    effective_health,
    models::{
        encode_hex, BudgetPolicy, BudgetPolicyArgs, Challenge, ChallengeStatus, ChallengeView,
        ClaimEligibilityView, Commitment, CommitmentId, CommitmentPolicy, CommitmentPolicyArgs,
        CommitmentPolicyView, CommitmentView, CreateCommitmentArgs, EscrowStatusView,
        EvaluationInput, EvaluationRecord, EvaluationRecordView, EvaluationRequest,
        EvaluationStatus, EvaluationVerdictOutput, EvaluatorPolicy, EvaluatorPolicyArgs,
        EvidencePolicy, GoodObservation, HeartbeatPayload, PendingTransfer,
        SignedHeartbeatEvidence, Tranche, TrancheStatus, TrancheView, TransferKind, Verdict,
        EVALUATION_REQUEST_SCHEMA, EVALUATION_VERDICT_SCHEMA, HEARTBEAT_EVIDENCE_TYPE,
        HEARTBEAT_SCHEMA,
    },
    temporal::{validate_temporal_policy, Health, Lifecycle, TemporalPolicy},
};

const MAX_SUBJECT_BYTES: usize = 128;
const MAX_WASM_URL_BYTES: usize = 512;
const MAX_BUILD_TARGET_BYTES: usize = 64;
const MAX_OUTLAYER_INSTRUCTIONS: u64 = 500_000_000_000;
const MAX_OUTLAYER_MEMORY_MB: u32 = 4_096;
const MAX_OUTLAYER_EXECUTION_SECONDS: u64 = 180;
const MAX_EVALUATIONS_PER_COMMITMENT: u64 = 64;
const MAX_CHALLENGES_PER_COMMITMENT: u32 = 64;
const MAX_PROGRAM_EPOCHS: u32 = 64;
const MAX_EVIDENCE_BYTES: usize = 4_096;
const MAX_CHALLENGE_REASON_BYTES: usize = 1_024;
const MAX_EVALUATOR_INPUT_BYTES: usize = 8_192;
const MAX_EVALUATOR_OUTPUT_BYTES: usize = 4_096;
const MAX_REASON_CODES: usize = 16;
const MAX_REASON_CODE_BYTES: usize = 64;
const OUTLAYER_REQUEST_GAS_TGAS: u64 = 100;
const CALLBACK_GAS_TGAS: u64 = 20;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Commitments,
    Challenges,
    ChallengeByEvaluation,
    EvaluationRequests,
    EvaluationRecords,
    Tranches,
    PendingTransfers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    next_commitment_id: CommitmentId,
    next_challenge_id: u64,
    next_transfer_id: u64,
    commitments: LookupMap<CommitmentId, Commitment>,
    challenges: LookupMap<u64, Challenge>,
    challenge_by_evaluation: LookupMap<(CommitmentId, u64), u64>,
    evaluation_requests: LookupMap<(CommitmentId, u64), EvaluationRequest>,
    evaluation_records: LookupMap<(CommitmentId, u64), EvaluationRecord>,
    tranches: LookupMap<(CommitmentId, u32), Tranche>,
    pending_transfers: LookupMap<u64, PendingTransfer>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            next_commitment_id: 0,
            next_challenge_id: 0,
            next_transfer_id: 0,
            commitments: LookupMap::new(StorageKey::Commitments),
            challenges: LookupMap::new(StorageKey::Challenges),
            challenge_by_evaluation: LookupMap::new(StorageKey::ChallengeByEvaluation),
            evaluation_requests: LookupMap::new(StorageKey::EvaluationRequests),
            evaluation_records: LookupMap::new(StorageKey::EvaluationRecords),
            tranches: LookupMap::new(StorageKey::Tranches),
            pending_transfers: LookupMap::new(StorageKey::PendingTransfers),
        }
    }

    #[payable]
    pub fn create_commitment(&mut self, args: CreateCommitmentArgs) -> U64 {
        require!(
            !args.subject.trim().is_empty()
                && args.subject.len() <= MAX_SUBJECT_BYTES
                && is_printable_ascii(&args.subject),
            "subject must be non-empty printable ASCII and at most 128 bytes"
        );

        let creator = env::predecessor_account_id();
        let policy = build_policy(args.policy);
        let policy_bytes = near_sdk::borsh::to_vec(&policy)
            .unwrap_or_else(|_| env::panic_str("failed to serialize commitment policy"));
        let policy_hash = env::sha256_array(&policy_bytes);
        let id = self
            .next_commitment_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("commitment ID overflow"));

        let mut commitment = Commitment {
            id,
            subject: args.subject,
            creator: creator.clone(),
            maintainer: args.maintainer,
            arbiter: args.arbiter,
            lifecycle: Lifecycle::Draft,
            policy,
            policy_hash,
            activated_at_ns: None,
            last_good: None::<GoodObservation>,
            last_observed_at_ns: None,
            negative_since_ns: None,
            pending_evaluation_id: None,
            active_challenge_id: None,
            breach_latched: false,
            escrow_funded_yocto: 0,
            escrow_paid_yocto: 0,
            escrow_refunded_yocto: 0,
            escrow_pending_yocto: 0,
            operations_funded_yocto: 0,
            operations_authorized_spend_yocto: 0,
            storage_deposit_yocto: 0,
            next_evaluation_id: 1,
            challenge_count: 0,
            pending_transfer_count: 0,
        };

        let storage_before = env::storage_usage();
        self.commitments.insert(id, commitment.clone());
        // LookupMap buffers mutations until flushed. Flush before measuring the storage bond.
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for storage")
        );

        commitment.storage_deposit_yocto = required_storage_bond;
        self.commitments.insert(id, commitment);
        self.commitments.flush();
        self.next_commitment_id = id;

        refund_excess(creator.clone(), attached, required_storage_bond);

        emit_event(
            "commitment_created",
            json!({
                "commitment_id": id.to_string(),
                "creator": creator,
                "policy_version": 1,
                "policy_hash": encode_hex(&policy_hash),
            }),
        );

        U64(id)
    }

    #[payable]
    pub fn fund_commitment(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.policy.budget.sponsor,
            "only the configured sponsor may fund commitment escrow"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot be funded"
        );

        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a positive escrow deposit");
        commitment.escrow_funded_yocto = commitment
            .escrow_funded_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("escrow funding overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();

        emit_event(
            "commitment_funded",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "sponsor": caller,
                "amount_yocto": amount.to_string(),
            }),
        );
    }

    #[payable]
    pub fn fund_operations(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.policy.budget.sponsor,
            "only the configured sponsor may fund evaluator operations"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "closed commitments cannot receive operations funding"
        );

        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "attach a positive operations deposit");
        commitment.operations_funded_yocto = commitment
            .operations_funded_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("operations funding overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();

        emit_event(
            "operations_funded",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "sponsor": caller,
                "amount_yocto": amount.to_string(),
            }),
        );
    }

    #[payable]
    pub fn activate_commitment(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.creator
                || caller == commitment.maintainer
                || caller == commitment.policy.budget.sponsor,
            "caller is not authorized to activate this commitment"
        );
        require!(
            commitment.lifecycle == Lifecycle::Draft,
            "only draft commitments can be activated"
        );

        let required_escrow = u128::from(commitment.policy.budget.max_epochs)
            .checked_mul(commitment.policy.budget.tranche_yocto)
            .unwrap_or_else(|| env::panic_str("required escrow calculation overflow"));
        let already_allocated = commitment
            .escrow_paid_yocto
            .checked_add(commitment.escrow_refunded_yocto)
            .and_then(|value| value.checked_add(commitment.escrow_pending_yocto))
            .unwrap_or_else(|| env::panic_str("escrow allocation overflow"));
        let escrow_available = commitment
            .escrow_funded_yocto
            .checked_sub(already_allocated)
            .unwrap_or_else(|| env::panic_str("escrow accounting invariant violated"));
        require!(
            escrow_available >= required_escrow,
            "commitment escrow is not fully funded"
        );

        let operations_available = commitment
            .operations_funded_yocto
            .checked_sub(commitment.operations_authorized_spend_yocto)
            .unwrap_or_else(|| env::panic_str("operations accounting invariant violated"));
        require!(
            operations_available >= commitment.policy.evaluator.execution_deposit_yocto,
            "fund at least one evaluator execution before activation"
        );

        let activated_at_ns = env::block_timestamp();
        let initial_deadline = activated_at_ns
            .checked_add(commitment.policy.temporal.initial_window_ns)
            .unwrap_or_else(|| env::panic_str("initial evidence deadline overflow"));
        initial_deadline
            .checked_add(commitment.policy.temporal.grace_ns)
            .unwrap_or_else(|| env::panic_str("initial breach deadline overflow"));

        commitment.lifecycle = Lifecycle::Active;
        commitment.activated_at_ns = Some(activated_at_ns);
        let storage_before = env::storage_usage();
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for activation storage")
        );
        let mut commitment = self.load_commitment(commitment_id.0);
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller.clone(), attached, required_storage_bond);

        emit_event(
            "commitment_activated",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "activated_at_ns": activated_at_ns.to_string(),
            }),
        );
    }

    #[payable]
    pub fn request_evaluation(
        &mut self,
        commitment_id: U64,
        evidence: SignedHeartbeatEvidence,
    ) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.maintainer || caller == commitment.policy.budget.sponsor,
            "only the commitment maintainer or sponsor may request evaluation"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active,
            "only active commitments can be evaluated"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "an evaluation is already pending"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "resolve the active challenge before requesting another evaluation"
        );
        require!(
            commitment.next_evaluation_id <= MAX_EVALUATIONS_PER_COMMITMENT,
            "evaluation limit reached"
        );

        let operations_available = commitment
            .operations_funded_yocto
            .checked_sub(commitment.operations_authorized_spend_yocto)
            .unwrap_or_else(|| env::panic_str("operations accounting invariant violated"));
        let execution_deposit = commitment.policy.evaluator.execution_deposit_yocto;
        require!(
            operations_available >= execution_deposit,
            "evaluator operations budget is exhausted"
        );

        let evaluation_id = commitment.next_evaluation_id;
        let canonical_payload = parse_canonical_heartbeat(&evidence);
        validate_heartbeat_binding(&commitment, &evidence, &canonical_payload, evaluation_id);
        let observed_at_ns = parse_decimal_u64(&canonical_payload.observed_at_ns)
            .unwrap_or_else(|| env::panic_str("heartbeat timestamp must be a decimal u64"));
        validate_observation_time(&commitment, observed_at_ns, now_ns);

        let evidence_hash = env::sha256_array(evidence.payload.as_bytes());
        let input = EvaluationInput {
            schema: EVALUATION_REQUEST_SCHEMA,
            commitment_id: commitment_id.0.to_string(),
            evaluation_id: evaluation_id.to_string(),
            policy_version: commitment.policy.version,
            policy_hash: encode_hex(&commitment.policy_hash),
            evidence_hash: encode_hex(&evidence_hash),
            observed_at_ns: observed_at_ns.to_string(),
            subject: &commitment.subject,
            evidence: &evidence,
        };
        let input_data = near_sdk::serde_json::to_string(&input)
            .unwrap_or_else(|_| env::panic_str("failed to serialize evaluator input"));
        require!(
            input_data.len() <= MAX_EVALUATOR_INPUT_BYTES,
            "evaluator input exceeds the 8192-byte limit"
        );
        let input_hash = env::sha256_array(input_data.as_bytes());
        let requested_at_ns = now_ns;
        let timeout_at_ns = requested_at_ns
            .checked_add(commitment.policy.evaluator.request_timeout_ns)
            .unwrap_or_else(|| env::panic_str("evaluation timeout timestamp overflow"));
        let request = EvaluationRequest {
            id: evaluation_id,
            commitment_id: commitment_id.0,
            policy_version: commitment.policy.version,
            policy_hash: commitment.policy_hash,
            input_hash,
            evidence_hash,
            observed_at_ns,
            requested_at_ns,
            timeout_at_ns,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
        };
        // This maximum-sized placeholder reserves callback storage for bounded reason codes.
        let record = EvaluationRecord {
            request_id: evaluation_id,
            commitment_id: commitment_id.0,
            request_transaction_hash: Some([0; 32]),
            status: EvaluationStatus::Pending,
            verdict: Some(Verdict::NonCompliant),
            reason_codes: vec!["X".repeat(MAX_REASON_CODE_BYTES); MAX_REASON_CODES],
            input_hash,
            evidence_hash,
            observed_at_ns,
            accepted_at_ns: Some(0),
            policy_hash: commitment.policy_hash,
            output_hash: Some([0; 32]),
        };

        commitment.next_evaluation_id = evaluation_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("evaluation ID overflow"));
        commitment.pending_evaluation_id = Some(evaluation_id);
        commitment.operations_authorized_spend_yocto = commitment
            .operations_authorized_spend_yocto
            .checked_add(execution_deposit)
            .unwrap_or_else(|| env::panic_str("operations authorization overflow"));

        let storage_before = env::storage_usage();
        let key = (commitment_id.0, evaluation_id);
        self.evaluation_requests.insert(key, request);
        self.evaluation_records.insert(key, record);
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.evaluation_requests.flush();
        self.evaluation_records.flush();
        self.commitments.flush();
        let request_state_usage = env::storage_usage();

        // Measure a conservative callback state as well as request state. The callback may
        // populate either optional health timestamp, the last-good observation, verdict,
        // acceptance time, and output digest without an attached deposit.
        let mut callback_reserve = commitment.clone();
        callback_reserve.pending_evaluation_id = None;
        callback_reserve.last_good = Some(GoodObservation {
            evaluation_id,
            evidence_hash,
            observed_at_ns,
            accepted_at_ns: now_ns,
        });
        callback_reserve.last_observed_at_ns = Some(observed_at_ns);
        callback_reserve.negative_since_ns = Some(now_ns);
        self.commitments.insert(commitment_id.0, callback_reserve);
        self.commitments.flush();
        let callback_state_usage = env::storage_usage();

        // Restore the actual pending state; the larger measured footprint remains the bond.
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        let peak_usage = request_state_usage.max(callback_state_usage);
        let storage_bytes = peak_usage
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for evaluation storage")
        );

        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let outlayer_args = json!({
            "source": {
                "WasmUrl": {
                    "url": commitment.policy.evaluator.wasm_url,
                    "hash": encode_hex(&commitment.policy.evaluator.wasm_sha256),
                    "build_target": commitment.policy.evaluator.build_target,
                }
            },
            "resource_limits": {
                "max_instructions": commitment.policy.evaluator.max_instructions,
                "max_memory_mb": commitment.policy.evaluator.max_memory_mb,
                "max_execution_seconds": commitment.policy.evaluator.max_execution_seconds,
            },
            "input_data": input_data,
            "response_format": "Json",
        });
        let outlayer_args = near_sdk::serde_json::to_vec(&outlayer_args)
            .unwrap_or_else(|_| env::panic_str("failed to serialize OutLayer request"));
        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "commitment_id": commitment_id,
            "evaluation_id": U64(evaluation_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize evaluation callback"));

        let _outlayer_promise = Promise::new(commitment.policy.evaluator.outlayer_account)
            .function_call(
                "request_execution".to_string(),
                outlayer_args,
                NearToken::from_yoctonear(execution_deposit),
                Gas::from_tgas(OUTLAYER_REQUEST_GAS_TGAS),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_outlayer_result".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));

        emit_event(
            "evaluation_requested",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "evaluation_id": evaluation_id.to_string(),
                "requested_at_ns": requested_at_ns.to_string(),
                "timeout_at_ns": timeout_at_ns.to_string(),
                "input_hash": encode_hex(&input_hash),
                "evidence_hash": encode_hex(&evidence_hash),
            }),
        );
        U64(evaluation_id)
    }

    #[private]
    pub fn on_outlayer_result(&mut self, commitment_id: U64, evaluation_id: U64) {
        let key = (commitment_id.0, evaluation_id.0);
        let Some(mut request) = self.evaluation_requests.get(&key).cloned() else {
            env::log_str("ignored OutLayer callback for an unknown evaluation");
            return;
        };
        if request.status != EvaluationStatus::Pending {
            env::log_str("ignored duplicate or expired OutLayer callback");
            return;
        }
        let mut commitment = self.load_commitment(commitment_id.0);
        if commitment.pending_evaluation_id != Some(evaluation_id.0) {
            env::log_str("ignored OutLayer callback that does not match the pending evaluation");
            return;
        }

        let now_ns = env::block_timestamp();
        if now_ns >= request.timeout_at_ns {
            self.finish_evaluation(
                &mut commitment,
                &mut request,
                EvaluationStatus::TimedOut,
                None,
                vec!["OUTLAYER_TIMEOUT".to_string()],
                None,
                None,
                now_ns,
            );
            return;
        }

        if env::promise_results_count() != 1 {
            self.finish_evaluation(
                &mut commitment,
                &mut request,
                EvaluationStatus::Failed,
                None,
                vec!["MISSING_OUTLAYER_RESULT".to_string()],
                None,
                None,
                now_ns,
            );
            return;
        }

        let output_bytes = match env::promise_result_checked(0, MAX_EVALUATOR_OUTPUT_BYTES) {
            Ok(data) => data,
            Err(PromiseError::TooLong(_)) => {
                self.reject_evaluation(
                    &mut commitment,
                    &mut request,
                    "VERDICT_TOO_LARGE",
                    None,
                    now_ns,
                );
                return;
            }
            Err(_) => {
                self.finish_evaluation(
                    &mut commitment,
                    &mut request,
                    EvaluationStatus::Failed,
                    None,
                    vec!["OUTLAYER_EXECUTION_FAILED".to_string()],
                    None,
                    None,
                    now_ns,
                );
                return;
            }
        };

        let output_hash = env::sha256_array(&output_bytes);
        let output: Option<EvaluationVerdictOutput> =
            match near_sdk::serde_json::from_slice(&output_bytes) {
                Ok(output) => output,
                Err(_) => {
                    self.reject_evaluation(
                        &mut commitment,
                        &mut request,
                        "MALFORMED_VERDICT",
                        Some(output_hash),
                        now_ns,
                    );
                    return;
                }
            };
        let Some(output) = output else {
            self.finish_evaluation(
                &mut commitment,
                &mut request,
                EvaluationStatus::Failed,
                None,
                vec!["MISSING_OUTLAYER_RESULT".to_string()],
                Some(output_hash),
                None,
                now_ns,
            );
            return;
        };
        let Some(request_transaction_hash) =
            parse_near_transaction_hash(&output.request_transaction_hash)
        else {
            self.reject_evaluation(
                &mut commitment,
                &mut request,
                "INVALID_REQUEST_TRANSACTION_HASH",
                Some(output_hash),
                now_ns,
            );
            return;
        };
        request.request_transaction_hash = Some(request_transaction_hash);
        if let Some(reason) = validate_verdict_output(&commitment, &request, &output, now_ns) {
            self.reject_evaluation(
                &mut commitment,
                &mut request,
                reason,
                Some(output_hash),
                now_ns,
            );
            return;
        }

        let was_breached = health_of(&commitment, now_ns) == Health::Breached;
        if was_breached && !commitment.policy.temporal.recovery_allowed {
            commitment.breach_latched = true;
        }
        if output.verdict == Verdict::Compliant {
            commitment.last_good = Some(GoodObservation {
                evaluation_id: evaluation_id.0,
                evidence_hash: request.evidence_hash,
                observed_at_ns: request.observed_at_ns,
                accepted_at_ns: now_ns,
            });
            if commitment.policy.temporal.recovery_allowed {
                commitment.negative_since_ns = None;
            }
        } else if commitment.negative_since_ns.is_none() {
            commitment.negative_since_ns = Some(now_ns);
        }
        commitment.last_observed_at_ns = Some(request.observed_at_ns);

        self.finish_evaluation(
            &mut commitment,
            &mut request,
            EvaluationStatus::Accepted,
            Some(output.verdict),
            output.reason_codes,
            Some(output_hash),
            Some(now_ns),
            now_ns,
        );
    }

    pub fn expire_evaluation(&mut self, commitment_id: U64, evaluation_id: U64) {
        let key = (commitment_id.0, evaluation_id.0);
        let mut request = self
            .evaluation_requests
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("evaluation request not found"));
        require!(
            request.status == EvaluationStatus::Pending,
            "only pending evaluations can expire"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns >= request.timeout_at_ns,
            "evaluation request has not timed out"
        );
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            commitment.pending_evaluation_id == Some(evaluation_id.0),
            "evaluation is no longer the pending request"
        );
        self.finish_evaluation(
            &mut commitment,
            &mut request,
            EvaluationStatus::TimedOut,
            None,
            vec!["OUTLAYER_TIMEOUT".to_string()],
            None,
            None,
            now_ns,
        );
    }

    pub fn get_evaluation(
        &self,
        commitment_id: U64,
        evaluation_id: U64,
    ) -> Option<EvaluationRecordView> {
        self.evaluation_records
            .get(&(commitment_id.0, evaluation_id.0))
            .map(EvaluationRecordView::from)
    }

    pub fn get_evaluation_timeout(&self, commitment_id: U64, evaluation_id: U64) -> Option<U64> {
        self.evaluation_requests
            .get(&(commitment_id.0, evaluation_id.0))
            .map(|request| U64(request.timeout_at_ns))
    }

    pub fn get_latest_evaluation(&self, commitment_id: U64) -> Option<EvaluationRecordView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        if commitment.next_evaluation_id == 1 {
            return None;
        }
        self.get_evaluation(
            commitment_id,
            U64(commitment.next_evaluation_id.checked_sub(1)?),
        )
    }

    #[payable]
    pub fn challenge_evaluation(
        &mut self,
        commitment_id: U64,
        evaluation_id: U64,
        reason: String,
    ) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.maintainer || caller == commitment.policy.budget.sponsor,
            "only the commitment maintainer or sponsor may challenge an evaluation"
        );
        require!(
            commitment.lifecycle == Lifecycle::Active,
            "only active commitments can be challenged"
        );
        require!(
            commitment.pending_evaluation_id.is_none(),
            "wait for the pending evaluation before opening a challenge"
        );
        require!(
            commitment.active_challenge_id.is_none(),
            "a challenge is already open"
        );
        require!(
            commitment.challenge_count < MAX_CHALLENGES_PER_COMMITMENT,
            "challenge limit reached"
        );
        require!(
            !reason.trim().is_empty() && reason.len() <= MAX_CHALLENGE_REASON_BYTES,
            "challenge reason must be non-empty and at most 1024 bytes"
        );

        let observation = commitment
            .last_good
            .as_ref()
            .unwrap_or_else(|| env::panic_str("there is no compliant evaluation to challenge"));
        require!(
            observation.evaluation_id == evaluation_id.0,
            "only the latest compliant evaluation may be challenged"
        );
        require!(
            !self
                .challenge_by_evaluation
                .contains_key(&(commitment_id.0, evaluation_id.0)),
            "this evaluation has already been challenged"
        );
        let record = self
            .evaluation_records
            .get(&(commitment_id.0, evaluation_id.0))
            .unwrap_or_else(|| env::panic_str("evaluation record not found"));
        require!(
            record.status == EvaluationStatus::Accepted
                && record.verdict == Some(Verdict::Compliant)
                && record.evidence_hash == observation.evidence_hash,
            "only an accepted compliant evaluation may be challenged"
        );
        let challenge_deadline = observation
            .accepted_at_ns
            .checked_add(commitment.policy.temporal.challenge_window_ns)
            .unwrap_or_else(|| env::panic_str("evaluation challenge window overflow"));
        require!(
            now_ns < challenge_deadline,
            "the evaluation challenge window has closed"
        );

        let challenge_id = self
            .next_challenge_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("challenge ID overflow"));
        let resolution_deadline_ns = now_ns
            .checked_add(commitment.policy.temporal.resolution_timeout_ns)
            .unwrap_or_else(|| env::panic_str("challenge resolution deadline overflow"));
        let challenge = Challenge {
            id: challenge_id,
            commitment_id: commitment_id.0,
            evaluation_id: evaluation_id.0,
            challenger: caller.clone(),
            reason_hash: env::sha256_array(reason.as_bytes()),
            opened_at_ns: now_ns,
            resolution_deadline_ns,
            status: ChallengeStatus::Open,
        };
        commitment.active_challenge_id = Some(challenge_id);
        commitment.challenge_count = commitment
            .challenge_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("challenge counter overflow"));

        let storage_before = env::storage_usage();
        self.challenges.insert(challenge_id, challenge.clone());
        self.challenge_by_evaluation
            .insert((commitment_id.0, evaluation_id.0), challenge_id);
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.challenges.flush();
        self.challenge_by_evaluation.flush();
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for challenge storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);
        self.next_challenge_id = challenge_id;

        emit_event(
            "challenge_opened",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "challenge_id": challenge_id.to_string(),
                "evaluation_id": evaluation_id.0.to_string(),
                "challenger": challenge.challenger,
                "reason_hash": encode_hex(&challenge.reason_hash),
                "resolution_deadline_ns": resolution_deadline_ns.to_string(),
            }),
        );
        U64(challenge_id)
    }

    pub fn resolve_challenge(&mut self, challenge_id: U64, uphold: bool) {
        let mut challenge = self
            .challenges
            .get(&challenge_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("challenge not found"));
        require!(
            challenge.status == ChallengeStatus::Open,
            "only open challenges can be resolved"
        );
        let mut commitment = self.load_commitment(challenge.commitment_id);
        require!(
            env::predecessor_account_id() == commitment.arbiter,
            "only the designated arbiter may resolve a challenge"
        );
        require!(
            commitment.active_challenge_id == Some(challenge.id),
            "challenge is no longer active for this commitment"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns < challenge.resolution_deadline_ns,
            "challenge resolution deadline has passed"
        );
        self.complete_challenge(
            &mut commitment,
            &mut challenge,
            if uphold {
                ChallengeStatus::Upheld
            } else {
                ChallengeStatus::Invalidated
            },
            now_ns,
        );
    }

    pub fn expire_challenge(&mut self, challenge_id: U64) {
        let mut challenge = self
            .challenges
            .get(&challenge_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("challenge not found"));
        require!(
            challenge.status == ChallengeStatus::Open,
            "only open challenges can time out"
        );
        let mut commitment = self.load_commitment(challenge.commitment_id);
        require!(
            commitment.active_challenge_id == Some(challenge.id),
            "challenge is no longer active for this commitment"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns >= challenge.resolution_deadline_ns,
            "challenge resolution deadline has not passed"
        );
        self.complete_challenge(
            &mut commitment,
            &mut challenge,
            ChallengeStatus::TimedOut,
            now_ns,
        );
    }

    pub fn get_challenge(&self, challenge_id: U64) -> Option<ChallengeView> {
        self.challenges
            .get(&challenge_id.0)
            .map(ChallengeView::from)
    }

    pub fn get_challenge_for_evaluation(
        &self,
        commitment_id: U64,
        evaluation_id: U64,
    ) -> Option<ChallengeView> {
        let challenge_id = self
            .challenge_by_evaluation
            .get(&(commitment_id.0, evaluation_id.0))?;
        self.challenges.get(&challenge_id).map(ChallengeView::from)
    }

    #[payable]
    pub fn claim_tranche(&mut self, commitment_id: U64) -> U64 {
        let caller = env::predecessor_account_id();
        let now_ns = env::block_timestamp();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.policy.budget.beneficiary,
            "only the configured beneficiary may claim a tranche"
        );
        let epoch = self
            .claim_eligibility(&commitment, now_ns)
            .unwrap_or_else(|error| env::panic_str(error));
        let tranche_key = (commitment_id.0, epoch);

        let tranche_amount = commitment.policy.budget.tranche_yocto;

        let transfer_id = self
            .next_transfer_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("transfer ID overflow"));
        commitment.escrow_pending_yocto = commitment
            .escrow_pending_yocto
            .checked_add(tranche_amount)
            .unwrap_or_else(|| env::panic_str("pending escrow overflow"));

        let tranche = Tranche {
            commitment_id: commitment_id.0,
            epoch,
            amount_yocto: tranche_amount,
            status: TrancheStatus::Pending,
            transfer_id: Some(transfer_id),
        };
        let pending_transfer = PendingTransfer {
            id: transfer_id,
            commitment_id: commitment_id.0,
            kind: TransferKind::Tranche,
            epoch: Some(epoch),
            recipient: commitment.policy.budget.beneficiary.clone(),
            amount_yocto: tranche_amount,
        };

        commitment.pending_transfer_count = commitment
            .pending_transfer_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("pending transfer counter overflow"));
        let storage_before = env::storage_usage();
        self.tranches.insert(tranche_key, tranche);
        self.pending_transfers
            .insert(transfer_id, pending_transfer.clone());
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.tranches.flush();
        self.pending_transfers.flush();
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for tranche storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "transfer_id": U64(transfer_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize tranche callback"));
        let _transfer_promise = Promise::new(pending_transfer.recipient.clone())
            .transfer(NearToken::from_yoctonear(pending_transfer.amount_yocto))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_tranche_transfer".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));

        self.next_transfer_id = transfer_id;
        emit_event(
            "tranche_claimed",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "epoch": epoch,
                "transfer_id": transfer_id.to_string(),
                "beneficiary": pending_transfer.recipient,
                "amount_yocto": tranche_amount.to_string(),
            }),
        );
        U64(transfer_id)
    }

    #[private]
    pub fn on_tranche_transfer(&mut self, transfer_id: U64) {
        let Some(transfer) = self.pending_transfers.get(&transfer_id.0).cloned() else {
            env::log_str("ignored callback for an unknown tranche transfer");
            return;
        };
        if transfer.kind != TransferKind::Tranche {
            env::log_str("ignored tranche callback for a non-tranche transfer");
            return;
        }
        let Some(epoch) = transfer.epoch else {
            env::log_str("ignored tranche callback without an epoch");
            return;
        };
        let tranche_key = (transfer.commitment_id, epoch);
        let mut tranche = self
            .tranches
            .get(&tranche_key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("pending tranche record not found"));
        if tranche.status != TrancheStatus::Pending || tranche.transfer_id != Some(transfer.id) {
            env::log_str("ignored stale or mismatched tranche transfer callback");
            return;
        }
        let mut commitment = self.load_commitment(transfer.commitment_id);
        require!(
            commitment.escrow_pending_yocto >= transfer.amount_yocto
                && commitment.pending_transfer_count > 0,
            "pending escrow accounting invariant violated"
        );

        let succeeded = env::promise_results_count() == 1
            && match env::promise_result_checked(0, 0) {
                Ok(_) | Err(PromiseError::TooLong(_)) => true,
                Err(_) => false,
            };
        commitment.escrow_pending_yocto -= transfer.amount_yocto;
        if succeeded {
            commitment.escrow_paid_yocto = commitment
                .escrow_paid_yocto
                .checked_add(transfer.amount_yocto)
                .unwrap_or_else(|| env::panic_str("paid escrow accounting overflow"));
            tranche.status = TrancheStatus::Paid;
        } else {
            tranche.status = TrancheStatus::Failed;
        }
        tranche.transfer_id = None;
        commitment.pending_transfer_count -= 1;

        self.commitments.insert(commitment.id, commitment);
        self.tranches.insert(tranche_key, tranche);
        self.pending_transfers.remove(&transfer_id.0);
        self.commitments.flush();
        self.tranches.flush();
        self.pending_transfers.flush();

        emit_event(
            if succeeded {
                "tranche_paid"
            } else {
                "tranche_transfer_failed"
            },
            json!({
                "commitment_id": transfer.commitment_id.to_string(),
                "epoch": epoch,
                "transfer_id": transfer.id.to_string(),
                "beneficiary": transfer.recipient,
                "amount_yocto": transfer.amount_yocto.to_string(),
            }),
        );
    }

    #[private]
    pub fn on_refund_transfer(&mut self, transfer_id: U64) {
        let Some(transfer) = self.pending_transfers.get(&transfer_id.0).cloned() else {
            env::log_str("ignored callback for an unknown refund transfer");
            return;
        };
        if transfer.kind != TransferKind::Refund {
            env::log_str("ignored refund callback for a non-refund transfer");
            return;
        }
        let mut commitment = self.load_commitment(transfer.commitment_id);
        require!(
            commitment.escrow_pending_yocto >= transfer.amount_yocto
                && commitment.pending_transfer_count > 0,
            "pending refund accounting invariant violated"
        );
        let succeeded = env::promise_results_count() == 1
            && match env::promise_result_checked(0, 0) {
                Ok(_) | Err(PromiseError::TooLong(_)) => true,
                Err(_) => false,
            };
        commitment.escrow_pending_yocto -= transfer.amount_yocto;
        if succeeded {
            commitment.escrow_refunded_yocto = commitment
                .escrow_refunded_yocto
                .checked_add(transfer.amount_yocto)
                .unwrap_or_else(|| env::panic_str("refunded escrow accounting overflow"));
        }
        commitment.pending_transfer_count -= 1;
        self.commitments.insert(commitment.id, commitment);
        self.pending_transfers.remove(&transfer_id.0);
        self.commitments.flush();
        self.pending_transfers.flush();

        emit_event(
            if succeeded {
                "escrow_refunded"
            } else {
                "escrow_refund_failed"
            },
            json!({
                "commitment_id": transfer.commitment_id.to_string(),
                "transfer_id": transfer.id.to_string(),
                "sponsor": transfer.recipient,
                "amount_yocto": transfer.amount_yocto.to_string(),
            }),
        );
    }

    pub fn close_commitment(&mut self, commitment_id: U64) {
        let mut commitment = self.load_commitment(commitment_id.0);
        let caller = env::predecessor_account_id();
        require!(
            caller == commitment.creator
                || caller == commitment.maintainer
                || caller == commitment.arbiter
                || caller == commitment.policy.budget.sponsor,
            "caller is not authorized to close this commitment"
        );
        require!(
            commitment.pending_evaluation_id.is_none()
                && commitment.active_challenge_id.is_none()
                && commitment.pending_transfer_count == 0,
            "resolve pending evaluations, challenges, and transfers before closing"
        );
        require!(
            commitment.lifecycle != Lifecycle::Closed,
            "commitment is already closed"
        );
        commitment.lifecycle = Lifecycle::Closed;
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.commitments.flush();
        emit_event(
            "commitment_closed",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "closed_by": caller,
                "closed_at_ns": env::block_timestamp().to_string(),
            }),
        );
    }

    #[payable]
    pub fn refund_remaining(&mut self, commitment_id: U64) -> U64 {
        let caller = env::predecessor_account_id();
        let mut commitment = self.load_commitment(commitment_id.0);
        require!(
            caller == commitment.policy.budget.sponsor,
            "only the configured sponsor may refund remaining escrow"
        );
        require!(
            commitment.lifecycle == Lifecycle::Closed,
            "close the commitment before refunding remaining escrow"
        );
        require!(
            commitment.pending_evaluation_id.is_none() && commitment.active_challenge_id.is_none(),
            "pending evaluations and challenges must be resolved before refund"
        );
        let amount = commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|value| value.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|value| value.checked_sub(commitment.escrow_pending_yocto))
            .unwrap_or_else(|| env::panic_str("escrow accounting invariant violated"));
        require!(amount > 0, "there is no remaining escrow to refund");

        let transfer_id = self
            .next_transfer_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("transfer ID overflow"));
        commitment.escrow_pending_yocto = commitment
            .escrow_pending_yocto
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("pending escrow overflow"));
        commitment.pending_transfer_count = commitment
            .pending_transfer_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("pending transfer counter overflow"));
        let pending_transfer = PendingTransfer {
            id: transfer_id,
            commitment_id: commitment_id.0,
            kind: TransferKind::Refund,
            epoch: None,
            recipient: commitment.policy.budget.sponsor.clone(),
            amount_yocto: amount,
        };

        let storage_before = env::storage_usage();
        self.pending_transfers
            .insert(transfer_id, pending_transfer.clone());
        self.commitments.insert(commitment_id.0, commitment.clone());
        self.pending_transfers.flush();
        self.commitments.flush();
        let storage_bytes = env::storage_usage()
            .checked_sub(storage_before)
            .unwrap_or_else(|| env::panic_str("storage usage unexpectedly decreased"));
        let required_storage_bond = storage_cost(storage_bytes);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required_storage_bond,
            format!("attach at least {required_storage_bond} yoctoNEAR for refund storage")
        );
        commitment.storage_deposit_yocto = commitment
            .storage_deposit_yocto
            .checked_add(required_storage_bond)
            .unwrap_or_else(|| env::panic_str("storage deposit accounting overflow"));
        self.commitments.insert(commitment_id.0, commitment);
        self.commitments.flush();
        refund_excess(caller, attached, required_storage_bond);

        let callback_args = near_sdk::serde_json::to_vec(&json!({
            "transfer_id": U64(transfer_id),
        }))
        .unwrap_or_else(|_| env::panic_str("failed to serialize refund callback"));
        let _refund_promise = Promise::new(pending_transfer.recipient.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_refund_transfer".to_string(),
                callback_args,
                NearToken::from_yoctonear(0),
                Gas::from_tgas(CALLBACK_GAS_TGAS),
            ));
        self.next_transfer_id = transfer_id;
        emit_event(
            "escrow_refund_requested",
            json!({
                "commitment_id": commitment_id.0.to_string(),
                "transfer_id": transfer_id.to_string(),
                "sponsor": pending_transfer.recipient,
                "amount_yocto": amount.to_string(),
            }),
        );
        U64(transfer_id)
    }

    pub fn get_current_epoch(&self, commitment_id: U64) -> Option<U64> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let now_ns = env::block_timestamp();
        current_epoch_of(commitment, now_ns).map(U64)
    }

    pub fn get_tranche(&self, commitment_id: U64, epoch: U64) -> Option<TrancheView> {
        let epoch = u32::try_from(epoch.0).ok()?;
        self.tranches
            .get(&(commitment_id.0, epoch))
            .map(TrancheView::from)
    }

    pub fn can_claim_tranche(&self, commitment_id: U64) -> Option<ClaimEligibilityView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let now_ns = env::block_timestamp();
        let eligibility = self.claim_eligibility(commitment, now_ns);
        Some(ClaimEligibilityView {
            eligible: eligibility.is_ok(),
            reason: eligibility.err().map(|reason| reason.to_string()),
            current_epoch: current_epoch_of(commitment, now_ns).map(U64),
            amount_yocto: U128(commitment.policy.budget.tranche_yocto),
        })
    }

    pub fn get_escrow_status(&self, commitment_id: U64) -> Option<EscrowStatusView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let free_yocto = commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|amount| amount.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|amount| amount.checked_sub(commitment.escrow_pending_yocto))
            .unwrap_or_else(|| env::panic_str("escrow accounting invariant violated"));
        Some(EscrowStatusView {
            funded_yocto: U128(commitment.escrow_funded_yocto),
            paid_yocto: U128(commitment.escrow_paid_yocto),
            refunded_yocto: U128(commitment.escrow_refunded_yocto),
            pending_yocto: U128(commitment.escrow_pending_yocto),
            free_yocto: U128(free_yocto),
        })
    }

    pub fn get_commitment(&self, commitment_id: U64) -> Option<CommitmentView> {
        let commitment = self.commitments.get(&commitment_id.0)?;
        let health = health_of(commitment, env::block_timestamp());

        Some(CommitmentView {
            id: U64(commitment.id),
            subject: commitment.subject.clone(),
            creator: commitment.creator.clone(),
            maintainer: commitment.maintainer.clone(),
            arbiter: commitment.arbiter.clone(),
            lifecycle: commitment.lifecycle,
            policy_version: commitment.policy.version,
            policy_hash: encode_hex(&commitment.policy_hash),
            next_evaluation_id: U64(commitment.next_evaluation_id),
            pending_evaluation_id: commitment.pending_evaluation_id.map(U64),
            active_challenge_id: commitment.active_challenge_id.map(U64),
            activated_at_ns: commitment.activated_at_ns.map(U64),
            last_observed_at_ns: commitment.last_observed_at_ns.map(U64),
            last_good_observed_at_ns: commitment
                .last_good
                .as_ref()
                .map(|observation| U64(observation.observed_at_ns)),
            negative_since_ns: commitment.negative_since_ns.map(U64),
            effective_health: health,
            escrow_funded_yocto: U128(commitment.escrow_funded_yocto),
            escrow_paid_yocto: U128(commitment.escrow_paid_yocto),
            escrow_refunded_yocto: U128(commitment.escrow_refunded_yocto),
            escrow_pending_yocto: U128(commitment.escrow_pending_yocto),
            operations_funded_yocto: U128(commitment.operations_funded_yocto),
            operations_authorized_spend_yocto: U128(commitment.operations_authorized_spend_yocto),
            storage_deposit_yocto: U128(commitment.storage_deposit_yocto),
        })
    }

    pub fn get_policy(&self, commitment_id: U64) -> Option<CommitmentPolicyView> {
        self.commitments
            .get(&commitment_id.0)
            .map(|commitment| CommitmentPolicyView::from(&commitment.policy))
    }

    pub fn get_effective_health(&self, commitment_id: U64) -> Option<Health> {
        self.commitments
            .get(&commitment_id.0)
            .map(|commitment| health_of(commitment, env::block_timestamp()))
    }
}

impl Contract {
    fn load_commitment(&self, commitment_id: CommitmentId) -> Commitment {
        self.commitments
            .get(&commitment_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("commitment not found"))
    }

    fn claim_eligibility(&self, commitment: &Commitment, now_ns: u64) -> Result<u32, &'static str> {
        if commitment.lifecycle != Lifecycle::Active {
            return Err("only active commitments can pay tranches");
        }
        if commitment.pending_evaluation_id.is_some() {
            return Err("a pending evaluation prevents tranche claims");
        }
        if health_of(commitment, now_ns) != Health::Healthy {
            return Err("commitment health must be Healthy to claim");
        }
        if commitment.active_challenge_id.is_some() {
            return Err("a blocking challenge prevents claims");
        }
        let Some(observation) = commitment.last_good.as_ref() else {
            return Err("a compliant observation is required to claim");
        };
        let Some(governing_record) = self
            .evaluation_records
            .get(&(commitment.id, observation.evaluation_id))
        else {
            return Err("governing evaluation record not found");
        };
        if governing_record.status != EvaluationStatus::Accepted
            || governing_record.verdict != Some(Verdict::Compliant)
            || governing_record.evidence_hash != observation.evidence_hash
        {
            return Err("latest compliant evaluation is not eligible");
        }
        let Some(challenge_window_ends_at) = observation
            .accepted_at_ns
            .checked_add(commitment.policy.temporal.challenge_window_ns)
        else {
            return Err("evaluation challenge window overflow");
        };
        if now_ns < challenge_window_ends_at {
            return Err("evaluation challenge window is still open");
        }
        let Some(epoch) = current_epoch_of(commitment, now_ns) else {
            return Err("commitment is missing an activation timestamp");
        };
        if epoch >= u64::from(commitment.policy.budget.max_epochs) {
            return Err("the funded budget program has ended");
        }
        let Ok(epoch) = u32::try_from(epoch) else {
            return Err("current epoch exceeds the supported range");
        };
        if self
            .tranches
            .get(&(commitment.id, epoch))
            .map(|tranche| tranche.status != TrancheStatus::Failed)
            .unwrap_or(false)
        {
            return Err("this epoch is already paid or pending");
        }
        let Some(escrow_free) = commitment
            .escrow_funded_yocto
            .checked_sub(commitment.escrow_paid_yocto)
            .and_then(|amount| amount.checked_sub(commitment.escrow_refunded_yocto))
            .and_then(|amount| amount.checked_sub(commitment.escrow_pending_yocto))
        else {
            return Err("escrow accounting invariant violated");
        };
        if escrow_free < commitment.policy.budget.tranche_yocto {
            return Err("insufficient unallocated commitment escrow");
        }
        Ok(epoch)
    }

    fn finish_evaluation(
        &mut self,
        commitment: &mut Commitment,
        request: &mut EvaluationRequest,
        status: EvaluationStatus,
        verdict: Option<Verdict>,
        reason_codes: Vec<String>,
        output_hash: Option<[u8; 32]>,
        accepted_at_ns: Option<u64>,
        now_ns: u64,
    ) {
        require!(
            reason_codes.len() <= MAX_REASON_CODES
                && reason_codes
                    .iter()
                    .all(|code| !code.is_empty() && code.len() <= MAX_REASON_CODE_BYTES),
            "evaluation result exceeds reserved record capacity"
        );

        request.status = status;
        commitment.pending_evaluation_id = None;
        let key = (request.commitment_id, request.id);
        let mut record = self
            .evaluation_records
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("evaluation record not found"));
        record.status = status;
        record.request_transaction_hash = request.request_transaction_hash;
        record.verdict = verdict;
        record.reason_codes = reason_codes.clone();
        record.accepted_at_ns = accepted_at_ns;
        record.output_hash = output_hash;

        self.evaluation_requests.insert(key, request.clone());
        self.evaluation_records.insert(key, record);
        self.commitments.insert(commitment.id, commitment.clone());
        self.evaluation_requests.flush();
        self.evaluation_records.flush();
        self.commitments.flush();

        let event_name = match status {
            EvaluationStatus::Accepted => "evaluation_accepted",
            EvaluationStatus::Rejected => "evaluation_rejected",
            EvaluationStatus::Failed => "evaluation_failed",
            EvaluationStatus::TimedOut => "evaluation_timed_out",
            EvaluationStatus::Pending => env::panic_str("cannot finish a pending evaluation"),
        };
        emit_event(
            event_name,
            json!({
                "commitment_id": commitment.id.to_string(),
                "evaluation_id": request.id.to_string(),
                "status": status,
                "verdict": verdict,
                "reason_codes": reason_codes,
                "observed_at_ns": request.observed_at_ns.to_string(),
                "accepted_at_ns": accepted_at_ns.map(|timestamp| timestamp.to_string()),
                "completed_at_ns": now_ns.to_string(),
                "request_transaction_hash": request
                    .request_transaction_hash
                    .as_ref()
                    .filter(|hash| **hash != [0; 32])
                    .map(|hash| encode_hex(hash)),
                "output_hash": output_hash.as_ref().map(|hash| encode_hex(hash)),
            }),
        );
    }

    fn reject_evaluation(
        &mut self,
        commitment: &mut Commitment,
        request: &mut EvaluationRequest,
        reason_code: &str,
        output_hash: Option<[u8; 32]>,
        now_ns: u64,
    ) {
        self.finish_evaluation(
            commitment,
            request,
            EvaluationStatus::Rejected,
            None,
            vec![reason_code.to_string()],
            output_hash,
            None,
            now_ns,
        );
    }

    fn complete_challenge(
        &mut self,
        commitment: &mut Commitment,
        challenge: &mut Challenge,
        status: ChallengeStatus,
        now_ns: u64,
    ) {
        require!(
            status != ChallengeStatus::Open,
            "challenge completion status cannot remain open"
        );
        let invalidates_evidence =
            status == ChallengeStatus::Invalidated || status == ChallengeStatus::TimedOut;
        if invalidates_evidence {
            if health_of(commitment, now_ns) == Health::Breached
                && !commitment.policy.temporal.recovery_allowed
            {
                commitment.breach_latched = true;
            }
            if commitment
                .last_good
                .as_ref()
                .map(|observation| observation.evaluation_id == challenge.evaluation_id)
                .unwrap_or(false)
            {
                commitment.last_good = None;
            }
            if commitment.negative_since_ns.is_none() {
                commitment.negative_since_ns = Some(now_ns);
            }
        }

        challenge.status = status;
        commitment.active_challenge_id = None;
        self.challenges.insert(challenge.id, challenge.clone());
        self.commitments.insert(commitment.id, commitment.clone());
        self.challenges.flush();
        self.commitments.flush();

        let event_name = match status {
            ChallengeStatus::Upheld => "challenge_upheld",
            ChallengeStatus::Invalidated => "challenge_invalidated",
            ChallengeStatus::TimedOut => "challenge_timed_out",
            ChallengeStatus::Open => env::panic_str("cannot complete an open challenge"),
        };
        emit_event(
            event_name,
            json!({
                "commitment_id": challenge.commitment_id.to_string(),
                "challenge_id": challenge.id.to_string(),
                "evaluation_id": challenge.evaluation_id.to_string(),
                "status": status,
                "completed_at_ns": now_ns.to_string(),
            }),
        );
    }
}

fn parse_canonical_heartbeat(evidence: &SignedHeartbeatEvidence) -> HeartbeatPayload {
    require!(
        evidence.payload.len() <= MAX_EVIDENCE_BYTES,
        "heartbeat payload exceeds the 4096-byte limit"
    );
    let payload: HeartbeatPayload = near_sdk::serde_json::from_str(&evidence.payload)
        .unwrap_or_else(|_| env::panic_str("heartbeat payload is malformed"));
    let canonical = near_sdk::serde_json::to_string(&payload)
        .unwrap_or_else(|_| env::panic_str("failed to canonicalize heartbeat payload"));
    require!(
        canonical == evidence.payload,
        "heartbeat payload must use canonical JSON serialization"
    );
    payload
}

fn validate_heartbeat_binding(
    commitment: &Commitment,
    evidence: &SignedHeartbeatEvidence,
    payload: &HeartbeatPayload,
    evaluation_id: u64,
) {
    require!(
        evidence.evidence_type == HEARTBEAT_EVIDENCE_TYPE,
        "unsupported evidence type"
    );
    let signer = decode_32_byte_hex(&evidence.maintainer_public_key).unwrap_or_else(|| {
        env::panic_str("maintainer public key must be 64 hexadecimal characters")
    });
    require!(
        encode_hex(&signer) == evidence.maintainer_public_key,
        "maintainer public key must use lowercase hexadecimal"
    );
    require!(
        signer == commitment.policy.evidence.maintainer_public_key,
        "heartbeat signer does not match the policy-pinned maintainer key"
    );
    let signature = decode_64_byte_hex(&evidence.signature).unwrap_or_else(|| {
        env::panic_str("heartbeat signature must be 128 hexadecimal characters")
    });
    require!(
        encode_hex(&signature) == evidence.signature,
        "heartbeat signature must use lowercase hexadecimal"
    );
    let artifact_hash = decode_32_byte_hex(&evidence.artifact_hash)
        .unwrap_or_else(|| env::panic_str("artifact hash must be 64 hexadecimal characters"));
    require!(
        encode_hex(&artifact_hash) == evidence.artifact_hash,
        "artifact hash must use lowercase hexadecimal"
    );
    require!(
        payload.schema == HEARTBEAT_SCHEMA,
        "unsupported heartbeat schema"
    );
    require!(
        payload.commitment_id == commitment.id.to_string(),
        "heartbeat is bound to a different commitment"
    );
    require!(
        payload.evaluation_id == evaluation_id.to_string(),
        "heartbeat is bound to a different evaluation"
    );
    require!(
        payload.policy_version == commitment.policy.version,
        "heartbeat policy version does not match"
    );
    require!(
        payload.policy_hash == encode_hex(&commitment.policy_hash),
        "heartbeat policy hash does not match"
    );
    require!(
        payload.subject == commitment.subject,
        "heartbeat subject does not match the commitment"
    );
    require!(
        payload.artifact_hash == evidence.artifact_hash,
        "heartbeat artifact hash does not match the evidence envelope"
    );
    require!(
        decode_32_byte_hex(&payload.artifact_hash).is_some(),
        "heartbeat artifact hash must be valid hexadecimal"
    );
}

fn validate_observation_time(commitment: &Commitment, observed_at_ns: u64, now_ns: u64) {
    require!(
        observed_at_ns <= now_ns,
        "heartbeat timestamp cannot be in the future"
    );
    require!(
        now_ns - observed_at_ns <= commitment.policy.temporal.max_source_lag_ns,
        "heartbeat exceeds the maximum source lag"
    );
    require!(
        commitment
            .last_observed_at_ns
            .map(|last_observed_at_ns| observed_at_ns > last_observed_at_ns)
            .unwrap_or(true),
        "heartbeat timestamp must be newer than the last accepted observation"
    );
    let expiry = observed_at_ns
        .checked_add(commitment.policy.temporal.evidence_ttl_ns)
        .unwrap_or_else(|| env::panic_str("heartbeat expiry timestamp overflow"));
    require!(now_ns < expiry, "heartbeat evidence has expired");
}

fn validate_verdict_output(
    commitment: &Commitment,
    request: &EvaluationRequest,
    output: &EvaluationVerdictOutput,
    now_ns: u64,
) -> Option<&'static str> {
    if output.schema != EVALUATION_VERDICT_SCHEMA {
        return Some("MALFORMED_VERDICT");
    }
    if output.commitment_id != request.commitment_id.to_string()
        || output.evaluation_id != request.id.to_string()
        || output.policy_version != request.policy_version
        || output.policy_hash != encode_hex(&request.policy_hash)
        || output.input_hash != encode_hex(&request.input_hash)
        || output.evidence_hash != encode_hex(&request.evidence_hash)
        || output.observed_at_ns != request.observed_at_ns.to_string()
    {
        return Some("VERDICT_BINDING_MISMATCH");
    }
    if output.reason_codes.len() > MAX_REASON_CODES
        || output.reason_codes.iter().any(|code| {
            code.is_empty()
                || code.len() > MAX_REASON_CODE_BYTES
                || !code
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
    {
        return Some("INVALID_REASON_CODES");
    }
    let Some(observed_at_ns) = parse_decimal_u64(&output.observed_at_ns) else {
        return Some("INVALID_OBSERVATION_TIMESTAMP");
    };
    if observed_at_ns > now_ns
        || now_ns - observed_at_ns > commitment.policy.temporal.max_source_lag_ns
        || request
            .observed_at_ns
            .checked_add(commitment.policy.temporal.evidence_ttl_ns)
            .map(|expires_at| now_ns >= expires_at)
            .unwrap_or(true)
        || commitment
            .last_observed_at_ns
            .map(|last_observed_at_ns| observed_at_ns <= last_observed_at_ns)
            .unwrap_or(false)
    {
        return Some("STALE_OR_INVALID_OBSERVATION");
    }
    None
}

fn parse_decimal_u64(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed.to_string() == value).then_some(parsed)
}

fn parse_near_transaction_hash(value: &str) -> Option<[u8; 32]> {
    let decoded = bs58::decode(value).into_vec().ok()?;
    decoded.try_into().ok()
}

fn build_policy(args: CommitmentPolicyArgs) -> CommitmentPolicy {
    let temporal = TemporalPolicy {
        initial_window_ns: args.temporal.initial_window_ns.0,
        evidence_ttl_ns: args.temporal.evidence_ttl_ns.0,
        grace_ns: args.temporal.grace_ns.0,
        max_source_lag_ns: args.temporal.max_source_lag_ns.0,
        challenge_window_ns: args.temporal.challenge_window_ns.0,
        resolution_timeout_ns: args.temporal.resolution_timeout_ns.0,
        recovery_allowed: args.temporal.recovery_allowed,
    };
    if let Err(error) = validate_temporal_policy(&temporal) {
        env::panic_str(&format!("invalid temporal policy: {error}"));
    }

    let evidence = EvidencePolicy {
        maintainer_public_key: decode_32_byte_hex(&args.evidence.maintainer_public_key_hex)
            .unwrap_or_else(|| {
                env::panic_str("maintainer public key must be 64 hexadecimal characters")
            }),
    };
    let evaluator = build_evaluator_policy(args.evaluator);
    let budget = build_budget_policy(args.budget);
    let policy = CommitmentPolicy {
        version: 1,
        temporal,
        evidence,
        evaluator,
        budget,
    };
    validate_commitment_policy(&policy);
    policy
}

fn build_evaluator_policy(args: EvaluatorPolicyArgs) -> EvaluatorPolicy {
    let outlayer_account = args.outlayer_account.to_string();
    require!(
        outlayer_account == "outlayer.testnet" || outlayer_account == "outlayer.near",
        "evaluator account must be outlayer.testnet or outlayer.near"
    );
    require!(
        args.wasm_url.starts_with("https://") && args.wasm_url.len() <= MAX_WASM_URL_BYTES,
        "evaluator WASM URL must be HTTPS and at most 512 bytes"
    );
    require!(
        args.build_target.len() <= MAX_BUILD_TARGET_BYTES
            && (args.build_target == "wasm32-wasip1" || args.build_target == "wasm32-wasip2"),
        "evaluator build target must be wasm32-wasip1 or wasm32-wasip2"
    );
    require!(
        args.max_instructions.0 > 0 && args.max_instructions.0 <= MAX_OUTLAYER_INSTRUCTIONS,
        "max instructions must be between 1 and 500 billion"
    );
    require!(
        args.max_memory_mb > 0 && args.max_memory_mb <= MAX_OUTLAYER_MEMORY_MB,
        "max memory must be between 1 and 4096 MB"
    );
    require!(
        args.max_execution_seconds.0 > 0
            && args.max_execution_seconds.0 <= MAX_OUTLAYER_EXECUTION_SECONDS,
        "max execution time must be between 1 and 180 seconds"
    );
    let minimum_timeout_ns = args
        .max_execution_seconds
        .0
        .checked_mul(1_000_000_000)
        .unwrap_or_else(|| env::panic_str("maximum execution time overflows nanoseconds"));
    require!(
        args.request_timeout_ns.0 >= minimum_timeout_ns,
        "request timeout must cover the maximum execution time"
    );
    require!(
        args.execution_deposit_yocto.0 > 0,
        "evaluator execution deposit must be positive"
    );
    let wasm_sha256 = decode_32_byte_hex(&args.wasm_sha256_hex)
        .unwrap_or_else(|| env::panic_str("WASM digest must be 64 hexadecimal characters"));

    EvaluatorPolicy {
        outlayer_account: args.outlayer_account,
        wasm_url: args.wasm_url,
        wasm_sha256,
        build_target: args.build_target,
        max_instructions: args.max_instructions.0,
        max_memory_mb: args.max_memory_mb,
        max_execution_seconds: args.max_execution_seconds.0,
        request_timeout_ns: args.request_timeout_ns.0,
        execution_deposit_yocto: args.execution_deposit_yocto.0,
    }
}

fn build_budget_policy(args: BudgetPolicyArgs) -> BudgetPolicy {
    require!(args.epoch_ns.0 > 0, "budget epoch must be positive");
    require!(args.max_epochs > 0, "max epochs must be positive");
    require!(
        args.max_epochs <= MAX_PROGRAM_EPOCHS,
        "max epochs cannot exceed the 64-epoch v0.1 limit"
    );
    require!(args.tranche_yocto.0 > 0, "tranche amount must be positive");
    u128::from(args.max_epochs)
        .checked_mul(args.tranche_yocto.0)
        .unwrap_or_else(|| env::panic_str("required escrow calculation overflow"));

    BudgetPolicy {
        sponsor: args.sponsor,
        beneficiary: args.beneficiary,
        epoch_ns: args.epoch_ns.0,
        max_epochs: args.max_epochs,
        tranche_yocto: args.tranche_yocto.0,
    }
}

fn validate_commitment_policy(policy: &CommitmentPolicy) {
    require!(
        policy.temporal.challenge_window_ns < policy.temporal.evidence_ttl_ns,
        "challenge window must end before evidence expires"
    );
    require!(
        policy.temporal.max_source_lag_ns <= policy.temporal.evidence_ttl_ns,
        "maximum source lag cannot exceed evidence TTL"
    );
    let earliest_claim_age = policy
        .temporal
        .max_source_lag_ns
        .checked_add(policy.temporal.challenge_window_ns)
        .unwrap_or_else(|| env::panic_str("challenge window and source lag overflow"));
    require!(
        earliest_claim_age < policy.temporal.evidence_ttl_ns,
        "evidence TTL must exceed maximum source lag plus the challenge window"
    );
}

fn health_of(commitment: &Commitment, now_ns: u64) -> Health {
    effective_health(
        &commitment.temporal_snapshot(),
        &commitment.policy.temporal,
        now_ns,
    )
    .unwrap_or_else(|error| env::panic_str(&format!("invalid commitment temporal state: {error}")))
}

fn current_epoch_of(commitment: &Commitment, now_ns: u64) -> Option<u64> {
    let activated_at_ns = commitment.activated_at_ns?;
    let elapsed_ns = now_ns.checked_sub(activated_at_ns)?;
    Some(elapsed_ns / commitment.policy.budget.epoch_ns)
}

fn emit_event(event_name: &str, data: Value) {
    let event = json!({
        "standard": "lcp",
        "version": "1.0.0",
        "event": event_name,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{event}"));
}

fn storage_cost(storage_bytes: u64) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .checked_mul(u128::from(storage_bytes))
        .unwrap_or_else(|| env::panic_str("storage deposit calculation overflow"))
}

fn refund_excess(account_id: near_sdk::AccountId, attached: u128, required: u128) {
    let excess = attached
        .checked_sub(required)
        .unwrap_or_else(|| env::panic_str("storage deposit underpayment"));
    if excess > 0 {
        Promise::new(account_id)
            .transfer(NearToken::from_yoctonear(excess))
            .detach();
    }
}

fn decode_32_byte_hex(input: &str) -> Option<[u8; 32]> {
    if input.len() != 64 {
        return None;
    }

    let mut digest = [0u8; 32];
    for (index, pair) in input.as_bytes().chunks_exact(2).enumerate() {
        digest[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(digest)
}

fn is_printable_ascii(input: &str) -> bool {
    input.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
}

fn decode_64_byte_hex(input: &str) -> Option<[u8; 64]> {
    if input.len() != 128 {
        return None;
    }

    let mut signature = [0u8; 64];
    for (index, pair) in input.as_bytes().chunks_exact(2).enumerate() {
        signature[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(signature)
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
