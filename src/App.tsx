/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { I18nProvider, useI18n } from './context/I18nContext.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DashboardLayout } from './layouts/DashboardLayout.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ServersPage } from './pages/ServersPage.tsx';
import { ServerDetailsPage } from './pages/ServerDetailsPage.tsx';
import { ServerMonitoringPage } from './pages/ServerMonitoringPage.tsx';
import { MapPage } from './pages/MapPage.tsx';
import { NetworksPage } from './pages/NetworksPage.tsx';
import { ContainersPage } from './pages/ContainersPage.tsx';
import { DeploymentsPage } from './pages/DeploymentsPage.tsx';
import { MetricsPage } from './pages/MetricsPage.tsx';
import { LogsPage } from './pages/LogsPage.tsx';
import { AlertsPage } from './pages/AlertsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const AppRoutes: React.FC = () => {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F172A] text-slate-300">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-5 w-32 animate-pulse rounded bg-slate-800" />
          <p className="text-xs text-slate-400">
            {t('Инициализация сессии InfraLab...', 'Initializing InfraLab session...')}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/:id" element={<ServerDetailsPage />} />
        <Route path="/servers/:id/monitoring" element={<ServerMonitoringPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/networks" element={<NetworksPage />} />
        <Route path="/containers" element={<ContainersPage />} />
        <Route path="/deployments" element={<DeploymentsPage />} />
        <Route path="/metrics" element={<MetricsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
};

export default function App() {
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  useEffect(() => {
    const handleQuotaExceeded = () => {
      setGmpQuotaExceeded(true);
    };
    window.addEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', handleQuotaExceeded);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            {gmpQuotaExceeded && (
              <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
                <span>
                  Google Maps Platform quota reached. If you are the app owner, visit{' '}
                  <a
                    href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold text-amber-950 hover:text-amber-800"
                  >
                    maps developer site
                  </a>{' '}
                  for instructions to update your account.
                </span>
              </div>
            )}
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
