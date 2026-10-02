CREATE TABLE IF NOT EXISTS ansible_inventories (
  id SERIAL PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT 'all',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ansible_inventory_servers (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES ansible_inventories(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(inventory_id, server_id)
);

CREATE TABLE IF NOT EXISTS ansible_playbooks (
  id SERIAL PRIMARY KEY,
  user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'unverified',
  validation_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ansible_jobs (
  id SERIAL PRIMARY KEY,
  playbook_id INTEGER REFERENCES ansible_playbooks(id) ON DELETE SET NULL,
  playbook_name TEXT NOT NULL,
  inventory_id INTEGER REFERENCES ansible_inventories(id) ON DELETE SET NULL,
  inventory_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  check_mode INTEGER NOT NULL DEFAULT 0,
  diff_mode INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  extra_vars_json TEXT NOT NULL DEFAULT '{}',
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES ansible_jobs(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  playbook_name TEXT NOT NULL,
  inventory_name TEXT NOT NULL,
  target_servers TEXT NOT NULL DEFAULT '[]',
  result TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ansible_inventories_user ON ansible_inventories(user_uid);
CREATE INDEX IF NOT EXISTS idx_ansible_playbooks_user ON ansible_playbooks(user_uid);
CREATE INDEX IF NOT EXISTS idx_ansible_jobs_creator ON ansible_jobs(created_by);
CREATE INDEX IF NOT EXISTS idx_ansible_jobs_status ON ansible_jobs(status);
