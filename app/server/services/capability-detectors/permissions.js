/**
 * permissions — does this codebase have an authorization / RBAC layer?
 *
 * Distinct from `auth` (which only asks "are users identified?"). A repo
 * can have auth (Clerk, NextAuth, ...) and still ship without
 * authorization, in which case every authenticated user can do anything.
 *
 * Signals:
 *   - Declared dep that's specifically an authz library (`@casl/ability`,
 *     `accesscontrol`, `oso`, `cerbos`, ...).
 *   - File paths that name RBAC concepts (`/rbac/`, `/policies/`,
 *     `/authorization/`, `/abilities/`).
 *   - Files whose content co-mentions `role` and one of `admin` /
 *     `permission` / `policy` / `canAccess` / `abilities` (same file).
 *
 * Legacy gap shape: { exists, hasRoles } — preserved via `extra`.
 */

const NAME = 'permissions';

const AUTHZ_DEPS = [
  '@casl/ability', '@casl/react',
  'accesscontrol',
  'cancan',
  'oso',
  'cerbos', '@cerbos/core', '@cerbos/http',
  'permit-io',
  'pundit',
];

const PATH_PATTERNS = [
  { re: /(?:^|\/)rbac\//i,           label: 'rbac/ directory' },
  { re: /(?:^|\/)policies?\//i,      label: 'policies/ directory' },
  { re: /(?:^|\/)authorization\//i,  label: 'authorization/ directory' },
  { re: /(?:^|\/)abilities?\//i,     label: 'abilities/ directory' },
];

const ROLE_RE = /\brole\b/i;
const COMPANION_RE = /\b(?:admin|permission|policy|canAccess|abilities)\b/i;

const DEP_SIGNAL = 0.95;
const PATH_SIGNAL = 0.7;
const FILE_PER_HIT = 0.7;
const FILE_CAP = 0.9;

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
  const pkg = safeJson(fileContents['package.json']);
  if (!pkg) return [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return AUTHZ_DEPS.filter((name) => deps[name]);
}

function findPathHits(files) {
  const hits = [];
  for (const f of files) {
    for (const pat of PATH_PATTERNS) {
      if (pat.re.test(f.path)) {
        hits.push({ file: f.path, reason: pat.label });
        break;
      }
    }
  }
  return hits;
}

function findRoleFiles(fileContents) {
  const hits = [];
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!ROLE_RE.test(content)) continue;
    if (!COMPANION_RE.test(content)) continue;
    hits.push(path);
    if (hits.length > 50) break;
  }
  return hits;
}

async function run({ files = [], fileContents = {} } = {}) {
  const evidence = [];
  const signals = [];

  const depHits = findDepHits(fileContents);
  if (depHits.length > 0) {
    signals.push(DEP_SIGNAL);
    for (const pkg of depHits) {
      evidence.push({ file: 'package.json', reason: `declares ${pkg}` });
    }
  }

  const pathHits = findPathHits(files);
  if (pathHits.length > 0) {
    signals.push(PATH_SIGNAL);
    for (const h of pathHits.slice(0, 5)) evidence.push(h);
  }

  const roleFiles = findRoleFiles(fileContents);
  if (roleFiles.length > 0) {
    signals.push(capAt(roleFiles.length, FILE_PER_HIT, FILE_CAP));
    for (const p of roleFiles.slice(0, 10)) {
      evidence.push({ file: p, reason: 'role + admin/permission/policy co-mentioned' });
    }
  }

  const confidence = combine(signals);

  let status;
  if (confidence >= 0.7) status = 'present';
  else if (confidence >= 0.3) status = 'partial';
  else status = 'missing';

  return {
    exists: status !== 'missing',
    confidence,
    status,
    evidence,
    extra: { hasRoles: roleFiles.length > 0 },
  };
}

module.exports = { name: NAME, run };
