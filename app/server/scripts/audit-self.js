#!/usr/bin/env node
/**
 * Offline self-audit. Walks the local working tree, runs the same scanner +
 * stack/gap/feature detection + readiness scorer that the Takeoff pipeline
 * uses, then prints a summary.
 *
 * Usage:
 *   node app/server/scripts/audit-self.js                   # audit repo root
 *   node app/server/scripts/audit-self.js path/to/repo      # audit any path
 *   node app/server/scripts/audit-self.js --strict          # exit 1 if any
 *                                                            archive paths
 *                                                            leak through
 *
 * Exit codes:
 *   0  audit completed (and, in --strict mode, no archive leaks)
 *   1  --strict and at least one archive path leaked into the live tree
 *   2  unexpected runtime error
 *
 * No network, no DB, no LLM calls.
 */

const fs = require('fs');
const path = require('path');

const {
  analyzeFromFiles,
  shouldSkipFile,
  isArchivedPath,
} = require('../services/analyzer');
const { scoreReadiness } = require('../services/readiness-scorer');
const { detectBuildPlan } = require('../services/build-detector');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const STRICT = flags.has('--strict');
const ROOT = path.resolve(args[0] || path.join(__dirname, '..', '..', '..'));

const MAX_FILE_BYTES = 256 * 1024;

// Build-tooling directories the walker should never descend into. Mirrors
// SKIP_DIRS in analyzer.js. Listed here too so we don't read 100s of MB of
// `node_modules/` into memory before filtering.
const WALK_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.cache', 'coverage', '.turbo', '.vercel', 'vendor',
  '.svelte-kit', 'target', 'out', '.expo', 'archive',
]);

// Dotfiles we *do* care about even though they start with `.`.
const ALLOWED_DOTFILES = new Set([
  '.env.example', '.cursorrules', '.context.md',
  '.github', '.dockerignore', '.gitignore',
]);

// Binary / lockfile extensions. The analyzer already skips these via
// shouldSkipFile, but we filter pre-read to avoid reading them into memory
// only to throw the bytes away.
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
]);

function isBinaryName(name) {
  if (name.endsWith('.lock')) return true;
  if (name.endsWith('.min.js') || name.endsWith('.min.css')) return true;
  if (name.endsWith('.map')) return true;
  const ext = name.split('.').pop()?.toLowerCase();
  return !!ext && BINARY_EXTS.has(ext);
}

function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && !ALLOWED_DOTFILES.has(entry.name)) continue;
    if (WALK_SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');

    // Use the analyzer's archive matcher so the walker stays in sync with
    // the scanner. Skipping at directory level prevents wasteful I/O on
    // large archive trees.
    if (entry.isDirectory() && isArchivedPath(rel)) continue;

    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile()) {
      if (isBinaryName(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(full, 'utf-8');
        out.push({ path: rel, content });
      } catch {
        // unreadable / disappeared — skip
      }
    }
  }
  return out;
}

(async () => {
  console.log(`\n[audit-self] walking ${ROOT}${STRICT ? ' (--strict)' : ''}`);
  const allEntries = walk(ROOT);
  console.log(`[audit-self] discovered ${allEntries.length} candidate files`);

  const skipped = allEntries.filter((f) => shouldSkipFile(f.path));
  console.log(`[audit-self] scanner will skip ${skipped.length} files (binary/lock/archive/etc.)`);

  const codebaseModel = await analyzeFromFiles(allEntries, path.basename(ROOT), null, null);

  const buildPlan = detectBuildPlan({
    stack: codebaseModel.stack,
    fileTree: codebaseModel.fileTree,
    fileContents: codebaseModel.fileContents,
    deployInfo: codebaseModel.deployInfo,
  });

  const readiness = scoreReadiness({
    gaps: codebaseModel.gaps,
    stack: codebaseModel.stack,
    fileTree: codebaseModel.fileTree,
    features: codebaseModel.features,
    deployInfo: codebaseModel.deployInfo,
    buildPlan,
  });

  console.log('\n=== AUDIT RESULTS ===');
  console.log(`Files in tree (post-skip): ${codebaseModel.fileTree.length}`);
  console.log(`Modules (top-level features): ${codebaseModel.features.length}`);
  console.log('Module names:');
  for (const f of codebaseModel.features) {
    console.log(`  - ${f.name}  (${f.fileCount} files${f.hasUI ? ', UI' : ''}${f.hasAPI ? ', API' : ''})`);
  }

  console.log(`\nReadiness score: ${readiness.score}/100  (${readiness.recommendation})`);
  console.log('Categories:');
  for (const [key, cat] of Object.entries(readiness.categories)) {
    console.log(`  ${key.padEnd(15)} ${String(cat.score).padStart(3)}/100  ${cat.status.padEnd(8)} ${cat.detail}`);
  }

  // Use the analyzer's archive matcher (single source of truth) so this
  // counter cannot drift from the scanner's actual behavior.
  const archiveLeaks = codebaseModel.fileTree.filter((p) => isArchivedPath(p));
  console.log(`\nArchive paths still surfaced as live: ${archiveLeaks.length}`);
  if (archiveLeaks.length > 0) {
    console.log('  Examples:');
    archiveLeaks.slice(0, 5).forEach((p) => console.log(`   - ${p}`));
  }

  if (STRICT && archiveLeaks.length > 0) {
    console.error(`\n[audit-self] FAIL — ${archiveLeaks.length} archive path(s) leaked into the live tree (--strict).`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('[audit-self] failed:', err);
  process.exit(2);
});
