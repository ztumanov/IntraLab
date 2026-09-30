import React, { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import {
  useServerCommandLogs,
  useServers,
  useServerSystemLogs,
} from '../hooks/useServers.ts';
import { LogSeverity, SystemLogSource } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

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
    cmdHint: 'journalctl -n <N> --no-pager -o short-iso',
  },
  {
    id: 'auth',
    labelRu: 'SSH и Безопасность (auth)',
    labelEn: 'SSH & Auth (sshd)',
    cmdHint: 'journalctl -u ssh -u sshd / /var/log/auth.log',
  },
  {
    id: 'kernel',
    labelRu: 'Ядро Linux (dmesg)',
    labelEn: 'Kernel (dmesg)',
    cmdHint: 'journalctl -k / dmesg -T',
  },
  {
    id: 'docker',
    labelRu: 'Docker Daemon & Containers',
    labelEn: 'Docker Daemon & Containers',
    cmdHint: 'journalctl -u docker / docker logs',
  },
];

export const LogsPage: React.FC = () => {
  const { t } = useI18n();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: servers = [], isLoading: isLoadingServers } = useServers();
  const paramServerId = Number(searchParams.get('serverId'));

  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'stream' | 'audit'>('stream');
  const [source, setSource] = useState<SystemLogSource>('journald');
  const [tailLines, setTailLines] = useState<number>(100);
  const [liveTail, setLiveTail] = useState<boolean>(false);
  const [severityFilter, setSeverityFilter] = useState<'all' | LogSeverity>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [wrapLines, setWrapLines] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

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
    data: logsData,
    isLoading: isLoadingLogs,
    isFetching: isFetchingLogs,
    refetch: refetchLogs,
  } = useServerSystemLogs(
    selectedServer?.id || 0,
    source,
    tailLines,
    liveTail ? 5000 : false
  );

  const {
    data: auditLogs = [],
    isLoading: isLoadingAudit,
    refetch: refetchAudit,
  } = useServerCommandLogs(selectedServer?.id || 0);

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
              'Добавьте Linux-сервер с доступом по SSH, чтобы читать системные журналы и логи контейнеров в реальном времени.',
              'Add a Linux server with SSH credentials to inspect system and container logs in real time.'
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
  const allLines = logsData?.lines || [];

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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Потоковые логи и журналы ОС (Logs)', 'System & Container Log Stream')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Агрегация логов systemd journald, безопасности SSH, ядра Linux, Docker и истории выполнения команд.',
              'Real-time SSH log aggregation across journald, sshd auth, kernel dmesg, Docker, and command audit history.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setLiveTail((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              liveTail
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#1E293B] text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Activity
              className={`h-3.5 w-3.5 ${
                liveTail ? 'text-emerald-400 animate-pulse' : 'text-slate-400'
              }`}
            />
            <span>
              {liveTail
                ? t('Live Tail: 5с (ВКЛ)', 'Live Tail: 5s (ON)')
                : t('Live Tail (5с)', 'Live Tail (5s)')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'stream') {
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
                ? t('Чтение по SSH...', 'Streaming SSH...')
                : t('Обновить логи', 'Refresh Logs')}
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

        {!activeServer.has_secret && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {t(
                  `Для сервера «${activeServer.name}» не задан пароль или приватный SSH-ключ.`,
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
      </section>

      {/* Summary KPI Row */}
      <section aria-label="Log stream summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Строк в буфере', 'Buffered Log Lines')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
              {isLoadingLogs ? '—' : allLines.length}
            </p>
            <p className="mt-2 text-xs text-slate-500 font-mono truncate">
              {activeSourceMeta.id} (tail -{tailLines})
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Ошибки (ERROR / CRIT)', 'Errors & Failures')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-rose-400 tabular-nums">
              {isLoadingLogs ? '—' : errorCount}
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
              {isLoadingLogs ? '—' : warnCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('События warn / timeout / retry', 'Matched warn / timeout / retry')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Журнал SSH-команд', 'SSH Audit History')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
              {isLoadingAudit ? '—' : auditLogs.length}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Записей в PostgreSQL', 'Recorded in PostgreSQL')}
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
                    'Фильтр по тексту (grep), сервису или PID...',
                    'Filter log lines by keyword, service, or PID...'
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
                <span className="truncate">
                  {activeServer.username}@{activeServer.hostname}:~$ {activeSourceMeta.cmdHint}
                </span>
                <span className="tabular-nums shrink-0">
                  {t('Показано строк:', 'Showing:')} {filteredLines.length} / {allLines.length}
                  {logsData?.fetched_at
                    ? ` · ${new Date(logsData.fetched_at).toISOString().slice(11, 19)} UTC`
                    : ''}
                </span>
              </div>

              {isLoadingLogs ? (
                <div className="p-6 space-y-2.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="h-4 w-full animate-pulse rounded bg-slate-800/60"
                    />
                  ))}
                </div>
              ) : filteredLines.length === 0 ? (
                <div className="p-8 text-center font-mono text-xs text-slate-500">
                  {t(
                    'Записи, подходящие под выбранный фильтр, не найдены.',
                    'No log lines match the current filter.'
                  )}
                </div>
              ) : (
                <div className="max-h-[540px] overflow-y-auto overflow-x-auto divide-y divide-slate-900/80 font-mono text-xs">
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
            {auditLogs.length === 0 ? (
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
