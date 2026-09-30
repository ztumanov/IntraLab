import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { agents, servers } from './schema.ts';
import { decryptSecret, encryptSecret } from '../server/sshConnector.ts';

export type AgentStatusState = 'ONLINE' | 'OFFLINE' | 'NOT INSTALLED';

export interface ServerAgentView {
  server_id: number;
  status: AgentStatusState;
  agent_id: string;
  version: string;
  hostname: string;
  os_distribution: string;
  kernel: string;
  architecture: string;
  cpu_count: number;
  ram_total_bytes: number;
  uptime_seconds: number;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  enrollment_token?: string;
}

const HEARTBEAT_ONLINE_WINDOW_MS = 45 * 1000; // 45s (3x 15s heartbeat interval)

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function generateEnrollmentToken(): string {
  return `ila_enroll_${crypto.randomBytes(24).toString('hex')}`;
}

export function generateAgentId(): string {
  return `agt_${crypto.randomBytes(12).toString('hex')}`;
}

export function generateAgentCredential(): string {
  return `ila_cred_${crypto.randomBytes(32).toString('hex')}`;
}

export function computeAgentStatus(
  agentId: string,
  lastSeenAt: Date | null
): AgentStatusState {
  if (!agentId || agentId.trim() === '') {
    return 'NOT INSTALLED';
  }
  if (!lastSeenAt) {
    return 'OFFLINE';
  }
  const ageMs = Date.now() - lastSeenAt.getTime();
  return ageMs <= HEARTBEAT_ONLINE_WINDOW_MS ? 'ONLINE' : 'OFFLINE';
}

export async function getOrProvisionServerAgent(serverId: number): Promise<ServerAgentView> {
  const existingRows = await db
    .select()
    .from(agents)
    .where(eq(agents.serverId, serverId));

  let row = existingRows[0];

  if (!row) {
    const token = generateEnrollmentToken();
    const inserted = await db
      .insert(agents)
      .values({
        serverId,
        agentId: '',
        version: '',
        hostname: '',
        enrollmentTokenHash: sha256Hex(token),
        enrollmentTokenEncrypted: encryptSecret(token),
        credentialHash: '',
      })
      .returning();
    row = inserted[0];
  } else if (!row.agentId && !row.enrollmentTokenHash) {
    const token = generateEnrollmentToken();
    const updated = await db
      .update(agents)
      .set({
        enrollmentTokenHash: sha256Hex(token),
        enrollmentTokenEncrypted: encryptSecret(token),
        updatedAt: new Date(),
      })
      .where(eq(agents.id, row.id))
      .returning();
    row = updated[0];
  }

  const status = computeAgentStatus(row.agentId, row.lastSeenAt);
  const view: ServerAgentView = {
    server_id: row.serverId,
    status,
    agent_id: row.agentId,
    version: row.version,
    hostname: row.hostname,
    os_distribution: row.osDistribution,
    kernel: row.kernel,
    architecture: row.architecture,
    cpu_count: row.cpuCount,
    ram_total_bytes: Number(row.ramTotalBytes || '0'),
    uptime_seconds: row.uptimeSeconds,
    last_seen_at: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    created_at: row.createdAt ? row.createdAt.toISOString() : null,
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
  };

  if (status === 'NOT INSTALLED' && row.enrollmentTokenEncrypted) {
    const plainToken = decryptSecret(row.enrollmentTokenEncrypted);
    if (plainToken) {
      view.enrollment_token = plainToken;
    }
  }

  return view;
}

export async function rotateServerEnrollmentToken(serverId: number): Promise<ServerAgentView> {
  const token = generateEnrollmentToken();
  const existingRows = await db
    .select()
    .from(agents)
    .where(eq(agents.serverId, serverId));

  if (existingRows.length === 0) {
    await db.insert(agents).values({
      serverId,
      agentId: '',
      version: '',
      hostname: '',
      enrollmentTokenHash: sha256Hex(token),
      enrollmentTokenEncrypted: encryptSecret(token),
      credentialHash: '',
    });
  } else {
    await db
      .update(agents)
      .set({
        agentId: '',
        version: '',
        enrollmentTokenHash: sha256Hex(token),
        enrollmentTokenEncrypted: encryptSecret(token),
        credentialHash: '',
        lastSeenAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.serverId, serverId));
  }

  return getOrProvisionServerAgent(serverId);
}

export async function enrollAgentWithToken(params: {
  token: string;
  hostname: string;
  version: string;
}): Promise<{
  agentId: string;
  credential: string;
  serverId: number;
} | null> {
  const cleanToken = (params.token || '').trim();
  if (!cleanToken) return null;

  const tokenHash = sha256Hex(cleanToken);
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.enrollmentTokenHash, tokenHash));

  const row = rows[0];
  if (!row || !row.enrollmentTokenHash) {
    return null;
  }

  const newAgentId = generateAgentId();
  const plainCredential = generateAgentCredential();
  const credHash = sha256Hex(plainCredential);
  const now = new Date();

  await db
    .update(agents)
    .set({
      agentId: newAgentId,
      version: (params.version || '0.2.0').trim(),
      hostname: (params.hostname || '').trim(),
      // One-time token is invalidated immediately upon enrollment
      enrollmentTokenHash: '',
      enrollmentTokenEncrypted: '',
      credentialHash: credHash,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(agents.id, row.id));

  await db
    .update(servers)
    .set({
      status: 'online',
      lastCheckError: '',
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(servers.id, row.serverId));

  return {
    agentId: newAgentId,
    credential: plainCredential,
    serverId: row.serverId,
  };
}

export async function provisionAgentDirectlyForServer(params: {
  serverId: number;
  hostname: string;
  version?: string;
}): Promise<{
  agentId: string;
  credential: string;
}> {
  const newAgentId = generateAgentId();
  const plainCredential = generateAgentCredential();
  const credHash = sha256Hex(plainCredential);
  const now = new Date();
  const version = (params.version || '0.2.0').trim();
  const hostname = (params.hostname || '').trim();

  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.serverId, params.serverId));

  if (existing.length === 0) {
    await db.insert(agents).values({
      serverId: params.serverId,
      agentId: newAgentId,
      version,
      hostname,
      enrollmentTokenHash: '',
      enrollmentTokenEncrypted: '',
      credentialHash: credHash,
      lastSeenAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(agents)
      .set({
        agentId: newAgentId,
        version,
        hostname,
        enrollmentTokenHash: '',
        enrollmentTokenEncrypted: '',
        credentialHash: credHash,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(agents.serverId, params.serverId));
  }

  return {
    agentId: newAgentId,
    credential: plainCredential,
  };
}

export async function verifyAgentCredential(
  agentId: string,
  credential: string
): Promise<{ id: number; serverId: number; agentId: string } | null> {
  const cleanAgentId = (agentId || '').trim();
  const cleanCred = (credential || '').trim();
  if (!cleanAgentId || !cleanCred) return null;

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.agentId, cleanAgentId));

  const row = rows[0];
  if (!row || !row.credentialHash) return null;

  const providedHash = sha256Hex(cleanCred);
  const a = Buffer.from(providedHash, 'utf8');
  const b = Buffer.from(row.credentialHash, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  return {
    id: row.id,
    serverId: row.serverId,
    agentId: row.agentId,
  };
}

export async function recordAgentHeartbeat(params: {
  agentId: string;
  version?: string;
  hostname?: string;
}): Promise<Date> {
  const now = new Date();
  const updateSet: Record<string, any> = {
    lastSeenAt: now,
    updatedAt: now,
  };
  if (params.version && params.version.trim()) {
    updateSet.version = params.version.trim();
  }
  if (params.hostname && params.hostname.trim()) {
    updateSet.hostname = params.hostname.trim();
  }

  const updated = await db
    .update(agents)
    .set(updateSet)
    .where(eq(agents.agentId, params.agentId))
    .returning();

  if (updated[0]) {
    await db
      .update(servers)
      .set({
        status: 'online',
        lastCheckError: '',
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(servers.id, updated[0].serverId));
  }

  return now;
}

function formatUptimeSeconds(sec: number): string {
  if (!sec || sec <= 0) return 'up < 1m';
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return `up ${parts.join(' ')}`;
}

export async function recordAgentSystemInfo(params: {
  agentId: string;
  version?: string;
  hostname: string;
  osDistribution: string;
  kernel: string;
  architecture: string;
  cpuCount: number;
  ramTotalBytes: number;
  uptimeSeconds: number;
}): Promise<Date> {
  const now = new Date();
  const safeCpu = Math.max(1, Math.round(Number(params.cpuCount) || 1));
  const safeRamBytes = Math.max(0, Math.round(Number(params.ramTotalBytes) || 0));
  const safeUptime = Math.max(0, Math.round(Number(params.uptimeSeconds) || 0));

  const updateSet: Record<string, any> = {
    hostname: (params.hostname || '').trim(),
    osDistribution: (params.osDistribution || '').trim(),
    kernel: (params.kernel || '').trim(),
    architecture: (params.architecture || '').trim(),
    cpuCount: safeCpu,
    ramTotalBytes: String(safeRamBytes),
    uptimeSeconds: safeUptime,
    lastSeenAt: now,
    updatedAt: now,
  };
  if (params.version && params.version.trim()) {
    updateSet.version = params.version.trim();
  }

  const updated = await db
    .update(agents)
    .set(updateSet)
    .where(eq(agents.agentId, params.agentId))
    .returning();

  if (updated[0]) {
    const serverUpdate: Record<string, any> = {
      status: 'online',
      lastCheckError: '',
      lastCheckedAt: now,
      cpuCores: safeCpu,
      uptimeInfo: formatUptimeSeconds(safeUptime),
      updatedAt: now,
    };
    if (params.hostname && params.hostname.trim()) {
      serverUpdate.hostname = params.hostname.trim();
    }
    if (params.osDistribution && params.osDistribution.trim()) {
      serverUpdate.osInfo = params.osDistribution.trim();
    }
    if (params.kernel && params.kernel.trim()) {
      serverUpdate.kernelInfo = params.architecture
        ? `${params.kernel.trim()} (${params.architecture.trim()})`
        : params.kernel.trim();
    }
    if (safeRamBytes > 0) {
      serverUpdate.memoryMb = Math.round(safeRamBytes / (1024 * 1024));
    }

    await db
      .update(servers)
      .set(serverUpdate)
      .where(eq(servers.id, updated[0].serverId));
  }

  return now;
}

export interface PrometheusTargetGroup {
  targets: string[];
  labels: {
    __metrics_path__: string;
    __meta_infralab_server_id: string;
    __meta_infralab_agent_id: string;
    __meta_infralab_hostname: string;
    __meta_infralab_server_name: string;
    server_id: string;
    agent_id: string;
    hostname: string;
    server_name: string;
  };
}

export async function listPrometheusAgentTargets(
  defaultMetricsPort = 9101
): Promise<PrometheusTargetGroup[]> {
  const rows = await db
    .select({
      serverId: agents.serverId,
      agentId: agents.agentId,
      agentHostname: agents.hostname,
      serverHostname: servers.hostname,
      serverName: servers.name,
      ipAddress: servers.ipAddress,
    })
    .from(agents)
    .innerJoin(servers, eq(agents.serverId, servers.id));

  const targets: PrometheusTargetGroup[] = [];
  for (const row of rows) {
    if (!row.agentId || !row.agentId.trim()) {
      continue;
    }
    const host = (row.ipAddress || row.serverHostname || '').trim();
    if (!host) {
      continue;
    }
    const resolvedHostname = (row.agentHostname || row.serverHostname || row.serverName).trim();
    targets.push({
      targets: [`${host}:${defaultMetricsPort}`],
      labels: {
        __metrics_path__: '/metrics',
        __meta_infralab_server_id: String(row.serverId),
        __meta_infralab_agent_id: row.agentId.trim(),
        __meta_infralab_hostname: resolvedHostname,
        __meta_infralab_server_name: row.serverName,
        server_id: String(row.serverId),
        agent_id: row.agentId.trim(),
        hostname: resolvedHostname,
        server_name: row.serverName,
      },
    });
  }

  return targets;
}

