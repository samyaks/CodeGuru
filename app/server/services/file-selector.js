const { estimateTokens } = require('../lib/capture-utils');

const PURPOSE_PATTERNS = {
  context_generation: [
    /^package\.json$/, /^tsconfig\.json$/, /^pyproject\.toml$/, /^requirements\.txt$/,
    /next\.config\./, /vite\.config\./, /nuxt\.config\./, /svelte\.config\./,
    /tailwind\.config\./, /^Dockerfile$/, /docker-compose\.ya?ml$/,
    /prisma\/schema\.prisma$/, /(?:^|\/)schema\.(prisma|sql)$/,
    /(?:^|\/)app\.(tsx?|jsx?|js)$/, /(?:^|\/)server\.(tsx?|jsx?|js)$/,
    /(?:^|\/)main\.(tsx?|jsx?|py)$/,
    /(?:^|\/)layout\.(tsx?|jsx?)$/, /(?:^|\/)page\.(tsx?|jsx?)$/,
    /(?:^|\/)routes?\//, /(?:^|\/)api\//, /^README/i, /^\.env\.example$/,
  ],
  features_description: [
    /(?:^|\/)page\.(tsx?|jsx?)$/, /(?:^|\/)pages\//, /(?:^|\/)views\//,
    /(?:^|\/)components?\//, /^README/i,
    /(?:^|\/)routes?\//, /(?:^|\/)api\//,
    /(?:^|\/)app\.(tsx?|jsx?|js)$/, /(?:^|\/)server\.(tsx?|jsx?|js)$/,
  ],
  ai_suggestions: [
    /(?:^|\/)routes?\//, /(?:^|\/)api\//, /(?:^|\/)controllers?\//,
    /(?:^|\/)auth/, /(?:^|\/)middleware/,
    /schema/i, /(?:^|\/)models?\//, /(?:^|\/)migrations?\//,
    /(?:^|\/)(index|main|app|server)\.(js|ts|tsx)$/,
  ],
  feature_dir: [
    /(?:^|\/)page\.(tsx?|jsx?)$/, /(?:^|\/)layout\.(tsx?|jsx?)$/,
    /(?:^|\/)index\.(tsx?|jsx?|js|py)$/,
    // Catch-all for any code file so utility-only dirs (e.g. src/lib/) still
    // produce a .context.md. Kept last so page/layout/index win when present.
    /\.(tsx?|jsx?|js|py|rb|go|rs)$/,
  ],
};

function scoreForPurpose(filePath, purpose) {
  const patterns = PURPOSE_PATTERNS[purpose];
  if (!patterns) return 0;
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].test(filePath)) {
      return patterns.length - i;
    }
  }
  return 0;
}

function selectFilesForPrompt({
  fileContents,
  skeletons = {},
  purpose,
  tokenBudget = 30000,
  maxFiles = 30,
  filterFn = null,
}) {
  const entries = Object.entries(fileContents || {});
  const candidates = [];

  for (const [path, content] of entries) {
    if (filterFn && !filterFn(path)) continue;
    const score = scoreForPurpose(path, purpose);
    // Drop unscored files entirely so small noise files can't absorb leftover
    // budget after a higher-scored file is dropped for not fitting.
    if (score === 0) continue;
    candidates.push({
      path,
      content: content == null ? '' : String(content),
      skeleton: skeletons[path] != null ? String(skeletons[path]) : null,
      score,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });

  const files = [];
  let used = 0;
  let droppedCount = 0;

  for (const c of candidates) {
    if (files.length >= maxFiles) {
      droppedCount++;
      continue;
    }

    const fullTokens = estimateTokens(c.content);
    if (fullTokens + used <= tokenBudget) {
      files.push({ path: c.path, content: c.content, isSkeleton: false });
      used += fullTokens;
      continue;
    }

    if (c.skeleton) {
      const skeletonTokens = estimateTokens(c.skeleton);
      if (skeletonTokens + used <= tokenBudget) {
        files.push({ path: c.path, content: c.skeleton, isSkeleton: true });
        used += skeletonTokens;
        continue;
      }
    }

    droppedCount++;
  }

  return { files, estimatedTokens: used, droppedCount };
}

module.exports = { selectFilesForPrompt, scoreForPurpose };
