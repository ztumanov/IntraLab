import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import { pool } from './src/db/index.ts';
import { ensureDatabaseSchema } from './src/db/bootstrap.ts';
import { logger } from './src/lib/logger.ts';
import { attachTerminalWebSocketServer } from './src/server/wsTerminal.ts';
import {
  attachAgentLogStreamWebSocketServer,
  logStreamHub,
  validateContainerIdentifier,
  validatePriorityFilter,
  validateSinceFilter,
  validateTailFilter,
  validateUnitIdentifier,
} from './src/server/logStreamHub.ts';
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
  provisionAgentDirectlyForServer,
  recordAgentHeartbeat,
  recordAgentSystemInfo,
  renewAgentCertificate,
  revokeServerAgentCertificate,
  rotateServerEnrollmentToken,
  stopServerAgent,
  verifyAgentCredential,
  verifyAgentMtlsCertificate,
} from './src/db/agents.ts';
import { getOrInitInfraLabCa } from './src/server/agentPki.ts';
import { PORTABLE_AGENT_SCRIPT } from './src/server/portableAgentScript.ts';
import {
  clearServerPrometheusCache,
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
  createRemoteDirectoryOverSsh,
  deleteRemotePathOverSsh,
  listRemoteDirectoryOverSsh,
  readRemoteFileOverSsh,
  writeRemoteFileOverSsh,
} from './src/server/sftpManager.ts';
import {
  addServerToInventory,
  createInventoryRecord,
  createPlaybookRecord,
  deleteInventoryById,
  deletePlaybookById,
  getAnsibleJobById,
  getInventoryById,
  getPlaybookById,
  listAnsibleJobsByUser,
  listAutomationAuditLogsByUser,
  listInventoriesByUser,
  listPlaybooksByUser,
  removeServerFromInventory,
  updateInventoryRecord,
  updatePlaybookRecord,
} from './src/db/automation.ts';
import {
  ansibleJobManager,
  checkAnsibleRuntime,
  ensureStarterPlaybooksForUser,
  validateAndSavePlaybookById,
  validatePlaybookStaticSecurity,
  validatePlaybookWithAnsibleCli,
} from './src/server/ansibleRunner.ts';
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
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'infralab-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/ready', async (req, res) => {
    const checks: {
      database: 'ok' | 'error';
      prometheus: 'ok' | 'error';
    } = {
      database: 'ok',
      prometheus: 'ok',
    };

    try {
      await pool.query('SELECT 1');
    } catch (err: any) {
      checks.database = 'error';
      logger.error({
        component: 'health',
        operation: 'ready_check_database',
        error: err?.message || 'PostgreSQL readiness check failed',
      });
    }

    const configuredPromUrl = (process.env.PROMETHEUS_URL || '').trim();
    const strictProm = req.query.strict_prometheus === 'true' || Boolean(configuredPromUrl);

    if (strictProm) {
      const targetUrl = `${(configuredPromUrl || 'http://localhost:9090').replace(/\/+$/, '')}/-/ready`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const resp = await fetch(targetUrl, { signal: controller.signal });
        if (!resp.ok) {
          checks.prometheus = 'error';
        }
      } catch (err: any) {
        checks.prometheus = 'error';
        logger.warn({
          component: 'health',
          operation: 'ready_check_prometheus',
          error: err?.message || 'Prometheus readiness check failed',
        });
      } finally {
        clearTimeout(timeout);
      }
    } else {
      try {
        await listPrometheusAgentTargets(9101);
        checks.prometheus = 'ok';
      } catch (err: any) {
        checks.prometheus = 'error';
        logger.error({
          component: 'health',
          operation: 'ready_check_prometheus_targets',
          error: err?.message || 'Prometheus target discovery failed',
        });
      }
    }

    const isReady = checks.database === 'ok' && checks.prometheus === 'ok';
    return res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ok' : 'error',
      checks,
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

  app.get('/api/servers/:id/logs/stream', requireAuth, async (req: AuthRequest, res) => {
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

      const rawSource = String(req.query.source || 'journald').trim().toLowerCase();
      if (!['journal', 'journald', 'auth', 'kernel', 'docker'].includes(rawSource)) {
        return res.status(400).json({ error: 'Invalid log source' });
      }
      const source = rawSource === 'journal' ? 'journald' : rawSource;

      const unit = typeof req.query.unit === 'string' ? req.query.unit.trim() : '';
      if (unit && !validateUnitIdentifier(unit)) {
        return res.status(400).json({ error: 'Invalid systemd unit name' });
      }

      const priority = typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
      if (priority && !validatePriorityFilter(priority)) {
        return res.status(400).json({ error: 'Invalid journal priority filter' });
      }

      const since = typeof req.query.since === 'string' ? req.query.since.trim() : '';
      if (since && !validateSinceFilter(since)) {
        return res.status(400).json({ error: 'Invalid since timestamp filter' });
      }

      const containerId =
        typeof req.query.container === 'string'
          ? req.query.container.trim()
          : typeof req.query.container_id === 'string'
            ? req.query.container_id.trim()
            : '';
      if (containerId && !validateContainerIdentifier(containerId)) {
        return res.status(400).json({ error: 'Invalid Docker container identifier' });
      }

      const tailCheck = validateTailFilter(req.query.tail);
      if (!tailCheck.valid) {
        return res.status(400).json({ error: 'Invalid tail filter value' });
      }
      const tail = tailCheck.value;

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const unsubscribe = logStreamHub.subscribeSseClient({
        server,
        source,
        unit,
        priority,
        since,
        containerId,
        tail,
        res,
      });

      req.on('close', unsubscribe);
      res.on('close', unsubscribe);
    } catch (error: any) {
      console.error('GET /api/servers/:id/logs/stream failed:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message || 'Failed to open log stream' });
      }
      res.end();
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
      logStreamHub.disconnectServerAgent(id, 'server_deleted');

      return res.status(204).send();
    } catch (error: any) {
      console.error('DELETE /api/servers/:id failed:', error);
      return res.status(500).json({ error: error.message || 'Failed to delete server' });
    }
  });

  // --- Linux Agent API Endpoints (mTLS + Transitional Bearer Enrollment) ---
  function extractClientCertificateFromRequest(req: express.Request): string | Buffer | null {
    const tlsSocket = req.socket as any;
    if (tlsSocket && tlsSocket.encrypted) {
      // Direct TLS socket: NEVER trust HTTP headers; only accept the peer certificate negotiated in the TLS handshake
      if (typeof tlsSocket.getPeerCertificate === 'function') {
        try {
          const peerCert = tlsSocket.getPeerCertificate(false);
          if (peerCert && Buffer.isBuffer(peerCert.raw) && peerCert.raw.length > 0) {
            return peerCert.raw;
          }
        } catch {
          return null;
        }
      }
      return null;
    }

    // Reverse-proxy mode (e.g. Traefik passTLSClientCert): only trust forwarded cert headers when allowed
    if (process.env.AGENT_TRUST_PROXY_CERT_HEADER === 'false') {
      return null;
    }
    const configuredProxySecret = (process.env.AGENT_PROXY_SECRET || '').trim();
    if (configuredProxySecret) {
      const providedSecret = String(req.headers['x-infralab-proxy-secret'] || '').trim();
      if (providedSecret !== configuredProxySecret) {
        return null;
      }
    }

    const rawHeader =
      String(
        req.headers['x-forwarded-tls-client-cert'] ||
          req.headers['x-ssl-client-cert'] ||
          req.headers['x-client-cert'] ||
          ''
      ).trim();

    if (!rawHeader) {
      return null;
    }

    let candidate = rawHeader;
    // Handle Envoy/Traefik XFCC format: Cert="-----BEGIN%20CERTIFICATE-----..."
    const certMatch = candidate.match(/(?:^|[,;\s])Cert="?([^";,]+)"?/i);
    if (certMatch) {
      candidate = certMatch[1];
    }

    try {
      if (candidate.includes('%')) {
        candidate = decodeURIComponent(candidate);
      }
    } catch {
      // Keep raw candidate if URI decoding fails
    }

    if (candidate.includes('-----BEGIN CERTIFICATE-----')) {
      return candidate;
    }

    // Base64-encoded DER or Base64-encoded PEM
    try {
      const decoded = Buffer.from(candidate.replace(/\s+/g, ''), 'base64');
      const asUtf8 = decoded.toString('utf8');
      if (asUtf8.includes('-----BEGIN CERTIFICATE-----')) {
        return asUtf8;
      }
      if (decoded.length > 64 && decoded[0] === 0x30) {
        return decoded;
      }
    } catch {
      // Invalid base64
    }

    return null;
  }

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

  async function authenticateAgentRequest(
    req: express.Request,
    options?: { requireMtls?: boolean }
  ): Promise<{
    id: number;
    serverId: number;
    agentId: string;
    authMode: 'mtls' | 'bearer';
  } | null> {
    const headerAgentId = String(req.headers['x-agent-id'] || '').trim();
    const bodyAgentId =
      typeof req.body?.agent_id === 'string' ? req.body.agent_id.trim() : '';
    const queryAgentId =
      typeof req.query?.agent_id === 'string' ? req.query.agent_id.trim() : '';

    // If both header and body/query agent_id are supplied, they must not conflict
    if (headerAgentId && bodyAgentId && headerAgentId !== bodyAgentId) {
      return null;
    }
    if (headerAgentId && queryAgentId && headerAgentId !== queryAgentId) {
      return null;
    }
    if (bodyAgentId && queryAgentId && bodyAgentId !== queryAgentId) {
      return null;
    }

    const clientCert = extractClientCertificateFromRequest(req);
    if (clientCert) {
      const verifiedMtls = await verifyAgentMtlsCertificate({
        clientCertPemOrDer: clientCert,
        headerAgentId: headerAgentId || undefined,
        claimedAgentIds: [headerAgentId, bodyAgentId, queryAgentId],
      });
      if (!verifiedMtls) {
        return null;
      }
      return {
        id: verifiedMtls.id,
        serverId: verifiedMtls.serverId,
        agentId: verifiedMtls.agentId,
        authMode: 'mtls',
      };
    }

    if (options?.requireMtls) {
      return null;
    }

    // Transitional Bearer fallback (for legacy agents not yet enrolled with mTLS)
    const { agentId, credential } = extractAgentCredentials(req);
    if (!agentId || !credential) {
      return null;
    }
    const verifiedBearer = await verifyAgentCredential(agentId, credential);
    if (!verifiedBearer) {
      return null;
    }
    return {
      ...verifiedBearer,
      authMode: 'bearer',
    };
  }

  app.get('/api/agents/ca.crt', (_req, res) => {
    try {
      const ca = getOrInitInfraLabCa();
      res.setHeader('Content-Type', 'application/x-pem-file; charset=utf-8');
      return res.status(200).send(ca.caCertPem);
    } catch (error: any) {
      return res.status(500).json({ error: 'Failed to load InfraLab Agent CA certificate' });
    }
  });

  app.post('/api/agents/enroll', async (req, res) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const hostname =
        typeof req.body?.hostname === 'string' ? req.body.hostname.trim() : '';
      const version =
        typeof req.body?.version === 'string' ? req.body.version.trim() : '0.2.0';
      const csrPem =
        typeof req.body?.csr_pem === 'string' ? req.body.csr_pem.trim() : '';

      if (!token) {
        return res.status(400).json({ error: 'Enrollment token is required' });
      }

      let enrolled;
      try {
        enrolled = await enrollAgentWithToken({
          token,
          hostname,
          version,
          csrPem: csrPem || undefined,
        });
      } catch (csrErr: any) {
        return res.status(400).json({
          error: csrErr?.message || 'Invalid certificate signing request (CSR)',
        });
      }

      if (!enrolled) {
        return res
          .status(401)
          .json({ error: 'Invalid or already consumed enrollment token' });
      }

      // Never log private keys, credentials, or enrollment tokens
      logger.info({
        component: 'agent',
        operation: 'enroll',
        server_id: enrolled.serverId,
        agent_id: enrolled.agentId,
        auth_mode: enrolled.authMode,
        cert_serial: enrolled.certSerial,
        hostname,
        version,
      });

      if (enrolled.authMode === 'mtls') {
        return res.status(200).json({
          agent_id: enrolled.agentId,
          server_id: enrolled.serverId,
          auth_mode: 'mtls',
          client_cert_pem: enrolled.clientCertPem,
          ca_cert_pem: enrolled.caCertPem,
          cert_serial: enrolled.certSerial,
          cert_fingerprint_sha256: enrolled.certFingerprintSha256,
          cert_san_uri: enrolled.certSanUri,
          cert_not_before: enrolled.certNotBefore,
          cert_not_after: enrolled.certNotAfter,
        });
      }

      return res.status(200).json({
        agent_id: enrolled.agentId,
        credential: enrolled.credential,
        server_id: enrolled.serverId,
        auth_mode: 'bearer',
      });
    } catch (error: any) {
      logger.error({
        component: 'agent',
        operation: 'enroll',
        error: error?.message || 'Internal error',
      });
      return res.status(500).json({ error: 'Failed to enroll agent' });
    }
  });

  app.post('/api/agents/renew', async (req, res) => {
    try {
      const verified = await authenticateAgentRequest(req, { requireMtls: true });
      if (!verified) {
        return res.status(401).json({
          error: 'Valid mTLS client certificate is required for renewal',
        });
      }

      const csrPem =
        typeof req.body?.csr_pem === 'string' ? req.body.csr_pem.trim() : '';
      if (!csrPem) {
        return res.status(400).json({ error: 'csr_pem is required for certificate renewal' });
      }

      let renewed;
      try {
        renewed = await renewAgentCertificate({
          agentId: verified.agentId,
          csrPem,
        });
      } catch (csrErr: any) {
        return res.status(400).json({
          error: csrErr?.message || 'Invalid certificate signing request (CSR)',
        });
      }

      if (!renewed) {
        return res.status(401).json({ error: 'Agent certificate cannot be renewed' });
      }

      logger.info({
        component: 'agent',
        operation: 'renew_cert',
        server_id: renewed.serverId,
        agent_id: renewed.agentId,
        cert_serial: renewed.certSerial,
      });

      return res.status(200).json({
        agent_id: renewed.agentId,
        server_id: renewed.serverId,
        auth_mode: 'mtls',
        client_cert_pem: renewed.clientCertPem,
        ca_cert_pem: renewed.caCertPem,
        cert_serial: renewed.certSerial,
        cert_fingerprint_sha256: renewed.certFingerprintSha256,
        cert_san_uri: renewed.certSanUri,
        cert_not_before: renewed.certNotBefore,
        cert_not_after: renewed.certNotAfter,
      });
    } catch (error: any) {
      logger.error({
        component: 'agent',
        operation: 'renew_cert',
        error: error?.message || 'Internal error',
      });
      return res.status(500).json({ error: 'Failed to renew agent certificate' });
    }
  });

  app.post('/api/agents/heartbeat', async (req, res) => {
    try {
      const verified = await authenticateAgentRequest(req);
      if (!verified) {
        return res.status(401).json({ error: 'Invalid or missing agent mTLS certificate or credential' });
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
        auth_mode: verified.authMode,
        last_seen_at: seenAt.toISOString(),
      });
    } catch (error: any) {
      logger.error({
        component: 'agent',
        operation: 'heartbeat',
        error: error?.message || 'Internal error',
      });
      return res.status(500).json({ error: 'Failed to process agent heartbeat' });
    }
  });

  app.post('/api/agents/system-info', async (req, res) => {
    try {
      const verified = await authenticateAgentRequest(req);
      if (!verified) {
        return res.status(401).json({ error: 'Invalid or missing agent mTLS certificate or credential' });
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
        auth_mode: verified.authMode,
        last_seen_at: seenAt.toISOString(),
      });
    } catch (error: any) {
      console.error('POST /api/agents/system-info failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to record agent system info' });
    }
  });

  app.get('/api/agents/logs/poll', async (req, res) => {
    try {
      const verified = await authenticateAgentRequest(req);
      if (!verified) {
        return res.status(401).json({ error: 'Invalid or missing agent mTLS certificate or credential' });
      }
      const commands = logStreamHub.pollAgentControlCommands({
        agentId: verified.agentId,
        serverId: verified.serverId,
        authMode: verified.authMode,
      });
      return res.status(200).json({
        agent_id: verified.agentId,
        server_id: verified.serverId,
        commands,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to poll agent log commands' });
    }
  });

  app.post('/api/agents/logs/events', async (req, res) => {
    try {
      const verified = await authenticateAgentRequest(req);
      if (!verified) {
        return res.status(401).json({ error: 'Invalid or missing agent mTLS certificate or credential' });
      }
      const streamId = typeof req.body?.stream_id === 'string' ? req.body.stream_id.trim() : '';
      const rawEvents = Array.isArray(req.body?.events)
        ? req.body.events
        : req.body?.event
          ? [req.body.event]
          : [];
      logStreamHub.ingestAgentEvents(verified.serverId, verified.agentId, streamId, rawEvents);
      return res.status(200).json({ status: 'ok', ingested: rawEvents.length });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to ingest agent log events' });
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

      let agentView = await getOrProvisionServerAgent(server.id);

      // In AI Studio preview environment, external VPS cannot push HTTP heartbeats through Google's auth cookie wall.
      // If the agent is enrolled and SSH is configured, verify the daemon over SSH and refresh heartbeat & telemetry.
      const lastSeenAgeMs = agentView.last_seen_at
        ? Date.now() - new Date(agentView.last_seen_at).getTime()
        : Infinity;

      const isPassiveQuery = req.query.passive === 'true';

      if (
        agentView.agent_id &&
        agentView.version !== 'stopped' &&
        !agentView.cert_revoked_at &&
        lastSeenAgeMs > 25000
      ) {
        let refreshedViaHttp = false;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1400);
          const metricsResp = await fetch(`http://${server.ipAddress}:9101/metrics`, {
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (metricsResp.ok) {
            const metricsText = await metricsResp.text();
            if (metricsText.includes('infralab_')) {
              const upMatch = metricsText.match(/infralab_uptime_seconds(?:\{[^}]*\})?\s+(\d+)/);
              const uptimeSec = upMatch ? Number(upMatch[1]) : undefined;
              await recordAgentHeartbeat({
                agentId: agentView.agent_id,
                version: agentView.version || '0.2.0',
                hostname: agentView.hostname || server.hostname,
                uptimeSeconds: uptimeSec,
              });
              agentView = await getOrProvisionServerAgent(server.id);
              refreshedViaHttp = true;
            }
          }
        } catch {
          // Fall back to SSH if direct HTTP :9101 is not reachable
        }

        if (!refreshedViaHttp && !isPassiveQuery && server.encryptedSecret) {
          try {
            const checkExec = await executeSshCommand({
              ipAddress: server.ipAddress,
              sshPort: server.sshPort,
              username: server.username,
              authType: server.authType === 'private_key' ? 'private_key' : 'password',
              encryptedSecret: server.encryptedSecret,
              command: [
                'if ! curl -fsS --max-time 2 http://127.0.0.1:9101/metrics >/dev/null 2>&1; then',
                '  if [ -x /usr/local/bin/infralab-agent ]; then',
                '    nohup /usr/local/bin/infralab-agent run >/var/log/infralab-agent.log 2>&1 &',
                '    sleep 1',
                '  fi',
                'fi',
                'if [ -x /usr/local/bin/infralab-agent ] || curl -fsS --max-time 2 http://127.0.0.1:9101/metrics >/dev/null 2>&1; then',
                '  H=$(hostname 2>/dev/null || echo linux-host)',
                '  OS=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s )',
                '  KERN=$(uname -r 2>/dev/null || echo Linux)',
                '  ARCH=$(uname -m 2>/dev/null || echo x86_64)',
                '  CPU=$(nproc 2>/dev/null || echo 1)',
                "  RAM=$(awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo 2>/dev/null || echo 0)",
                "  UP=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)",
                '  echo "INFRALAB_ALIVE|$H|$OS|$KERN|$ARCH|$CPU|$RAM|$UP"',
                'fi',
              ].join('\n'),
            });
            const aliveLine = (checkExec.stdout || '')
              .split('\n')
              .find((l) => l.startsWith('INFRALAB_ALIVE|'));
            if (aliveLine) {
              const parts = aliveLine.split('|');
              await recordAgentSystemInfo({
                agentId: agentView.agent_id,
                version: agentView.version || '0.2.0',
                hostname: parts[1] || server.hostname,
                osDistribution: parts[2] || server.osInfo || 'Linux',
                kernel: parts[3] || server.kernelInfo || 'Linux',
                architecture: parts[4] || 'x86_64',
                cpuCount: Number(parts[5]) || 1,
                ramTotalBytes: Number(parts[6]) || 0,
                uptimeSeconds: Number(parts[7]) || 0,
              });
              agentView = await getOrProvisionServerAgent(server.id);
            }
          } catch {
            // Ignore SSH check errors
          }
        }
      }

      return res.status(200).json(agentView);
    } catch (error: any) {
      console.error('GET /api/servers/:id/agent failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to load server agent status' });
    }
  });

  app.post('/api/servers/:id/agent/install-ssh', requireAuth, async (req: AuthRequest, res) => {
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

      if (!server.encryptedSecret) {
        return res.status(400).json({
          error: 'Сначала укажите пароль или SSH-ключ сервера в карточке выше',
        });
      }

      const serverOrigin =
        String(req.body?.server_url || process.env.APP_URL || 'https://infralab.local').replace(/\/+$/, '');

      // Step 1: Generate private key (0600) and CSR directly on the remote Agent host over SSH.
      // Only the public CSR is returned to the Backend; the private key never leaves the Agent host.
      const csrGenCmd = [
        'set -e',
        'SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi',
        '$SUDO mkdir -p /var/lib/infralab-agent',
        '$SUDO chmod 0700 /var/lib/infralab-agent',
        'umask 077',
        '$SUDO openssl ecparam -name prime256v1 -genkey -noout -out /var/lib/infralab-agent/agent.key.ec',
        '$SUDO openssl pkcs8 -topk8 -nocrypt -in /var/lib/infralab-agent/agent.key.ec -out /var/lib/infralab-agent/agent.key.tmp',
        '$SUDO rm -f /var/lib/infralab-agent/agent.key.ec',
        '$SUDO chmod 0600 /var/lib/infralab-agent/agent.key.tmp',
        '$SUDO mv /var/lib/infralab-agent/agent.key.tmp /var/lib/infralab-agent/agent.key',
        '$SUDO chmod 0600 /var/lib/infralab-agent/agent.key',
        'H=$(hostname 2>/dev/null || echo linux-host)',
        '$SUDO openssl req -new -sha256 -key /var/lib/infralab-agent/agent.key -subj "/O=InfraLab Agent/CN=$H" -out /var/lib/infralab-agent/agent.csr',
        'CSR_B64=$($SUDO base64 -w0 /var/lib/infralab-agent/agent.csr 2>/dev/null || $SUDO base64 /var/lib/infralab-agent/agent.csr | tr -d "\\n")',
        '$SUDO rm -f /var/lib/infralab-agent/agent.csr',
        'echo "INFRALAB_CSR_B64|$CSR_B64"',
      ].join('\n');

      const csrExec = await executeSshCommand({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType === 'private_key' ? 'private_key' : 'password',
        encryptedSecret: server.encryptedSecret,
        command: csrGenCmd,
      });

      if (csrExec.exitCode !== 0) {
        return res.status(502).json({
          error: `SSH генерация CSR завершилась с кодом ${csrExec.exitCode}: ${
            csrExec.stderr || csrExec.stdout || 'Unknown SSH error'
          }`,
        });
      }

      const csrLine = (csrExec.stdout || '')
        .split('\n')
        .find((l) => l.startsWith('INFRALAB_CSR_B64|'));
      const csrB64 = csrLine ? csrLine.slice('INFRALAB_CSR_B64|'.length).trim() : '';
      const remoteCsrPem = csrB64 ? Buffer.from(csrB64, 'base64').toString('utf8') : '';
      if (!remoteCsrPem.includes('BEGIN CERTIFICATE REQUEST')) {
        return res.status(502).json({
          error: 'Не удалось получить корректный PKCS#10 CSR от удалённого агента',
        });
      }

      // Step 2: Sign the Agent's CSR with InfraLab Root CA (no private key on Backend)
      const provisioned = await provisionAgentDirectlyForServer({
        serverId: server.id,
        hostname: server.hostname,
        version: '0.2.0',
        csrPem: remoteCsrPem,
      });

      const agentScriptB64 = Buffer.from(PORTABLE_AGENT_SCRIPT, 'utf8').toString('base64');
      const configJsonB64 = Buffer.from(
        JSON.stringify(
          {
            server_url: serverOrigin,
            heartbeat_interval_sec: 15,
            metrics_listen_addr: ':9101',
          },
          null,
          2
        ),
        'utf8'
      ).toString('base64');
      const credJsonB64 = Buffer.from(
        JSON.stringify(
          {
            server_url: serverOrigin,
            agent_id: provisioned.agentId,
            auth_mode: 'mtls',
            client_cert_path: '/var/lib/infralab-agent/agent.crt',
            client_key_path: '/var/lib/infralab-agent/agent.key',
            ca_cert_path: '/var/lib/infralab-agent/ca.crt',
            cert_serial: provisioned.certSerial,
            cert_fingerprint_sha256: provisioned.certFingerprintSha256,
            cert_not_after: provisioned.certNotAfter,
          },
          null,
          2
        ),
        'utf8'
      ).toString('base64');
      const clientCertB64 = Buffer.from(provisioned.clientCertPem, 'utf8').toString('base64');
      const caCertB64 = Buffer.from(provisioned.caCertPem, 'utf8').toString('base64');

      const systemdUnit = `[Unit]
Description=InfraLab Linux Telemetry & Prometheus Exporter Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/infralab-agent run --config /etc/infralab-agent/config.json --credentials /var/lib/infralab-agent/credentials.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
      const unitB64 = Buffer.from(systemdUnit, 'utf8').toString('base64');

      const installCmd = [
        'set -e',
        'SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi',
        '$SUDO mkdir -p /usr/local/bin /etc/infralab-agent /var/lib/infralab-agent',
        '$SUDO chmod 0700 /var/lib/infralab-agent',
        `echo '${agentScriptB64}' | base64 -d | $SUDO tee /usr/local/bin/infralab-agent >/dev/null`,
        '$SUDO chmod 0755 /usr/local/bin/infralab-agent',
        `echo '${configJsonB64}' | base64 -d | $SUDO tee /etc/infralab-agent/config.json >/dev/null`,
        `echo '${caCertB64}' | base64 -d | $SUDO tee /var/lib/infralab-agent/ca.crt.tmp >/dev/null`,
        '$SUDO chmod 0644 /var/lib/infralab-agent/ca.crt.tmp',
        '$SUDO mv /var/lib/infralab-agent/ca.crt.tmp /var/lib/infralab-agent/ca.crt',
        `echo '${clientCertB64}' | base64 -d | $SUDO tee /var/lib/infralab-agent/agent.crt.tmp >/dev/null`,
        '$SUDO chmod 0600 /var/lib/infralab-agent/agent.crt.tmp',
        '$SUDO mv /var/lib/infralab-agent/agent.crt.tmp /var/lib/infralab-agent/agent.crt',
        '$SUDO chmod 0600 /var/lib/infralab-agent/agent.key',
        `echo '${credJsonB64}' | base64 -d | $SUDO tee /var/lib/infralab-agent/credentials.json.tmp >/dev/null`,
        '$SUDO chmod 0600 /var/lib/infralab-agent/credentials.json.tmp',
        '$SUDO mv /var/lib/infralab-agent/credentials.json.tmp /var/lib/infralab-agent/credentials.json',
        'if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then',
        `  echo '${unitB64}' | base64 -d | $SUDO tee /etc/systemd/system/infralab-agent.service >/dev/null`,
        '  $SUDO systemctl daemon-reload',
        '  $SUDO systemctl enable infralab-agent >/dev/null 2>&1 || true',
        '  $SUDO systemctl restart infralab-agent',
        'else',
        '  $SUDO pkill -f "/usr/local/bin/infralab-agent run" >/dev/null 2>&1 || true',
        '  nohup $SUDO /usr/local/bin/infralab-agent run >/var/log/infralab-agent.log 2>&1 &',
        'fi',
        'H=$(hostname 2>/dev/null || echo linux-host)',
        'OS=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -s )',
        'KERN=$(uname -r 2>/dev/null || echo Linux)',
        'ARCH=$(uname -m 2>/dev/null || echo x86_64)',
        'CPU=$(nproc 2>/dev/null || echo 1)',
        "RAM=$(awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo 2>/dev/null || echo 0)",
        "UP=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)",
        'echo "INFRALAB_SYSINFO|$H|$OS|$KERN|$ARCH|$CPU|$RAM|$UP"',
      ].join('\n');

      const sshResult = await executeSshCommand({
        ipAddress: server.ipAddress,
        sshPort: server.sshPort,
        username: server.username,
        authType: server.authType === 'private_key' ? 'private_key' : 'password',
        encryptedSecret: server.encryptedSecret,
        command: installCmd,
      });

      if (sshResult.exitCode !== 0) {
        return res.status(502).json({
          error: `SSH установка завершилась с кодом ${sshResult.exitCode}: ${
            sshResult.stderr || sshResult.stdout || 'Unknown SSH error'
          }`,
        });
      }

      const infoLine = sshResult.stdout
        .split('\n')
        .find((l) => l.startsWith('INFRALAB_SYSINFO|'));

      if (infoLine) {
        const parts = infoLine.split('|');
        await recordAgentSystemInfo({
          agentId: provisioned.agentId,
          version: '0.2.0',
          hostname: parts[1] || server.hostname,
          osDistribution: parts[2] || server.osInfo || 'Linux',
          kernel: parts[3] || server.kernelInfo || 'Linux',
          architecture: parts[4] || 'x86_64',
          cpuCount: Number(parts[5]) || 1,
          ramTotalBytes: Number(parts[6]) || 0,
          uptimeSeconds: Number(parts[7]) || 0,
        });
      } else {
        await recordAgentHeartbeat({
          agentId: provisioned.agentId,
          version: '0.2.0',
          hostname: server.hostname,
        });
      }

      const updatedView = await getOrProvisionServerAgent(server.id);
      return res.status(200).json(updatedView);
    } catch (error: any) {
      console.error('POST /api/servers/:id/agent/install-ssh failed:', error);
      return res.status(500).json({
        error: error?.message || 'Failed to install agent via SSH',
      });
    }
  });

  app.post('/api/servers/:id/agent/stop', requireAuth, async (req: AuthRequest, res) => {
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

      if (server.encryptedSecret) {
        try {
          const stopCmd = [
            'SUDO=""; if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi',
            'if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then',
            '  $SUDO systemctl stop infralab-agent >/dev/null 2>&1 || true',
            '  $SUDO systemctl disable infralab-agent >/dev/null 2>&1 || true',
            'fi',
            '$SUDO pkill -f "/usr/local/bin/infralab-agent" >/dev/null 2>&1 || true',
          ].join('\n');

          await executeSshCommand({
            ipAddress: server.ipAddress,
            sshPort: server.sshPort,
            username: server.username,
            authType: server.authType === 'private_key' ? 'private_key' : 'password',
            encryptedSecret: server.encryptedSecret,
            command: stopCmd,
          });
        } catch {
          // Even if SSH stop fails or server is unreachable, disable polling in DB
        }
      }

      clearServerPrometheusCache(server.id);
      logStreamHub.disconnectServerAgent(server.id, 'agent_stopped');
      const stoppedView = await stopServerAgent(server.id);
      return res.status(200).json(stoppedView);
    } catch (error: any) {
      console.error('POST /api/servers/:id/agent/stop failed:', error);
      return res.status(500).json({
        error: error?.message || 'Failed to stop agent on server',
      });
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

  app.post('/api/servers/:id/agent/revoke', requireAuth, async (req: AuthRequest, res) => {
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

      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim()
          : 'revoked_by_operator';

      clearServerPrometheusCache(server.id);
      logStreamHub.disconnectServerAgent(server.id, reason);
      const revokedView = await revokeServerAgentCertificate(server.id, reason);
      logger.info({
        component: 'agent',
        operation: 'revoke_cert',
        server_id: server.id,
        agent_id: revokedView.agent_id,
      });
      return res.status(200).json(revokedView);
    } catch (error: any) {
      console.error('POST /api/servers/:id/agent/revoke failed:', error?.message || 'Internal error');
      return res.status(500).json({ error: 'Failed to revoke agent certificate' });
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

  // --- SFTP File Manager Endpoints (Browse, Read, Download, Edit, Upload, Mkdir, Delete) ---
  app.get('/api/servers/:id/sftp/list', requireAuth, async (req: AuthRequest, res) => {
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
      if (!server.encryptedSecret) {
        return res.status(400).json({
          error: 'Для работы SFTP необходимо настроить пароль или SSH-ключ сервера',
        });
      }

      const targetPath = typeof req.query.path === 'string' ? req.query.path : '/etc';
      const result = await listRemoteDirectoryOverSsh(
        {
          serverId: server.id,
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType === 'private_key' ? 'private_key' : 'password',
          encryptedSecret: server.encryptedSecret,
        },
        targetPath
      );

      return res.status(200).json(result);
    } catch (error: any) {
      console.error('GET /api/servers/:id/sftp/list failed:', error?.message || 'Error');
      return res.status(500).json({
        error: error?.message || 'Не удалось получить список файлов по SFTP/SSH',
      });
    }
  });

  app.get('/api/servers/:id/sftp/read', requireAuth, async (req: AuthRequest, res) => {
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
      if (!server.encryptedSecret) {
        return res.status(400).json({
          error: 'Для чтения файлов необходимо настроить пароль или SSH-ключ сервера',
        });
      }

      const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }
      const useSudo = req.query.sudo === 'true';

      const result = await readRemoteFileOverSsh(
        {
          serverId: server.id,
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType === 'private_key' ? 'private_key' : 'password',
          encryptedSecret: server.encryptedSecret,
        },
        filePath,
        useSudo
      );

      return res.status(200).json(result);
    } catch (error: any) {
      console.error('GET /api/servers/:id/sftp/read failed:', error?.message || 'Error');
      return res.status(500).json({
        error: error?.message || 'Не удалось прочитать файл с сервера',
      });
    }
  });

  app.post('/api/servers/:id/sftp/write', requireAuth, async (req: AuthRequest, res) => {
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
      if (!server.encryptedSecret) {
        return res.status(400).json({
          error: 'Для записи файлов необходимо настроить пароль или SSH-ключ сервера',
        });
      }

      const filePath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const encoding = req.body?.encoding === 'base64' ? 'base64' : 'utf8';
      const useSudo = Boolean(req.body?.use_sudo);

      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }

      const result = await writeRemoteFileOverSsh(
        {
          serverId: server.id,
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType === 'private_key' ? 'private_key' : 'password',
          encryptedSecret: server.encryptedSecret,
        },
        {
          path: filePath,
          content,
          encoding,
          useSudo,
        }
      );

      return res.status(200).json(result);
    } catch (error: any) {
      console.error('POST /api/servers/:id/sftp/write failed:', error?.message || 'Error');
      return res.status(500).json({
        error: error?.message || 'Не удалось сохранить файл на сервер',
      });
    }
  });

  app.post('/api/servers/:id/sftp/mkdir', requireAuth, async (req: AuthRequest, res) => {
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
      if (!server.encryptedSecret) {
        return res.status(400).json({
          error: 'Для создания папок необходимо настроить пароль или SSH-ключ сервера',
        });
      }

      const dirPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
      const useSudo = Boolean(req.body?.use_sudo);
      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }

      const result = await createRemoteDirectoryOverSsh(
        {
          serverId: server.id,
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType === 'private_key' ? 'private_key' : 'password',
          encryptedSecret: server.encryptedSecret,
        },
        dirPath,
        useSudo
      );

      return res.status(200).json(result);
    } catch (error: any) {
      console.error('POST /api/servers/:id/sftp/mkdir failed:', error?.message || 'Error');
      return res.status(500).json({
        error: error?.message || 'Не удалось создать директорию на сервере',
      });
    }
  });

  app.delete('/api/servers/:id/sftp/delete', requireAuth, async (req: AuthRequest, res) => {
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
      if (!server.encryptedSecret) {
        return res.status(400).json({
          error: 'Для удаления файлов необходимо настроить пароль или SSH-ключ сервера',
        });
      }

      const targetPath =
        typeof req.body?.path === 'string'
          ? req.body.path.trim()
          : typeof req.query.path === 'string'
            ? req.query.path.trim()
            : '';
      const useSudo = Boolean(req.body?.use_sudo || req.query.sudo === 'true');
      if (!targetPath) {
        return res.status(400).json({ error: 'Target path is required' });
      }

      const result = await deleteRemotePathOverSsh(
        {
          serverId: server.id,
          ipAddress: server.ipAddress,
          sshPort: server.sshPort,
          username: server.username,
          authType: server.authType === 'private_key' ? 'private_key' : 'password',
          encryptedSecret: server.encryptedSecret,
        },
        targetPath,
        useSudo
      );

      return res.status(200).json(result);
    } catch (error: any) {
      console.error('DELETE /api/servers/:id/sftp/delete failed:', error?.message || 'Error');
      return res.status(500).json({
        error: error?.message || 'Не удалось удалить объект на сервере',
      });
    }
  });

  // ============================================================================
  // Ansible Automation Module Endpoints (Runtime, Inventories, Playbooks, Jobs, SSE, Audit)
  // ============================================================================

  app.get('/api/automation/status', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const status = await checkAnsibleRuntime();
      return res.status(200).json(status);
    } catch (error: any) {
      return res.status(500).json({
        available: false,
        error: error?.message || 'Ansible is not installed or unavailable',
      });
    }
  });

  // --- Ansible Inventories ---
  app.get('/api/automation/inventories', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const inventories = await listInventoriesByUser(uid);
      return res.status(200).json(inventories);
    } catch (error: any) {
      console.error('GET /api/automation/inventories failed:', error);
      return res.status(500).json({ error: 'Failed to load Ansible inventories' });
    }
  });

  app.get('/api/automation/inventories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid inventory ID' });
      }
      const inv = await getInventoryById(id, uid);
      if (!inv) {
        return res.status(404).json({ error: 'Inventory not found' });
      }
      return res.status(200).json(inv);
    } catch (error: any) {
      console.error('GET /api/automation/inventories/:id failed:', error);
      return res.status(500).json({ error: 'Failed to load inventory details' });
    }
  });

  app.post('/api/automation/inventories', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      const groupName =
        typeof req.body?.group_name === 'string' ? req.body.group_name.trim() : 'all';
      const serverIds = Array.isArray(req.body?.server_ids)
        ? req.body.server_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
        : [];

      if (!name || name.length > 120) {
        return res.status(400).json({ error: 'Inventory name is required (1–120 chars)' });
      }
      if (groupName && !/^[a-zA-Z0-9_.-]{1,64}$/.test(groupName)) {
        return res.status(400).json({ error: 'Invalid inventory group name' });
      }

      const created = await createInventoryRecord({
        userUid: uid,
        name,
        description,
        groupName: groupName || 'all',
        serverIds,
      });
      return res.status(201).json(created);
    } catch (error: any) {
      console.error('POST /api/automation/inventories failed:', error);
      return res.status(500).json({ error: 'Failed to create Ansible inventory' });
    }
  });

  app.put('/api/automation/inventories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid inventory ID' });
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : undefined;
      const groupName =
        typeof req.body?.group_name === 'string' ? req.body.group_name.trim() : undefined;
      const serverIds = Array.isArray(req.body?.server_ids)
        ? req.body.server_ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
        : undefined;

      if (name !== undefined && (!name || name.length > 120)) {
        return res.status(400).json({ error: 'Inventory name must be 1–120 characters' });
      }
      if (groupName !== undefined && groupName && !/^[a-zA-Z0-9_.-]{1,64}$/.test(groupName)) {
        return res.status(400).json({ error: 'Invalid inventory group name' });
      }

      const updated = await updateInventoryRecord({
        id,
        userUid: uid,
        name,
        description,
        groupName,
        serverIds,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Inventory not found' });
      }
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error('PUT /api/automation/inventories/:id failed:', error);
      return res.status(500).json({ error: 'Failed to update Ansible inventory' });
    }
  });

  app.post('/api/automation/inventories/:id/servers', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      const serverId = Number(req.body?.server_id);
      const groupName =
        typeof req.body?.group_name === 'string' ? req.body.group_name.trim() : undefined;

      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(serverId) || serverId <= 0) {
        return res.status(400).json({ error: 'Valid inventory ID and server_id are required' });
      }

      const updated = await addServerToInventory({
        inventoryId: id,
        serverId,
        groupName,
        userUid: uid,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Inventory or server not found' });
      }
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error('POST /api/automation/inventories/:id/servers failed:', error);
      return res.status(500).json({ error: 'Failed to add server to inventory' });
    }
  });

  app.delete(
    '/api/automation/inventories/:id/servers/:serverId',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const uid = req.user!.uid;
        const id = Number(req.params.id);
        const serverId = Number(req.params.serverId);
        if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(serverId) || serverId <= 0) {
          return res.status(400).json({ error: 'Invalid inventory or server ID' });
        }

        const updated = await removeServerFromInventory({
          inventoryId: id,
          serverId,
          userUid: uid,
        });
        if (!updated) {
          return res.status(404).json({ error: 'Inventory not found' });
        }
        return res.status(200).json(updated);
      } catch (error: any) {
        console.error('DELETE /api/automation/inventories/:id/servers/:serverId failed:', error);
        return res.status(500).json({ error: 'Failed to remove server from inventory' });
      }
    }
  );

  app.delete('/api/automation/inventories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid inventory ID' });
      }
      const deleted = await deleteInventoryById(id, uid);
      if (!deleted) {
        return res.status(404).json({ error: 'Inventory not found' });
      }
      return res.status(200).json({ id, deleted: true });
    } catch (error: any) {
      console.error('DELETE /api/automation/inventories/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete inventory' });
    }
  });

  // --- Ansible Playbooks ---
  app.get('/api/automation/playbooks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      await ensureStarterPlaybooksForUser(uid);
      const playbooks = await listPlaybooksByUser(uid);
      return res.status(200).json(playbooks);
    } catch (error: any) {
      console.error('GET /api/automation/playbooks failed:', error);
      return res.status(500).json({ error: 'Failed to load Ansible playbooks' });
    }
  });

  app.get('/api/automation/playbooks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid playbook ID' });
      }
      const playbook = await getPlaybookById(id, uid);
      if (!playbook) {
        return res.status(404).json({ error: 'Playbook not found' });
      }
      return res.status(200).json(playbook);
    } catch (error: any) {
      console.error('GET /api/automation/playbooks/:id failed:', error);
      return res.status(500).json({ error: 'Failed to load playbook' });
    }
  });

  app.post('/api/automation/playbooks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';

      if (!name || name.length > 140) {
        return res.status(400).json({ error: 'Playbook name is required (1–140 chars)' });
      }

      const staticCheck = validatePlaybookStaticSecurity(content);
      if (!staticCheck.ok) {
        return res.status(400).json({ error: staticCheck.error });
      }

      const created = await createPlaybookRecord({
        userUid: uid,
        name,
        description,
        content,
        validationStatus: 'unverified',
        validationMessage: '',
      });

      return res.status(201).json(created);
    } catch (error: any) {
      console.error('POST /api/automation/playbooks failed:', error);
      return res.status(500).json({ error: 'Failed to create playbook' });
    }
  });

  app.put('/api/automation/playbooks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid playbook ID' });
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : undefined;
      const content = typeof req.body?.content === 'string' ? req.body.content : undefined;

      if (name !== undefined && (!name || name.length > 140)) {
        return res.status(400).json({ error: 'Playbook name must be 1–140 chars' });
      }

      if (content !== undefined) {
        const staticCheck = validatePlaybookStaticSecurity(content);
        if (!staticCheck.ok) {
          return res.status(400).json({ error: staticCheck.error });
        }
      }

      const updated = await updatePlaybookRecord({
        id,
        userUid: uid,
        name,
        description,
        content,
        validationStatus: content !== undefined ? 'unverified' : undefined,
        validationMessage: content !== undefined ? '' : undefined,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Playbook not found' });
      }
      return res.status(200).json(updated);
    } catch (error: any) {
      console.error('PUT /api/automation/playbooks/:id failed:', error);
      return res.status(500).json({ error: 'Failed to update playbook' });
    }
  });

  app.delete('/api/automation/playbooks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid playbook ID' });
      }
      const deleted = await deletePlaybookById(id, uid);
      if (!deleted) {
        return res.status(404).json({ error: 'Playbook not found' });
      }
      return res.status(200).json({ id, deleted: true });
    } catch (error: any) {
      console.error('DELETE /api/automation/playbooks/:id failed:', error);
      return res.status(500).json({ error: 'Failed to delete playbook' });
    }
  });

  app.post('/api/automation/playbooks/:id/validate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid playbook ID' });
      }

      const result = await validateAndSavePlaybookById(id, uid);
      if (!result) {
        return res.status(404).json({ error: 'Playbook not found' });
      }
      return res.status(200).json(result);
    } catch (error: any) {
      const msg = error?.message || 'Ansible is not installed or unavailable';
      if (msg.includes('Ansible is not installed or unavailable')) {
        return res.status(503).json({ error: 'Ansible is not installed or unavailable' });
      }
      return res.status(500).json({ error: msg });
    }
  });

  app.post(
    '/api/automation/playbooks/validate-content',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const content = typeof req.body?.content === 'string' ? req.body.content : '';
        const validation = await validatePlaybookWithAnsibleCli(content);
        return res.status(200).json(validation);
      } catch (error: any) {
        const msg = error?.message || 'Ansible is not installed or unavailable';
        if (msg.includes('Ansible is not installed or unavailable')) {
          return res.status(503).json({ error: 'Ansible is not installed or unavailable' });
        }
        return res.status(500).json({ error: msg });
      }
    }
  );

  // --- Ansible Jobs & Live Execution ---
  app.get('/api/automation/jobs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const playbookId = req.query.playbook_id ? Number(req.query.playbook_id) : undefined;
      const inventoryId = req.query.inventory_id ? Number(req.query.inventory_id) : undefined;
      const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : undefined;
      const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : undefined;

      const jobs = await listAnsibleJobsByUser(uid, {
        status,
        playbookId,
        inventoryId,
        dateFrom,
        dateTo,
      });
      return res.status(200).json(jobs);
    } catch (error: any) {
      console.error('GET /api/automation/jobs failed:', error);
      return res.status(500).json({ error: 'Failed to load Ansible job history' });
    }
  });

  app.get('/api/automation/jobs/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      const job = await getAnsibleJobById(id, uid);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const active = ansibleJobManager.getActiveJob(id);
      if (active) {
        return res.status(200).json({
          ...job,
          status: active.status,
          stdout: active.stdout || job.stdout,
          stderr: active.stderr || job.stderr,
        });
      }

      return res.status(200).json(job);
    } catch (error: any) {
      console.error('GET /api/automation/jobs/:id failed:', error);
      return res.status(500).json({ error: 'Failed to load job details' });
    }
  });

  app.post('/api/automation/jobs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const playbookId = Number(req.body?.playbook_id);
      const inventoryId = Number(req.body?.inventory_id);
      const checkMode = Boolean(req.body?.check_mode);
      const diffMode = Boolean(req.body?.diff_mode);
      const tags = req.body?.tags;
      const extraVars = req.body?.extra_vars;

      if (!Number.isInteger(playbookId) || playbookId <= 0) {
        return res.status(400).json({ error: 'Valid playbook_id is required' });
      }
      if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
        return res.status(400).json({ error: 'Valid inventory_id is required' });
      }

      const job = await ansibleJobManager.startJob({
        userUid: uid,
        playbookId,
        inventoryId,
        checkMode,
        diffMode,
        tags,
        extraVars,
      });

      return res.status(201).json(job);
    } catch (error: any) {
      const msg = error?.message || 'Failed to start Ansible job';
      if (msg.includes('Ansible is not installed or unavailable')) {
        return res.status(503).json({ error: 'Ansible is not installed or unavailable' });
      }
      if (msg.includes('not found')) {
        return res.status(404).json({ error: msg });
      }
      return res.status(400).json({ error: msg });
    }
  });

  app.post('/api/automation/jobs/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      const job = await getAnsibleJobById(id, uid);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const cancelled = ansibleJobManager.cancelJob(id);
      return res.status(200).json({
        id,
        cancelled,
        status: cancelled ? 'CANCELLED' : job.status,
      });
    } catch (error: any) {
      console.error('POST /api/automation/jobs/:id/cancel failed:', error);
      return res.status(500).json({ error: 'Failed to cancel Ansible job' });
    }
  });

  app.get('/api/automation/jobs/:id/stream', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid job ID' });
      }

      const job = await getAnsibleJobById(id, uid);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const active = ansibleJobManager.getActiveJob(id);
      const initialStatus = active ? active.status : job.status;
      const initialStdout = active ? active.stdout : job.stdout;
      const initialStderr = active ? active.stderr : job.stderr;

      res.write(
        `event: snapshot\ndata: ${JSON.stringify({
          id: job.id,
          status: initialStatus,
          stdout: initialStdout,
          stderr: initialStderr,
          exit_code: job.exit_code,
          duration_ms: job.duration_ms,
        })}\n\n`
      );

      if (!active || ['SUCCESS', 'FAILED', 'CANCELLED'].includes(initialStatus)) {
        res.write(
          `event: done\ndata: ${JSON.stringify({
            status: initialStatus,
            exit_code: job.exit_code,
            duration_ms: job.duration_ms,
          })}\n\n`
        );
        return res.end();
      }

      const onStatus = (payload: any) => {
        res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      const onOutput = (payload: any) => {
        res.write(`event: output\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      const onDone = (payload: any) => {
        res.write(`event: done\ndata: ${JSON.stringify(payload)}\n\n`);
        cleanup();
        res.end();
      };

      const keepAliveTimer = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          cleanup();
        }
      }, 15000);

      const cleanup = () => {
        clearInterval(keepAliveTimer);
        active.emitter.off('status', onStatus);
        active.emitter.off('output', onOutput);
        active.emitter.off('done', onDone);
      };

      active.emitter.on('status', onStatus);
      active.emitter.on('output', onOutput);
      active.emitter.on('done', onDone);

      req.on('close', () => {
        cleanup();
      });
    } catch (error: any) {
      console.error('GET /api/automation/jobs/:id/stream failed:', error);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Failed to stream job output' });
      }
      res.end();
    }
  });

  // --- Automation Audit Logs ---
  app.get('/api/automation/audit-logs', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const logs = await listAutomationAuditLogsByUser(uid, 50);
      return res.status(200).json(logs);
    } catch (error: any) {
      console.error('GET /api/automation/audit-logs failed:', error);
      return res.status(500).json({ error: 'Failed to load automation audit logs' });
    }
  });

  // --- Agent Binary & Systemd Unit Download Endpoints (for self-hosted Docker deployment & preview) ---
  app.get('/downloads/infralab-agent', (_req, res) => {
    const binPath = path.join(process.cwd(), 'bin', 'infralab-agent');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="infralab-agent"');
    if (fs.existsSync(binPath)) {
      return res.sendFile(binPath);
    }
    return res.status(200).send(PORTABLE_AGENT_SCRIPT);
  });

  app.get('/downloads/infralab-agent.service', (_req, res) => {
    const unitPath = path.join(process.cwd(), 'infralab-agent.service');
    if (!fs.existsSync(unitPath)) {
      return res.status(404).send('infralab-agent.service not found');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.sendFile(unitPath);
  });

  app.get('/downloads/infralab-qa-report.md', (_req, res) => {
    const reportPath = path.join(process.cwd(), 'docs', 'final-qa-report.md');
    if (!fs.existsSync(reportPath)) {
      return res.status(404).send('QA report not found');
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="infralab-qa-report.md"'
    );
    return res.sendFile(reportPath);
  });

  return app;
}

async function startServer() {
  await ensureDatabaseSchema();
  const app = createApp();
  const httpServer = http.createServer(app);
  attachTerminalWebSocketServer(httpServer);
  attachAgentLogStreamWebSocketServer(httpServer);

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

const isTestRunner =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.includes('--test') ||
  process.execArgv.includes('--test');

if (!isTestRunner) {
  startServer();
}
