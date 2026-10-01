import { getInMemoryAuthToken } from '../context/AuthContext.tsx';
import {
  CreateServerInput,
  DockerContainerAction,
  DockerInspectionResponse,
  DockerLogsResponse,
  DockerRunContainerInput,
  HealthStatus,
  LiveTelemetryResponse,
  MonitoringTimeRange,
  Server,
  ServerAgentInfo,
  ServerGeoLocation,
  ServerLogsResponse,
  ServerMonitoringResponse,
  ServerNetworkInspectionResponse,
  SftpDirectoryListResponse,
  SftpFileReadResponse,
  SshCommandLog,
  SystemLogSource,
  UpdateCredentialsInput,
} from '../types/server.ts';

export class ApiRequestError extends Error {
  status: number;
  details?: Record<string, string>;

  constructor(message: string, status: number, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
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

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new ApiRequestError('Health check failed', response.status);
  }
  return response.json();
}

export async function fetchServers(): Promise<Server[]> {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/servers', { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch servers',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServersGeolocation(): Promise<ServerGeoLocation[]> {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/servers/geolocation', { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch server geolocations',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerById(id: number): Promise<Server> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch server details',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function createServer(input: CreateServerInput): Promise<Server> {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/servers', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to create server',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function updateServerCredentials(
  id: number,
  input: UpdateCredentialsInput
): Promise<Server> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/credentials`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to update SSH credentials',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function checkServerConnection(id: number): Promise<Server> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/check`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to check SSH connection',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function checkAllServers(): Promise<Server[]> {
  const headers = await getAuthHeaders();
  const response = await fetch('/api/servers/check-all', {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to check servers',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerTelemetry(
  id: number,
  signal?: AbortSignal
): Promise<LiveTelemetryResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/telemetry`, { headers, signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to collect live telemetry',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerNetwork(id: number): Promise<ServerNetworkInspectionResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/network`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to inspect server network',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerDocker(id: number): Promise<DockerInspectionResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/docker`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to inspect Docker on server',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function triggerDockerContainerAction(
  serverId: number,
  containerId: string,
  action: DockerContainerAction
): Promise<{ ok: boolean; action: string; container_id: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${serverId}/docker/containers/${encodeURIComponent(containerId)}/action`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ action }),
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || `Failed to ${action} container`,
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchDockerLogs(
  serverId: number,
  containerId: string,
  tail = 120
): Promise<DockerLogsResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${serverId}/docker/containers/${encodeURIComponent(containerId)}/logs?tail=${tail}`,
    { headers }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch container logs',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function launchDockerContainer(
  serverId: number,
  input: DockerRunContainerInput
): Promise<{ ok: boolean; container_id: string; command: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${serverId}/docker/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to launch container',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerCommandLogs(id: number): Promise<SshCommandLog[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/commands`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch SSH command logs',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerSystemLogs(
  id: number,
  source: SystemLogSource = 'journald',
  tail = 100
): Promise<ServerLogsResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${id}/logs?source=${encodeURIComponent(source)}&tail=${tail}`,
    { headers }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch system logs over SSH',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function executeSshCommandOnServer(
  id: number,
  command: string
): Promise<SshCommandLog> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/exec`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ command }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to execute SSH command',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function deleteServer(id: number): Promise<void> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to delete server',
      response.status,
      body.details
    );
  }
}

export async function fetchServerAgent(id: number): Promise<ServerAgentInfo> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/agent`, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch server agent status',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function rotateServerAgentToken(id: number): Promise<ServerAgentInfo> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/agent/token`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to rotate enrollment token',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function installServerAgentViaSsh(id: number): Promise<ServerAgentInfo> {
  const headers = await getAuthHeaders();
  const serverUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const response = await fetch(`/api/servers/${id}/agent/install-ssh`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ server_url: serverUrl }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to install agent over SSH',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function stopServerAgentViaSsh(id: number): Promise<ServerAgentInfo> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/agent/stop`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to stop agent over SSH',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchServerMonitoring(
  id: number,
  range: MonitoringTimeRange = '1h',
  signal?: AbortSignal
): Promise<ServerMonitoringResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${id}/metrics?range=${encodeURIComponent(range)}`,
    { headers, signal }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to fetch Prometheus metrics for server',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function fetchSftpDirectory(
  serverId: number,
  path = '/etc'
): Promise<SftpDirectoryListResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${serverId}/sftp/list?path=${encodeURIComponent(path)}`,
    { headers }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to list remote directory via SFTP',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function readSftpFile(
  serverId: number,
  path: string,
  useSudo = false
): Promise<SftpFileReadResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${serverId}/sftp/read?path=${encodeURIComponent(path)}&sudo=${useSudo ? 'true' : 'false'}`,
    { headers }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to read remote file via SFTP',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function writeSftpFile(
  serverId: number,
  params: {
    path: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    use_sudo?: boolean;
  }
): Promise<{ path: string; size: number; updated_at: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${serverId}/sftp/write`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to write remote file via SFTP',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function createSftpDirectory(
  serverId: number,
  path: string,
  useSudo = false
): Promise<{ path: string; created_at: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${serverId}/sftp/mkdir`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path, use_sudo: useSudo }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to create remote directory',
      response.status,
      body.details
    );
  }
  return response.json();
}

export async function deleteSftpPath(
  serverId: number,
  path: string,
  useSudo = false
): Promise<{ deleted_path: string }> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${serverId}/sftp/delete`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ path, use_sudo: useSudo }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiRequestError(
      body.error || 'Failed to delete remote path',
      response.status,
      body.details
    );
  }
  return response.json();
}

