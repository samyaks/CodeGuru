import { useEffect, useState } from 'react';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    const queryParams = new URLSearchParams(window.location.search);
    const code = queryParams.get('code');
    const authError = queryParams.get('error_description') || queryParams.get('error');

    if (authError) {
      setError(authError);
      return;
    }

    if (accessToken) {
      const providerToken = params.get('provider_token');
      fetch('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, provider_token: providerToken }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to set session');
          window.location.href = '/dashboard';
        })
        .catch(() => setError('Failed to complete sign in. Please try again.'));
      return;
    }

    if (code) {
      window.location.href = `/auth/callback?code=${encodeURIComponent(code)}`;
      return;
    }

    setError('No authentication data received.');
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-midnight flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-600 text-lg">{error}</p>
          <a href="/" className="text-gold hover:text-gold-dim underline">
            Back to home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-midnight flex items-center justify-center">
      <p className="text-sky-muted text-lg animate-pulse">Signing you in...</p>
    </div>
  );
}
