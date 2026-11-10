CREATE TABLE IF NOT EXISTS indexer_leases (
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  PRIMARY KEY (network, contract_id)
);
