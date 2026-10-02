import { getInMemoryAuthToken } from '../context/AuthContext.tsx';
import { ApiRequestError } from './servers.ts';

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

export interface AnsibleInventory {
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

export interface AnsiblePlaybook {
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

export type AnsibleJobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface AnsibleJob {
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

export interface AutomationAuditLog {
  id: number;
  event_type: string;
  job_id: number;
  user_uid: string;
  playbook_name: string;
  inventory_name: string;
  target_servers: { id: number; name: string; ip_address: string }[];
  result: string;
  created_at: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getInMemoryAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchAutomationStatus(): Promise<AnsibleRuntimeStatus> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/status', { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to check Ansible runtime', res.status);
  }
  return body;
}

export async function fetchInventories(): Promise<AnsibleInventory[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/inventories', { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to load inventories', res.status);
  }
  return body;
}

export async function createInventory(input: {
  name: string;
  description?: string;
  group_name?: string;
  server_ids?: number[];
}): Promise<AnsibleInventory> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/inventories', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to create inventory', res.status);
  }
  return body;
}

export async function updateInventory(
  id: number,
  input: {
    name?: string;
    description?: string;
    group_name?: string;
    server_ids?: number[];
  }
): Promise<AnsibleInventory> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/inventories/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to update inventory', res.status);
  }
  return body;
}

export async function deleteInventory(id: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/inventories/${id}`, {
    method: 'DELETE',
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to delete inventory', res.status);
  }
}

export async function fetchPlaybooks(): Promise<AnsiblePlaybook[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/playbooks', { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to load playbooks', res.status);
  }
  return body;
}

export async function createPlaybook(input: {
  name: string;
  description?: string;
  content: string;
}): Promise<AnsiblePlaybook> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/playbooks', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to create playbook', res.status);
  }
  return body;
}

export async function updatePlaybook(
  id: number,
  input: {
    name?: string;
    description?: string;
    content?: string;
  }
): Promise<AnsiblePlaybook> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/playbooks/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to update playbook', res.status);
  }
  return body;
}

export async function deletePlaybook(id: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/playbooks/${id}`, {
    method: 'DELETE',
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to delete playbook', res.status);
  }
}

export async function validatePlaybookById(id: number): Promise<{
  playbook: AnsiblePlaybook;
  validation: { valid: boolean; status: 'valid' | 'invalid'; message: string };
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/playbooks/${id}/validate`, {
    method: 'POST',
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Playbook validation failed', res.status);
  }
  return body;
}

export async function validatePlaybookContent(content: string): Promise<{
  valid: boolean;
  status: 'valid' | 'invalid';
  message: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/playbooks/validate-content', {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Playbook validation failed', res.status);
  }
  return body;
}

export async function fetchAnsibleJobs(filters?: {
  status?: string;
  playbook_id?: number;
  inventory_id?: number;
  date_from?: string;
  date_to?: string;
}): Promise<AnsibleJob[]> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters?.playbook_id) params.set('playbook_id', String(filters.playbook_id));
  if (filters?.inventory_id) params.set('inventory_id', String(filters.inventory_id));
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);

  const qs = params.toString();
  const res = await fetch(`/api/automation/jobs${qs ? `?${qs}` : ''}`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to load Ansible jobs', res.status);
  }
  return body;
}

export async function fetchAnsibleJobById(id: number): Promise<AnsibleJob> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/jobs/${id}`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to load job details', res.status);
  }
  return body;
}

export async function startAnsibleJob(input: {
  playbook_id: number;
  inventory_id: number;
  check_mode?: boolean;
  diff_mode?: boolean;
  tags?: string[] | string;
  extra_vars?: Record<string, string | number | boolean> | string;
}): Promise<AnsibleJob> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to start Ansible job', res.status);
  }
  return body;
}

export async function cancelAnsibleJob(id: number): Promise<{
  id: number;
  cancelled: boolean;
  status: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/automation/jobs/${id}/cancel`, {
    method: 'POST',
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to cancel job', res.status);
  }
  return body;
}

export async function fetchAutomationAuditLogs(): Promise<AutomationAuditLog[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/automation/audit-logs', { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(body.error || 'Failed to load audit logs', res.status);
  }
  return body;
}
