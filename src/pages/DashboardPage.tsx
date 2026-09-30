import React from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Plus, ArrowRight, RefreshCw, Activity, Globe } from 'lucide-react';
import {
  useCheckAllServers,
  useServers,
  useServersGeolocation,
} from '../hooks/useServers.ts';
import { ServerStatus } from '../types/server.ts';
import { ServerGeoMap } from '../components/ServerGeoMap.tsx';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

function formatStatusLabel(
  status: ServerStatus,
  latencyMs: number | null,
  t: (ru: string, en: string) => string
) {
  if (status === 'online') {
    return (
      <span className="font-mono text-xs font-medium text-emerald-400 tabular-nums">
        {t('ONLINE', 'ONLINE')}
        {latencyMs !== null ? ` · ${latencyMs}ms` : ''}
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="font-mono text-xs font-medium text-rose-400">
        {t('OFFLINE (Недоступен)', 'OFFLINE')}
      </span>
    );
  }
  return (
    <span className="font-mono text-xs font-medium text-amber-400">
      {t('UNKNOWN (Ожидает SSH)', 'UNKNOWN')}
    </span>
  );
}

export const DashboardPage: React.FC = () => {
  const { data: servers = [], isLoading, isError, error } = useServers();
  const {
    data: geoLocations = [],
    isLoading: isGeoLoading,
    isFetching: isGeoFetching,
    refetch: refetchGeo,
  } = useServersGeolocation();
  const checkAllMutation = useCheckAllServers();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const { t } = useI18n();

  const totalCount = servers.length;
  const onlineCount = servers.filter((s) => s.status === 'online').length;
  const offlineCount = servers.filter((s) => s.status === 'offline').length;
  const unknownCount = servers.filter((s) => s.status === 'unknown').length;

  const recentServers = servers.slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Дашборд (Dashboard)', 'Dashboard')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Сводка по Linux-инфраструктуре и статусам SSH-доступности серверов.',
              'Overview of registered Linux nodes and SSH reachability.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <Link
            to="/map"
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 whitespace-nowrap"
          >
            <Globe className="h-3.5 w-3.5 text-sky-400" />
            <span>{t('Карта серверов', 'Server Map')}</span>
          </Link>

          <Link
            to="/metrics"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 whitespace-nowrap"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('Графики и Метрики', 'Charts & Metrics')}</span>
          </Link>

          {servers.length > 0 && (
            <button
              type="button"
              onClick={() => checkAllMutation.mutate()}
              disabled={checkAllMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-emerald-400 ${
                  checkAllMutation.isPending ? 'animate-spin' : ''
                }`}
              />
              <span>
                {checkAllMutation.isPending
                  ? t('Опрос всех узлов...', 'Polling Fleet...')
                  : t('Опросить все узлы (SSH)', 'Poll All Nodes (SSH)')}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={openAddServerModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('+ Добавить сервер', '+ Add Server')}</span>
          </button>
        </div>
      </div>

      {/* Stat Cards: Servers, Online, Offline, Unknown */}
      <section aria-label="Server fleet summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Серверы (Servers)', 'Servers')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
              {isLoading ? '—' : totalCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Всего узлов в базе', 'Total registered hosts')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('В сети (Online)', 'Online')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-emerald-400 tabular-nums">
              {isLoading ? '—' : onlineCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Доступны по SSH, телеметрия активна', 'SSH reachable, telemetry active')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Недоступны (Offline)', 'Offline')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-rose-400 tabular-nums">
              {isLoading ? '—' : offlineCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Ошибка SSH или хост недоступен', 'SSH error or unreachable host')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5">
            <p className="text-xs font-medium text-slate-400">
              {t('Неизвестно (Unknown)', 'Unknown')}
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold text-amber-400 tabular-nums">
              {isLoading ? '—' : unknownCount}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {t('Ожидают первой SSH-проверки', 'Awaiting initial SSH probe')}
            </p>
          </div>
        </div>
      </section>

      {/* Geolocation Map Section */}
      {servers.length > 0 && (
        <section aria-label="Server geolocation map">
          <ServerGeoMap
            locations={geoLocations}
            isLoading={isGeoLoading}
            compact
            onRefresh={() => refetchGeo()}
            isRefreshing={isGeoFetching}
          />
        </section>
      )}

      {/* Recent Servers Section */}
      <section aria-labelledby="recent-servers-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="recent-servers-heading" className="text-lg font-semibold text-slate-100">
            {t('Узлы инфраструктуры (Registered Nodes)', 'Registered Infrastructure Nodes')}
          </h2>
          <Link
            to="/servers"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-slate-100 whitespace-nowrap"
          >
            <span>{t('Все серверы', 'View all servers')}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {isError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200">
            {(error as Error)?.message ||
              t('Ошибка загрузки серверов.', 'Failed to load servers.')}
          </div>
        )}

        {isLoading ? (
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] divide-y divide-slate-800">
            {[1, 2, 3].map((row) => (
              <div key={row} className="flex h-11 items-center justify-between px-5">
                <div className="h-3.5 w-40 animate-pulse rounded bg-slate-800" />
                <div className="h-3.5 w-28 animate-pulse rounded bg-slate-800" />
              </div>
            ))}
          </div>
        ) : recentServers.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-8 text-center">
            <p className="text-sm font-medium text-slate-200">
              {t('В инвентаре пока нет серверов', 'No servers in inventory yet')}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t(
                'Добавьте первый Linux-сервер, чтобы собирать живую телеметрию и выполнять SSH-команды.',
                'Add your first Linux server to collect live telemetry and run SSH commands.'
              )}
            </p>
            <button
              type="button"
              onClick={openAddServerModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('+ Добавить сервер', '+ Add Server')}</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                  <th className="py-3 px-4">{t('Имя (Name)', 'Name')}</th>
                  <th className="py-3 px-4">{t('Адрес SSH', 'SSH Endpoint')}</th>
                  <th className="py-3 px-4">{t('Статус (Status)', 'Status')}</th>
                  <th className="py-3 px-4 text-right">{t('Действия', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-sm">
                {recentServers.map((server) => (
                  <tr
                    key={server.id}
                    className="h-11 transition-colors hover:bg-slate-800/50"
                  >
                    <td className="py-2.5 px-4 font-medium text-slate-100">
                      <Link
                        to={`/servers/${server.id}`}
                        className="hover:text-emerald-400 hover:underline underline-offset-4"
                      >
                        {server.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-slate-500">
                        ({server.hostname})
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                      {server.username}@{server.ip_address}:{server.ssh_port}
                    </td>
                    <td className="py-2.5 px-4">
                      {formatStatusLabel(server.status, server.latency_ms, t)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-4">
                        <Link
                          to={`/metrics?serverId=${server.id}`}
                          className="font-mono text-xs text-emerald-400 hover:underline"
                        >
                          {t('Метрики', 'Metrics')}
                        </Link>
                        <Link
                          to={`/servers/${server.id}`}
                          className="font-mono text-xs text-slate-300 hover:text-white hover:underline"
                        >
                          {t('Консоль →', 'Console →')}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
