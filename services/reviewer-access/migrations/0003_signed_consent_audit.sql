ALTER TABLE reviewer_requests ADD COLUMN request_public_key TEXT;
ALTER TABLE reviewer_requests ADD COLUMN request_signature_b64 TEXT;
ALTER TABLE reviewer_requests ADD COLUMN request_callback_url TEXT;

ALTER TABLE reviewer_requests ADD COLUMN resolution_public_key TEXT;
ALTER TABLE reviewer_requests ADD COLUMN resolution_signature_b64 TEXT;
ALTER TABLE reviewer_requests ADD COLUMN resolution_callback_url TEXT;
