CREATE TABLE IF NOT EXISTS indexer_state (
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  next_block_height INTEGER NOT NULL,
  last_processed_height INTEGER,
  last_block_hash TEXT,
  observed_head_height INTEGER,
  last_indexed_at TEXT,
  last_error_code TEXT,
  PRIMARY KEY (network, contract_id)
);

CREATE TABLE IF NOT EXISTS indexed_lcp_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  commitment_id TEXT,
  block_height INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_timestamp_ns TEXT NOT NULL,
  shard_id INTEGER NOT NULL,
  outcome_index INTEGER NOT NULL,
  receipt_id TEXT NOT NULL,
  transaction_hash TEXT,
  log_index INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  UNIQUE (network, contract_id, block_hash, shard_id, receipt_id, log_index)
);

CREATE INDEX IF NOT EXISTS indexed_lcp_events_by_commitment
  ON indexed_lcp_events (network, contract_id, commitment_id, event_id DESC);
