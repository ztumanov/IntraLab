import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import { ensureDatabaseSchema } from './src/db/bootstrap.ts';
import { attachTerminalWebSocketServer } from './src/server/wsTerminal.ts';
import {
  listServersByUser,
  getServerById,
  createServerRecord,
  updateServerCredentialsRecord,
  updateServerProbeResult,
  deleteServerById,
  createCommandLogRecord,
  listCommandLogsByServer,
  listServerMetrics,
} from './src/db/servers.ts';
import {
  enrollAgentWithToken,
  getOrProvisionServerAgent,
  listPrometheusAgentTargets,
  recordAgentHeartbeat,
  recordAgentSystemInfo,
  rotateServerEnrollmentToken,
  verifyAgentCredential,
} from './src/db/agents.ts';
import {
  fetchServerMonitoringMetrics,
  parseMonitoringTimeRange,
} from './src/server/prometheusClient.ts';
import { validateCreateServerPayload } from './src/lib/validation.ts';
import {
  encryptSecret,
  decryptSecret,
  executeSshCommand,
  fetchDockerContainerLogs,
  fetchSystemLogsOverSsh,
  inspectDockerOnServer,
  inspectNetworkOnServer,
  performDockerContainerAction,
  probeSshServer,
  runDockerContainerOnServer,
} from './src/server/sshConnector.ts';
import {
  activateUserTotp,
  createLocalUserAccount,
  disableUserTotp,
  findLocalUserByIdentifier,
  findUserByUid,
  savePendingTotpSecret,
  updateUserPasswordHash,
  updateUserRecoveryCodes,
} from './src/db/users.ts';
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpQrDataUrl,
  generateTotpSecret,
  hashPassword,
  signLocalSessionToken,
  signPre2faToken,
  verifyAndConsumeRecoveryCode,
  verifyPassword,
  verifyPre2faToken,
  verifyTotpCode,
} from './src/server/localAuth.ts';
import type {
  DockerContainerAction,
  ServerGeoLocation,
  SystemLogSource,
} from './src/types/server.ts';

interface CachedGeoInfo {
  lat: number;
  lng: number;
  city: string;
  region: string;
  country: string;
  country_code: string;
  isp: string;
  org: string;
  asn: string;
  timezone: string;
  is_private_ip: boolean;
}

const geoCache = new Map<string, CachedGeoInfo>();

function isPrivateOrLocalAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  if (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean.startsWith('10.') ||
    clean.startsWith('192.168.') ||
    clean.startsWith('169.254.')
  ) {
    return true;
  }
  const m = clean.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

async function resolveIpGeolocation(ipAddress: string, serverId: number): Promise<CachedGeoInfo> {
  const ip = ipAddress.trim();
  const cached = geoCache.get(ip);
  if (cached) {
    return cached;
  }

  if (isPrivateOrLocalAddress(ip)) {
    const privateHubs: CachedGeoInfo[] = [
      {
        lat: 50.1109,
        lng: 8.6821,
        city: 'Frankfurt am Main',
        region: 'Hesse',
        country: 'Germany (Private VPC)',
        country_code: 'DE',
        isp: 'InfraLab Private Network',
        org: 'RFC1918 Internal Subnet',
        asn: 'AS64512',
        timezone: 'Europe/Berlin',
        is_private_ip: true,
      },
      {
        lat: 52.3676,
        lng: 4.9041,
        city: 'Amsterdam',
        region: 'North Holland',
        country: 'Netherlands (Private VPC)',
        country_code: 'NL',
        isp: 'InfraLab Private Network',
        org: 'RFC1918 Internal Subnet',
        asn: 'AS64513',
        timezone: 'Europe/Amsterdam',
        is_private_ip: true,
      },
      {
        lat: 51.5072,
        lng: -0.1276,
        city: 'London',
        region: 'England',
        country: 'United Kingdom (Private VPC)',
        country_code: 'GB',
        isp: 'InfraLab Private Network',
        org: 'RFC1918 Internal Subnet',
        asn: 'AS64514',
        timezone: 'Europe/London',
        is_private_ip: true,
      },
    ];
    const hub = privateHubs[serverId % privateHubs.length];
    return hub;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const resp = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (resp.ok) {
      const data: any = await resp.json();
      if (data && data.status === 'success' && typeof data.lat === 'number' && typeof data.lon === 'number') {
        const result: CachedGeoInfo = {
          lat: data.lat,
          lng: data.lon,
          city: data.city || 'Unknown City',
          region: data.regionName || '',
          country: data.country || 'Unknown Country',
          country_code: data.countryCode || 'UN',
          isp: data.isp || data.org || 'Cloud Provider',
          org: data.org || data.isp || '',
          asn: data.as || '',
          timezone: data.timezone || 'UTC',
          is_private_ip: false,
        };
        geoCache.set(ip, result);
        return result;
      }
    }
  } catch {
    // Fallback to secondary IP geo provider
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const resp = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data: any = await resp.json();
      if (data && data.success !== false && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        const result: CachedGeoInfo = {
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || 'Unknown City',
          region: data.region || '',
          country: data.country || 'Unknown Country',
          country_code: data.country_code || 'UN',
          isp: data.connection?.isp || data.connection?.org || 'Cloud Provider',
          org: data.connection?.org || '',
          asn: data.connection?.asn ? `AS${data.connection.asn}` : '',
          timezone: data.timezone?.id || 'UTC',
          is_private_ip: false,
        };
        geoCache.set(ip, result);
        return result;
      }
    }
  } catch {
    // Ignore and use fallback
  }

  const fallback: CachedGeoInfo = {
    lat: 50.1109,
    lng: 8.6821,
    city: 'Frankfurt am Main',
    region: 'Hesse',
    country: 'Germany',
    country_code: 'DE',
    isp: 'Data Center Network',
    org: 'European Cloud Node',
    asn: '',
    timezone: 'Europe/Berlin',
    is_private_ip: false,
  };
  return fallback;
}

function serializeServer(row: {
  id: number;
  name: string;
  hostname: string;
  ipAddress: string;
  sshPort: number;
  username: string;
  authType?: string;
  encryptedSecret?: string;
  description: string;
  status: string;
  lastCheckError?: string;
  lastCheckedAt?: Date | null;
  latencyMs?: number | null;
  osInfo?: string;
  kernelInfo?: string;
  cpuCores?: number | null;
  cpuLoad?: string;
  cpuUsagePercent?: number | null;
  memoryMb?: number | null;
  memoryUsedMb?: number | null;
  diskTotalGb?: string;
  diskUsedGb?: string;
  diskUsagePercent?: number | null;
  uptimeInfo?: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    ip_address: row.ipAddress,
    ssh_port: row.sshPort,
    username: row.username,
    auth_type: (row.authType === 'private_key' ? 'private_key' : 'password') as
      | 'password'
      | 'private_key',
    has_secret: Boolean(row.encryptedSecret && row.encryptedSecret.length > 0),
    description: row.description,
    status: row.status as 'unknown' | 'online' | 'offline',
    last_check_error: row.lastCheckError ?? '',
    last_checked_at:
      row.lastCheckedAt instanceof Date
        ? row.lastCheckedAt.toISOString()
        : row.lastCheckedAt
          ? String(row.lastCheckedAt)
          : null,
    latency_ms: row.latencyMs ?? null,
    os_info: row.osInfo ?? '',
    kernel_info: row.kernelInfo ?? '',
    cpu_cores: row.cpuCores ?? null,
    cpu_load: row.cpuLoad ?? '',
    cpu_usage_percent: row.cpuUsagePercent ?? null,
    memory_mb: row.memoryMb ?? null,
    memory_used_mb: row.memoryUsedMb ?? null,
    disk_total_gb: row.diskTotalGb ?? '',
    disk_used_gb: row.diskUsedGb ?? '',
    disk_usage_percent: row.diskUsagePercent ?? null,
    uptime_info: row.uptimeInfo ?? '',
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updated_at:
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function serializeCommandLog(row: {
  id: number;
  serverId: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  executedAt: Date;
}) {
  return {
    id: row.id,
    server_id: row.serverId,
    command: row.command,
    stdout: row.stdout,
    stderr: row.stderr,
    exit_code: row.exitCode,
    duration_ms: row.durationMs,
    executed_at:
      row.executedAt instanceof Date ? row.executedAt.toISOString() : String(row.executedAt),
  };
}

function serializeMetricPoint(row: {
  id: number;
  serverId: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  memoryUsedMb: number;
  diskUsagePercent: number;
  load1m: string;
  latencyMs: number;
  recordedAt: Date;
}) {
  return {
    id: row.id,
    server_id: row.serverId,
    cpu_usage_percent: row.cpuUsagePercent,
    memory_usage_percent: row.memoryUsagePercent,
    memory_used_mb: row.memoryUsedMb,
    disk_usage_percent: row.diskUsagePercent,
    load_1m: parseFloat(row.load1m || '0') || 0,
    latency_ms: row.latencyMs,
    recorded_at:
      row.recordedAt instanceof Date ? row.recordedAt.toISOString() : String(row.recordedAt),
  };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'infralab-api',
      timestamp: new Date().toISOString(),
    });
  });

  // --- Local Authentication & 2FA TOTP Endpoints ---

  app.post('/api/auth/local/login', async (req, res) => {
    try {
      const identifier = String(req.body?.identifier || '').trim();
      const password = String(req.body?.password || '');
      if (!identifier || !password) {
        return res.status(400).json({ error: 'Введите логин (или email) и пароль' });
      }

      const user = await findLocalUserByIdentifier(identifier);
      if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
      }

      const username = user.username || user.email.split('@')[0];

      if (user.totpEnabled === 1 && user.totpSecretEncrypted) {
        const preAuthToken = signPre2faToken({
          uid: user.uid,
          email: user.email,
          username,
        });
        return res.status(200).json({
          requires_2fa: true,
          pre_auth_token: preAuthToken,
          email: user.email,
          username,
        });
      }

      const token = signLocalSessionToken({
        uid: user.uid,
        email: user.email,
        username,
      });

      return res.status(200).json({
        requires_2fa: false,
        token,
        user: {
          uid: user.uid,
          email: user.email,
          username,
          totp_enabled: user.totpEnabled === 1,
          auth_provider: 'local',
        },
      });
    } catch (error: any) {
      console.error('POST /api/auth/local/login failed:', error);
      return res.status(500).json({ error: error.message || 'Ошибка входа' });
    }
  });

  app.post('/api/auth/local/verify-2fa', async (req, res) => {
    try {
      const preAuthToken = String(req.body?.pre_auth_token || '').trim();
      const code = String(req.body?.code || '').trim();
      if (!preAuthToken || !code) {
        return res.status(400).json({ error: 'Введите 6-значный код 2FA или резервный код' });
      }

      const prePayload = verifyPre2faToken(preAuthToken);
      if (!prePayload) {
        return res.status(401).json({
          error: 'Сессия проверки 2FA истекла. Пожалуйста, введите пароль заново.',
        });
      }

      const user = await findUserByUid(prePayload.uid);
      if (!user || user.totpEnabled !== 1 || !user.totpSecretEncrypted) {
        return res.status(400).json({ error: '2FA не настроена для данного пользователя' });
      }

      const totpSecret = decryptSecret(user.totpSecretEncrypted);
      const isTotpValid = verifyTotpCode(totpSecret, code);
      let usedRecoveryCode = false;

      if (!isTotpValid) {
        const recoveryCheck = verifyAndConsumeRecoveryCode(code, user.recoveryCodesHashes);
        if (!recoveryCheck.valid) {
          return res.status(401).json({
            error: 'Неверный код 2FA (TOTP) или резервный код восстановления',
          });
        }
        usedRecoveryCode = true;
        await updateUserRecoveryCodes(user.uid, recoveryCheck.remainingHashesJson);
      }

      const username = user.username || user.email.split('@')[0];
      const sessionToken = signLocalSessionToken({
        uid: user.uid,
        email: user.email,
        username,
      });

      return res.status(200).json({
        token: sessionToken,
        used_recovery_code: usedRecoveryCode,
        user: {
          uid: user.uid,
          email: user.email,
          username,
          totp_enabled: true,
          auth_provider: 'local',
        },
      });
    } catch (error: any) {
      console.error('POST /api/auth/local/verify-2fa failed:', error);
      return res.status(500).json({ error: error.message || 'Ошибка проверки 2FA' });
    }
  });

  app.post('/api/auth/local/register', async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');

      if (!username || username.length < 3 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return res.status(400).json({
          error: 'Имя пользователя должно содержать минимум 3 символа (латиница, цифры, _.-)',
        });
      }
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Укажите корректный email' });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
      }

      const existingByUsername = await findLocalUserByIdentifier(username);
      if (existingByUsername) {
        return res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
      }
      const existingByEmail = await findLocalUserByIdentifier(email);
      if (existingByEmail) {
        return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
      }

      const passwordHash = hashPassword(password);
      const created = await createLocalUserAccount({
        username,
        email,
        passwordHash,
      });

      const token = signLocalSessionToken({
        uid: created.uid,
        email: created.email,
        username: created.username,
      });

      return res.status(201).json({
        token,
        user: {
          uid: created.uid,
          email: created.email,
          username: created.username,
          totp_enabled: false,
          auth_provider: 'local',
        },
      });
    } catch (error: any) {
      console.error('POST /api/auth/local/register failed:', error);
      return res.status(500).json({ error: error.message || 'Ошибка регистрации' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const user = await findUserByUid(uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      let recoveryCodesRemaining = 0;
      try {
        const parsed = JSON.parse(user.recoveryCodesHashes || '[]');
        if (Array.isArray(parsed)) {
          recoveryCodesRemaining = parsed.length;
        }
      } catch {
        recoveryCodesRemaining = 0;
      }

      return res.status(200).json({
        uid: user.uid,
        email: user.email,
        username: user.username || user.email.split('@')[0],
        auth_provider: user.authProvider || 'local',
        has_local_password: Boolean(user.passwordHash),
        totp_enabled: user.totpEnabled === 1,
        recovery_codes_remaining: recoveryCodesRemaining,
      });
    } catch (error: any) {
      console.error('GET /api/auth/me failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to load profile' });
    }
  });

  app.post('/api/auth/2fa/setup', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const user = await findUserByUid(uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const secret = generateTotpSecret(20);
      const encryptedPending = encryptSecret(secret);
      await savePendingTotpSecret(uid, encryptedPending);

      const accountName = user.email || user.username || uid;
      const otpauthUri = buildOtpAuthUri({
        secret,
        accountName,
        issuer: 'InfraLab',
      });
      const qrDataUrl = await generateTotpQrDataUrl(otpauthUri);

      return res.status(200).json({
        secret,
        otpauth_uri: otpauthUri,
        qr_data_url: qrDataUrl,
        issuer: 'InfraLab',
        account: accountName,
      });
    } catch (error: any) {
      console.error('POST /api/auth/2fa/setup failed:', error);
      return res.status(500).json({ error: error.message || 'Не удалось инициализировать 2FA' });
    }
  });

  app.post('/api/auth/2fa/enable', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const code = String(req.body?.code || '').trim();
      if (!code) {
        return res.status(400).json({ error: 'Введите 6-значный код из приложения-аутентификатора' });
      }

      const user = await findUserByUid(uid);
      if (!user || !user.totpPendingSecretEncrypted) {
        return res.status(400).json({
          error: 'Сначала запросите генерацию QR-кода и секрета 2FA',
        });
      }

      const pendingSecret = decryptSecret(user.totpPendingSecretEncrypted);
      if (!verifyTotpCode(pendingSecret, code)) {
        return res.status(400).json({
          error: 'Неверный 6-значный код. Проверьте синхронизацию времени на устройстве.',
        });
      }

      const { plainCodes, hashedCodesJson } = generateRecoveryCodes(8);
      await activateUserTotp(uid, user.totpPendingSecretEncrypted, hashedCodesJson);

      return res.status(200).json({
        totp_enabled: true,
        recovery_codes: plainCodes,
      });
    } catch (error: any) {
      console.error('POST /api/auth/2fa/enable failed:', error);
      return res.status(500).json({ error: error.message || 'Не удалось включить 2FA' });
    }
  });

  app.post('/api/auth/2fa/disable', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const verification = String(req.body?.code || '').trim();
      if (!verification) {
        return res.status(400).json({
          error: 'Для отключения 2FA введите текущий 6-значный код TOTP или пароль от аккаунта',
        });
      }

      const user = await findUserByUid(uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      let verified = false;
      if (user.totpSecretEncrypted) {
        const secret = decryptSecret(user.totpSecretEncrypted);
        if (verifyTotpCode(secret, verification)) {
          verified = true;
        }
      }
      if (!verified && user.passwordHash && verifyPassword(verification, user.passwordHash)) {
        verified = true;
      }
      if (!verified && user.recoveryCodesHashes) {
        const rec = verifyAndConsumeRecoveryCode(verification, user.recoveryCodesHashes);
        if (rec.valid) {
          verified = true;
        }
      }

      if (!verified) {
        return res.status(401).json({
          error: 'Неверный код 2FA или пароль',
        });
      }

      await disableUserTotp(uid);
      return res.status(200).json({ totp_enabled: false });
    } catch (error: any) {
      console.error('POST /api/auth/2fa/disable failed:', error);
      return res.status(500).json({ error: error.message || 'Не удалось отключить 2FA' });
    }
  });

  app.post('/api/auth/password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const currentPassword = String(req.body?.current_password || '');
      const newPassword = String(req.body?.new_password || '');

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
          error: 'Новый пароль должен содержать минимум 6 символов',
        });
      }

      const user = await findUserByUid(uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Текущий пароль указан неверно' });
      }

      const newHash = hashPassword(newPassword);
      await updateUserPasswordHash(uid, newHash);

      return res.status(200).json({ updated: true });
    } catch (error: any) {
      console.error('POST /api/auth/password failed:', error);
      return res.status(500).json({ error: error.message || 'Не удалось обновить пароль' });
    }
  });

  app.get('/api/servers', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const rows = await listServersByUser(uid);
      res.status(200).json(rows.map(serializeServer));
    } catch (error: any) {
      console.error('GET /api/servers failed:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch servers' });
    }
  });

  app.post('/api/servers', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const validation = validateCreateServerPayload(req.body || {});
      if (!validation.valid || !validation.data) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.errors,
        });
      }

      const encryptedSecret = validation.data.secret
        ? encryptSecret(validation.data.secret)
        : '';

      let created = await createServerRecord({
        userUid: uid,
        name: validation.data.name,
        hostname: validation.data.hostname,
        ipAddress: validation.data.ip_address,
        sshPort: validation.data.ssh_port,
        username: validation.data.username,
        authType: validation.data.auth_type,
        encryptedSecret,
        description: validation.data.description,
      });

      if (validation.data.verify_now && encryptedSecret) {
        const probe = await probeSshServer({
          ipAddress: created.ipAddress,
          sshPort: created.sshPort,
          username: created.username,
          authType: created.authType ?? 'password',
          encryptedSecret: created.encryptedSecret ?? '',
        });
        const updated = await updateServerProbeResult({
          id: created.id,
          userUid: uid,
          probe,
        });
        if (updated) {
          created = updated;
        }
      }

      return res.status(201).json(serializeServer(created));
    } catch (error: any) {
      console.error('POST /api/servers failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to create server' });
    }
  });

  app.post('/api/servers/check-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const rows = await listServersByUser(uid);
      const updatedRows = await Promise.all(
        rows.map(async (srv) => {
          const probe = await probeSshServer({
            ipAddress: srv.ipAddress,
            sshPort: srv.sshPort,
            username: srv.username,
            authType: srv.authType ?? 'password',
            encryptedSecret: srv.encryptedSecret ?? '',
          });
          const updated = await updateServerProbeResult({
            id: srv.id,
            userUid: uid,
            probe,
          });
          return updated ?? srv;
        })
      );
      return res.status(200).json(updatedRows.map(serializeServer));
    } catch (error: any) {
      console.error('POST /api/servers/check-all failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to probe servers' });
    }
  });

  app.get('/api/servers/geolocation', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const rows = await listServersByUser(uid);

      const seenCoords = new Map<string, number>();
      const locations: ServerGeoLocation[] = await Promise.all(
        rows.map(async (srv) => {
          const geo = await resolveIpGeolocation(srv.ipAddress, srv.id);
          const key = `${geo.lat.toFixed(3)},${geo.lng.toFixed(3)}`;
          const count = seenCoords.get(key) || 0;
          seenCoords.set(key, count + 1);

          // Apply slight deterministic spiral offset if multiple hosts share the same datacenter coordinates
          const angle = count * 1.15;
          const radius = count === 0 ? 0 : 0.004 * Math.ceil(count / 2);
          const lat = Number((geo.lat + Math.sin(angle) * radius).toFixed(5));
          const lng = Number((geo.lng + Math.cos(angle) * radius).toFixed(5));

          return {
            server: serializeServer(srv) as any,
            lat,
            lng,
            city: geo.city,
            region: geo.region,
            country: geo.country,
            country_code: geo.country_code,
            isp: geo.isp,
            org: geo.org,
            asn: geo.asn,
            timezone: geo.timezone,
            is_private_ip: geo.is_private_ip,
          };
        })
      );

      return res.status(200).json(locations);
    } catch (error: any) {
      console.error('GET /api/servers/geolocation failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to resolve server geolocation' });
    }
  });

  app.get('/api/servers/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      return res.status(200).json(serializeServer(server));
    } catch (error: any) {
      console.error('GET /api/servers/:id failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch server details' });
    }
  });

  app.put('/api/servers/:id/credentials', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const existing = await getServerById(id, uid);
      if (!existing) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const { username, ssh_port, auth_type, secret, verify_now } = req.body || {};
      if (typeof secret !== 'string' || secret.trim().length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { secret: 'Пароль или приватный SSH-ключ обязателен' },
        });
      }

      const normalizedAuthType: 'password' | 'private_key' =
        auth_type === 'private_key' ? 'private_key' : 'password';
      const encryptedSecret = encryptSecret(secret);

      let updated = await updateServerCredentialsRecord({
        id,
        userUid: uid,
        username: typeof username === 'string' ? username : undefined,
        sshPort: typeof ssh_port === 'number' ? ssh_port : Number(ssh_port) || undefined,
        authType: normalizedAuthType,
        encryptedSecret,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Server not found' });
      }

      if (verify_now !== false) {
        const probe = await probeSshServer({
          ipAddress: updated.ipAddress,
          sshPort: updated.sshPort,
          username: updated.username,
          authType: updated.authType ?? 'password',
          encryptedSecret: updated.encryptedSecret ?? '',
        });
        const afterProbe = await updateServerProbeResult({
          id: updated.id,
          userUid: uid,
          probe,
        });
        if (afterProbe) {
          updated = afterProbe;
        }
      }

      return res.status(200).json(serializeServer(updated));
    } catch (error: any) {
      console.error('PUT /api/servers/:id/credentials failed:', error);
      return res
        .status(500)
        .json({ error: error.message || 'Failed to update SSH credentials' });
    }
  });

  app.post('/api/servers/:id/check', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const probe = await probeSshServer({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
      });

      const updated = await updateServerProbeResult({
        id: server.id,
        userUid: uid,
        probe,
      });

      return res.status(200).json(serializeServer(updated ?? server));
    } catch (error: any) {
      console.error('POST /api/servers/:id/check failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to check SSH connection' });
    }
  });

  app.get('/api/servers/:id/telemetry', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const probe = await probeSshServer({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
      });

      const updated = await updateServerProbeResult({
        id: server.id,
        userUid: uid,
        probe,
      });

      const metricsHistory = await listServerMetrics(id, 30);

      return res.status(200).json({
        server: serializeServer(updated ?? server),
        filesystems: probe.filesystems,
        top_processes: probe.topProcesses,
        network_interfaces: probe.networkInterfaces,
        metrics_history: metricsHistory.map(serializeMetricPoint),
      });
    } catch (error: any) {
      console.error('GET /api/servers/:id/telemetry failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to collect live telemetry' });
    }
  });

  app.get('/api/servers/:id/network', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const netData = await inspectNetworkOnServer({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
      });

      return res.status(200).json({
        server_id: server.id,
        interfaces: netData.interfaces,
        listening_ports: netData.listeningPorts,
        routes: netData.routes,
        dns_servers: netData.dnsServers,
        connections_summary: netData.connectionsSummary,
        inspected_at: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('GET /api/servers/:id/network failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to inspect server network' });
    }
  });

  // Docker Inspection & Container Lifecycle Routes
  app.get('/api/servers/:id/docker', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const dockerData = await inspectDockerOnServer({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
      });

      return res.status(200).json({
        server_id: server.id,
        daemon_active: dockerData.daemonActive,
        docker_version: dockerData.dockerVersion,
        error: dockerData.error,
        containers: dockerData.containers,
        images: dockerData.images,
        networks: dockerData.networks,
        inspected_at: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('GET /api/servers/:id/docker failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to inspect Docker daemon' });
    }
  });

  app.post(
    '/api/servers/:id/docker/containers/:containerId/action',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const uid = req.user!.uid;
        const id = Number(req.params.id);
        const containerId = String(req.params.containerId || '').trim();
        const action = String(req.body?.action || '').trim() as DockerContainerAction;

        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Invalid server ID' });
        }
        if (!['start', 'stop', 'restart', 'remove'].includes(action)) {
          return res.status(400).json({ error: 'Invalid container action' });
        }

        const server = await getServerById(id, uid);
        if (!server) {
          return res.status(404).json({ error: 'Server not found' });
        }

        const execResult = await performDockerContainerAction({
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType ?? 'password',
          encryptedSecret: server.encryptedSecret ?? '',
          containerId,
          action,
        });

        await createCommandLogRecord({
          serverId: server.id,
          userUid: uid,
          command: `docker ${action === 'remove' ? 'rm -f' : action} ${containerId}`,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          exitCode: execResult.exitCode,
          durationMs: execResult.durationMs,
        });

        if (execResult.exitCode !== 0 && execResult.stderr) {
          return res.status(400).json({
            error: execResult.stderr.trim() || `Docker ${action} failed`,
          });
        }

        return res.status(200).json({
          ok: true,
          action,
          container_id: containerId,
          stdout: execResult.stdout,
        });
      } catch (error: any) {
        console.error('POST /api/servers/:id/docker/containers/:containerId/action failed:', error);
        return res
          .status(500)
          .json({ error: error.message || 'Failed to perform container action' });
      }
    }
  );

  app.get(
    '/api/servers/:id/docker/containers/:containerId/logs',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const uid = req.user!.uid;
        const id = Number(req.params.id);
        const containerId = String(req.params.containerId || '').trim();
        const tail = Number(req.query.tail) || 120;

        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Invalid server ID' });
        }

        const server = await getServerById(id, uid);
        if (!server) {
          return res.status(404).json({ error: 'Server not found' });
        }

        const logs = await fetchDockerContainerLogs({
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType ?? 'password',
          encryptedSecret: server.encryptedSecret ?? '',
          containerId,
          tail,
        });

        return res.status(200).json({
          container_id: containerId,
          logs,
          fetched_at: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error('GET /api/servers/:id/docker/containers/:containerId/logs failed:', error);
        return res
          .status(500)
          .json({ error: error.message || 'Failed to fetch container logs' });
      }
    }
  );

  app.post('/api/servers/:id/docker/run', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const { command, result } = await runDockerContainerOnServer({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
        input: req.body || {},
      });

      await createCommandLogRecord({
        serverId: server.id,
        userUid: uid,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });

      if (result.exitCode !== 0) {
        return res.status(400).json({
          error: (result.stderr || result.stdout || 'Failed to start container').trim(),
        });
      }

      return res.status(201).json({
        ok: true,
        container_id: result.stdout.trim().slice(0, 12),
        command,
      });
    } catch (error: any) {
      console.error('POST /api/servers/:id/docker/run failed:', error);
      return res.status(400).json({ error: error.message || 'Failed to launch container' });
    }
  });

  app.get('/api/servers/:id/commands', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const logs = await listCommandLogsByServer(id, uid, 25);
      return res.status(200).json(logs.map(serializeCommandLog));
    } catch (error: any) {
      console.error('GET /api/servers/:id/commands failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch command logs' });
    }
  });

  app.get('/api/servers/:id/logs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const rawSource = String(req.query.source || 'journald');
      const source: SystemLogSource = ['journald', 'auth', 'kernel', 'docker'].includes(
        rawSource
      )
        ? (rawSource as SystemLogSource)
        : 'journald';
      const tail = Math.min(500, Math.max(20, Number(req.query.tail) || 100));

      const logData = await fetchSystemLogsOverSsh({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
        source,
        tail,
      });

      return res.status(200).json({
        server_id: server.id,
        source,
        tail,
        raw_output: logData.rawOutput,
        lines: logData.lines,
        fetched_at: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('GET /api/servers/:id/logs failed:', error);
      return res
        .status(500)
        .json({ error: error.message || 'Failed to fetch system logs over SSH' });
    }
  });

  app.post('/api/servers/:id/exec', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const rawCommand = req.body?.command;
      if (typeof rawCommand !== 'string' || rawCommand.trim().length === 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { command: 'Введите SSH-команду для выполнения' },
        });
      }

      const command = rawCommand.trim();
      if (command.length > 1000) {
        return res.status(400).json({
          error: 'Validation failed',
          details: { command: 'Команда слишком длинная (максимум 1000 символов)' },
        });
      }

      const execResult = await executeSshCommand({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType ?? 'password',
        encryptedSecret: server.encryptedSecret ?? '',
        command,
      });

      const savedLog = await createCommandLogRecord({
        serverId: server.id,
        userUid: uid,
        command,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        durationMs: execResult.durationMs,
      });

      return res.status(200).json(serializeCommandLog(savedLog));
    } catch (error: any) {
      console.error('POST /api/servers/:id/exec failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to execute SSH command' });
    }
  });

  app.delete('/api/servers/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const deleted = await deleteServerById(id, uid);
      if (!deleted) {
        return res.status(404).json({ error: 'Server not found' });
      }

      return res.status(204).send();
    } catch (error: any) {
      console.error('DELETE /api/servers/:id failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to delete server' });
    }
  });

  // --- Linux Agent API Endpoints ---
  function extractAgentCredentials(req: express.Request): {
    agentId: string;
    credential: string;
  } {
    const headerAgentId = String(req.headers['x-agent-id'] || '').trim();
    const authHeader = String(req.headers['authorization'] || '').trim();
    const bearerCred = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';

    const bodyAgentId =
      typeof req.body?.agent_id === 'string' ? req.body.agent_id.trim() : '';
    const bodyCred =
      typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';

    return {
      agentId: headerAgentId || bodyAgentId,
      credential: bearerCred || bodyCred,
    };
  }

  app.post('/api/agents/enroll', async (req, res) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const hostname =
        typeof req.body?.hostname === 'string' ? req.body.hostname.trim() : '';
      const version =
        typeof req.body?.version === 'string' ? req.body.version.trim() : '0.1.0';

      if (!token) {
        return res.status(400).json({ error: 'Enrollment token is required' });
      }

      const enrolled = await enrollAgentWithToken({
        token,
        hostname,
        version,
      });

      if (!enrolled) {
        return res
          .status(401)
          .json({ error: 'Invalid or already consumed enrollment token' });
      }

      // Return permanent credential once during enrollment; never log it
      return res.status(200).json({
        agent_id: enrolled.agentId,
        credential: enrolled.credential,
        server_id: enrolled.serverId,
      });
    } catch (error: any) {
      console.error('POST /api/agents/enroll failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to enroll agent' });
    }
  });

  app.post('/api/agents/heartbeat', async (req, res) => {
    try {
      const { agentId, credential } = extractAgentCredentials(req);
      if (!agentId || !credential) {
        return res.status(401).json({ error: 'Missing agent authentication credentials' });
      }

      const verified = await verifyAgentCredential(agentId, credential);
      if (!verified) {
        return res.status(401).json({ error: 'Invalid agent ID or credential' });
      }

      const version =
        typeof req.body?.version === 'string' ? req.body.version.trim() : undefined;
      const hostname =
        typeof req.body?.hostname === 'string' ? req.body.hostname.trim() : undefined;

      const seenAt = await recordAgentHeartbeat({
        agentId: verified.agentId,
        version,
        hostname,
      });

      return res.status(200).json({
        status: 'ok',
        agent_id: verified.agentId,
        last_seen_at: seenAt.toISOString(),
      });
    } catch (error: any) {
      console.error('POST /api/agents/heartbeat failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to process agent heartbeat' });
    }
  });

  app.post('/api/agents/system-info', async (req, res) => {
    try {
      const { agentId, credential } = extractAgentCredentials(req);
      if (!agentId || !credential) {
        return res.status(401).json({ error: 'Missing agent authentication credentials' });
      }

      const verified = await verifyAgentCredential(agentId, credential);
      if (!verified) {
        return res.status(401).json({ error: 'Invalid agent ID or credential' });
      }

      const seenAt = await recordAgentSystemInfo({
        agentId: verified.agentId,
        version: typeof req.body?.version === 'string' ? req.body.version : undefined,
        hostname: typeof req.body?.hostname === 'string' ? req.body.hostname : '',
        osDistribution:
          typeof req.body?.os_distribution === 'string'
            ? req.body.os_distribution
            : typeof req.body?.os === 'string'
            ? req.body.os
            : '',
        kernel: typeof req.body?.kernel === 'string' ? req.body.kernel : '',
        architecture:
          typeof req.body?.architecture === 'string' ? req.body.architecture : '',
        cpuCount: Number(req.body?.cpu_count) || 1,
        ramTotalBytes: Number(req.body?.ram_total_bytes ?? req.body?.ram_total) || 0,
        uptimeSeconds: Number(req.body?.uptime_seconds ?? req.body?.uptime) || 0,
      });

      return res.status(200).json({
        status: 'ok',
        agent_id: verified.agentId,
        last_seen_at: seenAt.toISOString(),
      });
    } catch (error: any) {
      console.error('POST /api/agents/system-info failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to record agent system info' });
    }
  });

  app.get('/api/servers/:id/agent', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const agentView = await getOrProvisionServerAgent(server.id);
      return res.status(200).json(agentView);
    } catch (error: any) {
      console.error('GET /api/servers/:id/agent failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to load server agent status' });
    }
  });

  app.post('/api/servers/:id/agent/token', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const agentView = await rotateServerEnrollmentToken(server.id);
      return res.status(200).json(agentView);
    } catch (error: any) {
      console.error('POST /api/servers/:id/agent/token failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to rotate enrollment token' });
    }
  });

  // --- Prometheus Dynamic HTTP Service Discovery & Server Metrics API ---
  app.get('/api/prometheus/targets', async (_req, res) => {
    try {
      const targets = await listPrometheusAgentTargets(9101);
      return res.status(200).json(targets);
    } catch (error: any) {
      console.error('GET /api/prometheus/targets failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to generate Prometheus target list' });
    }
  });

  app.get('/api/servers/:id/metrics', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid server ID' });
      }

      const server = await getServerById(id, uid);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }

      const range = parseMonitoringTimeRange(req.query.range);
      const monitoringData = await fetchServerMonitoringMetrics({
        server,
        range,
      });

      return res.status(200).json(monitoringData);
    } catch (error: any) {
      console.error('GET /api/servers/:id/metrics failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to query server metrics from Prometheus' });
    }
  });

  // --- Agent Binary & Systemd Unit Download Endpoints (for self-hosted Docker deployment) ---
  app.get('/downloads/infralab-agent', (_req, res) => {
    const binPath = path.join(process.cwd(), 'bin', 'infralab-agent');
    if (!fs.existsSync(binPath)) {
      return res.status(404).json({
        error:
          'Agent binary not built in this container. Build with Docker Compose or run: cd agent && go build -o ../bin/infralab-agent ./cmd/infralab-agent',
      });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="infralab-agent"');
    return res.sendFile(binPath);
  });

  app.get('/downloads/infralab-agent.service', (_req, res) => {
    const unitPath = path.join(process.cwd(), 'infralab-agent.service');
    if (!fs.existsSync(unitPath)) {
      return res.status(404).send('infralab-agent.service not found');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(unitPath);
  });

  return app;
}

async function startServer() {
  await ensureDatabaseSchema();
  const app = createApp();
  const httpServer = http.createServer(app);
  attachTerminalWebSocketServer(httpServer);

  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`InfraLab server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
