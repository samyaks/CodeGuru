/**
 * auth — does this codebase have an authentication layer?
 *
 * Combines four signal families:
 *   1. Declared deps (package.json / requirements.txt / pyproject.toml / go.mod)
 *      that ship an auth framework — strongest signal (~0.95).
 *   2. File paths under `/auth/`, `/login/`, `/signin/`, etc. — moderate
 *      signal (capped at 0.8 in aggregate; many starter templates have an
 *      empty `auth/` directory).
 *   3. Real auth call sites in file content (`signIn(`, `getServerSession(`,
 *      `passport.authenticate(`, `@login_required`, …) — strong signal
 *      (capped at 0.9).
 *
 * Confidence is combined as 1 - product(1 - s) so independent positives
 * compound but no single weak signal can dominate.
 */

const NAME = 'auth';

const JS_AUTH_DEPS = [
  'next-auth', '@auth/core',
  '@clerk/nextjs', '@clerk/express', '@clerk/clerk-sdk-node', '@clerk/backend',
  '@supabase/auth-helpers-nextjs', '@supabase/auth-helpers-react', '@supabase/ssr',
  'passport',
  'firebase-admin',
  '@workos-inc/node', '@workos-inc/authkit-nextjs',
  '@kinde-oss/kinde-auth-nextjs', '@kinde-oss/kinde-typescript-sdk',
  '@auth0/nextjs-auth0', '@auth0/auth0-react', '@auth0/auth0-spa-js',
];

const PY_AUTH_PKGS = [
  'authlib', 'python-jose', 'flask-login', 'django.contrib.auth', 'fastapi-users',
];

const GO_AUTH_PKGS = [
  'github.com/golang-jwt/jwt', 'github.com/markbates/goth', 'gorilla/sessions',
];

const PROVIDER_BY_PKG = {
  'next-auth': 'NextAuth',
  '@auth/core': 'NextAuth',
  '@clerk/nextjs': 'Clerk',
  '@clerk/express': 'Clerk',
  '@clerk/clerk-sdk-node': 'Clerk',
  '@clerk/backend': 'Clerk',
  '@supabase/auth-helpers-nextjs': 'Supabase Auth',
  '@supabase/auth-helpers-react': 'Supabase Auth',
  '@supabase/ssr': 'Supabase Auth',
  'passport': 'Passport.js',
  'firebase-admin': 'Firebase Auth',
  '@workos-inc/node': 'WorkOS',
  '@workos-inc/authkit-nextjs': 'WorkOS',
  '@kinde-oss/kinde-auth-nextjs': 'Kinde',
  '@kinde-oss/kinde-typescript-sdk': 'Kinde',
  '@auth0/nextjs-auth0': 'Auth0',
  '@auth0/auth0-react': 'Auth0',
  '@auth0/auth0-spa-js': 'Auth0',
  'authlib': 'Authlib',
  'python-jose': 'python-jose (JWT)',
  'flask-login': 'Flask-Login',
  'django.contrib.auth': 'Django auth',
  'fastapi-users': 'FastAPI Users',
  'github.com/golang-jwt/jwt': 'Go JWT',
  'github.com/markbates/goth': 'goth',
  'gorilla/sessions': 'gorilla/sessions',
};

const AUTH_PATH_RE = /(?:^|\/)(auth|login|signin|signup|session)(?:\/|$)/i;
const EXCLUDED_PATH_RE = /(?:^|\/)(node_modules|tests?|specs?|docs?)(?:\/|$)/i;

const AUTH_CALL_SITES = [
  { re: /\bawait\s+signIn\s*\(/,             label: 'signIn() call' },
  { re: /\bsignOut\s*\(/,                    label: 'signOut() call' },
  { re: /\buseSession\s*\(/,                 label: 'useSession() hook' },
  { re: /\bgetServerSession\s*\(/,           label: 'getServerSession() call' },
  { re: /\bpassport\.authenticate\s*\(/,     label: 'passport.authenticate()' },
  { re: /\bJwtStrategy\s*\(/,                label: 'JwtStrategy()' },
  { re: /\bjwt\.sign\s*\(/,                  label: 'jwt.sign()' },
  { re: /\bjwt\.verify\s*\(/,                label: 'jwt.verify()' },
  { re: /\brequireAuth\s*\(/,                label: 'requireAuth() guard' },
  { re: /\brequireUser\s*\(/,                label: 'requireUser() guard' },
  { re: /@login_required\b/,                 label: '@login_required decorator' },
  { re: /Depends\s*\(\s*get_current_user\s*\)/, label: 'Depends(get_current_user)' },
];

const PATH_SIGNAL_PER_FILE = 0.5;
const PATH_SIGNAL_CAP = 0.8;
const CALL_SIGNAL_PER_FILE = 0.7;
const CALL_SIGNAL_CAP = 0.9;
const DEP_SIGNAL = 0.95;

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function combine(signals) {
  let inv = 1;
  for (const s of signals) inv *= (1 - s);
  return 1 - inv;
}

function capAt(values, perItem, cap) {
  if (values <= 0) return 0;
  const raw = 1 - Math.pow(1 - perItem, values);
  return Math.min(raw, cap);
}

function findDepHits(fileContents) {
  const hits = [];
  const pkg = safeJson(fileContents['package.json']);
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  for (const pkgName of JS_AUTH_DEPS) {
    if (deps[pkgName]) hits.push({ file: 'package.json', pkg: pkgName });
  }

  const req = fileContents['requirements.txt'];
  if (typeof req === 'string') {
    for (const p of PY_AUTH_PKGS) {
      const re = new RegExp(`(?:^|\\n)\\s*${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(req)) hits.push({ file: 'requirements.txt', pkg: p });
    }
  }
  const pyproject = fileContents['pyproject.toml'];
  if (typeof pyproject === 'string') {
    for (const p of PY_AUTH_PKGS) {
      if (pyproject.includes(p)) hits.push({ file: 'pyproject.toml', pkg: p });
    }
  }

  const goMod = fileContents['go.mod'];
  if (typeof goMod === 'string') {
    for (const p of GO_AUTH_PKGS) {
      if (goMod.includes(p)) hits.push({ file: 'go.mod', pkg: p });
    }
  }

  return hits;
}

function findAuthPaths(files) {
  const out = [];
  for (const f of files) {
    const p = f.path;
    if (EXCLUDED_PATH_RE.test(p)) continue;
    if (AUTH_PATH_RE.test(p)) out.push(p);
  }
  return out;
}

function findCallSites(fileContents) {
  const out = [];
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (EXCLUDED_PATH_RE.test(path)) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const sig of AUTH_CALL_SITES) {
        if (sig.re.test(lines[i])) {
          out.push({ file: path, line: i + 1, snippet: lines[i].trim().slice(0, 200), reason: sig.label });
          break;
        }
      }
      if (out.length > 200) return out;
    }
  }
  return out;
}

async function run({ files = [], fileContents = {}, stack = {} } = {}) {
  const evidence = [];
  const signals = [];

  const depHits = findDepHits(fileContents);
  if (depHits.length > 0) {
    signals.push(DEP_SIGNAL);
    for (const h of depHits) {
      evidence.push({ file: h.file, reason: `declares ${h.pkg}` });
    }
  }

  const authPaths = findAuthPaths(files);
  if (authPaths.length > 0) {
    signals.push(capAt(authPaths.length, PATH_SIGNAL_PER_FILE, PATH_SIGNAL_CAP));
    for (const p of authPaths.slice(0, 10)) {
      evidence.push({ file: p, reason: 'auth-named path' });
    }
  }

  const callSites = findCallSites(fileContents);
  if (callSites.length > 0) {
    const uniqueFiles = new Set(callSites.map((c) => c.file));
    signals.push(capAt(uniqueFiles.size, CALL_SIGNAL_PER_FILE, CALL_SIGNAL_CAP));
    for (const c of callSites.slice(0, 10)) evidence.push(c);
  }

  const confidence = combine(signals);

  let provider = stack.auth || null;
  if (!provider && depHits.length > 0) {
    provider = PROVIDER_BY_PKG[depHits[0].pkg] || depHits[0].pkg;
  }

  let status;
  const hasSourceSignal = depHits.length > 0 || callSites.length > 0;
  if (confidence >= 0.7 && hasSourceSignal) status = 'present';
  else if (confidence >= 0.3) status = 'partial';
  else status = 'missing';

  const issues = [];
  if (status === 'partial') {
    if (authPaths.length > 0 && callSites.length === 0 && depHits.length === 0) {
      issues.push('Auth paths exist but no recognizable auth call sites');
    } else if (authPaths.length > 0 && callSites.length === 0) {
      issues.push('Auth dependency declared but no call sites detected');
    } else if (depHits.length === 0 && callSites.length > 0) {
      issues.push('Auth code detected but no auth library declared');
    }
  }

  return {
    exists: status !== 'missing',
    confidence,
    status,
    evidence,
    extra: { provider, issues },
  };
}

module.exports = { name: NAME, run };
