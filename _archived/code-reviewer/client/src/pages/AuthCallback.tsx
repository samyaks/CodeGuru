import { useEffect } from 'react';

export default function AuthCallback() {
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (accessToken) {
      document.cookie = `sb-access-token=${accessToken}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;
    }
    if (refreshToken) {
      document.cookie = `sb-refresh-token=${refreshToken}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;
    }

    window.location.href = '/';
  }, []);

  return <div className="app"><div className="loading-text">Signing you in...</div></div>;
}
