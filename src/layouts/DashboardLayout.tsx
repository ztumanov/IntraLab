import React, { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  Box,
  FileText,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rocket,
  Server,
  Settings,
  Terminal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';
import { AddServerModal } from '../components/AddServerModal.tsx';

interface NavItem {
  labelRu: string;
  labelEn: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  activeModule: boolean;
}

const SIDEBAR_STORAGE_KEY = 'infralab_sidebar_collapsed';

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { labelRu: 'Дашборд', labelEn: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, activeModule: true },
  { labelRu: 'Серверы', labelEn: 'Servers', to: '/servers', icon: Server, activeModule: true },
  { labelRu: 'Карта узлов', labelEn: 'Geo Map', to: '/map', icon: Globe, activeModule: true },
  { labelRu: 'Сети', labelEn: 'Networks', to: '/networks', icon: Network, activeModule: true },
  { labelRu: 'Контейнеры', labelEn: 'Containers', to: '/containers', icon: Box, activeModule: true },
  { labelRu: 'Файлы (SFTP)', labelEn: 'SFTP Files', to: '/files', icon: FolderOpen, activeModule: true },
  { labelRu: 'Развёртывания', labelEn: 'Deployments', to: '/deployments', icon: Rocket, activeModule: true },
  { labelRu: 'Метрики', labelEn: 'Metrics', to: '/metrics', icon: Activity, activeModule: true },
  { labelRu: 'Логи', labelEn: 'Logs', to: '/logs', icon: FileText, activeModule: true },
  { labelRu: 'Оповещения', labelEn: 'Alerts', to: '/alerts', icon: Bell, activeModule: true },
];

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const location = useLocation();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
    } catch {
      // Ignore storage errors
    }
  }, [isSidebarCollapsed]);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  const getBreadcrumbLabel = () => {
    const path = location.pathname;
    if (path === '/dashboard') return t('InfraLab / Дашборд', 'InfraLab / Dashboard');
    if (path === '/servers') return t('InfraLab / Серверы', 'InfraLab / Servers');
    if (path === '/map') return t('InfraLab / Карта узлов', 'InfraLab / Geo Map');
    if (path === '/networks') return t('InfraLab / Сети', 'InfraLab / Networks');
    if (path === '/containers') return t('InfraLab / Контейнеры', 'InfraLab / Containers');
    if (path === '/files') return t('InfraLab / Файлы (SFTP)', 'InfraLab / SFTP Files');
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
      <aside
        className={`hidden shrink-0 flex-col justify-between border-r border-slate-800 bg-[#0F172A] transition-all duration-200 md:flex ${
          isSidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div>
          <div
            className={`flex h-16 items-center border-b border-slate-800 ${
              isSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
            }`}
          >
            {!isSidebarCollapsed ? (
              <>
                <Link
                  to="/dashboard"
                  className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-100"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <Terminal className="h-4 w-4" />
                  </span>
                  <span>InfraLab</span>
                </Link>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  title={t('Свернуть боковое меню', 'Collapse sidebar')}
                  aria-label={t('Свернуть боковое меню', 'Collapse sidebar')}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-100"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={toggleSidebar}
                title={t('Развернуть боковое меню', 'Expand sidebar')}
                aria-label={t('Развернуть боковое меню', 'Expand sidebar')}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-emerald-400"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
          </div>

          <nav
            className={`space-y-1 py-4 ${isSidebarCollapsed ? 'px-2' : 'px-3'}`}
            aria-label="Sidebar Navigation"
          >
            {PRIMARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const label = locale === 'ru' ? item.labelRu : item.labelEn;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={isSidebarCollapsed ? label : undefined}
                  aria-label={label}
                  className={({ isActive }) =>
                    `group relative flex items-center rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                      isSidebarCollapsed
                        ? 'justify-center px-0 py-2.5'
                        : 'justify-start gap-3 px-3 py-2'
                    } ${
                      isActive
                        ? 'bg-slate-800/90 text-white'
                        : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!isSidebarCollapsed && <span className="truncate">{label}</span>}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className={`border-t border-slate-800 space-y-1 ${isSidebarCollapsed ? 'p-2' : 'p-3'}`}>
          <NavLink
            to="/settings"
            title={isSidebarCollapsed ? t('Настройки', 'Settings') : undefined}
            aria-label={t('Настройки', 'Settings')}
            className={({ isActive }) =>
              `flex items-center rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                isSidebarCollapsed
                  ? 'justify-center px-0 py-2.5'
                  : 'justify-start gap-3 px-3 py-2'
              } ${
                isActive
                  ? 'bg-slate-800/90 text-white'
                  : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>{t('Настройки', 'Settings')}</span>}
          </NavLink>

          <button
            type="button"
            onClick={toggleSidebar}
            title={
              isSidebarCollapsed
                ? t('Развернуть меню', 'Expand sidebar')
                : t('Компактный режим (только иконки)', 'Compact mode (icons only)')
            }
            className={`flex w-full items-center rounded-md text-xs font-medium text-slate-500 transition-colors hover:bg-slate-800/40 hover:text-slate-300 whitespace-nowrap ${
              isSidebarCollapsed
                ? 'justify-center px-0 py-2'
                : 'justify-start gap-3 px-3 py-2'
            }`}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" />
                <span>{t('Свернуть меню', 'Collapse menu')}</span>
              </>
            )}
          </button>
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
