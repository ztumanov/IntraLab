import React, { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';
import { AddServerModal } from '../components/AddServerModal.tsx';

interface NavItem {
  labelRu: string;
  labelEn: string;
  to: string;
  activeModule: boolean;
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { labelRu: 'Дашборд', labelEn: 'Dashboard', to: '/dashboard', activeModule: true },
  { labelRu: 'Серверы', labelEn: 'Servers', to: '/servers', activeModule: true },
  { labelRu: 'Карта узлов', labelEn: 'Geo Map', to: '/map', activeModule: true },
  { labelRu: 'Сети', labelEn: 'Networks', to: '/networks', activeModule: true },
  { labelRu: 'Контейнеры', labelEn: 'Containers', to: '/containers', activeModule: true },
  { labelRu: 'Развёртывания', labelEn: 'Deployments', to: '/deployments', activeModule: true },
  { labelRu: 'Метрики', labelEn: 'Metrics', to: '/metrics', activeModule: true },
  { labelRu: 'Логи', labelEn: 'Logs', to: '/logs', activeModule: true },
  { labelRu: 'Оповещения', labelEn: 'Alerts', to: '/alerts', activeModule: true },
];

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const location = useLocation();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const getBreadcrumbLabel = () => {
    const path = location.pathname;
    if (path === '/dashboard') return t('InfraLab / Дашборд', 'InfraLab / Dashboard');
    if (path === '/servers') return t('InfraLab / Серверы', 'InfraLab / Servers');
    if (path === '/map') return t('InfraLab / Карта узлов', 'InfraLab / Geo Map');
    if (path === '/networks') return t('InfraLab / Сети', 'InfraLab / Networks');
    if (path === '/containers') return t('InfraLab / Контейнеры', 'InfraLab / Containers');
    if (path === '/deployments') return t('InfraLab / Развёртывания', 'InfraLab / Deployments');
    if (path === '/metrics') return t('InfraLab / Метрики', 'InfraLab / Metrics');
    if (path === '/logs') return t('InfraLab / Логи', 'InfraLab / Logs');
    if (path === '/alerts') return t('InfraLab / Оповещения', 'InfraLab / Alerts');
    if (path === '/settings') return t('InfraLab / Настройки', 'InfraLab / Settings');
    if (path.startsWith('/servers/')) {
      const id = path.split('/')[2];
      return t(`InfraLab / Серверы / #${id}`, `InfraLab / Servers / #${id}`);
    }
    const seg = path.replace('/', '');
    return `InfraLab / ${seg.charAt(0).toUpperCase() + seg.slice(1)}`;
  };

  return (
    <div className="flex min-h-screen bg-[#0F172A] text-slate-100">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-slate-800 bg-[#0F172A] md:flex">
        <div>
          <div className="flex h-16 items-center border-b border-slate-800 px-6">
            <Link
              to="/dashboard"
              className="text-lg font-semibold tracking-tight text-slate-100"
            >
              InfraLab
            </Link>
          </div>

          <nav className="space-y-1 px-3 py-4" aria-label="Sidebar Navigation">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                  }`
                }
              >
                <span>{locale === 'ru' ? item.labelRu : item.labelEn}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="border-t border-slate-800 p-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-slate-800/90 text-white'
                  : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
              }`
            }
          >
            <span>{t('Настройки', 'Settings')}</span>
          </NavLink>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* 3-Zone Top Header Bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-[#0F172A] px-6">
          {/* Zone 1: Single text element / contextual breadcrumb */}
          <Link
            to="/dashboard"
            className="text-sm font-semibold tracking-tight text-slate-200 whitespace-nowrap truncate"
          >
            {getBreadcrumbLabel()}
          </Link>

          {/* Zone 2: 4-5 clean text navigation links */}
          <nav className="hidden lg:flex items-center gap-6 text-xs font-medium text-slate-400">
            <Link
              to="/dashboard"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              {t('Дашборд', 'Dashboard')}
            </Link>
            <Link
              to="/servers"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              {t('Серверы', 'Servers')}
            </Link>
            <Link
              to="/networks"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              {t('Сети', 'Networks')}
            </Link>
            <Link
              to="/containers"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              {t('Контейнеры', 'Containers')}
            </Link>
            <Link
              to="/metrics"
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              {t('Метрики', 'Metrics')}
            </Link>
          </nav>

          {/* Zone 3: Primary actions + language switcher */}
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-md border border-slate-800 bg-[#1E293B] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLocale('ru')}
                className={`rounded px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                  locale === 'ru' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => setLocale('en')}
                className={`rounded px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                  locale === 'en' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                EN
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('+ Добавить сервер', '+ Add Server')}</span>
            </button>
            {user && (
              <button
                type="button"
                onClick={logout}
                title={user.email || 'Operator'}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap shrink-0"
              >
                {t('Выйти', 'Sign Out')}
              </button>
            )}
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <Outlet context={{ openAddServerModal: () => setIsAddModalOpen(true) }} />
          </div>
        </main>
      </div>

      <AddServerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
    </div>
  );
};
