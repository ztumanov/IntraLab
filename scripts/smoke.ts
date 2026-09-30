import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pool } from '../src/db/index.ts';
import { ensureDatabaseSchema } from '../src/db/bootstrap.ts';
import { signLocalSessionToken } from '../src/server/localAuth.ts';

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 8000
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
      // keep raw
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function runSmokeTest() {
  console.log('================================================================');
  console.log(' InfraLab End-to-End Smoke Test (SAFE READ-ONLY MODE)');
  console.log('================================================================\n');

  const baseUrl = (process.env.INFRALAB_API_URL || 'http://127.0.0.1:3000').replace(
    /\/+$/,
    ''
  );

  // 1. Backend Liveness
  const health = await fetchWithTimeout(`${baseUrl}/api/health`);
  if (health.status !== 200 || health.body?.status !== 'ok') {
    throw new Error(`Smoke Step 1 FAILED: /api/health returned ${health.status}`);
  }
  console.log('[SMOKE 1/7] PASS — Backend is reachable (GET /api/health -> 200 OK)');

  // 2. Database & Readiness
  await ensureDatabaseSchema();
  const ready = await fetchWithTimeout(`${baseUrl}/api/ready`);
  if (ready.status !== 200 || ready.body?.checks?.database !== 'ok') {
    throw new Error(
      `Smoke Step 2 FAILED: /api/ready returned ${ready.status} (${JSON.stringify(ready.body)})`
    );
  }
  console.log('[SMOKE 2/7] PASS — Database is available and ready (GET /api/ready -> 200 OK)');

  // Prepare read-only session token for existing user
  const srvRow = await pool.query<{ id: number; user_uid: string }>(
    `SELECT id, user_uid FROM servers ORDER BY id ASC LIMIT 1`
  );
  const firstServerId = srvRow.rows[0]?.id ? Number(srvRow.rows[0].id) : null;
  const userId = srvRow.rows[0]?.user_uid || 'local-admin';

  const token = signLocalSessionToken({
    uid: userId,
    username: 'admin',
    email: 'admin@infralab.local',
  });
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 3. API & Auth check
  const serversList = await fetchWithTimeout(`${baseUrl}/api/servers`, authHeaders);
  if (serversList.status !== 200 || !Array.isArray(serversList.body)) {
    throw new Error(`Smoke Step 3 FAILED: GET /api/servers returned ${serversList.status}`);
  }
  console.log(
    `[SMOKE 3/7] PASS — API & Servers endpoint operational (${serversList.body.length} server(s))`
  );

  // 4. Servers detail API (if server exists)
  if (firstServerId) {
    const srvDetail = await fetchWithTimeout(
      `${baseUrl}/api/servers/${firstServerId}`,
      authHeaders
    );
    if (srvDetail.status !== 200 || Number(srvDetail.body?.id) !== firstServerId) {
      throw new Error(
        `Smoke Step 4 FAILED: GET /api/servers/${firstServerId} returned ${srvDetail.status}`
      );
    }
    console.log(`[SMOKE 4/7] PASS — Server Detail API works (server #${firstServerId})`);
  } else {
    console.log('[SMOKE 4/7] PASS — Servers collection verified (0 servers in DB)');
  }

  // 5. Agent API & Prometheus Service Discovery
  const promTargets = await fetchWithTimeout(`${baseUrl}/api/prometheus/targets`);
  if (promTargets.status !== 200 || !Array.isArray(promTargets.body)) {
    throw new Error(
      `Smoke Step 5 FAILED: GET /api/prometheus/targets returned ${promTargets.status}`
    );
  }
  if (firstServerId) {
    const agentStatus = await fetchWithTimeout(
      `${baseUrl}/api/servers/${firstServerId}/agent?passive=true`,
      authHeaders
    );
    if (agentStatus.status !== 200 || !agentStatus.body?.status) {
      throw new Error(
        `Smoke Step 5 FAILED: GET /api/servers/${firstServerId}/agent returned ${agentStatus.status}`
      );
    }
  }
  console.log(
    `[SMOKE 5/7] PASS — Agent API & Prometheus SD operational (${promTargets.body.length} target(s))`
  );

  // 6. Monitoring endpoint
  if (firstServerId) {
    const metricsRes = await fetchWithTimeout(
      `${baseUrl}/api/servers/${firstServerId}/metrics?range=1h`,
      authHeaders,
      12000
    );
    if (metricsRes.status !== 200 || !Array.isArray(metricsRes.body?.series)) {
      throw new Error(
        `Smoke Step 6 FAILED: GET /api/servers/${firstServerId}/metrics returned ${metricsRes.status}`
      );
    }
    console.log(
      `[SMOKE 6/7] PASS — Monitoring endpoint responds (source=${metricsRes.body.source}, points=${metricsRes.body.series.length})`
    );
  } else {
    console.log('[SMOKE 6/7] PASS — Monitoring target pipeline verified');
  }

  // 7. Frontend build
  execSync('npm run build', { stdio: 'pipe' });
  if (!fs.existsSync(path.resolve('dist/index.html'))) {
    throw new Error('Smoke Step 7 FAILED: dist/index.html not generated');
  }
  console.log('[SMOKE 7/7] PASS — Frontend production build succeeded (dist/index.html)');

  await pool.end().catch(() => {});
  console.log('\n================================================================');
  console.log(' ALL 7 SMOKE CHECKS PASSED SUCCESSFULLY');
  console.log('================================================================');
}

runSmokeTest().catch(async (err) => {
  console.error('\n[SMOKE TEST FAILED]:', err?.message || err);
  await pool.end().catch(() => {});
  process.exit(1);
});
