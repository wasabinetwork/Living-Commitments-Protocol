//! Feature-gated bounded parsers, strict signature verification, and persisted
//! transfer-intent sidecars for receipt recovery and committee governance.
#![allow(dead_code)]

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::{env, AccountId};

const MAX_CHAIN_ID_BYTES: usize = 128;
const MAX_ACCOUNT_ID_BYTES: usize = 64;
const MAX_INTENT_BYTES: usize = 500;
const MAX_CERTIFICATE_BYTES: usize = 714;
const MAX_ENVELOPE_BYTES: usize = 1_202;
const MAX_ENVELOPE_BASE64_BYTES: usize = 1_604;
const MAX_ROTATION_BYTES: usize = 449;
const MAX_ROTATION_ENVELOPE_BYTES: usize = 937;
const MAX_ROTATION_ENVELOPE_BASE64_BYTES: usize = 1_252;
const MAX_ROTATION_CANCELLATION_BYTES: usize = 313;
const MAX_ROTATION_CANCELLATION_ENVELOPE_BYTES: usize = 801;
const MAX_ROTATION_CANCELLATION_ENVELOPE_BASE64_BYTES: usize = 1_068;
const SIGNATURE_ENTRY_BYTES: usize = 32 + 64;
const INTENT_DOMAIN: &[u8] = b"LCP/NEP141/INTENT/V1\0";
const CERTIFICATE_DOMAIN: &[u8] = b"LCP/NEP141/RECOVERY/V1\0";
const ROTATION_DOMAIN: &[u8] = b"LCP/NEP141/COMMITTEE-ROTATION/V2\0";
const ROTATION_CANCELLATION_DOMAIN: &[u8] = b"LCP/NEP141/ROTATION-CANCEL/V2\0";
const CODE_HASH_DOMAIN: &[u8] = b"LCP/NEP141/CODE-HASH/V1\0";
const CODE_HASH_CANCELLATION_DOMAIN: &[u8] = b"LCP/NEP141/CODE-HASH-CANCEL/V1\0";
const MAX_CODE_HASH_PROPOSAL_BYTES: usize = 313;
const MAX_CODE_HASH_CANCELLATION_BYTES: usize = 305;
const MAX_CODE_HASH_ENVELOPE_BYTES: usize = 801;
const MAX_CODE_HASH_ENVELOPE_BASE64_BYTES: usize = 1_068;
const PENDING_INTENT_PREFIX: &[u8] = b"lcp:receipt-recovery-intent:v1:";
const INTENT_STORAGE_BOND_DOMAIN: &[u8] = b"lcp:receipt-recovery-intent-bond:v1:";
const INTENT_REFUND_CREDIT_DOMAIN: &[u8] = b"lcp:receipt-recovery-intent-credit:v1:";
// The Sandbox feature keeps the same governance checks but shortens the delay
// so VM acceptance can exercise activation without producing a week of blocks.
// Release builds always enforce the full seven-day delay.
#[cfg(feature = "sandbox-callback-fixture")]
const ROTATION_MINIMUM_DELAY_NS: u64 = 10_000_000_000;
#[cfg(not(feature = "sandbox-callback-fixture"))]
const ROTATION_MINIMUM_DELAY_NS: u64 = 604_800_000_000_000;

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) enum TransferKindV1 {
    Tranche,
    EscrowRefund,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) enum OriginMethodV1 {
    ClaimTranche,
    RefundRemaining,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) enum TransferOutcomeV1 {
    Success,
    Failure,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct RecoveryIntentV1 {
    pub(crate) schema_version: u8,
    pub(crate) chain_id: String,
    pub(crate) genesis_hash: [u8; 32],
    pub(crate) core_account_id: String,
    pub(crate) instance_id: [u8; 32],
    pub(crate) committee_epoch: u32,
    pub(crate) transfer_id: u64,
    pub(crate) commitment_id: u64,
    pub(crate) kind: TransferKindV1,
    pub(crate) tranche_epoch: Option<u32>,
    pub(crate) token_account_id: String,
    pub(crate) recipient_id: String,
    pub(crate) amount_raw: u128,
    pub(crate) origin_method: OriginMethodV1,
    pub(crate) token_code_hash: [u8; 32],
    pub(crate) ft_transfer_deposit_yocto: u128,
    pub(crate) ft_transfer_gas_tgas: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct RecoveryCertificateV1 {
    pub(crate) schema_version: u8,
    pub(crate) intent: RecoveryIntentV1,
    pub(crate) intent_hash: [u8; 32],
    pub(crate) origin_transaction_hash: [u8; 32],
    pub(crate) origin_receipt_id: [u8; 32],
    pub(crate) origin_block_hash: [u8; 32],
    pub(crate) origin_block_height: u64,
    pub(crate) token_receipt_id: [u8; 32],
    pub(crate) token_action_index: u32,
    pub(crate) outcome_block_hash: [u8; 32],
    pub(crate) outcome_block_height: u64,
    pub(crate) outcome: TransferOutcomeV1,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct SignatureEntryV1 {
    pub(crate) public_key: [u8; 32],
    pub(crate) signature: [u8; 64],
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct CommitteeRotationV2 {
    pub(crate) schema_version: u8,
    pub(crate) chain_id: String,
    pub(crate) genesis_hash: [u8; 32],
    pub(crate) core_account_id: String,
    pub(crate) instance_id: [u8; 32],
    pub(crate) old_epoch: u32,
    pub(crate) new_epoch: u32,
    pub(crate) proposal_generation: u64,
    pub(crate) new_keys: [[u8; 32]; 5],
    pub(crate) activate_at_ns: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct CommitteeRotationCancellationV2 {
    pub(crate) schema_version: u8,
    pub(crate) chain_id: String,
    pub(crate) genesis_hash: [u8; 32],
    pub(crate) core_account_id: String,
    pub(crate) instance_id: [u8; 32],
    pub(crate) old_epoch: u32,
    pub(crate) new_epoch: u32,
    pub(crate) proposal_generation: u64,
    pub(crate) proposal_digest: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RecoveryNetworkContextV1 {
    pub(crate) chain_id: String,
    pub(crate) genesis_hash: [u8; 32],
    pub(crate) core_account_id: String,
    pub(crate) instance_id: [u8; 32],
}

pub(crate) struct ParsedCommitteeRotationV2 {
    pub(crate) proposal: CommitteeRotationV2,
    pub(crate) proposal_digest: [u8; 32],
}

/// Appends one USDC code hash and/or selects an already approved hash as the
/// active hash. It cannot remove a hash or change the token account.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct UsdcCodeHashChangeV1 {
    pub(crate) schema_version: u8,
    pub(crate) chain_id: String,
    pub(crate) genesis_hash: [u8; 32],
    pub(crate) core_account_id: String,
    pub(crate) instance_id: [u8; 32],
    pub(crate) proposal_generation: u64,
    pub(crate) new_code_hash: [u8; 32],
    pub(crate) activate_at_ns: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub(crate) struct UsdcCodeHashCancellationV1 {
    pub(crate) schema_version: u8,
    pub(crate) chain_id: String,
    pub(crate) genesis_hash: [u8; 32],
    pub(crate) core_account_id: String,
    pub(crate) instance_id: [u8; 32],
    pub(crate) proposal_generation: u64,
    pub(crate) proposal_digest: [u8; 32],
}

pub(crate) struct ParsedUsdcCodeHashChangeV1 {
    pub(crate) proposal: UsdcCodeHashChangeV1,
    pub(crate) proposal_digest: [u8; 32],
}

pub(crate) fn committee_rotation_digest(proposal: &CommitteeRotationV2) -> [u8; 32] {
    let bytes = borsh::to_vec(proposal)
        .unwrap_or_else(|_| env::panic_str("committee rotation serialization failed"));
    domain_digest(ROTATION_DOMAIN, &bytes)
}

pub(crate) fn recovery_intent_digest(intent: &RecoveryIntentV1) -> [u8; 32] {
    let bytes = borsh::to_vec(intent)
        .unwrap_or_else(|_| env::panic_str("recovery intent serialization failed"));
    domain_digest(INTENT_DOMAIN, &bytes)
}

/// Writes the complete, versioned intent and preallocates its payer credit
/// before the token transfer promise can be scheduled. The measured byte count
/// includes the credit row and the indexed bond records created for both rows.
pub(crate) fn write_pending_intent(
    intent: RecoveryIntentV1,
    payer: AccountId,
) -> RecoveryIntentStorageV1 {
    if intent.transfer_id == 0 || intent.instance_id == [0; 32] {
        env::panic_str("recovery intent has an invalid transfer or instance ID");
    }
    let key = pending_intent_storage_key(intent.transfer_id);
    if env::storage_has_key(&key) {
        env::panic_str("recovery intent already exists for this transfer");
    }
    let intent_digest = recovery_intent_digest(&intent);
    let refund_credit_id = intent_credit_id(&intent);
    let storage_record_id = intent_storage_record_id(&intent);
    if refund_credit_id == [0; 32] || storage_record_id == [0; 32] {
        env::panic_str("recovery intent storage ID is invalid");
    }

    let storage_usage_before = env::storage_usage();
    crate::recovery_accounting::preallocate_measured_refund_credit(
        refund_credit_id,
        payer.clone(),
        0,
        storage_usage_before,
    );
    let record = PendingRecoveryIntentRecordV1 {
        version: 1,
        intent,
        intent_digest,
        payer,
        storage_record_id,
        refund_credit_id,
        terminal_outcome: 0,
        certificate_digest: [0; 32],
    };
    let record_bytes = borsh::to_vec(&record)
        .unwrap_or_else(|_| env::panic_str("recovery intent storage serialization failed"));
    let record_storage_before = env::storage_usage();
    env::storage_write(&key, &record_bytes);
    crate::recovery_accounting::register_payer_measured_record_auto(
        storage_record_id,
        refund_credit_id,
        record_storage_before,
    );
    let storage_bytes = env::storage_usage()
        .checked_sub(storage_usage_before)
        .unwrap_or_else(|| env::panic_str("recovery intent storage usage decreased"));
    RecoveryIntentStorageV1 {
        refund_credit_id,
        intent_digest,
        storage_bytes,
    }
}

pub(crate) fn pending_intent(transfer_id: u64) -> Option<PendingRecoveryIntentViewV1> {
    let bytes = env::storage_read(&pending_intent_storage_key(transfer_id))?;
    let record: PendingRecoveryIntentRecordV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("pending recovery intent is malformed"));
    validate_pending_intent_record(&record, transfer_id);
    Some(pending_intent_view(&record))
}

pub(crate) fn pending_intent_json_view(transfer_id: u64) -> Option<ReceiptRecoveryIntentViewV1> {
    let view = pending_intent(transfer_id)?;
    let intent_bytes = borsh::to_vec(&view.intent)
        .unwrap_or_else(|_| env::panic_str("recovery intent serialization failed"));
    Some(ReceiptRecoveryIntentViewV1 {
        intent_base64: BASE64_STANDARD.encode(intent_bytes),
        intent_digest: encode_lower_hex_32(&view.intent_digest),
        payer: view.payer,
        refund_credit_id: encode_lower_hex_32(&view.refund_credit_id),
        terminal_outcome: view.terminal_outcome.map(|outcome| match outcome {
            TransferOutcomeV1::Success => "success".to_owned(),
            TransferOutcomeV1::Failure => "failure".to_owned(),
        }),
        certificate_digest: (view.certificate_digest != [0; 32])
            .then(|| encode_lower_hex_32(&view.certificate_digest)),
    })
}

pub(crate) fn transfer_memo(transfer_id: u64) -> Option<String> {
    let view = pending_intent(transfer_id)?;
    Some(format!(
        "LCP1:{}:{}:{}",
        encode_lower_hex_32(&view.intent.instance_id),
        transfer_id,
        encode_lower_hex_32(&view.intent_digest)
    ))
}

pub(crate) fn pending_intent_matches_transfer(
    view: &PendingRecoveryIntentViewV1,
    transfer_id: u64,
    commitment_id: u64,
    kind: TransferKindV1,
    tranche_epoch: Option<u32>,
    token_account_id: &AccountId,
    recipient_id: &AccountId,
    amount_raw: u128,
) -> bool {
    view.terminal_outcome.is_none()
        && view.intent.transfer_id == transfer_id
        && view.intent.commitment_id == commitment_id
        && view.intent.kind == kind
        && view.intent.tranche_epoch == tranche_epoch
        && view.intent.token_account_id == token_account_id.as_str()
        && view.intent.recipient_id == recipient_id.as_str()
        && view.intent.amount_raw == amount_raw
}

/// Marks the first exact callback or quorum certificate outcome. The fixed
/// width terminal fields do not add storage after admission.
pub(crate) fn mark_pending_intent_terminal(
    transfer_id: u64,
    outcome: TransferOutcomeV1,
    certificate_digest: [u8; 32],
) -> Option<PendingRecoveryIntentViewV1> {
    let key = pending_intent_storage_key(transfer_id);
    let bytes = env::storage_read(&key)?;
    let mut record: PendingRecoveryIntentRecordV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("pending recovery intent is malformed"));
    validate_pending_intent_record(&record, transfer_id);
    if record.terminal_outcome != 0 {
        return None;
    }
    record.terminal_outcome = match outcome {
        TransferOutcomeV1::Success => 1,
        TransferOutcomeV1::Failure => 2,
    };
    record.certificate_digest = certificate_digest;
    let next = borsh::to_vec(&record)
        .unwrap_or_else(|_| env::panic_str("terminal recovery intent serialization failed"));
    env::storage_write(&key, &next);
    Some(pending_intent_view(&record))
}

/// Releases the terminal intent's measured storage bond to its preallocated
/// payer credit when the reserve is current. If revaluation is required, the
/// terminal record remains for permissionless retry after reserve maintenance.
pub(crate) fn finalize_terminal_intent(transfer_id: u64) -> bool {
    let key = pending_intent_storage_key(transfer_id);
    let Some(bytes) = env::storage_read(&key) else {
        return false;
    };
    let record: PendingRecoveryIntentRecordV1 = borsh::from_slice(&bytes)
        .unwrap_or_else(|_| env::panic_str("pending recovery intent is malformed"));
    validate_pending_intent_record(&record, transfer_id);
    if record.terminal_outcome == 0 {
        return false;
    }
    let credit = crate::recovery_accounting::read_persisted_refund_credit(&record.refund_credit_id)
        .unwrap_or_else(|| env::panic_str("recovery intent refund credit is missing"));
    if credit.payer != record.payer {
        env::panic_str("recovery intent refund credit has the wrong payer");
    }
    if !credit.sealed {
        crate::recovery_accounting::seal_refund_credit(record.refund_credit_id);
    }
    if !crate::recovery_accounting::storage_reserve_ready() {
        return false;
    }
    let storage_usage_before = env::storage_usage();
    env::storage_remove(&key);
    crate::recovery_accounting::remove_measured_record(
        record.storage_record_id,
        storage_usage_before,
        crate::recovery_accounting::StorageBondReleaseV1::PayerCredit,
    );
    true
}

fn pending_intent_view(record: &PendingRecoveryIntentRecordV1) -> PendingRecoveryIntentViewV1 {
    PendingRecoveryIntentViewV1 {
        intent: record.intent.clone(),
        intent_digest: record.intent_digest,
        payer: record.payer.clone(),
        refund_credit_id: record.refund_credit_id,
        terminal_outcome: match record.terminal_outcome {
            0 => None,
            1 => Some(TransferOutcomeV1::Success),
            2 => Some(TransferOutcomeV1::Failure),
            _ => env::panic_str("pending recovery intent has an invalid outcome code"),
        },
        certificate_digest: record.certificate_digest,
    }
}

fn validate_pending_intent_record(record: &PendingRecoveryIntentRecordV1, transfer_id: u64) {
    if record.version != 1
        || record.intent.transfer_id != transfer_id
        || record.intent.instance_id == [0; 32]
        || record.intent_digest != recovery_intent_digest(&record.intent)
        || record.storage_record_id != intent_storage_record_id(&record.intent)
        || record.refund_credit_id != intent_credit_id(&record.intent)
        || record.terminal_outcome > 2
        || (record.terminal_outcome == 0 && record.certificate_digest != [0; 32])
    {
        env::panic_str("pending recovery intent state is inconsistent");
    }
}

fn pending_intent_storage_key(transfer_id: u64) -> Vec<u8> {
    let mut key = Vec::with_capacity(PENDING_INTENT_PREFIX.len() + 8);
    key.extend_from_slice(PENDING_INTENT_PREFIX);
    key.extend_from_slice(&transfer_id.to_le_bytes());
    key
}

fn intent_storage_record_id(intent: &RecoveryIntentV1) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(INTENT_STORAGE_BOND_DOMAIN.len() + 40);
    bytes.extend_from_slice(INTENT_STORAGE_BOND_DOMAIN);
    bytes.extend_from_slice(&intent.instance_id);
    bytes.extend_from_slice(&intent.transfer_id.to_le_bytes());
    env::sha256_array(&bytes)
}

fn intent_credit_id(intent: &RecoveryIntentV1) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(INTENT_REFUND_CREDIT_DOMAIN.len() + 40);
    bytes.extend_from_slice(INTENT_REFUND_CREDIT_DOMAIN);
    bytes.extend_from_slice(&intent.instance_id);
    bytes.extend_from_slice(&intent.transfer_id.to_le_bytes());
    env::sha256_array(&bytes)
}

#[derive(BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct RecoveryEnvelopeWireV1 {
    certificate_bytes: Vec<u8>,
    signatures: Vec<SignatureEntryV1>,
}

pub(crate) struct ParsedRecoveryEnvelopeV1 {
    pub(crate) certificate: RecoveryCertificateV1,
    pub(crate) certificate_digest: [u8; 32],
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
struct PendingRecoveryIntentRecordV1 {
    version: u8,
    intent: RecoveryIntentV1,
    intent_digest: [u8; 32],
    payer: AccountId,
    storage_record_id: [u8; 32],
    refund_credit_id: [u8; 32],
    /// Fixed-width terminal code: 0 pending, 1 succeeded, 2 failed.
    terminal_outcome: u8,
    /// Zero for callback reconciliation; otherwise the accepted certificate digest.
    certificate_digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RecoveryIntentStorageV1 {
    pub(crate) refund_credit_id: [u8; 32],
    pub(crate) intent_digest: [u8; 32],
    pub(crate) storage_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PendingRecoveryIntentViewV1 {
    pub(crate) intent: RecoveryIntentV1,
    pub(crate) intent_digest: [u8; 32],
    pub(crate) payer: AccountId,
    pub(crate) refund_credit_id: [u8; 32],
    pub(crate) terminal_outcome: Option<TransferOutcomeV1>,
    pub(crate) certificate_digest: [u8; 32],
}

#[derive(near_sdk::serde::Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptRecoveryIntentViewV1 {
    /// Canonical Borsh `RecoveryIntentV1` bytes, encoded as standard Base64.
    pub intent_base64: String,
    pub intent_digest: String,
    pub payer: AccountId,
    pub refund_credit_id: String,
    pub terminal_outcome: Option<String>,
    pub certificate_digest: Option<String>,
}

struct BoundedReader<'a> {
    input: &'a [u8],
    offset: usize,
}

impl<'a> BoundedReader<'a> {
    fn new(input: &'a [u8]) -> Self {
        Self { input, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.input.len() - self.offset
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| "input offset overflow".to_owned())?;
        let value = self
            .input
            .get(self.offset..end)
            .ok_or_else(|| "truncated input".to_owned())?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| "truncated u32".to_owned())?,
        ))
    }

    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(
            self.take(8)?
                .try_into()
                .map_err(|_| "truncated u64".to_owned())?,
        ))
    }

    fn u128(&mut self) -> Result<u128, String> {
        Ok(u128::from_le_bytes(
            self.take(16)?
                .try_into()
                .map_err(|_| "truncated u128".to_owned())?,
        ))
    }

    fn fixed<const N: usize>(&mut self) -> Result<[u8; N], String> {
        self.take(N)?
            .try_into()
            .map_err(|_| format!("truncated {N}-byte field"))
    }

    fn bounded_string(&mut self, maximum: usize, name: &str) -> Result<String, String> {
        let length = usize::try_from(self.u32()?).map_err(|_| format!("{name} length overflow"))?;
        if length > maximum {
            return Err(format!("{name} exceeds {maximum} bytes"));
        }
        let text =
            std::str::from_utf8(self.take(length)?).map_err(|_| format!("{name} is not UTF-8"))?;
        Ok(text.to_owned())
    }

    fn finish(&self) -> Result<(), String> {
        if self.remaining() == 0 {
            Ok(())
        } else {
            Err("trailing bytes".to_owned())
        }
    }
}

/// Parses a canonical 4-of-5 or 5-of-5 certificate envelope, binds the signed
/// intent byte-for-byte to the expected pending intent, and verifies every
/// signature against that intent's immutable epoch keyset.
pub(crate) fn parse_and_verify_envelope(
    encoded: &str,
    expected_intent: &RecoveryIntentV1,
    expected_committee_epoch: u32,
    committee_keys: &[[u8; 32]],
) -> Result<ParsedRecoveryEnvelopeV1, String> {
    if expected_intent.committee_epoch != expected_committee_epoch {
        return Err("pending intent does not match the selected committee epoch".to_owned());
    }
    validate_committee(committee_keys)?;
    if encoded.len() > MAX_ENVELOPE_BASE64_BYTES || encoded.len() % 4 != 0 {
        return Err("Base64 envelope length is invalid".to_owned());
    }
    let padding = encoded
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    if padding > 2 {
        return Err("Base64 envelope has invalid padding".to_owned());
    }
    let decoded_length = encoded
        .len()
        .checked_div(4)
        .and_then(|chunks| chunks.checked_mul(3))
        .and_then(|length| length.checked_sub(padding))
        .ok_or_else(|| "Base64 envelope length overflow".to_owned())?;
    if decoded_length > MAX_ENVELOPE_BYTES {
        return Err("decoded envelope exceeds byte limit".to_owned());
    }
    let decoded = BASE64_STANDARD
        .decode(encoded)
        .map_err(|_| "invalid standard Base64 envelope".to_owned())?;
    if decoded.len() != decoded_length || BASE64_STANDARD.encode(&decoded) != encoded {
        return Err("Base64 envelope is not canonical".to_owned());
    }

    let mut reader = BoundedReader::new(&decoded);
    let certificate_length =
        usize::try_from(reader.u32()?).map_err(|_| "certificate length overflow".to_owned())?;
    if certificate_length > MAX_CERTIFICATE_BYTES {
        return Err("certificate exceeds byte limit".to_owned());
    }
    let certificate_bytes = reader.take(certificate_length)?.to_vec();
    let signature_count =
        usize::try_from(reader.u32()?).map_err(|_| "signature count overflow".to_owned())?;
    if !(4..=5).contains(&signature_count) {
        return Err("recovery requires four or five signatures".to_owned());
    }
    let signature_bytes = signature_count
        .checked_mul(SIGNATURE_ENTRY_BYTES)
        .ok_or_else(|| "signature vector length overflow".to_owned())?;
    if reader.remaining() != signature_bytes {
        return Err("signature vector length does not match remaining input".to_owned());
    }
    let mut signatures = Vec::with_capacity(signature_count);
    for _ in 0..signature_count {
        signatures.push(SignatureEntryV1 {
            public_key: reader.fixed()?,
            signature: reader.fixed()?,
        });
    }
    reader.finish()?;
    for pair in signatures.windows(2) {
        if pair[0].public_key >= pair[1].public_key {
            return Err("signature keys must be unique and sorted by raw bytes".to_owned());
        }
    }

    let certificate = parse_certificate(&certificate_bytes)?;
    if certificate.intent.committee_epoch != expected_committee_epoch {
        return Err("certificate committee epoch does not match pinned keyset".to_owned());
    }
    if certificate.intent != *expected_intent {
        return Err("certificate intent does not match the pending transfer".to_owned());
    }
    let certificate_digest = domain_digest(CERTIFICATE_DOMAIN, &certificate_bytes);
    for entry in &signatures {
        if !committee_keys.iter().any(|key| key == &entry.public_key) {
            return Err("signature key is not in the pinned committee".to_owned());
        }
        let key = VerifyingKey::from_bytes(&entry.public_key)
            .map_err(|_| "invalid Ed25519 public key".to_owned())?;
        key.verify_strict(
            &certificate_digest,
            &Signature::from_bytes(&entry.signature),
        )
        .map_err(|_| "invalid strict Ed25519 signature".to_owned())?;
    }

    let canonical = borsh::to_vec(&RecoveryEnvelopeWireV1 {
        certificate_bytes,
        signatures,
    })
    .map_err(|_| "envelope serialization failed".to_owned())?;
    if canonical != decoded {
        return Err("envelope is not canonically encoded".to_owned());
    }
    Ok(ParsedRecoveryEnvelopeV1 {
        certificate,
        certificate_digest,
    })
}

pub(crate) fn validate_committee(keys: &[[u8; 32]]) -> Result<(), String> {
    if keys.len() != 5 {
        return Err("recovery committee must contain exactly five keys".to_owned());
    }
    for (index, key_bytes) in keys.iter().enumerate() {
        if keys[..index].contains(key_bytes) {
            return Err("recovery committee contains duplicate keys".to_owned());
        }
        let key = VerifyingKey::from_bytes(key_bytes)
            .map_err(|_| "recovery committee contains an invalid Ed25519 key".to_owned())?;
        if key.is_weak() {
            return Err("recovery committee contains a weak Ed25519 key".to_owned());
        }
    }
    Ok(())
}

/// Parses and validates a signed committee rotation against the active epoch.
/// `previously_used_keys` must contain every key from every retained or retired
/// epoch, so keys cannot be recycled after a committee rotation.
pub(crate) fn parse_and_verify_rotation_proposal(
    encoded: &str,
    context: &RecoveryNetworkContextV1,
    current_epoch: u32,
    last_rotation_generation: u64,
    now_ns: u64,
    current_keys: &[[u8; 32]],
    previously_used_keys: &[[u8; 32]],
) -> Result<ParsedCommitteeRotationV2, String> {
    if previously_used_keys.len() > 160 {
        return Err("committee used-key registry exceeds its protocol cap".to_owned());
    }
    let (message, proposal_digest) = decode_and_verify_signed_message(
        encoded,
        MAX_ROTATION_ENVELOPE_BASE64_BYTES,
        MAX_ROTATION_ENVELOPE_BYTES,
        MAX_ROTATION_BYTES,
        ROTATION_DOMAIN,
        current_keys,
    )?;
    let mut reader = BoundedReader::new(&message);
    let schema_version = reader.u8()?;
    if schema_version != 2 {
        return Err("unsupported committee rotation schema version".to_owned());
    }
    let chain_id = reader.bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")?;
    let genesis_hash = reader.fixed()?;
    let core_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")?;
    let instance_id = reader.fixed()?;
    let old_epoch = reader.u32()?;
    let new_epoch = reader.u32()?;
    let proposal_generation = reader.u64()?;
    let mut new_keys = [[0_u8; 32]; 5];
    for key in &mut new_keys {
        *key = reader.fixed()?;
    }
    let activate_at_ns = reader.u64()?;
    reader.finish()?;

    validate_context_fields(
        &chain_id,
        &genesis_hash,
        &core_account_id,
        &instance_id,
        context,
    )?;
    if old_epoch != current_epoch {
        return Err("committee rotation does not use the active epoch".to_owned());
    }
    let expected_new_epoch = old_epoch
        .checked_add(1)
        .ok_or_else(|| "committee epoch overflow".to_owned())?;
    if new_epoch != expected_new_epoch {
        return Err("committee rotation epoch is not sequential".to_owned());
    }
    let expected_generation = last_rotation_generation
        .checked_add(1)
        .ok_or_else(|| "committee rotation generation overflow".to_owned())?;
    if proposal_generation != expected_generation {
        return Err("committee rotation generation is stale or skipped".to_owned());
    }
    let minimum_activation = now_ns
        .checked_add(ROTATION_MINIMUM_DELAY_NS)
        .ok_or_else(|| "committee activation timestamp overflow".to_owned())?;
    if activate_at_ns < minimum_activation {
        return Err("committee rotation activation is less than seven days away".to_owned());
    }
    for pair in new_keys.windows(2) {
        if pair[0] >= pair[1] {
            return Err("new committee keys must be unique and sorted".to_owned());
        }
    }
    validate_committee(&new_keys)?;
    if new_keys
        .iter()
        .any(|key| previously_used_keys.contains(key))
    {
        return Err("new committee key was used by an earlier epoch".to_owned());
    }

    let proposal = CommitteeRotationV2 {
        schema_version,
        chain_id,
        genesis_hash,
        core_account_id,
        instance_id,
        old_epoch,
        new_epoch,
        proposal_generation,
        new_keys,
        activate_at_ns,
    };
    if borsh::to_vec(&proposal).map_err(|_| "rotation serialization failed")? != message {
        return Err("committee rotation is not canonically encoded".to_owned());
    }
    Ok(ParsedCommitteeRotationV2 {
        proposal,
        proposal_digest,
    })
}

/// Validates a cancellation signature bundle against the exact stored pending
/// proposal. Cancellation is only allowed before its activation boundary.
pub(crate) fn parse_and_verify_rotation_cancellation(
    encoded: &str,
    context: &RecoveryNetworkContextV1,
    pending: &CommitteeRotationV2,
    current_epoch: u32,
    now_ns: u64,
    current_keys: &[[u8; 32]],
) -> Result<CommitteeRotationCancellationV2, String> {
    if pending.old_epoch != current_epoch {
        return Err("pending rotation does not use the active committee epoch".to_owned());
    }
    validate_context_fields(
        &pending.chain_id,
        &pending.genesis_hash,
        &pending.core_account_id,
        &pending.instance_id,
        context,
    )?;
    if now_ns >= pending.activate_at_ns {
        return Err("committee rotation can no longer be cancelled".to_owned());
    }
    let (message, _) = decode_and_verify_signed_message(
        encoded,
        MAX_ROTATION_CANCELLATION_ENVELOPE_BASE64_BYTES,
        MAX_ROTATION_CANCELLATION_ENVELOPE_BYTES,
        MAX_ROTATION_CANCELLATION_BYTES,
        ROTATION_CANCELLATION_DOMAIN,
        current_keys,
    )?;
    let mut reader = BoundedReader::new(&message);
    let schema_version = reader.u8()?;
    if schema_version != 2 {
        return Err("unsupported committee cancellation schema version".to_owned());
    }
    let chain_id = reader.bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")?;
    let genesis_hash = reader.fixed()?;
    let core_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")?;
    let instance_id = reader.fixed()?;
    let old_epoch = reader.u32()?;
    let new_epoch = reader.u32()?;
    let proposal_generation = reader.u64()?;
    let proposal_digest = reader.fixed()?;
    reader.finish()?;

    validate_context_fields(
        &chain_id,
        &genesis_hash,
        &core_account_id,
        &instance_id,
        context,
    )?;
    let expected_digest = domain_digest(
        ROTATION_DOMAIN,
        &borsh::to_vec(pending).map_err(|_| "pending rotation serialization failed")?,
    );
    if old_epoch != pending.old_epoch
        || new_epoch != pending.new_epoch
        || proposal_generation != pending.proposal_generation
        || proposal_digest != expected_digest
    {
        return Err("cancellation does not bind to the exact pending rotation".to_owned());
    }
    let cancellation = CommitteeRotationCancellationV2 {
        schema_version,
        chain_id,
        genesis_hash,
        core_account_id,
        instance_id,
        old_epoch,
        new_epoch,
        proposal_generation,
        proposal_digest,
    };
    if borsh::to_vec(&cancellation).map_err(|_| "cancellation serialization failed")? != message {
        return Err("committee cancellation is not canonically encoded".to_owned());
    }
    Ok(cancellation)
}

pub(crate) fn code_hash_change_digest(proposal: &UsdcCodeHashChangeV1) -> [u8; 32] {
    let bytes = borsh::to_vec(proposal)
        .unwrap_or_else(|_| env::panic_str("USDC code hash proposal serialization failed"));
    domain_digest(CODE_HASH_DOMAIN, &bytes)
}

pub(crate) fn parse_and_verify_code_hash_change(
    encoded: &str,
    context: &RecoveryNetworkContextV1,
    last_code_hash_generation: u64,
    now_ns: u64,
    current_keys: &[[u8; 32]],
) -> Result<ParsedUsdcCodeHashChangeV1, String> {
    let (message, proposal_digest) = decode_and_verify_signed_message(
        encoded,
        MAX_CODE_HASH_ENVELOPE_BASE64_BYTES,
        MAX_CODE_HASH_ENVELOPE_BYTES,
        MAX_CODE_HASH_PROPOSAL_BYTES,
        CODE_HASH_DOMAIN,
        current_keys,
    )?;
    let mut reader = BoundedReader::new(&message);
    let schema_version = reader.u8()?;
    if schema_version != 1 {
        return Err("unsupported USDC code hash schema version".to_owned());
    }
    let chain_id = reader.bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")?;
    let genesis_hash = reader.fixed()?;
    let core_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")?;
    let instance_id = reader.fixed()?;
    let proposal_generation = reader.u64()?;
    let new_code_hash = reader.fixed()?;
    let activate_at_ns = reader.u64()?;
    reader.finish()?;

    validate_context_fields(
        &chain_id,
        &genesis_hash,
        &core_account_id,
        &instance_id,
        context,
    )?;
    let expected_generation = last_code_hash_generation
        .checked_add(1)
        .ok_or_else(|| "USDC code hash generation overflow".to_owned())?;
    if proposal_generation != expected_generation {
        return Err("USDC code hash generation is stale or skipped".to_owned());
    }
    if new_code_hash == [0; 32] {
        return Err("USDC code hash must not be all zeroes".to_owned());
    }
    let minimum_activation = now_ns
        .checked_add(ROTATION_MINIMUM_DELAY_NS)
        .ok_or_else(|| "USDC code hash activation timestamp overflow".to_owned())?;
    if activate_at_ns < minimum_activation {
        return Err("USDC code hash activation is less than the required delay".to_owned());
    }
    let proposal = UsdcCodeHashChangeV1 {
        schema_version,
        chain_id,
        genesis_hash,
        core_account_id,
        instance_id,
        proposal_generation,
        new_code_hash,
        activate_at_ns,
    };
    if borsh::to_vec(&proposal).map_err(|_| "code hash serialization failed")? != message {
        return Err("USDC code hash proposal is not canonically encoded".to_owned());
    }
    Ok(ParsedUsdcCodeHashChangeV1 {
        proposal,
        proposal_digest,
    })
}

pub(crate) fn parse_and_verify_code_hash_cancellation(
    encoded: &str,
    context: &RecoveryNetworkContextV1,
    pending: &UsdcCodeHashChangeV1,
    now_ns: u64,
    current_keys: &[[u8; 32]],
) -> Result<UsdcCodeHashCancellationV1, String> {
    validate_context_fields(
        &pending.chain_id,
        &pending.genesis_hash,
        &pending.core_account_id,
        &pending.instance_id,
        context,
    )?;
    if now_ns >= pending.activate_at_ns {
        return Err("USDC code hash change can no longer be cancelled".to_owned());
    }
    let (message, _) = decode_and_verify_signed_message(
        encoded,
        MAX_CODE_HASH_ENVELOPE_BASE64_BYTES,
        MAX_CODE_HASH_ENVELOPE_BYTES,
        MAX_CODE_HASH_CANCELLATION_BYTES,
        CODE_HASH_CANCELLATION_DOMAIN,
        current_keys,
    )?;
    let mut reader = BoundedReader::new(&message);
    let schema_version = reader.u8()?;
    if schema_version != 1 {
        return Err("unsupported USDC code hash cancellation schema version".to_owned());
    }
    let chain_id = reader.bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")?;
    let genesis_hash = reader.fixed()?;
    let core_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")?;
    let instance_id = reader.fixed()?;
    let proposal_generation = reader.u64()?;
    let proposal_digest = reader.fixed()?;
    reader.finish()?;
    validate_context_fields(
        &chain_id,
        &genesis_hash,
        &core_account_id,
        &instance_id,
        context,
    )?;
    let expected_digest = code_hash_change_digest(pending);
    if proposal_generation != pending.proposal_generation || proposal_digest != expected_digest {
        return Err("cancellation does not bind to the exact pending code hash change".to_owned());
    }
    let cancellation = UsdcCodeHashCancellationV1 {
        schema_version,
        chain_id,
        genesis_hash,
        core_account_id,
        instance_id,
        proposal_generation,
        proposal_digest,
    };
    if borsh::to_vec(&cancellation).map_err(|_| "code hash cancellation serialization failed")?
        != message
    {
        return Err("USDC code hash cancellation is not canonically encoded".to_owned());
    }
    Ok(cancellation)
}

fn decode_and_verify_signed_message(
    encoded: &str,
    maximum_base64_bytes: usize,
    maximum_envelope_bytes: usize,
    maximum_message_bytes: usize,
    domain: &[u8],
    committee_keys: &[[u8; 32]],
) -> Result<(Vec<u8>, [u8; 32]), String> {
    validate_committee(committee_keys)?;
    if encoded.len() > maximum_base64_bytes || encoded.len() % 4 != 0 {
        return Err("signed message Base64 length is invalid".to_owned());
    }
    let padding = encoded
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    if padding > 2 {
        return Err("signed message Base64 padding is invalid".to_owned());
    }
    let decoded_length = encoded
        .len()
        .checked_div(4)
        .and_then(|chunks| chunks.checked_mul(3))
        .and_then(|length| length.checked_sub(padding))
        .ok_or_else(|| "signed message Base64 length overflow".to_owned())?;
    if decoded_length > maximum_envelope_bytes {
        return Err("signed message envelope exceeds byte limit".to_owned());
    }
    let decoded = BASE64_STANDARD
        .decode(encoded)
        .map_err(|_| "invalid standard Base64 signed message".to_owned())?;
    if decoded.len() != decoded_length || BASE64_STANDARD.encode(&decoded) != encoded {
        return Err("signed message Base64 is not canonical".to_owned());
    }
    let mut reader = BoundedReader::new(&decoded);
    let message_length =
        usize::try_from(reader.u32()?).map_err(|_| "signed message length overflow".to_owned())?;
    if message_length > maximum_message_bytes {
        return Err("signed message exceeds its schema byte limit".to_owned());
    }
    let message = reader.take(message_length)?.to_vec();
    let signature_count =
        usize::try_from(reader.u32()?).map_err(|_| "signature count overflow".to_owned())?;
    if !(4..=5).contains(&signature_count) {
        return Err("signed message requires four or five signatures".to_owned());
    }
    let signature_bytes = signature_count
        .checked_mul(SIGNATURE_ENTRY_BYTES)
        .ok_or_else(|| "signature vector length overflow".to_owned())?;
    if reader.remaining() != signature_bytes {
        return Err("signature vector length does not match remaining input".to_owned());
    }
    let mut signatures = Vec::with_capacity(signature_count);
    for _ in 0..signature_count {
        signatures.push(SignatureEntryV1 {
            public_key: reader.fixed()?,
            signature: reader.fixed()?,
        });
    }
    reader.finish()?;
    for pair in signatures.windows(2) {
        if pair[0].public_key >= pair[1].public_key {
            return Err("signature keys must be unique and sorted by raw bytes".to_owned());
        }
    }
    let digest = domain_digest(domain, &message);
    for entry in &signatures {
        if !committee_keys.iter().any(|key| key == &entry.public_key) {
            return Err("signature key is not in the pinned committee".to_owned());
        }
        let key = VerifyingKey::from_bytes(&entry.public_key)
            .map_err(|_| "invalid Ed25519 public key".to_owned())?;
        key.verify_strict(&digest, &Signature::from_bytes(&entry.signature))
            .map_err(|_| "invalid strict Ed25519 signature".to_owned())?;
    }
    let canonical = borsh::to_vec(&RecoveryEnvelopeWireV1 {
        certificate_bytes: message.clone(),
        signatures,
    })
    .map_err(|_| "signed message envelope serialization failed".to_owned())?;
    if canonical != decoded {
        return Err("signed message envelope is not canonically encoded".to_owned());
    }
    Ok((message, digest))
}

fn validate_context_fields(
    chain_id: &str,
    genesis_hash: &[u8; 32],
    core_account_id: &str,
    instance_id: &[u8; 32],
    expected: &RecoveryNetworkContextV1,
) -> Result<(), String> {
    validate_chain_id(chain_id)?;
    validate_account(core_account_id, "core_account_id")?;
    if chain_id != expected.chain_id
        || genesis_hash != &expected.genesis_hash
        || core_account_id != expected.core_account_id
        || instance_id != &expected.instance_id
    {
        return Err("signed governance message is for a different contract instance".to_owned());
    }
    Ok(())
}

fn validate_chain_id(value: &str) -> Result<(), String> {
    #[cfg(feature = "sandbox-callback-fixture")]
    let valid_sandbox_chain = value.starts_with("test-chain-")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte));
    #[cfg(not(feature = "sandbox-callback-fixture"))]
    let valid_sandbox_chain = false;

    if value.is_empty()
        || value.len() > MAX_CHAIN_ID_BYTES
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        }) && !valid_sandbox_chain
    {
        return Err("invalid chain_id".to_owned());
    }
    Ok(())
}

fn parse_certificate(bytes: &[u8]) -> Result<RecoveryCertificateV1, String> {
    if bytes.len() > MAX_CERTIFICATE_BYTES {
        return Err("certificate exceeds byte limit".to_owned());
    }
    let mut reader = BoundedReader::new(bytes);
    if reader.u8()? != 1 {
        return Err("unsupported certificate schema version".to_owned());
    }
    let intent = parse_intent(&mut reader)?;
    let intent_hash = reader.fixed()?;
    let origin_transaction_hash = reader.fixed()?;
    let origin_receipt_id = reader.fixed()?;
    let origin_block_hash = reader.fixed()?;
    let origin_block_height = reader.u64()?;
    let token_receipt_id = reader.fixed()?;
    let token_action_index = reader.u32()?;
    if token_action_index != 0 {
        return Err("unsupported token action index".to_owned());
    }
    let outcome_block_hash = reader.fixed()?;
    let outcome_block_height = reader.u64()?;
    let outcome = match reader.u8()? {
        0 => TransferOutcomeV1::Success,
        1 => TransferOutcomeV1::Failure,
        _ => return Err("unsupported transfer outcome".to_owned()),
    };
    reader.finish()?;
    if origin_transaction_hash == [0; 32]
        || origin_receipt_id == [0; 32]
        || origin_block_hash == [0; 32]
        || token_receipt_id == [0; 32]
        || outcome_block_hash == [0; 32]
        || origin_block_height == 0
        || outcome_block_height < origin_block_height
    {
        return Err("recovery certificate contains invalid receipt or block identity".to_owned());
    }

    let intent_bytes = borsh::to_vec(&intent).map_err(|_| "intent serialization failed")?;
    if intent_bytes.len() > MAX_INTENT_BYTES {
        return Err("intent exceeds byte limit".to_owned());
    }
    if domain_digest(INTENT_DOMAIN, &intent_bytes) != intent_hash {
        return Err("intent hash mismatch".to_owned());
    }
    let certificate = RecoveryCertificateV1 {
        schema_version: 1,
        intent,
        intent_hash,
        origin_transaction_hash,
        origin_receipt_id,
        origin_block_hash,
        origin_block_height,
        token_receipt_id,
        token_action_index,
        outcome_block_hash,
        outcome_block_height,
        outcome,
    };
    if borsh::to_vec(&certificate).map_err(|_| "certificate serialization failed")? != bytes {
        return Err("certificate is not canonically encoded".to_owned());
    }
    Ok(certificate)
}

fn parse_intent(reader: &mut BoundedReader<'_>) -> Result<RecoveryIntentV1, String> {
    if reader.u8()? != 1 {
        return Err("unsupported intent schema version".to_owned());
    }
    let chain_id = reader.bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")?;
    validate_chain_id(&chain_id)?;
    let genesis_hash = reader.fixed()?;
    let core_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")?;
    validate_account(&core_account_id, "core_account_id")?;
    let instance_id = reader.fixed()?;
    let committee_epoch = reader.u32()?;
    let transfer_id = reader.u64()?;
    let commitment_id = reader.u64()?;
    let kind = match reader.u8()? {
        0 => TransferKindV1::Tranche,
        1 => TransferKindV1::EscrowRefund,
        _ => return Err("unsupported transfer kind".to_owned()),
    };
    let tranche_epoch = match reader.u8()? {
        0 => None,
        1 => Some(reader.u32()?),
        _ => return Err("invalid tranche_epoch option tag".to_owned()),
    };
    let token_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "token_account_id")?;
    validate_account(&token_account_id, "token_account_id")?;
    let recipient_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "recipient_id")?;
    validate_account(&recipient_id, "recipient_id")?;
    let amount_raw = reader.u128()?;
    let origin_method = match reader.u8()? {
        0 => OriginMethodV1::ClaimTranche,
        1 => OriginMethodV1::RefundRemaining,
        _ => return Err("unsupported origin method".to_owned()),
    };
    let token_code_hash = reader.fixed()?;
    let ft_transfer_deposit_yocto = reader.u128()?;
    let ft_transfer_gas_tgas = reader.u64()?;

    let consistent = matches!(
        (&kind, tranche_epoch, &origin_method),
        (
            TransferKindV1::Tranche,
            Some(_),
            OriginMethodV1::ClaimTranche
        ) | (
            TransferKindV1::EscrowRefund,
            None,
            OriginMethodV1::RefundRemaining
        )
    );
    if !consistent {
        return Err("inconsistent transfer kind, epoch, and origin method".to_owned());
    }
    if amount_raw == 0 {
        return Err("amount_raw must be nonzero".to_owned());
    }
    if genesis_hash == [0; 32] || instance_id == [0; 32] || token_code_hash == [0; 32] {
        return Err("recovery intent contains an empty network or token identity".to_owned());
    }
    if ft_transfer_deposit_yocto != 1 || ft_transfer_gas_tgas != 25 {
        return Err("unsupported v1 transfer deposit or gas".to_owned());
    }
    Ok(RecoveryIntentV1 {
        schema_version: 1,
        chain_id,
        genesis_hash,
        core_account_id,
        instance_id,
        committee_epoch,
        transfer_id,
        commitment_id,
        kind,
        tranche_epoch,
        token_account_id,
        recipient_id,
        amount_raw,
        origin_method,
        token_code_hash,
        ft_transfer_deposit_yocto,
        ft_transfer_gas_tgas,
    })
}

fn validate_account(value: &str, field: &str) -> Result<(), String> {
    if !(2..=MAX_ACCOUNT_ID_BYTES).contains(&value.len()) {
        return Err(format!("invalid {field}"));
    }
    let account: near_sdk::AccountId = value.parse().map_err(|_| format!("invalid {field}"))?;
    if account.as_str() != value {
        return Err(format!("noncanonical {field}"));
    }
    Ok(())
}

fn domain_digest(domain: &[u8], message: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(domain.len() + message.len());
    preimage.extend_from_slice(domain);
    preimage.extend_from_slice(message);
    env::sha256(&preimage)
        .try_into()
        .unwrap_or_else(|_| env::panic_str("NEAR SHA-256 returned an invalid digest"))
}

pub(crate) fn encode_lower_hex_32(value: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
pub(crate) fn clear_pending_intents_for_test() {
    for transfer_id in 1..=8 {
        env::storage_remove(&pending_intent_storage_key(transfer_id));
    }
}

#[cfg(test)]
pub(crate) fn test_signed_envelope(
    domain: &[u8],
    message: &[u8],
    signatures: Vec<SignatureEntryV1>,
) -> String {
    let _ = domain;
    let envelope = RecoveryEnvelopeWireV1 {
        certificate_bytes: message.to_vec(),
        signatures,
    };
    let bytes = borsh::to_vec(&envelope).expect("test envelope");
    BASE64_STANDARD.encode(bytes)
}

#[cfg(test)]
pub(crate) fn test_domain_digest(domain: &[u8], message: &[u8]) -> [u8; 32] {
    domain_digest(domain, message)
}
