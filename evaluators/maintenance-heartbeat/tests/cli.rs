use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use sha2::{Digest, Sha256};

const REQUEST_SCHEMA: &str = "lcp.evaluation.request.v1";
const VERDICT_SCHEMA: &str = "lcp.evaluation.verdict.v2";
const HEARTBEAT_SCHEMA: &str = "lcp.heartbeat.v1";
const CONTRACT_ID: &str = "livingcommitmentsprotocol.testnet";
const CALLBACK_URL: &str = "https://lcp.example.test/commitments/24";

#[derive(Serialize)]
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
struct Evidence {
    #[serde(rename = "type")]
    evidence_type: String,
    artifact_hash: String,
    maintainer_public_key: String,
    signature: String,
    payload: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature_scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recipient: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    callback_url: Option<String>,
}

#[derive(Serialize)]
struct EvaluationRequest {
    schema: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    evidence_hash: String,
    observed_at_ns: String,
    subject: String,
    evidence: Evidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    contract_id: Option<String>,
}

fn signed_request(policy_version: u32) -> EvaluationRequest {
    // Fixed synthetic test key. Never reuse these bytes for a testnet or production account.
    let signing_key = SigningKey::from_bytes(&[7; 32]);
    let policy_hash = "11".repeat(32);
    let artifact_hash = "22".repeat(32);
    let observed_at_ns = "1794192696952171274".to_string();
    let subject = "Reproducible evaluator test".to_string();
    let payload = HeartbeatPayload {
        schema: HEARTBEAT_SCHEMA.to_string(),
        commitment_id: "24".to_string(),
        evaluation_id: "1".to_string(),
        policy_version,
        policy_hash: policy_hash.clone(),
        observed_at_ns: observed_at_ns.clone(),
        subject: subject.clone(),
        artifact_hash: artifact_hash.clone(),
    };
    let payload = serde_json::to_string(&payload).unwrap();

    let (maintainer_public_key, signature, signature_scheme, nonce_hex, recipient, callback_url) =
        if policy_version == 1 {
            let signature = signing_key.sign(payload.as_bytes());
            (
                encode_hex(&signing_key.verifying_key().to_bytes()),
                encode_hex(&signature.to_bytes()),
                None,
                None,
                None,
                None,
            )
        } else {
            let nonce = [0x33; 32];
            let message_hash = nep413_message_hash(&payload, nonce, CONTRACT_ID, CALLBACK_URL);
            let signature = signing_key.sign(&message_hash);
            (
                format!(
                    "ed25519:{}",
                    bs58::encode(signing_key.verifying_key().to_bytes()).into_string()
                ),
                BASE64_STANDARD.encode(signature.to_bytes()),
                Some("near_nep413".to_string()),
                Some(encode_hex(&nonce)),
                Some(CONTRACT_ID.to_string()),
                Some(CALLBACK_URL.to_string()),
            )
        };

    EvaluationRequest {
        schema: REQUEST_SCHEMA.to_string(),
        commitment_id: "24".to_string(),
        evaluation_id: "1".to_string(),
        policy_version,
        policy_hash,
        evidence_hash: sha256_hex(payload.as_bytes()),
        observed_at_ns,
        subject,
        evidence: Evidence {
            evidence_type: "signed_maintenance_heartbeat".to_string(),
            artifact_hash,
            maintainer_public_key,
            signature,
            payload,
            signature_scheme,
            nonce_hex,
            recipient,
            callback_url,
        },
        contract_id: (policy_version == 2).then(|| CONTRACT_ID.to_string()),
    }
}

fn run_evaluator(input: &[u8], transaction_hash: Option<&str>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_maintenance-heartbeat"));
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(transaction_hash) = transaction_hash {
        command.env("NEAR_TRANSACTION_HASH", transaction_hash);
    } else {
        command.env_remove("NEAR_TRANSACTION_HASH");
    }

    let mut child = command.spawn().unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}

fn evaluate_request(request: &EvaluationRequest) -> serde_json::Value {
    let input = serde_json::to_vec(request).unwrap();
    let transaction_hash = bs58::encode([0x44; 32]).into_string();
    let output = run_evaluator(&input, Some(&transaction_hash));
    assert!(
        output.status.success(),
        "evaluator failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn sha256_hex(input: &[u8]) -> String {
    encode_hex(&Sha256::digest(input))
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

fn nep413_message_hash(
    message: &str,
    nonce: [u8; 32],
    recipient: &str,
    callback_url: &str,
) -> [u8; 32] {
    const NEP413_TAG: u32 = (1 << 31) + 413;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&NEP413_TAG.to_le_bytes());
    append_borsh_string(&mut bytes, message);
    bytes.extend_from_slice(&nonce);
    append_borsh_string(&mut bytes, recipient);
    bytes.push(1); // callbackUrl: Some(url)
    append_borsh_string(&mut bytes, callback_url);
    Sha256::digest(bytes).into()
}

fn append_borsh_string(output: &mut Vec<u8>, value: &str) {
    output.extend_from_slice(&(value.len() as u32).to_le_bytes());
    output.extend_from_slice(value.as_bytes());
}

#[test]
fn cli_accepts_a_canonical_v1_ed25519_heartbeat() {
    let output = evaluate_request(&signed_request(1));
    assert_eq!(output["schema"], VERDICT_SCHEMA);
    assert_eq!(output["verdict"], "Compliant");
    assert_eq!(output["reason_codes"][0], "SIGNATURE_VALID");
    assert_eq!(output["reason_codes"][1], "ARTIFACT_HASH_FORMAT_VALID");
}

#[test]
fn cli_accepts_a_canonical_v2_nep413_heartbeat() {
    let output = evaluate_request(&signed_request(2));
    assert_eq!(output["verdict"], "Compliant");
    assert_eq!(
        output["request_transaction_hash"],
        bs58::encode([0x44; 32]).into_string()
    );
}

#[test]
fn cli_rejects_invalid_signatures_and_mismatched_bindings_as_noncompliant() {
    let mut invalid_signature = signed_request(1);
    invalid_signature.evidence.signature = encode_hex(&[0; 64]);
    let output = evaluate_request(&invalid_signature);
    assert_eq!(output["verdict"], "NonCompliant");
    assert_eq!(output["reason_codes"][0], "SIGNATURE_INVALID");

    let mut mismatched_binding = signed_request(2);
    mismatched_binding.subject = "Different subject".to_string();
    let output = evaluate_request(&mismatched_binding);
    assert_eq!(output["verdict"], "NonCompliant");
    assert_eq!(output["reason_codes"][0], "HEARTBEAT_BINDING_MISMATCH");
}

#[test]
fn cli_rejects_nep413_recipient_not_equal_to_the_contract() {
    let mut request = signed_request(2);
    request.evidence.recipient = Some("attacker.testnet".to_string());
    let output = evaluate_request(&request);
    assert_eq!(output["verdict"], "NonCompliant");
    assert_eq!(output["reason_codes"][0], "SIGNATURE_INVALID");
}

#[test]
fn cli_rejects_mismatched_evidence_digest_and_noncanonical_json() {
    let mut request = signed_request(1);
    request.evidence_hash = "00".repeat(32);
    let input = serde_json::to_vec(&request).unwrap();
    let output = run_evaluator(&input, Some(&bs58::encode([0x44; 32]).into_string()));
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("evidence digest does not match"));

    let input = serde_json::to_vec(&signed_request(1)).unwrap();
    let noncanonical = [b" ".as_slice(), input.as_slice()].concat();
    let output = run_evaluator(&noncanonical, Some(&bs58::encode([0x44; 32]).into_string()));
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("request JSON is not canonical"));
}

#[test]
fn cli_requires_a_valid_outlayer_transaction_hash() {
    let input = serde_json::to_vec(&signed_request(1)).unwrap();
    let missing = run_evaluator(&input, None);
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("did not provide"));

    let invalid = run_evaluator(&input, Some("not-a-near-transaction-hash"));
    assert!(!invalid.status.success());
    assert!(String::from_utf8_lossy(&invalid.stderr).contains("invalid NEAR transaction hash"));
}
