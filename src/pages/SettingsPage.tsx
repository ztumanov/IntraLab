import React from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  Lock,
  Server as ServerIcon,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';
import { useHealth, useServers } from '../hooks/useServers.ts';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const { data: health } = useHealth();
  const { data: servers = [] } = useServers();

  const encryptedCount = servers.filter((s) => s.has_secret).length;

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t('Настройки платформы и Безопасность (Settings)', 'Platform Settings & Security')}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {t(
            'Профиль оператора, шифрование SSH-секретов AES-256-GCM, локализация и статус подсистем InfraLab.',
            'Operator profile, AES-256-GCM SSH credential vault status, localization, and InfraLab subsystem health.'
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Operator Session & RBAC */}
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <User className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t('Профиль оператора и сессия', 'Operator Profile & Auth Session')}
            </h2>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">Email</span>
              <span className="font-mono font-medium text-slate-100">
                {user?.email || 'operator@infralab.local'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">Operator UID</span>
              <span className="font-mono text-slate-300">{user?.uid || '—'}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">{t('Роль доступа (RBAC)', 'Access Role (RBAC)')}</span>
              <span className="font-mono font-semibold text-emerald-400">
                INFRA_ADMIN (Full SSH & Docker Control)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-xs">
            <span className="text-slate-400">
              {t('Язык интерфейса (UI Locale)', 'Interface Language')}
            </span>
            <div className="flex items-center rounded-md border border-slate-700 bg-[#0F172A] p-0.5">
              <button
                type="button"
                onClick={() => setLocale('ru')}
                className={`rounded px-3 py-1 font-medium ${
                  locale === 'ru' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                }`}
              >
                Русский (RU)
              </button>
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={`rounded px-3 py-1 font-medium ${
                  locale === 'en' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                }`}
              >
                English (EN)
              </button>
            </div>
          </div>
        </section>

        {/* Security & Encryption Vault Status */}
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Lock className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t(
                'Шифрование учётных данных и подсистемы',
                'Credential Encryption & Platform Subsystems'
              )}
            </h2>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">
                {t('Алгоритм хранения SSH-ключей', 'SSH Secret Cipher')}
              </span>
              <span className="font-mono font-semibold text-emerald-400">
                AES-256-GCM (scrypt KDF)
              </span>
            </div>

            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">
                {t('Защищённых узлов в хранилище', 'Vault-Protected Hosts')}
              </span>
              <span className="font-mono text-slate-100 tabular-nums">
                {encryptedCount} / {servers.length}
              </span>
            </div>

            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">PostgreSQL + Backend API</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{health?.status === 'ok' ? 'ONLINE (Port 3000)' : 'ACTIVE'}</span>
              </span>
            </div>

            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">Google Maps Geo-IP Engine</span>
              <span className="font-mono text-emerald-400">ENABLED (AdvancedMarkers)</span>
            </div>
          </div>
        </section>
      </div>

      {/* SSH Credential Inventory Quick Table */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t(
                'Аудит SSH-ключей и учётных записей узлов',
                'Host SSH Credential & Auth Method Inventory'
              )}
            </h2>
          </div>
          <Link to="/servers" className="font-mono text-xs text-emerald-400 hover:underline">
            {t('Управление серверами →', 'Manage Servers →')}
          </Link>
        </div>

        <div className="overflow-x-auto rounded border border-slate-800 bg-[#0F172A]">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="px-4 py-2.5">{t('Узел', 'Host')}</th>
                <th className="px-4 py-2.5">{t('SSH Endpoint', 'SSH Endpoint')}</th>
                <th className="px-4 py-2.5">{t('Метод аутентификации', 'Auth Method')}</th>
                <th className="px-4 py-2.5">{t('Секрет в AES-256 Vault', 'Vault Secret')}</th>
                <th className="px-4 py-2.5 text-right">{t('Действие', 'Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {servers.map((srv) => (
                <tr key={srv.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-sans font-medium text-slate-100">{srv.name}</td>
                  <td className="px-4 py-2.5 text-slate-300">
                    {srv.username}@{srv.ip_address}:{srv.ssh_port}
                  </td>
                  <td className="px-4 py-2.5 text-sky-400">{srv.auth_type}</td>
                  <td className="px-4 py-2.5">
                    {srv.has_secret ? (
                      <span className="text-emerald-400">ENCRYPTED (AES-256-GCM)</span>
                    ) : (
                      <span className="text-amber-400">MISSING SECRET</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/servers/${srv.id}`}
                      className="text-emerald-400 hover:underline"
                    >
                      {t('Ротация ключа →', 'Rotate Key →')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
