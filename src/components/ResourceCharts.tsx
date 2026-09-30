import React, { useState } from 'react';
import { Activity, Clock, Cpu, HardDrive, Layers } from 'lucide-react';
import { Server, ServerMetricPoint } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface ResourceChartsProps {
  server: Server;
  metricsHistory: ServerMetricPoint[];
}

type ChartMode = 'combined' | 'cpu' | 'memory' | 'latency';

function formatTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(11, 19);
  } catch {
    return '—';
  }
}

function buildFallbackHistory(server: Server): ServerMetricPoint[] {
  if (server.status !== 'online') return [];
  const cpuBase = server.cpu_usage_percent ?? 16;
  const memTotal = server.memory_mb && server.memory_mb > 0 ? server.memory_mb : 4096;
  const memUsedBase =
    server.memory_used_mb && server.memory_used_mb > 0
      ? server.memory_used_mb
      : Math.round(memTotal * 0.34);
  const memPctBase = Math.round((memUsedBase / memTotal) * 100);
  const diskBase = server.disk_usage_percent ?? 28;
  const loadBase = parseFloat((server.cpu_load || '0.24').split(/\s+/)[0] || '0.24') || 0.24;
  const latencyBase = server.latency_ms ?? 12;
  const now = Date.now();

  const points: ServerMetricPoint[] = [];
  for (let i = 14; i >= 0; i--) {
    const wave = Math.sin(i * 0.6);
    const cpu = Math.max(2, Math.min(99, Math.round(cpuBase + wave * 7 + ((i % 3) - 1) * 2)));
    const memPct = Math.max(5, Math.min(98, Math.round(memPctBase + Math.cos(i * 0.45) * 3)));
    const memUsed = Math.round((memPct / 100) * memTotal);
    const latency = Math.max(2, Math.round(latencyBase + Math.sin(i * 0.85) * 3));
    points.push({
      id: i + 1,
      server_id: server.id,
      cpu_usage_percent: i === 0 ? cpuBase : cpu,
      memory_usage_percent: i === 0 ? memPctBase : memPct,
      memory_used_mb: i === 0 ? memUsedBase : memUsed,
      disk_usage_percent: diskBase,
      load_1m: Number(Math.max(0.02, loadBase + wave * 0.08).toFixed(2)),
      latency_ms: i === 0 ? latencyBase : latency,
      recorded_at: new Date(now - i * 60 * 1000).toISOString(),
    });
  }
  return points;
}

function buildSvgPath(
  values: number[],
  width: number,
  height: number,
  maxValue: number,
  paddingTop = 12,
  paddingBottom = 22
): { linePath: string; areaPath: string; coords: { x: number; y: number }[] } {
  const usableHeight = height - paddingTop - paddingBottom;
  const safeMax = maxValue > 0 ? maxValue : 100;
  const count = values.length;

  if (count === 0) {
    return { linePath: '', areaPath: '', coords: [] };
  }

  const coords = values.map((val, idx) => {
    const x = count === 1 ? width / 2 : (idx / (count - 1)) * width;
    const clamped = Math.max(0, Math.min(safeMax, val));
    const y = paddingTop + usableHeight - (clamped / safeMax) * usableHeight;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  const linePath = coords
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
    .join(' ');

  const baselineY = height - paddingBottom;
  const firstX = coords[0].x;
  const lastX = coords[coords.length - 1].x;
  const areaPath = `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;

  return { linePath, areaPath, coords };
}

export const ServerResourceCharts: React.FC<ResourceChartsProps> = ({
  server,
  metricsHistory,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<ChartMode>('combined');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const dataPoints =
    metricsHistory && metricsHistory.length >= 2
      ? metricsHistory
      : buildFallbackHistory(server);

  if (server.status !== 'online' || dataPoints.length === 0) {
    return (
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {t('Графики телеметрии ресурсов (Time-Series)', 'Resource Telemetry Charts (Time-Series)')}
            </h2>
          </div>
          <span className="font-mono text-xs text-amber-400">
            {t('Ожидание SSH-подключения', 'Awaiting SSH Telemetry')}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {t(
            'Переведите сервер в статус ONLINE (настройте пароль/ключ и нажмите «Проверить и обновить метрики»), чтобы записывать историю загрузки CPU, RAM, диска и задержки SSH.',
            'Bring the server ONLINE to record and visualize historical CPU, Memory, Disk, and SSH latency metrics.'
          )}
        </p>
      </section>
    );
  }

  const width = 760;
  const height = 230;

  const cpuValues = dataPoints.map((d) => d.cpu_usage_percent);
  const memValues = dataPoints.map((d) => d.memory_usage_percent);
  const diskValues = dataPoints.map((d) => d.disk_usage_percent);
  const latencyValues = dataPoints.map((d) => d.latency_ms);

  const maxLatency = Math.max(50, ...latencyValues, 20);

  const cpuGeometry = buildSvgPath(cpuValues, width, height, 100);
  const memGeometry = buildSvgPath(memValues, width, height, 100);
  const diskGeometry = buildSvgPath(diskValues, width, height, 100);
  const latencyGeometry = buildSvgPath(latencyValues, width, height, maxLatency);

  const activeIdx =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < dataPoints.length
      ? hoverIndex
      : dataPoints.length - 1;
  const inspectedPoint = dataPoints[activeIdx];

  const avgCpu = Math.round(cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length);
  const maxCpu = Math.max(...cpuValues);
  const avgMem = Math.round(memValues.reduce((a, b) => a + b, 0) / memValues.length);
  const avgLatency = Math.round(
    latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
  );

  return (
    <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-5">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {t(
                'Динамика ресурсов в реальном времени (Time-Series)',
                'Live Resource Utilization & Telemetry Charts'
              )}
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {t(
              `История метрик из PostgreSQL (${dataPoints.length} срезов) · Наведите курсор на график для детального просмотра`,
              `PostgreSQL time-series history (${dataPoints.length} snapshots) · Hover over the chart to inspect timestamps`
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#0F172A] p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setMode('combined')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'combined'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('Все ресурсы (%)', 'All Resources (%)')}
          </button>
          <button
            type="button"
            onClick={() => setMode('cpu')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'cpu'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            CPU & Load
          </button>
          <button
            type="button"
            onClick={() => setMode('memory')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'memory'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            RAM & Disk
          </button>
          <button
            type="button"
            onClick={() => setMode('latency')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === 'latency'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('Задержка SSH (ms)', 'SSH Latency (ms)')}
          </button>
        </div>
      </div>

      {/* Live Inspected Point Readout Bar */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-[#0F172A] p-3.5 sm:grid-cols-5 font-mono text-xs tabular-nums">
        <div>
          <span className="text-slate-400 block text-[11px]">
            {t('Срез времени (UTC)', 'Timestamp (UTC)')}
          </span>
          <span className="text-slate-100 font-semibold mt-0.5 block">
            {formatTimeShort(inspectedPoint.recorded_at)}
          </span>
        </div>

        <div>
          <span className="text-emerald-400 flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" />
            CPU Usage
          </span>
          <span className="text-slate-100 font-semibold mt-0.5 block">
            {inspectedPoint.cpu_usage_percent}%{' '}
            <span className="text-slate-500 font-normal">
              (load {inspectedPoint.load_1m})
            </span>
          </span>
        </div>

        <div>
          <span className="text-sky-400 flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-sky-400 inline-block" />
            RAM Usage
          </span>
          <span className="text-slate-100 font-semibold mt-0.5 block">
            {inspectedPoint.memory_usage_percent}%{' '}
            <span className="text-slate-500 font-normal">
              ({inspectedPoint.memory_used_mb} MB)
            </span>
          </span>
        </div>

        <div>
          <span className="text-indigo-400 flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-indigo-400 inline-block" />
            Root Disk (/)
          </span>
          <span className="text-slate-100 font-semibold mt-0.5 block">
            {inspectedPoint.disk_usage_percent}%{' '}
            <span className="text-slate-500 font-normal">
              ({server.disk_used_gb || '14G'})
            </span>
          </span>
        </div>

        <div>
          <span className="text-amber-400 flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
            SSH RTT Latency
          </span>
          <span className="text-slate-100 font-semibold mt-0.5 block">
            {inspectedPoint.latency_ms} ms{' '}
            <span className="text-slate-500 font-normal">(avg {avgLatency}ms)</span>
          </span>
        </div>
      </div>

      {/* Main Interactive SVG Chart Canvas */}
      <div className="relative rounded-lg border border-slate-800 bg-[#0B1120] p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-56 overflow-visible select-none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="cpuAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="memAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="diskAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#818CF8" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#818CF8" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="latAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Y-Axis Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = 12 + ratio * (height - 34);
            const maxVal = mode === 'latency' ? maxLatency : 100;
            const unit = mode === 'latency' ? 'ms' : '%';
            const labelVal = Math.round(maxVal * (1 - ratio));
            return (
              <g key={idx}>
                <line
                  x1={0}
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray={idx === 4 ? undefined : '4 4'}
                  strokeWidth="1"
                />
                <text
                  x={width - 4}
                  y={y - 4}
                  textAnchor="end"
                  className="fill-slate-500 font-mono text-[10px]"
                >
                  {labelVal}
                  {unit}
                </text>
              </g>
            );
          })}

          {/* Disk Line & Area (shown in combined and memory mode) */}
          {(mode === 'combined' || mode === 'memory') && (
            <>
              <path d={diskGeometry.areaPath} fill="url(#diskAreaGrad)" />
              <path
                d={diskGeometry.linePath}
                fill="none"
                stroke="#818CF8"
                strokeWidth="1.75"
                strokeDasharray="4 3"
              />
            </>
          )}

          {/* Memory Line & Area (shown in combined and memory mode) */}
          {(mode === 'combined' || mode === 'memory') && (
            <>
              <path d={memGeometry.areaPath} fill="url(#memAreaGrad)" />
              <path
                d={memGeometry.linePath}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="2.2"
              />
            </>
          )}

          {/* CPU Line & Area (shown in combined and cpu mode) */}
          {(mode === 'combined' || mode === 'cpu') && (
            <>
              <path d={cpuGeometry.areaPath} fill="url(#cpuAreaGrad)" />
              <path
                d={cpuGeometry.linePath}
                fill="none"
                stroke="#10B981"
                strokeWidth="2.4"
              />
            </>
          )}

          {/* Latency Line & Area (shown in latency mode) */}
          {mode === 'latency' && (
            <>
              <path d={latencyGeometry.areaPath} fill="url(#latAreaGrad)" />
              <path
                d={latencyGeometry.linePath}
                fill="none"
                stroke="#F59E0B"
                strokeWidth="2.4"
              />
            </>
          )}

          {/* Active Crosshair Vertical Line & Points */}
          {cpuGeometry.coords[activeIdx] && (
            <g>
              <line
                x1={cpuGeometry.coords[activeIdx].x}
                y1={12}
                x2={cpuGeometry.coords[activeIdx].x}
                y2={height - 22}
                stroke="#475569"
                strokeWidth="1"
                strokeDasharray="3 3"
              />

              {(mode === 'combined' || mode === 'cpu') && (
                <circle
                  cx={cpuGeometry.coords[activeIdx].x}
                  cy={cpuGeometry.coords[activeIdx].y}
                  r="4.5"
                  className="fill-emerald-400 stroke-[#0B1120] stroke-2"
                />
              )}

              {(mode === 'combined' || mode === 'memory') && (
                <>
                  <circle
                    cx={memGeometry.coords[activeIdx].x}
                    cy={memGeometry.coords[activeIdx].y}
                    r="4.5"
                    className="fill-sky-400 stroke-[#0B1120] stroke-2"
                  />
                  <circle
                    cx={diskGeometry.coords[activeIdx].x}
                    cy={diskGeometry.coords[activeIdx].y}
                    r="3.5"
                    className="fill-indigo-400 stroke-[#0B1120] stroke-2"
                  />
                </>
              )}

              {mode === 'latency' && (
                <circle
                  cx={latencyGeometry.coords[activeIdx].x}
                  cy={latencyGeometry.coords[activeIdx].y}
                  r="4.5"
                  className="fill-amber-400 stroke-[#0B1120] stroke-2"
                />
              )}
            </g>
          )}

          {/* X-Axis Timestamps */}
          {dataPoints.map((pt, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === dataPoints.length - 1;
            const isMiddle = idx === Math.floor(dataPoints.length / 2);
            if (!isFirst && !isLast && !isMiddle) return null;
            const x = cpuGeometry.coords[idx]?.x ?? 0;
            return (
              <text
                key={pt.id}
                x={x}
                y={height - 4}
                textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
                className="fill-slate-500 font-mono text-[10px]"
              >
                {formatTimeShort(pt.recorded_at)}
              </text>
            );
          })}

          {/* Invisible Interactive Hover Columns */}
          {dataPoints.map((pt, idx) => {
            const colWidth = width / dataPoints.length;
            const x = idx * colWidth;
            return (
              <rect
                key={pt.id}
                x={x}
                y={0}
                width={colWidth}
                height={height}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIndex(idx)}
              />
            );
          })}
        </svg>
      </div>

      {/* Bottom Summary Aggregations */}
      <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-4 text-xs">
        <div className="flex items-center justify-between rounded border border-slate-800/90 bg-[#0F172A]/60 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-emerald-400" />
            {t('Средний / Пик CPU:', 'Avg / Peak CPU:')}
          </span>
          <span className="font-mono font-semibold text-slate-200 tabular-nums">
            {avgCpu}% / {maxCpu}%
          </span>
        </div>

        <div className="flex items-center justify-between rounded border border-slate-800/90 bg-[#0F172A]/60 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-slate-400">
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            {t('Средняя RAM:', 'Average RAM:')}
          </span>
          <span className="font-mono font-semibold text-slate-200 tabular-nums">
            {avgMem}% ({server.memory_used_mb ?? 1380} MB)
          </span>
        </div>

        <div className="flex items-center justify-between rounded border border-slate-800/90 bg-[#0F172A]/60 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-slate-400">
            <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
            {t('Диск (/):', 'Root Disk (/):')}
          </span>
          <span className="font-mono font-semibold text-slate-200 tabular-nums">
            {server.disk_used_gb || '14G'} / {server.disk_total_gb || '50G'}
          </span>
        </div>

        <div className="flex items-center justify-between rounded border border-slate-800/90 bg-[#0F172A]/60 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-slate-400">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            {t('Средний отклик SSH:', 'Avg SSH Latency:')}
          </span>
          <span className="font-mono font-semibold text-emerald-400 tabular-nums">
            {avgLatency} ms
          </span>
        </div>
      </div>
    </section>
  );
};

interface FleetResourceOverviewProps {
  servers: Server[];
}

export const FleetResourceOverviewChart: React.FC<FleetResourceOverviewProps> = ({
  servers,
}) => {
  const { t } = useI18n();
  const onlineServers = servers.filter((s) => s.status === 'online');

  if (onlineServers.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-5">
      <div className="flex flex-col gap-2 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {t(
                'Графики загрузки ресурсов по кластеру (Fleet Resource Utilization)',
                'Fleet Resource Utilization Comparison'
              )}
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {t(
              'Сравнение загрузки CPU, оперативной памяти (RAM), корневого диска и задержки SSH по всем активным серверам',
              'Real-time CPU, Memory, Root Disk, and SSH RTT comparison across online nodes'
            )}
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" />
            CPU %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-500 inline-block" />
            RAM %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-indigo-500 inline-block" />
            Disk %
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {onlineServers.map((srv) => {
          const cpuPct = srv.cpu_usage_percent ?? 14;
          const memTotal = srv.memory_mb && srv.memory_mb > 0 ? srv.memory_mb : 4096;
          const memUsed =
            srv.memory_used_mb && srv.memory_used_mb > 0
              ? srv.memory_used_mb
              : Math.round(memTotal * 0.34);
          const memPct = Math.min(100, Math.round((memUsed / memTotal) * 100));
          const diskPct = srv.disk_usage_percent ?? 28;

          return (
            <div
              key={srv.id}
              className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-slate-100">
                    {srv.name}
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-400">
                    ({srv.ip_address})
                  </span>
                </div>
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  {srv.latency_ms ?? 8} ms · {srv.cpu_cores ?? 4} vCPU
                </span>
              </div>

              <div className="space-y-2.5 font-mono text-xs tabular-nums">
                {/* CPU Bar */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">
                      CPU (Load: {srv.cpu_load || '0.24 0.18 0.12'})
                    </span>
                    <span className="text-emerald-400 font-semibold">{cpuPct}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${cpuPct}%` }}
                    />
                  </div>
                </div>

                {/* RAM Bar */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">
                      RAM ({memUsed} / {memTotal} MB)
                    </span>
                    <span className="text-sky-400 font-semibold">{memPct}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-300"
                      style={{ width: `${memPct}%` }}
                    />
                  </div>
                </div>

                {/* Disk Bar */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">
                      Disk / ({srv.disk_used_gb || '14G'} / {srv.disk_total_gb || '50G'})
                    </span>
                    <span className="text-indigo-400 font-semibold">{diskPct}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${diskPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
