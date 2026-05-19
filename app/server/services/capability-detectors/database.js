/**
 * database — does this codebase have a persistence layer?
 *
 * Signals:
 *   - Declared ORM / driver deps (Prisma, Drizzle, Mongoose, pg, mongoose,
 *     SQLAlchemy, GORM, …) — strongest.
 *   - Path conventions: `schema.prisma`, `drizzle.config.*`, `migrations/`,
 *     `models/`, `*.sql`.
 *   - Code patterns that imply a runtime query (`prisma.X.findMany(`, `new
 *     Pool(`, `mongoose.Schema(`, …).
 *
 * Legacy gap shape: { exists, type, hasSchema, hasMigrations } — preserved
 * via `extra` so readiness-scorer / suggestion-rules keep working unchanged.
 */

const NAME = 'database';

const JS_DB_DEPS = [
  'prisma', '@prisma/client',
  'drizzle-orm',
  'mongoose',
  'pg', 'postgres', 'pg-promise',
  'mysql2',
  'better-sqlite3', 'sqlite3',
  '@supabase/supabase-js',
  'firebase',
  '@neondatabase/serverless',
  'knex', 'typeorm', 'sequelize',
];

const PY_DB_PKGS = [
  'sqlalchemy', 'psycopg2', 'asyncpg', 'pymongo', 'peewee', 'tortoise-orm', 'django.db',
];

const GO_DB_PKGS = [
  'gorm.io/gorm', 'github.com/jackc/pgx', 'go.mongodb.org/mongo-driver',
];

const TYPE_BY_PKG = {
  'prisma': 'Prisma',
  '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle',
  'mongoose': 'MongoDB (Mongoose)',
  'pg': 'PostgreSQL',
  'postgres': 'PostgreSQL',
  'pg-promise': 'PostgreSQL',
  'mysql2': 'MySQL',
  'better-sqlite3': 'SQLite',
  'sqlite3': 'SQLite',
  '@supabase/supabase-js': 'Supabase',
  'firebase': 'Firebase',
  '@neondatabase/serverless': 'Neon (Postgres)',
  'knex': 'SQL (Knex)',
  'typeorm': 'TypeORM',
  'sequelize': 'Sequelize',
  'sqlalchemy': 'SQLAlchemy',
  'psycopg2': 'PostgreSQL',
  'asyncpg': 'PostgreSQL',
  'pymongo': 'MongoDB',
  'peewee': 'Peewee',
  'tortoise-orm': 'Tortoise ORM',
  'django.db': 'Django ORM',
  'gorm.io/gorm': 'GORM',
  'github.com/jackc/pgx': 'PostgreSQL (pgx)',
  'go.mongodb.org/mongo-driver': 'MongoDB',
};

const PATH_PATTERNS = [
  { re: /(?:^|\/)schema\.prisma$/,           label: 'Prisma schema' },
  { re: /(?:^|\/)drizzle\.config\.[tj]s$/,   label: 'Drizzle config' },
  { re: /(?:^|\/)migrations?\//,             label: 'migrations directory' },
  { re: /(?:^|\/)models?\//,                 label: 'models directory' },
  { re: /\.sql$/i,                           label: 'SQL file' },
];

const CONTENT_PATTERNS = [
  { re: /\bprisma\.[a-zA-Z_$][\w$]*\.findMany\s*\(/, label: 'prisma.X.findMany()' },
  { re: /\bawait\s+db\.select\s*\(/,                  label: 'db.select()' },
  { re: /\bmongoose\.Schema\s*\(/,                    label: 'mongoose.Schema()' },
  { re: /\bnew\s+Pool\s*\(/,                          label: 'new Pool()' },
  { re: /\bcreatePool\s*\(/,                          label: 'createPool()' },
  { re: /\.connect\s*\(\s*['"](?:postgres|postgresql|mongodb|mysql):/i, label: 'connect(<conn-string>)' },
];

const DEP_SIGNAL = 0.95;
const PATH_PER_FILE = 0.7;
const PATH_CAP = 0.9;
const CODE_PER_FILE = 0.6;
const CODE_CAP = 0.9;

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
  for (const name of JS_DB_DEPS) {
    if (deps[name]) hits.push({ file: 'package.json', pkg: name });
  }

  const req = fileContents['requirements.txt'];
  if (typeof req === 'string') {
    for (const p of PY_DB_PKGS) {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\b`, 'i');
      if (re.test(req)) hits.push({ file: 'requirements.txt', pkg: p });
    }
  }
  const pyproject = fileContents['pyproject.toml'];
  if (typeof pyproject === 'string') {
    for (const p of PY_DB_PKGS) {
      if (pyproject.includes(p)) hits.push({ file: 'pyproject.toml', pkg: p });
    }
  }

  const goMod = fileContents['go.mod'];
  if (typeof goMod === 'string') {
    for (const p of GO_DB_PKGS) {
      if (goMod.includes(p)) hits.push({ file: 'go.mod', pkg: p });
    }
  }

  return hits;
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

function findContentHits(fileContents) {
  const hits = [];
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pat of CONTENT_PATTERNS) {
        if (pat.re.test(lines[i])) {
          hits.push({ file: path, line: i + 1, snippet: lines[i].trim().slice(0, 200), reason: pat.label });
          break;
        }
      }
      if (hits.length > 200) return hits;
    }
  }
  return hits;
}

async function run({ files = [], fileContents = {}, stack = {} } = {}) {
  const evidence = [];
  const signals = [];

  const depHits = findDepHits(fileContents);
  if (depHits.length > 0) {
    signals.push(DEP_SIGNAL);
    for (const h of depHits) evidence.push({ file: h.file, reason: `declares ${h.pkg}` });
  }

  const pathHits = findPathHits(files);
  if (pathHits.length > 0) {
    signals.push(capAt(pathHits.length, PATH_PER_FILE, PATH_CAP));
    for (const h of pathHits.slice(0, 10)) evidence.push(h);
  }

  const contentHits = findContentHits(fileContents);
  if (contentHits.length > 0) {
    const uniqFiles = new Set(contentHits.map((c) => c.file));
    signals.push(capAt(uniqFiles.size, CODE_PER_FILE, CODE_CAP));
    for (const c of contentHits.slice(0, 10)) evidence.push(c);
  }

  const confidence = combine(signals);

  let type = stack.database || null;
  if (!type && depHits.length > 0) {
    type = TYPE_BY_PKG[depHits[0].pkg] || depHits[0].pkg;
  }

  const paths = files.map((f) => f.path);
  const hasSchema = paths.some((p) => /schema/i.test(p));
  const hasMigrations = paths.some((p) => /migration/i.test(p));

  const hasSourceSignal = depHits.length > 0 || contentHits.length > 0;
  let status;
  if (confidence >= 0.7 && (hasSourceSignal || pathHits.length >= 2)) status = 'present';
  else if (confidence >= 0.3) status = 'partial';
  else status = 'missing';

  return {
    exists: status !== 'missing',
    confidence,
    status,
    evidence,
    extra: { type, hasSchema, hasMigrations },
  };
}

module.exports = { name: NAME, run };
