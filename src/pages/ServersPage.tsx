import React, { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  Plus,
  Search,
  Trash2,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import {
  useCheckAllServers,
  useCheckServerConnection,
  useDeleteServer,
  useServers,
} from '../hooks/useServers.ts';
import { ServerStatus } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

function renderStatus(status: ServerStatus, latencyMs?: number | null) {
  if (status === 'online') {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="font-mono text-xs font-medium text-emerald-400">ONLINE</span>
        {latencyMs !== null && latencyMs !== undefined && (
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            ({latencyMs} ms)
          </span>
        )}
      </div>
    );
  }
  if (status === 'offline') {
    return <span className="font-mono text-xs font-medium text-rose-400">OFFLINE</span>;
  }
  return <span className="font-mono text-xs font-medium text-amber-400">UNKNOWN</span>;
}

export const ServersPage: React.FC = () => {
  const { data: servers = [], isLoading, isError, error } = useServers();
  const deleteMutation = useDeleteServer();
  const checkOneMutation = useCheckServerConnection();
  const checkAllMutation = useCheckAllServers();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const { t } = useI18n();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ServerStatus>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [probingId, setProbingId] = useState<number | null>(null);

  const filteredServers = servers.filter((srv) => {
    const matchesStatus = statusFilter === 'all' || srv.status === statusFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      srv.name.toLowerCase().includes(q) ||
      srv.hostname.toLowerCase().includes(q) ||
      srv.ip_address.toLowerCase().includes(q) ||
      srv.description.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  const handleProbeOne = async (id: number) => {
    setProbingId(id);
    try {
      await checkOneMutation.mutateAsync(id);
    } catch (err) {
      console.error('Failed to probe server:', err);
    } finally {
      setProbingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete server:', err);
    }
  };

  const getStatusFilterLabel = (opt: 'all' | ServerStatus) => {
    switch (opt) {
      case 'all':
        return t('Все', 'All');
      case 'unknown':
        return 'Unknown';
      case 'online':
        return 'Online';
      case 'offline':
        return 'Offline';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Серверы (Servers)', 'Servers')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Управление списком Linux-серверов, SSH-секретами и проверкой доступности узлов.',
              'Manage Linux servers, SSH credentials, and live node health checks.'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2.5 self-start sm:self-auto">
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
                  ? t('Опрос SSH...', 'Probing SSH...')
                  : t('Проверить все по SSH', 'Probe All SSH')}
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

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(
              'Поиск по имени, hostname или IP...',
              'Filter by name, hostname, or IP...'
            )}
            aria-label="Filter servers"
            className="w-full rounded-md border border-slate-800 bg-[#1E293B] py-1.5 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#1E293B] p-1">
          {(['all', 'unknown', 'online', 'offline'] as const).map((statusOption) => (
            <button
              key={statusOption}
              type="button"
              onClick={() => setStatusFilter(statusOption)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === statusOption
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {getStatusFilterLabel(statusOption)}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200">
          {(error as Error)?.message ||
            t('Не удалось загрузить список серверов.', 'Failed to load server inventory.')}
        </div>
      )}

      {/* Servers Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
              <th className="py-3 px-4">{t('Имя (Name)', 'Name')}</th>
              <th className="py-3 px-4">Hostname</th>
              <th className="py-3 px-4">IP</th>
              <th className="py-3 px-4 text-right">SSH Port</th>
              <th className="py-3 px-4">{t('SSH Доступ', 'SSH Auth')}</th>
              <th className="py-3 px-4">{t('Статус (Status)', 'Status')}</th>
              <th className="py-3 px-4 text-right">{t('Действия (Actions)', 'Actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-sm">
            {isLoading ? (
              [1, 2, 3, 4].map((skeleton) => (
                <tr key={skeleton} className="h-11">
                  <td colSpan={7} className="px-4 py-2.5">
                    <div className="h-4 w-full animate-pulse rounded bg-slate-800/80" />
                  </td>
                </tr>
              ))
            ) : filteredServers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 px-4 text-center">
                  <p className="text-sm font-medium text-slate-200">
                    {servers.length === 0
                      ? t('Серверы ещё не добавлены', 'No servers registered yet')
                      : t(
                          'Нет серверов, подходящих под фильтр',
                          'No servers match your current filter'
                        )}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {servers.length === 0
                      ? t(
                          'Нажмите «+ Добавить сервер», чтобы зарегистрировать первый узел.',
                          'Click "+ Add Server" to register your first Linux host.'
                        )
                      : t(
                          'Попробуйте очистить строку поиска или выбрать фильтр «Все».',
                          'Try clearing the search query or selecting "All" statuses.'
                        )}
                  </p>
                </td>
              </tr>
            ) : (
              filteredServers.map((server) => (
                <tr
                  key={server.id}
                  className="h-11 transition-colors hover:bg-slate-800/50"
                >
                  <td className="py-2.5 px-4 font-medium text-slate-100 whitespace-nowrap">
                    <Link
                      to={`/servers/${server.id}`}
                      className="hover:text-emerald-400 hover:underline underline-offset-4"
                    >
                      {server.name}
                    </Link>
                    {server.os_info && (
                      <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">
                        · {server.os_info}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-300 whitespace-nowrap">
                    {server.hostname}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                    {server.ip_address}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                    {server.ssh_port}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    {server.has_secret ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {server.auth_type === 'private_key' ? 'SSH Key' : 'Password'}
                      </span>
                    ) : (
                      <Link
                        to={`/servers/${server.id}`}
                        className="inline-flex items-center gap-1 font-mono text-xs text-amber-400 hover:underline"
                        title={t(
                          'Нажмите, чтобы задать пароль или SSH-ключ',
                          'Click to configure SSH password or key'
                        )}
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        {t('Задать пароль', 'Set secret')}
                      </Link>
                    )}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    {renderStatus(server.status, server.latency_ms)}
                  </td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => handleProbeOne(server.id)}
                        disabled={probingId === server.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                        title={t('Проверить SSH-подключение', 'Test SSH connection')}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            probingId === server.id ? 'animate-spin' : ''
                          }`}
                        />
                        <span>{t('Проверить', 'Probe')}</span>
                      </button>
                      <Link
                        to={`/servers/${server.id}`}
                        className="text-xs font-medium text-slate-300 hover:text-white hover:underline underline-offset-4"
                      >
                        {t('Открыть', 'Details')}
                      </Link>
                      {confirmDeleteId === server.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDelete(server.id)}
                            disabled={deleteMutation.isPending}
                            className="rounded bg-rose-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-rose-500"
                          >
                            {t('Удалить', 'Confirm')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-slate-400 hover:text-slate-200"
                          >
                            {t('Отмена', 'Cancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(server.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-400 hover:text-rose-300"
                          aria-label={`Delete ${server.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{t('Удалить', 'Delete')}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
