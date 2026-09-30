import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Cpu,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import { useCheckAllServers, useServers } from '../hooks/useServers.ts';
import { Server } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface AlertThresholds {
  cpuWarnPercent: number;
  memWarnPercent: number;
  diskCritPercent: number;
  latencyWarnMs: number;
}

const DEFAULT_THRESHOLDS: AlertThresholds = {
  cpuWarnPercent: 80,
  memWarnPercent: 85,
  diskCritPercent: 85,
  latencyWarnMs: 250,
};

interface EvaluatedAlert {
  id: string;
  server: Server;
  severity: 'critical' | 'warning';
  metric: 'SSH' | 'DISK' | 'CPU' | 'RAM' | 'LATENCY';
  titleRu: string;
  titleEn: string;
  detailRu: string;
  detailEn: string;
  currentValue: string;
  thresholdValue: string;
}

export const AlertsPage: React.FC = () => {
  const { data: servers = [], isLoading } = useServers();
  const checkAllMutation = useCheckAllServers();
  const { locale, t } = useI18n();

  const [thresholds, setThresholds] = useState<AlertThresholds>(() => {
    try {
      const saved = localStorage.getItem('infralab_alert_thresholds');
      if (saved) return { ...DEFAULT_THRESHOLDS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_THRESHOLDS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('infralab_alert_thresholds', JSON.stringify(thresholds));
    } catch {
      // ignore
    }
  }, [thresholds]);

  const activeAlerts = useMemo<EvaluatedAlert[]>(() => {
    const list: EvaluatedAlert[] = [];

    for (const srv of servers) {
      if (srv.status === 'offline') {
        list.push({
          id: `ssh-offline-${srv.id}`,
          server: srv,
          severity: 'critical',
          metric: 'SSH',
          titleRu: 'Узел недоступен по SSH (Host Unreachable)',
          titleEn: 'Host Unreachable via SSH',
          detailRu: srv.last_check_error || 'Соединение отклонено или превышен таймаут',
          detailEn: srv.last_check_error || 'Connection refused or timed out',
          currentValue: 'OFFLINE',
          thresholdValue: 'ONLINE',
        });
      }

      if (
        typeof srv.disk_usage_percent === 'number' &&
        srv.disk_usage_percent >= thresholds.diskCritPercent
      ) {
        list.push({
          id: `disk-high-${srv.id}`,
          server: srv,
          severity: srv.disk_usage_percent >= 90 ? 'critical' : 'warning',
          metric: 'DISK',
          titleRu: 'Критическое заполнение дискового раздела',
          titleEn: 'High Root Filesystem Disk Usage',
          detailRu: `Использовано ${srv.disk_used_gb} из ${srv.disk_total_gb} на корневом разделе`,
          detailEn: `Used ${srv.disk_used_gb} of ${srv.disk_total_gb} on root filesystem`,
          currentValue: `${srv.disk_usage_percent}%`,
          thresholdValue: `>= ${thresholds.diskCritPercent}%`,
        });
      }

      if (
        typeof srv.cpu_usage_percent === 'number' &&
        srv.cpu_usage_percent >= thresholds.cpuWarnPercent
      ) {
        list.push({
          id: `cpu-high-${srv.id}`,
          server: srv,
          severity: srv.cpu_usage_percent >= 95 ? 'critical' : 'warning',
          metric: 'CPU',
          titleRu: 'Высокая загрузка процессора (CPU Load)',
          titleEn: 'High CPU Utilization',
          detailRu: `Load Avg: ${srv.cpu_load || '—'} (${srv.cpu_cores ?? 1} vCPU)`,
          detailEn: `Load Avg: ${srv.cpu_load || '—'} (${srv.cpu_cores ?? 1} vCPU)`,
          currentValue: `${srv.cpu_usage_percent}%`,
          thresholdValue: `>= ${thresholds.cpuWarnPercent}%`,
        });
      }

      if (srv.memory_mb && srv.memory_used_mb) {
        const memPct = Math.round((srv.memory_used_mb / srv.memory_mb) * 100);
        if (memPct >= thresholds.memWarnPercent) {
          list.push({
            id: `ram-high-${srv.id}`,
            server: srv,
            severity: memPct >= 95 ? 'critical' : 'warning',
            metric: 'RAM',
            titleRu: 'Высокое потребление оперативной памяти (RAM)',
            titleEn: 'High Memory Utilization',
            detailRu: `${srv.memory_used_mb} MB / ${srv.memory_mb} MB`,
            detailEn: `${srv.memory_used_mb} MB / ${srv.memory_mb} MB`,
            currentValue: `${memPct}%`,
            thresholdValue: `>= ${thresholds.memWarnPercent}%`,
          });
        }
      }

      if (
        typeof srv.latency_ms === 'number' &&
        srv.latency_ms >= thresholds.latencyWarnMs
      ) {
        list.push({
          id: `latency-high-${srv.id}`,
          server: srv,
          severity: 'warning',
          metric: 'LATENCY',
          titleRu: 'Повышенная сетевая задержка SSH-отклика',
          titleEn: 'Elevated SSH Round-Trip Latency',
          detailRu: `Пинг до ${srv.ip_address}:${srv.ssh_port} превышает порог`,
          detailEn: `SSH handshake latency to ${srv.ip_address}:${srv.ssh_port} exceeds threshold`,
          currentValue: `${srv.latency_ms}ms`,
          thresholdValue: `>= ${thresholds.latencyWarnMs}ms`,
        });
      }
    }

    return list;
  }, [servers, thresholds]);

  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical').length;
  const warningCount = activeAlerts.filter((a) => a.severity === 'warning').length;
  const healthyNodesCount = servers.filter(
    (s) => s.status === 'online' && !activeAlerts.some((a) => a.server.id === s.id)
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Оповещения и пороговые правила (Alerts)', 'Alerts & Threshold Rules')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Автоматический контроль доступности SSH, заполнения дисков, нагрузки CPU/RAM и сетевых задержек.',
              'Automated monitoring of SSH reachability, disk capacity, CPU/RAM pressure, and network latency.'
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => checkAllMutation.mutate()}
          disabled={checkAllMutation.isPending || servers.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${checkAllMutation.isPending ? 'animate-spin' : ''}`}
          />
          <span>
            {checkAllMutation.isPending
              ? t('Проверка всех серверов...', 'Checking Fleet...')
              : t('Перепроверить все узлы (SSH)', 'Re-evaluate Fleet Now')}
          </span>
        </button>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
          <p className="text-xs font-medium text-slate-400">
            {t('Критические инциденты (Critical)', 'Critical Incidents')}
          </p>
          <p className="mt-2 font-mono text-3xl font-semibold text-rose-400 tabular-nums">
            {isLoading ? '—' : criticalCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('Требуют внимания инженера (SSH / Диск)', 'Require immediate operator action')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
          <p className="text-xs font-medium text-slate-400">
            {t('Предупреждения (Warning)', 'Active Warnings')}
          </p>
          <p className="mt-2 font-mono text-3xl font-semibold text-amber-400 tabular-nums">
            {isLoading ? '—' : warningCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('Повышенная нагрузка или задержка', 'Elevated resource usage or latency')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
          <p className="text-xs font-medium text-slate-400">
            {t('Узлы без отклонений (Healthy)', 'Healthy Nodes (All Green)')}
          </p>
          <p className="mt-2 font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
            {isLoading ? '—' : `${healthyNodesCount} / ${servers.length}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('Все показатели в пределах нормы', 'All metrics within configured thresholds')}
          </p>
        </div>
      </section>

      {/* Active Alerts List */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-100">
          {t('Активные срабатывания по инфраструктуре', 'Active Fleet Alerts')} (
          {activeAlerts.length})
        </h2>

        {activeAlerts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-5 text-sm text-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="font-semibold">
                {t(
                  'Все серверы работают в штатном режиме',
                  'All servers are operating within normal thresholds'
                )}
              </p>
              <p className="text-xs text-emerald-300/80">
                {t(
                  'Ни один из контролируемых порогов CPU, RAM, Disk или SSH не превышен.',
                  'No CPU, RAM, Disk, or SSH availability thresholds are currently breached.'
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex flex-col justify-between gap-4 rounded-lg border p-4 sm:flex-row sm:items-center ${
                  alert.severity === 'critical'
                    ? 'border-rose-500/40 bg-rose-950/20'
                    : 'border-amber-500/40 bg-amber-950/20'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-mono text-xs font-bold uppercase ${
                        alert.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'
                      }`}
                    >
                      [{alert.severity.toUpperCase()} · {alert.metric}]
                    </span>
                    <span className="text-sm font-semibold text-slate-100">
                      {locale === 'ru' ? alert.titleRu : alert.titleEn}
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                      — {alert.server.name} ({alert.server.ip_address})
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    {locale === 'ru' ? alert.detailRu : alert.detailEn}
                  </p>
                </div>

                <div className="flex items-center gap-4 self-end sm:self-center">
                  <div className="text-right font-mono text-xs">
                    <div className="font-bold text-slate-100 tabular-nums">
                      {alert.currentValue}
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {t('Порог:', 'Limit:')} {alert.thresholdValue}
                    </div>
                  </div>

                  <Link
                    to={`/metrics?serverId=${alert.server.id}`}
                    className="rounded-md border border-slate-700 bg-[#0F172A] px-3 py-1.5 font-mono text-xs text-emerald-400 hover:bg-slate-800 whitespace-nowrap"
                  >
                    {t('Диагностика →', 'Inspect →')}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Configurable Threshold Policy */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t('Настройка пороговых правил (Alert Policy Thresholds)', 'Alert Policy Thresholds')}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
            className="font-mono text-xs text-slate-400 hover:text-slate-200"
          >
            {t('Сбросить по умолчанию', 'Reset Defaults')}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-slate-800 bg-[#0F172A] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{t('Порог Диска (Disk %)', 'Disk Usage Limit')}</span>
              <span className="font-mono font-semibold text-rose-400 tabular-nums">
                {thresholds.diskCritPercent}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={98}
              value={thresholds.diskCritPercent}
              onChange={(e) =>
                setThresholds((prev) => ({ ...prev, diskCritPercent: Number(e.target.value) }))
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="rounded border border-slate-800 bg-[#0F172A] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{t('Порог CPU (CPU %)', 'CPU Usage Limit')}</span>
              <span className="font-mono font-semibold text-amber-400 tabular-nums">
                {thresholds.cpuWarnPercent}%
              </span>
            </div>
            <input
              type="range"
              min={40}
              max={98}
              value={thresholds.cpuWarnPercent}
              onChange={(e) =>
                setThresholds((prev) => ({ ...prev, cpuWarnPercent: Number(e.target.value) }))
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="rounded border border-slate-800 bg-[#0F172A] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{t('Порог Памяти (RAM %)', 'RAM Usage Limit')}</span>
              <span className="font-mono font-semibold text-amber-400 tabular-nums">
                {thresholds.memWarnPercent}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={98}
              value={thresholds.memWarnPercent}
              onChange={(e) =>
                setThresholds((prev) => ({ ...prev, memWarnPercent: Number(e.target.value) }))
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="rounded border border-slate-800 bg-[#0F172A] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">
                {t('Задержка SSH (Latency)', 'SSH Latency Limit')}
              </span>
              <span className="font-mono font-semibold text-sky-400 tabular-nums">
                {thresholds.latencyWarnMs}ms
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={1000}
              step={25}
              value={thresholds.latencyWarnMs}
              onChange={(e) =>
                setThresholds((prev) => ({ ...prev, latencyWarnMs: Number(e.target.value) }))
              }
              className="w-full accent-emerald-500"
            />
          </div>
        </div>
      </section>
    </div>
  );
};
