// Where to go after signing in: only a path on this site, never another origin.

const KEY = 'takeoff:after-signin';
const BASE = 'https://takeoff.invalid';

export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return null;
    const out = `${url.pathname}${url.search}${url.hash}`;
    // Check what the browser would actually navigate to: "/.//evil.test"
    // normalises to "//evil.test", which is another site.
    if (!out.startsWith('/') || out.startsWith('//') || new URL(out, BASE).origin !== BASE) return null;
    return out;
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
