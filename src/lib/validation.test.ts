import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreateServerPayload } from './validation.ts';
import { encryptSecret, decryptSecret } from '../server/sshConnector.ts';
import {
  createInitialMapSelectionState,
  syncMapSelectionWithLocations,
  selectMapServer,
  closeMapServerPopup,
} from '../components/ServerGeoMap.tsx';

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

test('ServerGeoMap selection lifecycle: closing popup resets selectedServerId to null without auto-selecting server #1', () => {
  const serverIds = [1, 2];

  // 1. Initial load with empty locations -> then locations arrive
  let state = createInitialMapSelectionState([], false);
  assert.equal(state.selectedServerId, null);
  assert.equal(state.hasInitialized, false);

  state = syncMapSelectionWithLocations(state, serverIds, false);
  assert.equal(state.selectedServerId, 1, 'Initial full-page load selects first server once');
  assert.equal(state.hasInitialized, true);

  // 2. Select Server #2 -> popup visible for Server #2
  state = selectMapServer(state, 2);
  assert.equal(state.selectedServerId, 2);

  // 3. Click X to close popup -> popup closed, selectedServerId = null, Server #1 NOT auto-selected
  state = closeMapServerPopup(state);
  assert.equal(state.selectedServerId, null);

  // Simulate React useEffect sync after state change
  state = syncMapSelectionWithLocations(state, serverIds, false);
  assert.equal(
    state.selectedServerId,
    null,
    'After closing popup on Server #2, Server #1 must NOT be auto-selected'
  );

  // 4. Select Server #1 -> close -> no selection
  state = selectMapServer(state, 1);
  assert.equal(state.selectedServerId, 1);
  state = closeMapServerPopup(state);
  state = syncMapSelectionWithLocations(state, serverIds, false);
  assert.equal(state.selectedServerId, null, 'After closing popup on Server #1, selection remains null');

  // 5. Re-select Server #2 -> close -> select Server #1 -> popup Server #1
  state = selectMapServer(state, 2);
  assert.equal(state.selectedServerId, 2);
  state = closeMapServerPopup(state);
  state = syncMapSelectionWithLocations(state, serverIds, false);
  assert.equal(state.selectedServerId, null);

  state = selectMapServer(state, 1);
  state = syncMapSelectionWithLocations(state, serverIds, false);
  assert.equal(state.selectedServerId, 1, 'Selecting Server #1 after closing Server #2 opens Server #1');
});
