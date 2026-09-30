import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';

export interface LocalAuthUserInfo {
  uid: string;
  email: string;
  username: string;
  totp_enabled?: boolean;
  auth_provider?: 'local' | 'google';
}

export interface LocalLoginResult {
  requires2fa: boolean;
  preAuthToken?: string;
  email?: string;
  username?: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  loginWithLocalCredentials: (identifier: string, password: string) => Promise<LocalLoginResult>;
  verifyLocal2faCode: (preAuthToken: string, code: string) => Promise<{ usedRecoveryCode: boolean }>;
  registerLocalAccount: (username: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInSelfHostedOperator: () => void;
  logout: () => Promise<void>;
  getFreshToken: () => Promise<string | null>;
}

const LOCAL_SESSION_STORAGE_KEY = 'infralab_local_auth_session_v1';
const SELF_HOSTED_STORAGE_KEY = 'infralab_self_hosted_session';
const SELF_HOSTED_TOKEN = 'infralab-self-hosted-operator-token';

interface StoredLocalSession {
  token: string;
  user: LocalAuthUserInfo;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

let currentMemoryToken: string | null = null;
let currentAuthUser: User | null = null;

function createLocalUserObject(info: LocalAuthUserInfo, sessionToken: string): User {
  return {
    uid: info.uid,
    email: info.email,
    displayName: info.username || info.email.split('@')[0] || 'InfraLab Operator',
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => sessionToken,
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: null,
    photoURL: null,
    providerId: info.auth_provider || 'local',
  };
}

function createSelfHostedUserObject(): User {
  return createLocalUserObject(
    {
      uid: 'infralab-local-operator',
      email: 'admin@infralab.local',
      username: 'admin',
      auth_provider: 'local',
    },
    SELF_HOSTED_TOKEN
  );
}

export async function getInMemoryAuthToken(): Promise<string | null> {
  if (currentMemoryToken && currentMemoryToken.startsWith('ila_sess.')) {
    return currentMemoryToken;
  }
  if (currentAuthUser) {
    try {
      currentMemoryToken = await currentAuthUser.getIdToken();
      return currentMemoryToken;
    } catch {
      return currentMemoryToken;
    }
  }
  return currentMemoryToken;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const activateLocalSession = (sessionToken: string, userInfo: LocalAuthUserInfo) => {
    const localUser = createLocalUserObject(userInfo, sessionToken);
    currentAuthUser = localUser;
    currentMemoryToken = sessionToken;
    try {
      const payload: StoredLocalSession = { token: sessionToken, user: userInfo };
      localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors
    }
    setUser(localUser);
    setToken(sessionToken);
  };

  useEffect(() => {
    try {
      const rawLocal = localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal) as StoredLocalSession;
        if (parsed?.token && parsed?.user?.uid) {
          const localUser = createLocalUserObject(parsed.user, parsed.token);
          currentAuthUser = localUser;
          currentMemoryToken = parsed.token;
          setUser(localUser);
          setToken(parsed.token);
          setLoading(false);
          return;
        }
      }

      if (sessionStorage.getItem(SELF_HOSTED_STORAGE_KEY) === 'active') {
        const localUser = createSelfHostedUserObject();
        currentAuthUser = localUser;
        currentMemoryToken = SELF_HOSTED_TOKEN;
        setUser(localUser);
        setToken(SELF_HOSTED_TOKEN);
        setLoading(false);
        return;
      }
    } catch {
      // Ignore storage access errors
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (
        currentMemoryToken === SELF_HOSTED_TOKEN ||
        (currentMemoryToken && currentMemoryToken.startsWith('ila_sess.'))
      ) {
        setLoading(false);
        return;
      }
      currentAuthUser = firebaseUser;
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const idToken = await firebaseUser.getIdToken();
          currentMemoryToken = idToken;
          setToken(idToken);
        } catch (err) {
          console.error('Failed to retrieve ID token:', err);
          currentMemoryToken = null;
          setToken(null);
        }
      } else {
        currentMemoryToken = null;
        setToken(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const clearError = () => setError(null);

  const loginWithLocalCredentials = async (
    identifier: string,
    password: string
  ): Promise<LocalLoginResult> => {
    setError(null);
    const response = await fetch('/api/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data.error || 'Неверный логин или пароль';
      setError(msg);
      throw new Error(msg);
    }

    if (data.requires_2fa) {
      return {
        requires2fa: true,
        preAuthToken: data.pre_auth_token,
        email: data.email,
        username: data.username,
      };
    }

    activateLocalSession(data.token, data.user);
    return { requires2fa: false };
  };

  const verifyLocal2faCode = async (
    preAuthToken: string,
    code: string
  ): Promise<{ usedRecoveryCode: boolean }> => {
    setError(null);
    const response = await fetch('/api/auth/local/verify-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pre_auth_token: preAuthToken, code }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data.error || 'Неверный код двухфакторной аутентификации';
      setError(msg);
      throw new Error(msg);
    }

    activateLocalSession(data.token, data.user);
    return { usedRecoveryCode: Boolean(data.used_recovery_code) };
  };

  const registerLocalAccount = async (
    username: string,
    email: string,
    password: string
  ): Promise<void> => {
    setError(null);
    const response = await fetch('/api/auth/local/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data.error || 'Ошибка регистрации аккаунта';
      setError(msg);
      throw new Error(msg);
    }

    activateLocalSession(data.token, data.user);
  };

  const signInSelfHostedOperator = () => {
    setError(null);
    const localUser = createSelfHostedUserObject();
    currentAuthUser = localUser;
    currentMemoryToken = SELF_HOSTED_TOKEN;
    try {
      sessionStorage.setItem(SELF_HOSTED_STORAGE_KEY, 'active');
    } catch {
      // Ignore storage errors
    }
    setUser(localUser);
    setToken(SELF_HOSTED_TOKEN);
  };

  const signInWithGoogle = async () => {
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      currentAuthUser = result.user;
      const idToken = await result.user.getIdToken();
      currentMemoryToken = idToken;
      setToken(idToken);
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      const code = String(err?.code || '');
      if (code.includes('unauthorized-domain') || code.includes('operation-not-supported')) {
        setError(
          'Домен не авторизован в Google Firebase. Используйте локальный вход по логину и паролю.'
        );
        return;
      }
      setError(err?.message || 'Sign-in failed. Please try again.');
    }
  };

  const logout = async () => {
    setError(null);
    try {
      localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
      sessionStorage.removeItem(SELF_HOSTED_STORAGE_KEY);
    } catch {
      // Ignore
    }
    if (
      currentMemoryToken !== SELF_HOSTED_TOKEN &&
      !(currentMemoryToken && currentMemoryToken.startsWith('ila_sess.'))
    ) {
      await signOut(auth).catch(() => {});
    }
    currentAuthUser = null;
    currentMemoryToken = null;
    setUser(null);
    setToken(null);
  };

  const getFreshToken = async () => {
    return getInMemoryAuthToken();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        clearError,
        loginWithLocalCredentials,
        verifyLocal2faCode,
        registerLocalAccount,
        signInWithGoogle,
        signInSelfHostedOperator,
        logout,
        getFreshToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
