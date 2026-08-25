const github = require('./github');
const { detectDeploymentFiles } = require('./deployment');
const { analyses, analysisFiles, analysisEvents } = require('../lib/db');
const { estimateTokens, extractSkeleton, inferLanguage, computeDepth } = require('../lib/capture-utils');
const { runAllDetectors } = require('./capability-detectors');
const { computeImportGraph } = require('./import-graph');
const { extractStructureAnchors } = require('./structure-extractor');

// Deterministic structure extraction. Wrapped so a parser failure can never
// break an analysis — a missing/empty anchor list is always acceptable.
function safeStructureAnchors(fileContents, fileTree) {
  try {
    return extractStructureAnchors(fileContents, fileTree);
  } catch (err) {
    console.error('[analyzer] extractStructureAnchors failed:', err?.message || err);
    return [];
  }
}

const MAX_FILES_TO_READ = parseInt(process.env.MAX_FILES_TO_READ, 10) || 150;
const CAPTURE_FULL_TIER_LIMIT = parseInt(process.env.CAPTURE_FULL_TIER_LIMIT, 10) || 50;
const CAPTURE_SKELETON_TIER_LIMIT = parseInt(process.env.CAPTURE_SKELETON_TIER_LIMIT, 10) || 300;
const CAPTURE_MAX_FILE_BYTES = parseInt(process.env.CAPTURE_MAX_FILE_BYTES, 10) || 256000;

function camelRollups(r) {
  if (!r) return {};
  return {
    ingestedFileCount: r.ingested_file_count ?? 0,
    ingestedBytes: r.ingested_bytes ?? 0,
    ingestedTokens: r.ingested_tokens ?? 0,
  };
}

// File-ticker payload for the takeoff progress screen. `paths` are the
// files in this tick (a GitHub fetch batch, or a slice of an upload);
// the client concatenates them into a scrolling list. Counts let the
// UI show "12 of 150" without parsing the message string.
function readingProgress({ paths, readCount, totalToRead, rollups, starting = false }) {
  return {
    phase: 'reading',
    message: starting
      ? `Reading ${totalToRead} key files...`
      : `Read ${readCount}/${totalToRead} files...`,
    paths: paths || [],
    readCount: readCount ?? 0,
    totalToRead,
    ...camelRollups(rollups),
  };
}

function decideTier(sizeBytes, rankIdx1Based) {
  if (sizeBytes > CAPTURE_MAX_FILE_BYTES) return 'chunked';
  if (rankIdx1Based <= CAPTURE_FULL_TIER_LIMIT) return 'full';
  if (rankIdx1Based <= CAPTURE_SKELETON_TIER_LIMIT) return 'skeleton';
  return null;
}

async function safeDb(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[analyzer:capture] ${label} failed:`, err?.message || err);
    return null;
  }
}

const PRIORITY_FILES = [
  /^package\.json$/,
  /^requirements\.txt$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^pyproject\.toml$/,
  /^pom\.xml$/,
  /^\.env\.example$/,
  /^env\.example$/,
  /^README\.md$/i,
  /^\.cursorrules$/,
  /^CLAUDE\.md$/i,
  /^\.context\.md$/,
  /^\.scanignore$/,
  /next\.config\./,
  /nuxt\.config\./,
  /vite\.config\./,
  /vue\.config\./,
  /angular\.json$/,
  /svelte\.config\./,
  /tailwind\.config\./,
  /tsconfig\.json$/,
  /docker-compose\.ya?ml$/,
  /Dockerfile$/,
  /vercel\.json$/,
  /netlify\.toml$/,
  /fly\.toml$/,
  /firebase\.json$/,
];

const PRIORITY_PATH_PATTERNS = [
  /prisma\/schema\.prisma$/,
  /drizzle\.config\./,
  /(?:^|\/)schema\./,
  /(?:^|\/)migrations?\//,
  /(?:^|\/)models?\//,
  /(?:^|\/)routes?\//,
  /(?:^|\/)api\//,
  /(?:^|\/)middleware/,
  /(?:^|\/)auth/,
  /(?:^|\/)login/,
  /(?:^|\/)signup/,
  /(?:^|\/)session/,
  /(?:^|\/)layout\.(tsx?|jsx?)$/,
  /(?:^|\/)page\.(tsx?|jsx?)$/,
  /(?:^|\/)app\.(tsx?|jsx?|js)$/,
  /(?:^|\/)server\.(tsx?|jsx?|js)$/,
  /(?:^|\/)index\.(tsx?|jsx?|js)$/,
];

// Build artifacts and tooling directories. Always skipped — these are never
// part of source code regardless of repo conventions.
//
// `archive` is included so retired-but-tracked code (e.g. anything moved to
// `archive/` during the v2 migration) doesn't show up in module counts or
// readiness scores.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.cache', 'coverage', '.turbo', '.vercel', 'vendor',
  '.svelte-kit', 'target', 'out', '.expo', 'archive',
]);

// Archived / legacy directory-name pattern. Any path *segment* matching this
// regex is treated as archived. Examples that match: `_archived`, `archived`,
// `_archived-2024`, `legacy`, `legacy-old`, `_legacy`, `deprecated_v1`.
//
// Conservative on purpose: a segment named `archive` (without the `d`) is NOT
// matched, because that's a common feature name (e.g. "archive a project").
// Likewise `legacy.js` (a file) and `legacydata` (no separator) are not
// matched — only segments that start with `archived|legacy|_legacy|deprecated`
// followed by end-of-segment or a `[-_]` separator.
const ARCHIVED_SEGMENT_RE = /^(?:_?archived|_?legacy|deprecated)(?:[-_].*)?$/i;

// Escape hatch: set CODEGURU_INCLUDE_ARCHIVED=1 to disable the archive filter.
// Use this when analyzing a repo whose `legacy/` directory contains live code
// that the user genuinely wants reflected in their readiness score.
const INCLUDE_ARCHIVED = process.env.CODEGURU_INCLUDE_ARCHIVED === '1';

const SKIP_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'lock', 'map', 'min.js', 'min.css',
]);

function isArchivedPath(filePath) {
  if (INCLUDE_ARCHIVED) return false;
  const parts = filePath.split('/');
  for (const part of parts) {
    if (ARCHIVED_SEGMENT_RE.test(part)) return true;
  }
  return false;
}

// Compile a single `.scanignore` line into a regex. Supports `*` (any
// characters except `/`), `**` (any characters including `/`), and
// directory-suffix patterns ending in `/`. Lines starting with `#` and
// blank lines are dropped by the caller.
function compileIgnorePattern(raw) {
  const pattern = raw.trim();
  if (!pattern) return null;

  const isDir = pattern.endsWith('/');
  const stripped = isDir ? pattern.slice(0, -1) : pattern;

  let escaped = '';
  let i = 0;
  while (i < stripped.length) {
    const c = stripped[i];
    if (c === '*') {
      if (stripped[i + 1] === '*') {
        escaped += '.*';
        i += 2;
      } else {
        escaped += '[^/]*';
        i += 1;
      }
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      escaped += '\\' + c;
      i += 1;
    } else {
      escaped += c;
      i += 1;
    }
  }

  // Match either the exact path or the directory prefix (so `archive/` matches
  // every file under it).
  const body = isDir ? `${escaped}(/.*)?` : escaped;
  // Allow the pattern to match at any depth if it doesn't already start with a
  // slash or `**/`.
  const anchored = stripped.startsWith('/') ? `^${body.slice(2)}$` : `^(.*/)?${body}$`;
  try {
    return new RegExp(anchored);
  } catch {
    return null;
  }
}

function parseScanIgnore(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(compileIgnorePattern)
    .filter(Boolean);
}

async function loadScanIgnorePatterns(owner, repo, branch, tree) {
  const entry = tree.find((f) => f.type === 'blob' && f.path === '.scanignore');
  if (!entry) return [];
  try {
    const r = await github.fetchFileContent(owner, repo, '.scanignore', branch);
    if (!r || !r.content) return [];
    return parseScanIgnore(r.content);
  } catch {
    return [];
  }
}

function shouldSkipFile(filePath, extraPatterns = []) {
  const parts = filePath.split('/');
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }
  if (isArchivedPath(filePath)) return true;
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext && SKIP_EXTENSIONS.has(ext)) return true;
  if (filePath.endsWith('.lock')) return true;
  if (filePath.endsWith('.min.js') || filePath.endsWith('.min.css')) return true;
  for (const re of extraPatterns) {
    if (re.test(filePath)) return true;
  }
  return false;
}

function scorePath(filePath) {
  const name = filePath.split('/').pop();
  for (const re of PRIORITY_FILES) {
    if (re.test(name)) return 100;
  }
  for (const re of PRIORITY_PATH_PATTERNS) {
    if (re.test(filePath)) return 50;
  }
  const depth = filePath.split('/').length;
  if (depth <= 2) return 20;
  if (depth <= 3) return 10;
  return 1;
}

async function analyzeRepo(repoUrl, onProgress, analysisId = null) {
  const { owner, repo } = github.parseRepoUrl(repoUrl);
  const send = onProgress || (() => {});

  send({ phase: 'meta', message: `Fetching metadata for ${owner}/${repo}...` });
  const repoMeta = await github.fetchRepoMeta(owner, repo);

  const branch = repoMeta.default_branch || 'main';
  send({ phase: 'tree', message: `Reading file tree (branch: ${branch})...` });

  let tree;
  try {
    tree = await github.fetchRepoTree(owner, repo, branch);
  } catch {
    const fallback = branch === 'main' ? 'master' : 'main';
    tree = await github.fetchRepoTree(owner, repo, fallback);
  }

  const treeTruncated = !!tree._truncated;

  const extraIgnore = await loadScanIgnorePatterns(owner, repo, branch, tree);
  const allFiles = tree.filter((f) => f.type === 'blob' && !shouldSkipFile(f.path, extraIgnore));
  send({ phase: 'tree-done', message: `Found ${allFiles.length} files`, fileCount: allFiles.length });

  const sorted = allFiles
    .map((f) => ({ ...f, score: scorePath(f.path) }))
    .sort((a, b) => b.score - a.score);

  const fileCount = allFiles.length;
  const treeTotalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const treeEstimatedTokens = Math.ceil(treeTotalBytes / 4);

  if (analysisId) {
    await safeDb(() => analyses.setTreeStats(analysisId, {
      file_count: fileCount,
      tree_total_bytes: treeTotalBytes,
      tree_estimated_tokens: treeEstimatedTokens,
      tree_truncated: treeTruncated,
    }), 'analyses.setTreeStats');

    await safeDb(() => analysisFiles.bulkInsertTreeRows(
      analysisId,
      sorted.map((f) => ({
        path: f.path,
        sha: f.sha,
        size_bytes: f.size || 0,
        language: inferLanguage(f.path),
        score: f.score,
        depth: computeDepth(f.path),
      })),
    ), 'analysisFiles.bulkInsertTreeRows');

    await safeDb(() => analysisEvents.create({
      analysis_id: analysisId,
      event_type: 'tree.fetched',
      source: 'github.tree',
      bytes: treeTotalBytes,
      tokens: treeEstimatedTokens,
      metadata: { fileCount, truncated: treeTruncated, branch },
    }), 'analysisEvents.create tree.fetched');
  }

  send({
    phase: 'estimate',
    fileCount,
    estimatedCorpusTokens: treeEstimatedTokens,
    treeTruncated,
    message: `Estimated ${treeEstimatedTokens.toLocaleString()} tokens across ${fileCount} files`,
  });

  // Rank positions come from the sorted list so we can assign capture tiers
  // by priority.
  const rankByPath = new Map();
  sorted.forEach((f, i) => rankByPath.set(f.path, i + 1));

  const toRead = sorted.slice(0, MAX_FILES_TO_READ);
  send(readingProgress({
    paths: [],
    readCount: 0,
    totalToRead: toRead.length,
    starting: true,
  }));

  const fileContents = {};
  const batchSize = 5;
  for (let i = 0; i < toRead.length; i += batchSize) {
    const batch = toRead.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((f) =>
        github.fetchFileContent(owner, repo, f.path, branch)
          .catch(() => ({ path: f.path, content: null, size: 0 }))
      )
    );

    // Accumulate per-file writes for this fetch batch, then flush them in
    // three round trips (bulkUpdateTiers / incrementIngested / createBatch)
    // instead of three per file.
    const tierUpdates = [];
    const events = [];
    const ingested = { files: 0, bytes: 0, tokens: 0 };

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const originalFile = batch[j];
      if (r && r.content != null) {
        fileContents[r.path] = r.content;

        if (analysisId) {
          const rank = rankByPath.get(r.path) || (i + j + 1);
          const sizeForTier = r.size || r.content.length;
          const tier = decideTier(sizeForTier, rank);
          if (tier) {
            const contentTokens = estimateTokens(r.content);
            const skeleton = extractSkeleton(r.content, 4000, { path: r.path });
            const skeletonTokens = estimateTokens(skeleton);
            const bytes = r.size || r.content.length;

            tierUpdates.push({
              path: r.path,
              tier,
              content: tier === 'full' ? r.content : null,
              skeleton,
              content_tokens: contentTokens,
              skeleton_tokens: skeletonTokens,
              fetched_at: new Date().toISOString(),
              skip_reason: null,
            });
            ingested.files += 1;
            ingested.bytes += bytes;
            ingested.tokens += contentTokens;
            events.push({
              analysis_id: analysisId,
              event_type: 'content.fetched',
              source: 'github.contents',
              path: r.path,
              bytes,
              tokens: contentTokens,
              metadata: { tier },
            });
          }
        }
      } else if (analysisId) {
        const p = (r && r.path) || originalFile.path;
        tierUpdates.push({
          path: p,
          tier: null,
          content: null,
          skeleton: null,
          content_tokens: null,
          skeleton_tokens: null,
          fetched_at: null,
          skip_reason: 'fetch_failed',
        });
        events.push({
          analysis_id: analysisId,
          event_type: 'content.skipped',
          source: 'github.contents',
          path: p,
          metadata: { reason: 'fetch_failed' },
        });
      }
    }

    if (analysisId) {
      if (tierUpdates.length > 0) {
        await safeDb(() => analysisFiles.bulkUpdateTiers(analysisId, tierUpdates), 'analysisFiles.bulkUpdateTiers');
      }
      if (ingested.files > 0) {
        await safeDb(() => analyses.incrementIngested(analysisId, ingested), 'analyses.incrementIngested');
      }
      if (events.length > 0) {
        await safeDb(() => analysisEvents.createBatch(events), 'analysisEvents.createBatch');
      }
    }

    const rollups = analysisId ? await safeDb(() => analyses.getRollups(analysisId), 'analyses.getRollups') : null;
    send(readingProgress({
      paths: batch.map((f) => f.path),
      readCount: Math.min(i + batchSize, toRead.length),
      totalToRead: toRead.length,
      rollups,
    }));
  }

  // P2.2: build the import graph from everything we just read. Persisted
  // centrality has no effect on the current run's tier ranking (the read
  // already happened) — it lands in `analysis_files` so the next analysis
  // for this id can re-rank with structural importance.
  send({ phase: 'graph', message: 'Computing import graph...' });
  const importGraph = computeImportGraph(fileContents);

  if (analysisId) {
    await safeDb(() => analysisFiles.updateGraphMetrics(analysisId, importGraph), 'analysisFiles.updateGraphMetrics');
    await safeDb(() => analysisEvents.create({
      analysis_id: analysisId,
      event_type: 'graph.computed',
      metadata: { nodes: importGraph.size },
    }), 'analysisEvents.create graph.computed');
  }

  const structureAnchors = safeStructureAnchors(fileContents, allFiles.map((f) => f.path));

  send({ phase: 'analyzing', message: 'Detecting tech stack and capabilities...' });

  const stack = detectStack(allFiles, fileContents);
  const structure = analyzeStructure(allFiles);
  const detectorResults = await runAllDetectors({ files: allFiles, fileContents, stack });
  const gaps = projectToLegacyGapShape(detectorResults);
  const deployInfo = detectDeploymentFiles(tree);
  const features = detectFeatures(allFiles, fileContents);
  const existingContext = detectExistingContext(allFiles);

  if (deployInfo.detected) {
    gaps.deployment.exists = true;
    const hostingPlatforms = [...new Set(deployInfo.hosting.map((h) => h.platform))];
    const containerPlatforms = [...new Set(deployInfo.containers.map((c) => c.platform))];
    gaps.deployment.platform = hostingPlatforms.length > 0
      ? hostingPlatforms.join(', ')
      : containerPlatforms[0] || null;
    gaps.deployment.platforms = hostingPlatforms.length > 0 ? hostingPlatforms : containerPlatforms;
    gaps.deployment.hasCI = deployInfo.cicd.length > 0;
  }

  send({ phase: 'complete', message: 'Analysis complete' });

  return {
    meta: {
      name: repoMeta.name,
      description: repoMeta.description,
      language: repoMeta.language,
      defaultBranch: branch,
      stars: repoMeta.stargazers_count,
      forks: repoMeta.forks_count,
      owner,
      repo,
      repoUrl,
    },
    stack,
    structure,
    features,
    gaps,
    deployInfo,
    existingContext,
    fileContents,
    fileTree: allFiles.map((f) => f.path),
    structureAnchors,
  };
}

function detectStack(files, contents) {
  const stack = {
    framework: null,
    runtime: null,
    styling: null,
    database: null,
    auth: null,
    deployment: null,
    languages: [],
  };

  const paths = files.map((f) => f.path);
  const pkg = safeJson(contents['package.json']);
  const allDeps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};

  // Runtime
  if (pkg) stack.runtime = 'node';
  if (paths.some((p) => p.endsWith('.py') || p === 'requirements.txt' || p === 'pyproject.toml')) {
    stack.runtime = stack.runtime || 'python';
  }
  if (paths.some((p) => p === 'go.mod')) stack.runtime = stack.runtime || 'go';
  if (paths.some((p) => p === 'Cargo.toml')) stack.runtime = stack.runtime || 'rust';

  // Framework
  if (allDeps.next) stack.framework = 'Next.js';
  else if (allDeps.nuxt) stack.framework = 'Nuxt';
  else if (allDeps['@sveltejs/kit'] || allDeps.svelte) stack.framework = 'SvelteKit';
  else if (allDeps['@angular/core']) stack.framework = 'Angular';
  else if (allDeps.vue) stack.framework = 'Vue';
  else if (allDeps.react) stack.framework = allDeps.express ? 'React + Express' : 'React';
  else if (allDeps.express) stack.framework = 'Express';
  else if (paths.some((p) => p.includes('django'))) stack.framework = 'Django';
  else if (paths.some((p) => p.includes('flask'))) stack.framework = 'Flask';
  else if (paths.some((p) => p.includes('fastapi'))) stack.framework = 'FastAPI';

  // Styling
  if (allDeps.tailwindcss || allDeps['@tailwindcss/vite']) stack.styling = 'Tailwind CSS';
  else if (allDeps['styled-components']) stack.styling = 'styled-components';
  else if (allDeps['@emotion/react']) stack.styling = 'Emotion';
  else if (allDeps['sass'] || allDeps['node-sass']) stack.styling = 'SCSS';

  // Database
  if (allDeps.prisma || allDeps['@prisma/client']) stack.database = 'Prisma';
  else if (allDeps.drizzle || allDeps['drizzle-orm']) stack.database = 'Drizzle';
  else if (allDeps.mongoose) stack.database = 'MongoDB (Mongoose)';
  else if (allDeps.pg || allDeps.postgres) stack.database = 'PostgreSQL';
  else if (allDeps.mysql2) stack.database = 'MySQL';
  else if (allDeps['better-sqlite3'] || allDeps.sqlite3) stack.database = 'SQLite';
  else if (allDeps['@supabase/supabase-js']) stack.database = 'Supabase';
  else if (allDeps.firebase || allDeps['firebase-admin']) stack.database = 'Firebase';

  // Auth
  if (allDeps['next-auth'] || allDeps['@auth/core']) stack.auth = 'NextAuth';
  else if (allDeps['@clerk/nextjs'] || allDeps['@clerk/express']) stack.auth = 'Clerk';
  else if (allDeps['@supabase/auth-helpers-nextjs'] || allDeps['@supabase/ssr']) stack.auth = 'Supabase Auth';
  else if (allDeps.passport) stack.auth = 'Passport.js';
  else if (allDeps['firebase-admin'] || allDeps.firebase) stack.auth = 'Firebase Auth';
  else if (allDeps.jsonwebtoken) stack.auth = 'JWT (custom)';

  // Languages
  const langSet = new Set();
  for (const f of files) {
    const ext = f.path.split('.').pop()?.toLowerCase();
    if (['js', 'jsx'].includes(ext)) langSet.add('JavaScript');
    else if (['ts', 'tsx'].includes(ext)) langSet.add('TypeScript');
    else if (ext === 'py') langSet.add('Python');
    else if (ext === 'go') langSet.add('Go');
    else if (ext === 'rs') langSet.add('Rust');
    else if (ext === 'java') langSet.add('Java');
    else if (ext === 'rb') langSet.add('Ruby');
    else if (ext === 'php') langSet.add('PHP');
    else if (ext === 'swift') langSet.add('Swift');
    else if (ext === 'kt') langSet.add('Kotlin');
  }
  stack.languages = [...langSet];

  return stack;
}

function analyzeStructure(files) {
  const dirs = new Set();
  const entryPoints = [];
  const routeFiles = [];
  const configFiles = [];

  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }

    const name = parts[parts.length - 1];
    if (/^(app|server|index|main)\.(tsx?|jsx?|js|py)$/.test(name)) {
      entryPoints.push(f.path);
    }
    if (/route|api|endpoint/i.test(f.path)) {
      routeFiles.push(f.path);
    }
    if (/\.(config|conf)\./i.test(name) || /^(tsconfig|next\.config|vite\.config|nuxt\.config)/i.test(name)) {
      configFiles.push(f.path);
    }
  }

  return {
    directories: [...dirs].sort(),
    entryPoints,
    routeFiles,
    configFiles,
  };
}

// Maps the structured `runAllDetectors` output back to the flat gap shape
// every downstream consumer (context-generator, suggestion-rules,
// readiness-scorer, /api/analyze, frontend Analytics view) already reads.
// New fields — `confidence` and `evidence` — ride alongside without
// breaking those legacy keys.
function projectToLegacyGapShape(d) {
  return {
    auth: {
      exists:     d.auth?.exists ?? false,
      provider:   d.auth?.extra?.provider ?? null,
      issues:     d.auth?.extra?.issues ?? [],
      confidence: d.auth?.confidence ?? 0,
      evidence:   d.auth?.evidence ?? [],
    },
    database: {
      exists:        d.database?.exists ?? false,
      type:          d.database?.extra?.type ?? null,
      hasSchema:     d.database?.extra?.hasSchema ?? false,
      hasMigrations: d.database?.extra?.hasMigrations ?? false,
      confidence:    d.database?.confidence ?? 0,
      evidence:      d.database?.evidence ?? [],
    },
    deployment: {
      exists:     d.deployment?.exists ?? false,
      platform:   d.deployment?.extra?.platform ?? null,
      platforms:  d.deployment?.extra?.platforms ?? [],
      hasCI:      d.deployment?.extra?.hasCI ?? false,
      confidence: d.deployment?.confidence ?? 0,
      evidence:   d.deployment?.evidence ?? [],
    },
    permissions: {
      exists:     d.permissions?.exists ?? false,
      hasRoles:   d.permissions?.extra?.hasRoles ?? false,
      confidence: d.permissions?.confidence ?? 0,
      evidence:   d.permissions?.evidence ?? [],
    },
    testing: {
      exists:     d.testing?.exists ?? false,
      coverage:   d.testing?.extra?.coverage ?? 'none',
      confidence: d.testing?.confidence ?? 0,
      evidence:   d.testing?.evidence ?? [],
    },
    errorHandling: {
      exists:           d.errorHandling?.exists ?? false,
      hasGlobalHandler: d.errorHandling?.extra?.hasGlobalHandler ?? false,
      confidence:       d.errorHandling?.confidence ?? 0,
      evidence:         d.errorHandling?.evidence ?? [],
    },
    envConfig: {
      exists:      d.envConfig?.exists ?? false,
      hasExample:  d.envConfig?.extra?.hasExample ?? false,
      missingVars: d.envConfig?.extra?.missingVars ?? [],
      confidence:  d.envConfig?.confidence ?? 0,
      evidence:    d.envConfig?.evidence ?? [],
    },
  };
}

function detectFeatures(files, contents) {
  const featureDirs = new Map();

  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length < 2) continue;
    const dir = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0];
    if (!featureDirs.has(dir)) {
      featureDirs.set(dir, { files: [], hasUI: false, hasAPI: false, hasTests: false });
    }
    const entry = featureDirs.get(dir);
    entry.files.push(f.path);

    const ext = f.path.split('.').pop()?.toLowerCase();
    if (['tsx', 'jsx', 'vue', 'svelte'].includes(ext)) entry.hasUI = true;
    if (/route|api|controller|endpoint/i.test(f.path)) entry.hasAPI = true;
    if (/test|spec/i.test(f.path)) entry.hasTests = true;
  }

  return [...featureDirs.entries()].map(([name, data]) => ({
    name,
    path: name,
    hasUI: data.hasUI,
    hasAPI: data.hasAPI,
    hasTests: data.hasTests,
    fileCount: data.files.length,
  }));
}

function detectExistingContext(files) {
  const paths = files.map((f) => f.path);
  return {
    hasCursorRules: paths.some((p) => p.includes('.cursorrules')),
    hasClaudeMd: paths.some((p) => /CLAUDE\.md$/i.test(p)),
    hasContextMd: paths.some((p) => p.includes('.context.md')),
  };
}

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

async function analyzeFromFiles(fileEntries, projectName, onProgress, analysisId = null) {
  const send = onProgress || (() => {});

  send({ phase: 'meta', message: 'Analyzing uploaded files...' });

  // Keep unfiltered list for deployment detection (matches analyzeRepo behavior)
  const unfilteredFiles = fileEntries.map(f => ({ path: f.path, type: 'blob' }));

  const contentMap = new Map(fileEntries.map(f => [f.path, f.content]));

  const scanIgnoreEntry = fileEntries.find((f) => f.path === '.scanignore');
  const extraIgnore = scanIgnoreEntry ? parseScanIgnore(scanIgnoreEntry.content) : [];

  const allFiles = unfilteredFiles
    .filter(f => !shouldSkipFile(f.path, extraIgnore))
    .map((f) => {
      const content = contentMap.get(f.path);
      return { ...f, size: content ? content.length : 0 };
    });

  send({ phase: 'tree-done', message: `Found ${allFiles.length} files`, fileCount: allFiles.length });

  const sorted = allFiles
    .map(f => ({ ...f, score: scorePath(f.path) }))
    .sort((a, b) => b.score - a.score);

  const fileCount = allFiles.length;
  const treeTotalBytes = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const treeEstimatedTokens = Math.ceil(treeTotalBytes / 4);
  const treeTruncated = false;

  if (analysisId) {
    await safeDb(() => analyses.setTreeStats(analysisId, {
      file_count: fileCount,
      tree_total_bytes: treeTotalBytes,
      tree_estimated_tokens: treeEstimatedTokens,
      tree_truncated: treeTruncated,
    }), 'analyses.setTreeStats');

    await safeDb(() => analysisFiles.bulkInsertTreeRows(
      analysisId,
      sorted.map((f) => ({
        path: f.path,
        sha: null,
        size_bytes: f.size || 0,
        language: inferLanguage(f.path),
        score: f.score,
        depth: computeDepth(f.path),
      })),
    ), 'analysisFiles.bulkInsertTreeRows');

    await safeDb(() => analysisEvents.create({
      analysis_id: analysisId,
      event_type: 'tree.fetched',
      source: 'internal.upload',
      bytes: treeTotalBytes,
      tokens: treeEstimatedTokens,
      metadata: { fileCount, truncated: treeTruncated },
    }), 'analysisEvents.create tree.fetched');
  }

  send({
    phase: 'estimate',
    fileCount,
    estimatedCorpusTokens: treeEstimatedTokens,
    treeTruncated,
    message: `Estimated ${treeEstimatedTokens.toLocaleString()} tokens across ${fileCount} files`,
  });

  const toRead = sorted.slice(0, MAX_FILES_TO_READ);
  send(readingProgress({
    paths: [],
    readCount: 0,
    totalToRead: toRead.length,
    starting: true,
  }));

  const fileContents = {};
  const pendingPaths = [];

  // Accumulate per-file writes and flush every FLUSH_EVERY files (plus a
  // final flush) — three round trips per flush instead of three per file.
  const FLUSH_EVERY = 25;
  const pendingTiers = [];
  const pendingEvents = [];
  let pendingIngested = { files: 0, bytes: 0, tokens: 0 };

  async function flushIngestion() {
    if (pendingTiers.length > 0) {
      const tiers = pendingTiers.splice(0);
      await safeDb(() => analysisFiles.bulkUpdateTiers(analysisId, tiers), 'analysisFiles.bulkUpdateTiers');
    }
    if (pendingIngested.files > 0) {
      const counters = pendingIngested;
      pendingIngested = { files: 0, bytes: 0, tokens: 0 };
      await safeDb(() => analyses.incrementIngested(analysisId, counters), 'analyses.incrementIngested');
    }
    if (pendingEvents.length > 0) {
      const events = pendingEvents.splice(0);
      await safeDb(() => analysisEvents.createBatch(events), 'analysisEvents.createBatch');
    }
  }

  for (let i = 0; i < toRead.length; i++) {
    const f = toRead[i];
    const content = contentMap.get(f.path);
    if (content != null) {
      fileContents[f.path] = content;

      if (analysisId) {
        const rank = i + 1;
        const sizeForTier = content.length;
        const tier = decideTier(sizeForTier, rank);
        if (tier) {
          const contentTokens = estimateTokens(content);
          const skeleton = extractSkeleton(content, 4000, { path: f.path });
          const skeletonTokens = estimateTokens(skeleton);

          pendingTiers.push({
            path: f.path,
            tier,
            content: tier === 'full' ? content : null,
            skeleton,
            content_tokens: contentTokens,
            skeleton_tokens: skeletonTokens,
            fetched_at: new Date().toISOString(),
            skip_reason: null,
          });
          pendingIngested.files += 1;
          pendingIngested.bytes += content.length;
          pendingIngested.tokens += contentTokens;
          pendingEvents.push({
            analysis_id: analysisId,
            event_type: 'content.fetched',
            source: 'internal.upload',
            path: f.path,
            bytes: content.length,
            tokens: contentTokens,
            metadata: { tier },
          });
        }
      }
    } else if (analysisId) {
      pendingTiers.push({
        path: f.path,
        tier: null,
        content: null,
        skeleton: null,
        content_tokens: null,
        skeleton_tokens: null,
        fetched_at: null,
        skip_reason: 'fetch_failed',
      });
      pendingEvents.push({
        analysis_id: analysisId,
        event_type: 'content.skipped',
        source: 'internal.upload',
        path: f.path,
        metadata: { reason: 'fetch_failed' },
      });
    }

    if (analysisId && (i + 1) % FLUSH_EVERY === 0) {
      await flushIngestion();
    }

    pendingPaths.push(f.path);
    if (pendingPaths.length >= 5 || i === toRead.length - 1) {
      send(readingProgress({
        paths: pendingPaths.splice(0),
        readCount: i + 1,
        totalToRead: toRead.length,
      }));
    }
  }

  if (analysisId) {
    await flushIngestion();
  }

  if (analysisId) {
    const rollups = await safeDb(() => analyses.getRollups(analysisId), 'analyses.getRollups');
    send(readingProgress({
      paths: [],
      readCount: Object.keys(fileContents).length,
      totalToRead: toRead.length,
      rollups,
    }));
  }

  // P2.2: import graph — see note in analyzeRepo above.
  send({ phase: 'graph', message: 'Computing import graph...' });
  const importGraph = computeImportGraph(fileContents);

  if (analysisId) {
    await safeDb(() => analysisFiles.updateGraphMetrics(analysisId, importGraph), 'analysisFiles.updateGraphMetrics');
    await safeDb(() => analysisEvents.create({
      analysis_id: analysisId,
      event_type: 'graph.computed',
      metadata: { nodes: importGraph.size },
    }), 'analysisEvents.create graph.computed');
  }

  const structureAnchors = safeStructureAnchors(fileContents, allFiles.map((f) => f.path));

  send({ phase: 'analyzing', message: 'Detecting tech stack and capabilities...' });

  const stack = detectStack(allFiles, fileContents);
  const structure = analyzeStructure(allFiles);
  const detectorResults = await runAllDetectors({ files: allFiles, fileContents, stack });
  const gaps = projectToLegacyGapShape(detectorResults);
  const deployInfo = detectDeploymentFiles(unfilteredFiles);
  const features = detectFeatures(allFiles, fileContents);
  const existingContext = detectExistingContext(allFiles);

  if (deployInfo.detected) {
    gaps.deployment.exists = true;
    const hostingPlatforms = [...new Set(deployInfo.hosting.map((h) => h.platform))];
    const containerPlatforms = [...new Set(deployInfo.containers.map((c) => c.platform))];
    gaps.deployment.platform = hostingPlatforms.length > 0
      ? hostingPlatforms.join(', ')
      : containerPlatforms[0] || null;
    gaps.deployment.platforms = hostingPlatforms.length > 0 ? hostingPlatforms : containerPlatforms;
    gaps.deployment.hasCI = deployInfo.cicd.length > 0;
  }

  send({ phase: 'complete', message: 'Analysis complete' });

  return {
    meta: {
      name: projectName || 'Uploaded Project',
      description: null,
      language: stack.languages[0] || null,
      defaultBranch: null,
      stars: 0,
      forks: 0,
      owner: 'local',
      repo: projectName || 'upload',
      repoUrl: `local://${projectName || 'upload'}`,
    },
    stack,
    structure,
    features,
    gaps,
    deployInfo,
    existingContext,
    fileContents,
    fileTree: allFiles.map(f => f.path),
    structureAnchors,
  };
}

module.exports = {
  analyzeRepo,
  analyzeFromFiles,
  shouldSkipFile,
  isArchivedPath,
  parseScanIgnore,
  compileIgnorePattern,
};
