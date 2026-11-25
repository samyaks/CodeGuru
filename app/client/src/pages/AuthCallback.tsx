import { useEffect, useState } from 'react';
import { safeNext, takeAfterSignIn } from '../lib/safe-next';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    const queryParams = new URLSearchParams(window.location.search);
    const code = queryParams.get('code');
    // An invite's magic link carries ?next=/invite/...; a GitHub sign-in
    // started from an invite page remembers it in sessionStorage. Always take
    // the remembered one, so it can't redirect a later sign-in.
    const remembered = takeAfterSignIn();
    const next = safeNext(queryParams.get('next')) || remembered || '/dashboard';
    // Supabase puts errors in the query or, for email links, in the hash
    // (an expired or already-used link: error_code=otp_expired).
    const authError = queryParams.get('error_description') || queryParams.get('error')
      || params.get('error_description') || params.get('error');

    if (authError) {
      // From an invite, go back to it: the page can send a fresh sign-in link.
      if (next.startsWith('/invite/')) {
        window.location.replace(`${next.split(/[?#]/)[0]}?signin=failed`);
        return;
      }
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
          window.location.href = next;
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
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-danger text-lg">{error}</p>
          <a href="/" className="text-brand hover:text-brand-hov underline">
            Back to home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <p className="text-text-muted text-lg animate-pulse">Signing you in...</p>
    </div>
  );
}
