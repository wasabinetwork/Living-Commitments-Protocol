ALTER TABLE reviewer_requests ADD COLUMN resolved_by TEXT;
ALTER TABLE reviewer_requests ADD COLUMN resolved_at_ns TEXT;

ALTER TABLE encrypted_artifacts ADD COLUMN deleted_at_ns TEXT;

CREATE INDEX IF NOT EXISTS encrypted_artifacts_for_expiry
  ON encrypted_artifacts (deleted_at_ns, created_at_ns);
