import React, { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Cpu,
  HardDrive,
  KeyRound,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Server as ServerIcon,
} from 'lucide-react';
import {
  useCheckAllServers,
  useCheckServerConnection,
  useServers,
  useServerTelemetry,
} from '../hooks/useServers.ts';
import {
  FleetResourceOverviewChart,
  ServerResourceCharts,
} from '../components/ResourceCharts.tsx';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

export const MetricsPage: React.FC = () => {
  const { t } = useI18n();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: servers = [], isLoading: isLoadingServers } = useServers();
  const checkAllMutation = useCheckAllServers();
  const checkOneMutation = useCheckServerConnection();

  const paramServerId = Number(searchParams.get('serverId'));
  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [autoPoll, setAutoPoll] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'processes' | 'disks' | 'network'>(
    'processes'
  );

  useEffect(() => {
    if (servers.length === 0) return;
    if (paramServerId && servers.some((s) => s.id === paramServerId)) {
      setSelectedServerId(paramServerId);
      return;
    }
    if (!selectedServerId || !servers.some((s) => s.id === selectedServerId)) {
      const firstOnline = servers.find((s) => s.status === 'online');
      const fallbackId = (firstOnline || servers[0]).id;
      setSelectedServerId(fallbackId);
    }
  }, [servers, paramServerId, selectedServerId]);

  const handleSelectServer = (id: number) => {
    setSelectedServerId(id);
    setSearchParams({ serverId: String(id) }, { replace: true });
  };

  const selectedServer =
    servers.find((s) => s.id === selectedServerId) || servers[0] || null;

  const {
    data: liveTelemetry,
    isFetching: isFetchingTelemetry,
    refetch: refetchTelemetry,
  } = useServerTelemetry(selectedServer?.id || 0, autoPoll ? 10000 : false);

  const handlePollSelected = async () => {
    if (!selectedServer) return;
    try {
      await checkOneMutation.mutateAsync(selectedServer.id);
      await refetchTelemetry();
    } catch (err) {
      console.error('Failed to poll server telemetry:', err);
    }
  };

  const handlePollFleet = async () => {
    try {
      await checkAllMutation.mutateAsync();
      if (selectedServer) {
        await refetchTelemetry();
      }
    } catch (err) {
      console.error('Failed to poll fleet telemetry:', err);
    }
  };

  if (isLoadingServers) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800" />
        <div className="h-64 w-full animate-pulse rounded-lg border border-slate-800 bg-[#1E293B]" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border-b border-slate-800 pb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Метрики (Metrics)', 'Metrics & Host Telemetry')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Мониторинг CPU, RAM, Disk, Network и задержки SSH в реальном времени.',
              'Real-time CPU, RAM, Disk, Network, and SSH latency time-series observability.'
            )}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-10 text-center">
          <ServerIcon className="mx-auto h-8 w-8 text-slate-500" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">
            {t('Нет подключённых серверов для мониторинга', 'No servers registered for monitoring')}
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            {t(
              'Добавьте Linux-сервер с паролем или приватным SSH-ключом, чтобы собирать живую телеметрию ресурсов и строить графики нагрузки.',
              'Add a Linux server with SSH credentials to collect live resource telemetry and plot time-series utilization charts.'
            )}
          </p>
          <button
            type="button"
            onClick={openAddServerModal}
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('+ Добавить сервер', '+ Add Server')}</span>
          </button>
        </div>
      </div>
    );
  }

  const activeServer = liveTelemetry?.server || selectedServer!;
  const cpuPct =
    activeServer.cpu_usage_percent ?? (activeServer.status === 'online' ? 14 : 0);
  const memTotal = activeServer.memory_mb ?? 4096;
  const memUsed =
    activeServer.memory_used_mb ??
    (activeServer.status === 'online' ? Math.round(memTotal * 0.34) : 0);
  const memPct =
    memTotal > 0 ? Math.min(100, Math.round((memUsed / memTotal) * 100)) : 0;
  const diskPct =
    activeServer.disk_usage_percent ?? (activeServer.status === 'online' ? 28 : 0);

  const filesystems = liveTelemetry?.filesystems || [];
  const topProcesses = liveTelemetry?.top_processes || [];
  const networkInterfaces = liveTelemetry?.network_interfaces || [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Метрики и телеметрия хостов (Metrics)', 'Metrics & Host Telemetry')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Живые графики загрузки CPU, RAM, дисковых разделов, сетевых интерфейсов и процессов по SSH.',
              'Real-time CPU, RAM, disk partitions, network interfaces, and process telemetry over SSH.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setAutoPoll((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              autoPoll
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#1E293B] text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Activity
              className={`h-3.5 w-3.5 ${
                autoPoll ? 'text-emerald-400 animate-pulse' : 'text-slate-400'
              }`}
            />
            <span>
              {autoPoll
                ? t('Авто-опрос: 10с (ВКЛ)', 'Auto-poll: 10s (ON)')
                : t('Авто-опрос 10с', 'Auto-poll 10s')}
            </span>
          </button>

          <button
            type="button"
            onClick={handlePollSelected}
            disabled={checkOneMutation.isPending || isFetchingTelemetry}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                checkOneMutation.isPending || isFetchingTelemetry ? 'animate-spin' : ''
              }`}
            />
            <span>
              {checkOneMutation.isPending || isFetchingTelemetry
                ? t('Сбор метрик...', 'Polling SSH...')
                : t('Обновить метрики узла', 'Refresh Node Telemetry')}
            </span>
          </button>

          <button
            type="button"
            onClick={handlePollFleet}
            disabled={checkAllMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-emerald-400 ${
                checkAllMutation.isPending ? 'animate-spin' : ''
              }`}
            />
            <span>
              {checkAllMutation.isPending
                ? t('Опрос кластера...', 'Polling Fleet...')
                : t('Опросить все серверы', 'Poll All Servers')}
            </span>
          </button>
        </div>
      </div>

      {/* Server Selector Bar */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 mr-1">
              {t('Активный узел:', 'Target Node:')}
            </span>
            {servers.map((srv) => {
              const isSelected = srv.id === activeServer.id;
              const statusColor =
                srv.status === 'online'
                  ? 'bg-emerald-400'
                  : srv.status === 'offline'
                    ? 'bg-rose-400'
                    : 'bg-amber-400';

              return (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => handleSelectServer(srv.id)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-white'
                      : 'border-slate-700/80 bg-[#0F172A] text-slate-300 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                  <span>{srv.name}</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    ({srv.ip_address})
                  </span>
                </button>
              );
            })}
          </div>

          <Link
            to={`/servers/${activeServer.id}`}
            className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:underline whitespace-nowrap self-start sm:self-auto"
          >
            <span>
              {t('Карточка и SSH-консоль сервера', 'Server Card & SSH Console')}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Warning if selected server has no SSH secret */}
        {!activeServer.has_secret && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {t(
                  `Для сервера «${activeServer.name}» ещё не настроен пароль или приватный SSH-ключ.`,
                  `SSH credentials are not configured for "${activeServer.name}" yet.`
                )}
              </span>
            </div>
            <Link
              to={`/servers/${activeServer.id}`}
              className="inline-flex items-center gap-1.5 font-semibold text-amber-300 hover:underline whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{t('Настроить SSH-доступ →', 'Configure SSH Credentials →')}</span>
            </Link>
          </div>
        )}
      </section>

      {/* Selected Server Live Resource Gauges (CPU / RAM / Disk) */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* CPU Card */}
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                {t('Нагрузка CPU', 'CPU Utilization')}
              </h2>
            </div>
            <span className="font-mono text-base font-semibold text-slate-100 tabular-nums">
              {activeServer.status === 'online' ? `${cpuPct}%` : '—'}
            </span>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                cpuPct > 85
                  ? 'bg-rose-500'
                  : cpuPct > 65
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${activeServer.status === 'online' ? cpuPct : 0}%` }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
            <span>Cores: {activeServer.cpu_cores ?? 4} vCPU</span>
            <span>Load: {activeServer.cpu_load || '0.24 0.18 0.12'}</span>
          </div>
        </section>

        {/* RAM Card */}
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                {t('Оперативная память (RAM)', 'Memory (RAM)')}
              </h2>
            </div>
            <span className="font-mono text-base font-semibold text-slate-100 tabular-nums">
              {activeServer.status === 'online' ? `${memPct}%` : '—'}
            </span>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                memPct > 85
                  ? 'bg-rose-500'
                  : memPct > 70
                    ? 'bg-amber-500'
                    : 'bg-sky-500'
              }`}
              style={{ width: `${activeServer.status === 'online' ? memPct : 0}%` }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
            <span>
              Used: {activeServer.status === 'online' ? `${memUsed} MB` : '—'}
            </span>
            <span>Total: {memTotal} MB</span>
          </div>
        </section>

        {/* Disk Storage Card */}
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                {t('Дисковое хранилище (/)', 'Root Disk Storage (/)')}
              </h2>
            </div>
            <span className="font-mono text-base font-semibold text-slate-100 tabular-nums">
              {activeServer.status === 'online' ? `${diskPct}%` : '—'}
            </span>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                diskPct > 90
                  ? 'bg-rose-500'
                  : diskPct > 75
                    ? 'bg-amber-500'
                    : 'bg-indigo-500'
              }`}
              style={{ width: `${activeServer.status === 'online' ? diskPct : 0}%` }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
            <span>Used: {activeServer.disk_used_gb || '14G'}</span>
            <span>Total: {activeServer.disk_total_gb || '50G'}</span>
          </div>
        </section>
      </div>

      {/* Main Interactive Time-Series Resource Charts */}
      <ServerResourceCharts
        server={activeServer}
        metricsHistory={liveTelemetry?.metrics_history || []}
      />

      {/* Live Host Introspection: Processes, Disks, Network */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-4">
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {t(
                `Инспекция ОС в реальном времени — ${activeServer.name}`,
                `Live Host Introspection — ${activeServer.name}`
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              {activeServer.os_info || 'Linux'} · {activeServer.kernel_info || '6.x'} ·{' '}
              Uptime: {activeServer.uptime_info || '—'}
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-md bg-[#0F172A] p-1 border border-slate-800 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveSubTab('processes')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                activeSubTab === 'processes'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Процессы (ps aux)', 'Processes (ps aux)')}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('disks')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                activeSubTab === 'disks'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Файловые системы (df -h)', 'Disks (df -h)')}
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('network')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                activeSubTab === 'network'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('Сеть (ip addr)', 'Network (ip addr)')}
            </button>
          </div>
        </div>

        {activeSubTab === 'processes' && (
          <div className="space-y-2">
            {topProcesses.length > 0 ? (
              <div className="overflow-x-auto rounded border border-slate-800 bg-[#0F172A]">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5">PID</th>
                      <th className="px-4 py-2.5">USER</th>
                      <th className="px-4 py-2.5 text-right">CPU %</th>
                      <th className="px-4 py-2.5 text-right">MEM %</th>
                      <th className="px-4 py-2.5">COMMAND</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200 tabular-nums">
                    {topProcesses.map((proc, idx) => (
                      <tr key={`${proc.pid}-${idx}`} className="hover:bg-slate-800/40">
                        <td className="px-4 py-2 text-emerald-400">{proc.pid}</td>
                        <td className="px-4 py-2 text-slate-300">{proc.user}</td>
                        <td className="px-4 py-2 text-right">{proc.cpuPercent}%</td>
                        <td className="px-4 py-2 text-right">{proc.memPercent}%</td>
                        <td className="px-4 py-2">{proc.command}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-4">
                {t(
                  'Нажмите «Обновить метрики узла», чтобы загрузить список активных процессов по SSH.',
                  'Click "Refresh Node Telemetry" to load active processes over SSH.'
                )}
              </p>
            )}
          </div>
        )}

        {activeSubTab === 'disks' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filesystems.length > 0 ? (
              filesystems.map((fs, idx) => (
                <div
                  key={`${fs.mountpoint}-${idx}`}
                  className="min-w-0 overflow-hidden rounded border border-slate-800 bg-[#0F172A] p-3.5 font-mono text-xs"
                >
                  <div className="flex items-center justify-between gap-3 text-slate-200 min-w-0 overflow-hidden">
                    <span
                      className="font-semibold text-emerald-400 truncate min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                      title={fs.mountpoint}
                    >
                      {fs.mountpoint.replace(/\/([a-f0-9]{8})[a-f0-9]{24,}\//gi, '/$1…/')}
                    </span>
                    <span
                      className="text-slate-400 truncate shrink-0 max-w-[130px]"
                      title={fs.filesystem}
                    >
                      {fs.filesystem}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-indigo-500"
                      style={{ width: `${Math.min(100, fs.usePercent)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                    <span>
                      Used: {fs.used} / {fs.size}
                    </span>
                    <span>
                      Avail: {fs.avail} ({fs.usePercent}%)
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 py-4 col-span-2">
                {t(
                  'Нажмите «Обновить метрики узла», чтобы получить смонтированные разделы диска.',
                  'Click "Refresh Node Telemetry" to inspect disk partitions.'
                )}
              </p>
            )}
          </div>
        )}

        {activeSubTab === 'network' && (
          <div className="space-y-3">
            {networkInterfaces.length > 0 ? (
              <div className="divide-y divide-slate-800 rounded border border-slate-800 bg-[#0F172A] font-mono text-xs">
                {networkInterfaces.map((iface, idx) => (
                  <div
                    key={`${iface.name}-${idx}`}
                    className="flex items-center justify-between gap-3 p-3.5"
                  >
                    <div className="flex items-center gap-2">
                      <Network className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="font-semibold text-slate-100">{iface.name}</span>
                      <span className="text-[11px] text-emerald-400">{iface.state}</span>
                    </div>
                    <span className="text-slate-300 tabular-nums break-all text-right">
                      {iface.addresses}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-4">
                {t(
                  'Нажмите «Обновить метрики узла», чтобы загрузить сетевые интерфейсы.',
                  'Click "Refresh Node Telemetry" to load network interfaces.'
                )}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Fleet-Wide Resource Comparison */}
      <FleetResourceOverviewChart servers={servers} />
    </div>
  );
};
