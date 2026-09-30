export type ServerStatus = 'unknown' | 'online' | 'offline';
export type SshAuthType = 'password' | 'private_key';

export interface Server {
  id: number;
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  username: string;
  auth_type: SshAuthType;
  has_secret: boolean;
  description: string;
  status: ServerStatus;
  last_check_error: string;
  last_checked_at: string | null;
  latency_ms: number | null;
  os_info: string;
  kernel_info: string;
  cpu_cores: number | null;
  cpu_load: string;
  cpu_usage_percent: number | null;
  memory_mb: number | null;
  memory_used_mb: number | null;
  disk_total_gb: string;
  disk_used_gb: string;
  disk_usage_percent: number | null;
  uptime_info: string;
  created_at: string;
  updated_at: string;
}

export interface DiskPartitionInfo {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercent: number;
  mountpoint: string;
}

export interface ProcessInfo {
  pid: string;
  user: string;
  cpuPercent: string;
  memPercent: string;
  command: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  state: string;
  addresses: string;
}

export interface ListeningPortInfo {
  proto: string;
  local_address: string;
  port: string;
  process: string;
}

export interface ServerNetworkInspectionResponse {
  server_id: number;
  interfaces: NetworkInterfaceInfo[];
  listening_ports: ListeningPortInfo[];
  routes: string[];
  dns_servers: string[];
  connections_summary: string;
  inspected_at: string;
}

export interface ServerMetricPoint {
  id: number;
  server_id: number;
  cpu_usage_percent: number;
  memory_usage_percent: number;
  memory_used_mb: number;
  disk_usage_percent: number;
  load_1m: number;
  latency_ms: number;
  recorded_at: string;
}

export interface LiveTelemetryResponse {
  server: Server;
  filesystems: DiskPartitionInfo[];
  top_processes: ProcessInfo[];
  network_interfaces: NetworkInterfaceInfo[];
  metrics_history: ServerMetricPoint[];
}

export interface SshCommandLog {
  id: number;
  server_id: number;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  executed_at: string;
}

export interface DockerContainerInfo {
  id: string;
  full_id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created_at: string;
  cpu_percent: string;
  mem_usage: string;
  mem_percent: string;
  net_io: string;
  block_io: string;
  pids: string;
}

export interface DockerImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created_since: string;
}

export interface DockerNetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerInspectionResponse {
  server_id: number;
  daemon_active: boolean;
  docker_version: string;
  error: string;
  containers: DockerContainerInfo[];
  images: DockerImageInfo[];
  networks: DockerNetworkInfo[];
  inspected_at: string;
}

export type DockerContainerAction = 'start' | 'stop' | 'restart' | 'remove';

export interface DockerRunContainerInput {
  name?: string;
  image: string;
  ports?: string;
  env?: string;
  restart_policy?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  command?: string;
}

export interface DockerLogsResponse {
  container_id: string;
  logs: string;
  fetched_at: string;
}

export type SystemLogSource = 'journald' | 'auth' | 'kernel' | 'docker';
export type LogSeverity = 'error' | 'warn' | 'info';

export interface SystemLogLine {
  line_number: number;
  timestamp: string;
  severity: LogSeverity;
  service: string;
  message: string;
  raw: string;
}

export interface ServerLogsResponse {
  server_id: number;
  source: SystemLogSource;
  tail: number;
  raw_output: string;
  lines: SystemLogLine[];
  fetched_at: string;
}

export interface ServerGeoLocation {
  server: Server;
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

export interface CreateServerInput {
  name: string;
  hostname: string;
  ip_address: string;
  ssh_port: number;
  username: string;
  auth_type: SshAuthType;
  secret: string;
  description: string;
  verify_now?: boolean;
}

export interface UpdateCredentialsInput {
  username?: string;
  ssh_port?: number;
  auth_type: SshAuthType;
  secret: string;
  verify_now?: boolean;
}

export interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
}

export type AgentInstallStatus = 'ONLINE' | 'OFFLINE' | 'NOT INSTALLED';

export interface ServerAgentInfo {
  server_id: number;
  status: AgentInstallStatus;
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

export type MonitoringTimeRange = '1h' | '6h' | '24h' | '7d';

export interface PrometheusMetricPoint {
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  net_rx_kbps: number;
  net_tx_kbps: number;
  uptime_seconds: number;
  load1?: number;
  load5?: number;
  load15?: number;
}

export interface ServerMonitoringResponse {
  server_id: number;
  range: MonitoringTimeRange;
  step_seconds: number;
  source: 'prometheus' | 'agent_tsdb';
  prometheus_connected?: boolean;
  exporter_type?: string;
  agent_status?: AgentInstallStatus;
  scrape_target: string;
  raw_metrics_preview?: string[];
  promql_queries: {
    cpu: string;
    memory: string;
    disk: string;
    network_rx: string;
    network_tx: string;
    uptime: string;
    load?: string;
  };
  summary: {
    current_cpu_percent: number;
    current_memory_percent: number;
    current_disk_percent: number;
    current_rx_kbps: number;
    current_tx_kbps: number;
    uptime_seconds: number;
    load1?: number;
    load5?: number;
    load15?: number;
  };
  series: PrometheusMetricPoint[];
}


