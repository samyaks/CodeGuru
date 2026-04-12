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

module.exports = { runStaticSuggestions };
