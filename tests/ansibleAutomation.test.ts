import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ssh2 from 'ssh2';
import { createApp } from '../server.ts';
import { ensureDatabaseSchema } from '../src/db/bootstrap.ts';
import { createServerRecord, deleteServerById } from '../src/db/servers.ts';
import { encryptSecret } from '../src/server/sshConnector.ts';
import { signLocalSessionToken } from '../src/server/localAuth.ts';

const { Server: SshServer } = ssh2;

function generateRsaKeyPairPem(): { privateKey: string; publicKeyOpenSsh: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return { privateKey, publicKeyOpenSsh: publicKey };
}

test('Ansible Automation Module: Security, Validation, Inventory, Real ansible-playbook SSH Execution, SSE Stream & Audit Logs', async () => {
  await ensureDatabaseSchema();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infralab-ansible-test-'));
  process.env.ANSIBLE_WORK_DIR = workDir;

  // 1. Start an embedded SSH2 server to act as a real target Linux host for OpenSSH + ansible-playbook
  const hostKey = generateRsaKeyPairPem();
  const clientKey = generateRsaKeyPairPem();

  const sshServer = new SshServer(
    { hostKeys: [hostKey.privateKey] },
    (client) => {
      client.on('authentication', (ctx) => {
        if (ctx.method === 'publickey' || ctx.method === 'password') {
          return ctx.accept();
        }
        ctx.accept();
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (acceptPty) => {
            acceptPty?.();
          });
          session.on('exec', (acceptExec, _rejectExec, info) => {
            const stream = acceptExec();
            const cmd = info.command || '';
            if (cmd.includes('exit 42')) {
              stream.stderr.write('Simulated remote task failure\n');
              stream.exit(42);
              stream.end();
              return;
            }
            if (cmd.includes('sleep 15')) {
              const timer = setTimeout(() => {
                stream.exit(0);
                stream.end();
              }, 15000);
              stream.on('close', () => clearTimeout(timer));
              return;
            }
            stream.stdout.write(`REMOTE_EXEC_OK: ${cmd}\n`);
            stream.exit(0);
            stream.end();
          });
        });
      });
    }
  );

  await new Promise<void>((resolve) => sshServer.listen(0, '127.0.0.1', () => resolve()));
  const sshPort = (sshServer.address() as any).port as number;

  const app = createApp();
  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const httpPort = (httpServer.address() as any).port as number;
  const baseUrl = `http://127.0.0.1:${httpPort}`;

  const ownerUid = 'infralab-local-operator';
  const authToken = signLocalSessionToken({
    uid: ownerUid,
    username: 'admin',
    email: 'admin@infralab.local',
  });
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  let testServerId = 0;
  let createdInventoryId = 0;
  let createdPlaybookId = 0;
  let failPlaybookId = 0;

  try {
    // 2. Unauthorized access check
    const unauthRes = await fetch(`${baseUrl}/api/automation/playbooks`);
    assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401');

    // 3. Check Ansible runtime status
    const statusRes = await fetch(`${baseUrl}/api/automation/status`, {
      headers: authHeaders,
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.available, true, 'Ansible CLI should be available');
    assert.ok(statusBody.version.includes('ansible'), 'Should report ansible version');

    // 4. Verify graceful error when ANSIBLE_BIN is missing
    const prevBin = process.env.ANSIBLE_BIN;
    process.env.ANSIBLE_BIN = '/usr/bin/nonexistent-ansible-binary';
    const missingStatusRes = await fetch(`${baseUrl}/api/automation/status`, {
      headers: authHeaders,
    });
    const missingBody = await missingStatusRes.json();
    assert.equal(missingBody.available, false);
    assert.equal(missingBody.error, 'Ansible is not installed or unavailable');
    if (prevBin === undefined) {
      delete process.env.ANSIBLE_BIN;
    } else {
      process.env.ANSIBLE_BIN = prevBin;
    }

    // 5. Create a target server record pointing to our embedded SSH server
    const srvRecord = await createServerRecord({
      userUid: ownerUid,
      name: 'ansible-e2e-node',
      hostname: 'ansible-e2e.local',
      ipAddress: '127.0.0.1',
      sshPort,
      username: 'root',
      authType: 'private_key',
      encryptedSecret: encryptSecret(clientKey.privateKey),
      description: 'E2E Ansible target node',
    });
    testServerId = srvRecord.id;

    // 6. Create an Ansible Inventory with the target server
    const invCreateRes = await fetch(`${baseUrl}/api/automation/inventories`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'E2E Production Cluster',
        description: 'Test inventory for E2E Ansible run',
        group_name: 'webservers',
        server_ids: [testServerId],
      }),
    });
    assert.equal(invCreateRes.status, 201);
    const createdInv = await invCreateRes.json();
    createdInventoryId = createdInv.id;
    assert.equal(createdInv.server_count, 1);
    assert.equal(createdInv.servers[0].id, testServerId);

    // 7. Security checks: reject local execution & control-plane lookup in Playbook YAML
    const localBreakoutRes = await fetch(`${baseUrl}/api/automation/playbooks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Malicious Local Breakout',
        content: `---
- name: Breakout attempt
  hosts: all
  connection: local
  tasks:
    - name: Run local command
      ansible.builtin.command: id
`,
      }),
    });
    assert.equal(
      localBreakoutRes.status,
      400,
      'Playbook with connection: local must be rejected'
    );

    const lookupBreakoutRes = await fetch(`${baseUrl}/api/automation/playbooks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Malicious Lookup',
        content: `---
- name: File lookup attempt
  hosts: all
  tasks:
    - name: Read secret
      ansible.builtin.debug:
        msg: "{{ lookup('file', '/etc/passwd') }}"
`,
      }),
    });
    assert.equal(
      lookupBreakoutRes.status,
      400,
      'Playbook with control-plane file lookup must be rejected'
    );

    // 8. Create a valid Ansible Playbook using ansible.builtin.raw over SSH
    const pbCreateRes = await fetch(`${baseUrl}/api/automation/playbooks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'E2E SSH Raw Health Check',
        description: 'Executes raw health command over SSH via ansible-playbook',
        content: `---
- name: E2E SSH Raw Health Check
  hosts: all
  gather_facts: false
  tasks:
    - name: Execute remote readiness check over SSH
      ansible.builtin.raw: echo "HELLO_FROM_ANSIBLE_{{ release_tag | default('v1') }}"
      tags:
        - readiness
`,
      }),
    });
    assert.equal(pbCreateRes.status, 201);
    const createdPb = await pbCreateRes.json();
    createdPlaybookId = createdPb.id;

    // 9. Validate playbook syntax via ansible-playbook --syntax-check
    const validateRes = await fetch(
      `${baseUrl}/api/automation/playbooks/${createdPlaybookId}/validate`,
      {
        method: 'POST',
        headers: authHeaders,
      }
    );
    assert.equal(validateRes.status, 200);
    const validateBody = await validateRes.json();
    assert.equal(validateBody.validation.valid, true);
    assert.equal(validateBody.playbook.validation_status, 'valid');

    // 10. Validate invalid YAML syntax returns valid: false
    const invalidYamlRes = await fetch(
      `${baseUrl}/api/automation/playbooks/validate-content`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          content: `---
- name: Broken YAML
  hosts: all
  tasks:
    - name: Unknown module syntax error
      nonexistent_broken_indent: [unclosed
`,
        }),
      }
    );
    assert.equal(invalidYamlRes.status, 200);
    const invalidYamlBody = await invalidYamlRes.json();
    assert.equal(invalidYamlBody.valid, false);

    // 11. Security check: reject reserved ansible_* extra_vars and flag-injection tags
    const badExtraVarsJobRes = await fetch(`${baseUrl}/api/automation/jobs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        playbook_id: createdPlaybookId,
        inventory_id: createdInventoryId,
        extra_vars: { ansible_connection: 'local' },
      }),
    });
    assert.equal(
      badExtraVarsJobRes.status,
      400,
      'Overriding ansible_connection in extra_vars must be rejected'
    );

    const badTagsJobRes = await fetch(`${baseUrl}/api/automation/jobs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        playbook_id: createdPlaybookId,
        inventory_id: createdInventoryId,
        tags: '--list-hosts',
      }),
    });
    assert.equal(badTagsJobRes.status, 400, 'Flag injection in tags must be rejected');

    // 12. Start real Ansible Playbook Job and stream live output via SSE
    const startJobRes = await fetch(`${baseUrl}/api/automation/jobs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        playbook_id: createdPlaybookId,
        inventory_id: createdInventoryId,
        check_mode: false,
        diff_mode: true,
        tags: 'readiness',
        extra_vars: {
          release_tag: 'v2.4.0',
          deploy_secret_token: 'TOP_SECRET_VALUE_777',
        },
      }),
    });
    assert.equal(startJobRes.status, 201);
    const startedJob = await startJobRes.json();
    assert.ok(startedJob.id > 0);
    assert.equal(
      startedJob.extra_vars.deploy_secret_token,
      '***REDACTED***',
      'Sensitive extra_vars must be redacted in job record'
    );

    // Connect to SSE stream and wait for done event
    const sseResult = await new Promise<{
      doneStatus: string;
      exitCode: number;
      outputChunks: string;
    }>((resolve, reject) => {
      let outputChunks = '';
      const req = http.get(
        `${baseUrl}/api/automation/jobs/${startedJob.id}/stream?token=${encodeURIComponent(
          authToken
        )}`,
        (res) => {
          assert.equal(res.statusCode, 200);
          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8');
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const block of parts) {
              const lines = block.split('\n');
              const eventLine = lines.find((l) => l.startsWith('event:'));
              const dataLine = lines.find((l) => l.startsWith('data:'));
              if (!eventLine || !dataLine) continue;
              const eventType = eventLine.slice('event:'.length).trim();
              const data = JSON.parse(dataLine.slice('data:'.length).trim());
              if (eventType === 'snapshot') {
                outputChunks += (data.stdout || '') + (data.stderr || '');
              } else if (eventType === 'output') {
                outputChunks += data.chunk || '';
              } else if (eventType === 'done') {
                req.destroy();
                resolve({
                  doneStatus: data.status,
                  exitCode: data.exit_code,
                  outputChunks,
                });
              }
            }
          });
          res.on('error', reject);
        }
      );
      req.on('error', reject);
    });

    assert.equal(sseResult.doneStatus, 'SUCCESS');
    assert.equal(sseResult.exitCode, 0);
    assert.ok(
      sseResult.outputChunks.includes('PLAY [E2E SSH Raw Health Check]'),
      'SSE output must include PLAY header'
    );
    assert.ok(
      sseResult.outputChunks.includes('PLAY RECAP'),
      'SSE output must include PLAY RECAP'
    );
    assert.ok(
      !sseResult.outputChunks.includes('TOP_SECRET_VALUE_777'),
      'Secret extra_vars must never leak in output'
    );

    // 13. Verify persisted Job Details & Audit Logs
    const jobDetailRes = await fetch(
      `${baseUrl}/api/automation/jobs/${startedJob.id}`,
      { headers: authHeaders }
    );
    assert.equal(jobDetailRes.status, 200);
    const jobDetail = await jobDetailRes.json();
    assert.equal(jobDetail.status, 'SUCCESS');
    assert.equal(jobDetail.exit_code, 0);
    assert.ok(jobDetail.stdout.includes('PLAY RECAP'));

    // 14. Verify Failed Playbook handling
    const failPbRes = await fetch(`${baseUrl}/api/automation/playbooks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'E2E Failing Playbook',
        content: `---
- name: E2E Failing Playbook
  hosts: all
  gather_facts: false
  tasks:
    - name: Fail intentionally
      ansible.builtin.raw: exit 42
`,
      }),
    });
    assert.equal(failPbRes.status, 201);
    const failPb = await failPbRes.json();
    failPlaybookId = failPb.id;

    const failJobStartRes = await fetch(`${baseUrl}/api/automation/jobs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        playbook_id: failPlaybookId,
        inventory_id: createdInventoryId,
      }),
    });
    assert.equal(failJobStartRes.status, 201);
    const failJob = await failJobStartRes.json();

    // Poll until failJob finishes
    let finalFailJob: any = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const checkRes = await fetch(`${baseUrl}/api/automation/jobs/${failJob.id}`, {
        headers: authHeaders,
      });
      finalFailJob = await checkRes.json();
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(finalFailJob.status)) {
        break;
      }
    }
    assert.equal(finalFailJob?.status, 'FAILED', 'Failing task must result in FAILED status');
    assert.notEqual(finalFailJob?.exit_code, 0);

    // 15. Verify Automation Audit Logs contain started, completed, and failed events
    const auditRes = await fetch(`${baseUrl}/api/automation/audit-logs`, {
      headers: authHeaders,
    });
    assert.equal(auditRes.status, 200);
    const auditLogs = await auditRes.json();
    const eventTypes = new Set(auditLogs.map((l: any) => l.event_type));
    assert.ok(eventTypes.has('automation.job.started'));
    assert.ok(eventTypes.has('automation.job.completed'));
    assert.ok(eventTypes.has('automation.job.failed'));

    // 16. Verify temporary job directories and SSH key files were cleaned up
    const remainingFiles = fs.readdirSync(workDir);
    assert.equal(
      remainingFiles.length,
      0,
      'All temporary job directories and SSH key files must be deleted after execution'
    );
  } finally {
    if (createdPlaybookId) {
      await fetch(`${baseUrl}/api/automation/playbooks/${createdPlaybookId}`, {
        method: 'DELETE',
        headers: authHeaders,
      }).catch(() => {});
    }
    if (failPlaybookId) {
      await fetch(`${baseUrl}/api/automation/playbooks/${failPlaybookId}`, {
        method: 'DELETE',
        headers: authHeaders,
      }).catch(() => {});
    }
    if (createdInventoryId) {
      await fetch(`${baseUrl}/api/automation/inventories/${createdInventoryId}`, {
        method: 'DELETE',
        headers: authHeaders,
      }).catch(() => {});
    }
    if (testServerId) {
      await deleteServerById(testServerId, ownerUid).catch(() => {});
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await new Promise<void>((resolve) => sshServer.close(() => resolve()));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
