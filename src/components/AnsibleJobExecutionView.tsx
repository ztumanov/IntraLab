import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Layers,
  Loader2,
  MinusCircle,
  Play,
  Server as ServerIcon,
  Square,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AnsibleHostExecutionStatus,
  AnsibleInventory,
  AnsibleJobHostStatus,
  AnsibleJobStatus,
  AnsiblePlaybook,
} from '../api/automation.ts';
import { useI18n } from '../context/I18nContext.tsx';

export function formatDurationCompact(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
  return `${sec}s`;
}

export function filterAnsibleOutputByHost(
  stdout: string,
  stderr: string,
  host: AnsibleJobHostStatus | null
): string {
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  if (!host) return combined;
  if (!combined.trim()) return '';

  const tokens = [host.host_alias, host.server_name, host.ip_address]
    .map((s) => (s || '').trim())
    .filter(Boolean);

  const lines = combined.split('\n');
  const out: string[] = [];
  let includeFollowingIndented = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('PLAY [') ||
      trimmed.startsWith('TASK [') ||
      trimmed.startsWith('PLAY RECAP')
    ) {
      out.push(line);
      includeFollowingIndented = false;
      continue;
    }

    const matchesHost = tokens.some(
      (tok) =>
        line.includes(`[${tok}]`) ||
        line.startsWith(`${tok} `) ||
        line.startsWith(`${tok}:`)
    );

    if (matchesHost) {
      out.push(line);
      includeFollowingIndented = line.trimEnd().endsWith('{') || line.includes('=> {');
      continue;
    }

    if (includeFollowingIndented) {
      out.push(line);
      if (trimmed === '}' || trimmed === '},') {
        includeFollowingIndented = false;
      }
    }
  }

  if (host.error && !out.some((l) => l.includes(host.error))) {
    out.push(`\n[Host Error: ${host.server_name} (${host.ip_address})] ${host.error}`);
  }

  return out.join('\n').trim();
}

export const HostStatusBadge: React.FC<{ status: AnsibleHostExecutionStatus }> = ({
  status,
}) => {
  switch (status) {
    case 'SUCCESS':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>SUCCESS</span>
        </span>
      );
    case 'RUNNING':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>RUNNING</span>
        </span>
      );
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-300">
          <Clock className="h-3 w-3 text-slate-400" />
          <span>PENDING</span>
        </span>
      );
    case 'SKIPPED':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-400">
          <MinusCircle className="h-3 w-3" />
          <span>SKIPPED</span>
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-400">
          <Square className="h-3 w-3" />
          <span>CANCELLED</span>
        </span>
      );
    case 'FAILED':
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-rose-400">
          <XCircle className="h-3 w-3" />
          <span>FAILED</span>
        </span>
      );
  }
};

export const JobStatusBadge: React.FC<{ status: AnsibleJobStatus | null }> = ({
  status,
}) => {
  if (!status) return null;
  switch (status) {
    case 'SUCCESS':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          <span>SUCCESS</span>
        </span>
      );
    case 'RUNNING':
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{status}</span>
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-400">
          <Square className="h-3 w-3" />
          <span>CANCELLED</span>
        </span>
      );
    case 'FAILED':
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-semibold font-mono text-[11px] text-rose-400">
          <XCircle className="h-3 w-3" />
          <span>FAILED</span>
        </span>
      );
  }
};

interface AnsibleJobExecutionPanelProps {
  jobId: number | null;
  playbookName: string;
  inventoryName: string;
  status: AnsibleJobStatus | null;
  startedAt: string | null;
  durationMs: number;
  exitCode: number | null;
  currentTask: string;
  hosts: AnsibleJobHostStatus[];
  stdout: string;
  stderr: string;
  checkMode?: boolean;
  onCancel?: () => void;
  isCancelling?: boolean;
  onClose?: () => void;
}

export const AnsibleJobExecutionPanel: React.FC<AnsibleJobExecutionPanelProps> = ({
  jobId,
  playbookName,
  inventoryName,
  status,
  startedAt,
  durationMs,
  exitCode,
  currentTask,
  hosts,
  stdout,
  stderr,
  checkMode,
  onCancel,
  isCancelling,
  onClose,
}) => {
  const { t } = useI18n();
  const [selectedHostId, setSelectedHostId] = useState<number | 'all'>('all');
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => {
    const targetCount = hosts.length;
    let completedCount = 0;
    let failedCount = 0;
    let runningCount = 0;
    for (const h of hosts) {
      if (h.status === 'SUCCESS' || h.status === 'SKIPPED') completedCount++;
      else if (h.status === 'FAILED') failedCount++;
      else if (h.status === 'RUNNING') runningCount++;
    }
    return { targetCount, completedCount, failedCount, runningCount };
  }, [hosts]);

  const selectedHostObj = useMemo(() => {
    if (selectedHostId === 'all') return null;
    return hosts.find((h) => h.server_id === selectedHostId) || null;
  }, [hosts, selectedHostId]);

  const filteredOutput = useMemo(
    () => filterAnsibleOutputByHost(stdout, stderr, selectedHostObj),
    [stdout, stderr, selectedHostObj]
  );

  return (
    <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
      {/* Top Job Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            {jobId
              ? `${t('Выполнение Ansible Job', 'Ansible Job Execution')} #${jobId}`
              : t('Выполнение Ansible Job', 'Ansible Job Execution')}
          </h2>
          <JobStatusBadge status={status} />
          {checkMode && (
            <span className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] text-sky-300">
              CHECK MODE (--check)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {jobId && (status === 'RUNNING' || status === 'PENDING') && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="inline-flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
            >
              <Square className="h-3 w-3" />
              <span>{t('Остановить Job', 'Cancel Job')}</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
              <span>{t('Закрыть', 'Close')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Job Metadata & Summary Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-md border border-slate-800 bg-[#0F172A] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Playbook</div>
          <div className="mt-1 truncate text-xs font-semibold text-slate-100">
            {playbookName || '—'}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-[#0F172A] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Inventory</div>
          <div className="mt-1 truncate text-xs font-semibold text-emerald-400">
            {inventoryName || '—'}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-[#0F172A] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            {t('Целевые серверы (Targets)', 'Targets')}
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-100">
            {summary.targetCount} {t('серв.', 'servers')}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-[#0F172A] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            {t('Завершено (Completed)', 'Completed')}
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-emerald-400">
            {summary.completedCount} / {summary.targetCount}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-[#0F172A] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            {t('Ошибки (Failed)', 'Failed')}
          </div>
          <div
            className={`mt-1 font-mono text-xs font-semibold ${
              summary.failedCount > 0 ? 'text-rose-400' : 'text-slate-300'
            }`}
          >
            {summary.failedCount}
          </div>
        </div>

        <div className="rounded-md border border-slate-800 bg-[#0F172A] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            {t('Время / Длительность', 'Started / Duration')}
          </div>
          <div className="mt-1 font-mono text-xs text-slate-200">
            {startedAt
              ? new Date(startedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '—'}{' '}
            · {formatDurationCompact(durationMs)}
          </div>
        </div>
      </div>

      {/* Active Task Banner */}
      {(status === 'RUNNING' || currentTask) && (
        <div className="flex items-center gap-2.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-xs text-sky-200">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
          <div className="truncate font-mono">
            <span className="font-semibold text-sky-300">
              {t('Текущая задача:', 'Current Task:')}
            </span>{' '}
            <span>{currentTask || t('Инициализация SSH-соединений...', 'Initializing SSH connections...')}</span>
          </div>
        </div>
      )}

      {/* Per-Server Targets Execution Breakdown */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t('Статус выполнения по серверам (Targets Execution)', 'Targets Execution Status')}
          </h3>
          <span className="font-mono text-[11px] text-slate-400">
            {summary.completedCount} {t('успешно', 'succeeded')} · {summary.failedCount}{' '}
            {t('ошибок', 'failed')}
          </span>
        </div>

        {hosts.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-[#0F172A] p-3 text-xs text-slate-400">
            {t(
              'Запустите Job, чтобы отслеживать статус выполнения по каждому целевому серверу.',
              'Start a job to track real-time execution status for each target server.'
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {hosts.map((h) => {
              const isFocused = selectedHostId === h.server_id;
              return (
                <div
                  key={h.server_id}
                  onClick={() =>
                    setSelectedHostId((prev) => (prev === h.server_id ? 'all' : h.server_id))
                  }
                  className={`cursor-pointer rounded-md border p-3 transition-colors ${
                    isFocused
                      ? 'border-emerald-500/60 bg-[#0F172A]'
                      : h.status === 'FAILED'
                      ? 'border-rose-500/40 bg-rose-950/15 hover:border-rose-500/60'
                      : h.status === 'RUNNING'
                      ? 'border-sky-500/40 bg-[#0F172A] hover:border-sky-500/60'
                      : 'border-slate-800 bg-[#0F172A]/90 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ServerIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate text-xs font-semibold text-slate-100">
                        {h.server_name}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {h.ip_address}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {h.duration_ms ? (
                        <span className="font-mono text-[11px] text-slate-400">
                          {formatDurationCompact(h.duration_ms)}
                        </span>
                      ) : null}
                      <HostStatusBadge status={h.status} />
                    </div>
                  </div>

                  {/* Task or Recap Counters */}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    {h.status === 'RUNNING' && (h.current_task || currentTask) ? (
                      <div className="truncate font-mono text-sky-300">
                        Task: {h.current_task || currentTask}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5 font-mono text-slate-400">
                        <span className={h.ok_count > 0 ? 'text-emerald-400' : ''}>
                          ok={h.ok_count}
                        </span>
                        <span className={h.changed_count > 0 ? 'text-amber-400' : ''}>
                          changed={h.changed_count}
                        </span>
                        <span
                          className={
                            h.failed_count > 0 || h.unreachable_count > 0
                              ? 'text-rose-400 font-semibold'
                              : ''
                          }
                        >
                          failed={h.failed_count + h.unreachable_count}
                        </span>
                        {h.skipped_count > 0 && <span>skipped={h.skipped_count}</span>}
                      </div>
                    )}
                  </div>

                  {h.error && (
                    <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-300 break-words">
                      Error: {h.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Output Console with Host Filter Tabs */}
      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mr-1">
              {t('Вывод консоли (Live Output):', 'Live Output:')}
            </span>
            <button
              type="button"
              onClick={() => setSelectedHostId('all')}
              className={`rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                selectedHostId === 'all'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-slate-700 bg-[#0F172A] text-slate-300 hover:bg-slate-800'
              }`}
            >
              All ({hosts.length})
            </button>
            {hosts.map((h) => (
              <button
                key={h.server_id}
                type="button"
                onClick={() => setSelectedHostId(h.server_id)}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors ${
                  selectedHostId === h.server_id
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-700 bg-[#0F172A] text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    h.status === 'SUCCESS'
                      ? 'bg-emerald-400'
                      : h.status === 'FAILED'
                      ? 'bg-rose-400'
                      : h.status === 'RUNNING'
                      ? 'bg-sky-400'
                      : 'bg-slate-500'
                  }`}
                />
                <span>{h.server_name}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
            {exitCode !== null && <span>exit={exitCode}</span>}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(filteredOutput || '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
            >
              <Copy className="h-3 w-3" />
              <span>{copied ? t('Скопировано', 'Copied') : t('Копировать', 'Copy')}</span>
            </button>
          </div>
        </div>

        <pre className="min-h-[260px] max-h-[460px] overflow-y-auto rounded-md border border-slate-800 bg-[#0F172A] p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
          {filteredOutput ? (
            filteredOutput
          ) : jobId ? (
            <span className="text-slate-400">
              {t(
                'Ожидание потокового вывода от процесса ansible-playbook...',
                'Waiting for real-time stdout/stderr stream from ansible-playbook...'
              )}
            </span>
          ) : (
            <span className="text-slate-500">
              {t(
                'Здесь будет отображаться потоковый вывод PLAY / TASK / PLAY RECAP в реальном времени.',
                'Real-time PLAY / TASK / PLAY RECAP output will stream here.'
              )}
            </span>
          )}
        </pre>
      </div>
    </div>
  );
};

interface RunPlaybookDialogProps {
  open: boolean;
  playbook: AnsiblePlaybook | null;
  inventories: AnsibleInventory[];
  initialInventoryId: number;
  isSubmitting: boolean;
  errorMessage: string;
  onClose: () => void;
  onCreateInventoryClick: () => void;
  onConfirmRun: (params: {
    playbookId: number;
    inventoryId: number;
    targetServerIds: number[];
    checkMode: boolean;
    diffMode: boolean;
    tags: string;
    extraVarsJson: string;
  }) => void;
}

export const RunPlaybookDialog: React.FC<RunPlaybookDialogProps> = ({
  open,
  playbook,
  inventories,
  initialInventoryId,
  isSubmitting,
  errorMessage,
  onClose,
  onCreateInventoryClick,
  onConfirmRun,
}) => {
  const { t } = useI18n();
  const [selectedInventoryId, setSelectedInventoryId] = useState<number>(initialInventoryId);
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([]);
  const [checkMode, setCheckMode] = useState<boolean>(false);
  const [diffMode, setDiffMode] = useState<boolean>(false);
  const [tags, setTags] = useState<string>('');
  const [extraVarsJson, setExtraVarsJson] = useState<string>('{}');

  const selectedInventory = useMemo(
    () => inventories.find((i) => i.id === selectedInventoryId) || null,
    [inventories, selectedInventoryId]
  );

  React.useEffect(() => {
    if (!open) return;
    setSelectedInventoryId(initialInventoryId);
    const inv = inventories.find((i) => i.id === initialInventoryId);
    setSelectedServerIds(inv ? inv.servers.map((s) => s.id) : []);
    setCheckMode(false);
    setDiffMode(false);
  }, [open, initialInventoryId, inventories]);

  const handleInventoryChange = (nextInvId: number) => {
    setSelectedInventoryId(nextInvId);
    const inv = inventories.find((i) => i.id === nextInvId);
    setSelectedServerIds(inv ? inv.servers.map((s) => s.id) : []);
  };

  const toggleTargetServer = (srvId: number) => {
    setSelectedServerIds((prev) =>
      prev.includes(srvId) ? prev.filter((id) => id !== srvId) : [...prev, srvId]
    );
  };

  if (!open || !playbook) return null;

  const canLaunch =
    selectedInventory !== null &&
    selectedInventory.servers.length > 0 &&
    selectedServerIds.length > 0 &&
    !isSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-[#1E293B] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Play className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {t('Запуск Ansible Playbook (Run Ansible Playbook)', 'Run Ansible Playbook')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="max-h-[78vh] overflow-y-auto px-5 py-4 space-y-4">
          {errorMessage && (
            <div className="flex items-start gap-2 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Playbook Info */}
          <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-3.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Playbook:
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-100">{playbook.name}</div>
            {playbook.description && (
              <div className="mt-0.5 text-xs text-slate-400">{playbook.description}</div>
            )}
          </div>

          {/* Inventory Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-200">
                Inventory:
              </label>
              {inventories.length === 0 && (
                <button
                  type="button"
                  onClick={onCreateInventoryClick}
                  className="text-xs font-medium text-emerald-400 hover:underline"
                >
                  {t('+ Создать Inventory', '+ Create Inventory')}
                </button>
              )}
            </div>
            <select
              value={selectedInventoryId}
              onChange={(e) => handleInventoryChange(Number(e.target.value))}
              className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value={0}>
                {t('-- Выберите инвентарь (Not selected) --', '-- Select Inventory (Not selected) --')}
              </option>
              {inventories.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.name} ({inv.server_count} {t('серверов', 'servers')})
                </option>
              ))}
            </select>
          </div>

          {/* Target Servers Checklist */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-200">
                {t('Целевые серверы (Target servers):', 'Target servers:')}
              </label>
              {selectedInventory && selectedInventory.servers.length > 0 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedServerIds(selectedInventory.servers.map((s) => s.id))
                    }
                    className="text-emerald-400 hover:underline"
                  >
                    {t('Выбрать все', 'Select all')}
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedServerIds([])}
                    className="text-slate-400 hover:underline"
                  >
                    {t('Снять все', 'Clear')}
                  </button>
                </div>
              )}
            </div>

            {!selectedInventory ? (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-3.5 text-xs text-slate-400">
                {t(
                  'Inventory не выбран. Выберите Inventory выше, чтобы увидеть список целевых серверов.',
                  'Inventory not selected. Choose an Inventory above to view and select target servers.'
                )}
              </div>
            ) : selectedInventory.servers.length === 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300">
                {t(
                  'В выбранном Inventory нет серверов. Добавьте серверы во вкладке «Инвентари».',
                  'Selected Inventory has no servers assigned. Add servers in the Inventories tab.'
                )}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-slate-800 bg-[#0F172A] p-3">
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {selectedInventory.servers.map((srv) => {
                    const checked = selectedServerIds.includes(srv.id);
                    return (
                      <label
                        key={srv.id}
                        className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-xs transition-colors ${
                          checked
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-slate-100'
                            : 'border-slate-800 bg-[#1E293B]/60 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTargetServer(srv.id)}
                            className="rounded border-slate-600 text-emerald-500"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-100 truncate">
                              {srv.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {srv.ip_address}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            srv.status === 'online'
                              ? 'bg-emerald-400'
                              : srv.status === 'offline'
                              ? 'bg-rose-500'
                              : 'bg-amber-400'
                          }`}
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-slate-800 pt-2 font-mono text-xs text-slate-300">
                  <span>
                    {t('Всего выбрано (Total):', 'Total:')} {selectedServerIds.length}{' '}
                    {t('из', 'of')} {selectedInventory.servers.length}{' '}
                    {t('серверов', 'servers')}
                  </span>
                  {selectedServerIds.length === 0 && (
                    <span className="text-rose-400">
                      {t('Выберите хотя бы 1 сервер', 'Select at least 1 server')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Execution Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">
              {t('Режим запуска (Mode):', 'Mode:')}
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-xs ${
                  !checkMode
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                    : 'border-slate-800 bg-[#0F172A] text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="ansible_run_mode"
                  checked={!checkMode}
                  onChange={() => setCheckMode(false)}
                  className="text-emerald-500"
                />
                <div>
                  <div className="font-semibold">Normal</div>
                  <div className="font-mono text-[10px] text-slate-400">
                    {t('Стандартное выполнение', 'Apply tasks over SSH')}
                  </div>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-xs ${
                  checkMode
                    ? 'border-sky-500/60 bg-sky-500/10 text-white'
                    : 'border-slate-800 bg-[#0F172A] text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="ansible_run_mode"
                  checked={checkMode}
                  onChange={() => setCheckMode(true)}
                  className="text-sky-500"
                />
                <div>
                  <div className="font-semibold">Check mode</div>
                  <div className="font-mono text-[10px] text-slate-400">
                    --check (dry-run)
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Optional Diff / Tags / Extra Vars */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                {t('Теги (--tags)', 'Tags (--tags)')}
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="health,audit"
                className="w-full rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                {t('Extra Vars (JSON)', 'Extra Vars (JSON)')}
              </label>
              <input
                type="text"
                value={extraVarsJson}
                onChange={(e) => setExtraVarsJson(e.target.value)}
                placeholder='{"prune_dangling": false}'
                className="w-full rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-800 bg-[#0F172A]/60 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 bg-[#0F172A] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            {t('Отмена', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={!canLaunch}
            onClick={() =>
              onConfirmRun({
                playbookId: playbook.id,
                inventoryId: selectedInventoryId,
                targetServerIds: selectedServerIds,
                checkMode,
                diffMode,
                tags,
                extraVarsJson,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>
              {isSubmitting
                ? t('Запуск...', 'Starting...')
                : t('Запустить', 'Run Playbook')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
