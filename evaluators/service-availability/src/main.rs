use std::{
    io::{self, Read},
    process::ExitCode,
};

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const REQUEST_SCHEMA: &str = "lcp.service_availability.request.v1";
const POLICY_SCHEMA: &str = "lcp.service_availability.policy.v1";
const REPORT_SCHEMA: &str = "lcp.service_availability.report.v1";
const VERDICT_SCHEMA: &str = "lcp.evaluation.verdict.v3";
const MAX_INPUT_BYTES: usize = 32_768;
const MAX_SOURCES: usize = 8;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EvaluationRequest {
    schema: String,
    contract_id: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    evidence_hash: String,
    requested_at_ns: String,
    subject: String,
    source_policy_hash: String,
    source_policy: SourcePolicy,
    reports: Vec<SignedProbeReport>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SourcePolicy {
    schema: String,
    target_id: String,
    max_source_lag_ns: String,
    expected_status_min: u16,
    expected_status_max: u16,
    max_latency_ms: u32,
    minimum_agreeing_sources: u8,
    minimum_corroboration_bps: u16,
    sources: Vec<SourceDefinition>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SourceDefinition {
    source_id: String,
    operator_id: String,
    public_key_hex: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SignedProbeReport {
    payload: ProbeReportPayload,
    signature_hex: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProbeReportPayload {
    schema: String,
    contract_id: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    source_policy_hash: String,
    source_id: String,
    operator_id: String,
    target_id: String,
    observed_at_ns: String,
    observation: ProbeObservation,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ProbeObservation {
    HttpResponse {
        status_code: u16,
        latency_ms: u32,
        tls_verified: bool,
    },
    Timeout {
        elapsed_ms: u32,
    },
    TlsError,
    SourceError {
        code: String,
    },
}

#[derive(Serialize)]
struct EvaluationVerdict {
    schema: &'static str,
    request_transaction_hash: String,
    contract_id: String,
    commitment_id: String,
    evaluation_id: String,
    policy_version: u32,
    policy_hash: String,
    source_policy_hash: String,
    input_hash: String,
    evidence_hash: String,
    verdict: &'static str,
    observed_at_ns: String,
    source_counts: SourceCounts,
    corroboration_bps: u16,
    reason_codes: Vec<&'static str>,
}

#[derive(Serialize)]
struct SourceCounts {
    configured: u8,
    valid: u8,
    up: u8,
    down: u8,
    abstained: u8,
    required: u8,
}

#[derive(Clone, Copy)]
enum Vote {
    Up(u64),
    Down(u64),
    Abstain,
}

fn main() -> ExitCode {
    match evaluate_stdin() {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("service-availability-evaluator: {error}");
            ExitCode::FAILURE
        }
    }
}

fn evaluate_stdin() -> Result<String, &'static str> {
    let mut input = Vec::new();
    io::stdin()
        .take((MAX_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut input)
        .map_err(|_| "could not read evaluator input")?;
    if input.len() > MAX_INPUT_BYTES {
        return Err("input exceeds the 32768-byte limit");
    }
    let request_transaction_hash = std::env::var("NEAR_TRANSACTION_HASH")
        .map_err(|_| "OutLayer did not provide the originating NEAR transaction hash")?;
    evaluate_input(&input, &request_transaction_hash)
}

fn evaluate_input(input: &[u8], request_transaction_hash: &str) -> Result<String, &'static str> {
    let input_text = std::str::from_utf8(&input).map_err(|_| "input is not UTF-8")?;
    let request: EvaluationRequest =
        serde_json::from_str(input_text).map_err(|_| "request JSON is malformed")?;
    let canonical_input =
        serde_json::to_string(&request).map_err(|_| "request serialization failed")?;
    if canonical_input != input_text
        && input_text.strip_suffix('\n') != Some(canonical_input.as_str())
    {
        return Err("request JSON is not canonical compact JSON");
    }

    validate_request(&request)?;
    let source_policy_bytes = serde_json::to_vec(&request.source_policy)
        .map_err(|_| "source policy serialization failed")?;
    let source_policy_hash = sha256_hex(&source_policy_bytes);
    if source_policy_hash != request.source_policy_hash {
        return Err("source policy digest does not match its canonical bytes");
    }
    let reports_bytes =
        serde_json::to_vec(&request.reports).map_err(|_| "probe report serialization failed")?;
    if !lower_hex_32(&request.evidence_hash) || sha256_hex(&reports_bytes) != request.evidence_hash
    {
        return Err("evidence digest does not match the canonical report bundle");
    }

    let transaction_hash = bs58::decode(request_transaction_hash)
        .into_vec()
        .map_err(|_| "OutLayer provided an invalid NEAR transaction hash")?;
    if transaction_hash.len() != 32 {
        return Err("OutLayer provided an invalid NEAR transaction hash");
    }

    let mut votes = Vec::with_capacity(request.reports.len());
    let mut seen_source_ids = Vec::with_capacity(request.reports.len());
    for report in &request.reports {
        if seen_source_ids
            .iter()
            .any(|source_id| *source_id == report.payload.source_id)
        {
            return Err("an evaluation may include at most one report per source");
        }
        seen_source_ids.push(report.payload.source_id.as_str());
        let Some(source) = request
            .source_policy
            .sources
            .iter()
            .find(|source| source.source_id == report.payload.source_id)
        else {
            continue;
        };
        if !report_is_bound_and_signed(&request, &source_policy_hash, source, report)? {
            continue;
        }
        votes.push(classify_observation(&request.source_policy, report)?);
    }

    let mut up = 0u8;
    let mut down = 0u8;
    let mut abstained = 0u8;
    let mut up_times = Vec::with_capacity(votes.len());
    let mut down_times = Vec::with_capacity(votes.len());
    for vote in &votes {
        match vote {
            Vote::Up(observed_at_ns) => {
                up = up.saturating_add(1);
                up_times.push(*observed_at_ns);
            }
            Vote::Down(observed_at_ns) => {
                down = down.saturating_add(1);
                down_times.push(*observed_at_ns);
            }
            Vote::Abstain => abstained = abstained.saturating_add(1),
        }
    }

    let required = request.source_policy.minimum_agreeing_sources;
    let agreement = up.max(down);
    let corroboration_bps =
        (u32::from(agreement) * 10_000 / request.source_policy.sources.len() as u32) as u16;
    let coverage_threshold_met =
        corroboration_bps >= request.source_policy.minimum_corroboration_bps;
    let outcome = match (
        up >= required && coverage_threshold_met,
        down >= required && coverage_threshold_met,
    ) {
        (true, false) => "Compliant",
        (false, true) => "NonCompliant",
        _ => "Inconclusive",
    };
    let reason_codes = match outcome {
        "Compliant" => vec!["UPTIME_QUORUM_MET"],
        "NonCompliant" => vec!["DOWNTIME_QUORUM_MET"],
        _ if (up >= required || down >= required) && !coverage_threshold_met => {
            vec!["CORROBORATION_THRESHOLD_NOT_MET"]
        }
        _ if up > 0 && down > 0 => vec!["SOURCE_REPORTS_CONFLICT"],
        _ => vec!["SOURCE_QUORUM_NOT_MET"],
    };
    let observed_at_ns = match outcome {
        "Compliant" => up_times.into_iter().min(),
        "NonCompliant" => down_times.into_iter().min(),
        _ => None,
    }
    .unwrap_or_else(|| request.requested_at_ns.parse().unwrap_or_default());

    let input_hash = sha256_hex(&input);
    let verdict = EvaluationVerdict {
        schema: VERDICT_SCHEMA,
        request_transaction_hash: request_transaction_hash.to_string(),
        contract_id: request.contract_id,
        commitment_id: request.commitment_id,
        evaluation_id: request.evaluation_id,
        policy_version: request.policy_version,
        policy_hash: request.policy_hash,
        source_policy_hash,
        input_hash,
        evidence_hash: request.evidence_hash,
        verdict: outcome,
        observed_at_ns: observed_at_ns.to_string(),
        source_counts: SourceCounts {
            configured: request.source_policy.sources.len() as u8,
            valid: votes.len() as u8,
            up,
            down,
            abstained,
            required,
        },
        corroboration_bps,
        reason_codes,
    };
    serde_json::to_string(&verdict).map_err(|_| "verdict serialization failed")
}

fn validate_request(request: &EvaluationRequest) -> Result<(), &'static str> {
    if request.schema != REQUEST_SCHEMA || request.source_policy.schema != POLICY_SCHEMA {
        return Err("unsupported request or source policy schema");
    }
    if request.policy_version != 3 {
        return Err("service availability requires policy version 3");
    }
    if !valid_account_id(&request.contract_id)
        || !canonical_decimal(&request.commitment_id)
        || !canonical_decimal(&request.evaluation_id)
        || !canonical_decimal(&request.requested_at_ns)
        || !lower_hex_32(&request.policy_hash)
        || !lower_hex_32(&request.source_policy_hash)
        || !lower_hex_32(&request.source_policy.target_id)
    {
        return Err("request identifiers or digests are invalid");
    }
    if request.source_policy.sources.len() < 2 || request.source_policy.sources.len() > MAX_SOURCES
    {
        return Err("source roster must contain between 2 and 8 operators");
    }
    if request.reports.len() > request.source_policy.sources.len() {
        return Err("there cannot be more reports than configured sources");
    }
    if request.source_policy.minimum_agreeing_sources == 0
        || usize::from(request.source_policy.minimum_agreeing_sources)
            > request.source_policy.sources.len()
        || usize::from(request.source_policy.minimum_agreeing_sources) * 2
            <= request.source_policy.sources.len()
    {
        return Err(
            "minimum agreeing source count must be a strict majority of the configured roster",
        );
    }
    if request.source_policy.minimum_corroboration_bps > 10_000 {
        return Err("minimum corroboration must be between 0 and 10000 basis points");
    }
    if request.source_policy.expected_status_min < 100
        || request.source_policy.expected_status_max > 599
        || request.source_policy.expected_status_min > request.source_policy.expected_status_max
        || request.source_policy.max_latency_ms == 0
    {
        return Err("service availability rules are invalid");
    }
    let max_lag = parse_decimal_u64(&request.source_policy.max_source_lag_ns)
        .filter(|value| *value > 0)
        .ok_or("maximum source lag must be a positive decimal u64")?;
    if parse_decimal_u64(&request.requested_at_ns).is_none() || max_lag == 0 {
        return Err("request time or source lag is invalid");
    }

    let mut previous_source_id: Option<&str> = None;
    for (index, source) in request.source_policy.sources.iter().enumerate() {
        if !valid_identifier(&source.source_id) || !valid_identifier(&source.operator_id) {
            return Err("source and operator IDs must use lowercase letters, digits, dot, underscore, or hyphen");
        }
        if previous_source_id.is_some_and(|previous| previous >= source.source_id.as_str()) {
            return Err("source roster must be sorted by unique source ID");
        }
        if request.source_policy.sources[..index]
            .iter()
            .any(|earlier| earlier.operator_id == source.operator_id)
        {
            return Err("each source must name a distinct configured operator");
        }
        if request.source_policy.sources[..index]
            .iter()
            .any(|earlier| earlier.public_key_hex == source.public_key_hex)
        {
            return Err("each source must use a distinct Ed25519 public key");
        }
        if decode_lower_hex::<32>(&source.public_key_hex).is_none() {
            return Err("source public keys must be 32-byte lowercase hexadecimal");
        }
        previous_source_id = Some(&source.source_id);
    }
    Ok(())
}

fn report_is_bound_and_signed(
    request: &EvaluationRequest,
    source_policy_hash: &str,
    source: &SourceDefinition,
    report: &SignedProbeReport,
) -> Result<bool, &'static str> {
    let payload = &report.payload;
    if payload.schema != REPORT_SCHEMA
        || payload.contract_id != request.contract_id
        || payload.commitment_id != request.commitment_id
        || payload.evaluation_id != request.evaluation_id
        || payload.policy_version != request.policy_version
        || payload.policy_hash != request.policy_hash
        || payload.source_policy_hash != source_policy_hash
        || payload.source_id != source.source_id
        || payload.operator_id != source.operator_id
        || payload.target_id != request.source_policy.target_id
    {
        return Ok(false);
    }
    let Some(observed_at_ns) = parse_decimal_u64(&payload.observed_at_ns) else {
        return Ok(false);
    };
    let requested_at_ns =
        parse_decimal_u64(&request.requested_at_ns).ok_or("request time is invalid")?;
    let max_lag = parse_decimal_u64(&request.source_policy.max_source_lag_ns)
        .ok_or("maximum source lag is invalid")?;
    if observed_at_ns > requested_at_ns || requested_at_ns - observed_at_ns > max_lag {
        return Ok(false);
    }

    let Some(key_bytes) = decode_lower_hex::<32>(&source.public_key_hex) else {
        return Ok(false);
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&key_bytes) else {
        return Ok(false);
    };
    let Some(signature_bytes) = decode_lower_hex::<64>(&report.signature_hex) else {
        return Ok(false);
    };
    let signature = Signature::from_bytes(&signature_bytes);
    let message = serde_json::to_vec(payload).map_err(|_| "probe report serialization failed")?;
    Ok(verifying_key.verify_strict(&message, &signature).is_ok())
}

fn classify_observation(
    policy: &SourcePolicy,
    report: &SignedProbeReport,
) -> Result<Vote, &'static str> {
    let observed_at_ns =
        parse_decimal_u64(&report.payload.observed_at_ns).ok_or("probe time is invalid")?;
    let vote = match &report.payload.observation {
        ProbeObservation::HttpResponse {
            status_code,
            latency_ms,
            tls_verified,
        } => {
            if !(100..=599).contains(status_code) {
                return Err("HTTP status code is invalid");
            }
            if *tls_verified
                && (*status_code >= policy.expected_status_min
                    && *status_code <= policy.expected_status_max)
                && *latency_ms <= policy.max_latency_ms
            {
                Vote::Up(observed_at_ns)
            } else {
                Vote::Down(observed_at_ns)
            }
        }
        ProbeObservation::Timeout { .. } | ProbeObservation::TlsError => Vote::Down(observed_at_ns),
        ProbeObservation::SourceError { code } => {
            if !valid_identifier(code) {
                return Err("source error codes must use a bounded lowercase identifier");
            }
            Vote::Abstain
        }
    };
    Ok(vote)
}

fn valid_account_id(value: &str) -> bool {
    (2..=64).contains(&value.len())
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && (label.as_bytes()[0].is_ascii_lowercase()
                    || label.as_bytes()[0].is_ascii_digit())
                && (label.as_bytes()[label.len() - 1].is_ascii_lowercase()
                    || label.as_bytes()[label.len() - 1].is_ascii_digit())
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn canonical_decimal(value: &str) -> bool {
    parse_decimal_u64(value).is_some()
}

fn parse_decimal_u64(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}

fn lower_hex_32(value: &str) -> bool {
    decode_lower_hex::<32>(value).is_some()
}

fn decode_lower_hex<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() != N * 2 || value.bytes().any(|byte| byte.is_ascii_uppercase()) {
        return None;
    }
    let mut output = [0; N];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(chunk[0])? << 4) | hex_nibble(chunk[1])?;
    }
    Some(output)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn lower_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn request_with_votes(up_votes: &[bool]) -> Vec<u8> {
        request_with_threshold(up_votes, 6_000)
    }

    fn request_with_threshold(up_votes: &[bool], threshold_bps: u16) -> Vec<u8> {
        let signing_keys = [
            SigningKey::from_bytes(&[1; 32]),
            SigningKey::from_bytes(&[2; 32]),
            SigningKey::from_bytes(&[3; 32]),
        ];
        let sources = signing_keys
            .iter()
            .enumerate()
            .map(|(index, key)| SourceDefinition {
                source_id: format!("source-{index}"),
                operator_id: format!("operator-{index}"),
                public_key_hex: lower_hex(&key.verifying_key().to_bytes()),
            })
            .collect();
        let source_policy = SourcePolicy {
            schema: POLICY_SCHEMA.to_string(),
            target_id: "a".repeat(64),
            max_source_lag_ns: "1000".to_string(),
            expected_status_min: 200,
            expected_status_max: 299,
            max_latency_ms: 500,
            minimum_agreeing_sources: 2,
            minimum_corroboration_bps: threshold_bps,
            sources,
        };
        let source_policy_hash = sha256_hex(&serde_json::to_vec(&source_policy).unwrap());
        let reports = up_votes
            .iter()
            .enumerate()
            .map(|(index, is_up)| {
                let payload = ProbeReportPayload {
                    schema: REPORT_SCHEMA.to_string(),
                    contract_id: "lcp.testnet".to_string(),
                    commitment_id: "7".to_string(),
                    evaluation_id: "3".to_string(),
                    policy_version: 3,
                    policy_hash: "b".repeat(64),
                    source_policy_hash: source_policy_hash.clone(),
                    source_id: format!("source-{index}"),
                    operator_id: format!("operator-{index}"),
                    target_id: "a".repeat(64),
                    observed_at_ns: "199".to_string(),
                    observation: if *is_up {
                        ProbeObservation::HttpResponse {
                            status_code: 200,
                            latency_ms: 40,
                            tls_verified: true,
                        }
                    } else {
                        ProbeObservation::HttpResponse {
                            status_code: 503,
                            latency_ms: 40,
                            tls_verified: true,
                        }
                    },
                };
                let signature = signing_keys[index].sign(&serde_json::to_vec(&payload).unwrap());
                SignedProbeReport {
                    payload,
                    signature_hex: lower_hex(&signature.to_bytes()),
                }
            })
            .collect::<Vec<_>>();
        let evidence_hash = sha256_hex(&serde_json::to_vec(&reports).unwrap());
        serde_json::to_vec(&EvaluationRequest {
            schema: REQUEST_SCHEMA.to_string(),
            contract_id: "lcp.testnet".to_string(),
            commitment_id: "7".to_string(),
            evaluation_id: "3".to_string(),
            policy_version: 3,
            policy_hash: "b".repeat(64),
            evidence_hash,
            requested_at_ns: "200".to_string(),
            subject: "Service availability test".to_string(),
            source_policy_hash,
            source_policy,
            reports,
        })
        .unwrap()
    }

    fn evaluate(up_votes: &[bool]) -> serde_json::Value {
        let transaction_hash = bs58::encode([9; 32]).into_string();
        let bytes = evaluate_input(&request_with_votes(up_votes), &transaction_hash).unwrap();
        serde_json::from_str(&bytes).unwrap()
    }

    #[test]
    fn two_independent_up_reports_produce_v3_compliant_verdict() {
        let output = evaluate(&[true, true]);
        assert_eq!(output["schema"], VERDICT_SCHEMA);
        assert_eq!(output["verdict"], "Compliant");
        assert_eq!(
            output["request_transaction_hash"],
            bs58::encode([9; 32]).into_string()
        );
        assert_eq!(output["source_counts"]["configured"], 3);
        assert_eq!(output["source_counts"]["up"], 2);
        assert_eq!(output["corroboration_bps"], 6_666);
        assert_eq!(output["observed_at_ns"], "199");
    }

    #[test]
    fn split_reports_are_inconclusive_and_use_the_request_time() {
        let output = evaluate(&[true, false]);
        assert_eq!(output["verdict"], "Inconclusive");
        assert_eq!(output["source_counts"]["up"], 1);
        assert_eq!(output["source_counts"]["down"], 1);
        assert_eq!(output["observed_at_ns"], "200");
    }

    #[test]
    fn down_quorum_is_noncompliant_and_stronger_coverage_floor_can_still_abstain() {
        let output = evaluate(&[false, false]);
        assert_eq!(output["verdict"], "NonCompliant");
        assert_eq!(output["source_counts"]["down"], 2);

        let transaction_hash = bs58::encode([9; 32]).into_string();
        let bytes = evaluate_input(
            &request_with_threshold(&[true, true], 7_000),
            &transaction_hash,
        )
        .unwrap();
        let output: serde_json::Value = serde_json::from_str(&bytes).unwrap();
        assert_eq!(output["verdict"], "Inconclusive");
        assert_eq!(output["reason_codes"][0], "CORROBORATION_THRESHOLD_NOT_MET");
    }

    #[test]
    fn evidence_hash_must_bind_the_canonical_report_bundle() {
        let mut request: EvaluationRequest =
            serde_json::from_slice(&request_with_votes(&[true, true])).unwrap();
        request.evidence_hash = "0".repeat(64);
        let bytes = serde_json::to_vec(&request).unwrap();
        let transaction_hash = bs58::encode([9; 32]).into_string();
        assert_eq!(
            evaluate_input(&bytes, &transaction_hash),
            Err("evidence digest does not match the canonical report bundle")
        );
    }
}
