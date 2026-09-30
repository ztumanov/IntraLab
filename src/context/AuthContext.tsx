import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signInSelfHostedOperator: () => void;
  logout: () => Promise<void>;
  getFreshToken: () => Promise<string | null>;
}

const SELF_HOSTED_STORAGE_KEY = 'infralab_self_hosted_session';
const SELF_HOSTED_TOKEN = 'infralab-self-hosted-operator-token';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

let currentMemoryToken: string | null = null;
let currentAuthUser: User | null = null;

function createSelfHostedUserObject(): User {
  return {
    uid: 'infralab-local-operator',
    email: 'operator@infralab.local',
    displayName: 'InfraLab Admin (Self-Hosted)',
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => SELF_HOSTED_TOKEN,
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: null,
    photoURL: null,
    providerId: 'self-hosted',
  };
}

export async function getInMemoryAuthToken(): Promise<string | null> {
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

  useEffect(() => {
    try {
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
      if (currentMemoryToken === SELF_HOSTED_TOKEN) {
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
        // Automatically fall back to self-hosted operator mode when accessed via custom IP/domain
        signInSelfHostedOperator();
        return;
      }
      setError(err?.message || 'Sign-in failed. Please try again.');
    }
  };

  const logout = async () => {
    setError(null);
    try {
      sessionStorage.removeItem(SELF_HOSTED_STORAGE_KEY);
    } catch {
      // Ignore
    }
    if (currentMemoryToken !== SELF_HOSTED_TOKEN) {
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
