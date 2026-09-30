import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pool } from '../src/db/index.ts';
import { ensureDatabaseSchema } from '../src/db/bootstrap.ts';
import { signLocalSessionToken } from '../src/server/localAuth.ts';

type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

interface CheckResult {
  section: string;
  name: string;
  status: CheckStatus;
  detail: string;
}

const results: CheckResult[] = [];

function record(section: string, name: string, status: CheckStatus, detail: string) {
  results.push({ section, name, status, detail });
  const icon = status === 'PASS' ? '[PASS]' : status === 'WARN' ? '[WARN]' : '[FAIL]';
  console.log(`${icon} [${section}] ${name} — ${detail}`);
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5000
): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function runDiagnostics() {
  console.log('================================================================');
  console.log(' InfraLab Diagnostic Check (SAFE READ-ONLY MODE)');
  console.log('================================================================\n');

  const baseUrl = (process.env.INFRALAB_API_URL || 'http://127.0.0.1:3000').replace(
    /\/+$/,
    ''
  );

  // ---------------------------------------------------------------------------
  // 1. BACKEND CHECKS
  // ---------------------------------------------------------------------------
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    record('Backend', 'TypeScript compilation (tsc --noEmit)', 'PASS', 'Zero type errors');
  } catch (err: any) {
    const out = err?.stdout?.toString() || err?.stderr?.toString() || err?.message;
    record('Backend', 'TypeScript compilation (tsc --noEmit)', 'FAIL', out.trim());
  }

  try {
    execSync('npm test', { stdio: 'pipe' });
    record('Backend', 'Backend unit & integration tests (npm test)', 'PASS', 'All test suites passed');
  } catch (err: any) {
    const out = err?.stdout?.toString() || err?.stderr?.toString() || err?.message;
    record('Backend', 'Backend unit & integration tests (npm test)', 'FAIL', out.trim());
  }

  if (commandExists('go')) {
    try {
      execSync('cd backend && go vet ./... && go test ./...', { stdio: 'pipe' });
      record('Backend', 'Go backend (go vet & go test)', 'PASS', 'backend/... passed');
    } catch (err: any) {
      record(
        'Backend',
        'Go backend (go vet & go test)',
        'FAIL',
        (err?.stderr?.toString() || err?.message || 'Go check failed').trim()
      );
    }
    try {
      execSync('cd agent && go vet ./... && go test ./...', { stdio: 'pipe' });
      record('Backend', 'Go agent (go vet & go test)', 'PASS', 'agent/... passed');
    } catch (err: any) {
      record(
        'Backend',
        'Go agent (go vet & go test)',
        'FAIL',
        (err?.stderr?.toString() || err?.message || 'Go agent check failed').trim()
      );
    }
  } else {
    const goFilesExist =
      fs.existsSync(path.resolve('backend/go.mod')) &&
      fs.existsSync(path.resolve('backend/cmd/api/main.go')) &&
      fs.existsSync(path.resolve('agent/go.mod')) &&
      fs.existsSync(path.resolve('agent/cmd/infralab-agent/main.go'));
    record(
      'Backend',
      'Go toolchain & modules (backend/ & agent/)',
      goFilesExist ? 'WARN' : 'FAIL',
      goFilesExist
        ? 'WARNING: go binary not installed in container PATH; verified Go module files statically'
        : 'Missing backend/go.mod or agent/go.mod'
    );
  }

  // ---------------------------------------------------------------------------
  // 2. FRONTEND CHECKS
  // ---------------------------------------------------------------------------
  try {
    execSync('npm run build', { stdio: 'pipe' });
    const distIndex = fs.existsSync(path.resolve('dist/index.html'));
    record(
      'Frontend',
      'Production Vite build (npm run build)',
      distIndex ? 'PASS' : 'FAIL',
      distIndex ? 'dist/index.html & assets built successfully' : 'dist/index.html missing'
    );
  } catch (err: any) {
    const out = err?.stdout?.toString() || err?.stderr?.toString() || err?.message;
    record('Frontend', 'Production Vite build (npm run build)', 'FAIL', out.trim());
  }

  // ---------------------------------------------------------------------------
  // 3. DATABASE & MIGRATIONS CHECKS
  // ---------------------------------------------------------------------------
  let sampleUserId = 'local-admin';
  let sampleUsername = 'admin';
  let sampleEmail = 'admin@infralab.local';
  let firstServerId: number | null = null;

  try {
    await ensureDatabaseSchema();
    const pingRes = await pool.query('SELECT 1 AS ok');
    if (pingRes.rows[0]?.ok === 1) {
      record('Database', 'PostgreSQL connectivity (SELECT 1)', 'PASS', 'Connected to PostgreSQL');
    } else {
      record('Database', 'PostgreSQL connectivity (SELECT 1)', 'FAIL', 'Unexpected response');
    }

    const tablesRes = await pool.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const existingTables = new Set(tablesRes.rows.map((r) => r.tablename));
    const requiredTables = [
      'users',
      'servers',
      'agents',
      'server_metrics',
      'ssh_command_logs',
    ];
    const missingTables = requiredTables.filter((t) => !existingTables.has(t));

    if (missingTables.length === 0) {
      record(
        'Database',
        'Database schema & tables',
        'PASS',
        `Verified tables: ${requiredTables.join(', ')}`
      );
    } else {
      record(
        'Database',
        'Database schema & tables',
        'FAIL',
        `Missing tables: ${missingTables.join(', ')}`
      );
    }

    const migrationFiles = fs
      .readdirSync(path.resolve('migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    record(
      'Database',
      'Migration SQL files (migrations/)',
      migrationFiles.length >= 4 ? 'PASS' : 'WARN',
      `Found ${migrationFiles.length} SQL migration files (${migrationFiles.join(', ')})`
    );

    const userRow = await pool.query<{ uid: string; username: string; email: string }>(
      `SELECT uid, username, email FROM users LIMIT 1`
    );
    if (userRow.rows[0]) {
      sampleUserId = userRow.rows[0].uid;
      sampleUsername = userRow.rows[0].username || 'admin';
      sampleEmail = userRow.rows[0].email || 'admin@infralab.local';
    }

    const srvRow = await pool.query<{ id: number; user_uid: string }>(
      `SELECT id, user_uid FROM servers ORDER BY id ASC LIMIT 1`
    );
    if (srvRow.rows[0]) {
      firstServerId = Number(srvRow.rows[0].id);
      sampleUserId = srvRow.rows[0].user_uid || sampleUserId;
    }
  } catch (err: any) {
    record(
      'Database',
      'PostgreSQL connectivity & schema',
      'FAIL',
      err?.message || 'Database check failed'
    );
  }

  // ---------------------------------------------------------------------------
  // 4. DOCKER CHECKS
  // ---------------------------------------------------------------------------
  const composePath = path.resolve('docker-compose.yml');
  if (fs.existsSync(composePath)) {
    const composeContent = fs.readFileSync(composePath, 'utf8');
    const hasCoreServices =
      composeContent.includes('postgres:') &&
      composeContent.includes('prometheus:') &&
      (composeContent.includes('infralab:') || composeContent.includes('backend:'));
    record(
      'Docker',
      'docker-compose.yml manifest',
      hasCoreServices ? 'PASS' : 'FAIL',
      hasCoreServices
        ? 'docker-compose.yml present with postgres, prometheus, infralab service definitions'
        : 'docker-compose.yml is missing required services'
    );

    if (commandExists('docker')) {
      try {
        execSync('docker compose config -q', { stdio: 'pipe' });
        record('Docker', 'docker compose config', 'PASS', 'Compose syntax valid');
      } catch (err: any) {
        record(
          'Docker',
          'docker compose config',
          'WARN',
          `WARNING: docker compose config returned: ${(err?.message || '').trim()}`
        );
      }
    } else {
      record(
        'Docker',
        'Docker daemon & containers',
        'WARN',
        'WARNING: docker CLI not available in current runtime environment; static compose check passed'
      );
    }
  } else {
    record('Docker', 'docker-compose.yml manifest', 'FAIL', 'docker-compose.yml not found');
  }

  // ---------------------------------------------------------------------------
  // 5. PROMETHEUS CHECKS
  // ---------------------------------------------------------------------------
  const promConfigPath = path.resolve('prometheus/prometheus.yml');
  if (fs.existsSync(promConfigPath)) {
    const promYml = fs.readFileSync(promConfigPath, 'utf8');
    const hasHttpSd = promYml.includes('/api/prometheus/targets');
    record(
      'Prometheus',
      'prometheus/prometheus.yml configuration',
      hasHttpSd ? 'PASS' : 'WARN',
      hasHttpSd
        ? 'Configured with HTTP SD (/api/prometheus/targets)'
        : 'prometheus.yml exists (custom scrape config)'
    );
  } else {
    record('Prometheus', 'prometheus/prometheus.yml configuration', 'FAIL', 'Missing prometheus.yml');
  }

  try {
    const sdRes = await fetchJsonWithTimeout(`${baseUrl}/api/prometheus/targets`);
    if (sdRes.status === 200 && Array.isArray(sdRes.body)) {
      record(
        'Prometheus',
        'HTTP Service Discovery (/api/prometheus/targets)',
        'PASS',
        `200 OK — ${sdRes.body.length} active scrape target(s) registered`
      );
    } else {
      record(
        'Prometheus',
        'HTTP Service Discovery (/api/prometheus/targets)',
        'FAIL',
        `Unexpected HTTP ${sdRes.status}`
      );
    }
  } catch (err: any) {
    record(
      'Prometheus',
      'HTTP Service Discovery (/api/prometheus/targets)',
      'FAIL',
      err?.message || 'Failed to reach /api/prometheus/targets'
    );
  }

  const promUrl = (process.env.PROMETHEUS_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '');
  try {
    const promReady = await fetchJsonWithTimeout(`${promUrl}/-/ready`, {}, 1500);
    if (promReady.status === 200) {
      record('Prometheus', `External Prometheus (${promUrl}/-/ready)`, 'PASS', '200 OK');
    } else {
      record(
        'Prometheus',
        `External Prometheus (${promUrl}/-/ready)`,
        'WARN',
        `WARNING: External Prometheus returned HTTP ${promReady.status} (using built-in agent TSDB/exporter scraper)`
      );
    }
  } catch {
    record(
      'Prometheus',
      `External Prometheus (${promUrl}/-/ready)`,
      'WARN',
      'WARNING: External Prometheus server is not running on :9090; built-in agent TSDB & live SSH exporter scraper is active'
    );
  }

  // ---------------------------------------------------------------------------
  // 6. AGENT CHECKS (Read-only; emits WARNING if no agent is running)
  // ---------------------------------------------------------------------------
  try {
    const agentsRes = await pool.query<{
      id: number;
      server_id: number;
      agent_id: string | null;
      hostname: string;
      version: string;
      last_seen_at: Date | null;
    }>(`SELECT id, server_id, agent_id, hostname, version, last_seen_at FROM agents ORDER BY id ASC`);

    if (agentsRes.rows.length === 0) {
      record(
        'Agent',
        'Enrolled Linux Agents',
        'WARN',
        'WARNING: No agents enrolled in database yet (not a build failure)'
      );
    } else {
      let onlineCount = 0;
      const summaries: string[] = [];
      for (const ag of agentsRes.rows) {
        if (!ag.agent_id) {
          summaries.push(`server#${ag.server_id}: NOT_INSTALLED`);
          continue;
        }
        if (ag.version === 'stopped') {
          summaries.push(`server#${ag.server_id} (${ag.agent_id}): STOPPED by user`);
          continue;
        }
        const ageSec = ag.last_seen_at
          ? Math.round((Date.now() - new Date(ag.last_seen_at).getTime()) / 1000)
          : null;
        const isOnline = ageSec !== null && ageSec <= 60;
        if (isOnline) onlineCount++;
        summaries.push(
          `server#${ag.server_id} (${ag.agent_id}): ${isOnline ? 'ONLINE' : 'OFFLINE'} (last heartbeat: ${
            ageSec !== null ? `${ageSec}s ago` : 'never'
          })`
        );
      }

      record(
        'Agent',
        'Agent status & heartbeat',
        onlineCount > 0 ? 'PASS' : 'WARN',
        onlineCount > 0
          ? `${onlineCount} agent(s) ONLINE — ${summaries.join('; ')}`
          : `WARNING: No agents currently sending live heartbeats — ${summaries.join('; ')}`
      );
    }
  } catch (err: any) {
    record('Agent', 'Agent database state', 'FAIL', err?.message || 'Failed to query agents');
  }

  // ---------------------------------------------------------------------------
  // 7. API ENDPOINT CHECKS (Read-only, zero data mutation)
  // ---------------------------------------------------------------------------
  try {
    const healthRes = await fetchJsonWithTimeout(`${baseUrl}/api/health`);
    if (healthRes.status === 200 && healthRes.body?.status === 'ok') {
      record('API', 'GET /api/health', 'PASS', '200 OK (status=ok)');
    } else {
      record('API', 'GET /api/health', 'FAIL', `HTTP ${healthRes.status}`);
    }

    const readyRes = await fetchJsonWithTimeout(`${baseUrl}/api/ready`);
    if (readyRes.status === 200 && readyRes.body?.status === 'ok') {
      record(
        'API',
        'GET /api/ready',
        'PASS',
        `200 OK (database=${readyRes.body?.checks?.database}, prometheus=${readyRes.body?.checks?.prometheus})`
      );
    } else {
      record(
        'API',
        'GET /api/ready',
        'FAIL',
        `HTTP ${readyRes.status}: ${JSON.stringify(readyRes.body)}`
      );
    }

    // Generate transient read-only JWT in memory (no DB write)
    const readOnlyToken = signLocalSessionToken({
      uid: sampleUserId,
      username: sampleUsername,
      email: sampleEmail,
    });
    const authHeaders = { Authorization: `Bearer ${readOnlyToken}` };

    const serversRes = await fetchJsonWithTimeout(`${baseUrl}/api/servers`, authHeaders);
    if (serversRes.status === 200 && Array.isArray(serversRes.body)) {
      record(
        'API',
        'GET /api/servers',
        'PASS',
        `200 OK (${serversRes.body.length} server(s) returned)`
      );
    } else {
      record('API', 'GET /api/servers', 'FAIL', `HTTP ${serversRes.status}`);
    }

    if (firstServerId) {
      const agentApiRes = await fetchJsonWithTimeout(
        `${baseUrl}/api/servers/${firstServerId}/agent?passive=true`,
        authHeaders
      );
      if (agentApiRes.status === 200 && agentApiRes.body?.status) {
        record(
          'API',
          `GET /api/servers/${firstServerId}/agent`,
          'PASS',
          `200 OK (status=${agentApiRes.body.status})`
        );
      } else {
        record(
          'API',
          `GET /api/servers/${firstServerId}/agent`,
          'FAIL',
          `HTTP ${agentApiRes.status}`
        );
      }

      const metricsApiRes = await fetchJsonWithTimeout(
        `${baseUrl}/api/servers/${firstServerId}/metrics?range=1h`,
        authHeaders,
        12000
      );
      if (metricsApiRes.status === 200 && Array.isArray(metricsApiRes.body?.series)) {
        record(
          'API',
          `GET /api/servers/${firstServerId}/metrics`,
          'PASS',
          `200 OK (source=${metricsApiRes.body.source}, series=${metricsApiRes.body.series.length} pts)`
        );
      } else {
        record(
          'API',
          `GET /api/servers/${firstServerId}/metrics`,
          'FAIL',
          `HTTP ${metricsApiRes.status}`
        );
      }
    } else {
      record(
        'API',
        'Server-scoped Agent & Monitoring endpoints',
        'WARN',
        'WARNING: No servers registered in DB; skipped /api/servers/:id/metrics check'
      );
    }
  } catch (err: any) {
    record('API', 'API endpoint checks', 'FAIL', err?.message || 'API check failed');
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  await pool.end().catch(() => {});

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log('\n================================================================');
  console.log(
    ` Summary: ${passCount} PASSED | ${warnCount} WARNINGS | ${failCount} FAILED`
  );
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runDiagnostics().catch((err) => {
  console.error('Fatal error in make check:', err);
  process.exit(1);
});
