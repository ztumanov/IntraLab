import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  username: text('username').default('').notNull(),
  passwordHash: text('password_hash').default('').notNull(),
  authProvider: text('auth_provider').default('local').notNull(),
  totpEnabled: integer('totp_enabled').default(0).notNull(),
  totpSecretEncrypted: text('totp_secret_encrypted').default('').notNull(),
  totpPendingSecretEncrypted: text('totp_pending_secret_encrypted').default('').notNull(),
  recoveryCodesHashes: text('recovery_codes_hashes').default('[]').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const servers = pgTable('servers', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  name: text('name').notNull(),
  hostname: text('hostname').notNull(),
  ipAddress: text('ip_address').notNull(),
  sshPort: integer('ssh_port').default(22).notNull(),
  username: text('username').notNull(),
  authType: text('auth_type').default('password').notNull(),
  encryptedSecret: text('encrypted_secret').default('').notNull(),
  description: text('description').default('').notNull(),
  status: text('status').default('unknown').notNull(),
  lastCheckError: text('last_check_error').default('').notNull(),
  lastCheckedAt: timestamp('last_checked_at'),
  latencyMs: integer('latency_ms'),
  osInfo: text('os_info').default('').notNull(),
  kernelInfo: text('kernel_info').default('').notNull(),
  cpuCores: integer('cpu_cores'),
  cpuLoad: text('cpu_load').default('').notNull(),
  cpuUsagePercent: integer('cpu_usage_percent'),
  memoryMb: integer('memory_mb'),
  memoryUsedMb: integer('memory_used_mb'),
  diskTotalGb: text('disk_total_gb').default('').notNull(),
  diskUsedGb: text('disk_used_gb').default('').notNull(),
  diskUsagePercent: integer('disk_usage_percent'),
  uptimeInfo: text('uptime_info').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sshCommandLogs = pgTable('ssh_command_logs', {
  id: serial('id').primaryKey(),
  serverId: integer('server_id')
    .references(() => servers.id, { onDelete: 'cascade' })
    .notNull(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  command: text('command').notNull(),
  stdout: text('stdout').default('').notNull(),
  stderr: text('stderr').default('').notNull(),
  exitCode: integer('exit_code').default(0).notNull(),
  durationMs: integer('duration_ms').default(0).notNull(),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
});

export const serverMetrics = pgTable('server_metrics', {
  id: serial('id').primaryKey(),
  serverId: integer('server_id')
    .references(() => servers.id, { onDelete: 'cascade' })
    .notNull(),
  cpuUsagePercent: integer('cpu_usage_percent').default(0).notNull(),
  memoryUsagePercent: integer('memory_usage_percent').default(0).notNull(),
  memoryUsedMb: integer('memory_used_mb').default(0).notNull(),
  diskUsagePercent: integer('disk_usage_percent').default(0).notNull(),
  load1m: text('load_1m').default('0.00').notNull(),
  latencyMs: integer('latency_ms').default(0).notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
});

export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  serverId: integer('server_id')
    .references(() => servers.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  agentId: text('agent_id').default('').notNull(),
  version: text('version').default('').notNull(),
  hostname: text('hostname').default('').notNull(),
  osDistribution: text('os_distribution').default('').notNull(),
  kernel: text('kernel').default('').notNull(),
  architecture: text('architecture').default('').notNull(),
  cpuCount: integer('cpu_count').default(0).notNull(),
  ramTotalBytes: text('ram_total_bytes').default('0').notNull(),
  uptimeSeconds: integer('uptime_seconds').default(0).notNull(),
  enrollmentTokenHash: text('enrollment_token_hash').default('').notNull(),
  enrollmentTokenEncrypted: text('enrollment_token_encrypted').default('').notNull(),
  credentialHash: text('credential_hash').default('').notNull(),
  authMode: text('auth_mode').default('bearer').notNull(),
  certSerial: text('cert_serial').default('').notNull(),
  certFingerprintSha256: text('cert_fingerprint_sha256').default('').notNull(),
  certSubject: text('cert_subject').default('').notNull(),
  certSanUri: text('cert_san_uri').default('').notNull(),
  certNotBefore: timestamp('cert_not_before'),
  certNotAfter: timestamp('cert_not_after'),
  certRevokedAt: timestamp('cert_revoked_at'),
  certRevocationReason: text('cert_revocation_reason').default('').notNull(),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  servers: many(servers),
  commandLogs: many(sshCommandLogs),
}));

export const serversRelations = relations(servers, ({ one, many }) => ({
  owner: one(users, {
    fields: [servers.userUid],
    references: [users.uid],
  }),
  commandLogs: many(sshCommandLogs),
  metrics: many(serverMetrics),
  agent: one(agents, {
    fields: [servers.id],
    references: [agents.serverId],
  }),
}));

export const agentsRelations = relations(agents, ({ one }) => ({
  server: one(servers, {
    fields: [agents.serverId],
    references: [servers.id],
  }),
}));

export const sshCommandLogsRelations = relations(sshCommandLogs, ({ one }) => ({
  server: one(servers, {
    fields: [sshCommandLogs.serverId],
    references: [servers.id],
  }),
  user: one(users, {
    fields: [sshCommandLogs.userUid],
    references: [users.uid],
  }),
}));

export const serverMetricsRelations = relations(serverMetrics, ({ one }) => ({
  server: one(servers, {
    fields: [serverMetrics.serverId],
    references: [servers.id],
  }),
}));

export const ansibleInventories = pgTable('ansible_inventories', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  groupName: text('group_name').default('all').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const ansibleInventoryServers = pgTable('ansible_inventory_servers', {
  id: serial('id').primaryKey(),
  inventoryId: integer('inventory_id')
    .references(() => ansibleInventories.id, { onDelete: 'cascade' })
    .notNull(),
  serverId: integer('server_id')
    .references(() => servers.id, { onDelete: 'cascade' })
    .notNull(),
  groupName: text('group_name').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ansiblePlaybooks = pgTable('ansible_playbooks', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  content: text('content').notNull(),
  validationStatus: text('validation_status').default('unverified').notNull(),
  validationMessage: text('validation_message').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const ansibleJobs = pgTable('ansible_jobs', {
  id: serial('id').primaryKey(),
  playbookId: integer('playbook_id').references(() => ansiblePlaybooks.id, {
    onDelete: 'set null',
  }),
  playbookName: text('playbook_name').notNull(),
  inventoryId: integer('inventory_id').references(() => ansibleInventories.id, {
    onDelete: 'set null',
  }),
  inventoryName: text('inventory_name').notNull(),
  status: text('status').default('PENDING').notNull(),
  checkMode: integer('check_mode').default(0).notNull(),
  diffMode: integer('diff_mode').default(0).notNull(),
  tags: text('tags').default('').notNull(),
  extraVarsJson: text('extra_vars_json').default('{}').notNull(),
  stdout: text('stdout').default('').notNull(),
  stderr: text('stderr').default('').notNull(),
  exitCode: integer('exit_code'),
  durationMs: integer('duration_ms').default(0).notNull(),
  createdBy: text('created_by')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const automationAuditLogs = pgTable('automation_audit_logs', {
  id: serial('id').primaryKey(),
  eventType: text('event_type').notNull(),
  jobId: integer('job_id')
    .references(() => ansibleJobs.id, { onDelete: 'cascade' })
    .notNull(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  playbookName: text('playbook_name').notNull(),
  inventoryName: text('inventory_name').notNull(),
  targetServers: text('target_servers').default('[]').notNull(),
  result: text('result').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
