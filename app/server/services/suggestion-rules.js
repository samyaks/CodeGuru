const crypto = require('crypto');

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function makeId(type, category, title) {
  return crypto.createHash('sha256').update(type + category + title).digest('hex').slice(0, 16);
}

function makeSuggestion({ type, category, priority, title, description, evidence, effort, cursorPrompt, affectedFiles }) {
  return {
    id: makeId(type, category, title),
    type,
    category,
    priority,
    title,
    description,
    evidence: evidence || [],
    effort: effort || 'medium',
    cursor_prompt: cursorPrompt || '',
    affected_files: affectedFiles || [],
    source: 'static',
    status: 'open',
  };
}

function getDeps(fileContents) {
  const pkg = safeJson(fileContents['package.json']);
  if (!pkg) return {};
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function findMainServerFile(structure, fileContents) {
  const candidates = [
    ...structure.entryPoints,
    ...Object.keys(fileContents).filter((p) =>
      /^(server|app|index)\.(js|ts)$/.test(p.split('/').pop())
    ),
  ];
  return candidates[0] || null;
}

function isExcludedFromSecretScan(path) {
  const lower = path.toLowerCase();
  return lower.endsWith('.env.example')
    || lower.endsWith('.env.sample')
    || lower.endsWith('readme.md');
}

function isConfigOrTestFile(path) {
  const lower = path.toLowerCase();
  return lower.includes('.env')
    || lower.includes('config')
    || lower.includes('test')
    || lower.includes('spec')
    || lower.includes('__tests__');
}

// ---------------------------------------------------------------------------
// Rule 1: no-rls — Supabase without Row Level Security
// ---------------------------------------------------------------------------
function ruleNoRls({ stack, fileContents, deps }) {
  const isSupabase = stack.database === 'Supabase' || !!deps['@supabase/supabase-js'];
  if (!isSupabase) return null;

  const rlsPattern = /enable row level security|create policy|alter table.*enable.*rls/i;
  const schemaFiles = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (/schema|migration|\.sql|supabase/i.test(path)) {
      schemaFiles.push(path);
      if (rlsPattern.test(content)) return null;
    }
  }

  const evidence = schemaFiles.length > 0
    ? schemaFiles.map((f) => ({ file: f, reason: 'Schema/migration file with no RLS policies found' }))
    : [{ file: 'package.json', reason: 'Supabase is used but no schema files with RLS were found' }];

  return makeSuggestion({
    type: 'bug',
    category: 'security',
    priority: 'critical',
    title: 'Supabase tables have no Row Level Security policies',
    description:
      'Your Supabase project doesn\'t appear to have RLS enabled. Without RLS, any user with your anon key can read and write every row in every table. This is the #1 security issue in Supabase apps.',
    evidence,
    effort: 'medium',
    cursorPrompt:
      'Add Row Level Security to all Supabase tables. For each table in the schema, add `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;` and create appropriate policies. For example, add a policy that lets authenticated users only read/write their own rows: `CREATE POLICY "Users can manage own data" ON table_name FOR ALL USING (auth.uid() = user_id);`. Apply this to every table that holds user data.',
    affectedFiles: schemaFiles.length > 0 ? schemaFiles : ['package.json'],
  });
}

// ---------------------------------------------------------------------------
// Rule 2: env-in-code — Hardcoded secrets in source files
// ---------------------------------------------------------------------------
function ruleEnvInCode({ fileContents }) {
  const secretPatterns = [
    { re: /sk-ant-[A-Za-z0-9_-]{10,}/, name: 'Anthropic API key' },
    { re: /sk-[A-Za-z0-9]{20,}/, name: 'OpenAI/secret key' },
    { re: /ghp_[A-Za-z0-9]{36,}/, name: 'GitHub personal access token' },
    { re: /gho_[A-Za-z0-9]{36,}/, name: 'GitHub OAuth token' },
    { re: /github_pat_[A-Za-z0-9_]{20,}/, name: 'GitHub fine-grained PAT' },
    { re: /xoxb-[A-Za-z0-9-]+/, name: 'Slack bot token' },
    { re: /xoxp-[A-Za-z0-9-]+/, name: 'Slack user token' },
    { re: /AKIA[0-9A-Z]{16}/, name: 'AWS access key' },
    { re: /password\s*[:=]\s*['"][^'"]{8,}['"]/, name: 'Hardcoded password' },
  ];

  const evidence = [];
  const affectedFiles = new Set();

  for (const [path, content] of Object.entries(fileContents)) {
    if (isExcludedFromSecretScan(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { re, name } of secretPatterns) {
        if (re.test(lines[i])) {
          const snippet = lines[i].trim().replace(re, '***REDACTED***').slice(0, 120);
          evidence.push({ file: path, line: i + 1, snippet, reason: `Possible ${name}` });
          affectedFiles.add(path);
        }
      }
    }
  }

  if (evidence.length === 0) return null;

  return makeSuggestion({
    type: 'bug',
    category: 'security',
    priority: 'critical',
    title: 'Hardcoded secrets or API keys found in source code',
    description:
      `Found ${evidence.length} potential secret(s) committed to source code. Anyone with access to this repo can see these keys. Move them to environment variables immediately and rotate the exposed keys.`,
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Move all hardcoded secrets and API keys to environment variables. 1) Create a .env file (and .env.example with placeholder values). 2) Replace each hardcoded secret with `process.env.VARIABLE_NAME`. 3) Make sure .env is in .gitignore. 4) Rotate all exposed keys since they\'re already in git history.',
    affectedFiles: [...affectedFiles],
  });
}

// ---------------------------------------------------------------------------
// Rule 3: no-rate-limit — Express app without rate limiting
// ---------------------------------------------------------------------------
function ruleNoRateLimit({ stack, fileContents, structure, deps }) {
  const isExpress = (stack.framework && stack.framework.includes('Express')) || stack.runtime === 'node';
  if (!isExpress) return null;

  if (deps['express-rate-limit'] || deps['rate-limiter-flexible']) return null;

  for (const content of Object.values(fileContents)) {
    if (/require\(['"]express-rate-limit['"]\)|from ['"]express-rate-limit['"]/.test(content)) return null;
    if (/require\(['"]rate-limit['"]\)|from ['"]rate-limit['"]/.test(content)) return null;
  }

  const mainFile = findMainServerFile(structure, fileContents);
  const evidence = mainFile
    ? [{ file: mainFile, reason: 'Server entry point has no rate limiting middleware' }]
    : [{ file: 'package.json', reason: 'No rate limiting dependency found' }];

  return makeSuggestion({
    type: 'fix',
    category: 'security',
    priority: 'high',
    title: 'No rate limiting on API endpoints',
    description:
      'Your Express app has no rate limiting. Without it, a single user or bot can spam your API with thousands of requests, causing outages or running up your cloud bill.',
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Add express-rate-limit to protect API endpoints from abuse. Install with `npm install express-rate-limit`, then add middleware to the main server file that limits each IP to 100 requests per 15 minutes on /api/* routes. Example:\n\nconst rateLimit = require(\'express-rate-limit\');\nconst limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });\napp.use(\'/api\', limiter);',
    affectedFiles: mainFile ? [mainFile, 'package.json'] : ['package.json'],
  });
}

// ---------------------------------------------------------------------------
// Rule 4: no-helmet — Express app without helmet security headers
// ---------------------------------------------------------------------------
function ruleNoHelmet({ stack, fileContents, structure, deps }) {
  const isExpress = (stack.framework && stack.framework.includes('Express')) || stack.runtime === 'node';
  if (!isExpress) return null;

  if (deps.helmet) return null;

  for (const content of Object.values(fileContents)) {
    if (/require\(['"]helmet['"]\)|from ['"]helmet['"]/.test(content)) return null;
  }

  const mainFile = findMainServerFile(structure, fileContents);
  const evidence = mainFile
    ? [{ file: mainFile, reason: 'Server entry point does not use helmet for security headers' }]
    : [{ file: 'package.json', reason: 'helmet is not in dependencies' }];

  return makeSuggestion({
    type: 'fix',
    category: 'security',
    priority: 'high',
    title: 'No helmet security headers on Express app',
    description:
      'Your Express app isn\'t using helmet, which sets important HTTP security headers (Content-Security-Policy, X-Frame-Options, etc.). Without these, your app is more vulnerable to XSS, clickjacking, and other common attacks.',
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Add helmet to set security headers on all responses. Install with `npm install helmet`, then add it as the first middleware in your Express app:\n\nconst helmet = require(\'helmet\');\napp.use(helmet());\n\nPlace this before any route definitions.',
    affectedFiles: mainFile ? [mainFile, 'package.json'] : ['package.json'],
  });
}

// ---------------------------------------------------------------------------
// Rule 5: no-input-validation — API routes without input validation
// ---------------------------------------------------------------------------
function ruleNoInputValidation({ structure, deps }) {
  if (structure.routeFiles.length === 0) return null;

  const validationLibs = ['zod', 'joi', 'yup', 'class-validator', 'superstruct', 'valibot', 'ajv'];
  for (const lib of validationLibs) {
    if (deps[lib]) return null;
  }

  const evidence = structure.routeFiles.map((f) => ({
    file: f,
    reason: 'API route file with no input validation library in the project',
  }));

  return makeSuggestion({
    type: 'fix',
    category: 'security',
    priority: 'high',
    title: 'No input validation library for API routes',
    description:
      'Your project has API routes but no input validation library (like zod, joi, or yup). Without validation, bad or malicious input can crash your app, corrupt data, or open security holes.',
    evidence,
    effort: 'medium',
    cursorPrompt:
      'Add zod for input validation on all API routes. Install with `npm install zod`. For each route that accepts user input (POST/PUT/PATCH), define a zod schema and validate the request body:\n\nconst { z } = require(\'zod\');\n\nconst createUserSchema = z.object({\n  email: z.string().email(),\n  name: z.string().min(1).max(100),\n});\n\nrouter.post(\'/users\', (req, res) => {\n  const result = createUserSchema.safeParse(req.body);\n  if (!result.success) return res.status(400).json({ errors: result.error.flatten() });\n  // use result.data\n});',
    affectedFiles: [...structure.routeFiles, 'package.json'],
  });
}

// ---------------------------------------------------------------------------
// Rule 6: no-error-handler — Node app without global error handling
// ---------------------------------------------------------------------------
function ruleNoErrorHandler({ stack, gaps, fileContents, structure }) {
  if (gaps.errorHandling.exists) return null;
  if (stack.runtime !== 'node') return null;

  let hasExpressErrorMiddleware = false;
  for (const content of Object.values(fileContents)) {
    if (/app\.use\(\s*\(\s*err\s*,/.test(content)) {
      hasExpressErrorMiddleware = true;
      break;
    }
  }
  if (hasExpressErrorMiddleware) return null;

  const mainFile = findMainServerFile(structure, fileContents);
  const evidence = mainFile
    ? [{ file: mainFile, reason: 'No global error handling middleware found' }]
    : [{ file: 'package.json', reason: 'Node.js app with no error handling detected' }];

  return makeSuggestion({
    type: 'fix',
    category: 'errorHandling',
    priority: 'medium',
    title: 'No global error handler in the Node.js app',
    description:
      'Your app doesn\'t have a global error handler. When an unhandled error occurs, users will see a raw stack trace or the app will crash. A global handler gives users a friendly error message and logs the real problem.',
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Add a global error handling middleware to the Express app. Place this AFTER all route definitions:\n\napp.use((err, req, res, next) => {\n  console.error(\'Unhandled error:\', err);\n  const status = err.status || 500;\n  res.status(status).json({\n    error: process.env.NODE_ENV === \'production\' ? \'Internal server error\' : err.message,\n  });\n});\n\nAlso add process-level handlers:\n\nprocess.on(\'unhandledRejection\', (err) => console.error(\'Unhandled rejection:\', err));\nprocess.on(\'uncaughtException\', (err) => { console.error(\'Uncaught exception:\', err); process.exit(1); });',
    affectedFiles: mainFile ? [mainFile] : [],
  });
}

// ---------------------------------------------------------------------------
// Rule 7: no-tests — No test files in the project
// ---------------------------------------------------------------------------
function ruleNoTests({ gaps, deps }) {
  if (gaps.testing.exists) return null;

  const testLibs = ['jest', 'vitest', 'mocha', 'ava', 'playwright', 'cypress', '@playwright/test'];
  const installedTestLib = testLibs.find((lib) => deps[lib]);

  const description = installedTestLib
    ? `The test framework "${installedTestLib}" is installed but no test files exist. You\'re paying the dependency cost without getting any safety from tests.`
    : 'This project has zero tests. Even a few smoke tests for critical paths (auth, payments, data creation) can prevent embarrassing bugs from reaching users.';

  return makeSuggestion({
    type: 'fix',
    category: 'testing',
    priority: 'medium',
    title: 'No tests found in the project',
    description,
    evidence: [{ file: 'package.json', reason: installedTestLib ? `${installedTestLib} is in devDependencies but no test files exist` : 'No test framework or test files detected' }],
    effort: 'medium',
    cursorPrompt:
      'Set up a basic test suite. Install vitest (or jest) with `npm install -D vitest`, add a test script to package.json: `"test": "vitest run"`. Then create tests for the most critical paths:\n\n1. Create a `__tests__/` directory\n2. Add a smoke test for each API endpoint (does it return 200 for valid input, 400 for bad input?)\n3. Add a test for auth flow if authentication exists\n4. Add a test for the main data-creation flow\n\nStart with happy-path tests, then add edge cases.',
    affectedFiles: ['package.json'],
  });
}

// ---------------------------------------------------------------------------
// Rule 8: hardcoded-localhost — Hardcoded localhost URLs in non-config files
// ---------------------------------------------------------------------------
function ruleHardcodedLocalhost({ fileContents }) {
  const localhostPattern = /(?:localhost:\d+|127\.0\.0\.1:\d+)/;
  const evidence = [];
  const affectedFiles = new Set();

  for (const [path, content] of Object.entries(fileContents)) {
    if (isConfigOrTestFile(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!localhostPattern.test(line)) continue;

      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
      if (/process\.env\.NODE_ENV\s*[=!]==?\s*['"]dev/i.test(trimmed)) continue;
      if (/if\s*\(.*dev/i.test(trimmed)) continue;

      const snippet = trimmed.slice(0, 120);
      evidence.push({ file: path, line: i + 1, snippet, reason: 'Hardcoded localhost URL will break in production' });
      affectedFiles.add(path);
    }
  }

  if (evidence.length === 0) return null;

  return makeSuggestion({
    type: 'bug',
    category: 'deployment',
    priority: 'medium',
    title: 'Hardcoded localhost URLs found in source code',
    description:
      `Found ${evidence.length} hardcoded localhost reference(s). These will break when you deploy — your production server isn't localhost. Use environment variables for all URLs.`,
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Replace all hardcoded localhost URLs with environment variables. 1) Add a variable like `API_URL` to your .env file (e.g. `API_URL=http://localhost:3000` for dev). 2) Replace every `http://localhost:XXXX` in source code with `process.env.API_URL` (or the appropriate env var). 3) Make sure .env.example documents all URL variables. This way the URL changes automatically between dev and production.',
    affectedFiles: [...affectedFiles],
  });
}

// ---------------------------------------------------------------------------
// Rule 9: no-env-validation — Using process.env without validation
// ---------------------------------------------------------------------------
function ruleNoEnvValidation({ fileContents, deps }) {
  const envUsageFiles = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (path.endsWith('.env') || path.endsWith('.env.example') || path.endsWith('.env.sample')) continue;
    if (/process\.env\./.test(content)) {
      envUsageFiles.push(path);
    }
  }

  if (envUsageFiles.length === 0) return null;

  const validationLibs = ['envalid', '@t3-oss/env-nextjs', '@t3-oss/env-core', 'dotenv-safe'];
  for (const lib of validationLibs) {
    if (deps[lib]) return null;
  }

  // Check if zod is used specifically for env validation
  for (const [path, content] of Object.entries(fileContents)) {
    if (deps.zod && /process\.env/.test(content) && /z\.\s*object/.test(content) && /parse|safeParse/.test(content)) {
      return null;
    }
  }

  const evidence = envUsageFiles.slice(0, 10).map((f) => ({
    file: f,
    reason: 'Uses process.env without startup validation',
  }));

  return makeSuggestion({
    type: 'fix',
    category: 'envConfig',
    priority: 'medium',
    title: 'Environment variables are used without validation',
    description:
      'Your code reads from process.env in multiple files but never validates that required variables are set. If someone forgets to set a variable, the app will crash at runtime with a confusing error instead of failing fast at startup.',
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Add environment variable validation at app startup using envalid. Install with `npm install envalid`, then create a config file (e.g. `config/env.js`):\n\nconst { cleanEnv, str, port, url } = require(\'envalid\');\n\nconst env = cleanEnv(process.env, {\n  DATABASE_URL: url(),\n  PORT: port({ default: 3000 }),\n  NODE_ENV: str({ choices: [\'development\', \'production\', \'test\'] }),\n  // add all your env vars here\n});\n\nmodule.exports = env;\n\nThen import this config file instead of reading process.env directly. The app will fail immediately on startup if any required variable is missing.',
    affectedFiles: envUsageFiles,
  });
}

// ---------------------------------------------------------------------------
// Rule 10: no-health-check — No /health endpoint
// ---------------------------------------------------------------------------
function ruleNoHealthCheck({ stack, fileContents, structure }) {
  if (stack.runtime !== 'node') return null;

  for (const content of Object.values(fileContents)) {
    if (/['"`/]\/health(z)?['"`]/.test(content)) return null;
    if (/\.get\(\s*['"`]\/health/.test(content)) return null;
  }

  const mainFile = findMainServerFile(structure, fileContents);
  const evidence = mainFile
    ? [{ file: mainFile, reason: 'No /health or /healthz route found' }]
    : [{ file: 'package.json', reason: 'Node.js app with no health check endpoint' }];

  return makeSuggestion({
    type: 'fix',
    category: 'deployment',
    priority: 'medium',
    title: 'No health check endpoint for monitoring',
    description:
      'Your app has no /health endpoint. Most hosting platforms (Railway, Fly.io, AWS, etc.) use health checks to know if your app is alive. Without one, deploys may fail or your app may be silently down without anyone knowing.',
    evidence,
    effort: 'quick',
    cursorPrompt:
      'Add a /health endpoint to the Express server. This should be a simple GET route that returns 200 when the app is running:\n\nrouter.get(\'/health\', (req, res) => {\n  res.json({ status: \'ok\', timestamp: new Date().toISOString() });\n});\n\nOptionally check database connectivity too:\n\nrouter.get(\'/health\', async (req, res) => {\n  try {\n    // add a quick DB ping if you have a database\n    res.json({ status: \'ok\', timestamp: new Date().toISOString() });\n  } catch (err) {\n    res.status(503).json({ status: \'error\', message: err.message });\n  }\n});\n\nMount this at the top of your routes, before any auth middleware.',
    affectedFiles: mainFile ? [mainFile] : [],
  });
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

const ALL_RULES = [
  ruleNoRls,
  ruleEnvInCode,
  ruleNoRateLimit,
  ruleNoHelmet,
  ruleNoInputValidation,
  ruleNoErrorHandler,
  ruleNoTests,
  ruleHardcodedLocalhost,
  ruleNoEnvValidation,
  ruleNoHealthCheck,
];

function runStaticSuggestions({ stack, gaps, features, structure, fileContents, fileTree, buildPlan }) {
  const deps = getDeps(fileContents);
  const input = { stack, gaps, features, structure, fileContents, fileTree, buildPlan, deps };
  const results = [];

  for (const rule of ALL_RULES) {
    try {
      const result = rule(input);
      if (result) results.push(result);
    } catch (err) {
      console.warn(`Suggestion rule ${rule.name} failed:`, err.message);
    }
  }

  results.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

  return results;
}

// ---------------------------------------------------------------------------
// Gap-based suggestions
// ---------------------------------------------------------------------------

function runGapSuggestions({ gaps, readinessCategories, coveredCategories }) {
  const results = [];
  const cat = readinessCategories || {};
  const covered = coveredCategories || new Set();

  function add(suggestion) {
    if (covered.has(suggestion.category)) return;
    results.push(suggestion);
  }

  if (!gaps.auth?.exists && cat.auth?.status !== 'ready') {
    add(makeSuggestion({
      type: 'feature',
      category: 'auth',
      priority: 'high',
      title: 'Add user authentication',
      description:
        'Your app has no authentication. Without it, you can\'t identify users, protect personal data, or control who can do what. Auth is foundational — most features (saving preferences, user-specific data, admin tools) depend on knowing who the user is.',
      effort: 'large',
      cursorPrompt:
        'Add user authentication to this project. Recommended options depending on your stack:\n\n- **Supabase Auth** (if already using Supabase): `const { data, error } = await supabase.auth.signUp({ email, password })`. Add sign-up, login, logout, and a session check middleware.\n- **NextAuth.js** (if using Next.js): Install `next-auth`, create `pages/api/auth/[...nextauth].js`, configure at least one provider (Google, GitHub, or email).\n- **Clerk** (fastest to integrate): Install `@clerk/nextjs` or `@clerk/express`, wrap your app in `<ClerkProvider>`, and use `<SignIn />` / `<SignUp />` components.\n\nMake sure to protect API routes with an auth middleware that checks for a valid session before processing requests.',
    }));
  }

  if (!gaps.database?.exists && cat.database?.status !== 'ready') {
    add(makeSuggestion({
      type: 'feature',
      category: 'database',
      priority: 'high',
      title: 'Set up a database',
      description:
        'Your app has no database. Without one, all data is lost when the server restarts, and you can\'t support multiple users or persist anything. A database is essential for any app that stores user data, content, or state.',
      effort: 'large',
      cursorPrompt:
        'Set up a database for this project. Recommended options:\n\n- **Supabase (Postgres)**: Create a project at supabase.com, copy the connection string into `.env`, and use `@supabase/supabase-js` to read/write data. Great if you also need auth and realtime.\n- **SQLite + Prisma** (simplest for small apps): `npm install prisma @prisma/client && npx prisma init --datasource-provider sqlite`. Define your models in `prisma/schema.prisma`, then run `npx prisma db push`.\n- **Postgres + Prisma** (production-ready): Same as above but with `--datasource-provider postgresql` and a hosted Postgres URL.\n\nCreate at least one table/model for your core data entity, add CRUD operations, and wire them to your API routes.',
    }));
  }

  if (gaps.database?.exists && !gaps.database.hasSchema && cat.database?.status !== 'ready') {
    add(makeSuggestion({
      type: 'fix',
      category: 'database',
      priority: 'medium',
      title: 'Add database schema or migration files',
      description:
        'Your project uses a database but has no schema or migration files checked in. Without these, no one else can recreate your database — they\'d have to reverse-engineer it from the code. Schema files make your database reproducible and version-controlled.',
      effort: 'medium',
      cursorPrompt:
        'Add database schema and migration files to the project. If using Prisma, make sure `prisma/schema.prisma` is committed and run `npx prisma migrate dev --name init` to create migration files. If using raw SQL, create a `migrations/` folder with numbered SQL files (e.g. `001_create_users.sql`). If using Supabase, export your schema with `supabase db dump` and commit the SQL file. The goal is that anyone can run one command to set up an identical database.',
    }));
  }

  if (!gaps.deployment?.exists && cat.deployment?.status !== 'ready') {
    add(makeSuggestion({
      type: 'feature',
      category: 'deployment',
      priority: 'medium',
      title: 'Add deployment configuration',
      description:
        'Your project has no deployment config. Without it, deploying means manual steps that are easy to mess up. A deploy config file gives you one-click deploys and ensures every environment is set up the same way.',
      effort: 'medium',
      cursorPrompt:
        'Add deployment configuration to this project. Choose the best option for your stack:\n\n- **Dockerfile** (works everywhere): Create a multi-stage `Dockerfile` that installs dependencies, builds the app, and runs it. Add a `.dockerignore` for `node_modules` and `.env`.\n- **railway.json** (Railway): Create `railway.json` with `{ "build": { "builder": "nixpacks" }, "deploy": { "startCommand": "npm start" } }`.\n- **vercel.json** (Vercel, for Next.js/frontend): Create `vercel.json` with build and route settings.\n\nAlso add a `start` script to `package.json` if missing, and document the deploy process in the README.',
    }));
  }

  if (gaps.deployment?.exists && !gaps.deployment.hasCI && cat.deployment?.status !== 'ready') {
    add(makeSuggestion({
      type: 'fix',
      category: 'deployment',
      priority: 'low',
      title: 'Add CI/CD pipeline',
      description:
        'Your project has deployment config but no CI/CD pipeline. Without automated checks, broken code can be deployed directly to production. A CI pipeline runs your tests and linting on every push, catching bugs before they go live.',
      effort: 'medium',
      cursorPrompt:
        'Add a GitHub Actions CI workflow. Create `.github/workflows/ci.yml`:\n\n```yaml\nname: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n      - run: npm ci\n      - run: npm run lint --if-present\n      - run: npm test --if-present\n```\n\nThis runs on every push and PR. Add more steps as needed (type checking, build verification, deploy to staging).',
    }));
  }

  if (!gaps.permissions?.exists && cat.auth?.status !== 'ready') {
    add(makeSuggestion({
      type: 'feature',
      category: 'security',
      priority: 'medium',
      title: 'Add role-based access control',
      description:
        'Your app has no role or permission system. Without RBAC, every authenticated user has the same access level — there\'s no way to have admins, moderators, or restricted users. This becomes a security risk as soon as you need different permission levels.',
      effort: 'large',
      cursorPrompt:
        'Add role-based access control (RBAC) to the app. Steps:\n\n1. Add a `role` column to your users table (e.g. `admin`, `user`, `moderator`) with `user` as the default.\n2. Create an authorization middleware that checks the user\'s role:\n\n```js\nfunction requireRole(...roles) {\n  return (req, res, next) => {\n    if (!req.user) return res.status(401).json({ error: \'Not authenticated\' });\n    if (!roles.includes(req.user.role)) return res.status(403).json({ error: \'Insufficient permissions\' });\n    next();\n  };\n}\n```\n\n3. Protect admin routes: `router.delete(\'/users/:id\', requireRole(\'admin\'), deleteUser)`.\n4. On the frontend, conditionally render admin UI based on the user\'s role.',
    }));
  }

  if (!gaps.testing?.exists && cat.testing?.status !== 'ready') {
    add(makeSuggestion({
      type: 'fix',
      category: 'testing',
      priority: 'medium',
      title: 'Add automated tests',
      description:
        'Your project has no test files. Without tests, every code change is a gamble — you won\'t know if something broke until a user reports it. Even a handful of tests for critical flows dramatically reduces the risk of shipping bugs.',
      effort: 'medium',
      cursorPrompt:
        'Set up automated testing with vitest (fast, modern, works with ESM and CJS). Install: `npm install -D vitest`. Add to `package.json` scripts: `"test": "vitest run"`. Create your first tests:\n\n1. `tests/api.test.js` — smoke-test each API endpoint with supertest (`npm install -D supertest`)\n2. `tests/utils.test.js` — unit-test any pure utility functions\n3. Focus on the critical user flows first: can a user sign up, create data, and retrieve it?\n\nRun with `npm test` and add to CI.',
    }));
  }

  if (!gaps.errorHandling?.exists && cat.errorHandling?.status !== 'ready') {
    add(makeSuggestion({
      type: 'fix',
      category: 'errorHandling',
      priority: 'medium',
      title: 'Add global error handling',
      description:
        'Your app has no centralized error handling. When something goes wrong, users see cryptic stack traces or the app crashes silently. A global error handler catches all unexpected errors, returns user-friendly messages, and logs the details for debugging.',
      effort: 'quick',
      cursorPrompt:
        'Add global error handling to the Express app. Place this after all route definitions:\n\n```js\napp.use((err, req, res, next) => {\n  console.error(err.stack);\n  res.status(err.status || 500).json({\n    error: process.env.NODE_ENV === \'production\' ? \'Something went wrong\' : err.message,\n  });\n});\n```\n\nAlso add process-level handlers at the top of your entry file:\n\n```js\nprocess.on(\'unhandledRejection\', (err) => console.error(\'Unhandled rejection:\', err));\nprocess.on(\'uncaughtException\', (err) => { console.error(\'Uncaught exception:\', err); process.exit(1); });\n```',
    }));
  }

  if (!gaps.envConfig?.exists && cat.envConfig?.status !== 'ready') {
    add(makeSuggestion({
      type: 'fix',
      category: 'envConfig',
      priority: 'medium',
      title: 'Create .env.example for environment variables',
      description:
        'Your project has no .env.example file. Without it, new developers (or your future self) have to guess which environment variables are needed and what format they should be in. A .env.example documents every required variable with placeholder values.',
      effort: 'quick',
      cursorPrompt:
        'Create a `.env.example` file that documents all required environment variables. Look through the codebase for every `process.env.VARIABLE_NAME` reference, then list them all:\n\n```\n# Server\nPORT=3000\nNODE_ENV=development\n\n# Database\nDATABASE_URL=postgresql://user:password@localhost:5432/mydb\n\n# Auth (replace with real values)\nJWT_SECRET=your-secret-here\n\n# External APIs\nAPI_KEY=your-api-key-here\n```\n\nUse descriptive placeholder values so developers know the expected format. Add a note in README about copying this file to `.env`.',
    }));
  }

  if (cat.frontend?.status === 'missing') {
    add(makeSuggestion({
      type: 'feature',
      category: 'frontend',
      priority: 'medium',
      title: 'Add a user interface',
      description:
        'Your project has no frontend. Without a UI, users have to interact with your app through raw API calls or the command line. A frontend makes your app accessible, usable, and ready to show to others.',
      effort: 'large',
      cursorPrompt:
        'Scaffold a frontend for this project. Recommended approach:\n\n1. Create a React app with Vite: `npm create vite@latest client -- --template react-ts && cd client && npm install`\n2. Install Tailwind CSS for styling: `npm install -D tailwindcss @tailwindcss/vite` and configure it.\n3. Set up a basic layout with a header, main content area, and navigation.\n4. Create pages for the core user flows (e.g. Home, Dashboard, Settings).\n5. Add an API service layer (`src/services/api.ts`) that calls your backend endpoints.\n6. Add a proxy in `vite.config.ts` to forward `/api` requests to your backend during development.\n\nStart with the most important user-facing page and iterate from there.',
    }));
  }

  if (cat.backend?.status === 'missing') {
    add(makeSuggestion({
      type: 'feature',
      category: 'backend',
      priority: 'medium',
      title: 'Add a backend API',
      description:
        'Your project has no backend server. Without one, there\'s nowhere to run business logic, process data securely, or connect to databases and external services. A backend API is the foundation for any app that needs to store data or perform server-side operations.',
      effort: 'large',
      cursorPrompt:
        'Create an Express backend API. Steps:\n\n1. Initialize: `mkdir server && cd server && npm init -y && npm install express cors dotenv`\n2. Create `server/index.js`:\n\n```js\nconst express = require(\'express\');\nconst cors = require(\'cors\');\nrequire(\'dotenv\').config();\n\nconst app = express();\napp.use(cors());\napp.use(express.json());\n\napp.get(\'/api/health\', (req, res) => res.json({ status: \'ok\' }));\n\nconst PORT = process.env.PORT || 3001;\napp.listen(PORT, () => console.log(`Server running on port ${PORT}`));\n```\n\n3. Add route files in `server/routes/` for each resource.\n4. Add error handling middleware.\n5. Add `"start": "node index.js"` and `"dev": "node --watch index.js"` scripts to package.json.',
    }));
  }

  results.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

  return results;
}

module.exports = { runStaticSuggestions, runGapSuggestions };
