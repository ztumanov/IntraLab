import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  KeyRound,
  Lock,
  ShieldCheck,
  AlertCircle,
  Activity,
  Terminal,
  Eye,
  EyeOff,
  Play,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
} from 'lucide-react';
import {
  useCheckServerConnection,
  useDeleteServer,
  useExecuteSshCommand,
  useInstallServerAgentViaSsh,
  useRotateServerAgentToken,
  useServer,
  useServerAgent,
  useServerCommandLogs,
  useUpdateServerCredentials,
} from '../hooks/useServers.ts';
import { SshAuthType, SshCommandLog } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';
import { WebSocketTerminal } from '../components/WebSocketTerminal.tsx';

const SAMPLE_OPENSSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACB8v8z9xL2n0kR5p6V1w3Y7q8T2m9K4j1H6f5G3d2S1aQAAAJhK7f9MSu3/
TAAAAAtzc2gtZWQyNTUxOQAAACB8v8z9xL2n0kR5p6V1w3Y7q8T2m9K4j1H6f5G3d2S1aQ
AAAECN4k2p9L0m1N3v5B7x8C9z0A2s4D6f8G0h1J3k5L7m9N8v8z9xL2n0kR5p6V1w3Y7q
8T2m9K4j1H6f5G3d2S1aQAAAA5pbmZyYWxhYi1hZG1pbg==
-----END OPENSSH PRIVATE KEY-----`;

const QUICK_COMMANDS = [
  { label: 'uname -a', cmd: 'uname -a' },
  { label: 'uptime', cmd: 'uptime' },
  { label: 'free -m', cmd: 'free -m' },
  { label: 'df -h', cmd: 'df -h -x tmpfs -x devtmpfs' },
  {
    label: 'Top Memory Processes',
    cmd: 'ps -eo pid,user,%cpu,%mem,comm --sort=-%mem | head -n 10',
  },
  { label: 'Network Interfaces', cmd: 'ip -br addr || ifconfig' },
  { label: 'Listening Ports', cmd: 'ss -tulpn || netstat -tulpn' },
  { label: 'OS Release', cmd: 'cat /etc/os-release' },
];

export const ServerDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const numericId = Number(id);
  const { data: server, isLoading, isError, error } = useServer(numericId);
  const { data: agentInfo, isLoading: isAgentLoading } = useServerAgent(numericId);
  const { data: commandLogs = [] } = useServerCommandLogs(numericId);

  const deleteMutation = useDeleteServer();
  const checkMutation = useCheckServerConnection();
  const credentialsMutation = useUpdateServerCredentials();
  const execMutation = useExecuteSshCommand();
  const rotateTokenMutation = useRotateServerAgentToken();
  const installAgentSshMutation = useInstallServerAgentViaSsh();
  const { t } = useI18n();

  const [copiedSsh, setCopiedSsh] = useState(false);
  const [copiedEnroll, setCopiedEnroll] = useState(false);
  const [agentInstallMsg, setAgentInstallMsg] = useState<string | null>(null);
  const [agentInstallErr, setAgentInstallErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCredsPanel, setShowCredsPanel] = useState(false);
  const [authType, setAuthType] = useState<SshAuthType>('password');
  const [secretInput, setSecretInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [portInput, setPortInput] = useState<number>(22);
  const [showPassword, setShowPassword] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);

  // SSH Command Console State
  const [terminalTab, setTerminalTab] = useState<'pty' | 'exec'>('pty');
  const [commandInput, setCommandInput] = useState('uname -a && uptime && free -m');
  const [selectedLog, setSelectedLog] = useState<SshCommandLog | null>(null);

  const openCredentialsEditor = () => {
    if (server) {
      setAuthType(server.auth_type || 'password');
      setUsernameInput(server.username);
      setPortInput(server.ssh_port);
      setSecretInput('');
      setCredsError(null);
    }
    setShowCredsPanel((prev) => !prev);
  };

  const handleCopySsh = () => {
    if (!server) return;
    const sshString = `ssh -p ${server.ssh_port} ${server.username}@${server.ip_address}`;
    navigator.clipboard.writeText(sshString);
    setCopiedSsh(true);
    setTimeout(() => setCopiedSsh(false), 1800);
  };

  const handleCheckConnection = async () => {
    if (!server) return;
    try {
      await checkMutation.mutateAsync(server.id);
    } catch (err) {
      console.error('Failed to check SSH connection:', err);
    }
  };

  const handleRunCommand = async (cmdToExecute?: string) => {
    if (!server) return;
    const targetCmd = (cmdToExecute ?? commandInput).trim();
    if (!targetCmd) return;
    if (cmdToExecute) {
      setCommandInput(cmdToExecute);
    }
    try {
      const result = await execMutation.mutateAsync({
        id: server.id,
        command: targetCmd,
      });
      setSelectedLog(result);
    } catch (err) {
      console.error('SSH command execution failed:', err);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server) return;
    setCredsError(null);

    if (!secretInput.trim()) {
      setCredsError(
        t(
          'Введите пароль или приватный SSH-ключ для сохранения',
          'Please enter a password or SSH private key'
        )
      );
      return;
    }

    if (authType === 'private_key' && !secretInput.includes('PRIVATE KEY')) {
      setCredsError(
        t(
          'Приватный ключ должен содержать заголовок -----BEGIN ... PRIVATE KEY-----',
          'Private key must include -----BEGIN ... PRIVATE KEY----- header'
        )
      );
      return;
    }

    try {
      await credentialsMutation.mutateAsync({
        id: server.id,
        input: {
          username: usernameInput.trim() || server.username,
          ssh_port: Number(portInput) || server.ssh_port,
          auth_type: authType,
          secret: secretInput,
          verify_now: true,
        },
      });
      setSecretInput('');
      setShowCredsPanel(false);
    } catch (err: any) {
      setCredsError(
        err?.message || t('Ошибка обновления секрета', 'Failed to update credentials')
      );
    }
  };

  const handleDelete = async () => {
    if (!server) return;
    try {
      await deleteMutation.mutateAsync(server.id);
      navigate('/servers');
    } catch (err) {
      console.error('Failed to delete server:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-800" />
        <div className="h-48 w-full animate-pulse rounded-lg border border-slate-800 bg-[#1E293B]" />
      </div>
    );
  }

  if (isError || !server) {
    return (
      <div className="space-y-6">
        <Link
          to="/servers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t('Назад к списку серверов', 'Back to Servers')}</span>
        </Link>
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-6">
          <h1 className="text-base font-semibold text-rose-200">
            {t('Сервер не найден', 'Server Not Found')}
          </h1>
          <p className="mt-1 text-xs text-rose-300">
            {(error as Error)?.message ||
              t(
                'Запрошенная карточка сервера не найдена.',
                'The requested server record could not be loaded.'
              )}
          </p>
        </div>
      </div>
    );
  }

  const sshDisplay = `${server.username}@${server.ip_address}:${server.ssh_port}`;
  const statusUpper = server.status.toUpperCase();
  const displayedLog = selectedLog || commandLogs[0] || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/servers"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('Серверы (Servers)', 'Servers')}</span>
          </Link>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <span className="text-xs font-medium text-slate-400">
              {t('Карточка сервера (Server Details)', 'Server Details')}
            </span>
            <span className="text-slate-600">·</span>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              {server.name}
            </h1>
          </div>
          {server.description && (
            <p className="mt-1 text-sm text-slate-400">{server.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <Link
            to={`/servers/${server.id}/monitoring`}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 whitespace-nowrap"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('Мониторинг Prometheus', 'Prometheus Monitoring')}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>

          <Link
            to={`/metrics?serverId=${server.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap"
          >
            <span>{t('SSH Метрики', 'SSH Telemetry')}</span>
          </Link>

          <button
            type="button"
            onClick={handleCheckConnection}
            disabled={checkMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${checkMutation.isPending ? 'animate-spin' : ''}`}
            />
            <span>
              {checkMutation.isPending
                ? t('Проверка SSH...', 'Checking SSH...')
                : t('Проверить SSH-подключение', 'Verify SSH Connection')}
            </span>
          </button>

          <button
            type="button"
            onClick={openCredentialsEditor}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap"
          >
            <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
            <span>
              {server.has_secret
                ? t('Изменить пароль / ключ', 'Update SSH Secret')
                : t('Задать пароль / ключ', 'Set SSH Password / Key')}
            </span>
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 whitespace-nowrap"
              >
                {deleteMutation.isPending
                  ? t('Удаление...', 'Deleting...')
                  : t('Подтвердить удаление', 'Confirm Delete')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
              >
                {t('Отмена', 'Cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-950/20 px-3.5 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-950/50 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('Удалить', 'Delete')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Warning banner if server has no SSH password/key configured yet */}
      {!server.has_secret && !showCredsPanel && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 text-xs text-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-100">
                {t(
                  'Учётные данные SSH ещё не настроены',
                  'SSH credentials are not configured yet'
                )}
              </p>
              <p className="mt-0.5 text-amber-300/90">
                {t(
                  'Этот сервер был добавлен без пароля или приватного ключа. Задайте пароль или SSH-ключ, чтобы перевести сервер в статус ONLINE, собирать метрики и выполнять команды.',
                  'This server was registered without a password or private key. Configure SSH credentials to verify connectivity, collect metrics, and run SSH commands.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCredentialsEditor}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 whitespace-nowrap self-start sm:self-auto"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>{t('Настроить пароль / ключ', 'Configure SSH Credentials')}</span>
          </button>
        </div>
      )}

      {/* Offline Error Banner */}
      {server.status === 'offline' && server.last_check_error && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-950/25 p-4 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-100">
              {t(
                'Ошибка SSH-подключения (Статус: OFFLINE)',
                'SSH Connection Failed (Status: OFFLINE)'
              )}
            </p>
            <p className="font-mono text-rose-300">{server.last_check_error}</p>
          </div>
        </div>
      )}

      {/* Collapsible SSH Credentials Editor */}
      {showCredsPanel && (
        <form
          onSubmit={handleSaveCredentials}
          className="rounded-lg border border-emerald-500/40 bg-[#131C2E] p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                {t(
                  'Настройка SSH-доступа и шифрование секрета',
                  'Configure SSH Authentication & Encrypted Secret'
                )}
              </h2>
            </div>
            <span className="font-mono text-xs text-emerald-400">
              AES-256-GCM Vault
            </span>
          </div>

          {credsError && (
            <div className="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
              {credsError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                {t('SSH Пользователь', 'SSH Username')}
              </label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full h-9 px-3 rounded border border-slate-700 bg-[#0F172A] font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                {t('SSH Порт', 'SSH Port')}
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={portInput}
                onChange={(e) => setPortInput(Number(e.target.value))}
                className="w-full h-9 px-3 rounded border border-slate-700 bg-[#0F172A] font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                {t('Метод авторизации', 'Auth Method')}
              </label>
              <div className="grid grid-cols-2 gap-1.5 h-9 p-1 rounded border border-slate-700 bg-[#0F172A]">
                <button
                  type="button"
                  onClick={() => {
                    setAuthType('password');
                    setSecretInput('');
                  }}
                  className={`rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
                    authType === 'password'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthType('private_key');
                    setSecretInput('');
                  }}
                  className={`rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
                    authType === 'private_key'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <KeyRound className="h-3 w-3" />
                  SSH Key
                </button>
              </div>
            </div>
          </div>

          {authType === 'password' ? (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                {t('Пароль пользователя', 'Password for')}{' '}
                <span className="font-mono text-slate-200">
                  {usernameInput || server.username}
                </span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                  placeholder={t(
                    'Введите пароль от Linux-сервера...',
                    'Enter Linux user password...'
                  )}
                  className="w-full h-9 pl-3 pr-9 rounded border border-slate-700 bg-[#0F172A] font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-400">
                  {t(
                    'Приватный SSH-ключ (PEM / OpenSSH)',
                    'SSH Private Key (PEM / OpenSSH)'
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => setSecretInput(SAMPLE_OPENSSH_KEY)}
                  className="text-[11px] font-mono text-emerald-400 hover:underline"
                >
                  {t('Вставить тестовый ключ Ed25519', 'Insert sample Ed25519 key')}
                </button>
              </div>
              <textarea
                rows={4}
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                className="w-full p-2.5 rounded border border-slate-700 bg-[#0F172A] font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none resize-none"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCredsPanel(false)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={credentialsMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {credentialsMutation.isPending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('Проверка SSH...', 'Verifying SSH...')}</span>
                </>
              ) : (
                <span>
                  {t(
                    'Сохранить и проверить подключение',
                    'Save & Verify SSH Connection'
                  )}
                </span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Primary Server Metadata Grid */}
      <section
        aria-label="Server specification"
        className="rounded-lg border border-slate-800 bg-[#1E293B] p-6"
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-xs font-medium text-slate-400">Hostname</p>
            <p className="mt-1.5 font-mono text-sm font-medium text-slate-100 break-all">
              {server.hostname}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-400">IP Address</p>
            <p className="mt-1.5 font-mono text-sm font-medium text-slate-100 tabular-nums">
              {server.ip_address}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-400">
              {t('ОС и ядро Linux', 'OS & Kernel')}
            </p>
            <p className="mt-1.5 font-mono text-xs text-slate-200 truncate">
              {server.os_info || 'Linux'} · {server.kernel_info || '6.x'}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-400">
              {t('Аутентификация', 'SSH Auth')}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-slate-200">
              {server.has_secret ? (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {server.auth_type === 'private_key' ? 'SSH Key (AES)' : 'Password (AES)'}
                </span>
              ) : (
                <span className="text-amber-400">
                  {t('Не задан секрет', 'No secret set')}
                </span>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-400">Status & RTT</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={`font-mono text-sm font-semibold ${
                  server.status === 'online'
                    ? 'text-emerald-400'
                    : server.status === 'offline'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                }`}
              >
                {statusUpper}
              </span>
              {server.latency_ms !== null && server.status === 'online' && (
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  · {server.latency_ms} ms
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              ID:{' '}
              <strong className="font-mono text-slate-300 tabular-nums">
                #{server.id}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Uptime:{' '}
              <strong className="font-mono text-emerald-400">
                {server.uptime_info || '—'}
              </strong>
            </span>
            {server.last_checked_at && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t('Последний опрос:', 'Last SSH Poll:')}{' '}
                  <span className="font-mono text-slate-300 tabular-nums">
                    {new Date(server.last_checked_at)
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 19)}{' '}
                    UTC
                  </span>
                </span>
              </>
            )}
          </div>

          <Link
            to={`/metrics?serverId=${server.id}`}
            className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:underline"
          >
            <span>
              {t(
                'Перейти в модуль «Метрики» (Графики CPU/RAM/Disk и процессы) →',
                'Open in Metrics Module (CPU/RAM/Disk Charts & Processes) →'
              )}
            </span>
          </Link>
        </div>
      </section>

      {/* Linux Agent Status & Enrollment Section */}
      <section
        aria-label="Linux Agent status"
        className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-100">
              Agent (infralab-agent daemon)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={async () => {
                setAgentInstallMsg(null);
                setAgentInstallErr(null);
                try {
                  const res = await installAgentSshMutation.mutateAsync(server.id);
                  setAgentInstallMsg(
                    t(
                      `Агент ${res.agent_id} успешно установлен в /usr/local/bin/infralab-agent по SSH и запущен на :9101/metrics`,
                      `Agent ${res.agent_id} installed to /usr/local/bin/infralab-agent via SSH and started on :9101/metrics`
                    )
                  );
                } catch (err: any) {
                  setAgentInstallErr(
                    err?.message ||
                      t('Не удалось установить агент по SSH', 'Failed to install agent via SSH')
                  );
                }
              }}
              disabled={installAgentSshMutation.isPending || !server.has_secret}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              <Play
                className={`h-3.5 w-3.5 ${
                  installAgentSshMutation.isPending ? 'animate-spin' : ''
                }`}
              />
              <span>
                {installAgentSshMutation.isPending
                  ? t('Установка по SSH...', 'Installing via SSH...')
                  : agentInfo?.status === 'ONLINE'
                  ? t('Переустановить агент по SSH', 'Reinstall Agent via SSH')
                  : t('Установить агент по SSH в 1 клик', '1-Click Install Agent via SSH')}
              </span>
            </button>

            <Link
              to={`/servers/${server.id}/monitoring`}
              className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs text-emerald-300 transition-colors hover:bg-emerald-500/20"
            >
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
              <span>{t('Графики Prometheus (:9101/metrics)', 'Prometheus Charts (:9101/metrics)')}</span>
            </Link>
            {agentInfo && agentInfo.status !== 'NOT INSTALLED' && (
              <button
                type="button"
                onClick={() => rotateTokenMutation.mutate(server.id)}
                disabled={rotateTokenMutation.isPending}
                className="rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 font-mono text-xs text-slate-300 transition-colors hover:border-slate-600 hover:text-white disabled:opacity-50"
              >
                {rotateTokenMutation.isPending
                  ? t('Сброс...', 'Resetting...')
                  : t('Перевыпустить токен enrollment', 'Re-issue Enrollment Token')}
              </button>
            )}
            <span className="font-mono text-xs text-slate-400">HTTPS · 15s Heartbeat</span>
          </div>
        </div>

        {agentInstallMsg && (
          <div className="rounded border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-200">
            {agentInstallMsg}
          </div>
        )}
        {agentInstallErr && (
          <div className="rounded border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200">
            {agentInstallErr}
          </div>
        )}

        {isAgentLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="h-14 animate-pulse rounded bg-slate-800" />
            <div className="h-14 animate-pulse rounded bg-slate-800" />
            <div className="h-14 animate-pulse rounded bg-slate-800" />
            <div className="h-14 animate-pulse rounded bg-slate-800" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-medium text-slate-400">Status</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      agentInfo?.status === 'ONLINE'
                        ? 'bg-emerald-400'
                        : agentInfo?.status === 'OFFLINE'
                        ? 'bg-rose-500'
                        : 'bg-amber-400'
                    }`}
                  />
                  <span
                    className={`font-mono text-sm font-semibold ${
                      agentInfo?.status === 'ONLINE'
                        ? 'text-emerald-400'
                        : agentInfo?.status === 'OFFLINE'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {agentInfo?.status || 'NOT INSTALLED'}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Version</p>
                <p className="mt-1.5 font-mono text-sm font-medium text-slate-100 tabular-nums">
                  {agentInfo?.version ? `v${agentInfo.version.replace(/^v/, '')}` : '—'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Last seen</p>
                <p className="mt-1.5 font-mono text-xs text-slate-200 tabular-nums">
                  {agentInfo?.last_seen_at
                    ? `${new Date(agentInfo.last_seen_at)
                        .toISOString()
                        .replace('T', ' ')
                        .slice(0, 19)} UTC`
                    : '—'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-400">Agent ID</p>
                <p className="mt-1.5 font-mono text-xs text-slate-200 break-all">
                  {agentInfo?.agent_id || '—'}
                </p>
              </div>
            </div>

            {agentInfo && agentInfo.status !== 'NOT INSTALLED' && (
              <div className="grid grid-cols-2 gap-4 border-t border-slate-800 pt-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <span className="text-slate-400">Hostname:</span>
                  <p className="mt-0.5 font-mono text-slate-200 truncate">
                    {agentInfo.hostname || server.hostname}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">OS / Distro:</span>
                  <p className="mt-0.5 font-mono text-slate-200 truncate">
                    {agentInfo.os_distribution || server.os_info || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Kernel:</span>
                  <p className="mt-0.5 font-mono text-slate-200 truncate">
                    {agentInfo.kernel || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Arch:</span>
                  <p className="mt-0.5 font-mono text-slate-200">
                    {agentInfo.architecture || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">CPU Count:</span>
                  <p className="mt-0.5 font-mono text-slate-200 tabular-nums">
                    {agentInfo.cpu_count > 0 ? `${agentInfo.cpu_count} vCPU` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">RAM Total:</span>
                  <p className="mt-0.5 font-mono text-slate-200 tabular-nums">
                    {agentInfo.ram_total_bytes > 0
                      ? `${Math.round(agentInfo.ram_total_bytes / (1024 * 1024))} MB`
                      : '—'}
                  </p>
                </div>
              </div>
            )}

            {(!agentInfo || agentInfo.status === 'NOT INSTALLED') && (
              <div className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-200">
                      {t(
                        'Установка и регистрация Linux Agent (SSH в 1 клик или вручную)',
                        'Install & Enroll Linux Agent (1-Click SSH or Manual CLI)'
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {t(
                        'Для тестовой среды AI Studio используйте кнопку «Установить агент по SSH в 1 клик» выше — она сама загрузит /usr/local/bin/infralab-agent на сервер по SSH, настроит systemd и активирует экспортер :9101/metrics. Для собственного Docker-сервера можно также выполнить полную команду установки:',
                        'In AI Studio preview, use the "1-Click Install Agent via SSH" button above to push /usr/local/bin/infralab-agent over SSH and start the :9101/metrics exporter. On a self-hosted Docker server, you can also run the full install command:'
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => rotateTokenMutation.mutate(server.id)}
                      disabled={rotateTokenMutation.isPending}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#1E293B] px-2.5 py-1.5 font-mono text-xs text-slate-300 hover:bg-slate-800"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${
                          rotateTokenMutation.isPending ? 'animate-spin' : ''
                        }`}
                      />
                      <span>{t('Новый токен', 'New Token')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const origin =
                          typeof window !== 'undefined'
                            ? window.location.origin
                            : 'https://infralab.example';
                        const token = agentInfo?.enrollment_token || '<TOKEN>';
                        const cmd = `sudo curl -fsSL ${origin}/downloads/infralab-agent -o /usr/local/bin/infralab-agent && \\\nsudo chmod +x /usr/local/bin/infralab-agent && \\\nsudo infralab-agent enroll \\\n  --server ${origin} \\\n  --token ${token}`;
                        navigator.clipboard.writeText(cmd);
                        setCopiedEnroll(true);
                        setTimeout(() => setCopiedEnroll(false), 1800);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
                    >
                      {copiedEnroll ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>{t('Скопировано', 'Copied')}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <pre className="overflow-x-auto rounded border border-slate-800/90 bg-[#0B1120] p-3.5 font-mono text-xs text-emerald-300 leading-relaxed">
                  {`sudo curl -fsSL ${
                    typeof window !== 'undefined'
                      ? window.location.origin
                      : 'https://infralab.example'
                  }/downloads/infralab-agent -o /usr/local/bin/infralab-agent && \\\nsudo chmod +x /usr/local/bin/infralab-agent && \\\nsudo infralab-agent enroll \\\n  --server ${
                    typeof window !== 'undefined'
                      ? window.location.origin
                      : 'https://infralab.example'
                  } \\\n  --token ${agentInfo?.enrollment_token || '<TOKEN>'}`}
                </pre>
              </div>
            )}
          </>
        )}
      </section>

      {/* Interactive WebSocket PTY Terminal & SSH Command Console */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {t(
                'Интерактивный WebSocket PTY-терминал и SSH-консоль',
                'Interactive WebSocket PTY Terminal & SSH Console'
              )}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-md border border-slate-800 bg-[#0F172A] p-1">
              <button
                type="button"
                onClick={() => setTerminalTab('pty')}
                className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                  terminalTab === 'pty'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('Интерактивный PTY (xterm.js)', 'Interactive PTY (xterm.js)')}
              </button>
              <button
                type="button"
                onClick={() => setTerminalTab('exec')}
                className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                  terminalTab === 'exec'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('Пакетный Exec и Журнал аудита', 'Batch Exec & Audit Log')} (
                {commandLogs.length})
              </button>
            </div>
          </div>
        </div>

        {terminalTab === 'pty' ? (
          <WebSocketTerminal server={server} />
        ) : (
          <>
            {/* Quick preset command buttons */}
        <div>
          <p className="text-xs font-medium text-slate-400 mb-2">
            {t('Быстрые диагностические команды:', 'Quick diagnostic presets:')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_COMMANDS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => handleRunCommand(preset.cmd)}
                disabled={execMutation.isPending}
                className="rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 font-mono text-xs text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Command input bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRunCommand();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-emerald-400">
              $
            </span>
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="uname -a && df -h"
              className="h-9 w-full rounded-md border border-slate-700 bg-[#0F172A] pl-7 pr-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={execMutation.isPending || !commandInput.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
          >
            {execMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>{t('Выполнение...', 'Running...')}</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>{t('Выполнить по SSH', 'Run via SSH')}</span>
              </>
            )}
          </button>
        </form>

        {/* Terminal Output Window */}
        <div className="rounded-lg border border-slate-800 bg-[#0B1120] p-4 font-mono text-xs">
          {displayedLog ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 text-[11px] text-slate-400">
                <span className="text-emerald-400 break-all">
                  {server.username}@{server.hostname}:~$ {displayedLog.command}
                </span>
                <div className="flex items-center gap-3 tabular-nums">
                  <span
                    className={
                      displayedLog.exit_code === 0 ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    exit={displayedLog.exit_code}
                  </span>
                  <span>{displayedLog.duration_ms} ms</span>
                </div>
              </div>
              {displayedLog.stdout && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-slate-200 leading-relaxed">
                  {displayedLog.stdout}
                </pre>
              )}
              {displayedLog.stderr && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-rose-300 leading-relaxed">
                  {displayedLog.stderr}
                </pre>
              )}
              {!displayedLog.stdout && !displayedLog.stderr && (
                <p className="text-slate-500 italic">
                  {t(
                    '(Команда завершилась без вывода в stdout/stderr)',
                    '(Command completed with empty output)'
                  )}
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-500">
              {t(
                'Выберите пресет или введите команду выше, чтобы выполнить её на сервере по SSH и увидеть вывод терминала.',
                'Select a preset or enter a Linux command above to execute it over SSH and inspect stdout/stderr.'
              )}
            </p>
          )}
        </div>

        {/* Command History Audit Log */}
        <div className="border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">
              {t(
                'Журнал выполненных SSH-команд (PostgreSQL):',
                'SSH Command Audit History:'
              )}
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {commandLogs.length} {t('записей', 'entries')}
            </span>
          </div>
          {commandLogs.length === 0 ? (
            <p className="text-xs text-slate-500">
              {t('История команд пока пуста.', 'No commands executed yet.')}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-800/70 rounded border border-slate-800 bg-[#0F172A]">
              {commandLogs.slice(0, 12).map((log) => (
                <button
                  key={log.id}
                  type="button"
                  onClick={() => setSelectedLog(log)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-slate-800/60 ${
                    displayedLog?.id === log.id
                      ? 'bg-slate-800/80 text-emerald-300'
                      : 'text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {log.exit_code === 0 ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    )}
                    <span className="truncate">{log.command}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-slate-400 tabular-nums">
                    <span>{log.duration_ms}ms</span>
                    <span>{new Date(log.executed_at).toISOString().slice(11, 19)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
          </>
        )}
      </section>
    </div>
  );
};
