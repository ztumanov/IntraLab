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

export async function fetchServerTelemetry(id: number): Promise<LiveTelemetryResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/servers/${id}/telemetry`, { headers });
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

export async function fetchServerMonitoring(
  id: number,
  range: MonitoringTimeRange = '1h'
): Promise<ServerMonitoringResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `/api/servers/${id}/metrics?range=${encodeURIComponent(range)}`,
    { headers }
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

