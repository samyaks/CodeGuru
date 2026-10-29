/**
 * User-selectable models for a Takeoff analysis scan, plus a preflight
 * token/cost projection so the user can confirm usage before we start.
 *
 * Token numbers are estimates (file-selector budgets + typical call shape),
 * not a guarantee. Cost uses the same pricing table as anthropic-tracked.
 */

const { CLAUDE_MODEL, HAIKU_MODEL } = require('./constants');
const { estimateCost } = require('./anthropic-tracked');
const { AppError } = require('./app-error');

const MAX_FILES_TO_READ = parseInt(process.env.MAX_FILES_TO_READ, 10) || 150;

const SONNET_MODEL = process.env.CLAUDE_SONNET_MODEL || 'claude-sonnet-5';
const OPUS_MODEL = process.env.CLAUDE_OPUS_MODEL || 'claude-opus-5-5';

const ANALYSIS_MODELS = Object.freeze([
  {
    id: 'haiku',
    label: 'Haiku',
    tagline: 'Fastest and cheapest',
    description: 'Good for small repos and quick scans. A bit less thorough on subtle gaps.',
    model: HAIKU_MODEL,
    speed: 'fast',
    recommended: false,
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    tagline: 'Recommended',
    description: 'Best balance of quality and cost for most projects.',
    model: SONNET_MODEL,
    speed: 'balanced',
    recommended: true,
  },
  {
    id: 'opus',
    label: 'Opus',
    tagline: 'Highest quality',
    description: 'Most thorough analysis. Costs more and takes longer.',
    model: OPUS_MODEL,
    speed: 'slow',
    recommended: false,
    signedInOnly: true,
  },
]);

const SIGNED_IN_ONLY_REASON = 'Sign in to use Opus.';

const MODEL_BY_ID = new Map(ANALYSIS_MODELS.map((m) => [m.id, m]));

// Exact picker id, exact model string, or a dated snapshot of the model
// (`claude-haiku-4-5-20251001`). Deliberately not a bare prefix match, so
// "claude" or "claude-opus" can't silently resolve to some model.
function findEntry(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  if (MODEL_BY_ID.has(key)) return MODEL_BY_ID.get(key);
  for (const entry of ANALYSIS_MODELS) {
    const id = entry.model.toLowerCase();
    if (key === id || key.startsWith(`${id}-`)) return entry;
  }
  return null;
}

// Opus is for signed-in users only. Callers say who is asking; leaving it
// out counts as signed out, so a new call site can't hand Opus to anyone.
function isAvailable(entry, { signedIn = false } = {}) {
  return !entry.signedInOnly || !!signedIn;
}

function defaultModelId({ signedIn = false } = {}) {
  const entry = findEntry(process.env.CLAUDE_MODEL || CLAUDE_MODEL);
  return entry && isAvailable(entry, { signedIn }) ? entry.id : 'sonnet';
}

function publicModel(entry, { signedIn = false } = {}) {
  const available = isAvailable(entry, { signedIn });
  return {
    id: entry.id,
    label: entry.label,
    tagline: entry.tagline,
    description: entry.description,
    model: entry.model,
    speed: entry.speed,
    recommended: !!entry.recommended,
    available,
    unavailableReason: available ? null : SIGNED_IN_ONLY_REASON,
  };
}

function listAnalysisModels({ signedIn = false } = {}) {
  return {
    defaultModelId: defaultModelId({ signedIn }),
    models: ANALYSIS_MODELS.map((entry) => publicModel(entry, { signedIn })),
  };
}

/**
 * Resolve a user-supplied model id (`haiku` / `sonnet` / `opus`) or a full
 * Anthropic model string. Throws AppError.badRequest on unknown values and
 * AppError.unauthorized when a signed-out caller asks for Opus.
 * Empty/missing input falls back to the default.
 */
function resolveAnalysisModel(raw, { signedIn = false } = {}) {
  if (raw == null || raw === '') return MODEL_BY_ID.get(defaultModelId({ signedIn }));
  const entry = findEntry(raw);
  if (!entry) {
    throw AppError.badRequest(
      `Unknown model "${raw}". Choose haiku, sonnet, or opus.`,
    );
  }
  if (!isAvailable(entry, { signedIn })) throw AppError.unauthorized(SIGNED_IN_ONLY_REASON);
  return entry;
}

/**
 * Project LLM token usage from repo size. Caps follow the analyzer's
 * MAX_FILES_TO_READ and the context/features/suggestions prompt budgets.
 */
function projectLlmTokens({ fileCount = 0, treeBytes = 0 } = {}) {
  const files = Math.max(0, Number(fileCount) || 0);
  const bytes = Math.max(0, Number(treeBytes) || 0);
  const treeTokens = Math.ceil(bytes / 4);
  const ingestedFiles = Math.min(files, MAX_FILES_TO_READ);
  const avgFileBytes = files > 0 ? bytes / files : 0;
  const ingestedBytes = Math.round(avgFileBytes * ingestedFiles);
  const ingestedTokens = Math.ceil(ingestedBytes / 4);

  // Prompt budgets are capped; they don't grow linearly with repo size.
  const scale = Math.min(1.35, 0.7 + ingestedFiles / 180);

  const phases = {
    context: { input: Math.round(14000 * scale), output: Math.round(9000 * scale) },
    features: { input: Math.round(20000 * scale), output: 2500 },
    suggestions: { input: Math.round(12000 * scale), output: 2000 },
    productMap: { input: 5000, output: 2000 },
    gapLink: { input: 3500, output: 1000 },
    invariants: { input: 24000, output: 6400 },
    read: { input: 8000, output: 2500 },
  };

  let inputTokens = 0;
  let outputTokens = 0;
  for (const p of Object.values(phases)) {
    inputTokens += p.input;
    outputTokens += p.output;
  }

  return {
    fileCount: files,
    treeBytes: bytes,
    treeTokens,
    ingestedFiles,
    ingestedTokens,
    inputTokens,
    outputTokens,
    totalLlmTokens: inputTokens + outputTokens,
    phases,
  };
}

function priceForModel(entry, projection) {
  const costUsd = estimateCost(entry.model, {
    inputTokens: projection.inputTokens,
    outputTokens: projection.outputTokens,
  });
  return {
    inputTokens: projection.inputTokens,
    outputTokens: projection.outputTokens,
    totalTokens: projection.totalLlmTokens,
    costUsd,
    // ±30% band so the UI can say "about" without pretending precision.
    costUsdLow: Math.round(costUsd * 0.7 * 10000) / 10000,
    costUsdHigh: Math.round(costUsd * 1.3 * 10000) / 10000,
  };
}

/**
 * `preferredModel` (picker id or model string, e.g. the model a project was
 * last analyzed with) overrides the env default when it resolves and the
 * caller may use it.
 */
function buildEstimate({
  fileCount = 0,
  treeBytes = 0,
  truncated = false,
  repo = null,
  preferredModel = null,
  signedIn = false,
} = {}) {
  const projection = projectLlmTokens({ fileCount, treeBytes });
  const preferred = findEntry(preferredModel);
  const usePreferred = preferred && isAvailable(preferred, { signedIn });
  return {
    defaultModelId: usePreferred ? preferred.id : defaultModelId({ signedIn }),
    repo: repo || null,
    corpus: {
      fileCount: projection.fileCount,
      treeBytes: projection.treeBytes,
      treeTokens: projection.treeTokens,
      ingestedFiles: projection.ingestedFiles,
      ingestedTokens: projection.ingestedTokens,
      truncated: !!truncated,
    },
    models: ANALYSIS_MODELS.map((entry) => ({
      ...publicModel(entry, { signedIn }),
      estimate: priceForModel(entry, projection),
    })),
  };
}

module.exports = {
  ANALYSIS_MODELS,
  MAX_FILES_TO_READ,
  defaultModelId,
  listAnalysisModels,
  resolveAnalysisModel,
  projectLlmTokens,
  buildEstimate,
};
