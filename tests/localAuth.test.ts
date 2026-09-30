import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  signLocalSessionToken,
  signPre2faToken,
  verifyAndConsumeRecoveryCode,
  verifyLocalSessionToken,
  verifyPassword,
  verifyPre2faToken,
  verifyTotpCode,
} from '../src/server/localAuth.ts';

test('Local Auth: password hashing with scrypt and timing-safe verification', () => {
  const hash = hashPassword('InfraLab!2026');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('InfraLab!2026', hash), true);
  assert.equal(verifyPassword('WrongPassword', hash), false);
});

test('Local Auth: signed session and pre-2FA tokens', () => {
  const user = {
    uid: 'infralab-local-operator',
    email: 'admin@infralab.local',
    username: 'admin',
  };

  const sessionToken = signLocalSessionToken(user);
  assert.ok(sessionToken.startsWith('ila_sess.'));
  const verifiedSession = verifyLocalSessionToken(sessionToken);
  assert.ok(verifiedSession);
  assert.equal(verifiedSession.uid, user.uid);
  assert.equal(verifiedSession.scope, 'session');

  // Session token must not pass as pre_2fa token
  assert.equal(verifyPre2faToken(sessionToken), null);

  const pre2faToken = signPre2faToken(user);
  assert.ok(pre2faToken.startsWith('ila_2fa.'));
  const verifiedPre = verifyPre2faToken(pre2faToken);
  assert.ok(verifiedPre);
  assert.equal(verifiedPre.uid, user.uid);
  assert.equal(verifiedPre.scope, 'pre_2fa');
});

test('Local Auth: RFC 6238 TOTP generation, window verification, and recovery codes', () => {
  const secret = generateTotpSecret(20);
  assert.equal(secret.length, 32);

  const fixedNow = 1_700_000_000_000;
  const codeNow = generateTotpCode(secret, fixedNow);
  assert.match(codeNow, /^\d{6}$/);

  // Current window and +/- 30s drift window should verify
  assert.equal(verifyTotpCode(secret, codeNow, fixedNow), true);
  assert.equal(verifyTotpCode(secret, codeNow, fixedNow + 25_000), true);
  assert.equal(verifyTotpCode(secret, '000000', fixedNow), codeNow === '000000');

  const uri = buildOtpAuthUri({
    secret,
    accountName: 'admin@infralab.local',
    issuer: 'InfraLab',
  });
  assert.ok(uri.startsWith('otpauth://totp/InfraLab:admin%40infralab.local?'));
  assert.ok(uri.includes(`secret=${secret}`));

  // Recovery codes generation and single-use consumption
  const { plainCodes, hashedCodesJson } = generateRecoveryCodes(8);
  assert.equal(plainCodes.length, 8);

  const firstRecovery = plainCodes[0];
  const consume1 = verifyAndConsumeRecoveryCode(firstRecovery, hashedCodesJson);
  assert.equal(consume1.valid, true);
  assert.equal(consume1.remainingCount, 7);

  // Re-using the same recovery code must fail
  const consumeAgain = verifyAndConsumeRecoveryCode(firstRecovery, consume1.remainingHashesJson);
  assert.equal(consumeAgain.valid, false);
  assert.equal(consumeAgain.remainingCount, 7);
});
