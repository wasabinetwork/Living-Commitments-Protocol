use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use borsh::BorshSerialize;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};

#[derive(BorshSerialize)]
enum TransferKindV1 {
    Tranche,
    EscrowRefund,
}

#[derive(BorshSerialize)]
enum OriginMethodV1 {
    ClaimTranche,
    RefundRemaining,
}

#[derive(BorshSerialize)]
enum TransferOutcomeV1 {
    Success,
    Failure,
}

#[derive(BorshSerialize)]
struct RecoveryIntentV1 {
    schema_version: u8,
    chain_id: String,
    genesis_hash: [u8; 32],
    core_account_id: String,
    instance_id: [u8; 32],
    committee_epoch: u32,
    transfer_id: u64,
    commitment_id: u64,
    kind: TransferKindV1,
    tranche_epoch: Option<u32>,
    token_account_id: String,
    recipient_id: String,
    amount_raw: u128,
    origin_method: OriginMethodV1,
    token_code_hash: [u8; 32],
    ft_transfer_deposit_yocto: u128,
    ft_transfer_gas_tgas: u64,
}

#[derive(BorshSerialize)]
struct RecoveryCertificateV1 {
    schema_version: u8,
    intent: RecoveryIntentV1,
    intent_hash: [u8; 32],
    origin_transaction_hash: [u8; 32],
    origin_receipt_id: [u8; 32],
    origin_block_hash: [u8; 32],
    origin_block_height: u64,
    token_receipt_id: [u8; 32],
    token_action_index: u32,
    outcome_block_hash: [u8; 32],
    outcome_block_height: u64,
    outcome: TransferOutcomeV1,
}

#[derive(BorshSerialize)]
struct CommitteeRotationV2 {
    schema_version: u8,
    chain_id: String,
    genesis_hash: [u8; 32],
    core_account_id: String,
    instance_id: [u8; 32],
    old_epoch: u32,
    new_epoch: u32,
    proposal_generation: u64,
    new_keys: [[u8; 32]; 5],
    activate_at_ns: u64,
}

#[derive(BorshSerialize)]
struct CommitteeRotationCancellationV2 {
    schema_version: u8,
    chain_id: String,
    genesis_hash: [u8; 32],
    core_account_id: String,
    instance_id: [u8; 32],
    old_epoch: u32,
    new_epoch: u32,
    proposal_generation: u64,
    proposal_digest: [u8; 32],
}

#[derive(BorshSerialize, Clone)]
struct SignatureEntry {
    public_key: [u8; 32],
    signature: [u8; 64],
}

#[derive(BorshSerialize)]
struct Envelope {
    message_bytes: Vec<u8>,
    signatures: Vec<SignatureEntry>,
}

const MAX_CHAIN_ID_BYTES: usize = 128;
const MAX_ACCOUNT_ID_BYTES: usize = 64;
const MAX_INTENT_BYTES: usize = 500;
const MAX_CERTIFICATE_BYTES: usize = 714;
const MAX_ENVELOPE_BYTES: usize = 1_202;
const MAX_ENVELOPE_BASE64_BYTES: usize = 1_604;
const SIGNATURE_ENTRY_BYTES: usize = 32 + 64;

struct ParsedRecoveryEnvelope {
    certificate: RecoveryCertificateV1,
    signatures: Vec<SignatureEntry>,
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
        let value = self.take(length)?;
        let text = std::str::from_utf8(value).map_err(|_| format!("{name} is not UTF-8"))?;
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

fn valid_chain_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CHAIN_ID_BYTES
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

fn valid_near_account_id(value: &str) -> bool {
    if !(2..=MAX_ACCOUNT_ID_BYTES).contains(&value.len()) {
        return false;
    }
    let mut previous_separator = true;
    for byte in value.bytes() {
        let separator = matches!(byte, b'-' | b'_' | b'.');
        if !(byte.is_ascii_lowercase() || byte.is_ascii_digit() || separator)
            || (separator && previous_separator)
        {
            return false;
        }
        previous_separator = separator;
    }
    !previous_separator
}

fn parse_intent_bounded(reader: &mut BoundedReader<'_>) -> Result<RecoveryIntentV1, String> {
    let schema_version = reader.u8()?;
    if schema_version != 1 {
        return Err("unsupported intent schema version".to_owned());
    }
    let chain_id = reader.bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")?;
    if !valid_chain_id(&chain_id) {
        return Err("invalid chain_id".to_owned());
    }
    let genesis_hash = reader.fixed()?;
    let core_account_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")?;
    if !valid_near_account_id(&core_account_id) {
        return Err("invalid core_account_id".to_owned());
    }
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
    if !valid_near_account_id(&token_account_id) {
        return Err("invalid token_account_id".to_owned());
    }
    let recipient_id = reader.bounded_string(MAX_ACCOUNT_ID_BYTES, "recipient_id")?;
    if !valid_near_account_id(&recipient_id) {
        return Err("invalid recipient_id".to_owned());
    }
    let amount_raw = reader.u128()?;
    let origin_method = match reader.u8()? {
        0 => OriginMethodV1::ClaimTranche,
        1 => OriginMethodV1::RefundRemaining,
        _ => return Err("unsupported origin method".to_owned()),
    };
    let token_code_hash = reader.fixed()?;
    let ft_transfer_deposit_yocto = reader.u128()?;
    let ft_transfer_gas_tgas = reader.u64()?;

    let kind_matches = matches!(
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
    if !kind_matches {
        return Err("inconsistent transfer kind, epoch, and origin method".to_owned());
    }
    if amount_raw == 0 {
        return Err("amount_raw must be nonzero".to_owned());
    }
    if ft_transfer_deposit_yocto != 1 || ft_transfer_gas_tgas != 25 {
        return Err("unsupported v1 transfer deposit or gas".to_owned());
    }

    Ok(RecoveryIntentV1 {
        schema_version,
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

fn parse_certificate_bounded(bytes: &[u8]) -> Result<RecoveryCertificateV1, String> {
    if bytes.len() > MAX_CERTIFICATE_BYTES {
        return Err("certificate exceeds byte limit".to_owned());
    }
    let mut reader = BoundedReader::new(bytes);
    let schema_version = reader.u8()?;
    if schema_version != 1 {
        return Err("unsupported certificate schema version".to_owned());
    }
    let intent = parse_intent_bounded(&mut reader)?;
    let intent_hash: [u8; 32] = reader.fixed()?;
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

    let intent_bytes = borsh::to_vec(&intent).map_err(|_| "intent serialization failed")?;
    if intent_bytes.len() > MAX_INTENT_BYTES {
        return Err("intent exceeds byte limit".to_owned());
    }
    if digest("LCP/NEP141/INTENT/V1", &intent_bytes) != intent_hash {
        return Err("intent hash mismatch".to_owned());
    }

    let certificate = RecoveryCertificateV1 {
        schema_version,
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
    let canonical = borsh::to_vec(&certificate).map_err(|_| "certificate serialization failed")?;
    if canonical != bytes {
        return Err("certificate is not canonically encoded".to_owned());
    }
    Ok(certificate)
}

fn parse_recovery_envelope(
    encoded: &str,
    committee_keys: &[[u8; 32]],
    expected_committee_epoch: u32,
) -> Result<ParsedRecoveryEnvelope, String> {
    if encoded.len() > MAX_ENVELOPE_BASE64_BYTES {
        return Err("Base64 envelope exceeds encoded byte limit".to_owned());
    }
    if encoded.len() % 4 != 0 {
        return Err("Base64 envelope has noncanonical length".to_owned());
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
    let required_signature_bytes = signature_count
        .checked_mul(SIGNATURE_ENTRY_BYTES)
        .ok_or_else(|| "signature vector length overflow".to_owned())?;
    if reader.remaining() != required_signature_bytes {
        return Err("signature vector length does not match remaining input".to_owned());
    }
    let mut signatures = Vec::with_capacity(signature_count);
    for _ in 0..signature_count {
        signatures.push(SignatureEntry {
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
    let certificate = parse_certificate_bounded(&certificate_bytes)?;
    if certificate.intent.committee_epoch != expected_committee_epoch {
        return Err("certificate committee epoch does not match pinned keyset".to_owned());
    }
    let certificate_digest = digest("LCP/NEP141/RECOVERY/V1", &certificate_bytes);
    for entry in &signatures {
        if !committee_keys.iter().any(|key| key == &entry.public_key) {
            return Err("signature key is not in the pinned committee".to_owned());
        }
        let key = VerifyingKey::from_bytes(&entry.public_key)
            .map_err(|_| "invalid Ed25519 public key".to_owned())?;
        key.verify_strict(
            &certificate_digest,
            &ed25519_dalek::Signature::from_bytes(&entry.signature),
        )
        .map_err(|_| "invalid strict Ed25519 signature".to_owned())?;
    }

    let canonical = borsh::to_vec(&Envelope {
        message_bytes: certificate_bytes,
        signatures: signatures
            .iter()
            .map(|entry| SignatureEntry {
                public_key: entry.public_key,
                signature: entry.signature,
            })
            .collect(),
    })
    .map_err(|_| "envelope serialization failed".to_owned())?;
    if canonical != decoded {
        return Err("envelope is not canonically encoded".to_owned());
    }
    Ok(ParsedRecoveryEnvelope {
        certificate,
        signatures,
    })
}

struct SignedVector {
    entries: Vec<SignatureEntry>,
}

fn fail(message: impl AsRef<str>) -> ! {
    panic!("{}", message.as_ref());
}

fn object<'a>(value: &'a Value, name: &str) -> &'a Value {
    value
        .get(name)
        .unwrap_or_else(|| fail(format!("missing JSON field {name}")))
}

fn string(value: &Value, name: &str) -> String {
    object(value, name)
        .as_str()
        .unwrap_or_else(|| fail(format!("{name} must be a JSON string")))
        .to_owned()
}

fn u64_text(value: &Value, name: &str) -> u64 {
    string(value, name)
        .parse()
        .unwrap_or_else(|_| fail(format!("{name} must fit u64")))
}

fn u128_text(value: &Value, name: &str) -> u128 {
    string(value, name)
        .parse()
        .unwrap_or_else(|_| fail(format!("{name} must fit u128")))
}

fn small_u32(value: &Value, name: &str) -> u32 {
    object(value, name)
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_else(|| fail(format!("{name} must fit u32")))
}

fn small_u8(value: &Value, name: &str) -> u8 {
    object(value, name)
        .as_u64()
        .and_then(|value| u8::try_from(value).ok())
        .unwrap_or_else(|| fail(format!("{name} must fit u8")))
}

fn decode_hex<const N: usize>(encoded: &str, name: &str) -> [u8; N] {
    if encoded.len() != N * 2 {
        fail(format!("{name} must contain {} hex characters", N * 2));
    }
    let mut bytes = [0u8; N];
    for (index, pair) in encoded.as_bytes().chunks_exact(2).enumerate() {
        let digit = |byte: u8| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => fail(format!("{name} must be lowercase hexadecimal")),
        };
        bytes[index] = (digit(pair[0]) << 4) | digit(pair[1]);
    }
    bytes
}

fn fixed_hex<const N: usize>(value: &Value, name: &str) -> [u8; N] {
    decode_hex(&string(value, name), name)
}

fn intent(value: &Value) -> RecoveryIntentV1 {
    let kind = small_u8(value, "kind");
    let origin_method = small_u8(value, "origin_method");
    let tranche_epoch = match object(value, "tranche_epoch") {
        Value::Null => None,
        Value::Number(number) => Some(
            number
                .as_u64()
                .and_then(|number| u32::try_from(number).ok())
                .unwrap_or_else(|| fail("tranche_epoch must fit u32")),
        ),
        _ => fail("tranche_epoch must be a number or null"),
    };
    RecoveryIntentV1 {
        schema_version: small_u8(value, "schema_version"),
        chain_id: string(value, "chain_id"),
        genesis_hash: fixed_hex(value, "genesis_hash"),
        core_account_id: string(value, "core_account_id"),
        instance_id: fixed_hex(value, "instance_id"),
        committee_epoch: small_u32(value, "committee_epoch"),
        transfer_id: u64_text(value, "transfer_id"),
        commitment_id: u64_text(value, "commitment_id"),
        kind: match kind {
            0 => TransferKindV1::Tranche,
            1 => TransferKindV1::EscrowRefund,
            other => fail(format!("unsupported transfer kind {other}")),
        },
        tranche_epoch,
        token_account_id: string(value, "token_account_id"),
        recipient_id: string(value, "recipient_id"),
        amount_raw: u128_text(value, "amount_raw"),
        origin_method: match origin_method {
            0 => OriginMethodV1::ClaimTranche,
            1 => OriginMethodV1::RefundRemaining,
            other => fail(format!("unsupported origin method {other}")),
        },
        token_code_hash: fixed_hex(value, "token_code_hash"),
        ft_transfer_deposit_yocto: u128_text(value, "ft_transfer_deposit_yocto"),
        ft_transfer_gas_tgas: u64_text(value, "ft_transfer_gas_tgas"),
    }
}

fn certificate(value: &Value) -> RecoveryCertificateV1 {
    RecoveryCertificateV1 {
        schema_version: small_u8(value, "schema_version"),
        intent: intent(object(value, "intent")),
        intent_hash: fixed_hex(value, "intent_hash"),
        origin_transaction_hash: fixed_hex(value, "origin_transaction_hash"),
        origin_receipt_id: fixed_hex(value, "origin_receipt_id"),
        origin_block_hash: fixed_hex(value, "origin_block_hash"),
        origin_block_height: u64_text(value, "origin_block_height"),
        token_receipt_id: fixed_hex(value, "token_receipt_id"),
        token_action_index: small_u32(value, "token_action_index"),
        outcome_block_hash: fixed_hex(value, "outcome_block_hash"),
        outcome_block_height: u64_text(value, "outcome_block_height"),
        outcome: match small_u8(value, "outcome") {
            0 => TransferOutcomeV1::Success,
            1 => TransferOutcomeV1::Failure,
            other => fail(format!("unsupported transfer outcome {other}")),
        },
    }
}

fn rotation(value: &Value) -> CommitteeRotationV2 {
    let keys = object(value, "new_keys")
        .as_array()
        .unwrap_or_else(|| fail("new_keys must be an array"));
    if keys.len() != 5 {
        fail("new_keys must contain exactly five keys");
    }
    let keys: [[u8; 32]; 5] = keys
        .iter()
        .map(|value| fixed_hex_field(value, "new key"))
        .collect::<Vec<_>>()
        .try_into()
        .unwrap_or_else(|_| fail("new_keys must contain exactly five keys"));
    CommitteeRotationV2 {
        schema_version: small_u8(value, "schema_version"),
        chain_id: string(value, "chain_id"),
        genesis_hash: fixed_hex(value, "genesis_hash"),
        core_account_id: string(value, "core_account_id"),
        instance_id: fixed_hex(value, "instance_id"),
        old_epoch: small_u32(value, "old_epoch"),
        new_epoch: small_u32(value, "new_epoch"),
        proposal_generation: u64_text(value, "proposal_generation"),
        new_keys: keys,
        activate_at_ns: u64_text(value, "activate_at_ns"),
    }
}

fn cancellation(value: &Value) -> CommitteeRotationCancellationV2 {
    CommitteeRotationCancellationV2 {
        schema_version: small_u8(value, "schema_version"),
        chain_id: string(value, "chain_id"),
        genesis_hash: fixed_hex(value, "genesis_hash"),
        core_account_id: string(value, "core_account_id"),
        instance_id: fixed_hex(value, "instance_id"),
        old_epoch: small_u32(value, "old_epoch"),
        new_epoch: small_u32(value, "new_epoch"),
        proposal_generation: u64_text(value, "proposal_generation"),
        proposal_digest: fixed_hex(value, "proposal_digest"),
    }
}

fn fixed_hex_field<const N: usize>(value: &Value, name: &str) -> [u8; N] {
    let encoded = value
        .as_str()
        .unwrap_or_else(|| fail(format!("{name} must be a JSON string")));
    decode_hex(encoded, name)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn domain_bytes(value: &str) -> Vec<u8> {
    let mut domain = value.as_bytes().to_vec();
    domain.push(0);
    domain
}

fn digest(domain: &str, message: &[u8]) -> [u8; 32] {
    let mut bytes = domain_bytes(domain);
    bytes.extend_from_slice(message);
    sha256(&bytes)
}

fn test_signing_key(label: &str) -> SigningKey {
    let seed = sha256(format!("LCP/NEP141/VECTORS/NOT-A-SECRET/{label}").as_bytes());
    SigningKey::from_bytes(&seed)
}

fn expected_signers(domain_digest: &[u8; 32], prefix: &str) -> Vec<([u8; 32], [u8; 64])> {
    let mut keys: Vec<SigningKey> = (1..=5)
        .map(|index| test_signing_key(&format!("{prefix}-{index}")))
        .collect();
    keys.sort_by_key(|key| key.verifying_key().to_bytes());
    keys.into_iter()
        .take(4)
        .map(|key| {
            let public_key = key.verifying_key().to_bytes();
            let signature = key.sign(domain_digest).to_bytes();
            (public_key, signature)
        })
        .collect()
}

fn all_test_signers(domain_digest: &[u8; 32], prefix: &str) -> Vec<SignatureEntry> {
    let mut keys: Vec<SigningKey> = (1..=5)
        .map(|index| test_signing_key(&format!("{prefix}-{index}")))
        .collect();
    keys.sort_by_key(|key| key.verifying_key().to_bytes());
    keys.into_iter()
        .map(|key| SignatureEntry {
            public_key: key.verifying_key().to_bytes(),
            signature: key.sign(domain_digest).to_bytes(),
        })
        .collect()
}

fn signers_from_json(value: &Value, domain_digest: &[u8; 32], prefix: &str) -> SignedVector {
    let expected = expected_signers(domain_digest, prefix);
    let values = value
        .as_array()
        .unwrap_or_else(|| fail("signatures must be an array"));
    if values.len() != 4 {
        fail("golden quorum must contain four signatures");
    }
    let mut entries = Vec::with_capacity(4);
    for (index, (public_key, signature)) in expected.into_iter().enumerate() {
        let json_entry = &values[index];
        if string(json_entry, "public_key_hex") != hex(&public_key)
            || string(json_entry, "signature_hex") != hex(&signature)
        {
            fail(format!(
                "signature vector entry {index} differs from Rust output"
            ));
        }
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .unwrap_or_else(|_| fail("derived public key is invalid"));
        verifying_key
            .verify_strict(
                domain_digest,
                &ed25519_dalek::Signature::from_bytes(&signature),
            )
            .unwrap_or_else(|_| fail("derived signature failed strict verification"));
        entries.push(SignatureEntry {
            public_key,
            signature,
        });
    }
    SignedVector { entries }
}

fn strict_verification_rejects(
    public_key_bytes: &[u8; 32],
    signature_bytes: &[u8; 64],
    message: &[u8; 32],
) -> bool {
    VerifyingKey::from_bytes(public_key_bytes)
        .and_then(|key| {
            key.verify_strict(
                message,
                &ed25519_dalek::Signature::from_bytes(signature_bytes),
            )
        })
        .is_err()
}

fn verify_strict_negative_cases(entry: &SignatureEntry, digest: &[u8; 32]) {
    let mut changed_message = *digest;
    changed_message[0] ^= 1;
    assert!(strict_verification_rejects(
        &entry.public_key,
        &entry.signature,
        &changed_message,
    ));

    let mut changed_signature = entry.signature;
    changed_signature[0] ^= 1;
    assert!(strict_verification_rejects(
        &entry.public_key,
        &changed_signature,
        digest,
    ));

    // Ed25519 group order L encoded little-endian. S = L is noncanonical.
    let noncanonical_s = decode_hex::<32>(
        "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010",
        "noncanonical Ed25519 S",
    );
    let mut changed_scalar = entry.signature;
    changed_scalar[32..].copy_from_slice(&noncanonical_s);
    assert!(strict_verification_rejects(
        &entry.public_key,
        &changed_scalar,
        digest,
    ));

    let all_zero_key = [0u8; 32];
    let mut identity_key = [0u8; 32];
    identity_key[0] = 1;
    assert!(strict_verification_rejects(
        &all_zero_key,
        &entry.signature,
        digest,
    ));
    assert!(strict_verification_rejects(
        &identity_key,
        &entry.signature,
        digest,
    ));

    // Compressed Edwards y = p is noncanonical; use it as both a public key
    // and R point to cover strict point decoding.
    let noncanonical_point = decode_hex::<32>(
        "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "noncanonical Ed25519 point",
    );
    assert!(strict_verification_rejects(
        &noncanonical_point,
        &entry.signature,
        digest,
    ));
    let mut noncanonical_r = entry.signature;
    noncanonical_r[..32].copy_from_slice(&noncanonical_point);
    assert!(strict_verification_rejects(
        &entry.public_key,
        &noncanonical_r,
        digest,
    ));
}

fn mutate_json_value(value: &mut Value) {
    match value {
        Value::String(text)
            if text.len() <= 39 && text.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            let number = text
                .parse::<u128>()
                .unwrap_or_else(|_| fail("numeric vector field must fit u128"));
            *text = number
                .checked_add(1)
                .unwrap_or_else(|| fail("numeric vector field overflowed"))
                .to_string();
        }
        Value::String(text)
            if text
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) =>
        {
            let first = text
                .chars()
                .next()
                .unwrap_or_else(|| fail("hex vector field must not be empty"));
            let replacement = if first == '0' { '1' } else { '0' };
            text.replace_range(..first.len_utf8(), &replacement.to_string());
        }
        Value::String(text) => {
            let first = text
                .chars()
                .next()
                .unwrap_or_else(|| fail("text vector field must not be empty"));
            let replacement = if first == 'a' { 'b' } else { 'a' };
            text.replace_range(..first.len_utf8(), &replacement.to_string());
        }
        Value::Number(number) => {
            let changed = number
                .as_u64()
                .and_then(|number| number.checked_add(1))
                .unwrap_or_else(|| fail("numeric vector field must fit u64"));
            *value = Value::from(changed);
        }
        Value::Null => *value = Value::from(3),
        _ => fail("unexpected field type in certificate mutation vector"),
    }
}

fn signature_entries_reject_digest(entries: &[SignatureEntry], digest: &[u8; 32]) {
    assert!(entries.iter().all(|entry| strict_verification_rejects(
        &entry.public_key,
        &entry.signature,
        digest,
    )));
}

fn verify_payload_field_mutations(
    certificate_json: &Value,
    original_digest: &[u8; 32],
    entries: &[SignatureEntry],
) {
    let paths = [
        vec!["schema_version"],
        vec!["intent", "schema_version"],
        vec!["intent", "chain_id"],
        vec!["intent", "genesis_hash"],
        vec!["intent", "core_account_id"],
        vec!["intent", "instance_id"],
        vec!["intent", "committee_epoch"],
        vec!["intent", "transfer_id"],
        vec!["intent", "commitment_id"],
        vec!["intent", "kind"],
        vec!["intent", "tranche_epoch"],
        vec!["intent", "token_account_id"],
        vec!["intent", "recipient_id"],
        vec!["intent", "amount_raw"],
        vec!["intent", "origin_method"],
        vec!["intent", "token_code_hash"],
        vec!["intent", "ft_transfer_deposit_yocto"],
        vec!["intent", "ft_transfer_gas_tgas"],
        vec!["intent_hash"],
        vec!["origin_transaction_hash"],
        vec!["origin_receipt_id"],
        vec!["origin_block_hash"],
        vec!["origin_block_height"],
        vec!["token_receipt_id"],
        vec!["token_action_index"],
        vec!["outcome_block_hash"],
        vec!["outcome_block_height"],
        vec!["outcome"],
    ];

    for path in paths {
        let mut changed = certificate_json.clone();
        let mut field = &mut changed;
        for key in &path {
            field = field
                .get_mut(*key)
                .unwrap_or_else(|| fail(format!("missing mutation field {}", path.join("."))));
        }
        mutate_json_value(field);
        let changed_certificate = certificate(&changed);
        let changed_bytes = borsh::to_vec(&changed_certificate)
            .unwrap_or_else(|_| fail("mutated certificate serialization failed"));
        let changed_digest = digest("LCP/NEP141/RECOVERY/V1", &changed_bytes);
        assert_ne!(
            changed_digest, *original_digest,
            "mutation did not change signed digest"
        );
        signature_entries_reject_digest(entries, &changed_digest);
    }
}

fn verify_domain_mutations(certificate_bytes: &[u8], entries: &[SignatureEntry]) {
    let mut domain_without_nul = domain_bytes("LCP/NEP141/RECOVERY/V1");
    domain_without_nul.pop();
    domain_without_nul.extend_from_slice(certificate_bytes);
    let without_nul = sha256(&domain_without_nul);
    signature_entries_reject_digest(entries, &without_nul);

    let changed_domain = digest("LCP/NEP141/RECOVERY/V2", certificate_bytes);
    signature_entries_reject_digest(entries, &changed_domain);
}

fn encode_test_envelope(certificate_bytes: &[u8], entries: &[SignatureEntry]) -> String {
    let bytes = borsh::to_vec(&Envelope {
        message_bytes: certificate_bytes.to_vec(),
        signatures: entries
            .iter()
            .map(|entry| SignatureEntry {
                public_key: entry.public_key,
                signature: entry.signature,
            })
            .collect(),
    })
    .unwrap_or_else(|_| fail("test envelope serialization failed"));
    BASE64_STANDARD.encode(bytes)
}

fn assert_parser_rejects(
    encoded: &str,
    committee_keys: &[[u8; 32]],
    expected_committee_epoch: u32,
    case: &str,
) {
    if parse_recovery_envelope(encoded, committee_keys, expected_committee_epoch).is_ok() {
        fail(format!("bounded parser accepted invalid case: {case}"));
    }
}

fn mutate_unused_base64_pad_bits(encoded: &str) -> Option<String> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let padding = encoded
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count();
    let unused_bits = match padding {
        1 => 2,
        2 => 4,
        _ => return None,
    };
    let mut bytes = encoded.as_bytes().to_vec();
    let final_data = bytes.len() - padding - 1;
    let index = ALPHABET
        .iter()
        .position(|byte| *byte == bytes[final_data])?;
    let mask = (1usize << unused_bits) - 1;
    let changed = (index & !mask) | ((index + 1) & mask);
    bytes[final_data] = ALPHABET[changed];
    String::from_utf8(bytes).ok()
}

fn certificate_tranche_option_offset(certificate_bytes: &[u8]) -> usize {
    let mut reader = BoundedReader::new(certificate_bytes);
    reader.u8().unwrap(); // certificate version
    reader.u8().unwrap(); // intent version
    reader
        .bounded_string(MAX_CHAIN_ID_BYTES, "chain_id")
        .unwrap();
    reader.fixed::<32>().unwrap();
    reader
        .bounded_string(MAX_ACCOUNT_ID_BYTES, "core_account_id")
        .unwrap();
    reader.fixed::<32>().unwrap();
    reader.u32().unwrap();
    reader.u64().unwrap();
    reader.u64().unwrap();
    reader.u8().unwrap();
    reader.offset
}

fn maximum_valid_certificate() -> Vec<u8> {
    let intent = RecoveryIntentV1 {
        schema_version: 1,
        chain_id: "a".repeat(MAX_CHAIN_ID_BYTES),
        genesis_hash: [0x11; 32],
        core_account_id: "a".repeat(MAX_ACCOUNT_ID_BYTES),
        instance_id: [0x22; 32],
        committee_epoch: 1,
        transfer_id: 1,
        commitment_id: 1,
        kind: TransferKindV1::Tranche,
        tranche_epoch: Some(0),
        token_account_id: "a".repeat(MAX_ACCOUNT_ID_BYTES),
        recipient_id: "a".repeat(MAX_ACCOUNT_ID_BYTES),
        amount_raw: 1,
        origin_method: OriginMethodV1::ClaimTranche,
        token_code_hash: [0x33; 32],
        ft_transfer_deposit_yocto: 1,
        ft_transfer_gas_tgas: 25,
    };
    let intent_bytes = borsh::to_vec(&intent).unwrap();
    assert_eq!(intent_bytes.len(), MAX_INTENT_BYTES);
    let certificate = RecoveryCertificateV1 {
        schema_version: 1,
        intent,
        intent_hash: digest("LCP/NEP141/INTENT/V1", &intent_bytes),
        origin_transaction_hash: [0x44; 32],
        origin_receipt_id: [0x55; 32],
        origin_block_hash: [0x66; 32],
        origin_block_height: 10,
        token_receipt_id: [0x77; 32],
        token_action_index: 0,
        outcome_block_hash: [0x88; 32],
        outcome_block_height: 11,
        outcome: TransferOutcomeV1::Success,
    };
    let bytes = borsh::to_vec(&certificate).unwrap();
    assert_eq!(bytes.len(), MAX_CERTIFICATE_BYTES);
    bytes
}

fn verify_bounded_parser_acceptance(
    certificate_bytes: &[u8],
    intent_bytes: &[u8],
    signatures: &[SignatureEntry],
    committee_keys: &[[u8; 32]],
    expected_committee_epoch: u32,
) {
    let encoded = encode_test_envelope(certificate_bytes, signatures);
    let parsed = parse_recovery_envelope(&encoded, committee_keys, expected_committee_epoch)
        .unwrap_or_else(|error| fail(format!("valid four-signature envelope rejected: {error}")));
    assert_eq!(parsed.signatures.len(), 4);
    assert_eq!(
        borsh::to_vec(&parsed.certificate).unwrap(),
        certificate_bytes
    );

    let maximum_certificate = maximum_valid_certificate();
    let maximum_digest = digest("LCP/NEP141/RECOVERY/V1", &maximum_certificate);
    let maximum_signatures = all_test_signers(&maximum_digest, "OLD-COMMITTEE");
    let maximum_envelope = encode_test_envelope(&maximum_certificate, &maximum_signatures);
    assert_eq!(maximum_envelope.len(), MAX_ENVELOPE_BASE64_BYTES);
    let maximum_parsed = parse_recovery_envelope(&maximum_envelope, committee_keys, 1)
        .unwrap_or_else(|error| fail(format!("maximum valid envelope rejected: {error}")));
    assert_eq!(maximum_parsed.signatures.len(), 5);

    let mut invalid = encoded.clone();
    invalid.replace_range(..1, "?");
    assert_parser_rejects(
        &invalid,
        committee_keys,
        expected_committee_epoch,
        "invalid Base64 alphabet",
    );
    assert_parser_rejects(
        &encoded.trim_end_matches('='),
        committee_keys,
        expected_committee_epoch,
        "missing Base64 padding",
    );
    let noncanonical_pad_bits = mutate_unused_base64_pad_bits(&encoded)
        .unwrap_or_else(|| fail("golden envelope unexpectedly has no Base64 padding"));
    assert_parser_rejects(
        &noncanonical_pad_bits,
        committee_keys,
        expected_committee_epoch,
        "noncanonical Base64 pad bits",
    );
    assert_parser_rejects(
        &"A".repeat(MAX_ENVELOPE_BASE64_BYTES + 1),
        committee_keys,
        expected_committee_epoch,
        "encoded envelope over limit",
    );
    let too_large_decoded = BASE64_STANDARD.encode(vec![0; MAX_ENVELOPE_BYTES + 1]);
    assert_parser_rejects(
        &too_large_decoded,
        committee_keys,
        expected_committee_epoch,
        "decoded envelope over limit",
    );

    let mut trailing = BASE64_STANDARD.decode(&encoded).unwrap();
    trailing.push(0);
    assert_parser_rejects(
        &BASE64_STANDARD.encode(trailing),
        committee_keys,
        expected_committee_epoch,
        "trailing envelope byte",
    );

    let mut oversized_certificate = Vec::new();
    oversized_certificate.extend_from_slice(&715u32.to_le_bytes());
    oversized_certificate.extend_from_slice(&vec![0; 715]);
    oversized_certificate.extend_from_slice(&(4u32).to_le_bytes());
    oversized_certificate.extend_from_slice(&vec![0; 4 * SIGNATURE_ENTRY_BYTES]);
    assert_parser_rejects(
        &BASE64_STANDARD.encode(oversized_certificate),
        committee_keys,
        expected_committee_epoch,
        "certificate Vec length over limit",
    );

    let mut oversized_inner_vec = certificate_bytes.to_vec();
    oversized_inner_vec[2..6].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_parser_rejects(
        &encode_test_envelope(&oversized_inner_vec, signatures),
        committee_keys,
        expected_committee_epoch,
        "oversized Borsh string length before allocation",
    );

    for (name, count) in [("three signatures", 3usize), ("six signatures", 6usize)] {
        let mut entries = signatures.to_vec();
        while entries.len() < count {
            entries.push(signatures[0].clone());
        }
        entries.truncate(count);
        assert_parser_rejects(
            &encode_test_envelope(certificate_bytes, &entries),
            committee_keys,
            expected_committee_epoch,
            name,
        );
    }

    let mut duplicate = signatures.to_vec();
    duplicate[1].public_key = duplicate[0].public_key;
    assert_parser_rejects(
        &encode_test_envelope(certificate_bytes, &duplicate),
        committee_keys,
        expected_committee_epoch,
        "duplicate signer",
    );
    let mut unsorted = signatures.to_vec();
    unsorted.swap(0, 1);
    assert_parser_rejects(
        &encode_test_envelope(certificate_bytes, &unsorted),
        committee_keys,
        expected_committee_epoch,
        "unsorted signers",
    );
    let mut bad_signature = signatures.to_vec();
    bad_signature[0].signature[0] ^= 1;
    assert_parser_rejects(
        &encode_test_envelope(certificate_bytes, &bad_signature),
        committee_keys,
        expected_committee_epoch,
        "changed signature",
    );

    let unauthorized = all_test_signers(
        &digest("LCP/NEP141/RECOVERY/V1", certificate_bytes),
        "UNAUTHORIZED-COMMITTEE",
    );
    assert_parser_rejects(
        &encode_test_envelope(certificate_bytes, &unauthorized[..4]),
        committee_keys,
        expected_committee_epoch,
        "valid signatures from unpinned keys",
    );

    let mut bad_certificate = certificate_bytes.to_vec();
    bad_certificate[0] = 2;
    assert_parser_rejects(
        &encode_test_envelope(&bad_certificate, signatures),
        committee_keys,
        expected_committee_epoch,
        "unsupported certificate version",
    );
    let mut trailing_certificate = certificate_bytes.to_vec();
    trailing_certificate.push(0);
    assert_parser_rejects(
        &encode_test_envelope(&trailing_certificate, signatures),
        committee_keys,
        expected_committee_epoch,
        "trailing certificate byte",
    );
    let mut bad_option = certificate_bytes.to_vec();
    let option_offset = certificate_tranche_option_offset(&bad_option);
    bad_option[option_offset] = 2;
    assert_parser_rejects(
        &encode_test_envelope(&bad_option, signatures),
        committee_keys,
        expected_committee_epoch,
        "invalid Option tag",
    );
    let mut bad_account = certificate_bytes.to_vec();
    let account = b"lcp-core-vector.testnet";
    let account_offset = bad_account
        .windows(account.len())
        .position(|window| window == account)
        .unwrap();
    bad_account[account_offset] = b'L';
    assert_parser_rejects(
        &encode_test_envelope(&bad_account, signatures),
        committee_keys,
        expected_committee_epoch,
        "noncanonical NEAR account ID",
    );
    let mut bad_intent_hash = certificate_bytes.to_vec();
    bad_intent_hash[1 + intent_bytes.len()] ^= 1;
    assert_parser_rejects(
        &encode_test_envelope(&bad_intent_hash, signatures),
        committee_keys,
        expected_committee_epoch,
        "intent hash mismatch",
    );
    let mut bad_action_index = certificate_bytes.to_vec();
    let action_index_offset = 1 + intent_bytes.len() + 32 + 32 + 32 + 32 + 8 + 32;
    bad_action_index[action_index_offset..action_index_offset + 4]
        .copy_from_slice(&1u32.to_le_bytes());
    assert_parser_rejects(
        &encode_test_envelope(&bad_action_index, signatures),
        committee_keys,
        expected_committee_epoch,
        "unsupported token action index",
    );
    assert_parser_rejects(
        &encoded,
        committee_keys,
        expected_committee_epoch + 1,
        "committee epoch mismatch",
    );
}

fn compare_hex(value: &Value, name: &str, actual: &[u8]) {
    if string(value, name) != hex(actual) {
        fail(format!("{name} differs from Rust output"));
    }
}

fn compare_envelope(
    value: &Value,
    bytes_name: &str,
    base64_name: &str,
    message_bytes: &[u8],
    signatures: &[SignatureEntry],
) {
    let envelope = Envelope {
        message_bytes: message_bytes.to_vec(),
        signatures: signatures
            .iter()
            .map(|entry| SignatureEntry {
                public_key: entry.public_key,
                signature: entry.signature,
            })
            .collect(),
    };
    let encoded =
        borsh::to_vec(&envelope).unwrap_or_else(|_| fail("Borsh envelope serialization failed"));
    compare_hex(value, bytes_name, &encoded);
    if string(value, base64_name) != BASE64_STANDARD.encode(encoded) {
        fail(format!("{base64_name} differs from Rust output"));
    }
}

fn compare_recovery(root: &Value) {
    let recovery = object(root, "recovery");
    let intent_value = object(recovery, "intent");
    let intent = intent(intent_value);
    let intent_bytes =
        borsh::to_vec(&intent).unwrap_or_else(|_| fail("intent serialization failed"));
    compare_hex(recovery, "intent_borsh_hex", &intent_bytes);
    let intent_digest = digest("LCP/NEP141/INTENT/V1", &intent_bytes);
    compare_hex(recovery, "intent_sha256_hex", &intent_digest);
    compare_hex(
        recovery,
        "intent_domain_hex",
        &domain_bytes("LCP/NEP141/INTENT/V1"),
    );

    let certificate = certificate(object(recovery, "certificate"));
    let certificate_bytes =
        borsh::to_vec(&certificate).unwrap_or_else(|_| fail("certificate serialization failed"));
    compare_hex(recovery, "certificate_borsh_hex", &certificate_bytes);
    let certificate_digest = digest("LCP/NEP141/RECOVERY/V1", &certificate_bytes);
    compare_hex(recovery, "certificate_digest_hex", &certificate_digest);
    compare_hex(
        recovery,
        "certificate_domain_hex",
        &domain_bytes("LCP/NEP141/RECOVERY/V1"),
    );

    let signers = signers_from_json(
        object(recovery, "signatures"),
        &certificate_digest,
        "OLD-COMMITTEE",
    );
    verify_strict_negative_cases(&signers.entries[0], &certificate_digest);
    verify_payload_field_mutations(
        object(recovery, "certificate"),
        &certificate_digest,
        &signers.entries,
    );
    verify_domain_mutations(&certificate_bytes, &signers.entries);
    compare_envelope(
        recovery,
        "envelope_borsh_hex",
        "envelope_base64",
        &certificate_bytes,
        &signers.entries,
    );
    let committee_json = object(root, "committee_public_keys_hex")
        .as_array()
        .unwrap_or_else(|| fail("committee_public_keys_hex must be an array"));
    if committee_json.len() != 5 {
        fail("committee_public_keys_hex must contain five keys");
    }
    let committee_keys: Vec<[u8; 32]> = committee_json
        .iter()
        .map(|value| {
            let encoded = value
                .as_str()
                .unwrap_or_else(|| fail("committee key must be a JSON string"));
            decode_hex(encoded, "committee key")
        })
        .collect();
    let mut derived_committee: Vec<[u8; 32]> = (1..=5)
        .map(|index| test_signing_key(&format!("OLD-COMMITTEE-{index}")))
        .map(|key| key.verifying_key().to_bytes())
        .collect();
    derived_committee.sort();
    if committee_keys != derived_committee {
        fail("committee public-key vector differs from Rust output");
    }
    let vector_envelope = string(recovery, "envelope_base64");
    let expected_committee_epoch = small_u32(intent_value, "committee_epoch");
    let parsed_vector =
        parse_recovery_envelope(&vector_envelope, &committee_keys, expected_committee_epoch)
            .unwrap_or_else(|error| fail(format!("golden recovery envelope rejected: {error}")));
    if parsed_vector.signatures.len() != 4 {
        fail("golden recovery envelope must contain four signatures");
    }
    verify_bounded_parser_acceptance(
        &certificate_bytes,
        &intent_bytes,
        &signers.entries,
        &committee_keys,
        expected_committee_epoch,
    );
    println!("Bounded reference parser accepts canonical 4-of-5 and maximum 5-of-5 envelopes; malformed and oversized mutations are rejected.");
    println!("Recovery signatures reject each mutated certificate field and domain, plus strict Ed25519 negative cases.");
}

fn compare_governance(root: &Value) {
    let governance = object(root, "governance");
    let rotation_json = object(governance, "rotation");
    let rotation = rotation(object(rotation_json, "message"));
    let rotation_bytes =
        borsh::to_vec(&rotation).unwrap_or_else(|_| fail("rotation serialization failed"));
    compare_hex(rotation_json, "borsh_hex", &rotation_bytes);
    let rotation_digest = digest("LCP/NEP141/COMMITTEE-ROTATION/V2", &rotation_bytes);
    compare_hex(rotation_json, "digest_hex", &rotation_digest);
    compare_hex(
        rotation_json,
        "domain_hex",
        &domain_bytes("LCP/NEP141/COMMITTEE-ROTATION/V2"),
    );
    let rotation_signers = signers_from_json(
        object(rotation_json, "signatures"),
        &rotation_digest,
        "OLD-COMMITTEE",
    );
    compare_envelope(
        rotation_json,
        "envelope_borsh_hex",
        "envelope_base64",
        &rotation_bytes,
        &rotation_signers.entries,
    );

    let cancellation_json = object(governance, "cancellation");
    let cancellation = cancellation(object(cancellation_json, "message"));
    let cancellation_bytes =
        borsh::to_vec(&cancellation).unwrap_or_else(|_| fail("cancellation serialization failed"));
    compare_hex(cancellation_json, "borsh_hex", &cancellation_bytes);
    let cancellation_digest = digest("LCP/NEP141/ROTATION-CANCEL/V2", &cancellation_bytes);
    compare_hex(cancellation_json, "digest_hex", &cancellation_digest);
    compare_hex(
        cancellation_json,
        "domain_hex",
        &domain_bytes("LCP/NEP141/ROTATION-CANCEL/V2"),
    );
    let cancellation_signers = signers_from_json(
        object(cancellation_json, "signatures"),
        &cancellation_digest,
        "OLD-COMMITTEE",
    );
    compare_envelope(
        cancellation_json,
        "envelope_borsh_hex",
        "envelope_base64",
        &cancellation_bytes,
        &cancellation_signers.entries,
    );
}

fn main() {
    let input = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("../golden-vectors.json"));
    let bytes = fs::read(&input)
        .unwrap_or_else(|error| fail(format!("could not read {}: {error}", input.display())));
    let root: Value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|error| fail(format!("invalid vector JSON: {error}")));
    compare_recovery(&root);
    compare_governance(&root);
    println!(
        "Rust Borsh, SHA-256, envelope, and strict Ed25519 outputs match the synthetic vectors."
    );
}
