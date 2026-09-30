import crypto from 'node:crypto';
import QRCode from 'qrcode';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function getSigningSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.SSH_SECRET_KEY ||
    'infralab-default-self-hosted-session-secret-key-2026'
  );
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) {
    return false;
  }
  const [, salt, keyHex] = parts;
  if (!salt || !keyHex) {
    return false;
  }
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== keyBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

export interface LocalTokenPayload {
  uid: string;
  email: string;
  username: string;
  scope: 'session' | 'pre_2fa';
  iat: number;
  exp: number;
}

function signTokenPayload(prefix: string, payload: LocalTokenPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const hmac = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${prefix}.${payloadB64}`)
    .digest('base64url');
  return `${prefix}.${payloadB64}.${hmac}`;
}

function verifyTokenPayload(
  token: string,
  expectedPrefix: string,
  expectedScope: 'session' | 'pre_2fa'
): LocalTokenPayload | null {
  if (!token || !token.startsWith(`${expectedPrefix}.`)) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [prefix, payloadB64, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${prefix}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as LocalTokenPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (decoded.scope !== expectedScope) {
      return null;
    }
    if (typeof decoded.exp !== 'number' || decoded.exp < nowSec) {
      return null;
    }
    if (!decoded.uid || !decoded.email) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function signLocalSessionToken(user: {
  uid: string;
  email: string;
  username: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signTokenPayload('ila_sess', {
    uid: user.uid,
    email: user.email,
    username: user.username,
    scope: 'session',
    iat: nowSec,
    exp: nowSec + 7 * 24 * 3600, // 7 days
  });
}

export function verifyLocalSessionToken(token: string): LocalTokenPayload | null {
  return verifyTokenPayload(token, 'ila_sess', 'session');
}

export function signPre2faToken(user: {
  uid: string;
  email: string;
  username: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signTokenPayload('ila_2fa', {
    uid: user.uid,
    email: user.email,
    username: user.username,
    scope: 'pre_2fa',
    iat: nowSec,
    exp: nowSec + 5 * 60, // 5 minutes
  });
}

export function verifyPre2faToken(token: string): LocalTokenPayload | null {
  return verifyTokenPayload(token, 'ila_2fa', 'pre_2fa');
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function generateTotpCode(
  secretBase32: string,
  timestampMs: number = Date.now(),
  stepSeconds = 30,
  digits = 6
): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binaryCode % Math.pow(10, digits);
  return String(otp).padStart(digits, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  candidateCode: string,
  timestampMs: number = Date.now(),
  windowSteps = 1
): boolean {
  const cleanCandidate = String(candidateCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCandidate)) {
    return false;
  }

  for (let w = -windowSteps; w <= windowSteps; w++) {
    const checkTime = timestampMs + w * 30 * 1000;
    const expected = generateTotpCode(secretBase32, checkTime);
    const a = Buffer.from(cleanCandidate, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer || 'InfraLab';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.accountName)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export async function generateTotpQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 240,
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[\s-]/g, '');
  return crypto.createHash('sha256').update(`infralab-recovery:${normalized}`).digest('hex');
}

export function generateRecoveryCodes(count = 8): {
  plainCodes: string[];
  hashedCodesJson: string;
} {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const plainCodes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let part1 = '';
    let part2 = '';
    for (let j = 0; j < 4; j++) {
      part1 += alphabet[bytes[j] % alphabet.length];
      part2 += alphabet[bytes[j + 4] % alphabet.length];
    }
    const formatted = `${part1}-${part2}`;
    plainCodes.push(formatted);
    hashes.push(hashRecoveryCode(formatted));
  }

  return {
    plainCodes,
    hashedCodesJson: JSON.stringify(hashes),
  };
}

export function verifyAndConsumeRecoveryCode(
  candidateCode: string,
  hashedCodesJson: string
): { valid: boolean; remainingHashesJson: string; remainingCount: number } {
  const clean = String(candidateCode || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  if (clean.length < 6) {
    return { valid: false, remainingHashesJson: hashedCodesJson, remainingCount: 0 };
  }

  let hashes: string[] = [];
  try {
    const parsed = JSON.parse(hashedCodesJson || '[]');
    if (Array.isArray(parsed)) {
      hashes = parsed.filter((h): h is string => typeof h === 'string');
    }
  } catch {
    hashes = [];
  }

  const candidateHash = hashRecoveryCode(clean);
  const matchIndex = hashes.findIndex((h) => h === candidateHash);
  if (matchIndex === -1) {
    return { valid: false, remainingHashesJson: JSON.stringify(hashes), remainingCount: hashes.length };
  }

  const remaining = hashes.filter((_, idx) => idx !== matchIndex);
  return {
    valid: true,
    remainingHashesJson: JSON.stringify(remaining),
    remainingCount: remaining.length,
  };
}
