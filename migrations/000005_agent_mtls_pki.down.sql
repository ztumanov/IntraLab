DROP INDEX IF EXISTS idx_agents_cert_serial;
DROP INDEX IF EXISTS idx_agents_cert_fingerprint;

ALTER TABLE agents DROP COLUMN IF EXISTS cert_revocation_reason;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_revoked_at;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_not_after;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_not_before;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_san_uri;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_subject;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_fingerprint_sha256;
ALTER TABLE agents DROP COLUMN IF EXISTS cert_serial;
ALTER TABLE agents DROP COLUMN IF EXISTS auth_mode;
