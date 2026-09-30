import { pool } from './index.ts';
import { hashPassword } from '../server/localAuth.ts';

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  auth_provider TEXT NOT NULL DEFAULT 'local',
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_secret_encrypted TEXT NOT NULL DEFAULT '',
  totp_pending_secret_encrypted TEXT NOT NULL DEFAULT '',
  recovery_codes_hashes TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes_hashes TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS servers (
  id SERIAL PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES users(uid),
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'password',
  encrypted_secret TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_check_error TEXT NOT NULL DEFAULT '',
  last_checked_at TIMESTAMP,
  latency_ms INTEGER,
  os_info TEXT NOT NULL DEFAULT '',
  kernel_info TEXT NOT NULL DEFAULT '',
  cpu_cores INTEGER,
  cpu_load TEXT NOT NULL DEFAULT '',
  cpu_usage_percent INTEGER,
  memory_mb INTEGER,
  memory_used_mb INTEGER,
  disk_total_gb TEXT NOT NULL DEFAULT '',
  disk_used_gb TEXT NOT NULL DEFAULT '',
  disk_usage_percent INTEGER,
  uptime_info TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ssh_command_logs (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL REFERENCES users(uid),
  command TEXT NOT NULL,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  exit_code INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_metrics (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  cpu_usage_percent INTEGER NOT NULL DEFAULT 0,
  memory_usage_percent INTEGER NOT NULL DEFAULT 0,
  memory_used_mb INTEGER NOT NULL DEFAULT 0,
  disk_usage_percent INTEGER NOT NULL DEFAULT 0,
  load_1m TEXT NOT NULL DEFAULT '0.00',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  hostname TEXT NOT NULL DEFAULT '',
  os_distribution TEXT NOT NULL DEFAULT '',
  kernel TEXT NOT NULL DEFAULT '',
  architecture TEXT NOT NULL DEFAULT '',
  cpu_count INTEGER NOT NULL DEFAULT 0,
  ram_total_bytes TEXT NOT NULL DEFAULT '0',
  uptime_seconds INTEGER NOT NULL DEFAULT 0,
  enrollment_token_hash TEXT NOT NULL DEFAULT '',
  enrollment_token_encrypted TEXT NOT NULL DEFAULT '',
  credential_hash TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

export const DEFAULT_LOCAL_ADMIN_UID = 'infralab-local-operator';
export const DEFAULT_LOCAL_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const DEFAULT_LOCAL_ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || process.env.OPERATOR_EMAIL || 'admin@infralab.local';
export const DEFAULT_LOCAL_ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'InfraLab!2026';

export async function seedDefaultLocalAdmin(): Promise<void> {
  try {
    const existing = await pool.query(
      'SELECT uid, username, password_hash FROM users WHERE uid = $1 OR lower(username) = lower($2) LIMIT 1',
      [DEFAULT_LOCAL_ADMIN_UID, DEFAULT_LOCAL_ADMIN_USERNAME]
    );

    if (existing.rows.length === 0) {
      const passwordHash = hashPassword(DEFAULT_LOCAL_ADMIN_PASSWORD);
      await pool.query(
        `INSERT INTO users (uid, email, username, password_hash, auth_provider, totp_enabled)
         VALUES ($1, $2, $3, $4, 'local', 0)
         ON CONFLICT (uid) DO NOTHING`,
        [
          DEFAULT_LOCAL_ADMIN_UID,
          DEFAULT_LOCAL_ADMIN_EMAIL,
          DEFAULT_LOCAL_ADMIN_USERNAME,
          passwordHash,
        ]
      );
    } else {
      const row = existing.rows[0];
      if (!row.password_hash) {
        const passwordHash = hashPassword(DEFAULT_LOCAL_ADMIN_PASSWORD);
        await pool.query(
          `UPDATE users
           SET username = CASE WHEN username = '' THEN $2 ELSE username END,
               email = $3,
               password_hash = $4,
               auth_provider = 'local'
           WHERE uid = $1`,
          [
            row.uid,
            DEFAULT_LOCAL_ADMIN_USERNAME,
            DEFAULT_LOCAL_ADMIN_EMAIL,
            passwordHash,
          ]
        );
      }
    }
  } catch (err) {
    console.error('Default admin user seed warning:', err);
  }
}

export async function ensureDatabaseSchema(): Promise<void> {
  try {
    await pool.query(BOOTSTRAP_SQL);
  } catch {
    // In managed Cloud SQL, DDL is applied via migrations/UpdateSchema; proceed to seed admin
  }
  await seedDefaultLocalAdmin();
}
