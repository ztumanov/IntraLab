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

CREATE INDEX IF NOT EXISTS idx_agents_agent_id ON agents(agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_enrollment_token_hash ON agents(enrollment_token_hash);
