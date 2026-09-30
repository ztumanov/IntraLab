import React, { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Clock,
  Layers,
  Play,
  Plus,
  Rocket,
  Server as ServerIcon,
  Shield,
  Terminal,
  XCircle,
} from 'lucide-react';
import {
  useExecuteSshCommand,
  useServerCommandLogs,
  useServers,
} from '../hooks/useServers.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

interface PlaybookTemplate {
  id: string;
  titleRu: string;
  titleEn: string;
  descRu: string;
  descEn: string;
  category: string;
  command: string;
}

const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = [
  {
    id: 'health-audit',
    titleRu: 'Базовый аудит готовности узла (Node Readiness Check)',
    titleEn: 'Node Readiness & Health Audit',
    descRu: 'Проверка ядра ОС, аптайма, свободного места на дисках, загрузки CPU/RAM и статуса Docker.',
    descEn: 'Verifies OS kernel, uptime, disk space, CPU/RAM pressure, and Docker service status.',
    category: 'Audit',
    command:
      'echo "=== HOST ===" && uname -snrm && uptime && echo "=== DISK ===" && df -h / && echo "=== MEMORY ===" && free -m && echo "=== DOCKER ===" && (docker ps --format "table {{.Names}}\\t{{.Status}}" 2>/dev/null || echo "Docker not active")',
  },
  {
    id: 'docker-prune-sync',
    titleRu: 'Очистка кеша Docker и проверка контейнеров',
    titleEn: 'Docker Image Prune & Container Health Sync',
    descRu: 'Удаление неиспользуемых dangling-образов Docker и вывод статуса всех запущенных сервисов.',
    descEn: 'Removes dangling Docker images and lists live status of all active containers.',
    category: 'Docker',
    command:
      'if docker info >/dev/null 2>&1; then docker image prune -f && docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"; else sudo -n docker image prune -f && sudo -n docker ps -a; fi',
  },
  {
    id: 'security-ports-check',
    titleRu: 'Аудит безопасности и открытых сокетов',
    titleEn: 'Security & Listening Sockets Audit',
    descRu: 'Инспекция активных SSH-сессий, открытых портов TCP/UDP и последних входов в систему.',
    descEn: 'Inspects active user sessions, listening TCP/UDP ports, and recent login events.',
    category: 'Security',
    command:
      'echo "=== WHO ===" && who && echo "=== LISTENING PORTS ===" && (ss -tuln 2>/dev/null | head -n 20) && echo "=== LAST LOGINS ===" && (last -n 5 2>/dev/null || echo "No wtmp")',
  },
  {
    id: 'package-updates-check',
    titleRu: 'Проверка обновлений пакетов ОС (APT / DNF)',
    titleEn: 'OS Package & Security Updates Check',
    descRu: 'Неразрушающая проверка наличия обновлений пакетов в репозиториях Ubuntu/Debian/RHEL.',
    descEn: 'Non-destructive check for upgradable system packages on Ubuntu/Debian/RHEL.',
    category: 'System',
    command:
      'if command -v apt >/dev/null 2>&1; then apt list --upgradable 2>/dev/null | head -n 20; elif command -v dnf >/dev/null 2>&1; then dnf check-update --quiet | head -n 20; else uname -a; fi',
  },
];

export const DeploymentsPage: React.FC = () => {
  const { data: servers = [], isLoading: isServersLoading } = useServers();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const { locale, t } = useI18n();

  const paramId = Number(searchParams.get('serverId'));
  const [selectedServerId, setSelectedServerId] = useState<number>(0);

  useEffect(() => {
    if (servers.length === 0) return;
    if (paramId && servers.some((s) => s.id === paramId)) {
      setSelectedServerId(paramId);
    } else if (!selectedServerId || !servers.some((s) => s.id === selectedServerId)) {
      const onlineFirst = servers.find((s) => s.status === 'online') || servers[0];
      setSelectedServerId(onlineFirst.id);
    }
  }, [servers, paramId, selectedServerId]);

  const handleSelectServer = (id: number) => {
    setSelectedServerId(id);
    setSearchParams({ serverId: String(id) });
  };

  const selectedServer = servers.find((s) => s.id === selectedServerId) || null;
  const { data: commandLogs = [], isLoading: isLogsLoading } =
    useServerCommandLogs(selectedServerId);
  const execMutation = useExecuteSshCommand();

  const [customScript, setCustomScript] = useState<string>(
    'echo "Deploying release $(date -u +%Y%m%d-%H%M%S)..." && uname -a && df -h /'
  );
  const [activePlaybookId, setActivePlaybookId] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<{
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  } | null>(null);

  const runCommandOnHost = (command: string, playbookId: string) => {
    if (!selectedServerId) return;
    setActivePlaybookId(playbookId);
    execMutation.mutate(
      { id: selectedServerId, command },
      {
        onSuccess: (res) => {
          setLastOutput({
            command: res.command,
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exit_code,
            durationMs: res.duration_ms,
          });
          setActivePlaybookId(null);
        },
        onError: (err: any) => {
          setLastOutput({
            command,
            stdout: '',
            stderr: err?.message || 'SSH rollout execution failed',
            exitCode: 255,
            durationMs: 0,
          });
          setActivePlaybookId(null);
        },
      }
    );
  };

  if (isServersLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800" />
        <div className="h-72 animate-pulse rounded-lg border border-slate-800 bg-[#1E293B]" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-10 text-center">
        <Rocket className="mx-auto h-10 w-10 text-slate-500" />
        <h1 className="mt-3 text-lg font-semibold text-slate-100">
          {t('Развёртывания и автоматизация (Deployments)', 'Deployments & Automation')}
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          {t(
            'Добавьте Linux-сервер для запуска SSH-сценариев развёртывания и аудита инфраструктуры.',
            'Add a Linux server to run SSH deployment playbooks and infrastructure rollouts.'
          )}
        </p>
        <button
          type="button"
          onClick={openAddServerModal}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t('+ Добавить сервер', '+ Add Server')}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Развёртывания и SSH-плейбуки (Deployments)', 'Deployments & SSH Playbooks')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Автоматизированное выполнение сценариев обслуживания, выкатки контейнеров и проверок на узлах Linux.',
              'Automated execution of maintenance playbooks, container rollouts, and readiness checks on Linux hosts.'
            )}
          </p>
        </div>

        {selectedServer && (
          <div className="flex items-center gap-2.5">
            <Link
              to={`/containers?serverId=${selectedServer.id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
            >
              <Layers className="h-3.5 w-3.5 text-sky-400" />
              <span>{t('Контейнеры Docker', 'Docker Containers')}</span>
            </Link>
          </div>
        )}
      </div>

      {/* Target Server Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#1E293B] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400">
            {t('Целевой сервер для выкатки:', 'Target Deployment Host:')}
          </span>
          {servers.map((srv) => {
            const active = srv.id === selectedServerId;
            return (
              <button
                key={srv.id}
                type="button"
                onClick={() => handleSelectServer(srv.id)}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-white'
                    : 'border-slate-700 bg-[#0F172A] text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    srv.status === 'online'
                      ? 'bg-emerald-400'
                      : srv.status === 'offline'
                      ? 'bg-rose-500'
                      : 'bg-amber-400'
                  }`}
                />
                <span>{srv.name}</span>
                <span className="font-mono text-[11px] text-slate-400">({srv.ip_address})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Standard Playbooks Grid */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-100">
          {t('Готовые сценарии автоматизации (Standard Playbooks)', 'Standard Automation Playbooks')}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PLAYBOOK_TEMPLATES.map((pb) => {
            const isRunning = execMutation.isPending && activePlaybookId === pb.id;
            return (
              <div
                key={pb.id}
                className="flex flex-col justify-between rounded-lg border border-slate-800 bg-[#1E293B] p-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                      {pb.category}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">SSH Rollout</span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    {locale === 'ru' ? pb.titleRu : pb.titleEn}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {locale === 'ru' ? pb.descRu : pb.descEn}
                  </p>
                  <div className="rounded border border-slate-800 bg-[#0F172A] px-3 py-2 font-mono text-[11px] text-slate-400 truncate">
                    $ {pb.command}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => runCommandOnHost(pb.command, pb.id)}
                    disabled={execMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>
                      {isRunning
                        ? t('Выполняется на узле...', 'Executing on node...')
                        : t('Запустить плейбук', 'Run Playbook')}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Custom Deployment Script Runner */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t(
                'Пользовательский скрипт развёртывания (Custom Rollout Command)',
                'Custom Rollout Script Execution'
              )}
            </h2>
          </div>
          {selectedServer && (
            <span className="font-mono text-xs text-slate-400">
              {selectedServer.username}@{selectedServer.ip_address}
            </span>
          )}
        </div>

        <div className="space-y-3">
          <textarea
            rows={3}
            value={customScript}
            onChange={(e) => setCustomScript(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-[#0F172A] p-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            placeholder="docker pull ... && docker stop ... && docker run ..."
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => runCommandOnHost(customScript, 'custom')}
              disabled={execMutation.isPending || !customScript.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
            >
              <Rocket className="h-3.5 w-3.5" />
              <span>
                {execMutation.isPending && activePlaybookId === 'custom'
                  ? t('Выкатка...', 'Deploying...')
                  : t('Выполнить деплой-команду', 'Execute Rollout Command')}
              </span>
            </button>
          </div>
        </div>

        {lastOutput && (
          <div className="rounded-md border border-slate-800 bg-[#0F172A] p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 font-mono text-xs">
              <span className="truncate text-slate-300">$ {lastOutput.command}</span>
              <span
                className={
                  lastOutput.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                exit {lastOutput.exitCode} · {lastOutput.durationMs}ms
              </span>
            </div>
            <pre className="max-h-64 overflow-y-auto font-mono text-xs text-slate-200 whitespace-pre-wrap">
              {(lastOutput.stdout + (lastOutput.stderr ? `\n${lastOutput.stderr}` : '')).trim() ||
                'OK (no stdout)'}
            </pre>
          </div>
        )}
      </section>

      {/* Deployment & Command Audit History */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-100">
          {t(
            'Журнал выполненных развёртываний и SSH-операций',
            'Deployment & SSH Rollout History'
          )}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 font-medium text-slate-400">
                <th className="px-4 py-3">{t('Статус', 'Status')}</th>
                <th className="px-4 py-3">{t('Команда / Плейбук', 'Command / Playbook')}</th>
                <th className="px-4 py-3">{t('Длительность', 'Duration')}</th>
                <th className="px-4 py-3">{t('Время', 'Executed At')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {isLogsLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    {t('Загрузка истории...', 'Loading deployment history...')}
                  </td>
                </tr>
              ) : commandLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    {t(
                      'На этом узле ещё не запускались плейбуки.',
                      'No playbooks executed on this host yet.'
                    )}
                  </td>
                </tr>
              ) : (
                commandLogs.slice(0, 12).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      {log.exit_code === 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>SUCCESS (0)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>EXIT {log.exit_code}</span>
                        </span>
                      )}
                    </td>
                    <td className="max-w-[420px] truncate px-4 py-2.5 text-slate-200">
                      {log.command}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">
                      {log.duration_ms}ms
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">
                      {new Date(log.executed_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
