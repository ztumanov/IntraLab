import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { users } from '../src/db/schema.ts';
import { createServerRecord, deleteServerById } from '../src/db/servers.ts';
import {
  enrollAgentWithToken,
  getOrProvisionServerAgent,
  listPrometheusAgentTargets,
  recordAgentHeartbeat,
  recordAgentSystemInfo,
  rotateServerEnrollmentToken,
  verifyAgentCredential,
} from '../src/db/agents.ts';
import {
  buildPromQLQueriesForServer,
  fetchServerMonitoringMetrics,
  parseMonitoringTimeRange,
} from '../src/server/prometheusClient.ts';

test('Linux Agent lifecycle, Prometheus HTTP Service Discovery, and PromQL range queries', async () => {
  const testUserUid = 'test-user-agent-suite';

  // Ensure test user exists in users table
  await db
    .insert(users)
    .values({
      uid: testUserUid,
      email: 'agent-test@infralab.local',
      displayName: 'Agent Test Runner',
    })
    .onConflictDoNothing();

  // 1. Create a temporary test server
  const server = await createServerRecord({
    userUid: testUserUid,
    name: 'agent-test-node',
    hostname: 'agent-test.internal',
    ipAddress: '10.99.0.42',
    sshPort: 22,
    username: 'root',
    authType: 'password',
    encryptedSecret: '',
    description: 'Temporary server for Linux Agent & Prometheus integration test',
  });

  try {
    // 2. Provision initial agent state -> should be NOT INSTALLED with a one-time enrollment token
    const initialAgent = await getOrProvisionServerAgent(server.id);
    assert.equal(initialAgent.status, 'NOT INSTALLED');
    assert.equal(initialAgent.agent_id, '');
    assert.ok(
      initialAgent.enrollment_token && initialAgent.enrollment_token.startsWith('ila_enroll_'),
      'Expected one-time enrollment_token for uninstalled server'
    );
    assert.equal(
      'credential' in initialAgent,
      false,
      'Public DTO must never include credential field'
    );

    // Uninstalled server must NOT appear in Prometheus HTTP SD targets
    const preTargets = await listPrometheusAgentTargets(9101);
    assert.equal(
      preTargets.some((t) => t.labels.server_id === String(server.id)),
      false,
      'Unenrolled server must not be in Prometheus scrape targets'
    );

    const firstToken = initialAgent.enrollment_token!;

    // 3. Rotate enrollment token and verify old token is invalidated
    const rotatedAgent = await rotateServerEnrollmentToken(server.id);
    assert.ok(rotatedAgent.enrollment_token);
    assert.notEqual(rotatedAgent.enrollment_token, firstToken);

    const oldTokenAttempt = await enrollAgentWithToken({
      token: firstToken,
      hostname: 'prod-linux-01',
      version: '0.2.0',
    });
    assert.equal(oldTokenAttempt, null, 'Old token must not be accepted after rotation');

    // 4. Enroll using the active one-time token
    const enrollResult = await enrollAgentWithToken({
      token: rotatedAgent.enrollment_token!,
      hostname: 'prod-linux-01',
      version: '0.2.0',
    });
    assert.ok(enrollResult, 'Enrollment with valid token must succeed');
    assert.equal(enrollResult.serverId, server.id);
    assert.ok(enrollResult.agentId.startsWith('agt_'));
    assert.ok(enrollResult.credential.startsWith('ila_cred_'));

    // 5. Verify one-time token cannot be reused
    const replayAttempt = await enrollAgentWithToken({
      token: rotatedAgent.enrollment_token!,
      hostname: 'prod-linux-01',
      version: '0.2.0',
    });
    assert.equal(replayAttempt, null, 'One-time enrollment token must be invalidated after use');

    // 6. Verify credential authentication
    const validAuth = await verifyAgentCredential(enrollResult.agentId, enrollResult.credential);
    assert.ok(validAuth, 'Valid agent credential must pass verification');
    assert.equal(validAuth.serverId, server.id);

    const invalidAuth = await verifyAgentCredential(enrollResult.agentId, 'ila_cred_wrong');
    assert.equal(invalidAuth, null, 'Invalid credential must be rejected');

    // 7. Record heartbeat & system info
    await recordAgentHeartbeat({
      agentId: enrollResult.agentId,
      version: '0.2.0',
      hostname: 'prod-linux-01',
    });

    await recordAgentSystemInfo({
      agentId: enrollResult.agentId,
      version: '0.2.0',
      hostname: 'prod-linux-01',
      osDistribution: 'Ubuntu 24.04.1 LTS',
      kernel: '6.8.0-45-generic',
      architecture: 'amd64',
      cpuCount: 8,
      ramTotalBytes: 17179869184,
      uptimeSeconds: 86400,
    });

    // 8. Enrolled agent MUST appear dynamically in Prometheus HTTP SD targets
    const postTargets = await listPrometheusAgentTargets(9101);
    const matchingTarget = postTargets.find((t) => t.labels.server_id === String(server.id));
    assert.ok(matchingTarget, 'Enrolled server must appear in Prometheus HTTP SD target list');
    assert.deepEqual(matchingTarget.targets, ['10.99.0.42:9101']);
    assert.equal(matchingTarget.labels.agent_id, enrollResult.agentId);
    assert.equal(matchingTarget.labels.hostname, 'prod-linux-01');

    // 9. Test PromQL range querying against a mock Prometheus /api/v1/query_range server
    const receivedQueries: string[] = [];
    const mockPromServer = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      if (reqUrl.pathname === '/api/v1/query_range') {
        const q = reqUrl.searchParams.get('query') || '';
        receivedQueries.push(q);
        const nowSec = Math.floor(Date.now() / 1000);
        let sampleVal = '42.5';
        if (q.includes('memory_usage')) sampleVal = '64.0';
        else if (q.includes('disk_usage')) sampleVal = '38.0';
        else if (q.includes('receive_bytes')) sampleVal = String(256 * 1024); // 256 KB/s
        else if (q.includes('transmit_bytes')) sampleVal = String(128 * 1024); // 128 KB/s
        else if (q.includes('uptime_seconds')) sampleVal = '90000';

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'success',
            data: {
              resultType: 'matrix',
              result: [
                {
                  metric: { server_id: String(server.id) },
                  values: [
                    [nowSec - 120, sampleVal],
                    [nowSec, sampleVal],
                  ],
                },
              ],
            },
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => mockPromServer.listen(0, '127.0.0.1', resolve));
    const addr = mockPromServer.address() as { port: number };
    const mockPromUrl = `http://127.0.0.1:${addr.port}`;

    try {
      for (const r of ['1h', '6h', '24h', '7d'] as const) {
        assert.equal(parseMonitoringTimeRange(r), r);
      }

      const monitoringResp = await fetchServerMonitoringMetrics({
        server,
        range: '6h',
        prometheusBaseUrl: mockPromUrl,
      });

      assert.equal(monitoringResp.server_id, server.id);
      assert.equal(monitoringResp.range, '6h');
      assert.equal(monitoringResp.source, 'prometheus');
      assert.equal(monitoringResp.summary.current_cpu_percent, 42.5);
      assert.equal(monitoringResp.summary.current_memory_percent, 64);
      assert.equal(monitoringResp.summary.current_disk_percent, 38);
      assert.equal(monitoringResp.summary.current_rx_kbps, 256);
      assert.equal(monitoringResp.summary.current_tx_kbps, 128);
      assert.equal(monitoringResp.summary.uptime_seconds, 90000);
      assert.ok(monitoringResp.series.length >= 2);

      const expectedQueries = buildPromQLQueriesForServer(server.id);
      assert.ok(receivedQueries.includes(expectedQueries.cpu));
      assert.ok(receivedQueries.includes(expectedQueries.memory));
      assert.ok(receivedQueries.includes(expectedQueries.disk));
    } finally {
      await new Promise<void>((resolve) => mockPromServer.close(() => resolve()));
    }
  } finally {
    await deleteServerById(server.id, testUserUid);
    await db.delete(users).where(eq(users.uid, testUserUid));
  }
});
