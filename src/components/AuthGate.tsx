import React from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';

export const AuthGate: React.FC = () => {
  const { signInWithGoogle, signInSelfHostedOperator, error } = useAuth();
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col justify-between bg-[#0F172A] text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <span className="text-lg font-semibold tracking-tight text-slate-100">InfraLab</span>
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
          <span>{t('Инвентаризация серверов', 'Server Inventory')}</span>
          <span>PostgreSQL</span>
          <span>REST API</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md border border-slate-800 bg-[#1E293B] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setLocale('ru')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                locale === 'ru' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              RU
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                locale === 'en' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              EN
            </button>
          </div>
          <button
            type="button"
            onClick={signInWithGoogle}
            className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
          >
            {t('Войти через Google', 'Sign In with Google')}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-16">
        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-8 sm:p-10">
          <p className="text-xs font-medium text-emerald-400">
            {t(
              'Self-Hosted платформа управления Linux-инфраструктурой · Этап 1',
              'Self-Hosted Linux Infrastructure Platform · Stage 1 Foundation'
            )}
          </p>
          <h1
            className="mt-3 text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl"
            style={{ textWrap: 'balance' }}
          >
            {t(
              'Управление и наблюдение за Linux-серверами из единой панели управления.',
              'Manage and observe your Linux server inventory from a unified control plane.'
            )}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300">
            {t(
              'InfraLab предоставляет структурированный фундамент для учёта Linux-хостов, параметров подключения SSH и статусов узлов на базе PostgreSQL. Авторизуйтесь, чтобы открыть рабочий раздел Server Inventory.',
              'InfraLab provides a structured foundation for managing Linux hosts, SSH connection endpoints, and fleet status backed by PostgreSQL. Authenticate to access your Server Inventory workspace.'
            )}
          </p>

          {error && (
            <div className="mt-6 rounded-md border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={signInWithGoogle}
              className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
            >
              {t('Войти через Google OAuth', 'Sign In with Google OAuth')}
            </button>
            <button
              type="button"
              onClick={signInSelfHostedOperator}
              className="rounded-md border border-slate-700 bg-[#0F172A] px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-emerald-500/50 hover:text-white whitespace-nowrap"
            >
              {t('Локальный вход (Self-Hosted Docker)', 'Self-Hosted Operator Login')}
            </button>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 border-t border-slate-800 pt-6 sm:grid-cols-3">
            <div>
              <h2 className="text-xs font-semibold text-slate-200">
                {t('01. Инвентаризация серверов', '01. Server Inventory')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {t(
                  'Регистрация Linux-серверов с валидацией hostname, IPv4/IPv6-адреса и диапазона SSH-порта (1–65535).',
                  'Register Linux hosts with strict validation for hostname, IPv4/IPv6 address, and SSH port ranges (1–65535).'
                )}
              </p>
            </div>
            <div>
              <h2 className="text-xs font-semibold text-slate-200">
                {t('02. Прозрачная схема SQL', '02. Explicit SQL Schema')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {t(
                  'Хранение данных в PostgreSQL с чистыми SQL-миграциями и понятным REST API.',
                  'Backed by PostgreSQL with clean SQL migrations and structured REST API endpoints.'
                )}
              </p>
            </div>
            <div>
              <h2 className="text-xs font-semibold text-slate-200">
                {t('03. Модульная архитектура', '03. Modular Roadmap')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {t(
                  'Готовность к следующим этапам: SSH-проверки, системные метрики, Docker-контейнеры и топология сети.',
                  'Prepared for upcoming stages: SSH execution, system metrics, Docker containers, and network topology.'
                )}
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800/80 px-8 py-4 text-xs text-slate-500">
        <div className="flex items-center justify-between">
          <span>InfraLab Control Plane</span>
          <span>PostgreSQL · Go / TypeScript Monorepo</span>
        </div>
      </footer>
    </div>
  );
};
