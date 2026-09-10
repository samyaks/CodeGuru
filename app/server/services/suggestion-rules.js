const crypto = require('crypto');

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function makeId(type, category, title) {
  return crypto.createHash('sha256').update(type + category + title).digest('hex').slice(0, 16);
}

function citeEvidence(evidence, max = 4) {
  const items = [];
  const seen = new Set();
  for (const e of evidence || []) {
    if (!e || !e.file) continue;
    const loc = e.line ? `${e.file}:${e.line}` : e.file;
    if (seen.has(loc)) continue;
    seen.add(loc);
    items.push(loc);
  }
  if (items.length === 0) return '';
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} (+${extra} more)` : shown.join(', ');
}

function makeSuggestion({ type, category, priority, title, description, evidence, effort, affectedFiles }) {
  const cited = citeEvidence(evidence);
  const groundedDescription = cited
    ? `${String(description || '').replace(/\s+$/, '')} Seen in ${cited}.`
    : description;
  return {
    id: makeId(type, category, title),
    type,
    category,
    priority,
    title,
    description: groundedDescription,
    evidence: evidence || [],
    effort: effort || 'medium',
    // Grounded Cursor prompts are generated on Accept from this
    // evidence — never ship canned tutorials here.
    cursor_prompt: null,
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

function isNonRuntimeFile(path) {
  const lower = path.toLowerCase();
  return isConfigOrTestFile(path)
    || /\.(md|mdx|txt|yml|yaml|html|css|svg)$/.test(lower)
    || lower.includes('.github/')
    || lower.includes('/docs/')
    || lower.startsWith('docs/')
    || lower.endsWith('.example');
}

function isEnvBackedOrDevGated(line) {
  const t = line.trim();
  if (/process\.env\./.test(t)) return true;
  if (/import\.meta\.env/.test(t)) return true;
  if (/\bNODE_ENV\b/.test(t)) return true;
  if (/\|\|\s*['"`]https?:\/\/(localhost|127\.0\.0\.1)/.test(t)) return true;
  if (/\?\s*['"`]https?:\/\/(localhost|127\.0\.0\.1)/.test(t)) return true;
  return false;
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

  const routeFiles = structure.routeFiles;
  const evidence = routeFiles.map((f) => ({
    file: f,
    reason: 'API route file with no input validation library in the project',
  }));


  return makeSuggestion({
    type: 'fix',
    category: 'security',
    priority: 'high',
    title: 'No input validation library for API routes',
    description:
      'Your project has API routes but no input validation library (like zod, joi, or yup). Without validation, bad or malicious input from req.body, req.query, or req.params can crash your app, corrupt data, or open security holes.',
    evidence,
    effort: 'medium',
    affectedFiles: [...routeFiles, 'package.json'],
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
    if (isNonRuntimeFile(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!localhostPattern.test(line)) continue;

      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
      if (isEnvBackedOrDevGated(trimmed)) continue;

      const snippet = trimmed.slice(0, 120);
      evidence.push({
        file: path,
        line: i + 1,
        snippet,
        reason: 'Hardcoded localhost URL is not read from an environment variable',
      });
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
      `Found ${evidence.length} hardcoded localhost reference(s) that are not behind an environment variable. These will break when you deploy because production is not localhost.`,
    evidence,
    effort: 'quick',
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

const STATIC_RULE_GAP_KEYS = {
  ruleNoTests: 'testing',
  ruleNoErrorHandler: 'errorHandling',
  ruleNoEnvValidation: 'envConfig',
};

function runGapSuggestions({ gaps, readinessCategories, coveredGapKeys }) {
  const results = [];
  const cat = readinessCategories || {};
  const covered = coveredGapKeys || new Set();

  function add(gapKey, suggestion) {
    if (covered.has(gapKey)) return;
    results.push(suggestion);
  }

  if (!gaps.auth?.exists && cat.auth?.status !== 'ready') {
    add('auth', makeSuggestion({
      type: 'feature',
      category: 'auth',
      priority: 'high',
      title: 'Add user authentication',
      description:
        'Your app has no authentication. Without it, you can\'t identify users, protect personal data, or control who can do what. Auth is foundational — most features (saving preferences, user-specific data, admin tools) depend on knowing who the user is.',
      effort: 'large',
    }));
  }

  if (!gaps.database?.exists && cat.database?.status !== 'ready') {
    add('database', makeSuggestion({
      type: 'feature',
      category: 'database',
      priority: 'high',
      title: 'Set up a database',
      description:
        'Your app has no database. Without one, all data is lost when the server restarts, and you can\'t support multiple users or persist anything. A database is essential for any app that stores user data, content, or state.',
      effort: 'large',
    }));
  }

  if (gaps.database?.exists && !gaps.database.hasSchema && cat.database?.status !== 'ready') {
    add('database.schema', makeSuggestion({
      type: 'fix',
      category: 'database',
      priority: 'medium',
      title: 'Add database schema or migration files',
      description:
        'Your project uses a database but has no schema or migration files checked in. Without these, no one else can recreate your database — they\'d have to reverse-engineer it from the code. Schema files make your database reproducible and version-controlled.',
      effort: 'medium',
    }));
  }

  if (!gaps.deployment?.exists && cat.deployment?.status !== 'ready') {
    add('deployment', makeSuggestion({
      type: 'feature',
      category: 'deployment',
      priority: 'medium',
      title: 'Add deployment configuration',
      description:
        'Your project has no deployment config. Without it, deploying means manual steps that are easy to mess up. A deploy config file gives you one-click deploys and ensures every environment is set up the same way.',
      effort: 'medium',
    }));
  }

  if (gaps.deployment?.exists && !gaps.deployment.hasCI && cat.deployment?.status !== 'ready') {
    add('deployment.ci', makeSuggestion({
      type: 'fix',
      category: 'deployment',
      priority: 'low',
      title: 'Add CI/CD pipeline',
      description:
        'Your project has deployment config but no CI/CD pipeline. Without automated checks, broken code can be deployed directly to production. A CI pipeline runs your tests and linting on every push, catching bugs before they go live.',
      effort: 'medium',
    }));
  }

  if (!gaps.permissions?.exists && cat.auth?.status !== 'ready') {
    add('permissions', makeSuggestion({
      type: 'feature',
      category: 'security',
      priority: 'medium',
      title: 'Add role-based access control',
      description:
        'Your app has no role or permission system. Without RBAC, every authenticated user has the same access level — there\'s no way to have admins, moderators, or restricted users. This becomes a security risk as soon as you need different permission levels.',
      effort: 'large',
    }));
  }

  if (!gaps.testing?.exists && cat.testing?.status !== 'ready') {
    add('testing', makeSuggestion({
      type: 'fix',
      category: 'testing',
      priority: 'medium',
      title: 'Add automated tests',
      description:
        'Your project has no test files. Without tests, every code change is a gamble — you won\'t know if something broke until a user reports it. Even a handful of tests for critical flows dramatically reduces the risk of shipping bugs.',
      effort: 'medium',
    }));
  }

  if (!gaps.errorHandling?.exists && cat.errorHandling?.status !== 'ready') {
    add('errorHandling', makeSuggestion({
      type: 'fix',
      category: 'errorHandling',
      priority: 'medium',
      title: 'Add global error handling',
      description:
        'Your app has no centralized error handling. When something goes wrong, users see cryptic stack traces or the app crashes silently. A global error handler catches all unexpected errors, returns user-friendly messages, and logs the details for debugging.',
      effort: 'quick',
    }));
  }

  if (!gaps.envConfig?.exists && cat.envConfig?.status !== 'ready') {
    add('envConfig', makeSuggestion({
      type: 'fix',
      category: 'envConfig',
      priority: 'medium',
      title: 'Create .env.example for environment variables',
      description:
        'Your project has no .env.example file. Without it, new developers (or your future self) have to guess which environment variables are needed and what format they should be in. A .env.example documents every required variable with placeholder values.',
      effort: 'quick',
    }));
  }

  if (cat.frontend?.status === 'missing') {
    add('frontend', makeSuggestion({
      type: 'feature',
      category: 'frontend',
      priority: 'medium',
      title: 'Add a user interface',
      description:
        'Your project has no frontend. Without a UI, users have to interact with your app through raw API calls or the command line. A frontend makes your app accessible, usable, and ready to show to others.',
      effort: 'large',
    }));
  }

  if (cat.backend?.status === 'missing') {
    add('backend', makeSuggestion({
      type: 'feature',
      category: 'backend',
      priority: 'medium',
      title: 'Add a backend API',
      description:
        'Your project has no backend server. Without one, there\'s nowhere to run business logic, process data securely, or connect to databases and external services. A backend API is the foundation for any app that needs to store data or perform server-side operations.',
      effort: 'large',
    }));
  }

  results.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

  return results;
}

module.exports = { runStaticSuggestions, runGapSuggestions, STATIC_RULE_GAP_KEYS };
