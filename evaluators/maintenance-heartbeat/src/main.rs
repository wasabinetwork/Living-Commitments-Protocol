use std::{
    io::{self, Read},
    process::ExitCode,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const REQUEST_SCHEMA: &str = "lcp.evaluation.request.v1";
const VERDICT_SCHEMA: &str = "lcp.evaluation.verdict.v2";
const HEARTBEAT_SCHEMA: &str = "lcp.heartbeat.v1";
const EVIDENCE_TYPE: &str = "signed_maintenance_heartbeat";
const MAX_INPUT_BYTES: usize = 8_192;
const MAX_HEARTBEAT_BYTES: usize = 4_096;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EvaluationRequest {
    schema: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    evidence_hash: String,
    observed_at_ns: String,
    subject: String,
    evidence: SignedHeartbeatEvidence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    contract_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SignedHeartbeatEvidence {
    #[serde(rename = "type")]
    evidence_type: String,
    artifact_hash: String,
    maintainer_public_key: String,
    signature: String,
    payload: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    signature_scheme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    nonce_hex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recipient: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    callback_url: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct HeartbeatPayload {
    schema: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    observed_at_ns: String,
    subject: String,
    artifact_hash: String,
}

#[derive(Serialize)]
struct EvaluationVerdict {
    schema: &'static str,
    request_transaction_hash: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    input_hash: String,
    evidence_hash: String,
    observed_at_ns: String,
    verdict: &'static str,
    reason_codes: Vec<&'static str>,
}

fn main() -> ExitCode {
    match evaluate_stdin() {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("maintenance-heartbeat: {error}");
            ExitCode::FAILURE
        }
    }
}

fn evaluate_stdin() -> Result<String, &'static str> {
    let mut input_bytes = Vec::new();
    io::stdin()
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut input_bytes)
        .map_err(|_| "could not read evaluator input")?;
    if input_bytes.len() > MAX_INPUT_BYTES {
        return Err("input exceeds the configured size limit");
    }

    let input_text = std::str::from_utf8(&input_bytes).map_err(|_| "input is not UTF-8")?;
    let request: EvaluationRequest =
        serde_json::from_str(input_text).map_err(|_| "request JSON is malformed")?;
    if request.schema != REQUEST_SCHEMA {
        return Err("unsupported request schema");
    }
    if serde_json::to_string(&request).map_err(|_| "request serialization failed")? != input_text {
        return Err("request JSON is not canonical");
    }
    if request.evidence.evidence_type != EVIDENCE_TYPE {
        return Err("unsupported evidence type");
    }
    if request.evidence.payload.len() > MAX_HEARTBEAT_BYTES {
        return Err("heartbeat payload exceeds the configured size limit");
    }

    let request_transaction_hash = std::env::var("NEAR_TRANSACTION_HASH")
        .map_err(|_| "OutLayer did not provide the originating NEAR transaction hash")?;
    let transaction_hash_bytes = bs58::decode(&request_transaction_hash)
        .into_vec()
        .map_err(|_| "OutLayer provided an invalid NEAR transaction hash")?;
    if transaction_hash_bytes.len() != 32 {
        return Err("OutLayer provided an invalid NEAR transaction hash");
    }

    let payload: HeartbeatPayload = serde_json::from_str(&request.evidence.payload)
        .map_err(|_| "heartbeat payload is malformed")?;
    if serde_json::to_string(&payload).map_err(|_| "heartbeat serialization failed")?
        != request.evidence.payload
    {
        return Err("heartbeat payload is not canonical");
    }

    let input_hash = sha256_hex(&input_bytes);
    let evidence_hash = sha256_hex(request.evidence.payload.as_bytes());
    if !is_lower_hex_32(&request.evidence_hash) || request.evidence_hash != evidence_hash {
        return Err("evidence digest does not match the signed payload");
    }

    let payload_is_bound = payload.schema == HEARTBEAT_SCHEMA
        && is_canonical_decimal(&request.commitment_id)
        && is_canonical_decimal(&request.evaluation_id)
        && is_canonical_decimal(&request.observed_at_ns)
        && payload.commitment_id == request.commitment_id
        && payload.evaluation_id == request.evaluation_id
        && payload.policy_version == request.policy_version
        && payload.policy_hash == request.policy_hash
        && payload.observed_at_ns == request.observed_at_ns
        && payload.subject == request.subject
        && payload.artifact_hash == request.evidence.artifact_hash
        && is_lower_hex_32(&request.policy_hash)
        && is_lower_hex_32(&request.evidence.artifact_hash);

    let signature_valid = verify_signature(&request);
    let compliant = payload_is_bound && signature_valid;
    let reason_codes = if compliant {
        vec!["SIGNATURE_VALID", "ARTIFACT_HASH_FORMAT_VALID"]
    } else if !payload_is_bound {
        vec!["HEARTBEAT_BINDING_MISMATCH"]
    } else {
        vec!["SIGNATURE_INVALID"]
    };

    let output = EvaluationVerdict {
        schema: VERDICT_SCHEMA,
        request_transaction_hash,
        commitment_id: request.commitment_id,
        evaluation_id: request.evaluation_id,
        policy_version: request.policy_version,
        policy_hash: request.policy_hash,
        input_hash,
        evidence_hash,
        observed_at_ns: request.observed_at_ns,
        verdict: if compliant {
            "Compliant"
        } else {
            "NonCompliant"
        },
        reason_codes,
    };
    serde_json::to_string(&output).map_err(|_| "verdict serialization failed")
}

fn verify_signature(request: &EvaluationRequest) -> bool {
    let evidence = &request.evidence;
    let (public_key_bytes, signature_bytes, message, fallback_message) = match request
        .policy_version
    {
        1 => {
            if evidence.signature_scheme.is_some()
                || evidence.nonce_hex.is_some()
                || evidence.recipient.is_some()
                || evidence.callback_url.is_some()
                || evidence
                    .maintainer_public_key
                    .bytes()
                    .chain(evidence.signature.bytes())
                    .any(|byte| byte.is_ascii_uppercase())
            {
                return false;
            }
            let Some(public_key_bytes) = decode_hex::<32>(&evidence.maintainer_public_key) else {
                return false;
            };
            let Some(signature_bytes) = decode_hex::<64>(&evidence.signature) else {
                return false;
            };
            (
                public_key_bytes,
                signature_bytes,
                evidence.payload.as_bytes().to_vec(),
                None,
            )
        }
        2 => {
            if evidence.signature_scheme.as_deref() != Some("near_nep413") {
                return false;
            }
            let Some(encoded_key) = evidence.maintainer_public_key.strip_prefix("ed25519:") else {
                return false;
            };
            let Ok(public_key_bytes) = bs58::decode(encoded_key).into_vec() else {
                return false;
            };
            if public_key_bytes.len() != 32
                || bs58::encode(&public_key_bytes).into_string() != encoded_key
            {
                return false;
            }
            let Ok(public_key_bytes) = <[u8; 32]>::try_from(public_key_bytes) else {
                return false;
            };
            let Some(nonce_hex) = evidence.nonce_hex.as_deref() else {
                return false;
            };
            let Some(nonce) = decode_hex::<32>(nonce_hex) else {
                return false;
            };
            if encode_hex(&nonce) != nonce_hex {
                return false;
            }
            let Some(recipient) = evidence.recipient.as_deref() else {
                return false;
            };
            if request.contract_id.as_deref() != Some(recipient) {
                return false;
            }
            if evidence
                .callback_url
                .as_deref()
                .is_some_and(|callback_url| callback_url.is_empty() || callback_url.len() > 2_048)
            {
                return false;
            }
            let Ok(signature_vec) = BASE64_STANDARD.decode(&evidence.signature) else {
                return false;
            };
            if signature_vec.len() != 64
                || BASE64_STANDARD.encode(&signature_vec) != evidence.signature
            {
                return false;
            }
            let Ok(signature_bytes) = <[u8; 64]>::try_from(signature_vec) else {
                return false;
            };
            let Some(message) = nep413_message_hash_with_optional_callback(
                &evidence.payload,
                nonce,
                recipient,
                evidence.callback_url.as_deref(),
            ) else {
                return false;
            };
            let fallback_message = evidence.callback_url.as_deref().and_then(|_| {
                nep413_message_hash_with_optional_callback(
                    &evidence.payload,
                    nonce,
                    recipient,
                    None,
                )
            });
            (
                public_key_bytes,
                signature_bytes,
                message.to_vec(),
                fallback_message.map(|message| message.to_vec()),
            )
        }
        _ => return false,
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key_bytes) else {
        return false;
    };
    let signature = Signature::from_bytes(&signature_bytes);
    verifying_key.verify_strict(&message, &signature).is_ok()
        || fallback_message
            .as_deref()
            .is_some_and(|message| verifying_key.verify_strict(message, &signature).is_ok())
}

fn nep413_message_hash_with_optional_callback(
    message: &str,
    nonce: [u8; 32],
    recipient: &str,
    callback_url: Option<&str>,
) -> Option<[u8; 32]> {
    const NEP413_TAG: u32 = (1 << 31) + 413;
    let message_bytes = message.as_bytes();
    let recipient_bytes = recipient.as_bytes();
    let message_len = u32::try_from(message_bytes.len()).ok()?;
    let recipient_len = u32::try_from(recipient_bytes.len()).ok()?;
    let callback_url_bytes = callback_url.map(str::as_bytes);
    let callback_url_len = callback_url_bytes.and_then(|bytes| u32::try_from(bytes.len()).ok());
    let mut payload = Vec::with_capacity(
        4 + 4
            + message_bytes.len()
            + 32
            + 4
            + recipient_bytes.len()
            + callback_url_bytes.map_or(1, |bytes| 1 + 4 + bytes.len()),
    );
    payload.extend_from_slice(&NEP413_TAG.to_le_bytes());
    payload.extend_from_slice(&message_len.to_le_bytes());
    payload.extend_from_slice(message_bytes);
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&recipient_len.to_le_bytes());
    payload.extend_from_slice(recipient_bytes);
    match (callback_url_bytes, callback_url_len) {
        (Some(bytes), Some(length)) => {
            payload.push(1); // callbackUrl: Some(url)
            payload.extend_from_slice(&length.to_le_bytes());
            payload.extend_from_slice(bytes);
        }
        (None, None) => payload.push(0), // callbackUrl: None
        _ => return None,
    }
    Some(Sha256::digest(payload).into())
}

fn sha256_hex(input: &[u8]) -> String {
    let digest = Sha256::digest(input);
    encode_hex(&digest)
}

fn is_lower_hex_32(input: &str) -> bool {
    decode_hex::<32>(input).is_some() && input.bytes().all(|byte| !byte.is_ascii_uppercase())
}

fn is_canonical_decimal(input: &str) -> bool {
    input
        .parse::<u64>()
        .map(|value| value.to_string() == input)
        .unwrap_or(false)
}

fn decode_hex<const N: usize>(input: &str) -> Option<[u8; N]> {
    if input.len() != N * 2 {
        return None;
    }
    let mut output = [0u8; N];
    for (index, pair) in input.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Some(output)
}

fn encode_hex(input: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(input.len() * 2);
    for byte in input {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}
