// Where to go after signing in: only a same-site path, never another origin.

const KEY = 'takeoff:after-signin';

export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\') || /[\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://takeoff.invalid');
    if (url.origin !== 'https://takeoff.invalid') return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Remember a path to come back to after an OAuth sign-in (which can't carry one). */
export function rememberAfterSignIn(path: string) {
  const next = safeNext(path);
  if (!next) return;
  try { window.sessionStorage.setItem(KEY, next); } catch { /* private mode */ }
}

/** The remembered path, once. */
export function takeAfterSignIn(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return safeNext(value);
  } catch {
    return null;
  }
}
