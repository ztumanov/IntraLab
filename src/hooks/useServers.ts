import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkAllServers,
  checkServerConnection,
  createServer,
  createSftpDirectory,
  deleteServer,
  deleteSftpPath,
  executeSshCommandOnServer,
  fetchHealth,
  fetchServerAgent,
  fetchServerById,
  fetchServerCommandLogs,
  fetchServerDocker,
  fetchServerMonitoring,
  fetchServerNetwork,
  fetchServers,
  fetchServersGeolocation,
  fetchServerSystemLogs,
  fetchServerTelemetry,
  fetchSftpDirectory,
  installServerAgentViaSsh,
  launchDockerContainer,
  readSftpFile,
  rotateServerAgentToken,
  stopServerAgentViaSsh,
  triggerDockerContainerAction,
  updateServerCredentials,
  writeSftpFile,
} from '../api/servers.ts';
import {
  CreateServerInput,
  DockerContainerAction,
  DockerRunContainerInput,
  MonitoringTimeRange,
  SystemLogSource,
  UpdateCredentialsInput,
} from '../types/server.ts';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30000,
  });
}

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: fetchServers,
  });
}

export function useServersGeolocation() {
  return useQuery({
    queryKey: ['servers', 'geolocation'],
    queryFn: fetchServersGeolocation,
  });
}

export function useServer(id: number) {
  return useQuery({
    queryKey: ['servers', id],
    queryFn: () => fetchServerById(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useServerAgent(id: number) {
  return useQuery({
    queryKey: ['servers', id, 'agent'],
    queryFn: () => fetchServerAgent(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: false,
  });
}

export function useServerMonitoring(
  id: number,
  range: MonitoringTimeRange,
  autoRefreshMs: number | false = false
) {
  return useQuery({
    queryKey: ['servers', id, 'monitoring', range],
    queryFn: () => fetchServerMonitoring(id, range),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: autoRefreshMs,
  });
}

export function useRotateServerAgentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => rotateServerAgentToken(id),
    onSuccess: (updated, id) => {
      queryClient.setQueryData(['servers', id, 'agent'], updated);
    },
  });
}

export function useInstallServerAgentViaSsh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => installServerAgentViaSsh(id),
    onSuccess: (updated, id) => {
      queryClient.setQueryData(['servers', id, 'agent'], updated);
      queryClient.invalidateQueries({ queryKey: ['servers', id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', id, 'monitoring'] });
    },
  });
}

export function useStopServerAgentViaSsh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => stopServerAgentViaSsh(id),
    onSuccess: (updated, id) => {
      queryClient.setQueryData(['servers', id, 'agent'], updated);
      queryClient.invalidateQueries({ queryKey: ['servers', id, 'monitoring'] });
    },
  });
}

export function useServerTelemetry(id: number, autoRefreshMs: number | false = false) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['servers', id, 'telemetry'],
    queryFn: async () => {
      const data = await fetchServerTelemetry(id);
      queryClient.setQueryData(['servers', id], data.server);
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      return data;
    },
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: autoRefreshMs,
  });
}

export function useServerDocker(id: number, autoRefreshMs: number | false = false) {
  return useQuery({
    queryKey: ['servers', id, 'docker'],
    queryFn: () => fetchServerDocker(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: autoRefreshMs,
  });
}

export function useServerNetwork(id: number) {
  return useQuery({
    queryKey: ['servers', id, 'network'],
    queryFn: () => fetchServerNetwork(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useDockerContainerAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      containerId,
      action,
    }: {
      serverId: number;
      containerId: string;
      action: DockerContainerAction;
    }) => triggerDockerContainerAction(serverId, containerId, action),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'docker'],
      });
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'commands'],
      });
    },
  });
}

export function useLaunchDockerContainer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      input,
    }: {
      serverId: number;
      input: DockerRunContainerInput;
    }) => launchDockerContainer(serverId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'docker'],
      });
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'commands'],
      });
    },
  });
}

export function useServerCommandLogs(id: number) {
  return useQuery({
    queryKey: ['servers', id, 'commands'],
    queryFn: () => fetchServerCommandLogs(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useServerSystemLogs(
  id: number,
  source: SystemLogSource,
  tail: number,
  autoRefreshMs: number | false = false
) {
  return useQuery({
    queryKey: ['servers', id, 'logs', source, tail],
    queryFn: () => fetchServerSystemLogs(id, source, tail),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: autoRefreshMs,
  });
}

export function useExecuteSshCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command }: { id: number; command: string }) =>
      executeSshCommandOnServer(id, command),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.id, 'commands'],
      });
    },
  });
}

export function useCreateServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServerInput) => createServer(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', 'geolocation'] });
    },
  });
}

export function useUpdateServerCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateCredentialsInput }) =>
      updateServerCredentials(id, input),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', 'geolocation'] });
      queryClient.setQueryData(['servers', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['servers', updated.id, 'telemetry'] });
      queryClient.invalidateQueries({ queryKey: ['servers', updated.id, 'docker'] });
    },
  });
}

export function useCheckServerConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => checkServerConnection(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', 'geolocation'] });
      queryClient.setQueryData(['servers', updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ['servers', updated.id, 'telemetry'] });
      queryClient.invalidateQueries({ queryKey: ['servers', updated.id, 'docker'] });
    },
  });
}

export function useCheckAllServers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => checkAllServers(),
    onSuccess: (updatedList) => {
      queryClient.setQueryData(['servers'], updatedList);
      queryClient.invalidateQueries({ queryKey: ['servers', 'geolocation'] });
    },
  });
}

export function useDeleteServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteServer(id),
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers', 'geolocation'] });
      queryClient.removeQueries({ queryKey: ['servers', deletedId] });
    },
  });
}

export function useSftpDirectory(serverId: number, path: string) {
  return useQuery({
    queryKey: ['servers', serverId, 'sftp', 'list', path],
    queryFn: () => fetchSftpDirectory(serverId, path),
    enabled: Number.isInteger(serverId) && serverId > 0 && Boolean(path),
  });
}

export function useWriteSftpFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      path,
      content,
      encoding,
      useSudo,
    }: {
      serverId: number;
      path: string;
      content: string;
      encoding?: 'utf8' | 'base64';
      useSudo?: boolean;
    }) =>
      writeSftpFile(serverId, {
        path,
        content,
        encoding,
        use_sudo: useSudo,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'sftp', 'list'],
      });
    },
  });
}

export function useCreateSftpDirectory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      path,
      useSudo,
    }: {
      serverId: number;
      path: string;
      useSudo?: boolean;
    }) => createSftpDirectory(serverId, path, useSudo),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'sftp', 'list'],
      });
    },
  });
}

export function useDeleteSftpPath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      serverId,
      path,
      useSudo,
    }: {
      serverId: number;
      path: string;
      useSudo?: boolean;
    }) => deleteSftpPath(serverId, path, useSudo),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['servers', variables.serverId, 'sftp', 'list'],
      });
    },
  });
}

export { readSftpFile };
