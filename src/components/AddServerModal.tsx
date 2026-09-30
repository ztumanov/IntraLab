import React, { useState } from 'react';
import {
  X,
  Server as ServerIcon,
  AlertCircle,
  Loader2,
  Terminal,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ApiRequestError } from '../api/servers.ts';
import { useCreateServer } from '../hooks/useServers.ts';
import { CreateServerInput, Server, SshAuthType } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (server: Server) => void;
}

const INITIAL_FORM: CreateServerInput = {
  name: '',
  hostname: '',
  ip_address: '',
  ssh_port: 22,
  username: 'root',
  auth_type: 'password',
  secret: '',
  description: '',
  verify_now: true,
};

const SAMPLE_OPENSSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACB8v8z9xL2n0kR5p6V1w3Y7q8T2m9K4j1H6f5G3d2S1aQAAAJhK7f9MSu3/
TAAAAAtzc2gtZWQyNTUxOQAAACB8v8z9xL2n0kR5p6V1w3Y7q8T2m9K4j1H6f5G3d2S1aQ
AAAECN4k2p9L0m1N3v5B7x8C9z0A2s4D6f8G0h1J3k5L7m9N8v8z9xL2n0kR5p6V1w3Y7q
8T2m9K4j1H6f5G3d2S1aQAAAA5pbmZyYWxhYi1hZG1pbg==
-----END OPENSSH PRIVATE KEY-----`;

export const AddServerModal: React.FC<AddServerModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { t } = useI18n();
  const createMutation = useCreateServer();

  const [form, setForm] = useState<CreateServerInput>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const validateClientSide = (): boolean => {
    const errors: Record<string, string> = {};

    if (!form.name.trim()) {
      errors.name = t('Укажите отображаемое имя сервера', 'Server name is required');
    }
    if (!form.hostname.trim()) {
      errors.hostname = t('Укажите системный hostname', 'Hostname is required');
    }
    if (!form.ip_address.trim()) {
      errors.ip_address = t('Укажите IPv4 или IPv6 адрес', 'IP address is required');
    } else {
      const ipv4Regex =
        /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
      const ipv6Regex = /^[0-9a-fA-F:]+$/;
      if (
        !ipv4Regex.test(form.ip_address.trim()) &&
        !ipv6Regex.test(form.ip_address.trim())
      ) {
        errors.ip_address = t(
          'Некорректный формат IP-адреса (пример: 192.168.1.10)',
          'Invalid IP address format (e.g. 192.168.1.10)'
        );
      }
    }

    if (
      !Number.isInteger(form.ssh_port) ||
      form.ssh_port < 1 ||
      form.ssh_port > 65535
    ) {
      errors.ssh_port = t(
        'Порт должен быть целым числом от 1 до 65535',
        'Port must be an integer between 1 and 65535'
      );
    }

    if (!form.username.trim()) {
      errors.username = t('Укажите имя SSH-пользователя', 'SSH username is required');
    }

    if (
      form.auth_type === 'private_key' &&
      form.secret.trim().length > 0 &&
      !form.secret.includes('PRIVATE KEY')
    ) {
      errors.secret = t(
        'Ключ должен содержать заголовок -----BEGIN ... PRIVATE KEY-----',
        'Key must contain -----BEGIN ... PRIVATE KEY----- header'
      );
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    if (!validateClientSide()) {
      return;
    }

    try {
      const created = await createMutation.mutateAsync({
        name: form.name.trim(),
        hostname: form.hostname.trim(),
        ip_address: form.ip_address.trim(),
        ssh_port: Number(form.ssh_port),
        username: form.username.trim(),
        auth_type: form.auth_type,
        secret: form.secret,
        description: form.description.trim(),
        verify_now: Boolean(form.verify_now && form.secret.trim().length > 0),
      });
      setForm(INITIAL_FORM);
      setFieldErrors({});
      onCreated?.(created);
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.details) {
          setFieldErrors(err.details);
        }
        setGeneralError(err.message);
      } else if (err instanceof Error) {
        setGeneralError(err.message);
      } else {
        setGeneralError(t('Не удалось сохранить сервер', 'Failed to save server'));
      }
    }
  };

  const handlePresetFill = () => {
    setForm({
      name: 'prod-k8s-worker-01',
      hostname: 'worker-01.eu-central.infralab.internal',
      ip_address: '10.0.10.24',
      ssh_port: 22,
      username: 'ubuntu',
      auth_type: 'password',
      secret: 'InfraLab#Prod2026!',
      description: 'Production Kubernetes worker node (Ubuntu 24.04 LTS, 8 vCPU, 16GB RAM)',
      verify_now: true,
    });
    setFieldErrors({});
    setGeneralError(null);
  };

  const setAuthType = (type: SshAuthType) => {
    setForm((prev) => ({
      ...prev,
      auth_type: type,
      secret: '',
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.secret;
      return next;
    });
  };

  const submitting = createMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div
        className="w-full max-w-xl max-h-[92vh] overflow-y-auto bg-[#111722] border border-[#1E293B] rounded-md shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E293B] bg-[#0D131D] sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ServerIcon className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="modal-title"
                className="text-sm font-semibold text-[#F8FAFC] tracking-tight"
              >
                {t('Добавить сервер (Add Server)', 'Add Linux Server')}
              </h2>
              <p className="text-xs text-[#64748B]">
                {t(
                  'Инвентаризация узла и настройка SSH-доступа',
                  'Register node and configure SSH authentication'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePresetFill}
              className="px-2.5 py-1 text-[11px] font-mono text-[#94A3B8] hover:text-[#F8FAFC] bg-[#161E2E] hover:bg-[#1E293B] border border-[#1E293B] rounded transition-colors flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              {t('Демо-пресет', 'Demo Preset')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#64748B] hover:text-[#F8FAFC] rounded hover:bg-[#1E293B]/60 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {generalError && (
            <div className="p-3 rounded bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-start gap-2.5 text-xs text-[#EF4444]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">{t('Ошибка: ', 'Error: ')}</span>
                <span>{generalError}</span>
              </div>
            </div>
          )}

          {/* Row 1: Name & Hostname */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                {t('Имя сервера (Name)', 'Name')} <span className="text-[#EF4444]">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="prod-api-node-01"
                className={`w-full h-9 px-3 text-sm bg-[#0B0F17] border rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors ${
                  fieldErrors.name ? 'border-[#EF4444]' : 'border-[#1E293B]'
                }`}
              />
              {fieldErrors.name && (
                <p className="mt-1 text-[11px] text-[#EF4444]">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                Hostname (FQDN) <span className="text-[#EF4444]">*</span>
              </label>
              <input
                type="text"
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                placeholder="node01.infralab.internal"
                className={`w-full h-9 px-3 text-sm font-mono bg-[#0B0F17] border rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors ${
                  fieldErrors.hostname ? 'border-[#EF4444]' : 'border-[#1E293B]'
                }`}
              />
              {fieldErrors.hostname && (
                <p className="mt-1 text-[11px] text-[#EF4444]">
                  {fieldErrors.hostname}
                </p>
              )}
            </div>
          </div>

          {/* Row 2: IP Address, SSH Port, Username */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            <div className="sm:col-span-6">
              <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                {t('IP-адрес (IP Address)', 'IP Address')}{' '}
                <span className="text-[#EF4444]">*</span>
              </label>
              <input
                type="text"
                value={form.ip_address}
                onChange={(e) => setForm({ ...form, ip_address: e.target.value })}
                placeholder="192.168.1.10"
                className={`w-full h-9 px-3 text-sm font-mono bg-[#0B0F17] border rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors ${
                  fieldErrors.ip_address ? 'border-[#EF4444]' : 'border-[#1E293B]'
                }`}
              />
              {fieldErrors.ip_address && (
                <p className="mt-1 text-[11px] text-[#EF4444]">
                  {fieldErrors.ip_address}
                </p>
              )}
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                {t('SSH Порт (Port)', 'SSH Port')}{' '}
                <span className="text-[#EF4444]">*</span>
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={form.ssh_port}
                onChange={(e) =>
                  setForm({ ...form, ssh_port: Number(e.target.value) })
                }
                className={`w-full h-9 px-3 text-sm font-mono bg-[#0B0F17] border rounded text-[#F8FAFC] focus:outline-none focus:border-emerald-500 transition-colors ${
                  fieldErrors.ssh_port ? 'border-[#EF4444]' : 'border-[#1E293B]'
                }`}
              />
              {fieldErrors.ssh_port && (
                <p className="mt-1 text-[11px] text-[#EF4444]">
                  {fieldErrors.ssh_port}
                </p>
              )}
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                {t('Пользователь (Username)', 'Username')}{' '}
                <span className="text-[#EF4444]">*</span>
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="root"
                className={`w-full h-9 px-3 text-sm font-mono bg-[#0B0F17] border rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors ${
                  fieldErrors.username ? 'border-[#EF4444]' : 'border-[#1E293B]'
                }`}
              />
              {fieldErrors.username && (
                <p className="mt-1 text-[11px] text-[#EF4444]">
                  {fieldErrors.username}
                </p>
              )}
            </div>
          </div>

          {/* Row 3: SSH Authentication Section */}
          <div className="p-3.5 rounded bg-[#0B0F17] border border-[#1E293B] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-[#F8FAFC]">
                  {t('SSH-аутентификация (Пароль / Ключ)', 'SSH Authentication')}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded">
                <ShieldCheck className="w-3 h-3" />
                AES-256-GCM
              </span>
            </div>

            {/* Auth Method Toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#111722] border border-[#1E293B] rounded">
              <button
                type="button"
                onClick={() => setAuthType('password')}
                className={`h-7 text-xs font-medium rounded flex items-center justify-center gap-1.5 transition-colors ${
                  form.auth_type === 'password'
                    ? 'bg-emerald-600 text-white'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                {t('Пароль (Password)', 'Password')}
              </button>
              <button
                type="button"
                onClick={() => setAuthType('private_key')}
                className={`h-7 text-xs font-medium rounded flex items-center justify-center gap-1.5 transition-colors ${
                  form.auth_type === 'private_key'
                    ? 'bg-emerald-600 text-white'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {t('SSH-ключ (Private Key)', 'SSH Private Key')}
              </button>
            </div>

            {form.auth_type === 'password' ? (
              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  {t('SSH Пароль для', 'SSH Password for')}{' '}
                  <span className="font-mono text-[#F8FAFC]">
                    {form.username || 'root'}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.secret}
                    onChange={(e) => setForm({ ...form, secret: e.target.value })}
                    placeholder={t(
                      'Введите пароль для SSH-подключения...',
                      'Enter SSH password...'
                    )}
                    className={`w-full h-9 pl-3 pr-9 text-sm font-mono bg-[#111722] border rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors ${
                      fieldErrors.secret ? 'border-[#EF4444]' : 'border-[#1E293B]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#F8FAFC]"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.secret && (
                  <p className="mt-1 text-[11px] text-[#EF4444]">
                    {fieldErrors.secret}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-[#94A3B8]">
                    {t('Приватный ключ (Ed25519 / RSA PEM)', 'Private Key (Ed25519 / RSA PEM)')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, secret: SAMPLE_OPENSSH_KEY })
                    }
                    className="text-[11px] font-mono text-emerald-400 hover:underline"
                  >
                    {t('Вставить тестовый ключ Ed25519', 'Insert sample Ed25519 key')}
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={form.secret}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  className={`w-full p-2.5 text-xs font-mono bg-[#111722] border rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors resize-none ${
                    fieldErrors.secret ? 'border-[#EF4444]' : 'border-[#1E293B]'
                  }`}
                />
                {fieldErrors.secret && (
                  <p className="mt-1 text-[11px] text-[#EF4444]">
                    {fieldErrors.secret}
                  </p>
                )}
              </div>
            )}

            {/* Verify immediately checkbox */}
            <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(form.verify_now)}
                onChange={(e) =>
                  setForm({ ...form, verify_now: e.target.checked })
                }
                className="w-3.5 h-3.5 rounded border-[#1E293B] bg-[#111722] text-emerald-500 focus:ring-0"
              />
              <span className="text-xs text-[#94A3B8]">
                {t(
                  'Проверить SSH-соединение сразу при добавлении и получить метрики ОС',
                  'Verify SSH connection immediately and collect Linux host telemetry'
                )}
              </span>
            </label>
          </div>

          {/* Connection Preview Pill */}
          <div className="px-3 py-2 rounded bg-[#0B0F17] border border-[#1E293B]/80 flex items-center justify-between text-xs">
            <span className="text-[#64748B] flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              {t('Команда подключения:', 'Target SSH endpoint:')}
            </span>
            <code className="font-mono text-[#F8FAFC]">
              ssh -p {form.ssh_port || 22} {form.username || 'root'}@
              {form.ip_address || '0.0.0.0'}
            </code>
          </div>

          {/* Row 4: Description */}
          <div>
            <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
              {t('Описание (Description)', 'Description')}
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t(
                'Роль сервера, локация дата-центра, установленные сервисы...',
                'Server role, datacenter location, installed workloads...'
              )}
              className="w-full p-3 text-sm bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-emerald-500 transition-colors resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1E293B]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-9 px-4 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] bg-transparent hover:bg-[#1E293B]/60 border border-[#1E293B] rounded transition-colors"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded flex items-center gap-2 transition-colors shadow-xs"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {form.verify_now && form.secret.trim()
                    ? t('Подключение по SSH...', 'Probing SSH...')
                    : t('Сохранение...', 'Saving...')}
                </>
              ) : (
                t('Сохранить', 'Save Server')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
