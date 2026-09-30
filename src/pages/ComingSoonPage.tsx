import React from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../context/I18nContext.tsx';

interface ComingSoonPageProps {
  title: string;
  description: string;
  plannedStage: string;
}

export const ComingSoonPage: React.FC<ComingSoonPageProps> = ({
  title,
  description,
  plannedStage,
}) => {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-8">
        <p className="text-xs font-medium text-amber-400">
          Coming soon · {plannedStage}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-slate-100">
          {t(
            `Модуль «${title}» запланирован на следующих этапах развития InfraLab`,
            `${title} module is scheduled for a future InfraLab milestone`
          )}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
          {t(
            'На первом этапе мы заложили чистый фундамент монорепозитория, схему PostgreSQL, REST API и модуль инвентаризации серверов (Server Inventory). Перейдите в разделы «Дашборд» или «Серверы» для работы с узлами.',
            'Stage 1 focuses on establishing the clean monorepo architecture, PostgreSQL schema, REST API, and the Server Inventory module. Return to Dashboard or Servers to manage your registered Linux nodes.'
          )}
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Link
            to="/servers"
            className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
          >
            {t('Перейти к серверам', 'Go to Servers')}
          </Link>
          <Link
            to="/dashboard"
            className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white whitespace-nowrap"
          >
            {t('На дашборд', 'Back to Dashboard')}
          </Link>
        </div>
      </div>
    </div>
  );
};
