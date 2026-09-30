import React, { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Box,
  Check,
  Copy,
  FileText,
  KeyRound,
  Layers,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server as ServerIcon,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  useDockerContainerAction,
  useLaunchDockerContainer,
  useServerDocker,
  useServers,
} from '../hooks/useServers.ts';
import { fetchDockerLogs } from '../api/servers.ts';
import {
  DockerContainerAction,
  DockerContainerInfo,
  DockerRunContainerInput,
} from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

export const ContainersPage: React.FC = () => {
  const { t } = useI18n();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: servers = [], isLoading: isLoadingServers } = useServers();
  const paramServerId = Number(searchParams.get('serverId'));

  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [autoPoll, setAutoPoll] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'containers' | 'images' | 'networks'>(
    'containers'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<'all' | 'running' | 'stopped'>('all');

  // Action feedback & confirmation state
  const [pendingContainerKey, setPendingContainerKey] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Container logs viewer state
  const [inspectedContainer, setInspectedContainer] =
    useState<DockerContainerInfo | null>(null);
  const [containerLogsText, setContainerLogsText] = useState<string>('');
  const [isLoadingLogs, setIsLoadingLogs] = useState<boolean>(false);
  const [logTailLines, setLogTailLines] = useState<number>(120);
  const [copiedLogs, setCopiedLogs] = useState<boolean>(false);

  // Run new container modal state
  const [isRunModalOpen, setIsRunModalOpen] = useState<boolean>(false);
  const [runForm, setRunForm] = useState<DockerRunContainerInput>({
    name: '',
    image: 'nginx:alpine',
    ports: '',
    env: '',
    restart_policy: 'unless-stopped',
    command: '',
  });
  const [runError, setRunError] = useState<string | null>(null);

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
    setInspectedContainer(null);
    setActionError(null);
  };

  const selectedServer =
    servers.find((s) => s.id === selectedServerId) || servers[0] || null;

  const {
    data: dockerData,
    isLoading: isLoadingDocker,
    isFetching: isFetchingDocker,
    refetch: refetchDocker,
  } = useServerDocker(selectedServer?.id || 0, autoPoll ? 15000 : false);

  const actionMutation = useDockerContainerAction();
  const launchMutation = useLaunchDockerContainer();

  const handleContainerAction = async (
    containerId: string,
    action: DockerContainerAction
  ) => {
    if (!selectedServer) return;
    setActionError(null);
    setPendingContainerKey(`${containerId}:${action}`);
    try {
      await actionMutation.mutateAsync({
        serverId: selectedServer.id,
        containerId,
        action,
      });
      setConfirmRemoveId(null);
      if (action === 'remove' && inspectedContainer?.id === containerId) {
        setInspectedContainer(null);
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to execute container action');
    } finally {
      setPendingContainerKey(null);
    }
  };

  const handleOpenLogs = async (
    container: DockerContainerInfo,
    tailOverride?: number
  ) => {
    if (!selectedServer) return;
    const tailToUse = tailOverride ?? logTailLines;
    setInspectedContainer(container);
    setIsLoadingLogs(true);
    try {
      const res = await fetchDockerLogs(selectedServer.id, container.id, tailToUse);
      setContainerLogsText(res.logs);
    } catch (err: any) {
      setContainerLogsText(
        `Ошибка получения логов контейнера ${container.name}: ${
          err?.message || 'Unknown error'
        }`
      );
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleCopyLogs = async () => {
    if (!containerLogsText) return;
    try {
      await navigator.clipboard.writeText(containerLogsText);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleLaunchContainer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServer) return;
    setRunError(null);
    try {
      await launchMutation.mutateAsync({
        serverId: selectedServer.id,
        input: runForm,
      });
      setIsRunModalOpen(false);
      setRunForm({
        name: '',
        image: 'nginx:alpine',
        ports: '',
        env: '',
        restart_policy: 'unless-stopped',
        command: '',
      });
      setActiveTab('containers');
    } catch (err: any) {
      setRunError(err?.message || 'Не удалось запустить контейнер');
    }
  };

  const openRunModalWithImage = (repo: string, tag: string) => {
    const img =
      repo && repo !== '<none>'
        ? `${repo}:${tag && tag !== '<none>' ? tag : 'latest'}`
        : '';
    setRunForm((prev) => ({
      ...prev,
      image: img || 'nginx:alpine',
    }));
    setRunError(null);
    setIsRunModalOpen(true);
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
            {t('Контейнеры и Docker (Containers)', 'Docker Containers')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Инспекция демона Docker, управление контейнерами, просмотр логов и образов по SSH.',
              'Inspect Docker daemon, manage container lifecycle, stream logs, and view images over SSH.'
            )}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-10 text-center">
          <ServerIcon className="mx-auto h-8 w-8 text-slate-500" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">
            {t('Нет подключённых серверов', 'No servers registered yet')}
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            {t(
              'Добавьте Linux-сервер с доступом по SSH, чтобы управлять контейнерами и образами Docker.',
              'Add a Linux server with SSH credentials to inspect and manage Docker containers.'
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

  const activeServer = selectedServer!;
  const containers = dockerData?.containers || [];
  const images = dockerData?.images || [];
  const networks = dockerData?.networks || [];

  const runningCount = containers.filter((c) => c.state === 'running').length;
  const stoppedCount = containers.length - runningCount;

  const filteredContainers = containers.filter((c) => {
    const matchesState =
      stateFilter === 'all'
        ? true
        : stateFilter === 'running'
          ? c.state === 'running'
          : c.state !== 'running';

    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.ports.toLowerCase().includes(q);

    return matchesState && matchesQuery;
  });

  // Preview command for docker run modal
  const previewRunCmd = [
    'docker run -d',
    runForm.name?.trim() ? `--name ${runForm.name.trim()}` : '',
    runForm.restart_policy ? `--restart ${runForm.restart_policy}` : '',
    ...(runForm.ports
      ? runForm.ports
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => `-p ${p}`)
      : []),
    runForm.image.trim() || '<image>',
    runForm.command?.trim() || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Контейнеры и Docker (Containers)', 'Docker Containers & Images')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Живая инспекция Docker-демона по SSH: управление контейнерами, потребление CPU/RAM, логи и локальные образы.',
              'Live SSH Docker inspection: container lifecycle, CPU/RAM stats, logs, and images.'
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
                ? t('Авто-опрос: 15с (ВКЛ)', 'Auto-poll: 15s (ON)')
                : t('Авто-опрос 15с', 'Auto-poll 15s')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => refetchDocker()}
            disabled={isFetchingDocker}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-emerald-400 ${
                isFetchingDocker ? 'animate-spin' : ''
              }`}
            />
            <span>
              {isFetchingDocker
                ? t('Опрос Docker...', 'Inspecting Docker...')
                : t('Обновить Docker (SSH)', 'Refresh Docker (SSH)')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRunError(null);
              setIsRunModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('+ Запустить контейнер', '+ Run Container')}</span>
          </button>
        </div>
      </div>

      {/* Server Selector Bar */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 mr-1">
              {t('Хост Docker:', 'Docker Host:')}
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

          <div className="flex flex-wrap items-center gap-4 text-xs">
            {dockerData?.daemon_active ? (
              <span className="font-mono text-emerald-400 tabular-nums">
                Docker Engine v{dockerData.docker_version} · ONLINE
              </span>
            ) : !isLoadingDocker ? (
              <span className="font-mono text-amber-400">
                {t('Демон недоступен', 'Daemon unreachable')}
              </span>
            ) : null}

            <Link
              to={`/servers/${activeServer.id}`}
              className="inline-flex items-center gap-1 font-mono text-xs text-slate-300 hover:text-emerald-400 hover:underline whitespace-nowrap"
            >
              <span>{t('SSH-консоль узла', 'Node SSH Console')}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {!activeServer.has_secret && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {t(
                  `Для сервера «${activeServer.name}» не настроен пароль или приватный SSH-ключ.`,
                  `SSH credentials are not configured for "${activeServer.name}".`
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

        {dockerData?.error && (
          <div className="mt-3 flex items-center gap-2 rounded border border-rose-500/40 bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-200">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{dockerData.error}</span>
          </div>
        )}
      </section>

      {/* Summary KPI Cards */}
      <section aria-label="Docker summary metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Всего контейнеров', 'Total Containers')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
              {isLoadingDocker ? '—' : containers.length}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('На выбранном Linux-хосте', 'On selected Linux host')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Запущено (Running)', 'Running')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
              {isLoadingDocker ? '—' : runningCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Активные процессы контейнеров', 'Active container workloads')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Остановлено (Stopped)', 'Stopped / Exited')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-amber-400 tabular-nums">
              {isLoadingDocker ? '—' : stoppedCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Завершённые или созданные', 'Exited or created state')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Локальные образы (Images)', 'Docker Images')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-sky-400 tabular-nums">
              {isLoadingDocker ? '—' : images.length}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t(`Сетей Docker: ${networks.length}`, `Docker networks: ${networks.length}`)}
            </p>
          </div>
        </div>
      </section>

      {actionError && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Tabs & Content Section */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-5">
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#0F172A] p-1 self-start">
            <button
              type="button"
              onClick={() => setActiveTab('containers')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'containers'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              <span>
                {t('Контейнеры', 'Containers')} ({containers.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('images')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'images'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>
                {t('Образы (Images)', 'Images')} ({images.length})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('networks')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'networks'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Network className="h-3.5 w-3.5" />
              <span>
                {t('Сети Docker', 'Networks')} ({networks.length})
              </span>
            </button>
          </div>

          {activeTab === 'containers' && (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-60">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t(
                    'Поиск по имени, образу или ID...',
                    'Filter by name, image, ID...'
                  )}
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0F172A] p-1 text-xs">
                {(['all', 'running', 'stopped'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStateFilter(st)}
                    className={`rounded px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                      stateFilter === st
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'all'
                      ? t('Все', 'All')
                      : st === 'running'
                        ? 'Running'
                        : 'Stopped'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* TAB 1: CONTAINERS */}
        {activeTab === 'containers' && (
          <div className="space-y-4">
            {isLoadingDocker ? (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-12 w-full animate-pulse rounded border border-slate-800 bg-[#0F172A]"
                  />
                ))}
              </div>
            ) : filteredContainers.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-8 text-center">
                <p className="text-sm font-medium text-slate-200">
                  {containers.length === 0
                    ? t(
                        'Контейнеры на этом сервере не найдены',
                        'No Docker containers found on this host'
                      )
                    : t(
                        'Нет контейнеров по заданному фильтру',
                        'No containers match your current filter'
                      )}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t(
                    'Нажмите «+ Запустить контейнер», чтобы развернуть новый контейнер через docker run.',
                    'Click "+ Run Container" to launch a new Docker container over SSH.'
                  )}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0F172A]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-3 px-4">{t('Контейнер (Name / ID)', 'Container')}</th>
                      <th className="py-3 px-4">{t('Образ (Image)', 'Image')}</th>
                      <th className="py-3 px-4">{t('Статус (Status)', 'Status')}</th>
                      <th className="py-3 px-4">{t('Порты (Ports)', 'Ports')}</th>
                      <th className="py-3 px-4 text-right">CPU / RAM</th>
                      <th className="py-3 px-4 text-right">
                        {t('Управление', 'Actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono">
                    {filteredContainers.map((container) => {
                      const isRunning = container.state === 'running';
                      const isStarting =
                        pendingContainerKey === `${container.id}:start`;
                      const isStopping =
                        pendingContainerKey === `${container.id}:stop`;
                      const isRestarting =
                        pendingContainerKey === `${container.id}:restart`;
                      const isRemoving =
                        pendingContainerKey === `${container.id}:remove`;

                      return (
                        <tr
                          key={container.id}
                          className="transition-colors hover:bg-slate-800/40"
                        >
                          <td className="py-3 px-4 max-w-[210px]">
                            <div
                              className="font-sans font-semibold text-slate-100 truncate"
                              title={container.name}
                            >
                              {container.name}
                            </div>
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              {container.id}
                            </div>
                          </td>

                          <td className="py-3 px-4 max-w-[200px]">
                            <span
                              className="block truncate text-sky-300"
                              title={container.image}
                            >
                              {container.image}
                            </span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <div
                              className={`font-semibold ${
                                isRunning
                                  ? 'text-emerald-400'
                                  : container.state === 'exited'
                                    ? 'text-slate-400'
                                    : 'text-amber-400'
                              }`}
                            >
                              {container.state.toUpperCase()}
                            </div>
                            <div
                              className="text-[11px] text-slate-400 truncate max-w-[160px]"
                              title={container.status}
                            >
                              {container.status}
                            </div>
                          </td>

                          <td className="py-3 px-4 max-w-[210px]">
                            <span
                              className="block truncate text-slate-300 tabular-nums"
                              title={container.ports}
                            >
                              {container.ports || '—'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap tabular-nums">
                            <div className="text-emerald-400 font-semibold">
                              {container.cpu_percent}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {container.mem_usage}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap font-sans">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {isRunning ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleContainerAction(container.id, 'stop')
                                  }
                                  disabled={Boolean(pendingContainerKey)}
                                  title={t('Остановить (docker stop)', 'Stop container')}
                                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-slate-700 disabled:opacity-50"
                                >
                                  <Square className="h-3 w-3" />
                                  <span>{isStopping ? '...' : 'Stop'}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleContainerAction(container.id, 'start')
                                  }
                                  disabled={Boolean(pendingContainerKey)}
                                  title={t('Запустить (docker start)', 'Start container')}
                                  className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                  <Play className="h-3 w-3" />
                                  <span>{isStarting ? '...' : 'Start'}</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  handleContainerAction(container.id, 'restart')
                                }
                                disabled={Boolean(pendingContainerKey)}
                                title={t(
                                  'Перезапустить (docker restart)',
                                  'Restart container'
                                )}
                                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                              >
                                <RotateCcw
                                  className={`h-3 w-3 ${
                                    isRestarting ? 'animate-spin' : ''
                                  }`}
                                />
                                <span>Restart</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenLogs(container)}
                                title={t('Просмотр логов (docker logs)', 'View logs')}
                                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                                  inspectedContainer?.id === container.id
                                    ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                                    : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700'
                                }`}
                              >
                                <FileText className="h-3 w-3" />
                                <span>{t('Логи', 'Logs')}</span>
                              </button>

                              {confirmRemoveId === container.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleContainerAction(container.id, 'remove')
                                    }
                                    disabled={isRemoving}
                                    className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                                  >
                                    {isRemoving ? '...' : t('Удалить', 'Confirm')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveId(null)}
                                    className="rounded border border-slate-700 px-1.5 py-1 text-[11px] text-slate-400 hover:text-white"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveId(container.id)}
                                  title={t('Удалить контейнер (docker rm -f)', 'Remove')}
                                  className="rounded border border-slate-800 p-1 text-slate-400 hover:border-rose-500/40 hover:text-rose-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Container Logs Terminal Drawer */}
            {inspectedContainer && (
              <div className="rounded-lg border border-slate-700 bg-[#0B1120] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="font-mono text-xs font-semibold text-slate-100 truncate">
                      docker logs --timestamps --tail {logTailLines}{' '}
                      {inspectedContainer.name} ({inspectedContainer.id})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded border border-slate-800 bg-[#0F172A] p-0.5 font-mono text-[11px]">
                      {[50, 120, 300].map((lines) => (
                        <button
                          key={lines}
                          type="button"
                          onClick={() => {
                            setLogTailLines(lines);
                            handleOpenLogs(inspectedContainer, lines);
                          }}
                          className={`rounded px-2 py-0.5 ${
                            logTailLines === lines
                              ? 'bg-slate-800 text-emerald-400 font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {lines}L
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenLogs(inspectedContainer)}
                      disabled={isLoadingLogs}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#1E293B] px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isLoadingLogs ? 'animate-spin' : ''}`}
                      />
                      <span>{t('Обновить', 'Refresh')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyLogs}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#1E293B] px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      {copiedLogs ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span>{t('Скопировано', 'Copied')}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>{t('Копировать', 'Copy')}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setInspectedContainer(null)}
                      className="rounded border border-slate-800 p-1 text-slate-400 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <pre className="max-h-80 overflow-x-auto overflow-y-auto font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {isLoadingLogs
                    ? t('Загрузка логов контейнера по SSH...', 'Fetching container logs over SSH...')
                    : containerLogsText}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DOCKER IMAGES */}
        {activeTab === 'images' && (
          <div>
            {images.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-8 text-center text-xs text-slate-400">
                {t(
                  'Локальные Docker-образы не найдены на хосте.',
                  'No local Docker images found on this host.'
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0F172A]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-3 px-4">{t('Репозиторий (Repository)', 'Repository')}</th>
                      <th className="py-3 px-4">{t('Тег (Tag)', 'Tag')}</th>
                      <th className="py-3 px-4">Image ID</th>
                      <th className="py-3 px-4 text-right">{t('Размер (Size)', 'Size')}</th>
                      <th className="py-3 px-4">{t('Создан (Created)', 'Created')}</th>
                      <th className="py-3 px-4 text-right">{t('Действие', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono">
                    {images.map((img, idx) => (
                      <tr
                        key={`${img.id}-${idx}`}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="py-3 px-4 font-semibold text-slate-100 max-w-[240px] truncate">
                          {img.repository}
                        </td>
                        <td className="py-3 px-4 text-emerald-400">{img.tag}</td>
                        <td className="py-3 px-4 text-slate-400 tabular-nums">{img.id}</td>
                        <td className="py-3 px-4 text-right text-slate-200 tabular-nums">
                          {img.size}
                        </td>
                        <td className="py-3 px-4 text-slate-400">{img.created_since}</td>
                        <td className="py-3 px-4 text-right font-sans">
                          <button
                            type="button"
                            onClick={() => openRunModalWithImage(img.repository, img.tag)}
                            className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                          >
                            <Play className="h-3 w-3" />
                            <span>{t('Запустить', 'Run')}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DOCKER NETWORKS */}
        {activeTab === 'networks' && (
          <div>
            {networks.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-8 text-center text-xs text-slate-400">
                {t('Сети Docker не найдены.', 'No Docker networks found.')}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0F172A]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-3 px-4">Network ID</th>
                      <th className="py-3 px-4">{t('Имя сети (Name)', 'Network Name')}</th>
                      <th className="py-3 px-4">{t('Драйвер (Driver)', 'Driver')}</th>
                      <th className="py-3 px-4">{t('Область (Scope)', 'Scope')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono">
                    {networks.map((net) => (
                      <tr
                        key={net.id}
                        className="transition-colors hover:bg-slate-800/40"
                      >
                        <td className="py-3 px-4 text-slate-400 tabular-nums">{net.id}</td>
                        <td className="py-3 px-4 font-semibold text-emerald-400">
                          {net.name}
                        </td>
                        <td className="py-3 px-4 text-slate-200">{net.driver}</td>
                        <td className="py-3 px-4 text-slate-400">{net.scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Run Container Modal */}
      {isRunModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-[#1E293B] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  {t(
                    'Запустить новый контейнер (docker run -d)',
                    'Run New Container (docker run -d)'
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t(
                    `Целевой узел: ${activeServer.name} (${activeServer.ip_address})`,
                    `Target host: ${activeServer.name} (${activeServer.ip_address})`
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRunModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleLaunchContainer} className="mt-4 space-y-4">
              {runError && (
                <div className="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
                  {runError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('Образ Docker (Image) *', 'Docker Image *')}
                </label>
                <input
                  type="text"
                  required
                  value={runForm.image}
                  onChange={(e) =>
                    setRunForm((prev) => ({ ...prev, image: e.target.value }))
                  }
                  placeholder="nginx:alpine, redis:7-alpine, postgres:16..."
                  className="h-9 w-full rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['nginx:alpine', 'redis:7-alpine', ' caddy:2-alpine', 'traefik:v3.1'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setRunForm((prev) => ({ ...prev, image: preset.trim() }))
                        }
                        className="rounded border border-slate-700 bg-[#0F172A] px-2 py-0.5 font-mono text-[11px] text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300"
                      >
                        {preset.trim()}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Имя контейнера (--name)', 'Container Name (--name)')}
                  </label>
                  <input
                    type="text"
                    value={runForm.name}
                    onChange={(e) =>
                      setRunForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="web-proxy-01"
                    className="h-9 w-full rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Политика рестарта (--restart)', 'Restart Policy')}
                  </label>
                  <select
                    value={runForm.restart_policy}
                    onChange={(e) =>
                      setRunForm((prev) => ({
                        ...prev,
                        restart_policy: e.target.value as any,
                      }))
                    }
                    className="h-9 w-full rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="unless-stopped">unless-stopped</option>
                    <option value="always">always</option>
                    <option value="on-failure">on-failure</option>
                    <option value="no">no</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('Проброс портов (-p, через запятую)', 'Port Mappings (-p, comma-separated)')}
                </label>
                <input
                  type="text"
                  value={runForm.ports}
                  onChange={(e) =>
                    setRunForm((prev) => ({ ...prev, ports: e.target.value }))
                  }
                  placeholder="8080:80, 8443:443"
                  className="h-9 w-full rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t(
                    'Переменные окружения (-e, по одной на строке)',
                    'Environment Variables (-e, one KEY=VALUE per line)'
                  )}
                </label>
                <textarea
                  rows={2}
                  value={runForm.env}
                  onChange={(e) =>
                    setRunForm((prev) => ({ ...prev, env: e.target.value }))
                  }
                  placeholder="NODE_ENV=production"
                  className="w-full rounded border border-slate-700 bg-[#0F172A] p-2.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none resize-none"
                />
              </div>

              <div className="rounded border border-slate-800 bg-[#0B1120] p-2.5 font-mono text-[11px] text-emerald-400 break-all">
                $ {previewRunCmd}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRunModalOpen(false)}
                  className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  {t('Отмена', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={launchMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {launchMutation.isPending ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>{t('Запуск по SSH...', 'Launching via SSH...')}</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span>{t('Запустить контейнер', 'Run Container')}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
