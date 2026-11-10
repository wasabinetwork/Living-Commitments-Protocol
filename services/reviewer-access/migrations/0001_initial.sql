CREATE TABLE IF NOT EXISTS reviewer_requests (
  request_id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  commitment_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  reviewer_account TEXT NOT NULL,
  encryption_public_key_b64 TEXT NOT NULL,
  encryption_key_fingerprint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at_ns TEXT NOT NULL,
  created_at_ns TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
);

CREATE INDEX IF NOT EXISTS reviewer_requests_by_commitment
  ON reviewer_requests (network, contract_id, commitment_id, status, created_at_ns DESC);

CREATE UNIQUE INDEX IF NOT EXISTS reviewer_requests_unique_pending
  ON reviewer_requests (network, contract_id, commitment_id, evaluation_id, evidence_digest, reviewer_account, encryption_key_fingerprint)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS encrypted_artifacts (
  artifact_id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  commitment_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  ciphertext_sha256 TEXT NOT NULL,
  ciphertext_bytes INTEGER NOT NULL,
  created_at_ns TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviewer_grants (
  grant_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES reviewer_requests(request_id),
  artifact_id TEXT NOT NULL REFERENCES encrypted_artifacts(artifact_id),
  owner_account TEXT NOT NULL,
  reviewer_account TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at_ns TEXT NOT NULL,
  hpke_enc_b64 TEXT NOT NULL,
  wrapped_key_b64 TEXT NOT NULL,
  content_iv_b64 TEXT NOT NULL,
  created_at_ns TEXT NOT NULL,
  revoked_at_ns TEXT,
  download_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS reviewer_grants_by_reviewer
  ON reviewer_grants (reviewer_account, created_at_ns DESC);

CREATE TABLE IF NOT EXISTS used_nep413_nonces (
  signer_account TEXT NOT NULL,
  action TEXT NOT NULL,
  nonce_hex TEXT NOT NULL,
  used_at_ns TEXT NOT NULL,
  PRIMARY KEY (signer_account, action, nonce_hex)
);

CREATE TABLE IF NOT EXISTS reviewer_access_windows (
  account_id TEXT NOT NULL,
  window_start_s INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (account_id, window_start_s)
);

CREATE TABLE IF NOT EXISTS reviewer_access_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id TEXT NOT NULL REFERENCES reviewer_grants(grant_id),
  actor_account TEXT NOT NULL,
  accessed_at_ns TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('download', 'revoke'))
);

CREATE INDEX IF NOT EXISTS reviewer_access_events_by_grant
  ON reviewer_access_events (grant_id, event_id DESC);
