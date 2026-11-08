use std::{
    io::{self, Read},
    process::ExitCode,
};

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const REQUEST_SCHEMA: &str = "lcp.evaluation.request.v1";
const VERDICT_SCHEMA: &str = "lcp.evaluation.verdict.v1";
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

    let signature_valid = verify_signature(&request.evidence, request.evidence.payload.as_bytes());
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

fn verify_signature(evidence: &SignedHeartbeatEvidence, message: &[u8]) -> bool {
    if evidence
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
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key_bytes) else {
        return false;
    };
    let signature = Signature::from_bytes(&signature_bytes);
    verifying_key.verify_strict(message, &signature).is_ok()
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
