import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Clock,
  Cpu,
  HardDrive,
  Layers,
  Network,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  useServer,
  useServerAgent,
  useServerMonitoring,
} from '../hooks/useServers.ts';
import { MonitoringTimeRange, PrometheusMetricPoint } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

export const TIME_RANGES: { key: MonitoringTimeRange; labelRu: string; labelEn: string }[] = [
  { key: '1h', labelRu: '1ч (1h)', labelEn: '1h' },
  { key: '6h', labelRu: '6ч (6h)', labelEn: '6h' },
  { key: '24h', labelRu: '24ч (24h)', labelEn: '24h' },
  { key: '7d', labelRu: '7д (7d)', labelEn: '7d' },
];

export function formatUptimeDuration(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
  return parts.join(' ');
}

function formatAxisTimestamp(iso: string, range: MonitoringTimeRange): string {
  try {
    const d = new Date(iso);
    if (range === '7d') {
      return d.toISOString().slice(5, 16).replace('T', ' ');
    }
    return d.toISOString().slice(11, 16);
  } catch {
    return '—';
  }
}

function buildSvgSeriesGeometry(
  values: number[],
  width: number,
  height: number,
  maxValue: number,
  paddingTop = 14,
  paddingBottom = 24
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

interface SingleMetricChartProps {
  title: string;
  subtitle: string;
  promql: string;
  unit: string;
  colorHex: string;
  gradientId: string;
  series: PrometheusMetricPoint[];
  range: MonitoringTimeRange;
  maxValue?: number;
  getValue: (pt: PrometheusMetricPoint) => number;
  formatDetail?: (pt: PrometheusMetricPoint) => string;
}

export const SinglePromChartCard: React.FC<SingleMetricChartProps> = ({
  title,
  subtitle,
  promql,
  unit,
  colorHex,
  gradientId,
  series,
  range,
  maxValue = 100,
  getValue,
  formatDetail,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 540;
  const height = 190;

  const values = series.map(getValue);
  const computedMax =
    maxValue > 0 ? maxValue : Math.max(10, ...values.map((v) => Math.ceil(v * 1.15)));
  const geometry = buildSvgSeriesGeometry(values, width, height, computedMax);

  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < series.length
      ? hoverIdx
      : Math.max(0, series.length - 1);
  const activePoint = series[activeIdx];
  const activeVal = activePoint ? getValue(activePoint) : 0;

  const avgVal =
    values.length > 0
      ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
      : 0;
  const peakVal = values.length > 0 ? Number(Math.max(...values).toFixed(1)) : 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
        </div>
        <div className="text-right font-mono">
          <div className="text-lg font-semibold text-slate-100 tabular-nums">
            {activeVal}
            {unit}
          </div>
          {activePoint && formatDetail && (
            <div className="text-[11px] text-slate-400">{formatDetail(activePoint)}</div>
          )}
        </div>
      </div>

      {/* SVG Time-Series Chart */}
      <div className="relative rounded-md border border-slate-800/90 bg-[#0F172A] p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-44 overflow-visible select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorHex} stopOpacity="0.32" />
              <stop offset="100%" stopColor={colorHex} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal reference lines */}
          {[0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = 14 + (height - 38) * (1 - ratio);
            const labelVal = Math.round(computedMax * ratio);
            return (
              <g key={ratio}>
                <line
                  x1={0}
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={4}
                  y={y - 4}
                  fill="#64748B"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {labelVal}
                  {unit}
                </text>
              </g>
            );
          })}

          {geometry.areaPath && (
            <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
          )}
          {geometry.linePath && (
            <path
              d={geometry.linePath}
              fill="none"
              stroke={colorHex}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Active hover vertical line and dot */}
          {geometry.coords[activeIdx] && (
            <g>
              <line
                x1={geometry.coords[activeIdx].x}
                y1={10}
                x2={geometry.coords[activeIdx].x}
                y2={height - 24}
                stroke="#475569"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              <circle
                cx={geometry.coords[activeIdx].x}
                cy={geometry.coords[activeIdx].y}
                r="4"
                fill={colorHex}
                stroke="#0F172A"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* X-axis timestamps */}
          {series.length > 1 && (
            <>
              <text
                x={4}
                y={height - 6}
                fill="#64748B"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatAxisTimestamp(series[0].timestamp, range)}
              </text>
              <text
                x={width / 2 - 20}
                y={height - 6}
                fill="#64748B"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatAxisTimestamp(
                  series[Math.floor(series.length / 2)].timestamp,
                  range
                )}
              </text>
              <text
                x={width - 68}
                y={height - 6}
                fill="#94A3B8"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {activePoint ? formatAxisTimestamp(activePoint.timestamp, range) : ''}
              </text>
            </>
          )}

          {/* Invisible hover columns */}
          {geometry.coords.map((pt, idx) => {
            const colWidth = width / Math.max(1, series.length);
            return (
              <rect
                key={idx}
                x={Math.max(0, pt.x - colWidth / 2)}
                y={0}
                width={colWidth}
                height={height}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(idx)}
              />
            );
          })}
        </svg>
      </div>

      {/* Footer stats & PromQL */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-4 text-slate-400 tabular-nums">
          <span>
            Avg: <strong className="text-slate-200">{avgVal}{unit}</strong>
          </span>
          <span>
            Peak: <strong className="text-slate-200">{peakVal}{unit}</strong>
          </span>
        </div>
        <span className="truncate max-w-[280px] text-[11px] text-slate-500" title={promql}>
          {promql}
        </span>
      </div>
    </div>
  );
};

interface NetworkRxTxChartProps {
  series: PrometheusMetricPoint[];
  range: MonitoringTimeRange;
  promqlRx: string;
  promqlTx: string;
}

export const NetworkRxTxChartCard: React.FC<NetworkRxTxChartProps> = ({
  series,
  range,
  promqlRx,
  promqlTx,
}) => {
  const { t } = useI18n();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 540;
  const height = 190;

  const rxValues = series.map((d) => d.net_rx_kbps);
  const txValues = series.map((d) => d.net_tx_kbps);
  const maxThroughput = Math.max(
    100,
    ...rxValues.map((v) => Math.ceil(v * 1.2)),
    ...txValues.map((v) => Math.ceil(v * 1.2))
  );

  const rxGeom = buildSvgSeriesGeometry(rxValues, width, height, maxThroughput);
  const txGeom = buildSvgSeriesGeometry(txValues, width, height, maxThroughput);

  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < series.length
      ? hoverIdx
      : Math.max(0, series.length - 1);
  const activePoint = series[activeIdx];

  const peakRx = rxValues.length > 0 ? Number(Math.max(...rxValues).toFixed(1)) : 0;
  const peakTx = txValues.length > 0 ? Number(Math.max(...txValues).toFixed(1)) : 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            {t('Сетевой трафик Network RX / TX', 'Network Throughput (RX / TX)')}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {t(
              'Входящий (RX) и исходящий (TX) поток по всем интерфейсам (KB/s)',
              'Inbound (RX) & Outbound (TX) throughput across non-loopback interfaces (KB/s)'
            )}
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
          <div className="text-right">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <ArrowDownRight className="h-3.5 w-3.5" />
              RX
            </span>
            <div className="text-sm font-semibold text-slate-100">
              {activePoint ? activePoint.net_rx_kbps : 0} KB/s
            </div>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1 text-violet-400">
              <ArrowUpRight className="h-3.5 w-3.5" />
              TX
            </span>
            <div className="text-sm font-semibold text-slate-100">
              {activePoint ? activePoint.net_tx_kbps : 0} KB/s
            </div>
          </div>
        </div>
      </div>

      {/* Dual-series SVG Chart */}
      <div className="relative rounded-md border border-slate-800/90 bg-[#0F172A] p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-44 overflow-visible select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="promNetRxGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="promNetTxGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#A855F7" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#A855F7" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = 14 + (height - 38) * (1 - ratio);
            const labelVal = Math.round(maxThroughput * ratio);
            return (
              <g key={ratio}>
                <line
                  x1={0}
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={4}
                  y={y - 4}
                  fill="#64748B"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {labelVal} KB/s
                </text>
              </g>
            );
          })}

          {rxGeom.areaPath && <path d={rxGeom.areaPath} fill="url(#promNetRxGrad)" />}
          {txGeom.areaPath && <path d={txGeom.areaPath} fill="url(#promNetTxGrad)" />}

          {rxGeom.linePath && (
            <path
              d={rxGeom.linePath}
              fill="none"
              stroke="#10B981"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
          {txGeom.linePath && (
            <path
              d={txGeom.linePath}
              fill="none"
              stroke="#A855F7"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {rxGeom.coords[activeIdx] && txGeom.coords[activeIdx] && (
            <g>
              <line
                x1={rxGeom.coords[activeIdx].x}
                y1={10}
                x2={rxGeom.coords[activeIdx].x}
                y2={height - 24}
                stroke="#475569"
                strokeDasharray="2 2"
                strokeWidth="1"
              />
              <circle
                cx={rxGeom.coords[activeIdx].x}
                cy={rxGeom.coords[activeIdx].y}
                r="4"
                fill="#10B981"
                stroke="#0F172A"
                strokeWidth="1.5"
              />
              <circle
                cx={txGeom.coords[activeIdx].x}
                cy={txGeom.coords[activeIdx].y}
                r="4"
                fill="#A855F7"
                stroke="#0F172A"
                strokeWidth="1.5"
              />
            </g>
          )}

          {series.length > 1 && (
            <>
              <text
                x={4}
                y={height - 6}
                fill="#64748B"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatAxisTimestamp(series[0].timestamp, range)}
              </text>
              <text
                x={width / 2 - 20}
                y={height - 6}
                fill="#64748B"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatAxisTimestamp(
                  series[Math.floor(series.length / 2)].timestamp,
                  range
                )}
              </text>
              <text
                x={width - 68}
                y={height - 6}
                fill="#94A3B8"
                fontSize="9"
                fontFamily="JetBrains Mono, monospace"
              >
                {activePoint ? formatAxisTimestamp(activePoint.timestamp, range) : ''}
              </text>
            </>
          )}

          {rxGeom.coords.map((pt, idx) => {
            const colWidth = width / Math.max(1, series.length);
            return (
              <rect
                key={idx}
                x={Math.max(0, pt.x - colWidth / 2)}
                y={0}
                width={colWidth}
                height={height}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(idx)}
              />
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-4 text-slate-400 tabular-nums">
          <span>
            Peak RX: <strong className="text-emerald-400">{peakRx} KB/s</strong>
          </span>
          <span>
            Peak TX: <strong className="text-violet-400">{peakTx} KB/s</strong>
          </span>
        </div>
        <span
          className="truncate max-w-[260px] text-[11px] text-slate-500"
          title={`${promqlRx} | ${promqlTx}`}
        >
          infralab_network_receive/transmit_bytes_total
        </span>
      </div>
    </div>
  );
};

export const ServerMonitoringPage: React.FC = () => {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const serverId = Number(id);

  const [range, setRange] = useState<MonitoringTimeRange>('1h');

  const { data: server, isLoading: isServerLoading } = useServer(serverId);
  const { data: agentInfo } = useServerAgent(serverId);
  const {
    data: monitoring,
    isLoading: isMonitoringLoading,
    isFetching: isMonitoringFetching,
    refetch: refetchMonitoring,
  } = useServerMonitoring(serverId, range, 15000);

  if (isServerLoading || isMonitoringLoading) {
    return (
      <div className="space-y-6">
        <div className="h-7 w-64 animate-pulse rounded bg-slate-800" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-72 animate-pulse rounded-lg bg-[#1E293B]" />
        </div>
      </div>
    );
  }

  if (!server || !monitoring) {
    return (
      <div className="space-y-4">
        <Link
          to="/servers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t('Назад к списку серверов', 'Back to Servers')}</span>
        </Link>
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-6 text-xs text-rose-200">
          {t('Не удалось загрузить страницу мониторинга сервера.', 'Failed to load server monitoring.')}
        </div>
      </div>
    );
  }

  const { summary, series, promql_queries } = monitoring;
  const totalRamMb = server.memory_mb || 4096;
  const totalDiskGb = server.disk_total_gb || '40';

  return (
    <div className="space-y-6">
      {/* Header & Period Selector (1h | 6h | 24h | 7d) */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Link
              to={`/servers/${server.id}`}
              className="inline-flex items-center gap-1 font-medium text-slate-400 transition-colors hover:text-slate-100"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{server.name}</span>
            </Link>
            <span>/</span>
            <span className="font-mono text-emerald-400">Prometheus Monitoring</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-100">
            {t('Мониторинг Prometheus:', 'Prometheus Monitoring:')} {server.name}
          </h1>
          <p className="mt-1 text-xs font-mono text-slate-400">
            Scrape Target: <span className="text-slate-200">http://{monitoring.scrape_target}</span>
            {' · '}
            Agent Status:{' '}
            <span
              className={
                agentInfo?.status === 'ONLINE'
                  ? 'text-emerald-400 font-semibold'
                  : 'text-amber-400 font-semibold'
              }
            >
              {agentInfo?.status || 'NOT INSTALLED'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          {/* Range Switcher: 1h | 6h | 24h | 7d */}
          <div
            role="group"
            aria-label="Monitoring time range"
            className="inline-flex items-center rounded-md border border-slate-800 bg-[#0F172A] p-1"
          >
            {TIME_RANGES.map((item) => {
              const active = range === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setRange(item.key)}
                  className={`rounded px-3 py-1 font-mono text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.key}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => refetchMonitoring()}
            disabled={isMonitoringFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-emerald-400 ${
                isMonitoringFetching ? 'animate-spin' : ''
              }`}
            />
            <span>{t('Обновить PromQL', 'Refresh PromQL')}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards (CPU, Memory, Disk, Network RX/TX, Uptime) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>CPU Usage</span>
            <Cpu className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {summary.current_cpu_percent}%
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {server.cpu_cores || agentInfo?.cpu_count || 2} vCPU Cores
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Memory Usage</span>
            <Layers className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {summary.current_memory_percent}%
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {Math.round((summary.current_memory_percent / 100) * totalRamMb)} / {totalRamMb} MB
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Disk Usage</span>
            <HardDrive className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {summary.current_disk_percent}%
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            Root FS (/) · {totalDiskGb} GB
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Network RX / TX</span>
            <Network className="h-4 w-4 text-violet-400" />
          </div>
          <p className="mt-2 font-mono text-base font-semibold text-slate-100 tabular-nums">
            ↓ {summary.current_rx_kbps} <span className="text-xs text-slate-400">KB/s</span>
            {' · '}
            ↑ {summary.current_tx_kbps} <span className="text-xs text-slate-400">KB/s</span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            Prometheus rate[5m]
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>System Uptime</span>
            <Clock className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-xl font-semibold text-emerald-400 tabular-nums">
            {formatUptimeDuration(summary.uptime_seconds)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            infralab_uptime_seconds
          </p>
        </div>
      </section>

      {/* Four Prometheus Charts Grid: CPU, Memory, Disk, Network RX/TX */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SinglePromChartCard
          title={t('Загрузка процессора (CPU Usage)', 'CPU Usage')}
          subtitle={t(
            `Интервал ${range} · Шаг агрегации ${monitoring.step_seconds}s`,
            `Window ${range} · Step ${monitoring.step_seconds}s`
          )}
          promql={promql_queries.cpu}
          unit="%"
          colorHex="#10B981"
          gradientId="promCpuGrad"
          series={series}
          range={range}
          maxValue={100}
          getValue={(pt) => pt.cpu_percent}
        />

        <SinglePromChartCard
          title={t('Использование памяти (Memory Usage)', 'Memory Usage')}
          subtitle={t(
            `Физическая память RAM (${totalRamMb} MB total)`,
            `Physical RAM utilization (${totalRamMb} MB total)`
          )}
          promql={promql_queries.memory}
          unit="%"
          colorHex="#38BDF8"
          gradientId="promMemGrad"
          series={series}
          range={range}
          maxValue={100}
          getValue={(pt) => pt.memory_percent}
          formatDetail={(pt) => `${pt.memory_used_mb} / ${totalRamMb} MB`}
        />

        <SinglePromChartCard
          title={t('Заполнение диска (Disk Usage)', 'Disk Usage')}
          subtitle={t(
            `Корневой раздел / (${totalDiskGb} GB total)`,
            `Root filesystem / (${totalDiskGb} GB total)`
          )}
          promql={promql_queries.disk}
          unit="%"
          colorHex="#F59E0B"
          gradientId="promDiskGrad"
          series={series}
          range={range}
          maxValue={100}
          getValue={(pt) => pt.disk_percent}
          formatDetail={(pt) => `${pt.disk_used_gb} / ${totalDiskGb} GB`}
        />

        <NetworkRxTxChartCard
          series={series}
          range={range}
          promqlRx={promql_queries.network_rx}
          promqlTx={promql_queries.network_tx}
        />
      </section>

      {/* Executed PromQL Queries & Scrape Pipeline Reference */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t(
                'Активные PromQL-запросы и конфигурация Prometheus Scrape',
                'Executed PromQL Queries & Prometheus Scrape Pipeline'
              )}
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-400">
            Prometheus → infralab-agent (:9101/metrics) → Linux Host
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 font-mono text-xs">
          <div className="rounded border border-slate-800 bg-[#0F172A] p-2.5">
            <span className="text-slate-400 block text-[11px]">CPU Query:</span>
            <code className="text-emerald-300 break-all">{promql_queries.cpu}</code>
          </div>
          <div className="rounded border border-slate-800 bg-[#0F172A] p-2.5">
            <span className="text-slate-400 block text-[11px]">Memory Query:</span>
            <code className="text-sky-300 break-all">{promql_queries.memory}</code>
          </div>
          <div className="rounded border border-slate-800 bg-[#0F172A] p-2.5">
            <span className="text-slate-400 block text-[11px]">Disk Query:</span>
            <code className="text-amber-300 break-all">{promql_queries.disk}</code>
          </div>
          <div className="rounded border border-slate-800 bg-[#0F172A] p-2.5">
            <span className="text-slate-400 block text-[11px]">Network RX/TX Query:</span>
            <code className="text-violet-300 break-all">{promql_queries.network_rx}</code>
          </div>
        </div>
      </section>
    </div>
  );
};
