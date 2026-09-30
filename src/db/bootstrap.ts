import { pool } from './index.ts';

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

export async function ensureDatabaseSchema(): Promise<void> {
  try {
    await pool.query(BOOTSTRAP_SQL);
  } catch (err) {
    console.error('Database schema auto-bootstrap warning:', err);
  }
}
