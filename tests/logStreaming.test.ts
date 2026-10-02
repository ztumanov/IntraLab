import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { users } from '../src/db/schema.ts';
import { createServerRecord, deleteServerById } from '../src/db/servers.ts';
import {
  enrollAgentWithToken,
  getOrProvisionServerAgent,
  revokeServerAgentCertificate,
} from '../src/db/agents.ts';
import { generateAgentKeyPairAndCsrPem } from '../src/server/agentPki.ts';
import { signLocalSessionToken } from '../src/server/localAuth.ts';
import { attachAgentLogStreamWebSocketServer } from '../src/server/logStreamHub.ts';
import { createApp } from '../server.ts';

test('Real-Time Log Streaming E2E: mTLS Agent WebSocket -> Backend Hub -> Multi-Client SSE & Security Validation', async () => {
  const uidOwner = `test_logstream_owner_${Date.now()}`;
  const uidOther = `test_logstream_other_${Date.now()}`;

  await db.insert(users).values([
    {
      uid: uidOwner,
      email: `${uidOwner}@infralab.local`,
      username: uidOwner,
      authProvider: 'local',
    },
    {
      uid: uidOther,
      email: `${uidOther}@infralab.local`,
      username: uidOther,
      authProvider: 'local',
    },
  ]);

  const srv = await createServerRecord({
    userUid: uidOwner,
    name: 'LogStream Prod Node',
    hostname: 'logstream-node-01',
    ipAddress: '10.240.1.50',
    sshPort: 22,
    username: 'root',
    authType: 'password',
    encryptedSecret: '',
    description: 'Real-time log streaming test server',
  });

  const srvB = await createServerRecord({
    userUid: uidOwner,
    name: 'LogStream Secondary Node',
    hostname: 'logstream-node-02',
    ipAddress: '10.240.1.51',
    sshPort: 22,
    username: 'root',
    authType: 'password',
    encryptedSecret: '',
    description: 'Secondary server for identity binding test',
  });

  const ownerToken = signLocalSessionToken({
    uid: uidOwner,
    email: `${uidOwner}@infralab.local`,
    username: uidOwner,
  });

  const otherToken = signLocalSessionToken({
    uid: uidOther,
    email: `${uidOther}@infralab.local`,
    username: uidOther,
  });

  const app = createApp();
  const httpServer = http.createServer(app);
  attachAgentLogStreamWebSocketServer(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = httpServer.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const wsBaseUrl = `ws://127.0.0.1:${addr.port}`;

  try {
    // 1. Verify existing GET /api/servers/:id/logs API remains intact & enforces auth/validation
    const unauthLogsApi = await fetch(`${baseUrl}/api/servers/${srv.id}/logs?source=journald`);
    assert.equal(unauthLogsApi.status, 401, 'Existing Logs API must reject unauthenticated requests with 401');

    const invalidIdLogsApi = await fetch(`${baseUrl}/api/servers/invalid-id/logs?source=journald`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(invalidIdLogsApi.status, 400, 'Existing Logs API must reject invalid server ID with 400');

    const crossUserLogsApi = await fetch(`${baseUrl}/api/servers/${srv.id}/logs?source=journald`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(crossUserLogsApi.status, 404, 'Existing Logs API must reject cross-user access with 404');

    const missingServerLogsApi = await fetch(`${baseUrl}/api/servers/99999999/logs?source=journald`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(missingServerLogsApi.status, 404, 'Existing Logs API must return 404 for non-existent server');

    // 1b. Security & Filter checks on SSE endpoint (/api/servers/:id/logs/stream)
    const unauthRes = await fetch(`${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald`);
    assert.equal(unauthRes.status, 401, 'Unauthenticated SSE request must return 401');

    const crossUserRes = await fetch(
      `${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald&token=${encodeURIComponent(otherToken)}`
    );
    assert.equal(crossUserRes.status, 404, 'Other user must not access server log stream');

    const invalidContainerPayloads = [
      'nginx; rm -rf /',
      'nginx && cat /etc/passwd',
      '$(id)',
      '--privileged',
      '../../etc/shadow',
    ];
    for (const badContainer of invalidContainerPayloads) {
      const res = await fetch(
        `${baseUrl}/api/servers/${srv.id}/logs/stream?source=docker&container=${encodeURIComponent(badContainer)}&token=${encodeURIComponent(ownerToken)}`
      );
      assert.equal(
        res.status,
        400,
        `Invalid container parameter "${badContainer}" must be rejected with 400`
      );
    }

    const invalidUnitPayloads = [
      '--system',
      'nginx;id',
      'nginx && whoami',
      '$(id)',
      '../../etc/passwd',
    ];
    for (const badUnit of invalidUnitPayloads) {
      const res = await fetch(
        `${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald&unit=${encodeURIComponent(badUnit)}&token=${encodeURIComponent(ownerToken)}`
      );
      assert.equal(
        res.status,
        400,
        `Invalid unit parameter "${badUnit}" must be rejected with 400`
      );
    }

    const invalidPriorityRes = await fetch(
      `${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald&priority=${encodeURIComponent('err;id')}&token=${encodeURIComponent(ownerToken)}`
    );
    assert.equal(invalidPriorityRes.status, 400, 'Invalid priority filter must be rejected with 400');

    const invalidSinceRes = await fetch(
      `${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald&since=${encodeURIComponent('--help')}&token=${encodeURIComponent(ownerToken)}`
    );
    assert.equal(invalidSinceRes.status, 400, 'Invalid since filter must be rejected with 400');

    const invalidTailRes = await fetch(
      `${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald&tail=${encodeURIComponent('-10')}&token=${encodeURIComponent(ownerToken)}`
    );
    assert.equal(invalidTailRes.status, 400, 'Negative tail filter must be rejected with 400');

    const injectionTailRes = await fetch(
      `${baseUrl}/api/servers/${srv.id}/logs/stream?source=journald&tail=${encodeURIComponent('50;id')}&token=${encodeURIComponent(ownerToken)}`
    );
    assert.equal(injectionTailRes.status, 400, 'Non-numeric tail filter must be rejected with 400');

    // 2. Enroll Agent A and Agent B with local CSRs
    const provA = await getOrProvisionServerAgent(srv.id);
    const { csrPem: csrA } = generateAgentKeyPairAndCsrPem('logstream-node-01');
    const enrolledA = await enrollAgentWithToken({
      token: provA.enrollment_token!,
      hostname: 'logstream-node-01',
      version: '0.2.0',
      csrPem: csrA,
    });
    assert.ok(enrolledA && enrolledA.clientCertPem);

    const provB = await getOrProvisionServerAgent(srvB.id);
    const { csrPem: csrB } = generateAgentKeyPairAndCsrPem('logstream-node-02');
    const enrolledB = await enrollAgentWithToken({
      token: provB.enrollment_token!,
      hostname: 'logstream-node-02',
      version: '0.2.0',
      csrPem: csrB,
    });
    assert.ok(enrolledB && enrolledB.clientCertPem);

    // 3. Verify Agent WebSocket rejects spoofed X-Agent-ID (Agent A cert + Agent B ID)
    await assert.rejects(
      async () => {
        await new Promise<void>((resolve, reject) => {
          const badWs = new WebSocket(`${wsBaseUrl}/api/agents/logs/ws`, {
            headers: {
              'X-Agent-ID': enrolledB.agentId,
              'X-Forwarded-TLS-Client-Cert': encodeURIComponent(enrolledA.clientCertPem!),
            },
          });
          badWs.on('open', () => {
            badWs.close();
            resolve();
          });
          badWs.on('error', (err) => reject(err));
          badWs.on('unexpected-response', (_req, res) => {
            reject(new Error(`Rejected with status ${res.statusCode}`));
          });
        });
      },
      /401/,
      'Agent A certificate claiming Agent B ID on WebSocket upgrade must be rejected with 401'
    );

    // 4. Connect valid Agent A over mTLS WebSocket
    const agentControlFrames: any[] = [];
    let controlResolve: ((cmd: any) => void) | null = null;

    const agentWs = new WebSocket(`${wsBaseUrl}/api/agents/logs/ws`, {
      headers: {
        'X-Agent-ID': enrolledA.agentId,
        'X-Forwarded-TLS-Client-Cert': encodeURIComponent(enrolledA.clientCertPem!),
      },
    });

    await new Promise<void>((resolve, reject) => {
      agentWs.once('open', () => resolve());
      agentWs.once('error', (err) => reject(err));
    });

    agentWs.on('message', (raw) => {
      const cmd = JSON.parse(String(raw));
      agentControlFrames.push(cmd);
      if (controlResolve) {
        const fn = controlResolve;
        controlResolve = null;
        fn(cmd);
      }
    });

    // Helper to open an SSE client and collect received events
    function openSseClient(query: string) {
      const events: { event: string; data: any }[] = [];
      let onLogEvent: ((data: any) => void) | null = null;
      const req = http.get(
        `${baseUrl}/api/servers/${srv.id}/logs/stream?${query}&token=${encodeURIComponent(ownerToken)}`,
        (res) => {
          assert.equal(res.statusCode, 200);
          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8');
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';
            for (const block of blocks) {
              const lines = block.split('\n');
              let evName = 'message';
              let evData = '';
              for (const l of lines) {
                if (l.startsWith('event:')) evName = l.slice(6).trim();
                if (l.startsWith('data:')) evData = l.slice(5).trim();
              }
              if (evData) {
                const parsed = JSON.parse(evData);
                events.push({ event: evName, data: parsed });
                if (evName === 'log' && onLogEvent) {
                  const fn = onLogEvent;
                  onLogEvent = null;
                  fn(parsed);
                }
              }
            }
          });
        }
      );
      return {
        events,
        waitForNextLog: () =>
          new Promise<any>((resolve, reject) => {
            const existingLog = events.find((e) => e.event === 'log');
            if (existingLog) {
              return resolve(existingLog.data);
            }
            const t = setTimeout(() => reject(new Error('SSE log event timeout')), 4000);
            onLogEvent = (data) => {
              clearTimeout(t);
              resolve(data);
            };
          }),
        close: () => req.destroy(),
      };
    }

    // 5. Connect two SSE browser clients to the same Docker container stream
    const nextCtrlPromise = new Promise<any>((resolve) => {
      controlResolve = resolve;
    });
    const sse1 = openSseClient('source=docker&container=redis-cache&tail=50');
    const startCmd = await nextCtrlPromise;

    assert.equal(startCmd.type, 'start_stream');
    assert.equal(startCmd.source, 'docker');
    assert.equal(startCmd.container_id, 'redis-cache');

    // Second browser client subscribes to the exact same stream
    const sse2 = openSseClient('source=docker&container=redis-cache&tail=50');
    await new Promise((r) => setTimeout(r, 80));

    // Verify backend did NOT send a duplicate start_stream command for the second subscriber
    const startCount = agentControlFrames.filter((c) => c.type === 'start_stream').length;
    assert.equal(startCount, 1, 'Multiple SSE subscribers must share a single Agent stream');

    // 6. Agent emits a real-time Docker log event over WebSocket
    agentWs.send(
      JSON.stringify({
        type: 'log_event',
        stream_id: startCmd.stream_id,
        event: {
          timestamp: '2026-10-01T23:00:00.000Z',
          agent_id: enrolledA.agentId,
          source: 'docker',
          container_id: 'redis-cache',
          container_name: 'redis-cache',
          stream: 'stdout',
          level: 'info',
          message: 'Ready to accept connections on port 6379',
        },
      })
    );

    const [log1, log2] = await Promise.all([sse1.waitForNextLog(), sse2.waitForNextLog()]);
    assert.equal(log1.source, 'docker');
    assert.equal(log1.container_id, 'redis-cache');
    assert.equal(log1.agent_id, enrolledA.agentId);
    assert.equal(log1.message, 'Ready to accept connections on port 6379');
    assert.equal(log2.message, 'Ready to accept connections on port 6379');

    // 7. Close first SSE client -> stream remains active because sse2 is still watching
    sse1.close();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      agentControlFrames.filter((c) => c.type === 'stop_stream').length,
      0,
      'Stream must remain active while at least one SSE client is connected'
    );

    // 8. Close second (last) SSE client -> Backend must send stop_stream to Agent immediately
    const stopCtrlPromise = new Promise<any>((resolve) => {
      controlResolve = resolve;
    });
    sse2.close();
    const stopCmd = await stopCtrlPromise;
    assert.equal(stopCmd.type, 'stop_stream');
    assert.equal(stopCmd.stream_id, startCmd.stream_id);

    // 8b. Journal streaming with unit/priority/since/tail filters, spoofed frame rejection, and reconnect recovery
    const journalStartPromise = new Promise<any>((resolve) => {
      controlResolve = resolve;
    });
    const sseJournal = openSseClient('source=journald&unit=sshd.service&priority=err&since=10m&tail=40');
    const journalStartCmd = await journalStartPromise;
    assert.equal(journalStartCmd.type, 'start_stream');
    assert.equal(journalStartCmd.source, 'journald');
    assert.equal(journalStartCmd.unit, 'sshd.service');
    assert.equal(journalStartCmd.priority, 'err');
    assert.equal(journalStartCmd.since, '10m');
    assert.equal(journalStartCmd.tail, 40);

    // Send a spoofed log_event claiming Agent B's ID -> must be dropped
    agentWs.send(
      JSON.stringify({
        type: 'log_event',
        stream_id: journalStartCmd.stream_id,
        event: {
          timestamp: '2026-10-01T23:01:00.000Z',
          agent_id: enrolledB.agentId,
          source: 'journal',
          unit: 'sshd.service',
          message: 'SPOOFED_EVENT_MUST_BE_DROPPED',
        },
      })
    );

    // Send a valid journal event with >16KB message -> must be delivered and truncated
    const hugePayload = 'X'.repeat(20000);
    agentWs.send(
      JSON.stringify({
        type: 'log_event',
        stream_id: journalStartCmd.stream_id,
        event: {
          timestamp: '2026-10-01T23:01:01.000Z',
          agent_id: enrolledA.agentId,
          source: 'journal',
          unit: 'sshd.service',
          level: 'error',
          message: `Failed password for root ${hugePayload}`,
        },
      })
    );

    const journalLog = await sseJournal.waitForNextLog();
    assert.equal(journalLog.source, 'journal');
    assert.equal(journalLog.unit, 'sshd.service');
    assert.equal(journalLog.level, 'error');
    assert.ok(!journalLog.message.includes('SPOOFED_EVENT_MUST_BE_DROPPED'));
    assert.ok(journalLog.message.includes('[truncated'), 'Oversized log message must be truncated');

    // Simulate Agent disconnect while SSE client stays open, then Agent reconnects
    agentWs.close();
    await new Promise((r) => setTimeout(r, 80));

    let reconnectedStartCmd: any = null;
    const reconnectPromise = new Promise<any>((resolve) => {
      reconnectedStartCmd = resolve;
    });

    const agentWsReconnected = new WebSocket(`${wsBaseUrl}/api/agents/logs/ws`, {
      headers: {
        'X-Agent-ID': enrolledA.agentId,
        'X-Forwarded-TLS-Client-Cert': encodeURIComponent(enrolledA.clientCertPem!),
      },
    });
    agentWsReconnected.on('message', (raw) => {
      const cmd = JSON.parse(String(raw));
      if (cmd.type === 'start_stream' && reconnectedStartCmd) {
        const fn = reconnectedStartCmd;
        reconnectedStartCmd = null;
        fn(cmd);
      }
    });

    const resumedCmd = await reconnectPromise;
    assert.equal(resumedCmd.type, 'start_stream');
    assert.equal(resumedCmd.stream_id, journalStartCmd.stream_id);
    assert.equal(resumedCmd.unit, 'sshd.service');

    sseJournal.close();
    agentWsReconnected.close();

    // 9. Verify revoked certificate cannot connect to /api/agents/logs/ws
    await revokeServerAgentCertificate(srv.id, 'test_revocation');
    await assert.rejects(
      async () => {
        await new Promise<void>((resolve, reject) => {
          const revWs = new WebSocket(`${wsBaseUrl}/api/agents/logs/ws`, {
            headers: {
              'X-Agent-ID': enrolledA.agentId,
              'X-Forwarded-TLS-Client-Cert': encodeURIComponent(enrolledA.clientCertPem!),
            },
          });
          revWs.on('open', () => {
            revWs.close();
            resolve();
          });
          revWs.on('error', (err) => reject(err));
          revWs.on('unexpected-response', (_req, res) => {
            reject(new Error(`Rejected with status ${res.statusCode}`));
          });
        });
      },
      /401/,
      'Revoked agent certificate must be rejected on WebSocket upgrade'
    );
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await deleteServerById(srv.id, uidOwner);
    await deleteServerById(srvB.id, uidOwner);
    await db.delete(users).where(eq(users.uid, uidOwner));
    await db.delete(users).where(eq(users.uid, uidOther));
  }
});
