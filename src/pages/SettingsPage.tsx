import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { useAuth, getInMemoryAuthToken } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';
import { useHealth, useServers } from '../hooks/useServers.ts';

interface AuthMeProfile {
  uid: string;
  email: string;
  username: string;
  auth_provider: string;
  has_local_password: boolean;
  totp_enabled: boolean;
  recovery_codes_remaining: number;
}

interface TotpSetupPayload {
  secret: string;
  otpauth_uri: string;
  qr_data_url: string;
  issuer: string;
  account: string;
}

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const { data: health } = useHealth();
  const { data: servers = [] } = useServers();

  const [profile, setProfile] = useState<AuthMeProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // 2FA Setup state
  const [totpSetup, setTotpSetup] = useState<TotpSetupPayload | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [showDisablePrompt, setShowDisablePrompt] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpMessage, setTotpMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const encryptedCount = servers.filter((s) => s.has_secret).length;

  const fetchAuthProfile = async () => {
    setLoadingProfile(true);
    try {
      const token = await getInMemoryAuthToken();
      const res = await fetch('/api/auth/me', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as AuthMeProfile;
        setProfile(data);
      }
    } catch {
      // Ignore error
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchAuthProfile();
  }, []);

  const handleStart2faSetup = async () => {
    setTotpBusy(true);
    setTotpMessage(null);
    setRecoveryCodes(null);
    try {
      const token = await getInMemoryAuthToken();
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось сгенерировать секрет 2FA');
      }
      setTotpSetup(data as TotpSetupPayload);
      setVerifyCode('');
    } catch (err: any) {
      setTotpMessage({ type: 'error', text: err.message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleEnable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpBusy(true);
    setTotpMessage(null);
    try {
      const token = await getInMemoryAuthToken();
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: verifyCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Неверный код подтверждения 2FA');
      }
      setTotpSetup(null);
      setVerifyCode('');
      setRecoveryCodes(data.recovery_codes || []);
      setTotpMessage({
        type: 'success',
        text: t(
          'Двухфакторная аутентификация (2FA TOTP) успешно активирована! Сохраните резервные коды ниже.',
          'Two-Factor Authentication (TOTP 2FA) enabled! Save your backup recovery codes below.'
        ),
      });
      await fetchAuthProfile();
    } catch (err: any) {
      setTotpMessage({ type: 'error', text: err.message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleDisable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setTotpBusy(true);
    setTotpMessage(null);
    try {
      const token = await getInMemoryAuthToken();
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось отключить 2FA');
      }
      setShowDisablePrompt(false);
      setDisableCode('');
      setRecoveryCodes(null);
      setTotpMessage({
        type: 'success',
        text: t('Двухфакторная аутентификация отключена.', 'Two-Factor Authentication disabled.'),
      });
      await fetchAuthProfile();
    } catch (err: any) {
      setTotpMessage({ type: 'error', text: err.message });
    } finally {
      setTotpBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordBusy(true);
    setPasswordMessage(null);
    try {
      const token = await getInMemoryAuthToken();
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка обновления пароля');
      }
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage({
        type: 'success',
        text: t('Локальный пароль успешно обновлён.', 'Local password updated successfully.'),
      });
      await fetchAuthProfile();
    } catch (err: any) {
      setPasswordMessage({ type: 'error', text: err.message });
    } finally {
      setPasswordBusy(false);
    }
  };

  const copyText = async (text: string, type: 'secret' | 'recovery') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'secret') {
        setCopiedSecret(true);
        setTimeout(() => setCopiedSecret(false), 2000);
      } else {
        setCopiedRecovery(true);
        setTimeout(() => setCopiedRecovery(false), 2000);
      }
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t('Настройки платформы и Безопасность (2FA / Auth)', 'Platform Settings & Security (2FA / Auth)')}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {t(
            'Локальная учётная запись оператора, двухфакторная аутентификация TOTP (RFC 6238), шифрование секретов AES-256-GCM и локализация.',
            'Local operator account, RFC 6238 TOTP Two-Factor Authentication, AES-256-GCM credential vault, and localization.'
          )}
        </p>
      </div>

      {/* TWO-FACTOR AUTHENTICATION (2FA TOTP) & PASSWORD SECTION */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                {t(
                  'Двухфакторная аутентификация (2FA / TOTP)',
                  'Two-Factor Authentication (2FA / TOTP)'
                )}
              </h2>
            </div>
            {profile?.totp_enabled ? (
              <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>2FA ACTIVE (RFC 6238)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>{t('2FA НЕ ВКЛЮЧЕНА', '2FA NOT ENABLED')}</span>
              </span>
            )}
          </div>

          <p className="text-xs leading-relaxed text-slate-300">
            {t(
              'Защитите локальный вход в InfraLab одноразовыми 6-значными кодами из Google Authenticator, Authy, 1Password или Яндекс Ключа. При включении 2FA также генерируются 8 одноразовых резервных кодов.',
              'Protect your local InfraLab account with 6-digit time-based one-time passwords (TOTP) compatible with Google Authenticator, Authy, or 1Password. Enabling 2FA also issues 8 single-use recovery codes.'
            )}
          </p>

          {totpMessage && (
            <div
              className={`rounded-md border px-4 py-3 text-xs ${
                totpMessage.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
              }`}
            >
              {totpMessage.text}
            </div>
          )}

          {/* Display newly generated recovery codes */}
          {recoveryCodes && recoveryCodes.length > 0 && (
            <div className="space-y-3 rounded-lg border border-amber-500/40 bg-[#0F172A] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300">
                  {t(
                    'Одноразовые резервные коды восстановления (сохраните в надёжном месте)',
                    'Single-Use Backup Recovery Codes (Store safely)'
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(recoveryCodes.join('\n'), 'recovery')}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                >
                  {copiedRecovery ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>{t('Скопировано', 'Copied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>{t('Скопировать все', 'Copy All')}</span>
                    </>
                  )}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {recoveryCodes.map((code) => (
                  <div
                    key={code}
                    className="rounded border border-slate-800 bg-[#1E293B] px-2.5 py-1.5 text-center font-mono text-xs font-semibold text-emerald-400"
                  >
                    {code}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* State 1: 2FA not enabled & not currently setting up */}
          {!loadingProfile && !profile?.totp_enabled && !totpSetup && (
            <div className="pt-1">
              <button
                type="button"
                disabled={totpBusy}
                onClick={handleStart2faSetup}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                <QrCode className="h-4 w-4" />
                <span>
                  {totpBusy
                    ? t('Генерация секрета...', 'Generating secret...')
                    : t('Настроить двухфакторную аутентификацию (2FA)', 'Set Up Two-Factor Authentication (2FA)')}
                </span>
              </button>
            </div>
          )}

          {/* State 2: QR Code & Verification Step */}
          {totpSetup && (
            <form
              onSubmit={handleEnable2fa}
              className="space-y-4 rounded-lg border border-slate-700 bg-[#0F172A] p-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                <div className="flex flex-col items-center justify-center sm:col-span-5">
                  <div className="rounded-lg border border-slate-700 bg-white p-2">
                    <img
                      src={totpSetup.qr_data_url}
                      alt="TOTP 2FA QR Code"
                      className="h-44 w-44 object-contain"
                    />
                  </div>
                  <span className="mt-2 font-mono text-[11px] text-slate-400">
                    {totpSetup.issuer} ({totpSetup.account})
                  </span>
                </div>

                <div className="flex flex-col justify-between space-y-3 sm:col-span-7">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-slate-100">
                      {t('1. Отсканируйте QR-код или введите ключ вручную', '1. Scan QR Code or Enter Setup Key')}
                    </h3>
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      {t(
                        'Откройте приложение-аутентификатор на телефоне и отсканируйте QR-код. Если камера недоступна, используйте Base32-ключ:',
                        'Scan the QR code in your authenticator app, or manually enter this Base32 secret key:'
                      )}
                    </p>
                    <div className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-[#1E293B] px-3 py-2">
                      <code className="break-all font-mono text-xs font-semibold text-emerald-400">
                        {totpSetup.secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(totpSetup.secret, 'secret')}
                        className="shrink-0 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                      >
                        {copiedSecret ? t('Скопировано', 'Copied') : t('Копировать', 'Copy')}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label className="block text-xs font-semibold text-slate-200">
                      {t(
                        '2. Введите 6-значный код для подтверждения',
                        '2. Enter 6-Digit Code to Activate'
                      )}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value)}
                        placeholder="000000"
                        className="w-36 rounded-md border border-slate-700 bg-[#1E293B] px-3 py-2 text-center font-mono text-sm tracking-widest text-emerald-400 focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={totpBusy}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {totpBusy ? t('Проверка...', 'Verifying...') : t('Включить 2FA', 'Enable 2FA')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTotpSetup(null)}
                        className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-slate-200"
                      >
                        {t('Отмена', 'Cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* State 3: 2FA is active */}
          {profile?.totp_enabled && (
            <div className="space-y-3 rounded-lg border border-slate-800 bg-[#0F172A] p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-200">
                    {t('Статус защиты аккаунта:', 'Account Protection Status:')}
                  </span>{' '}
                  <span className="font-mono text-emerald-400">
                    {t(
                      `Активна (осталось резервных кодов: ${profile.recovery_codes_remaining})`,
                      `Enabled (${profile.recovery_codes_remaining} recovery codes remaining)`
                    )}
                  </span>
                </div>
                {!showDisablePrompt && (
                  <button
                    type="button"
                    onClick={() => setShowDisablePrompt(true)}
                    className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/60"
                  >
                    {t('Отключить 2FA', 'Disable 2FA')}
                  </button>
                )}
              </div>

              {showDisablePrompt && (
                <form
                  onSubmit={handleDisable2fa}
                  className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3"
                >
                  <input
                    type="text"
                    required
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    placeholder={t('Код 2FA или пароль', '6-digit 2FA code or password')}
                    className="rounded border border-slate-700 bg-[#1E293B] px-3 py-1.5 text-xs text-slate-100 focus:border-rose-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={totpBusy}
                    className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    {t('Подтвердить отключение', 'Confirm Disable')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisablePrompt(false);
                      setDisableCode('');
                    }}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                  >
                    {t('Отмена', 'Cancel')}
                  </button>
                </form>
              )}
            </div>
          )}
        </section>

        {/* LOCAL PASSWORD MANAGEMENT */}
        <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4 lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <KeyRound className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {t('Пароль локального оператора', 'Local Operator Password')}
            </h2>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            {t(
              'Смените стандартный пароль администратора после развёртывания контейнера Docker. Пароль хешируется алгоритмом scrypt с индивидуальной солью.',
              'Update your local operator password after deploying the Docker stack. Passwords are salted and hashed with scrypt.'
            )}
          </p>

          {passwordMessage && (
            <div
              className={`rounded-md border px-3.5 py-2.5 text-xs ${
                passwordMessage.type === 'success'
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
              }`}
            >
              {passwordMessage.text}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
            <div>
              <label className="block font-medium text-slate-300">
                {t('Текущий пароль', 'Current Password')}
              </label>
              <input
                type="password"
                required={Boolean(profile?.has_local_password)}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1 w-full rounded border border-slate-700 bg-[#0F172A] px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-300">
                {t('Новый пароль (мин. 6 символов)', 'New Password (min 6 chars)')}
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="mt-1 w-full rounded border border-slate-700 bg-[#0F172A] px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={passwordBusy}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-4 py-2 font-semibold text-slate-100 transition-colors hover:border-emerald-500/50 hover:bg-slate-700 disabled:opacity-50"
            >
              {passwordBusy
                ? t('Сохранение...', 'Updating...')
                : t('Обновить локальный пароль', 'Update Local Password')}
            </button>
          </form>
        </section>
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
              <span className="text-slate-400">{t('Логин (Username)', 'Username')}</span>
              <span className="font-mono font-medium text-slate-100">
                {profile?.username || user?.displayName || 'admin'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded border border-slate-800 bg-[#0F172A] px-3.5 py-2.5">
              <span className="text-slate-400">Email</span>
              <span className="font-mono font-medium text-slate-100">
                {profile?.email || user?.email || 'admin@infralab.local'}
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
                {t('Алгоритм хранения SSH и 2FA секретов', 'SSH & 2FA Secret Cipher')}
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
              <span className="text-slate-400">WebSocket Interactive PTY</span>
              <span className="font-mono text-emerald-400">ENABLED (/api/ws/terminal)</span>
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
