CREATE TABLE IF NOT EXISTS servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    hostname VARCHAR(253) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    ssh_port INTEGER NOT NULL DEFAULT 22 CHECK (ssh_port >= 1 AND ssh_port <= 65535),
    username VARCHAR(64) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'online', 'offline')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servers_status ON servers (status);
CREATE INDEX IF NOT EXISTS idx_servers_created_at ON servers (created_at DESC);
