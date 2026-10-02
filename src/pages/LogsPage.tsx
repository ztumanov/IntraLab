import React, { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  KeyRound,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server as ServerIcon,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  useServerCommandLogs,
  useServerDocker,
  useServers,
  useServerSystemLogs,
} from '../hooks/useServers.ts';
import { buildServerLogStreamUrl } from '../api/servers.ts';
import {
  LogSeverity,
  LogStreamStatusEvent,
  RealTimeLogEvent,
  SystemLogLine,
  SystemLogSource,
} from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

const MAX_CLIENT_LOG_LINES = 1000;

const LOG_SOURCES: {
  id: SystemLogSource;
  labelRu: string;
  labelEn: string;
  cmdHint: string;
}[] = [
  {
    id: 'journald',
    labelRu: 'Systemd (journalctl)',
    labelEn: 'Systemd (journalctl)',
    cmdHint: 'journalctl -f --no-pager -o short-iso',
  },
  {
    id: 'auth',
    labelRu: 'SSH и Безопасность (auth)',
    labelEn: 'SSH & Auth (sshd)',
    cmdHint: 'journalctl -u ssh -u sshd -f -o short-iso',
  },
  {
    id: 'kernel',
    labelRu: 'Ядро Linux (dmesg)',
    labelEn: 'Kernel (dmesg)',
    cmdHint: 'journalctl -k -f --no-pager -o short-iso',
  },
  {
    id: 'docker',
    labelRu: 'Docker Daemon & Containers',
    labelEn: 'Docker Daemon & Containers',
    cmdHint: 'docker logs --follow --timestamps <container>',
  },
];

function convertEventToLogLine(
  ev: RealTimeLogEvent,
  lineNumber: number
): SystemLogLine {
  const severity: LogSeverity =
    ev.level === 'error' || ev.level === 'warn' || ev.level === 'info'
      ? ev.level
      : 'info';
  const service =
    ev.source === 'docker'
      ? ev.container_name || ev.container_id || 'docker'
      : ev.unit || ev.source || 'journal';
  const raw = `${ev.timestamp} ${service}: ${ev.message}`;
  return {
    line_number: lineNumber,
    timestamp: ev.timestamp,
    severity,
    service,
    message: ev.message,
    raw,
  };
}

export const LogsPage: React.FC = () => {
  const { t } = useI18n();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: servers = [], isLoading: isLoadingServers } = useServers();
  const paramServerId = Number(searchParams.get('serverId'));

  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'stream' | 'audit'>('stream');
  const [source, setSource] = useState<SystemLogSource>('journald');
  const [unitFilter, setUnitFilter] = useState<string>('');
  const [selectedContainer, setSelectedContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(100);

  // Real-time SSE streaming state
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [streamStatus, setStreamStatus] = useState<LogStreamStatusEvent | null>(null);
  const [streamedLines, setStreamedLines] = useState<SystemLogLine[]>([]);
  const [clearedBaselineCount, setClearedBaselineCount] = useState<number>(0);

  const [severityFilter, setSeverityFilter] = useState<'all' | LogSeverity>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [wrapLines, setWrapLines] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const isPausedRef = useRef<boolean>(false);
  isPausedRef.current = isPaused;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

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
    setSelectedContainer('');
    setStreamedLines([]);
    setClearedBaselineCount(0);
    setSearchParams({ serverId: String(id) }, { replace: true });
  };

  const selectedServer =
    servers.find((s) => s.id === selectedServerId) || servers[0] || null;

  // Initial history / fallback snapshot via existing Logs API (no polling when SSE stream is active)
  const {
    data: logsData,
    isLoading: isLoadingLogs,
    isFetching: isFetchingLogs,
    isError: isLogsError,
    error: logsError,
    refetch: refetchLogs,
  } = useServerSystemLogs(
    selectedServer?.id || 0,
    source,
    tailLines,
    false
  );

  // Fetch container list when source === 'docker' so user can pick a container for `docker logs --follow`
  const { data: dockerData } = useServerDocker(
    source === 'docker' && selectedServer ? selectedServer.id : 0,
    false
  );

  const {
    data: auditLogs = [],
    isLoading: isLoadingAudit,
    isError: isAuditError,
    error: auditError,
    refetch: refetchAudit,
  } = useServerCommandLogs(selectedServer?.id || 0);

  // Reset stream buffer when switching server, source, unit, or container
  useEffect(() => {
    setStreamedLines([]);
    setClearedBaselineCount(0);
  }, [selectedServer?.id, source, unitFilter, selectedContainer]);

  // Manage real-time SSE EventSource connection
  useEffect(() => {
    const serverId = selectedServer?.id || 0;
    if (!serverId || !isStreaming || activeTab !== 'stream') {
      setStreamStatus(null);
      return;
    }

    let eventSource: EventSource | null = null;
    let cancelled = false;

    const connectSse = async () => {
      try {
        const url = await buildServerLogStreamUrl({
          serverId,
          source,
          unit: source === 'journald' ? unitFilter : undefined,
          container: source === 'docker' ? selectedContainer : undefined,
          tail: tailLines,
        });
        if (cancelled) return;

        const es = new EventSource(url);
        eventSource = es;

        es.addEventListener('status', (evt: MessageEvent) => {
          if (cancelled) return;
          try {
            const parsed = JSON.parse(evt.data) as LogStreamStatusEvent;
            setStreamStatus(parsed);
          } catch {
            // Ignore malformed status event
          }
        });

        es.addEventListener('log', (evt: MessageEvent) => {
          if (cancelled || isPausedRef.current) return;
          try {
            const rawEv = JSON.parse(evt.data) as RealTimeLogEvent;
            setStreamedLines((prev) => {
              const nextNum =
                prev.length > 0 ? prev[prev.length - 1].line_number + 1 : 1;
              const nextLine = convertEventToLogLine(rawEv, nextNum);
              const updated = [...prev, nextLine];
              if (updated.length > MAX_CLIENT_LOG_LINES) {
                return updated.slice(updated.length - MAX_CLIENT_LOG_LINES);
              }
              return updated;
            });
          } catch {
            // Ignore malformed log event
          }
        });

        es.onerror = () => {
          if (cancelled) return;
          setStreamStatus((prev) => ({
            status: 'reconnecting',
            server_id: serverId,
            transport: prev?.transport,
            agent_id: prev?.agent_id,
            message: 'SSE stream interrupted; browser EventSource is reconnecting...',
            timestamp: new Date().toISOString(),
          }));
        };
      } catch {
        // Ignore URL construction error
      }
    };

    void connectSse();

    return () => {
      cancelled = true;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [
    selectedServer?.id,
    source,
    unitFilter,
    selectedContainer,
    tailLines,
    isStreaming,
    activeTab,
  ]);

  // Combine initial historical snapshot lines with real-time streamed SSE lines
  const baseLines =
    clearedBaselineCount > 0
      ? []
      : (logsData?.lines || []).slice(-MAX_CLIENT_LOG_LINES);

  const combinedLines: SystemLogLine[] = React.useMemo(() => {
    if (streamedLines.length === 0) {
      return baseLines;
    }
    const existingRaws = new Set(baseLines.slice(-80).map((l) => l.raw));
    const dedupedStream = streamedLines.filter((l) => !existingRaws.has(l.raw));
    const merged = [...baseLines, ...dedupedStream];
    const sliced =
      merged.length > MAX_CLIENT_LOG_LINES
        ? merged.slice(merged.length - MAX_CLIENT_LOG_LINES)
        : merged;
    return sliced.map((line, idx) => ({
      ...line,
      line_number: idx + 1,
    }));
  }, [baseLines, streamedLines]);

  // Auto-scroll terminal box when new lines arrive
  useEffect(() => {
    if (!autoScroll || isPaused || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [combinedLines.length, autoScroll, isPaused]);

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
            {t('Логи и журналы (Logs)', 'System & Container Logs')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Централизованный потоковый просмотр journald, auth.log, dmesg, Docker и журнала аудита SSH.',
              'Centralized real-time streaming for journald, auth.log, dmesg, Docker, and SSH audit logs.'
            )}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-10 text-center">
          <ServerIcon className="mx-auto h-8 w-8 text-slate-500" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">
            {t('Нет подключённых серверов для чтения логов', 'No servers registered yet')}
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            {t(
              'Добавьте Linux-сервер с доступом по SSH или infralab-agent, чтобы читать системные журналы и логи контейнеров в реальном времени.',
              'Add a Linux server with SSH credentials or infralab-agent to stream system and container logs in real time.'
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
  const allLines = combinedLines;

  const errorCount = allLines.filter((l) => l.severity === 'error').length;
  const warnCount = allLines.filter((l) => l.severity === 'warn').length;

  const filteredLines = allLines.filter((line) => {
    const matchesSeverity =
      severityFilter === 'all' || line.severity === severityFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      line.raw.toLowerCase().includes(q) ||
      line.service.toLowerCase().includes(q) ||
      line.message.toLowerCase().includes(q);
    return matchesSeverity && matchesQuery;
  });

  const handleClearBuffer = () => {
    setStreamedLines([]);
    setClearedBaselineCount((c) => c + 1);
  };

  const handleCopyVisibleLogs = async () => {
    const text = filteredLines.map((l) => l.raw).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleDownloadLogs = () => {
    const text = filteredLines.map((l) => l.raw).join('\n');
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeServer.hostname}-${source}-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeSourceMeta =
    LOG_SOURCES.find((s) => s.id === source) || LOG_SOURCES[0];

  const isAgentMtls =
    streamStatus?.transport === 'agent_mtls' || streamStatus?.transport === 'agent_http';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Потоковые логи и журналы ОС (Logs)', 'Real-Time System & Container Log Stream')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Потоковая передача логов (SSE + mTLS Agent / SSH fallback): systemd journalctl, sshd auth, dmesg, Docker и аудит команд.',
              'Real-time SSE log streaming via mTLS Agent & SSH fallback across journald, sshd auth, kernel dmesg, and Docker containers.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Start / Stop Live SSE Stream */}
          <button
            type="button"
            onClick={() => {
              setIsStreaming((prev) => !prev);
              setIsPaused(false);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              isStreaming
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#1E293B] text-slate-300 hover:bg-slate-800'
            }`}
          >
            {isStreaming ? (
              <>
                <Square className="h-3.5 w-3.5 text-emerald-400 fill-emerald-400/30" />
                <span>{t('Live Stream: ВКЛ (SSE)', 'Live Stream: ON (SSE)')}</span>
              </>
            ) : (
              <>
                <Radio className="h-3.5 w-3.5 text-slate-400" />
                <span>{t('Запустить Live Stream', 'Start Live Stream')}</span>
              </>
            )}
          </button>

          {/* Pause / Resume Stream */}
          {isStreaming && (
            <button
              type="button"
              onClick={() => setIsPaused((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                isPaused
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border-slate-700 bg-[#1E293B] text-slate-300 hover:bg-slate-800'
              }`}
            >
              {isPaused ? (
                <>
                  <Play className="h-3.5 w-3.5 text-amber-400" />
                  <span>{t('Продолжить', 'Resume')}</span>
                </>
              ) : (
                <>
                  <Pause className="h-3.5 w-3.5 text-slate-400" />
                  <span>{t('Пауза', 'Pause')}</span>
                </>
              )}
            </button>
          )}

          {/* Clear Buffer */}
          <button
            type="button"
            onClick={handleClearBuffer}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5 text-slate-400" />
            <span>{t('Очистить', 'Clear')}</span>
          </button>

          {/* Manual Snapshot Refresh */}
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'stream') {
                setClearedBaselineCount(0);
                refetchLogs();
              } else {
                refetchAudit();
              }
            }}
            disabled={isFetchingLogs}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetchingLogs ? 'animate-spin' : ''}`}
            />
            <span>
              {isFetchingLogs
                ? t('Чтение снимка...', 'Fetching Snapshot...')
                : t('Обновить снимок', 'Refresh Snapshot')}
            </span>
          </button>
        </div>
      </div>

      {/* Server Selector Bar */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 mr-1">
              {t('Источник (Сервер):', 'Target Host:')}
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

          <div className="flex items-center gap-4 text-xs">
            <Link
              to={`/containers?serverId=${activeServer.id}`}
              className="inline-flex items-center gap-1 font-mono text-xs text-slate-300 hover:text-emerald-400 hover:underline whitespace-nowrap"
            >
              <span>{t('Контейнеры узла', 'Node Containers')}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to={`/servers/${activeServer.id}`}
              className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:underline whitespace-nowrap"
            >
              <span>{t('SSH-консоль', 'SSH Console')}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {!activeServer.has_secret && !isAgentMtls && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {t(
                  `Для сервера «${activeServer.name}» не задан пароль/SSH-ключ. Для чтения логов подключите infralab-agent по mTLS или настройте SSH.`,
                  `SSH credentials are not configured for "${activeServer.name}". Connect infralab-agent via mTLS or configure SSH credentials.`
                )}
              </span>
            </div>
            <Link
              to={`/servers/${activeServer.id}`}
              className="inline-flex items-center gap-1.5 font-semibold text-amber-300 hover:underline whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{t('Настроить доступ →', 'Configure Access →')}</span>
            </Link>
          </div>
        )}
      </section>

      {/* Summary KPI Row */}
      <section aria-label="Log stream summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Строк в буфере (макс. 1000)', 'Buffered Log Lines (max 1000)')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
              {isLoadingLogs && allLines.length === 0 ? '—' : allLines.length}
            </p>
            <p className="mt-2 text-xs text-slate-500 font-mono truncate">
              {activeSourceMeta.id}{' '}
              {streamedLines.length > 0
                ? `(+${streamedLines.length} live)`
                : `(tail -${tailLines})`}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Ошибки (ERROR / CRIT)', 'Errors & Failures')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-rose-400 tabular-nums">
              {isLoadingLogs && allLines.length === 0 ? '—' : errorCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('События error / failed / denied', 'Matched error / failed / denied')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Предупреждения (WARN)', 'Warnings')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-amber-400 tabular-nums">
              {isLoadingLogs && allLines.length === 0 ? '—' : warnCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('События warn / timeout / retry', 'Matched warn / timeout / retry')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Канал потоковой передачи', 'Stream Transport')}
            </p>
            <p className="mt-2 font-mono text-lg font-semibold text-emerald-400 truncate">
              {!isStreaming
                ? t('SNAPSHOT (Остановлен)', 'SNAPSHOT (Stopped)')
                : isPaused
                  ? t('PAUSED (Пауза)', 'PAUSED')
                  : isAgentMtls
                    ? 'SSE · Agent mTLS'
                    : streamStatus?.status === 'reconnecting'
                      ? t('RECONNECTING...', 'RECONNECTING...')
                      : 'SSE · Live Stream'}
            </p>
            <p className="mt-2 text-xs text-slate-500 font-mono truncate">
              {streamStatus?.agent_id
                ? `Agent: ${streamStatus.agent_id}`
                : t('Без периодического polling', 'Zero-polling EventSource')}
            </p>
          </div>
        </div>
      </section>

      {/* Main Log Stream & Audit Container */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-5">
        {/* Top Mode & Source Tabs */}
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#0F172A] p-1 self-start">
            {LOG_SOURCES.map((src) => (
              <button
                key={src.id}
                type="button"
                onClick={() => {
                  setActiveTab('stream');
                  setSource(src.id);
                }}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'stream' && source === src.id
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t(src.labelRu, src.labelEn)}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'audit'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>
                {t('Аудит SSH-команд', 'SSH Audit Log')} ({auditLogs.length})
              </span>
            </button>
          </div>

          {activeTab === 'stream' && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Optional Unit selector when source === 'journald' */}
              {source === 'journald' && (
                <input
                  type="text"
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  placeholder={t('Юнит (напр. nginx.service)', 'Unit (e.g. nginx.service)')}
                  className="w-44 rounded-md border border-slate-700 bg-[#0F172A] px-2.5 py-1 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              )}

              {/* Docker Container selector when source === 'docker' */}
              {source === 'docker' && (
                <select
                  value={selectedContainer}
                  onChange={(e) => setSelectedContainer(e.target.value)}
                  className="rounded-md border border-slate-700 bg-[#0F172A] px-2.5 py-1 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">
                    {t('Все контейнеры / демон dockerd', 'All containers / dockerd unit')}
                  </option>
                  {(dockerData?.containers || []).map((c) => (
                    <option key={c.id} value={c.name || c.id}>
                      {c.name} ({c.image}) [{c.state}]
                    </option>
                  ))}
                </select>
              )}

              <div className="flex items-center rounded-md border border-slate-800 bg-[#0F172A] p-0.5 font-mono text-xs">
                {[50, 100, 250, 500].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setTailLines(cnt)}
                    className={`rounded px-2.5 py-1 transition-colors ${
                      tailLines === cnt
                        ? 'bg-slate-800 text-emerald-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cnt}L
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCopyVisibleLogs}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>{t('Скопировано', 'Copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                    <span>{t('Копировать', 'Copy')}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadLogs}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5 text-slate-400" />
                <span>{t('Скачать .log', 'Export .log')}</span>
              </button>
            </div>
          )}
        </div>

        {/* STREAM VIEW */}
        {activeTab === 'stream' && (
          <div className="space-y-4">
            {/* Filter & Grep Bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t(
                    'Фильтр по тексту (grep), сервису, контейнеру или PID...',
                    'Filter log lines by keyword, service, container, or PID...'
                  )}
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] py-1.5 pl-9 pr-3 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0F172A] p-1 text-xs font-mono">
                  {(['all', 'error', 'warn', 'info'] as const).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setSeverityFilter(sev)}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${
                        severityFilter === sev
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sev === 'all'
                        ? `${t('Все', 'All')} (${allLines.length})`
                        : sev === 'error'
                          ? `ERROR (${errorCount})`
                          : sev === 'warn'
                            ? `WARN (${warnCount})`
                            : 'INFO'}
                    </button>
                  ))}
                </div>

                {/* Auto-scroll toggle */}
                <button
                  type="button"
                  onClick={() => setAutoScroll((a) => !a)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-mono transition-colors ${
                    autoScroll
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-[#0F172A] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowDownCircle className="h-3.5 w-3.5" />
                  <span>
                    {autoScroll
                      ? t('Автоскролл: ВКЛ', 'Auto-scroll: ON')
                      : t('Автоскролл: ВЫКЛ', 'Auto-scroll: OFF')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setWrapLines((w) => !w)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-mono transition-colors ${
                    wrapLines
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-[#0F172A] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {wrapLines ? t('Перенос строк: ВКЛ', 'Wrap: ON') : t('Перенос: ВЫКЛ', 'Wrap: OFF')}
                </button>
              </div>
            </div>

            {/* Terminal Stream Output Box */}
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/90 bg-[#0F172A] px-4 py-2 font-mono text-[11px] text-slate-400">
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      !isStreaming
                        ? 'bg-slate-500'
                        : isPaused
                          ? 'bg-amber-400'
                          : 'bg-emerald-400 animate-pulse'
                    }`}
                  />
                  <span className="truncate">
                    {activeServer.username}@{activeServer.hostname}:~${' '}
                    {source === 'docker' && selectedContainer
                      ? `docker logs --follow --timestamps ${selectedContainer}`
                      : source === 'journald' && unitFilter
                        ? `journalctl -u ${unitFilter} -f --no-pager -o short-iso`
                        : activeSourceMeta.cmdHint}
                  </span>
                </div>
                <span className="tabular-nums shrink-0">
                  {t('Показано строк:', 'Showing:')} {filteredLines.length} / {allLines.length}
                  {streamStatus?.timestamp
                    ? ` · ${new Date(streamStatus.timestamp).toISOString().slice(11, 19)} UTC`
                    : logsData?.fetched_at
                      ? ` · ${new Date(logsData.fetched_at).toISOString().slice(11, 19)} UTC`
                      : ''}
                </span>
              </div>

              {isLoadingLogs && allLines.length === 0 ? (
                <div className="p-6 space-y-2.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="h-4 w-full animate-pulse rounded bg-slate-800/60"
                    />
                  ))}
                </div>
              ) : isLogsError && allLines.length === 0 ? (
                <div className="p-6 font-mono text-xs text-rose-300 bg-rose-950/20">
                  {(logsError as Error)?.message ||
                    t(
                      'Ошибка получения системных логов по SSH.',
                      'Failed to fetch system logs over SSH.'
                    )}
                </div>
              ) : filteredLines.length === 0 ? (
                <div className="p-8 text-center font-mono text-xs text-slate-500">
                  {t(
                    'Ожидание новых событий в потоке или записи под фильтр не найдены...',
                    'Waiting for real-time log events or no lines match the current filter...'
                  )}
                </div>
              ) : (
                <div
                  ref={scrollContainerRef}
                  className="max-h-[540px] overflow-y-auto overflow-x-auto divide-y divide-slate-900/80 font-mono text-xs"
                >
                  {filteredLines.map((line) => {
                    const sevColor =
                      line.severity === 'error'
                        ? 'text-rose-400 font-semibold'
                        : line.severity === 'warn'
                          ? 'text-amber-400 font-semibold'
                          : 'text-emerald-400';

                    const rowBg =
                      line.severity === 'error'
                        ? 'bg-rose-950/15 hover:bg-rose-950/25'
                        : line.severity === 'warn'
                          ? 'bg-amber-950/10 hover:bg-amber-950/20'
                          : 'hover:bg-slate-900/60';

                    return (
                      <div
                        key={line.line_number}
                        className={`flex items-start gap-3 px-4 py-1.5 transition-colors ${rowBg}`}
                      >
                        <span className="w-9 shrink-0 select-none text-right text-[11px] text-slate-600 tabular-nums">
                          {line.line_number}
                        </span>

                        <span className="w-36 shrink-0 text-[11px] text-slate-400 tabular-nums truncate">
                          {line.timestamp}
                        </span>

                        <span className={`w-12 shrink-0 text-[11px] uppercase ${sevColor}`}>
                          {line.severity}
                        </span>

                        <span
                          className="w-28 shrink-0 text-[11px] text-sky-400 truncate"
                          title={line.service}
                        >
                          {line.service}
                        </span>

                        <span
                          className={`flex-1 min-w-0 text-slate-200 ${
                            wrapLines
                              ? 'whitespace-pre-wrap break-all'
                              : 'whitespace-nowrap'
                          }`}
                        >
                          {line.message}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SSH COMMAND AUDIT LOG TAB */}
        {activeTab === 'audit' && (
          <div className="space-y-3">
            {isAuditError ? (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200">
                {(auditError as Error)?.message ||
                  t(
                    'Ошибка загрузки журнала аудита SSH-команд.',
                    'Failed to load SSH command audit log.'
                  )}
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-8 text-center text-xs text-slate-400">
                {t(
                  'Для этого сервера пока нет записей в журнале аудита SSH-команд.',
                  'No SSH command audit logs recorded for this server yet.'
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 font-mono text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                      <span className="text-emerald-400 font-semibold break-all">
                        $ {log.command}
                      </span>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 tabular-nums">
                        <span
                          className={
                            log.exit_code === 0 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          exit {log.exit_code}
                        </span>
                        <span>·</span>
                        <span>{log.duration_ms} ms</span>
                        <span>·</span>
                        <span>
                          {new Date(log.executed_at)
                            .toISOString()
                            .replace('T', ' ')
                            .slice(0, 19)}{' '}
                          UTC
                        </span>
                      </div>
                    </div>

                    {log.stdout && (
                      <pre className="max-h-44 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all text-slate-200 text-[11px] leading-relaxed">
                        {log.stdout}
                      </pre>
                    )}

                    {log.stderr && (
                      <pre className="max-h-36 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all text-rose-300 text-[11px] leading-relaxed">
                        {log.stderr}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
