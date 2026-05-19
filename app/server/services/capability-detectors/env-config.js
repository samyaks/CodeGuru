/**
 * envConfig — does this repo have documented environment configuration?
 *
 * The healthy signal is an `.env.example` (or `.env.sample` /
 * `.env.template`) file checked into the repo. That tells future
 * contributors which env vars they need to set without leaking secrets.
 *
 * `dotenv` / `envalid` / `zod` (used near `process.env`) are weaker
 * signals — the project uses env vars at runtime but may not document them.
 *
 * Legacy gap shape: { exists, hasExample, missingVars } — preserved via
 * `extra`. `missingVars` stays empty in Phase 2; a real diff between
 * documented env keys and ones referenced in code is a Phase 3 task.
 */

const NAME = 'envConfig';

// Anchored to the basename: match `.env.example` whether it lives at the
// repo root or under a sub-package (e.g. `app/.env.example` in a monorepo).
const STRONG_EXAMPLE_PATTERNS = [
  /(?:^|\/)\.env\.example$/,
  /(?:^|\/)env\.example$/,
];

const WEAK_EXAMPLE_PATTERNS = [
  /(?:^|\/)\.env\.sample$/,
  /(?:^|\/)\.env\.template$/,
];

const ENV_LIB_DEPS = [
  'dotenv', 'dotenv-flow',
  '@t3-oss/env-nextjs',
  'envalid',
];

const STRONG_SIGNAL = 0.9;
const WEAK_SIGNAL = 0.8;
const LIB_SIGNAL = 0.5;

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function combine(signals) {
  let inv = 1;
  for (const s of signals) inv *= (1 - s);
  return 1 - inv;
}

function hasMatchingPath(files, patterns) {
  return files.some((f) => patterns.some((re) => re.test(f.path)));
}

function zodUsedWithProcessEnv(fileContents) {
  for (const content of Object.values(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!content.includes('process.env')) continue;
    if (/\bfrom\s+['"]zod['"]|\brequire\s*\(\s*['"]zod['"]\s*\)/.test(content)) {
      return true;
    }
  }
  return false;
}

async function run({ files = [], fileContents = {} } = {}) {
  const evidence = [];
  const signals = [];

  const strongMatch = files.find((f) => STRONG_EXAMPLE_PATTERNS.some((re) => re.test(f.path)));
  const weakMatch = !strongMatch
    ? files.find((f) => WEAK_EXAMPLE_PATTERNS.some((re) => re.test(f.path)))
    : null;

  if (strongMatch) {
    signals.push(STRONG_SIGNAL);
    evidence.push({ file: strongMatch.path, reason: 'env example file' });
  } else if (weakMatch) {
    signals.push(WEAK_SIGNAL);
    evidence.push({ file: weakMatch.path, reason: 'env sample/template file' });
  }

  const hasExample = !!strongMatch || !!weakMatch;

  const pkg = safeJson(fileContents['package.json']);
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const libHits = ENV_LIB_DEPS.filter((name) => deps[name]);
    if (libHits.length > 0) {
      signals.push(LIB_SIGNAL);
      for (const name of libHits) {
        evidence.push({ file: 'package.json', reason: `declares ${name}` });
      }
    }
    if (deps['zod'] && zodUsedWithProcessEnv(fileContents)) {
      signals.push(LIB_SIGNAL);
      evidence.push({ file: 'package.json', reason: 'zod used near process.env' });
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
    extra: { hasExample, missingVars: [] },
  };
}

module.exports = { name: NAME, run };
