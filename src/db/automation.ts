import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db, pool } from './index.ts';
import {
  ansibleInventories,
  ansibleInventoryServers,
  ansibleJobs,
  ansiblePlaybooks,
  automationAuditLogs,
  servers,
} from './schema.ts';
import { DEFAULT_LOCAL_ADMIN_UID } from './bootstrap.ts';

function isLocalAdmin(userUid: string): boolean {
  return userUid === DEFAULT_LOCAL_ADMIN_UID;
}

let schemaEnsured = false;
export async function ensureAutomationTables(): Promise<void> {
  if (schemaEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ansible_inventories (
        id SERIAL PRIMARY KEY,
        user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        group_name TEXT NOT NULL DEFAULT 'all',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ansible_inventory_servers (
        id SERIAL PRIMARY KEY,
        inventory_id INTEGER NOT NULL REFERENCES ansible_inventories(id) ON DELETE CASCADE,
        server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        group_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(inventory_id, server_id)
      );
      CREATE TABLE IF NOT EXISTS ansible_playbooks (
        id SERIAL PRIMARY KEY,
        user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        validation_status TEXT NOT NULL DEFAULT 'unverified',
        validation_message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ansible_jobs (
        id SERIAL PRIMARY KEY,
        playbook_id INTEGER REFERENCES ansible_playbooks(id) ON DELETE SET NULL,
        playbook_name TEXT NOT NULL,
        inventory_id INTEGER REFERENCES ansible_inventories(id) ON DELETE SET NULL,
        inventory_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        check_mode INTEGER NOT NULL DEFAULT 0,
        diff_mode INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '',
        extra_vars_json TEXT NOT NULL DEFAULT '{}',
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS automation_audit_logs (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        job_id INTEGER NOT NULL REFERENCES ansible_jobs(id) ON DELETE CASCADE,
        user_uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
        playbook_name TEXT NOT NULL,
        inventory_name TEXT NOT NULL,
        target_servers TEXT NOT NULL DEFAULT '[]',
        result TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    schemaEnsured = true;
  } catch {
    // Ignore if already exists
  }
}

export interface InventoryServerSummary {
  id: number;
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  username: string;
  auth_type: string;
  status: string;
  group_name: string;
}

export interface InventoryWithServers {
  id: number;
  user_uid: string;
  name: string;
  description: string;
  group_name: string;
  server_count: number;
  servers: InventoryServerSummary[];
  created_at: string;
  updated_at: string;
}

export async function listInventoriesByUser(userUid: string): Promise<InventoryWithServers[]> {
  await ensureAutomationTables();
  const invRows = isLocalAdmin(userUid)
    ? await db.select().from(ansibleInventories).orderBy(desc(ansibleInventories.createdAt))
    : await db
        .select()
        .from(ansibleInventories)
        .where(eq(ansibleInventories.userUid, userUid))
        .orderBy(desc(ansibleInventories.createdAt));

  if (invRows.length === 0) return [];

  const invIds = invRows.map((r) => r.id);
  const joinRows = await db
    .select({
      inventoryId: ansibleInventoryServers.inventoryId,
      linkGroupName: ansibleInventoryServers.groupName,
      server: servers,
    })
    .from(ansibleInventoryServers)
    .innerJoin(servers, eq(ansibleInventoryServers.serverId, servers.id))
    .where(inArray(ansibleInventoryServers.inventoryId, invIds));

  const byInv = new Map<number, InventoryServerSummary[]>();
  for (const row of joinRows) {
    const list = byInv.get(row.inventoryId) || [];
    list.push({
      id: row.server.id,
      name: row.server.name,
      hostname: row.server.hostname,
      ip_address: row.server.ipAddress,
      ssh_port: row.server.sshPort,
      username: row.server.username,
      auth_type: row.server.authType,
      status: row.server.status,
      group_name: row.linkGroupName || 'all',
    });
    byInv.set(row.inventoryId, list);
  }

  return invRows.map((inv) => {
    const srvList = byInv.get(inv.id) || [];
    return {
      id: inv.id,
      user_uid: inv.userUid,
      name: inv.name,
      description: inv.description,
      group_name: inv.groupName,
      server_count: srvList.length,
      servers: srvList,
      created_at: inv.createdAt.toISOString(),
      updated_at: inv.updatedAt.toISOString(),
    };
  });
}

export async function getInventoryById(
  id: number,
  userUid: string
): Promise<InventoryWithServers | null> {
  await ensureAutomationTables();
  const rows = await db
    .select()
    .from(ansibleInventories)
    .where(
      isLocalAdmin(userUid)
        ? eq(ansibleInventories.id, id)
        : and(eq(ansibleInventories.id, id), eq(ansibleInventories.userUid, userUid))
    );
  const inv = rows[0];
  if (!inv) return null;

  const joinRows = await db
    .select({
      linkGroupName: ansibleInventoryServers.groupName,
      server: servers,
    })
    .from(ansibleInventoryServers)
    .innerJoin(servers, eq(ansibleInventoryServers.serverId, servers.id))
    .where(eq(ansibleInventoryServers.inventoryId, inv.id));

  const srvList: InventoryServerSummary[] = joinRows.map((row) => ({
    id: row.server.id,
    name: row.server.name,
    hostname: row.server.hostname,
    ip_address: row.server.ipAddress,
    ssh_port: row.server.sshPort,
    username: row.server.username,
    auth_type: row.server.authType,
    status: row.server.status,
    group_name: row.linkGroupName || inv.groupName || 'all',
  }));

  return {
    id: inv.id,
    user_uid: inv.userUid,
    name: inv.name,
    description: inv.description,
    group_name: inv.groupName,
    server_count: srvList.length,
    servers: srvList,
    created_at: inv.createdAt.toISOString(),
    updated_at: inv.updatedAt.toISOString(),
  };
}

export async function getInventoryFullServerRecords(
  inventoryId: number,
  userUid: string
): Promise<(typeof servers.$inferSelect & { inventoryGroupName: string })[]> {
  await ensureAutomationTables();
  const inv = await getInventoryById(inventoryId, userUid);
  if (!inv) return [];

  const joinRows = await db
    .select({
      linkGroupName: ansibleInventoryServers.groupName,
      server: servers,
    })
    .from(ansibleInventoryServers)
    .innerJoin(servers, eq(ansibleInventoryServers.serverId, servers.id))
    .where(eq(ansibleInventoryServers.inventoryId, inventoryId));

  return joinRows.map((r) => ({
    ...r.server,
    inventoryGroupName: r.linkGroupName || inv.group_name || 'all',
  }));
}

export async function createInventoryRecord(params: {
  userUid: string;
  name: string;
  description?: string;
  groupName?: string;
  serverIds?: number[];
}): Promise<InventoryWithServers> {
  await ensureAutomationTables();
  const [inserted] = await db
    .insert(ansibleInventories)
    .values({
      userUid: params.userUid,
      name: params.name.trim(),
      description: (params.description || '').trim(),
      groupName: (params.groupName || 'all').trim() || 'all',
    })
    .returning();

  if (params.serverIds && params.serverIds.length > 0) {
    await setInventoryServers({
      inventoryId: inserted.id,
      serverIds: params.serverIds,
      userUid: params.userUid,
      groupName: inserted.groupName,
    });
  }

  return (await getInventoryById(inserted.id, params.userUid))!;
}

export async function updateInventoryRecord(params: {
  id: number;
  userUid: string;
  name?: string;
  description?: string;
  groupName?: string;
  serverIds?: number[];
}): Promise<InventoryWithServers | null> {
  await ensureAutomationTables();
  const existing = await getInventoryById(params.id, params.userUid);
  if (!existing) return null;

  const nextName = params.name !== undefined ? params.name.trim() : existing.name;
  const nextDesc =
    params.description !== undefined ? params.description.trim() : existing.description;
  const nextGroup =
    params.groupName !== undefined ? params.groupName.trim() || 'all' : existing.group_name;

  await db
    .update(ansibleInventories)
    .set({
      name: nextName,
      description: nextDesc,
      groupName: nextGroup,
      updatedAt: new Date(),
    })
    .where(eq(ansibleInventories.id, params.id));

  if (Array.isArray(params.serverIds)) {
    await setInventoryServers({
      inventoryId: params.id,
      serverIds: params.serverIds,
      userUid: params.userUid,
      groupName: nextGroup,
    });
  }

  return getInventoryById(params.id, params.userUid);
}

export async function setInventoryServers(params: {
  inventoryId: number;
  serverIds: number[];
  userUid: string;
  groupName?: string;
}): Promise<InventoryWithServers | null> {
  await ensureAutomationTables();
  const inv = await getInventoryById(params.inventoryId, params.userUid);
  if (!inv) return null;

  const uniqueServerIds = Array.from(
    new Set(params.serverIds.filter((id) => Number.isInteger(id) && id > 0))
  );

  // Verify user owns or can access all target servers
  let allowedIds: number[] = [];
  if (uniqueServerIds.length > 0) {
    const ownedRows = await db
      .select({ id: servers.id })
      .from(servers)
      .where(
        isLocalAdmin(params.userUid)
          ? inArray(servers.id, uniqueServerIds)
          : and(inArray(servers.id, uniqueServerIds), eq(servers.userUid, params.userUid))
      );
    allowedIds = ownedRows.map((r) => r.id);
  }

  await db
    .delete(ansibleInventoryServers)
    .where(eq(ansibleInventoryServers.inventoryId, params.inventoryId));

  if (allowedIds.length > 0) {
    await db.insert(ansibleInventoryServers).values(
      allowedIds.map((serverId) => ({
        inventoryId: params.inventoryId,
        serverId,
        groupName: (params.groupName || inv.group_name || 'all').trim(),
      }))
    );
  }

  await db
    .update(ansibleInventories)
    .set({ updatedAt: new Date() })
    .where(eq(ansibleInventories.id, params.inventoryId));

  return getInventoryById(params.inventoryId, params.userUid);
}

export async function addServerToInventory(params: {
  inventoryId: number;
  serverId: number;
  groupName?: string;
  userUid: string;
}): Promise<InventoryWithServers | null> {
  await ensureAutomationTables();
  const inv = await getInventoryById(params.inventoryId, params.userUid);
  if (!inv) return null;

  const srvRows = await db
    .select({ id: servers.id })
    .from(servers)
    .where(
      isLocalAdmin(params.userUid)
        ? eq(servers.id, params.serverId)
        : and(eq(servers.id, params.serverId), eq(servers.userUid, params.userUid))
    );
  if (srvRows.length === 0) return null;

  await pool.query(
    `INSERT INTO ansible_inventory_servers (inventory_id, server_id, group_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (inventory_id, server_id)
     DO UPDATE SET group_name = EXCLUDED.group_name`,
    [params.inventoryId, params.serverId, (params.groupName || inv.group_name || 'all').trim()]
  );

  await db
    .update(ansibleInventories)
    .set({ updatedAt: new Date() })
    .where(eq(ansibleInventories.id, params.inventoryId));

  return getInventoryById(params.inventoryId, params.userUid);
}

export async function removeServerFromInventory(params: {
  inventoryId: number;
  serverId: number;
  userUid: string;
}): Promise<InventoryWithServers | null> {
  await ensureAutomationTables();
  const inv = await getInventoryById(params.inventoryId, params.userUid);
  if (!inv) return null;

  await db
    .delete(ansibleInventoryServers)
    .where(
      and(
        eq(ansibleInventoryServers.inventoryId, params.inventoryId),
        eq(ansibleInventoryServers.serverId, params.serverId)
      )
    );

  await db
    .update(ansibleInventories)
    .set({ updatedAt: new Date() })
    .where(eq(ansibleInventories.id, params.inventoryId));

  return getInventoryById(params.inventoryId, params.userUid);
}

export async function deleteInventoryById(id: number, userUid: string): Promise<boolean> {
  await ensureAutomationTables();
  const deleted = await db
    .delete(ansibleInventories)
    .where(
      isLocalAdmin(userUid)
        ? eq(ansibleInventories.id, id)
        : and(eq(ansibleInventories.id, id), eq(ansibleInventories.userUid, userUid))
    )
    .returning({ id: ansibleInventories.id });
  return deleted.length > 0;
}

// --- Playbooks CRUD ---

export interface PlaybookView {
  id: number;
  user_uid: string;
  name: string;
  description: string;
  content: string;
  validation_status: 'valid' | 'invalid' | 'unverified';
  validation_message: string;
  created_at: string;
  updated_at: string;
}

function serializePlaybook(row: typeof ansiblePlaybooks.$inferSelect): PlaybookView {
  const status =
    row.validationStatus === 'valid' || row.validationStatus === 'invalid'
      ? row.validationStatus
      : 'unverified';
  return {
    id: row.id,
    user_uid: row.userUid,
    name: row.name,
    description: row.description,
    content: row.content,
    validation_status: status,
    validation_message: row.validationMessage,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listPlaybooksByUser(userUid: string): Promise<PlaybookView[]> {
  await ensureAutomationTables();
  const rows = isLocalAdmin(userUid)
    ? await db.select().from(ansiblePlaybooks).orderBy(desc(ansiblePlaybooks.updatedAt))
    : await db
        .select()
        .from(ansiblePlaybooks)
        .where(eq(ansiblePlaybooks.userUid, userUid))
        .orderBy(desc(ansiblePlaybooks.updatedAt));
  return rows.map(serializePlaybook);
}

export async function getPlaybookById(id: number, userUid: string): Promise<PlaybookView | null> {
  await ensureAutomationTables();
  const rows = await db
    .select()
    .from(ansiblePlaybooks)
    .where(
      isLocalAdmin(userUid)
        ? eq(ansiblePlaybooks.id, id)
        : and(eq(ansiblePlaybooks.id, id), eq(ansiblePlaybooks.userUid, userUid))
    );
  return rows[0] ? serializePlaybook(rows[0]) : null;
}

export async function createPlaybookRecord(params: {
  userUid: string;
  name: string;
  description?: string;
  content: string;
  validationStatus?: 'valid' | 'invalid' | 'unverified';
  validationMessage?: string;
}): Promise<PlaybookView> {
  await ensureAutomationTables();
  const [inserted] = await db
    .insert(ansiblePlaybooks)
    .values({
      userUid: params.userUid,
      name: params.name.trim(),
      description: (params.description || '').trim(),
      content: params.content,
      validationStatus: params.validationStatus || 'unverified',
      validationMessage: params.validationMessage || '',
    })
    .returning();
  return serializePlaybook(inserted);
}

export async function updatePlaybookRecord(params: {
  id: number;
  userUid: string;
  name?: string;
  description?: string;
  content?: string;
  validationStatus?: 'valid' | 'invalid' | 'unverified';
  validationMessage?: string;
}): Promise<PlaybookView | null> {
  await ensureAutomationTables();
  const existing = await getPlaybookById(params.id, params.userUid);
  if (!existing) return null;

  const [updated] = await db
    .update(ansiblePlaybooks)
    .set({
      name: params.name !== undefined ? params.name.trim() : existing.name,
      description:
        params.description !== undefined ? params.description.trim() : existing.description,
      content: params.content !== undefined ? params.content : existing.content,
      validationStatus:
        params.validationStatus !== undefined
          ? params.validationStatus
          : existing.validation_status,
      validationMessage:
        params.validationMessage !== undefined
          ? params.validationMessage
          : existing.validation_message,
      updatedAt: new Date(),
    })
    .where(eq(ansiblePlaybooks.id, params.id))
    .returning();

  return updated ? serializePlaybook(updated) : null;
}

export async function deletePlaybookById(id: number, userUid: string): Promise<boolean> {
  await ensureAutomationTables();
  const deleted = await db
    .delete(ansiblePlaybooks)
    .where(
      isLocalAdmin(userUid)
        ? eq(ansiblePlaybooks.id, id)
        : and(eq(ansiblePlaybooks.id, id), eq(ansiblePlaybooks.userUid, userUid))
    )
    .returning({ id: ansiblePlaybooks.id });
  return deleted.length > 0;
}

// --- Jobs & Audit Logs ---

export type AnsibleJobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface AnsibleJobView {
  id: number;
  playbook_id: number | null;
  playbook_name: string;
  inventory_id: number | null;
  inventory_name: string;
  status: AnsibleJobStatus;
  check_mode: boolean;
  diff_mode: boolean;
  tags: string[];
  extra_vars: Record<string, unknown>;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  created_by: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

function serializeJob(row: typeof ansibleJobs.$inferSelect, includeOutput = true): AnsibleJobView {
  let extraVars: Record<string, unknown> = {};
  try {
    extraVars = JSON.parse(row.extraVarsJson || '{}');
  } catch {
    extraVars = {};
  }
  const tags = (row.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    id: row.id,
    playbook_id: row.playbookId,
    playbook_name: row.playbookName,
    inventory_id: row.inventoryId,
    inventory_name: row.inventoryName,
    status: (row.status as AnsibleJobStatus) || 'PENDING',
    check_mode: row.checkMode === 1,
    diff_mode: row.diffMode === 1,
    tags,
    extra_vars: extraVars,
    stdout: includeOutput ? row.stdout : '',
    stderr: includeOutput ? row.stderr : '',
    exit_code: row.exitCode ?? null,
    duration_ms: row.durationMs,
    created_by: row.createdBy,
    started_at: row.startedAt ? row.startedAt.toISOString() : null,
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

export async function createAnsibleJobRecord(params: {
  playbookId: number;
  playbookName: string;
  inventoryId: number;
  inventoryName: string;
  checkMode: boolean;
  diffMode: boolean;
  tags: string[];
  redactedExtraVars: Record<string, unknown>;
  createdBy: string;
}): Promise<AnsibleJobView> {
  await ensureAutomationTables();
  const [inserted] = await db
    .insert(ansibleJobs)
    .values({
      playbookId: params.playbookId,
      playbookName: params.playbookName,
      inventoryId: params.inventoryId,
      inventoryName: params.inventoryName,
      status: 'PENDING',
      checkMode: params.checkMode ? 1 : 0,
      diffMode: params.diffMode ? 1 : 0,
      tags: params.tags.join(','),
      extraVarsJson: JSON.stringify(params.redactedExtraVars || {}),
      createdBy: params.createdBy,
    })
    .returning();
  return serializeJob(inserted, true);
}

export async function getAnsibleJobById(
  id: number,
  userUid: string
): Promise<AnsibleJobView | null> {
  await ensureAutomationTables();
  const rows = await db
    .select()
    .from(ansibleJobs)
    .where(
      isLocalAdmin(userUid)
        ? eq(ansibleJobs.id, id)
        : and(eq(ansibleJobs.id, id), eq(ansibleJobs.createdBy, userUid))
    );
  return rows[0] ? serializeJob(rows[0], true) : null;
}

export async function listAnsibleJobsByUser(
  userUid: string,
  filters?: {
    status?: string;
    playbookId?: number;
    inventoryId?: number;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<AnsibleJobView[]> {
  await ensureAutomationTables();
  const conditions: any[] = [];
  if (!isLocalAdmin(userUid)) {
    conditions.push(eq(ansibleJobs.createdBy, userUid));
  }
  if (filters?.status && filters.status !== 'all') {
    conditions.push(eq(ansibleJobs.status, filters.status.toUpperCase()));
  }
  if (filters?.playbookId && Number.isInteger(filters.playbookId)) {
    conditions.push(eq(ansibleJobs.playbookId, filters.playbookId));
  }
  if (filters?.inventoryId && Number.isInteger(filters.inventoryId)) {
    conditions.push(eq(ansibleJobs.inventoryId, filters.inventoryId));
  }
  if (filters?.dateFrom) {
    const d = new Date(filters.dateFrom);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(gte(ansibleJobs.createdAt, d));
    }
  }
  if (filters?.dateTo) {
    const d = new Date(filters.dateTo);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(lte(ansibleJobs.createdAt, d));
    }
  }

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(ansibleJobs)
          .where(and(...conditions))
          .orderBy(desc(ansibleJobs.createdAt))
          .limit(100)
      : await db.select().from(ansibleJobs).orderBy(desc(ansibleJobs.createdAt)).limit(100);

  return rows.map((r) => serializeJob(r, false));
}

export async function updateAnsibleJobState(
  id: number,
  patch: {
    status?: AnsibleJobStatus;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    durationMs?: number;
    startedAt?: Date;
    finishedAt?: Date;
  }
): Promise<void> {
  await ensureAutomationTables();
  const updateData: Record<string, any> = {};
  if (patch.status !== undefined) updateData.status = patch.status;
  if (patch.stdout !== undefined) updateData.stdout = patch.stdout;
  if (patch.stderr !== undefined) updateData.stderr = patch.stderr;
  if (patch.exitCode !== undefined) updateData.exitCode = patch.exitCode;
  if (patch.durationMs !== undefined) updateData.durationMs = patch.durationMs;
  if (patch.startedAt !== undefined) updateData.startedAt = patch.startedAt;
  if (patch.finishedAt !== undefined) updateData.finishedAt = patch.finishedAt;

  await db.update(ansibleJobs).set(updateData).where(eq(ansibleJobs.id, id));
}

export async function createAutomationAuditLogRecord(params: {
  eventType:
    | 'automation.job.started'
    | 'automation.job.completed'
    | 'automation.job.failed'
    | 'automation.job.cancelled';
  jobId: number;
  userUid: string;
  playbookName: string;
  inventoryName: string;
  targetServers: { id: number; name: string; ip_address: string }[];
  result: string;
}): Promise<void> {
  await ensureAutomationTables();
  await db.insert(automationAuditLogs).values({
    eventType: params.eventType,
    jobId: params.jobId,
    userUid: params.userUid,
    playbookName: params.playbookName,
    inventoryName: params.inventoryName,
    targetServers: JSON.stringify(params.targetServers || []),
    result: params.result,
  });
}

export async function listAutomationAuditLogsByUser(userUid: string, limit = 50) {
  await ensureAutomationTables();
  const rows = isLocalAdmin(userUid)
    ? await db
        .select()
        .from(automationAuditLogs)
        .orderBy(desc(automationAuditLogs.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(automationAuditLogs)
        .where(eq(automationAuditLogs.userUid, userUid))
        .orderBy(desc(automationAuditLogs.createdAt))
        .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    event_type: r.eventType,
    job_id: r.jobId,
    user_uid: r.userUid,
    playbook_name: r.playbookName,
    inventory_name: r.inventoryName,
    target_servers: (() => {
      try {
        return JSON.parse(r.targetServers || '[]');
      } catch {
        return [];
      }
    })(),
    result: r.result,
    created_at: r.createdAt.toISOString(),
  }));
}
