import React, { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  Activity,
  Globe,
  Network,
  Play,
  Plus,
  RefreshCw,
  Router,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  useExecuteSshCommand,
  useServerNetwork,
  useServers,
} from '../hooks/useServers.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

export const NetworksPage: React.FC = () => {
  const { data: servers = [], isLoading: isServersLoading } = useServers();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const { t } = useI18n();

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
  const {
    data: netData,
    isLoading: isNetLoading,
    isFetching: isNetFetching,
    refetch: refetchNetwork,
  } = useServerNetwork(selectedServerId);

  const execMutation = useExecuteSshCommand();
  const [diagTarget, setDiagTarget] = useState('1.1.1.1');
  const [diagTool, setDiagTool] = useState<'ping' | 'traceroute' | 'dns' | 'http'>('ping');
  const [diagOutput, setDiagOutput] = useState<string>('');

  const handleRunDiagnostic = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServerId || !diagTarget.trim()) return;
    const cleanTarget = diagTarget.trim().replace(/[^a-zA-Z0-9.:/_-]/g, '');
    if (!cleanTarget) return;

    let cmd = `ping -c 3 -W 2 ${cleanTarget}`;
    if (diagTool === 'traceroute') {
      cmd = `traceroute -n -m 8 -w 2 ${cleanTarget} 2>&1 || tracepath -n -m 8 ${cleanTarget} 2>&1 || ping -c 3 ${cleanTarget}`;
    } else if (diagTool === 'dns') {
      cmd = `getent hosts ${cleanTarget} 2>&1 || nslookup ${cleanTarget} 2>&1 || host ${cleanTarget} 2>&1`;
    } else if (diagTool === 'http') {
      const url = cleanTarget.startsWith('http') ? cleanTarget : `https://${cleanTarget}`;
      cmd = `curl -ILs --max-time 5 ${url} | head -n 20`;
    }

    execMutation.mutate(
      { id: selectedServerId, command: cmd },
      {
        onSuccess: (res) => {
          setDiagOutput(
            (res.stdout + (res.stderr ? `\n${res.stderr}` : '')).trim() ||
              `Exit code: ${res.exit_code}`
          );
        },
        onError: (err: any) => {
          setDiagOutput(err?.message || 'SSH diagnostic error');
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
        <Network className="mx-auto h-10 w-10 text-slate-500" />
        <h1 className="mt-3 text-lg font-semibold text-slate-100">
          {t('Сети и топология L2/L3 (Networks)', 'Networks & L2/L3 Topology')}
        </h1>
        <p className="mt-1 text-xs text-slate-400">
          {t(
            'Добавьте первый Linux-сервер для инспекции сетевых интерфейсов, открытых портов и таблиц маршрутизации по SSH.',
            'Add a Linux server to inspect network interfaces, listening ports, and routing tables over SSH.'
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

  const interfaces = netData?.interfaces ?? [];
  const listeningPorts = netData?.listening_ports ?? [];
  const routes = netData?.routes ?? [];
  const dnsServers = netData?.dns_servers ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Сети, Порты и Маршрутизация (Networks)', 'Networks, Ports & Routing')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Живая инспекция сетевых интерфейсов L2/L3, слушающих сокетов TCP/UDP, таблиц маршрутизации и DNS по SSH.',
              'Live SSH inspection of L2/L3 network interfaces, listening TCP/UDP sockets, routing tables, and DNS.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <Link
            to="/map"
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-300 transition-colors hover:bg-sky-500/20 whitespace-nowrap"
          >
            <Globe className="h-3.5 w-3.5 text-sky-400" />
            <span>{t('Гео-карта серверов', 'Geo Map')}</span>
          </Link>

          <button
            type="button"
            onClick={() => refetchNetwork()}
            disabled={isNetFetching}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-emerald-400 ${isNetFetching ? 'animate-spin' : ''}`}
            />
            <span>{t('Обновить сеть (SSH)', 'Refresh Network (SSH)')}</span>
          </button>
        </div>
      </div>

      {/* Server Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#1E293B] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400">
            {t('Целевой узел:', 'Target Host:')}
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

        {selectedServer && (
          <div className="flex items-center gap-3 font-mono text-xs text-slate-400">
            <span>
              SSH: {selectedServer.username}@{selectedServer.ip_address}:{selectedServer.ssh_port}
            </span>
            <Link
              to={`/servers/${selectedServer.id}`}
              className="text-emerald-400 hover:underline"
            >
              {t('Терминал →', 'Terminal →')}
            </Link>
          </div>
        )}
      </div>

      {/* KPI Summary Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <p className="text-xs font-medium text-slate-400">
            {t('Сетевые интерфейсы', 'Network Interfaces')}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {isNetLoading ? '—' : interfaces.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('Активных адаптеров L2/L3', 'Active L2/L3 host interfaces')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <p className="text-xs font-medium text-slate-400">
            {t('Открытые порты (LISTEN)', 'Listening Ports (LISTEN)')}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
            {isNetLoading ? '—' : listeningPorts.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('Сокеты TCP / UDP на хосте', 'Active TCP / UDP sockets')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <p className="text-xs font-medium text-slate-400">
            {t('Маршруты IP (Routes)', 'IP Routing Rules')}
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-sky-400 tabular-nums">
            {isNetLoading ? '—' : routes.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t('Записей в таблице ядра', 'Kernel routing table entries')}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-4">
          <p className="text-xs font-medium text-slate-400">
            {t('DNS-резолверы', 'DNS Resolvers')}
          </p>
          <p className="mt-1.5 truncate font-mono text-xl font-semibold text-slate-100 tabular-nums">
            {isNetLoading ? '—' : dnsServers.join(', ') || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">/etc/resolv.conf nameservers</p>
        </div>
      </section>

      {/* Interfaces & Listening Ports Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Interfaces & Routes */}
        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Router className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-100">
                  {t('Интерфейсы (ip addr)', 'Interfaces (ip addr)')}
                </h2>
              </div>
              <span className="font-mono text-xs text-slate-500">{interfaces.length} ifaces</span>
            </div>

            {isNetLoading ? (
              <div className="space-y-2 py-4">
                <div className="h-10 animate-pulse rounded bg-slate-800" />
                <div className="h-10 animate-pulse rounded bg-slate-800" />
              </div>
            ) : (
              <div className="space-y-2.5">
                {interfaces.map((ifc, idx) => (
                  <div
                    key={`${ifc.name}-${idx}`}
                    className="rounded border border-slate-800 bg-[#0F172A] p-3 font-mono text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-100">{ifc.name}</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          ifc.state.toUpperCase().includes('UP') ||
                          ifc.state.toUpperCase().includes('UNKNOWN')
                            ? 'text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {ifc.state}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-[11px] text-slate-300">{ifc.addresses}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-slate-100">
                {t('Таблица маршрутизации (ip route)', 'Kernel Routing Table (ip route)')}
              </h2>
            </div>
            <div className="space-y-1.5 rounded border border-slate-800 bg-[#0F172A] p-3 font-mono text-xs text-slate-300">
              {routes.map((rt, i) => (
                <div key={i} className="truncate py-0.5">
                  {rt}
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Listening Ports Table */}
        <div className="lg:col-span-7">
          <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-sky-400" />
                <h2 className="text-sm font-semibold text-slate-100">
                  {t(
                    'Слушающие порты и сокеты (ss -tulnp)',
                    'Listening Ports & Daemons (ss -tulnp)'
                  )}
                </h2>
              </div>
              <span className="font-mono text-xs text-slate-400">
                {listeningPorts.length} sockets
              </span>
            </div>

            {isNetLoading ? (
              <div className="space-y-2 py-4">
                <div className="h-8 animate-pulse rounded bg-slate-800" />
                <div className="h-8 animate-pulse rounded bg-slate-800" />
                <div className="h-8 animate-pulse rounded bg-slate-800" />
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-slate-800 bg-[#0F172A]">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="px-3.5 py-2.5">Proto</th>
                      <th className="px-3.5 py-2.5">{t('Локальный адрес', 'Bind Address')}</th>
                      <th className="px-3.5 py-2.5">{t('Порт', 'Port')}</th>
                      <th className="px-3.5 py-2.5">{t('Процесс / Служба', 'Process / Daemon')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {listeningPorts.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="px-3.5 py-2 font-semibold text-sky-400">{p.proto}</td>
                        <td className="px-3.5 py-2 text-slate-300">{p.local_address}</td>
                        <td className="px-3.5 py-2 font-semibold text-emerald-400 tabular-nums">
                          :{p.port}
                        </td>
                        <td className="max-w-[200px] truncate px-3.5 py-2 text-slate-200">
                          {p.process}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {netData?.connections_summary && (
              <div className="rounded border border-slate-800 bg-[#0F172A] p-3 font-mono text-[11px] text-slate-400">
                <div className="mb-1 text-xs font-semibold text-slate-300">
                  {t('Сводка сокетов ядра (ss -s):', 'Socket Summary (ss -s):')}
                </div>
                <pre className="whitespace-pre-wrap">{netData.connections_summary}</pre>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Live SSH Network Diagnostic Runner */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t(
                'Сетевая диагностика с выбранного узла (Ping / Traceroute / DNS / HTTP)',
                'Remote Network Diagnostics from Host (Ping / Traceroute / DNS / HTTP)'
              )}
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-400">
            {selectedServer ? `from ${selectedServer.ip_address}` : ''}
          </span>
        </div>

        <form onSubmit={handleRunDiagnostic} className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-md border border-slate-700 bg-[#0F172A] p-0.5 text-xs font-mono">
            {(['ping', 'traceroute', 'dns', 'http'] as const).map((tool) => (
              <button
                key={tool}
                type="button"
                onClick={() => setDiagTool(tool)}
                className={`rounded px-3 py-1.5 font-medium uppercase transition-colors ${
                  diagTool === tool
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tool}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={diagTarget}
            onChange={(e) => setDiagTarget(e.target.value)}
            placeholder={t('Цель (например, 1.1.1.1 или google.com)', 'Target (e.g. 1.1.1.1 or google.com)')}
            className="min-w-[240px] flex-1 rounded-md border border-slate-700 bg-[#0F172A] px-3.5 py-2 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />

          <button
            type="submit"
            disabled={execMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" />
            <span>
              {execMutation.isPending
                ? t('Выполнение по SSH...', 'Running via SSH...')
                : t('Запустить проверку', 'Run Diagnostic')}
            </span>
          </button>
        </form>

        {diagOutput && (
          <pre className="max-h-64 overflow-y-auto rounded-md border border-slate-800 bg-[#0F172A] p-4 font-mono text-xs text-emerald-300 whitespace-pre-wrap">
            {diagOutput}
          </pre>
        )}
      </section>
    </div>
  );
};
