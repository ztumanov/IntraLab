import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { decryptSecret } from './sshConnector.ts';
import {
  AnsibleJobStatus,
  AnsibleJobView,
  createAnsibleJobRecord,
  createAutomationAuditLogRecord,
  createPlaybookRecord,
  getAnsibleJobById,
  getInventoryById,
  getInventoryFullServerRecords,
  getPlaybookById,
  listPlaybooksByUser,
  updateAnsibleJobState,
  updatePlaybookRecord,
} from '../db/automation.ts';

export interface AnsibleRuntimeConfig {
  ansibleBin: string;
  ansiblePlaybookBin: string;
  ansibleInventoryBin: string;
  timeoutSec: number;
  workDir: string;
}

export interface AnsibleRuntimeStatus {
  available: boolean;
  version: string;
  ansible_bin: string;
  ansible_playbook_bin: string;
  ansible_inventory_bin: string;
  timeout_sec: number;
  work_dir: string;
  error?: string;
}

const VALID_TAG_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
const VALID_EXTRA_VAR_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const SENSITIVE_KEY_RE = /pass(word)?|secret|token|key|private|credential|auth/i;
const MAX_PLAYBOOK_BYTES = 256 * 1024;
const MAX_JOB_OUTPUT_CHARS = 2 * 1024 * 1024;

const FORBIDDEN_EXTRA_VAR_KEYS = new Set([
  'ansible_connection',
  'ansible_ssh_common_args',
  'ansible_ssh_extra_args',
  'ansible_ssh_executable',
  'ansible_sftp_extra_args',
  'ansible_scp_extra_args',
  'ansible_python_interpreter',
  'ansible_shell_executable',
  'ansible_Password',
  'ansible_password',
  'ansible_ssh_pass',
  'ansible_ssh_private_key_file',
]);

export function getAnsibleConfig(): AnsibleRuntimeConfig {
  const ansibleBin = (process.env.ANSIBLE_BIN || '/usr/bin/ansible').trim();
  const ansiblePlaybookBin = (
    process.env.ANSIBLE_PLAYBOOK_BIN || '/usr/bin/ansible-playbook'
  ).trim();
  const ansibleInventoryBin = (
    process.env.ANSIBLE_INVENTORY_BIN || '/usr/bin/ansible-inventory'
  ).trim();
  const timeoutRaw = Number(process.env.ANSIBLE_TIMEOUT || 120);
  const timeoutSec =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 5 && timeoutRaw <= 3600
      ? Math.floor(timeoutRaw)
      : 120;

  const configuredWorkDir = (
    process.env.ANSIBLE_WORK_DIR || '/var/lib/infralab/ansible'
  ).trim();

  let workDir = configuredWorkDir;
  try {
    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  } catch {
    workDir = path.join(os.tmpdir(), 'infralab-ansible');
    fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  }

  return {
    ansibleBin,
    ansiblePlaybookBin,
    ansibleInventoryBin,
    timeoutSec,
    workDir,
  };
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkAnsibleRuntime(): Promise<AnsibleRuntimeStatus> {
  const cfg = getAnsibleConfig();

  if (!isExecutableFile(cfg.ansibleBin) || !isExecutableFile(cfg.ansiblePlaybookBin)) {
    return {
      available: false,
      version: '',
      ansible_bin: cfg.ansibleBin,
      ansible_playbook_bin: cfg.ansiblePlaybookBin,
      ansible_inventory_bin: cfg.ansibleInventoryBin,
      timeout_sec: cfg.timeoutSec,
      work_dir: cfg.workDir,
      error: 'Ansible is not installed or unavailable',
    };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(cfg.ansiblePlaybookBin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', () => {
      if (settled) return;
      settled = true;
      resolve({
        available: false,
        version: '',
        ansible_bin: cfg.ansibleBin,
        ansible_playbook_bin: cfg.ansiblePlaybookBin,
        ansible_inventory_bin: cfg.ansibleInventoryBin,
        timeout_sec: cfg.timeoutSec,
        work_dir: cfg.workDir,
        error: 'Ansible is not installed or unavailable',
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        const firstLine = (stdout.split('\n')[0] || 'ansible-playbook').trim();
        resolve({
          available: true,
          version: firstLine,
          ansible_bin: cfg.ansibleBin,
          ansible_playbook_bin: cfg.ansiblePlaybookBin,
          ansible_inventory_bin: cfg.ansibleInventoryBin,
          timeout_sec: cfg.timeoutSec,
          work_dir: cfg.workDir,
        });
      } else {
        resolve({
          available: false,
          version: '',
          ansible_bin: cfg.ansibleBin,
          ansible_playbook_bin: cfg.ansiblePlaybookBin,
          ansible_inventory_bin: cfg.ansibleInventoryBin,
          timeout_sec: cfg.timeoutSec,
          work_dir: cfg.workDir,
          error: stderr.trim() || 'Ansible is not installed or unavailable',
        });
      }
    });
  });
}

export function validatePlaybookStaticSecurity(content: string): {
  ok: boolean;
  error?: string;
} {
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'Playbook YAML content is required' };
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_PLAYBOOK_BYTES) {
    return { ok: false, error: 'Playbook content exceeds maximum size of 256 KB' };
  }

  const trimmed = content.trim();
  if (!trimmed.includes('hosts:') && !trimmed.includes('tasks:') && !trimmed.includes('roles:')) {
    return {
      ok: false,
      error: 'Invalid Ansible Playbook: must define at least hosts and tasks/roles',
    };
  }

  // Prevent user playbooks from breaking out to execute on the InfraLab control-plane container
  if (/(?:^|\s)connection\s*:\s*['"]?local['"]?(?:\s|$)/m.test(content)) {
    return {
      ok: false,
      error:
        'Security policy violation: connection: local is forbidden in playbooks (all tasks must execute on remote inventory hosts over SSH)',
    };
  }
  if (/(?:^|\s)ansible_connection\s*:\s*['"]?local['"]?(?:\s|$)/m.test(content)) {
    return {
      ok: false,
      error:
        'Security policy violation: ansible_connection: local is forbidden in playbooks',
    };
  }
  if (/(?:^|\s)delegate_to\s*:\s*['"]?(?:localhost|127\.0\.0\.1)['"]?(?:\s|$)/m.test(content)) {
    return {
      ok: false,
      error:
        'Security policy violation: delegate_to: localhost is forbidden in playbooks',
    };
  }
  if (/(?:^|\s)local_action\s*:/m.test(content)) {
    return {
      ok: false,
      error: 'Security policy violation: local_action is forbidden in playbooks',
    };
  }
  if (/lookup\s*\(\s*['"](?:pipe|file|env|lines|template|ini|csvfile)['"]/i.test(content)) {
    return {
      ok: false,
      error:
        'Security policy violation: control-plane file/pipe/env lookups are forbidden in playbooks',
    };
  }

  return { ok: true };
}

export async function validatePlaybookWithAnsibleCli(content: string): Promise<{
  valid: boolean;
  status: 'valid' | 'invalid';
  message: string;
}> {
  const staticCheck = validatePlaybookStaticSecurity(content);
  if (!staticCheck.ok) {
    return {
      valid: false,
      status: 'invalid',
      message: staticCheck.error || 'Playbook validation failed',
    };
  }

  const runtime = await checkAnsibleRuntime();
  if (!runtime.available) {
    throw new Error(runtime.error || 'Ansible is not installed or unavailable');
  }

  const cfg = getAnsibleConfig();
  const tempDir = fs.mkdtempSync(path.join(cfg.workDir, 'validate-'));
  fs.chmodSync(tempDir, 0o700);
  const playbookPath = path.join(tempDir, 'playbook.yml');
  const inventoryPath = path.join(tempDir, 'hosts.ini');

  try {
    fs.writeFileSync(
      inventoryPath,
      '[all]\nvalidation-node ansible_host=192.0.2.10 ansible_user=root\n',
      { mode: 0o600 }
    );
    fs.writeFileSync(playbookPath, content, { mode: 0o600 });

    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(
        cfg.ansiblePlaybookBin,
        ['--syntax-check', '-i', inventoryPath, playbookPath],
        {
          cwd: tempDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 15000,
          env: {
            ...process.env,
            ANSIBLE_HOST_KEY_CHECKING: 'False',
            ANSIBLE_RETRY_FILES_ENABLED: 'False',
          },
        }
      );

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
      });

      child.on('error', (err) => {
        resolve({
          valid: false,
          status: 'invalid',
          message: err.message || 'Failed to invoke ansible-playbook --syntax-check',
        });
      });

      child.on('close', (code) => {
        const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
        if (code === 0) {
          resolve({
            valid: true,
            status: 'valid',
            message: combined || 'Syntax check passed (ansible-playbook --syntax-check)',
          });
        } else {
          resolve({
            valid: false,
            status: 'invalid',
            message: combined || `Syntax check exited with code ${code}`,
          });
        }
      });
    });
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function validateAndNormalizeTags(rawTags: unknown): {
  ok: boolean;
  tags: string[];
  error?: string;
} {
  if (rawTags === undefined || rawTags === null || rawTags === '') {
    return { ok: true, tags: [] };
  }

  let list: string[] = [];
  if (Array.isArray(rawTags)) {
    list = rawTags.map((t) => String(t).trim()).filter(Boolean);
  } else if (typeof rawTags === 'string') {
    list = rawTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  } else {
    return { ok: false, tags: [], error: 'Invalid tags format' };
  }

  if (list.length > 25) {
    return { ok: false, tags: [], error: 'Too many tags (max 25)' };
  }

  for (const tag of list) {
    if (tag.startsWith('-') || !VALID_TAG_RE.test(tag)) {
      return {
        ok: false,
        tags: [],
        error: `Invalid tag "${tag}". Only alphanumeric characters, dots, underscores, and hyphens are allowed.`,
      };
    }
  }

  return { ok: true, tags: list };
}

export function validateAndRedactExtraVars(rawVars: unknown): {
  ok: boolean;
  cleanVars: Record<string, string | number | boolean>;
  redactedVars: Record<string, string | number | boolean>;
  secretValues: string[];
  error?: string;
} {
  if (rawVars === undefined || rawVars === null || rawVars === '') {
    return { ok: true, cleanVars: {}, redactedVars: {}, secretValues: [] };
  }

  let parsed: unknown = rawVars;
  if (typeof rawVars === 'string') {
    const trimmed = rawVars.trim();
    if (!trimmed) {
      return { ok: true, cleanVars: {}, redactedVars: {}, secretValues: [] };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        cleanVars: {},
        redactedVars: {},
        secretValues: [],
        error: 'extra_vars must be valid JSON object',
      };
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      cleanVars: {},
      redactedVars: {},
      secretValues: [],
      error: 'extra_vars must be a key-value JSON object',
    };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 32) {
    return {
      ok: false,
      cleanVars: {},
      redactedVars: {},
      secretValues: [],
      error: 'extra_vars cannot exceed 32 variables',
    };
  }

  const cleanVars: Record<string, string | number | boolean> = {};
  const redactedVars: Record<string, string | number | boolean> = {};
  const secretValues: string[] = [];

  for (const [key, val] of entries) {
    if (!VALID_EXTRA_VAR_KEY_RE.test(key)) {
      return {
        ok: false,
        cleanVars: {},
        redactedVars: {},
        secretValues: [],
        error: `Invalid variable name "${key}"`,
      };
    }
    if (FORBIDDEN_EXTRA_VAR_KEYS.has(key) || key.toLowerCase().startsWith('ansible_')) {
      return {
        ok: false,
        cleanVars: {},
        redactedVars: {},
        secretValues: [],
        error: `Variable "${key}" is reserved and cannot be overridden via extra_vars`,
      };
    }
    if (
      typeof val !== 'string' &&
      typeof val !== 'number' &&
      typeof val !== 'boolean'
    ) {
      return {
        ok: false,
        cleanVars: {},
        redactedVars: {},
        secretValues: [],
        error: `Variable "${key}" must be a string, number, or boolean`,
      };
    }
    if (typeof val === 'string' && val.length > 2048) {
      return {
        ok: false,
        cleanVars: {},
        redactedVars: {},
        secretValues: [],
        error: `Variable "${key}" exceeds maximum length of 2048 characters`,
      };
    }

    cleanVars[key] = val;
    if (SENSITIVE_KEY_RE.test(key) && typeof val === 'string' && val.trim().length > 0) {
      redactedVars[key] = '***REDACTED***';
      if (val.trim().length >= 3) {
        secretValues.push(val.trim());
      }
    } else {
      redactedVars[key] = val;
    }
  }

  return { ok: true, cleanVars, redactedVars, secretValues };
}

function sanitizeOutputText(text: string, secrets: string[]): string {
  if (!text) return '';
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 3) {
      result = result.split(secret).join('***REDACTED***');
    }
  }
  // Redact inline ansible_ssh_pass if ever echoed
  result = result.replace(/ansible_ssh_pass=\S+/g, 'ansible_ssh_pass=***REDACTED***');
  return result;
}

function sanitizeIniIdentifier(raw: string, fallback: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

export function buildInventoryIniAndSecrets(params: {
  jobDir: string;
  servers: {
    id: number;
    name: string;
    hostname: string;
    ipAddress: string;
    sshPort: number;
    username: string;
    authType: string;
    encryptedSecret: string;
    inventoryGroupName: string;
  }[];
}): {
  inventoryPath: string;
  inventoryPreviewRedacted: string;
  secretsToRedact: string[];
} {
  const groups = new Map<string, string[]>();
  const redactedGroups = new Map<string, string[]>();
  const secretsToRedact: string[] = [];

  for (const srv of params.servers) {
    const group = sanitizeIniIdentifier(srv.inventoryGroupName || 'all', 'all');
    const hostAlias = sanitizeIniIdentifier(
      `${srv.name || srv.hostname}-${srv.id}`,
      `server-${srv.id}`
    );
    const hostIp = srv.ipAddress.trim();
    const sshPort = Number.isInteger(srv.sshPort) && srv.sshPort > 0 ? srv.sshPort : 22;
    const sshUser = srv.username.trim() || 'root';
    const secret = decryptSecret(srv.encryptedSecret || '');

    if (secret && secret.trim().length >= 3) {
      secretsToRedact.push(secret.trim());
    }

    const baseParts = [
      hostAlias,
      `ansible_host=${hostIp}`,
      `ansible_port=${sshPort}`,
      `ansible_user=${sshUser}`,
      `ansible_connection=ssh`,
    ];
    const redactedParts = [...baseParts];

    if (srv.authType === 'private_key' && secret) {
      const keyPath = path.join(params.jobDir, `ssh_key_${srv.id}.pem`);
      const normalizedKey = secret.endsWith('\n') ? secret : `${secret}\n`;
      fs.writeFileSync(keyPath, normalizedKey, { mode: 0o600 });
      baseParts.push(`ansible_ssh_private_key_file=${keyPath}`);
      redactedParts.push(`ansible_ssh_private_key_file=<ephemeral_key_${srv.id}>`);
    } else if (secret) {
      // Write a dedicated per-server askpass script so password works with OpenSSH even without sshpass
      const askPassPath = path.join(params.jobDir, `askpass_${srv.id}.sh`);
      const passFilePath = path.join(params.jobDir, `ssh_pass_${srv.id}.txt`);
      fs.writeFileSync(passFilePath, secret, { mode: 0o600 });
      fs.writeFileSync(
        askPassPath,
        `#!/bin/sh\ncat "${passFilePath}"\n`,
        { mode: 0o700 }
      );
      // If sshpass is available, Ansible can also use ansible_ssh_pass; we provide both askpass via Proxy/env or sshpass
      if (!/\s/.test(secret) && !secret.includes("'") && !secret.includes('"')) {
        baseParts.push(`ansible_ssh_pass=${secret}`);
      } else {
        baseParts.push(`ansible_ssh_pass="${secret.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      }
      redactedParts.push(`ansible_ssh_pass=***REDACTED***`);
    }

    const groupLines = groups.get(group) || [];
    groupLines.push(baseParts.join(' '));
    groups.set(group, groupLines);

    const redLines = redactedGroups.get(group) || [];
    redLines.push(redactedParts.join(' '));
    redactedGroups.set(group, redLines);
  }

  const iniSections: string[] = [];
  const redactedSections: string[] = [];

  for (const [group, lines] of groups.entries()) {
    iniSections.push(`[${group}]\n${lines.join('\n')}\n`);
  }
  for (const [group, lines] of redactedGroups.entries()) {
    redactedSections.push(`[${group}]\n${lines.join('\n')}\n`);
  }

  const inventoryContent = iniSections.join('\n');
  const inventoryPath = path.join(params.jobDir, 'hosts.ini');
  fs.writeFileSync(inventoryPath, inventoryContent, { mode: 0o600 });

  return {
    inventoryPath,
    inventoryPreviewRedacted: redactedSections.join('\n'),
    secretsToRedact,
  };
}

interface ActiveJobExecution {
  jobId: number;
  userUid: string;
  process: ChildProcess | null;
  cancelled: boolean;
  timedOut: boolean;
  emitter: EventEmitter;
  stdout: string;
  stderr: string;
  status: AnsibleJobStatus;
}

class AnsibleJobManager {
  private activeJobs = new Map<number, ActiveJobExecution>();

  public getActiveJob(jobId: number): ActiveJobExecution | undefined {
    return this.activeJobs.get(jobId);
  }

  public cancelJob(jobId: number): boolean {
    const active = this.activeJobs.get(jobId);
    if (!active) return false;
    active.cancelled = true;
    if (active.process && !active.process.killed) {
      try {
        active.process.kill('SIGTERM');
        setTimeout(() => {
          if (active.process && !active.process.killed) {
            try {
              active.process.kill('SIGKILL');
            } catch {
              // Ignore
            }
          }
        }, 2000);
      } catch {
        // Ignore
      }
    }
    return true;
  }

  public async startJob(params: {
    userUid: string;
    playbookId: number;
    inventoryId: number;
    checkMode?: boolean;
    diffMode?: boolean;
    tags?: unknown;
    extraVars?: unknown;
  }): Promise<AnsibleJobView> {
    const runtime = await checkAnsibleRuntime();
    if (!runtime.available) {
      throw new Error(runtime.error || 'Ansible is not installed or unavailable');
    }

    const playbook = await getPlaybookById(params.playbookId, params.userUid);
    if (!playbook) {
      throw new Error('Playbook not found');
    }

    const staticValidation = validatePlaybookStaticSecurity(playbook.content);
    if (!staticValidation.ok) {
      throw new Error(staticValidation.error || 'Invalid playbook content');
    }

    const inventory = await getInventoryById(params.inventoryId, params.userUid);
    if (!inventory) {
      throw new Error('Inventory not found');
    }

    const serverRecords = await getInventoryFullServerRecords(
      params.inventoryId,
      params.userUid
    );
    if (serverRecords.length === 0) {
      throw new Error(
        'Selected Ansible Inventory has no servers assigned. Add at least one server to run the playbook.'
      );
    }

    const tagsResult = validateAndNormalizeTags(params.tags);
    if (!tagsResult.ok) {
      throw new Error(tagsResult.error || 'Invalid tags');
    }

    const varsResult = validateAndRedactExtraVars(params.extraVars);
    if (!varsResult.ok) {
      throw new Error(varsResult.error || 'Invalid extra_vars');
    }

    const checkMode = Boolean(params.checkMode);
    const diffMode = Boolean(params.diffMode);

    const jobRecord = await createAnsibleJobRecord({
      playbookId: playbook.id,
      playbookName: playbook.name,
      inventoryId: inventory.id,
      inventoryName: inventory.name,
      checkMode,
      diffMode,
      tags: tagsResult.tags,
      redactedExtraVars: varsResult.redactedVars,
      createdBy: params.userUid,
    });

    const targetServersSummary = serverRecords.map((s) => ({
      id: s.id,
      name: s.name,
      ip_address: s.ipAddress,
    }));

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    const activeExec: ActiveJobExecution = {
      jobId: jobRecord.id,
      userUid: params.userUid,
      process: null,
      cancelled: false,
      timedOut: false,
      emitter,
      stdout: '',
      stderr: '',
      status: 'PENDING',
    };

    this.activeJobs.set(jobRecord.id, activeExec);

    // Launch execution asynchronously in background
    void this.executeJobProcess({
      activeExec,
      playbookContent: playbook.content,
      playbookName: playbook.name,
      inventoryName: inventory.name,
      serverRecords,
      targetServersSummary,
      checkMode,
      diffMode,
      tags: tagsResult.tags,
      cleanExtraVars: varsResult.cleanVars,
      extraVarSecrets: varsResult.secretValues,
    });

    return jobRecord;
  }

  private async executeJobProcess(params: {
    activeExec: ActiveJobExecution;
    playbookContent: string;
    playbookName: string;
    inventoryName: string;
    serverRecords: Awaited<ReturnType<typeof getInventoryFullServerRecords>>;
    targetServersSummary: { id: number; name: string; ip_address: string }[];
    checkMode: boolean;
    diffMode: boolean;
    tags: string[];
    cleanExtraVars: Record<string, string | number | boolean>;
    extraVarSecrets: string[];
  }): Promise<void> {
    const { activeExec } = params;
    const cfg = getAnsibleConfig();
    const startTime = Date.now();
    const startedAt = new Date();

    const jobDir = fs.mkdtempSync(
      path.join(cfg.workDir, `job-${activeExec.jobId}-${crypto.randomBytes(4).toString('hex')}-`)
    );
    fs.chmodSync(jobDir, 0o700);

    try {
      activeExec.status = 'RUNNING';
      await updateAnsibleJobState(activeExec.jobId, {
        status: 'RUNNING',
        startedAt,
      });

      await createAutomationAuditLogRecord({
        eventType: 'automation.job.started',
        jobId: activeExec.jobId,
        userUid: activeExec.userUid,
        playbookName: params.playbookName,
        inventoryName: params.inventoryName,
        targetServers: params.targetServersSummary,
        result: `Started playbook "${params.playbookName}" on inventory "${params.inventoryName}" (${params.serverRecords.length} host(s))`,
      });

      activeExec.emitter.emit('status', {
        status: 'RUNNING',
        started_at: startedAt.toISOString(),
      });

      const { inventoryPath, secretsToRedact } = buildInventoryIniAndSecrets({
        jobDir,
        servers: params.serverRecords,
      });

      const allSecrets = [...secretsToRedact, ...params.extraVarSecrets];

      const playbookPath = path.join(jobDir, 'playbook.yml');
      fs.writeFileSync(playbookPath, params.playbookContent, { mode: 0o600 });

      const ansibleCfgPath = path.join(jobDir, 'ansible.cfg');
      fs.writeFileSync(
        ansibleCfgPath,
        [
          '[defaults]',
          'host_key_checking = False',
          'retry_files_enabled = False',
          'interpreter_python = auto_silent',
          'timeout = 10',
          'forks = 10',
          '[ssh_connection]',
          'pipelining = True',
          'ssh_args = -o ControlMaster=no -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8',
          '',
        ].join('\n'),
        { mode: 0o600 }
      );

      const cliArgs: string[] = ['-i', inventoryPath, playbookPath];

      if (params.checkMode) {
        cliArgs.push('--check');
      }
      if (params.diffMode) {
        cliArgs.push('--diff');
      }
      if (params.tags.length > 0) {
        cliArgs.push('--tags', params.tags.join(','));
      }
      if (Object.keys(params.cleanExtraVars).length > 0) {
        const extraVarsPath = path.join(jobDir, 'extra_vars.json');
        fs.writeFileSync(extraVarsPath, JSON.stringify(params.cleanExtraVars), {
          mode: 0o600,
        });
        cliArgs.push('--extra-vars', `@${extraVarsPath}`);
      }

      const child = spawn(cfg.ansiblePlaybookBin, cliArgs, {
        cwd: jobDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ANSIBLE_CONFIG: ansibleCfgPath,
          ANSIBLE_HOST_KEY_CHECKING: 'False',
          ANSIBLE_RETRY_FILES_ENABLED: 'False',
          ANSIBLE_FORCE_COLOR: '0',
          ANSIBLE_NOCOLOR: '1',
          PYTHONUNBUFFERED: '1',
        },
      });

      activeExec.process = child;

      const timeoutTimer = setTimeout(() => {
        activeExec.timedOut = true;
        if (!child.killed) {
          try {
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!child.killed) {
                try {
                  child.kill('SIGKILL');
                } catch {
                  // Ignore
                }
              }
            }, 2000);
          } catch {
            // Ignore
          }
        }
      }, cfg.timeoutSec * 1000);

      let lastFlushMs = Date.now();
      const maybeFlushProgress = async () => {
        const now = Date.now();
        if (now - lastFlushMs < 800) return;
        lastFlushMs = now;
        try {
          await updateAnsibleJobState(activeExec.jobId, {
            stdout: activeExec.stdout,
            stderr: activeExec.stderr,
            durationMs: Math.max(1, now - startTime),
          });
        } catch {
          // Ignore intermittent flush errors
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const cleanChunk = sanitizeOutputText(chunk.toString('utf8'), allSecrets);
        if (activeExec.stdout.length < MAX_JOB_OUTPUT_CHARS) {
          activeExec.stdout += cleanChunk.slice(
            0,
            MAX_JOB_OUTPUT_CHARS - activeExec.stdout.length
          );
        }
        activeExec.emitter.emit('output', {
          stream: 'stdout',
          chunk: cleanChunk,
          timestamp: new Date().toISOString(),
        });
        void maybeFlushProgress();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const cleanChunk = sanitizeOutputText(chunk.toString('utf8'), allSecrets);
        if (activeExec.stderr.length < MAX_JOB_OUTPUT_CHARS) {
          activeExec.stderr += cleanChunk.slice(
            0,
            MAX_JOB_OUTPUT_CHARS - activeExec.stderr.length
          );
        }
        activeExec.emitter.emit('output', {
          stream: 'stderr',
          chunk: cleanChunk,
          timestamp: new Date().toISOString(),
        });
        void maybeFlushProgress();
      });

      const exitCode: number = await new Promise((resolve) => {
        child.on('error', (err) => {
          const msg = sanitizeOutputText(
            `\nAnsible execution error: ${err.message}\n`,
            allSecrets
          );
          activeExec.stderr += msg;
          activeExec.emitter.emit('output', {
            stream: 'stderr',
            chunk: msg,
            timestamp: new Date().toISOString(),
          });
          resolve(255);
        });

        child.on('close', (code) => {
          resolve(typeof code === 'number' ? code : activeExec.cancelled ? 130 : 1);
        });
      });

      clearTimeout(timeoutTimer);

      // Immediately purge ephemeral SSH keys, inventory, and playbook files on process exit
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }

      const finishedAt = new Date();
      const durationMs = Math.max(1, Date.now() - startTime);

      let finalStatus: AnsibleJobStatus = 'SUCCESS';
      if (activeExec.cancelled) {
        finalStatus = 'CANCELLED';
        const cancelMsg = '\n[InfraLab] Job cancelled by operator.\n';
        activeExec.stderr += cancelMsg;
        activeExec.emitter.emit('output', {
          stream: 'stderr',
          chunk: cancelMsg,
          timestamp: finishedAt.toISOString(),
        });
      } else if (activeExec.timedOut) {
        finalStatus = 'FAILED';
        const timeoutMsg = `\n[InfraLab] Job timed out after ${cfg.timeoutSec}s.\n`;
        activeExec.stderr += timeoutMsg;
        activeExec.emitter.emit('output', {
          stream: 'stderr',
          chunk: timeoutMsg,
          timestamp: finishedAt.toISOString(),
        });
      } else if (exitCode !== 0) {
        finalStatus = 'FAILED';
      }

      await updateAnsibleJobState(activeExec.jobId, {
        status: finalStatus,
        stdout: activeExec.stdout,
        stderr: activeExec.stderr,
        exitCode,
        durationMs,
        finishedAt,
      });

      const auditEventType =
        finalStatus === 'SUCCESS'
          ? 'automation.job.completed'
          : finalStatus === 'CANCELLED'
          ? 'automation.job.cancelled'
          : 'automation.job.failed';

      await createAutomationAuditLogRecord({
        eventType: auditEventType,
        jobId: activeExec.jobId,
        userUid: activeExec.userUid,
        playbookName: params.playbookName,
        inventoryName: params.inventoryName,
        targetServers: params.targetServersSummary,
        result: `${finalStatus} (exit=${exitCode}, duration=${durationMs}ms)`,
      });

      activeExec.status = finalStatus;

      activeExec.emitter.emit('done', {
        status: finalStatus,
        exit_code: exitCode,
        duration_ms: durationMs,
        finished_at: finishedAt.toISOString(),
      });
    } catch (err: any) {
      const finishedAt = new Date();
      const durationMs = Math.max(1, Date.now() - startTime);
      const errMsg = err?.message || 'Unexpected error during Ansible job execution';
      activeExec.stderr += `\n${errMsg}\n`;
      activeExec.status = 'FAILED';

      await updateAnsibleJobState(activeExec.jobId, {
        status: 'FAILED',
        stdout: activeExec.stdout,
        stderr: activeExec.stderr,
        exitCode: 255,
        durationMs,
        finishedAt,
      });

      await createAutomationAuditLogRecord({
        eventType: 'automation.job.failed',
        jobId: activeExec.jobId,
        userUid: activeExec.userUid,
        playbookName: params.playbookName,
        inventoryName: params.inventoryName,
        targetServers: params.targetServersSummary,
        result: `FAILED: ${errMsg}`,
      });

      activeExec.emitter.emit('done', {
        status: 'FAILED',
        exit_code: 255,
        duration_ms: durationMs,
        finished_at: finishedAt.toISOString(),
      });
    } finally {
      this.activeJobs.delete(activeExec.jobId);
      try {
        fs.rmSync(jobDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

export const ansibleJobManager = new AnsibleJobManager();

const STARTER_PLAYBOOKS: {
  name: string;
  description: string;
  content: string;
}[] = [
  {
    name: 'Node Readiness & Health Audit',
    description:
      'Collects kernel version, system uptime, disk capacity, memory usage, and verifies SSH connectivity across all target hosts.',
    content: `---
- name: Node Readiness & Health Audit
  hosts: all
  gather_facts: false
  tasks:
    - name: Verify host connectivity (ping)
      ansible.builtin.ping:
      tags:
        - ping
        - health

    - name: Inspect kernel, uptime, and filesystem usage
      ansible.builtin.shell: |
        echo "=== HOSTNAME & KERNEL ==="
        uname -snrm
        uptime
        echo "=== DISK SPACE ==="
        df -h /
        echo "=== MEMORY (MB) ==="
        free -m || true
      args:
        executable: /bin/sh
      register: health_report
      changed_when: false
      tags:
        - health
        - audit

    - name: Print node health report
      ansible.builtin.debug:
        var: health_report.stdout_lines
      tags:
        - health
`,
  },
  {
    name: 'Docker Engine & Container Status Sync',
    description:
      'Verifies Docker Engine availability, inspects active containers, and optionally prunes dangling images.',
    content: `---
- name: Docker Engine & Container Status Sync
  hosts: all
  gather_facts: false
  vars:
    prune_dangling: false
  tasks:
    - name: Check Docker CLI and daemon status
      ansible.builtin.shell: |
        if command -v docker >/dev/null 2>&1; then
          docker version --format 'Docker Server {{.Server.Version}}' 2>/dev/null || sudo -n docker version --format 'Docker Server {{.Server.Version}}'
          docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || sudo -n docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
        else
          echo "Docker is not installed on this host"
        fi
      args:
        executable: /bin/sh
      register: docker_status
      changed_when: false
      tags:
        - docker
        - status

    - name: Prune dangling Docker images when prune_dangling=true
      ansible.builtin.shell: |
        docker image prune -f 2>/dev/null || sudo -n docker image prune -f
      args:
        executable: /bin/sh
      when: prune_dangling | bool
      tags:
        - docker
        - prune

    - name: Display Docker summary
      ansible.builtin.debug:
        var: docker_status.stdout_lines
      tags:
        - docker
`,
  },
  {
    name: 'Security & Listening Sockets Audit',
    description:
      'Audits listening TCP/UDP network sockets, active user sessions, and SSH daemon configuration.',
    content: `---
- name: Security & Listening Sockets Audit
  hosts: all
  gather_facts: false
  tasks:
    - name: Inspect listening TCP/UDP ports and active sessions
      ansible.builtin.shell: |
        echo "=== ACTIVE SESSIONS ==="
        who || true
        echo "=== LISTENING SOCKETS ==="
        ss -tuln | head -n 25
      args:
        executable: /bin/sh
      register: sec_audit
      changed_when: false
      tags:
        - security
        - network

    - name: Output security audit summary
      ansible.builtin.debug:
        var: sec_audit.stdout_lines
      tags:
        - security
`,
  },
];

export async function ensureStarterPlaybooksForUser(userUid: string): Promise<void> {
  const existing = await listPlaybooksByUser(userUid);
  if (existing.length > 0) return;

  for (const item of STARTER_PLAYBOOKS) {
    try {
      const created = await createPlaybookRecord({
        userUid,
        name: item.name,
        description: item.description,
        content: item.content,
        validationStatus: 'valid',
        validationMessage: 'Verified starter Ansible Playbook',
      });
      // Optionally keep validationStatus='valid'
      void created;
    } catch {
      // Ignore duplicate or seed errors
    }
  }
}

export async function validateAndSavePlaybookById(
  playbookId: number,
  userUid: string
) {
  const pb = await getPlaybookById(playbookId, userUid);
  if (!pb) return null;

  const result = await validatePlaybookWithAnsibleCli(pb.content);
  const updated = await updatePlaybookRecord({
    id: pb.id,
    userUid,
    validationStatus: result.status,
    validationMessage: result.message,
  });
  return {
    playbook: updated,
    validation: result,
  };
}
