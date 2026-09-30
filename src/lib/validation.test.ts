import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreateServerPayload } from './validation.ts';
import { encryptSecret, decryptSecret } from '../server/sshConnector.ts';

test('validateCreateServerPayload accepts valid server with password auth', () => {
  const result = validateCreateServerPayload({
    name: 'prod-node-01',
    hostname: 'node01.infralab.internal',
    ip_address: '192.168.1.10',
    ssh_port: 22,
    username: 'root',
    auth_type: 'password',
    secret: 'SuperSecret123!',
    description: 'Primary node',
    verify_now: true,
  });

  assert.equal(result.valid, true);
  assert.equal(result.data?.name, 'prod-node-01');
  assert.equal(result.data?.auth_type, 'password');
  assert.equal(result.data?.secret, 'SuperSecret123!');
  assert.equal(result.data?.verify_now, true);
});

test('validateCreateServerPayload rejects invalid IP and SSH port', () => {
  const result = validateCreateServerPayload({
    name: '',
    hostname: 'node01',
    ip_address: '999.999.999.999',
    ssh_port: 70000,
    username: '',
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.name);
  assert.ok(result.errors.ip_address);
  assert.ok(result.errors.ssh_port);
  assert.ok(result.errors.username);
});

test('encryptSecret and decryptSecret roundtrip AES-256-GCM accurately', () => {
  const original = 'InfraLab#SSH_Secret_2026!';
  const encrypted = encryptSecret(original);
  assert.notEqual(encrypted, original);
  assert.equal(encrypted.split(':').length, 3);

  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, original);
});
