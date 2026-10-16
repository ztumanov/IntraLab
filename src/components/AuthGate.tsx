import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  ShieldCheck,
  Smartphone,
  Terminal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';

type AuthMode = 'login' | '2fa';

export const AuthGate: React.FC = () => {
  const {
    loginWithLocalCredentials,
    verifyLocal2faCode,
    signInWithGoogle,
    error,
    clearError,
  } = useAuth();
  const { locale, setLocale, t } = useI18n();

  const [mode, setMode] = useState<AuthMode>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // 2FA challenge state
  const [preAuthToken, setPreAuthToken] = useState('');
  const [pendingAccountLabel, setPendingAccountLabel] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [useRecoveryMode, setUseRecoveryMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    clearError();
    setMode(nextMode);
  };

  const handleLocalLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await loginWithLocalCredentials(identifier, password);
      if (result.requires2fa && result.preAuthToken) {
        setPreAuthToken(result.preAuthToken);
        setPendingAccountLabel(result.email || result.username || identifier);
        setTotpCode('');
        setUseRecoveryMode(false);
        setMode('2fa');
      }
    } catch {
      // Error is handled by AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify2faSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await verifyLocal2faCode(preAuthToken, totpCode);
    } catch {
      // Error is handled by AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-[#0F172A] text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <Terminal className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-100">InfraLab</span>
          <span className="rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
            SELF-HOSTED
          </span>
        </div>

        <nav className="hidden items-center gap-6 text-xs font-medium text-slate-400 md:flex">
          <span>{t('Локальная авторизация', 'Local Authentication')}</span>
          <span>TOTP 2FA (RFC 6238)</span>
          <span>SSH / WebSocket PTY</span>
          <span>Prometheus TSDB</span>
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
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-6 py-12">
        <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Platform Overview */}
          <div className="flex flex-col justify-center space-y-6 lg:col-span-6">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs font-medium text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t(
                  'Автономный контур управления · Без привязки к облаку',
                  'Autonomous Control Plane · Cloud-Independent'
                )}
              </p>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
                {t(
                  'Локальный вход в InfraLab с защитой двухфакторной аутентификацией (2FA).',
                  'Local operator sign-in with Two-Factor Authentication (TOTP 2FA).'
                )}
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                {t(
                  'После развёртывания из Docker вы можете входить по локальному логину и паролю без Google-аккаунта. В разделе Settings доступно подключение двухфакторной аутентификации (Google Authenticator, Authy, 1Password, Яндекс Ключ) и резервных кодов.',
                  'After deploying via Docker, sign in directly with a local username and password without requiring a Google account. Enable RFC 6238 TOTP Two-Factor Authentication and backup recovery codes in Settings.'
                )}
              </p>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-800 bg-[#1E293B]/70 p-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-200">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <span>
                  {t(
                    'Создание учётной записи администратора',
                    'Create Administrator Account'
                  )}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-300">
                {t(
                  'Публичная регистрация отключена в целях безопасности. Чтобы создать учётную запись администратора, выполните команду на сервере через Docker:',
                  'Public self-registration is disabled for security. To create an administrator account, run the command on the host via Docker:'
                )}
              </p>
              <div className="rounded border border-slate-800 bg-[#0F172A] px-3 py-2 font-mono text-[11px] text-emerald-400 select-all">
                docker compose exec infralab npm run create-admin
              </div>
              <p className="text-[11px] text-slate-400">
                {t(
                  'Команда создаст администратора в интерактивном режиме или с параметрами --username, --email, --password.',
                  'Interactive CLI prompt or accepts --username, --email, --password flags.'
                )}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-slate-800 bg-[#1E293B]/50 p-3">
                <div className="font-semibold text-slate-200">scrypt + HMAC</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {t('Локальное хеширование паролей и сессий', 'Salted scrypt hashes & signed tokens')}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#1E293B]/50 p-3">
                <div className="font-semibold text-slate-200">TOTP 2FA</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {t('6-значные коды RFC 6238 + 8 резервных кодов', 'RFC 6238 6-digit codes + 8 backup codes')}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#1E293B]/50 p-3">
                <div className="font-semibold text-slate-200">AES-256-GCM</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {t('Шифрование SSH-ключей и секретов 2FA', 'Encrypted SSH & TOTP secrets in DB')}
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Auth Card */}
          <div className="lg:col-span-6">
            <div className="rounded-xl border border-slate-800 bg-[#1E293B] p-6 shadow-xl sm:p-8">
              {mode === 'login' && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Lock className="h-4 w-4 text-emerald-400" />
                    <span>{t('Вход в панель управления', 'Sign In to Control Plane')}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {t(
                      'Введите логин или email учётной записи администратора',
                      'Enter your administrator username or email'
                    )}
                  </p>
                </div>
              )}

              {error && (
                <div className="mb-5 rounded-md border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
                  {error}
                </div>
              )}

              {/* STEP 1: LOCAL USERNAME/PASSWORD LOGIN */}
              {mode === 'login' && (
                <form onSubmit={handleLocalLoginSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      {t('Логин или Email оператора', 'Operator Username or Email')}
                    </label>
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="admin"
                      className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0F172A] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      {t('Пароль', 'Password')}
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0F172A] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <KeyRound className="h-4 w-4" />
                    <span>
                      {submitting
                        ? t('Проверка учётных данных...', 'Verifying credentials...')
                        : t('Войти в панель управления', 'Sign In to Control Plane')}
                    </span>
                  </button>

                  <div className="relative my-5 flex items-center justify-center">
                    <div className="w-full border-t border-slate-800" />
                    <span className="bg-[#1E293B] px-3 text-[11px] uppercase tracking-wider text-slate-500">
                      {t('или облачный вход', 'or cloud auth')}
                    </span>
                    <div className="w-full border-t border-slate-800" />
                  </div>

                  <button
                    type="button"
                    onClick={signInWithGoogle}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-[#0F172A] px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
                  >
                    <span>{t('Войти через Google OAuth (опционально)', 'Sign In with Google OAuth (Optional)')}</span>
                  </button>
                </form>
              )}

              {/* STEP 2: TWO-FACTOR AUTHENTICATION (2FA TOTP / RECOVERY CODE) */}
              {mode === '2fa' && (
                <form onSubmit={handleVerify2faSubmit} className="space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-5 w-5 text-emerald-400" />
                      <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                          {t('Двухфакторная аутентификация (2FA)', 'Two-Factor Authentication (2FA)')}
                        </h2>
                        <p className=" font-mono text-[11px] text-slate-400">{pendingAccountLabel}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>{t('Назад', 'Back')}</span>
                    </button>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-300">
                    {useRecoveryMode
                      ? t(
                          'Введите один из ваших 8-символьных одноразовых резервных кодов восстановления (например, ABCD-EFGH).',
                          'Enter one of your 8-character single-use backup recovery codes (e.g., ABCD-EFGH).'
                        )
                      : t(
                          'Откройте приложение-аутентификатор (Google Authenticator, Authy, 1Password) и введите текущий 6-значный код.',
                          'Open your authenticator app (Google Authenticator, Authy, 1Password) and enter the 6-digit verification code.'
                        )}
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      {useRecoveryMode
                        ? t('Резервный код восстановления', 'Backup Recovery Code')
                        : t('6-значный код TOTP', '6-Digit TOTP Code')}
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      autoComplete="one-time-code"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      placeholder={useRecoveryMode ? 'XXXX-XXXX' : '000000'}
                      className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0F172A] px-4 py-3 text-center font-mono text-lg tracking-widest text-emerald-400 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {submitting
                        ? t('Проверка кода...', 'Verifying code...')
                        : t('Подтвердить и войти', 'Verify & Sign In')}
                    </span>
                  </button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        clearError();
                        setTotpCode('');
                        setUseRecoveryMode(!useRecoveryMode);
                      }}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      {useRecoveryMode
                        ? t('Использовать 6-значный код из приложения', 'Use 6-digit authenticator code instead')
                        : t('Нет доступа к приложению? Ввести резервный код', 'Lost authenticator access? Use a recovery code')}
                    </button>
                  </div>
                </form>
              )}


            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800/80 px-8 py-4 text-xs text-slate-500">
        <div className="flex items-center justify-between">
          <span>InfraLab Self-Hosted Control Plane</span>
          <span>Local Auth · TOTP 2FA · PostgreSQL · Prometheus</span>
        </div>
      </footer>
    </div>
  );
};
