import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { agents, users } from '../src/db/schema.ts';
import { createServerRecord, deleteServerById } from '../src/db/servers.ts';
import {
  enrollAgentWithToken,
  getOrProvisionServerAgent,
  listPrometheusAgentTargets,
  provisionAgentDirectlyForServer,
  recordAgentHeartbeat,
  recordAgentSystemInfo,
  renewAgentCertificate,
  revokeServerAgentCertificate,
  rotateServerEnrollmentToken,
  stopServerAgent,
  verifyAgentCredential,
  verifyAgentMtlsCertificate,
} from '../src/db/agents.ts';
import {
  generateAgentKeyPairAndCsrPem,
  generateRootCaKeyPairAndCert,
  generateServerTlsKeyPairAndCert,
  getOrInitInfraLabCa,
  signAgentCsr,
  verifyClientCertAgainstCa,
} from '../src/server/agentPki.ts';
import { createApp } from '../server.ts';
import { formatStructuredLog, sanitizeLogFields } from '../src/lib/logger.ts';
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
      username: 'agent-test-runner',
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

      // 10. Regression test for BUG-001: stopping an agent marks it OFFLINE, excludes it from Prometheus SD,
      // and prevents stray heartbeats or system-info payloads from reviving it back to ONLINE.
      const stoppedView = await stopServerAgent(server.id);
      assert.equal(stoppedView.status, 'OFFLINE');
      assert.equal(stoppedView.version, 'stopped');
      assert.equal(stoppedView.last_seen_at, null);

      const targetsAfterStop = await listPrometheusAgentTargets(9101);
      const stoppedInTargets = targetsAfterStop.find(
        (t) => t.labels.server_id === String(server.id)
      );
      assert.equal(
        stoppedInTargets,
        undefined,
        'Stopped agent must be excluded from Prometheus HTTP SD target list'
      );

      // Late heartbeat after stop must not revive the stopped agent
      await recordAgentHeartbeat({
        agentId: enrollResult.agentId,
        hostname: 'prod-linux-01',
      });
      const afterLateHeartbeat = await getOrProvisionServerAgent(server.id);
      assert.equal(afterLateHeartbeat.status, 'OFFLINE');
      assert.equal(afterLateHeartbeat.version, 'stopped');

      // Late system-info after stop must ALSO not revive the stopped agent
      await recordAgentSystemInfo({
        agentId: enrollResult.agentId,
        hostname: 'prod-linux-01',
        osDistribution: 'Ubuntu 24.04.1 LTS',
        kernel: '6.8.0-45-generic',
        architecture: 'amd64',
        cpuCount: 8,
        ramTotalBytes: 17179869184,
        uptimeSeconds: 86500,
      });
      const afterLateSysInfo = await getOrProvisionServerAgent(server.id);
      assert.equal(afterLateSysInfo.status, 'OFFLINE');
      assert.equal(afterLateSysInfo.version, 'stopped');

      // 11. Agent restart -> reconnect -> ONLINE -> Prometheus target reappears
      const restarted = await provisionAgentDirectlyForServer({
        serverId: server.id,
        hostname: 'prod-linux-01',
        version: '0.2.0',
      });
      assert.equal(
        restarted.agentId,
        enrollResult.agentId,
        'Restarted agent must preserve its existing agent_id identity'
      );

      const afterRestartView = await getOrProvisionServerAgent(server.id);
      assert.equal(afterRestartView.status, 'ONLINE');
      assert.equal(afterRestartView.version, '0.2.0');
      assert.ok(afterRestartView.last_seen_at, 'last_seen_at must be restored after restart');

      const targetsAfterRestart = await listPrometheusAgentTargets(9101);
      const recoveredTarget = targetsAfterRestart.find(
        (t) => t.labels.server_id === String(server.id)
      );
      assert.ok(
        recoveredTarget,
        'Restarted agent must reappear in Prometheus HTTP SD target list'
      );
      assert.equal(recoveredTarget.labels.agent_id, enrollResult.agentId);
    } finally {
      await new Promise<void>((resolve) => mockPromServer.close(() => resolve()));
    }
  } finally {
    await deleteServerById(server.id, testUserUid);
    await db.delete(users).where(eq(users.uid, testUserUid));
  }
});

test('Structured logger redacts passwords, tokens, private keys, and authorization headers', () => {
  const sanitized = sanitizeLogFields({
    component: 'agent',
    operation: 'enroll',
    server_id: 42,
    password: 'super-secret-password',
    enrollment_token: 'ila_enroll_abcdef1234567890',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret',
    error: new Error(
      'Failed with token ila_enroll_999999 and Bearer secret_jwt_token'
    ),
  });

  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.enrollment_token, '[REDACTED]');
  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.ok(!String(sanitized.error).includes('ila_enroll_999999'));
  assert.ok(!String(sanitized.error).includes('secret_jwt_token'));

  const line = formatStructuredLog('error', {
    component: 'ssh',
    operation: 'connect',
    server_id: 7,
    encryptedSecret: 'aes-cipher',
    error: 'Connection refused',
  });
  assert.ok(line.includes('component=ssh'));
  assert.ok(line.includes('operation=connect'));
  assert.ok(line.includes('server_id=7'));
  assert.ok(line.includes('encryptedSecret=[REDACTED]'));
  assert.ok(!line.includes('aes-cipher'));
});

test('Agent mTLS PKI: CSR enrollment, SPIFFE SAN verification, rogue CA & expiry rejection, renewal, and revocation', async () => {
  const testUserUid = 'test-user-agent-mtls-suite';
  await db
    .insert(users)
    .values({
      uid: testUserUid,
      email: 'mtls-test@infralab.local',
      username: 'mtls-test-runner',
    })
    .onConflictDoNothing();

  const server = await createServerRecord({
    userUid: testUserUid,
    name: 'mtls-test-node',
    hostname: 'mtls-node.internal',
    ipAddress: '10.99.0.77',
    sshPort: 22,
    username: 'root',
    authType: 'password',
    encryptedSecret: '',
    description: 'Temporary server for Agent mTLS PKI integration test',
  });

  try {
    const initial = await getOrProvisionServerAgent(server.id);
    assert.ok(initial.enrollment_token, 'Expected one-time enrollment token');

    // 1. Agent generates ECDSA P-256 keypair and CSR locally (private key never sent to backend)
    const { privateKeyPem, csrPem } = generateAgentKeyPairAndCsrPem('mtls-node.internal');
    assert.ok(privateKeyPem.includes('BEGIN PRIVATE KEY'));
    assert.ok(csrPem.includes('BEGIN CERTIFICATE REQUEST'));
    assert.ok(!csrPem.includes('PRIVATE KEY'), 'CSR must never contain private key');

    // 2. Enroll with token + CSR
    const enrolled = await enrollAgentWithToken({
      token: initial.enrollment_token!,
      hostname: 'mtls-node.internal',
      version: '0.2.0',
      csrPem,
      ttlHours: 48,
    });
    assert.ok(enrolled, 'mTLS CSR enrollment must succeed');
    assert.equal(enrolled.authMode, 'mtls');
    assert.equal(enrolled.credential, '', 'mTLS enrollment must not issue legacy bearer credential');
    assert.ok(enrolled.clientCertPem?.includes('BEGIN CERTIFICATE'));
    assert.ok(enrolled.caCertPem?.includes('BEGIN CERTIFICATE'));
    assert.equal(enrolled.certSanUri, `spiffe://infralab/agent/${enrolled.agentId}`);

    // 3. Verify valid mTLS client certificate
    const validMtls = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: enrolled.clientCertPem!,
      headerAgentId: enrolled.agentId,
    });
    assert.ok(validMtls, 'Signed client certificate must pass mTLS verification');
    assert.equal(validMtls.agentId, enrolled.agentId);
    assert.equal(validMtls.serverId, server.id);

    // 4. Reject X-Agent-ID header spoofing
    const spoofedHeader = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: enrolled.clientCertPem!,
      headerAgentId: 'agt_spoofed_other_agent',
    });
    assert.equal(spoofedHeader, null, 'Mismatched X-Agent-ID header must be rejected');

    // 5. Reject certificate signed by a rogue CA
    const rogueCa = generateRootCaKeyPairAndCert('Rogue Untrusted CA');
    const rogueSigned = signAgentCsr({
      csrPem,
      agentId: enrolled.agentId,
      caBundle: rogueCa,
    });
    const rogueVerify = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: rogueSigned.clientCertPem,
    });
    assert.equal(rogueVerify, null, 'Certificate signed by rogue CA must be rejected');

    // 6. Reject expired certificate
    const futureDate = new Date(Date.now() + 72 * 3600 * 1000);
    const expiredVerify = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: enrolled.clientCertPem!,
      now: futureDate,
    });
    assert.equal(expiredVerify, null, 'Expired certificate must be rejected');

    // 7. Renew certificate with a fresh CSR and verify old certificate is invalidated
    const { csrPem: renewedCsrPem } = generateAgentKeyPairAndCsrPem(enrolled.agentId);
    const renewed = await renewAgentCertificate({
      agentId: enrolled.agentId,
      csrPem: renewedCsrPem,
      ttlHours: 72,
    });
    assert.ok(renewed, 'Certificate renewal must succeed');
    assert.notEqual(renewed.certSerial, enrolled.certSerial);

    const oldCertAfterRenew = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: enrolled.clientCertPem!,
    });
    assert.equal(
      oldCertAfterRenew,
      null,
      'Old certificate must be rejected after renewal rotates serial/fingerprint'
    );

    const newCertAfterRenew = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: renewed.clientCertPem,
    });
    assert.ok(newCertAfterRenew, 'Renewed certificate must pass verification');

    // 8. Revoke certificate and verify immediate rejection
    const revokedView = await revokeServerAgentCertificate(server.id, 'security_rotation');
    assert.equal(revokedView.status, 'OFFLINE');
    assert.ok(revokedView.cert_revoked_at, 'cert_revoked_at must be populated');

    const afterRevokeVerify = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: renewed.clientCertPem,
    });
    assert.equal(afterRevokeVerify, null, 'Revoked certificate must be rejected immediately');
  } finally {
    await deleteServerById(server.id, testUserUid);
    await db.delete(users).where(eq(users.uid, testUserUid));
  }
});

test('Agent mTLS Full Security & E2E Audit: real TLS handshake, Agent A cert + Agent B ID rejection, EKU validation, header spoofing protection, and DB non-secret audit', async () => {
  const testUserUid = 'test-user-agent-mtls-e2e-audit';
  await db
    .insert(users)
    .values({
      uid: testUserUid,
      email: 'mtls-e2e-audit@infralab.local',
      username: 'mtls-e2e-auditor',
    })
    .onConflictDoNothing();

  const serverA = await createServerRecord({
    userUid: testUserUid,
    name: 'mtls-audit-node-a',
    hostname: 'node-a.internal',
    ipAddress: '10.99.1.10',
    sshPort: 22,
    username: 'root',
    authType: 'password',
    encryptedSecret: '',
    description: 'Audit node A',
  });

  const serverB = await createServerRecord({
    userUid: testUserUid,
    name: 'mtls-audit-node-b',
    hostname: 'node-b.internal',
    ipAddress: '10.99.1.11',
    sshPort: 22,
    username: 'root',
    authType: 'password',
    encryptedSecret: '',
    description: 'Audit node B',
  });

  const ca = getOrInitInfraLabCa();
  const srvTls = generateServerTlsKeyPairAndCert({
    commonName: '127.0.0.1',
    dnsNames: ['localhost'],
    ipAddresses: ['127.0.0.1'],
    caBundle: ca,
  });

  const app = createApp();
  const httpsServer = https.createServer(
    {
      key: srvTls.serverKeyPem,
      cert: srvTls.serverCertPem,
      ca: ca.caCertPem,
      minVersion: 'TLSv1.2',
      requestCert: true,
      rejectUnauthorized: false,
    },
    app
  );

  await new Promise<void>((resolve) => httpsServer.listen(0, '127.0.0.1', resolve));
  const port = (httpsServer.address() as { port: number }).port;

  function httpsPostJson(options: {
    path: string;
    body: Record<string, any>;
    cert?: string;
    key?: string;
    headers?: Record<string, string>;
  }): Promise<{ status: number; data: any; tlsProtocol: string | null }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(options.body);
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path: options.path,
          method: 'POST',
          ca: ca.caCertPem,
          cert: options.cert,
          key: options.key,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payload)),
            Connection: 'close',
            ...(options.headers || {}),
          },
        },
        (res) => {
          const tlsSocket = res.socket as tls.TLSSocket;
          const tlsProtocol =
            typeof tlsSocket.getProtocol === 'function' ? tlsSocket.getProtocol() : null;
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            let parsed: any = raw;
            try {
              parsed = JSON.parse(raw);
            } catch {
              // keep raw
            }
            resolve({ status: res.statusCode || 0, data: parsed, tlsProtocol });
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  try {
    // 1. Reject server certificate (ExtKeyUsage = serverAuth instead of clientAuth) when validated as client cert (BUG-MTLS-01 regression)
    assert.throws(
      () => verifyClientCertAgainstCa(srvTls.serverCertPem, ca),
      /ExtendedKeyUsage clientAuth|SPIFFE/i,
      'Server certificate with serverAuth EKU must be rejected as a client certificate'
    );
    assert.throws(
      () => verifyClientCertAgainstCa(ca.caCertPem, ca),
      /must not be a CA certificate/i,
      'CA certificate must be rejected as a client certificate'
    );

    // 2. Provision enrollment tokens for Agent A and Agent B
    const initA = await getOrProvisionServerAgent(serverA.id);
    const initB = await getOrProvisionServerAgent(serverB.id);
    assert.ok(initA.enrollment_token);
    assert.ok(initB.enrollment_token);

    // 3. Agent A and Agent B generate their private keys and CSRs locally
    const keyCsrA = generateAgentKeyPairAndCsrPem('node-a.internal');
    const keyCsrB = generateAgentKeyPairAndCsrPem('node-b.internal');

    // 4. Enroll Agent A and Agent B over HTTPS
    const enrollRespA = await httpsPostJson({
      path: '/api/agents/enroll',
      body: {
        token: initA.enrollment_token,
        hostname: 'node-a.internal',
        version: '0.2.0',
        csr_pem: keyCsrA.csrPem,
      },
    });
    assert.equal(enrollRespA.status, 200);
    assert.ok(
      enrollRespA.tlsProtocol === 'TLSv1.2' || enrollRespA.tlsProtocol === 'TLSv1.3',
      `Expected TLSv1.2 or TLSv1.3, got ${enrollRespA.tlsProtocol}`
    );
    const agentAId: string = enrollRespA.data.agent_id;
    const certAPem: string = enrollRespA.data.client_cert_pem;
    assert.ok(agentAId.startsWith('agt_'));
    assert.equal(enrollRespA.data.auth_mode, 'mtls');
    assert.equal('credential' in enrollRespA.data, false, 'mTLS enroll response must not include credential');

    const enrollRespB = await httpsPostJson({
      path: '/api/agents/enroll',
      body: {
        token: initB.enrollment_token,
        hostname: 'node-b.internal',
        version: '0.2.0',
        csr_pem: keyCsrB.csrPem,
      },
    });
    assert.equal(enrollRespB.status, 200);
    const agentBId: string = enrollRespB.data.agent_id;

    // 5. Verify PostgreSQL agents table NEVER stores private keys or raw tokens
    const dbRowsA = await db.select().from(agents).where(eq(agents.agentId, agentAId));
    assert.equal(dbRowsA.length, 1);
    const serializedRowA = JSON.stringify(dbRowsA[0]);
    assert.ok(!serializedRowA.includes('PRIVATE KEY'), 'PostgreSQL must never contain private keys');
    assert.equal(dbRowsA[0].enrollmentTokenHash, '', 'Consumed token hash must be cleared');
    assert.equal(dbRowsA[0].enrollmentTokenEncrypted, '', 'Consumed encrypted token must be cleared');
    assert.equal(dbRowsA[0].credentialHash, '', 'mTLS agent must have empty credentialHash');

    // 6. Real mTLS handshake with valid Agent A client certificate + private key -> 200 OK
    const validHb = await httpsPostJson({
      path: '/api/agents/heartbeat',
      cert: certAPem,
      key: keyCsrA.privateKeyPem,
      headers: { 'X-Agent-ID': agentAId },
      body: { agent_id: agentAId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(validHb.status, 200);
    assert.equal(validHb.data.auth_mode, 'mtls');
    assert.equal(validHb.data.agent_id, agentAId);

    // 7. No client certificate over TLS -> 401 REJECT
    const noCertHb = await httpsPostJson({
      path: '/api/agents/heartbeat',
      headers: { 'X-Agent-ID': agentAId },
      body: { agent_id: agentAId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(noCertHb.status, 401, 'Missing client certificate must be rejected with 401');

    // 8. Regression test for BUG-MTLS-03: No client cert in TLS handshake + spoofed X-Forwarded-TLS-Client-Cert header over direct TLS -> 401 REJECT
    const spoofedCertHeaderOverTls = await httpsPostJson({
      path: '/api/agents/heartbeat',
      headers: {
        'X-Agent-ID': agentAId,
        'X-Forwarded-TLS-Client-Cert': encodeURIComponent(certAPem),
        'X-SSL-Client-Cert': encodeURIComponent(certAPem),
      },
      body: { agent_id: agentAId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(
      spoofedCertHeaderOverTls.status,
      401,
      'Forwarded cert headers must be ignored on direct TLS connections when no peer cert was presented in handshake'
    );

    // 9. Critical Section 5 check: Agent A certificate + Agent B ID in X-Agent-ID header -> 401 REJECT
    const crossAgentHeader = await httpsPostJson({
      path: '/api/agents/heartbeat',
      cert: certAPem,
      key: keyCsrA.privateKeyPem,
      headers: { 'X-Agent-ID': agentBId },
      body: { version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(crossAgentHeader.status, 401, 'Agent A cert + Agent B X-Agent-ID header must be rejected with 401');

    // 10. Critical Section 5 check: Agent A certificate + Agent B ID in JSON body (with NO X-Agent-ID header) -> 401 REJECT
    const crossAgentBodyOnly = await httpsPostJson({
      path: '/api/agents/heartbeat',
      cert: certAPem,
      key: keyCsrA.privateKeyPem,
      body: { agent_id: agentBId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(crossAgentBodyOnly.status, 401, 'Agent A cert + Agent B body.agent_id must be rejected with 401');

    // 11. Regression test for BUG-MTLS-02: Agent A certificate + Agent A X-Agent-ID header + Agent B body.agent_id -> 401 REJECT
    const crossAgentHeaderAndBody = await httpsPostJson({
      path: '/api/agents/heartbeat',
      cert: certAPem,
      key: keyCsrA.privateKeyPem,
      headers: { 'X-Agent-ID': agentAId },
      body: { agent_id: agentBId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(
      crossAgentHeaderAndBody.status,
      401,
      'Agent A cert + Agent A header + Agent B body.agent_id must be rejected with 401'
    );

    // 12. Certificate signed by unknown / rogue CA over real TLS handshake -> 401 REJECT
    const rogueCa = generateRootCaKeyPairAndCert('Rogue CA');
    const rogueSigned = signAgentCsr({
      csrPem: keyCsrA.csrPem,
      agentId: agentAId,
      caBundle: rogueCa,
    });
    const rogueTlsHb = await httpsPostJson({
      path: '/api/agents/heartbeat',
      cert: rogueSigned.clientCertPem,
      key: keyCsrA.privateKeyPem,
      headers: { 'X-Agent-ID': agentAId },
      body: { agent_id: agentAId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(rogueTlsHb.status, 401, 'Rogue CA certificate over TLS handshake must be rejected with 401');

    // 13. Revoke Agent A certificate and verify real TLS handshake is immediately rejected with 401
    await revokeServerAgentCertificate(serverA.id, 'audit_revocation_test');
    const revokedTlsHb = await httpsPostJson({
      path: '/api/agents/heartbeat',
      cert: certAPem,
      key: keyCsrA.privateKeyPem,
      headers: { 'X-Agent-ID': agentAId },
      body: { agent_id: agentAId, version: '0.2.0', hostname: 'node-a.internal' },
    });
    assert.equal(revokedTlsHb.status, 401, 'Revoked certificate over TLS must be rejected with 401');
  } finally {
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    await deleteServerById(serverA.id, testUserUid);
    await deleteServerById(serverB.id, testUserUid);
    await db.delete(users).where(eq(users.uid, testUserUid));
  }
});


