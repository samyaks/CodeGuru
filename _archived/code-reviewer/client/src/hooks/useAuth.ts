import { useState, useEffect, useCallback, createContext, useContext } from 'react';

interface User {
  id: string;
  email: string;
  provider: string;
  avatar_url: string | null;
  full_name: string | null;
  user_name: string | null;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (provider: 'github' | 'google') => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((provider: 'github' | 'google') => {
    // Full browser navigations must go directly to the backend in dev,
    // because CRA's dev server intercepts HTML requests before the proxy.
    const backendOrigin = process.env.NODE_ENV === 'development' ? 'http://localhost:3003' : '';
    window.location.href = `${backendOrigin}/auth/login?provider=${provider}`;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    window.location.href = '/';
  }, []);

  return { user, loading, login, logout };
}
