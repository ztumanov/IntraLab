import React, { useMemo } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Globe, Plus, RefreshCw } from 'lucide-react';
import { useCheckAllServers, useServersGeolocation } from '../hooks/useServers.ts';
import { ServerGeoMap } from '../components/ServerGeoMap.tsx';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

export const MapPage: React.FC = () => {
  const {
    data: locations = [],
    isLoading,
    isFetching,
    refetch,
  } = useServersGeolocation();
  const checkAllMutation = useCheckAllServers();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const { t } = useI18n();

  const stats = useMemo(() => {
    const countries = new Set(locations.map((l) => l.country_code).filter(Boolean));
    const isps = new Set(locations.map((l) => l.isp).filter(Boolean));
    const onlineLatencies = locations
      .filter((l) => l.server.status === 'online' && typeof l.server.latency_ms === 'number')
      .map((l) => l.server.latency_ms as number);

    const avgLatency =
      onlineLatencies.length > 0
        ? Math.round(
            onlineLatencies.reduce((acc, v) => acc + v, 0) / onlineLatencies.length
          )
        : null;

    return {
      totalNodes: locations.length,
      onlineNodes: locations.filter((l) => l.server.status === 'online').length,
      countryCount: countries.size,
      countriesList: Array.from(countries).join(', ') || '—',
      ispCount: isps.size,
      avgLatency,
    };
  }, [locations]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Карта серверов по геопозиции (Geo Map)', 'Server Geolocation Map')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Географическое распределение Linux-узлов по IP-адресам, дата-центрам (ISP/ASN) и задержкам SSH.',
              'Geographic distribution of Linux hosts by IP address, data centers (ISP/ASN), and SSH latency.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          {locations.length > 0 && (
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

      {/* Geo Summary KPI Cards */}
      <section aria-label="Geolocation summary metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
            <p className="text-xs font-medium text-slate-400">
              {t('Узлов на карте', 'Mapped Nodes')}
            </p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {isLoading ? '—' : `${stats.onlineNodes} / ${stats.totalNodes}`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t('Активных (Online) из общего числа', 'Online out of total hosts')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
            <p className="text-xs font-medium text-slate-400">
              {t('Страны и локации', 'Countries & Locations')}
            </p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {isLoading ? '—' : stats.countryCount}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">
              {t('Коды стран:', 'Country codes:')} {stats.countriesList}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
            <p className="text-xs font-medium text-slate-400">
              {t('Сети и провайдеры (ISP / ASN)', 'Cloud Networks (ISP / ASN)')}
            </p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-sky-400 tabular-nums">
              {isLoading ? '—' : stats.ispCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t('Уникальных автономных систем', 'Distinct autonomous networks')}
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
            <p className="text-xs font-medium text-slate-400">
              {t('Средний SSH-отклик', 'Avg SSH Latency')}
            </p>
            <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {isLoading
                ? '—'
                : stats.avgLatency !== null
                ? `${stats.avgLatency}ms`
                : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t('Задержка до гео-распределённых узлов', 'Round-trip across mapped nodes')}
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Google Map */}
      {locations.length === 0 && !isLoading ? (
        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-10 text-center">
          <Globe className="mx-auto h-10 w-10 text-slate-500" />
          <p className="mt-3 text-base font-medium text-slate-200">
            {t('Нет серверов для отображения на карте', 'No servers to display on the map')}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t(
              'Добавьте Linux-сервер с публичным или локальным IP-адресом, чтобы автоматически определить его геопозицию.',
              'Add a Linux server with a public or private IP address to automatically resolve its geolocation.'
            )}
          </p>
          <button
            type="button"
            onClick={openAddServerModal}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('+ Добавить сервер', '+ Add Server')}</span>
          </button>
        </div>
      ) : (
        <ServerGeoMap
          locations={locations}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
        />
      )}

      {/* Detailed Geo-IP Registry Table */}
      {locations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-100">
            {t(
              'Реестр геопозиции и автономных систем (Geo-IP & ASN Registry)',
              'Geolocation & ASN Registry'
            )}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                  <th className="px-4 py-3">{t('Сервер', 'Server')}</th>
                  <th className="px-4 py-3">{t('IP-адрес', 'IP Address')}</th>
                  <th className="px-4 py-3">{t('Страна / Город', 'Country / City')}</th>
                  <th className="px-4 py-3">{t('Координаты', 'Coordinates')}</th>
                  <th className="px-4 py-3">{t('Провайдер / ASN', 'ISP / ASN')}</th>
                  <th className="px-4 py-3">{t('Часовой пояс', 'Timezone')}</th>
                  <th className="px-4 py-3">{t('Статус SSH', 'SSH Status')}</th>
                  <th className="px-4 py-3 text-right">{t('Переход', 'Navigate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {locations.map((loc) => (
                  <tr
                    key={loc.server.id}
                    className="h-11 transition-colors hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-100">
                      <Link
                        to={`/servers/${loc.server.id}`}
                        className="hover:text-emerald-400 hover:underline underline-offset-4"
                      >
                        {loc.server.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                      {loc.server.ip_address}:{loc.server.ssh_port}
                    </td>
                    <td className="px-4 py-2.5 text-slate-200">
                      <span className="font-mono font-semibold text-emerald-400">
                        {loc.country_code}
                      </span>{' '}
                      · {loc.city}, {loc.country}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                      {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-slate-300">
                      {loc.isp} {loc.asn ? `(${loc.asn})` : ''}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-400">{loc.timezone}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">
                      {loc.server.status === 'online' ? (
                        <span className="text-emerald-400">
                          ONLINE · {loc.server.latency_ms ?? 1}ms
                        </span>
                      ) : loc.server.status === 'offline' ? (
                        <span className="text-rose-400">OFFLINE</span>
                      ) : (
                        <span className="text-amber-400">UNKNOWN</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      <Link
                        to={`/servers/${loc.server.id}`}
                        className="text-emerald-400 hover:underline"
                      >
                        {t('Открыть →', 'Open →')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
