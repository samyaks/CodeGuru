/**
 * dotenv-committed — flag .env / .env.local / .env.production files
 * that exist in the repo tree and are NOT covered by .gitignore.
 *
 * Why this is separate from `exposed-secrets`: that detector scans
 * file CONTENTS for known key shapes. This one scans the file TREE
 * for canonical secret-bearing filenames. The two cover different
 * failure modes:
 *   - exposed-secrets catches "I pasted my key into config.ts"
 *   - dotenv-committed catches "I committed the entire .env file"
 *
 * The check has two layers, AND-ed together:
 *   1. The file is in the analyzer's visible file tree (we know it
 *      shipped to GitHub because the analyzer reads via the contents
 *      API). The analyzer skips binary blobs but NOT .env files.
 *   2. The file's path is not matched by any pattern in .gitignore.
 *      If .gitignore excludes the file, the file in the tree is a
 *      historical leak (still bad — git history retains it — but a
 *      different conversation) so we still flag it; just at lower
 *      severity than a currently-untracked .env.
 *
 * Severity: critical for files we're confident contain real
 * environment values (`.env`, `.env.local`, `.env.production`).
 * Allowlisted: `.env.example`, `.env.sample`, `.env.template` — those
 * are intentional, public, and should NOT trigger a finding.
 *
 * CWE-200: Exposure of Sensitive Information to an Unauthorized Actor.
 */

const NAME = 'dotenv-committed';

const SECRET_BEARING = [
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.staging',
  '.env.test',
];

const ALLOWED = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
]);

// Compile a single .gitignore line. Subset of git's pattern syntax —
// enough to validate "is this file currently ignored?" against
// patterns like `.env`, `.env*`, `*.env.local`, `/secrets/.env`. Not a
// full reimplementation of pathspec.
function compileGitignorePattern(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (trimmed.startsWith('!')) return null; // negation; ignore for our use case

  let pat = trimmed;
  const anchored = pat.startsWith('/');
  if (anchored) pat = pat.slice(1);
  if (pat.endsWith('/')) pat = pat.slice(0, -1);

  let body = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') { body += '.*'; i += 1; }
      else { body += '[^/]*'; }
    } else if (c === '?') body += '[^/]';
    else if (/[.+^${}()|[\]\\]/.test(c)) body += '\\' + c;
    else body += c;
  }
  const re = anchored ? `^${body}$` : `^(?:.*/)?${body}$`;
  try { return new RegExp(re); } catch { return null; }
}

function isIgnored(path, patterns) {
  for (const re of patterns) {
    if (re.test(path)) return true;
  }
  return false;
}

function basename(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

async function run({ fileTree, fileContents }) {
  const tree = Array.isArray(fileTree) ? fileTree : [];
  if (tree.length === 0) return [];

  const gitignore = (fileContents && fileContents['.gitignore']) || '';
  const ignorePatterns = String(gitignore)
    .split('\n')
    .map(compileGitignorePattern)
    .filter(Boolean);

  const findings = [];
  for (const path of tree) {
    const base = basename(path);
    if (ALLOWED.has(base)) continue;
    if (!SECRET_BEARING.includes(base)) continue;

    const ignored = isIgnored(path, ignorePatterns);

    findings.push({
      file: path,
      line: 1,
      severity: 'critical',
      cweId: 'CWE-200',
      title: `Secret-bearing config file committed: ${path}`,
      description:
        `A canonical secret-bearing file ("${base}") is present in the repository tree. ` +
        (ignored
          ? `It is currently in .gitignore — meaning it was committed at some point in history but is now ignored. ` +
            `That's better than nothing, but git history still contains the credentials. ` +
            `Rotate any keys it ever held, scrub the file from history (BFG / git-filter-repo), and re-push.`
          : `It is NOT in .gitignore. Every key, password, and token in this file is visible to anyone with read access. ` +
            `Rotate every credential immediately, add the file to .gitignore, remove it with \`git rm --cached\`, and force-push if this is a private repo (or scrub history if public).`),
      evidence: [{
        file: path,
        reason: ignored
          ? 'Secret-bearing file in tree (currently gitignored — historical leak)'
          : 'Secret-bearing file in tree and NOT in .gitignore',
      }],
    });
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'critical',
  cweId: 'CWE-200',
  run,
};
