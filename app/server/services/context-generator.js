const { broadcast } = require('../lib/sse');
const { CLAUDE_MODEL, anthropic, truncate } = require('../lib/constants');
const { createMessageTracked, streamMessageTracked } = require('../lib/anthropic-tracked');
const { selectFilesForPrompt } = require('./file-selector');
const { analysisFiles } = require('../lib/db');
const { computeImportGraph } = require('./import-graph');

const APP_CONTEXT_CACHE_CHARS = 1500;

// Per-call output cap. Sized to accommodate ~app + 5 dirs + 5-7 gaps in a
// single response (~20K target). Stream truncation triggers the missing-
// section retry below.
const COMBINED_MAX_TOKENS = 20000;
// Legacy per-section cap (kept for the multi-call fallback path).
const LEGACY_MAX_TOKENS = 4096;

const BASE_SYSTEM_PROMPT = `You are an expert software architect analyzing a codebase to generate .context.md files. These files serve as the source of truth between human developers and AI coding tools.

Your output will be used by vibe coders — people who build apps primarily through AI tools like Cursor and Claude Code. They understand their app's purpose but may not know engineering best practices for auth, databases, deployment, etc.

For EXISTING code: document what's there accurately. Capture the purpose, constraints, decisions, and dependencies.

For MISSING capabilities: write a PRESCRIPTIVE context file that specifies what should be built. Include:
- What the capability needs to do (in plain English)
- Recommended approach given the existing tech stack
- Constraints that must be respected
- Common pitfalls to avoid
- How it connects to existing code

Always follow the .context.md spec format with these sections:
## owner, ## purpose, ## constraints, ## decisions, ## ai-log, ## dependencies, ## status

Keep language clear and non-technical where possible. A PM should be able to read and understand every context file.`;

const COMBINED_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

OUTPUT FORMAT
You MUST emit every requested section between explicit delimiters and nothing else:
<<<SECTION:app>>>
...the .context.md body for the project root...
<<<END>>>

<<<SECTION:dir:<dir-path>>>
...the .context.md body for that directory...
<<<END>>>

<<<SECTION:gap:<gap-name>>>
...the prescriptive .context.md body for that missing capability...
<<<END>>>

Rules:
- Emit sections in the exact order listed in the user message.
- Do not emit any text outside the delimiters (no preamble, no commentary, no JSON).
- Inside each section, use the .context.md spec format (## owner, ## purpose, ## constraints, ## decisions, ## ai-log, ## dependencies, ## status).
- Each section's <<<END>>> must appear on its own and be matched 1:1 with the preceding <<<SECTION:...>>>.`;

function renderFilesBlock(files) {
  return files
    .map((f) => `### ${f.path}${f.isSkeleton ? ' (skeleton)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');
}

function buildCacheablePrefix(model, skeletons = {}) {
  const fileTree = (model.fileTree || []).slice(0, 100).join('\n');

  const { files: selected } = selectFilesForPrompt({
    fileContents: model.fileContents || {},
    skeletons,
    purpose: 'context_generation',
    tokenBudget: 18000,
    maxFiles: 30,
  });

  const keyFiles = renderFilesBlock(selected);

  const prefix = `## Project Info
Name: ${model.meta.name}
Description: ${model.meta.description || 'No description'}
Primary Language: ${model.meta.language || 'Unknown'}
Framework: ${model.stack.framework || 'Unknown'}
Runtime: ${model.stack.runtime || 'Unknown'}
Styling: ${model.stack.styling || 'None detected'}
Database: ${model.stack.database || 'None detected'}
Auth: ${model.stack.auth || 'None detected'}

## Detected Gaps
Auth: ${model.gaps.auth.exists ? 'exists' : 'MISSING'}
Database: ${model.gaps.database.exists ? 'exists' : 'MISSING'}
Deployment: ${model.gaps.deployment.exists ? 'exists' : 'MISSING'}
Testing: ${model.gaps.testing.exists ? 'exists' : 'MISSING'}
Error Handling: ${model.gaps.errorHandling.exists ? 'exists' : 'MISSING'}

## File Tree
${fileTree}

## Key Files
${keyFiles}`;

  return { prefix, filesUsed: selected.map((f) => f.path) };
}

// ── Section descriptors ──────────────────────────────────────────
//
// A "section descriptor" is the unit the planner emits and the parser fills.
// `key` is what appears inside the delimiter (`app`, dir path, or gap name).
// `pathFor` is the .context.md path the resulting body will be written to.
// `instruction` is the per-section prompt fragment.

function sectionKey(s) {
  if (s.kind === 'app') return 'app';
  return `${s.kind}:${s.key}`;
}

function buildSectionPlan(model, featureDirs, gaps, skeletons) {
  const plan = [];

  plan.push({
    kind: 'app',
    key: 'app',
    pathFor: '.context.md',
    type: 'existing',
    filesUsed: [],
    instruction:
      'Generate the root .context.md for this project. Capture purpose, tech stack, ' +
      'current state, and what still needs to be built. Reference the Project Info and ' +
      'Key Files from the cached context above.',
  });

  for (const dir of featureDirs) {
    const { files: dirFiles } = selectFilesForPrompt({
      fileContents: model.fileContents || {},
      skeletons,
      purpose: 'feature_dir',
      filterFn: (p) => p.startsWith(dir),
      tokenBudget: 3000,
      maxFiles: 8,
    });
    if (!dirFiles.length) continue;

    plan.push({
      kind: 'dir',
      key: dir,
      pathFor: `${dir}/.context.md`,
      type: 'existing',
      filesUsed: dirFiles.map((f) => f.path),
      instruction:
        `Generate a focused .context.md for the "${dir}" directory.\n\n` +
        `Files in this directory:\n${renderFilesBlock(dirFiles)}\n\n` +
        'Capture this module\'s purpose, constraints, decisions, and dependencies. ' +
        'Reference project-wide info from the cached context above as needed.',
    });
  }

  for (const gap of gaps) {
    plan.push({
      kind: 'gap',
      key: gap.name,
      pathFor: gap.path,
      type: 'gap',
      filesUsed: [],
      instruction:
        `This codebase is MISSING: ${gap.name}\n\n` +
        `## Gap details\n${gap.description}\n\n` +
        'Generate a PRESCRIPTIVE .context.md that tells an AI tool exactly what to build:\n' +
        '- What the capability needs to do (plain English)\n' +
        '- Recommended approach for the detected tech stack\n' +
        '- Constraints that must be respected\n' +
        '- Common pitfalls to avoid\n' +
        '- How it connects to existing code (reference the Key Files above)\n' +
        '- Specific files that should be created or modified\n' +
        'This is a PRESCRIPTIVE spec, not documentation of existing code.',
    });
  }

  return plan;
}

function buildDynamicInstructionBlock(plan) {
  const header =
    'Emit the following sections, IN ORDER, each wrapped between its <<<SECTION:...>>> ' +
    'and <<<END>>> delimiters as described in the system prompt. The exact delimiter for ' +
    'each section is shown below — use it verbatim.\n';

  const blocks = plan.map((s, i) => {
    const opener = `<<<SECTION:${s.kind === 'app' ? 'app' : `${s.kind}:${s.key}`}>>>`;
    return `--- Section ${i + 1} of ${plan.length} ---\nDelimiter: ${opener} ... <<<END>>>\n\n${s.instruction}`;
  });

  const footer =
    '\n\n--- Reminder ---\n' +
    '- Every section must start with its exact <<<SECTION:...>>> delimiter and end with <<<END>>>.\n' +
    '- Emit sections in the order listed above.\n' +
    '- Do not emit anything outside the delimiters.';

  return `${header}\n${blocks.join('\n\n')}${footer}`;
}

// ── Delimited streaming parser ──────────────────────────────────
//
// Exported for unit testing. Builds a small state machine that consumes text
// chunks and surfaces section boundaries via callbacks. The parser tolerates
// delimiters split across chunks by keeping a safety tail in the buffer until
// the next chunk arrives.

const SECTION_START_RE = /<<<SECTION:(app|dir|gap)(?::([^>]+))?>>>/;
const SECTION_END = '<<<END>>>';
// Conservative safety window: must comfortably exceed both delimiter widths so
// a partial match never gets prematurely committed.
const PARSER_TAIL_KEEP = 64;

function createSectionParser({ onSectionStart, onSectionPartial, onSectionDone } = {}) {
  let buf = '';
  let cur = null;
  const finished = new Map();

  function emitPartial() {
    if (cur && onSectionPartial) onSectionPartial(cur);
  }

  function ingest(chunk) {
    if (chunk == null || chunk === '') return;
    buf += chunk;

    while (true) {
      if (!cur) {
        const m = SECTION_START_RE.exec(buf);
        if (!m) {
          if (buf.length > PARSER_TAIL_KEEP) buf = buf.slice(-PARSER_TAIL_KEEP);
          return;
        }
        const kind = m[1];
        const key = m[2] || (kind === 'app' ? 'app' : null);
        cur = { kind, key, body: '' };
        buf = buf.slice(m.index + m[0].length);
        if (onSectionStart) onSectionStart(cur);
        continue;
      }

      const endIdx = buf.indexOf(SECTION_END);
      if (endIdx === -1) {
        if (buf.length > PARSER_TAIL_KEEP) {
          cur.body += buf.slice(0, buf.length - PARSER_TAIL_KEEP);
          buf = buf.slice(-PARSER_TAIL_KEEP);
          emitPartial();
        }
        return;
      }

      cur.body += buf.slice(0, endIdx);
      emitPartial();
      finished.set(sectionKey(cur), cur.body.trim());
      if (onSectionDone) onSectionDone(cur);
      cur = null;
      buf = buf.slice(endIdx + SECTION_END.length);
    }
  }

  function finalize() {
    if (cur) {
      cur.body += buf;
      if (cur.body.trim().length > 0) {
        finished.set(sectionKey(cur), cur.body.trim());
        if (onSectionDone) onSectionDone(cur);
      }
      cur = null;
    }
    buf = '';
  }

  return { ingest, finalize, finished };
}

// ── Single delimited streaming call ─────────────────────────────

async function runDelimitedCall({
  analysisId,
  phase,
  cacheablePrefix,
  cachedFilesUsed,
  plan,
  send,
}) {
  const dynamicInstruction = buildDynamicInstructionBlock(plan);
  const finalReminder =
    'Begin now. Output ONLY the delimited sections above, in order, with no extra text.';

  const pathByKey = new Map();
  for (const s of plan) pathByKey.set(sectionKey(s), s.pathFor);

  const phaseByKind = {
    app: 'context-app',
    dir: 'context-feature',
    gap: 'context-gap',
  };

  const parser = createSectionParser({
    onSectionStart: (cur) => {
      const key = sectionKey(cur);
      const ssePhase = phaseByKind[cur.kind] || 'context-section';
      const targetPath = pathByKey.get(key) || key;
      const label =
        cur.kind === 'app'
          ? 'Generating app-level .context.md...'
          : cur.kind === 'dir'
            ? `Generating context for ${cur.key}...`
            : `Generating spec for missing ${cur.key}...`;
      send({ type: 'progress', phase: ssePhase, message: label, path: targetPath });
    },
    onSectionPartial: (cur) => {
      const targetPath = pathByKey.get(sectionKey(cur));
      if (!targetPath) return;
      send({ type: 'context-stream', path: targetPath, partial: cur.body });
    },
  });

  const allFilesUsed = new Set(cachedFilesUsed || []);
  for (const s of plan) {
    for (const p of s.filesUsed || []) allFilesUsed.add(p);
  }

  // Intentionally NO `cache_control` on the prefix. The delimited call is a
  // single-shot in the typical case (CodeGuru's first scan: 5 sections in one
  // call, no retry). Ephemeral caching costs 1.25× input on creation; the only
  // payoff is if a second call within 5 min reads the same prefix. With p_retry
  // far below the ~28% break-even rate, caching here was a net ~$0.02/scan
  // tax. The multi-call legacy path below still caches because it always makes
  // 3+ calls sharing the prefix.
  await streamMessageTracked({
    client: anthropic,
    analysisId,
    phase,
    targetPath: 'multi',
    filesUsed: [...allFilesUsed],
    params: {
      model: CLAUDE_MODEL,
      max_tokens: COMBINED_MAX_TOKENS,
      system: COMBINED_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: cacheablePrefix },
          { type: 'text', text: dynamicInstruction },
          { type: 'text', text: finalReminder },
        ],
      }],
    },
    onText: (chunk) => parser.ingest(chunk),
  });

  parser.finalize();
  return parser.finished;
}

// ── Public entry point ──────────────────────────────────────────

async function generateContextFiles(analysisId, codebaseModel) {
  const send = (data) => broadcast(analysisId, data);
  send({ type: 'progress', phase: 'context-start', message: 'Generating context files...' });

  let skeletons = {};
  try {
    if (analysisFiles && typeof analysisFiles.getSkeletonsMap === 'function') {
      skeletons = (await analysisFiles.getSkeletonsMap(analysisId)) || {};
    }
  } catch (err) {
    console.warn(`[context-generator] getSkeletonsMap failed: ${err.message}`);
  }

  const featureDirs = identifyFeatureDirs(codebaseModel, skeletons);
  const gaps = identifyActionableGaps(codebaseModel);

  const { prefix: cacheablePrefix, filesUsed: cachedFilesUsed } =
    buildCacheablePrefix(codebaseModel, skeletons);

  const plan = buildSectionPlan(codebaseModel, featureDirs, gaps, skeletons);

  let sectionsByKey;
  try {
    sectionsByKey = await runDelimitedCall({
      analysisId,
      phase: 'context-multi',
      cacheablePrefix,
      cachedFilesUsed,
      plan,
      send,
    });
  } catch (err) {
    console.error(`[context-generator] combined streaming call failed: ${err.message}`);
    sectionsByKey = new Map();
  }

  // Retry only the sections Claude didn't emit (likely cause: max_tokens
  // truncated the response mid-stream). Skip retry entirely if the first call
  // produced nothing at all — the legacy fallback below handles that.
  if (sectionsByKey.size > 0) {
    const missing = plan.filter((s) => !sectionsByKey.has(sectionKey(s)));
    if (missing.length > 0) {
      console.warn(
        `[context-generator] ${missing.length}/${plan.length} section(s) missing after first pass; retrying`,
      );
      try {
        const retried = await runDelimitedCall({
          analysisId,
          phase: 'context-multi-retry',
          cacheablePrefix,
          cachedFilesUsed,
          plan: missing,
          send,
        });
        for (const [k, v] of retried) sectionsByKey.set(k, v);
      } catch (err) {
        console.warn(`[context-generator] retry call failed: ${err.message}`);
      }
    }
  }

  if (sectionsByKey.size === 0) {
    console.warn(
      '[context-generator] delimited parse produced no sections; falling back to legacy multi-call path',
    );
    return generateContextFilesLegacy(analysisId, codebaseModel, skeletons);
  }

  const contextFiles = [];
  for (const s of plan) {
    const body = sectionsByKey.get(sectionKey(s));
    if (!body) continue;
    contextFiles.push({ path: s.pathFor, content: body, type: s.type });
  }

  const completionPct = calculateCompletion(codebaseModel);
  send({
    type: 'progress',
    phase: 'context-done',
    message: `Generated ${contextFiles.length} context files`,
  });

  return { contextFiles, completionPct };
}

// ── Legacy multi-call fallback ──────────────────────────────────
//
// Preserved verbatim modulo the new `skeletons` plumbing so the file-selector
// can degrade over-budget files to their skeleton form. Only invoked if the
// combined streaming call fails to produce a single parseable section.

async function generateContextFilesLegacy(analysisId, codebaseModel, skeletons = {}) {
  const send = (data) => broadcast(analysisId, data);
  const contextFiles = [];

  const { prefix: cacheablePrefix, filesUsed: cachedFilesUsed } =
    buildCacheablePrefix(codebaseModel, skeletons);

  send({ type: 'progress', phase: 'context-app', message: 'Generating app-level .context.md...' });
  const appContext = await generateAppContextLegacy(analysisId, cacheablePrefix, cachedFilesUsed);
  contextFiles.push({ path: '.context.md', content: appContext, type: 'existing' });

  const featureDirs = identifyFeatureDirs(codebaseModel, skeletons);
  for (const dir of featureDirs) {
    send({ type: 'progress', phase: 'context-feature', message: `Generating context for ${dir}...` });
    try {
      const featureContext = await generateFeatureContextLegacy(
        analysisId,
        codebaseModel,
        dir,
        cacheablePrefix,
        cachedFilesUsed,
        appContext,
        skeletons,
      );
      if (featureContext) {
        contextFiles.push({ path: `${dir}/.context.md`, content: featureContext, type: 'existing' });
      }
    } catch (err) {
      console.error(`Failed to generate context for ${dir}:`, err.message);
    }
  }

  const gaps = identifyActionableGaps(codebaseModel);
  for (const gap of gaps) {
    send({ type: 'progress', phase: 'context-gap', message: `Generating spec for missing ${gap.name}...` });
    try {
      const gapContext = await generateGapContextLegacy(
        analysisId,
        gap,
        cacheablePrefix,
        cachedFilesUsed,
        appContext,
      );
      contextFiles.push({ path: gap.path, content: gapContext, type: 'gap' });
    } catch (err) {
      console.error(`Failed to generate gap context for ${gap.name}:`, err.message);
    }
  }

  const completionPct = calculateCompletion(codebaseModel);
  send({ type: 'progress', phase: 'context-done', message: `Generated ${contextFiles.length} context files` });
  return { contextFiles, completionPct };
}

async function generateAppContextLegacy(analysisId, cacheablePrefix, cachedFilesUsed) {
  const dynamicInstruction = `Generate the root .context.md file for this project.

Use the project info, stack, gaps, file tree, and key files above. Produce a comprehensive .context.md that captures the project's purpose, tech stack, current state, and what still needs to be built.`;

  const { text: fullText } = await streamMessageTracked({
    client: anthropic,
    analysisId,
    phase: 'app-context',
    targetPath: '.context.md',
    filesUsed: cachedFilesUsed,
    params: {
      model: CLAUDE_MODEL,
      max_tokens: LEGACY_MAX_TOKENS,
      system: BASE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: cacheablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamicInstruction },
        ],
      }],
    },
    onText: (_chunk, partial) => {
      broadcast(analysisId, { type: 'context-stream', path: '.context.md', partial });
    },
  });

  return fullText;
}

async function generateFeatureContextLegacy(
  analysisId, model, dirPath, cacheablePrefix, cachedFilesUsed, appContext, skeletons,
) {
  const { files: dirFiles } = selectFilesForPrompt({
    fileContents: model.fileContents || {},
    skeletons,
    purpose: 'feature_dir',
    filterFn: (p) => p.startsWith(dirPath),
    tokenBudget: 4000,
    maxFiles: 15,
  });

  if (!dirFiles.length) return null;

  const dirFilesBlock = renderFilesBlock(dirFiles);
  const dirFilesUsed = dirFiles.map((f) => f.path);

  const appContextBlock = `## Root .context.md (already generated for this project)\n${truncate(appContext || '', APP_CONTEXT_CACHE_CHARS)}`;

  const dynamicInstruction = `Generate a .context.md file for the "${dirPath}" directory.

## Files in this directory
${dirFilesBlock}

Produce a focused .context.md for this specific module. Include purpose, constraints, decisions, and dependencies. Reference the project-wide info above as needed.`;

  const response = await createMessageTracked({
    client: anthropic,
    analysisId,
    phase: 'feature-context',
    targetPath: dirPath,
    filesUsed: [...cachedFilesUsed, ...dirFilesUsed],
    params: {
      model: CLAUDE_MODEL,
      max_tokens: LEGACY_MAX_TOKENS,
      system: BASE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: cacheablePrefix,   cache_control: { type: 'ephemeral' } },
          { type: 'text', text: appContextBlock,   cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamicInstruction },
        ],
      }],
    },
  });

  return response.content?.[0]?.text || '';
}

async function generateGapContextLegacy(analysisId, gap, cacheablePrefix, cachedFilesUsed, appContext) {
  const appContextBlock = `## Root .context.md (already generated for this project)\n${truncate(appContext || '', APP_CONTEXT_CACHE_CHARS)}`;

  const dynamicInstruction = `This codebase is MISSING: ${gap.name}

Generate a PRESCRIPTIVE .context.md that specifies what should be built.

## Gap Details
${gap.description}

## Requirements
The .context.md should tell an AI tool exactly what to build:
- What the capability needs to do
- Recommended approach for this tech stack (use the stack info above)
- Constraints that must be respected
- Common pitfalls to avoid
- How it connects to existing code (reference the key files above)
- Specific files that need to be created or modified

This is a PRESCRIPTIVE spec, not documentation of existing code.`;

  const { text: fullText } = await streamMessageTracked({
    client: anthropic,
    analysisId,
    phase: 'gap-context',
    targetPath: gap.path,
    filesUsed: cachedFilesUsed,
    params: {
      model: CLAUDE_MODEL,
      max_tokens: LEGACY_MAX_TOKENS,
      system: BASE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: cacheablePrefix,   cache_control: { type: 'ephemeral' } },
          { type: 'text', text: appContextBlock,   cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamicInstruction },
        ],
      }],
    },
    onText: (_chunk, partial) => {
      broadcast(analysisId, { type: 'context-stream', path: gap.path, partial });
    },
  });

  return fullText;
}

// ── Plan helpers (unchanged public behavior) ────────────────────

// Dirs we never want to author context for — build artifacts, vendored code,
// or the user's own snapshot of legacy material. Mirrors analyzer.js SKIP_DIRS
// closely so the two stay in sync.
const FEATURE_DIR_SKIP_ROOTS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.cache', 'coverage', '.turbo', '.vercel', 'vendor',
  '.svelte-kit', 'target', 'out', '.expo', 'archive', '.venv', 'venv',
]);

// Roots that act as monorepo / framework containers — depth-1 under them is
// almost never the actual "feature"; depth-2 is. So `app/server` and
// `app/client/src/pages` are real features, but `app` itself isn't.
const FEATURE_DIR_NESTED_ROOTS = new Set([
  'src', 'app', 'server', 'client', 'lib', 'api', 'pages', 'components', 'packages',
]);

// Bucket a file path to its canonical "feature dir". Returns null if the file
// lives somewhere we should skip entirely (root, build dir, etc.).
function featureDirOf(p) {
  const parts = p.split('/');
  if (parts.length < 2) return null;
  if (FEATURE_DIR_SKIP_ROOTS.has(parts[0])) return null;

  // For nested roots (`app`, `src`, …) descend one level deeper so the dir is
  // actually the feature module rather than the container. For deep monorepos
  // like CodeGuru this catches `app/server`, `app/client`, `packages/auth`,
  // etc. — the previous heuristic only kept the FIRST `app/X` it saw because
  // of a `seen.has(topDir)` early-exit, so the bulk of the codebase was
  // invisible to context generation.
  if (FEATURE_DIR_NESTED_ROOTS.has(parts[0])) {
    if (parts.length < 3) return null;
    // Go one level deeper for nested-root-of-nested-root patterns like
    // `app/client/src/...` so the canonical bucket is `app/client/src` —
    // otherwise the entire client tree collapses into a single context file.
    if (FEATURE_DIR_NESTED_ROOTS.has(parts[1]) && parts.length >= 4) {
      return `${parts[0]}/${parts[1]}/${parts[2]}`;
    }
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

// Max dirs to ship to Claude in a single delimited call. Stays well under the
// 20K max_tokens cap so we don't trigger the retry path unnecessarily, and
// keeps the prompt size manageable.
const FEATURE_DIR_MAX = 10;
// Minimum file count to qualify a dir. A 1-file dir is rarely worth a full
// .context.md — it usually devolves to "this file does X".
const FEATURE_DIR_MIN_FILES = 2;

function identifyFeatureDirs(model, skeletons = {}) {
  const fileContents = model.fileContents || {};
  const fileTree = Array.isArray(model.fileTree) ? model.fileTree : Object.keys(fileContents);

  // Recompute the import graph from the in-memory full-tier files. analyzer.js
  // already computed and persisted this once for ranking purposes, but
  // threading it through codebaseModel would couple two layers; recomputing on
  // ~50 files is sub-100ms and keeps the call self-contained.
  let graph;
  try {
    graph = computeImportGraph(fileContents);
  } catch (err) {
    console.warn(`[context-generator] import graph for feature-dir scoring failed: ${err.message}`);
    graph = new Map();
  }

  // Aggregate per-dir from the FULL fileTree so dirs aren't scored against the
  // ~50-file selector sample. Centrality comes from the import graph (which
  // only knows about full-tier files) — sparse but the best signal we have.
  // We separately track whether the dir has *any* renderable content
  // (fileContents OR skeleton) — without that, the section plan's per-dir
  // selectFilesForPrompt call would drop the dir, so there's no point
  // suggesting it.
  const dirStats = new Map();
  const skeletonsSet = new Set(Object.keys(skeletons || {}));

  for (const filePath of fileTree) {
    const dir = featureDirOf(filePath);
    if (!dir) continue;
    const stat = dirStats.get(dir) || {
      fileCount: 0, inboundSum: 0, outboundSum: 0, renderableCount: 0,
    };
    stat.fileCount += 1;
    if (fileContents[filePath] || skeletonsSet.has(filePath)) stat.renderableCount += 1;
    const node = graph.get(filePath);
    if (node) {
      stat.inboundSum  += node.inboundDegree  || 0;
      stat.outboundSum += node.outboundDegree || 0;
    }
    dirStats.set(dir, stat);
  }

  // Score: file count is the primary signal (a fat dir is meaty regardless of
  // who imports it). Inbound traffic boosts dirs that everything else depends
  // on. Outbound contributes a smaller boost since "imports a lot" loosely
  // indicates an orchestrator / glue module. Use log on fileCount so a
  // 200-file dir doesn't completely drown a 10-file hub.
  const scored = [];
  for (const [dir, stat] of dirStats) {
    if (stat.fileCount < FEATURE_DIR_MIN_FILES) continue;
    if (stat.renderableCount < 1) continue;
    const score =
      4 * Math.log2(1 + stat.fileCount) +
      2 * Math.log2(1 + stat.inboundSum) +
      1 * Math.log2(1 + stat.outboundSum);
    scored.push({
      dir, score,
      fileCount: stat.fileCount,
      renderableCount: stat.renderableCount,
      inboundSum: stat.inboundSum,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, FEATURE_DIR_MAX).map((s) => s.dir);
}

function identifyActionableGaps(model) {
  const gaps = [];
  const g = model.gaps;

  if (!g.auth.exists) {
    gaps.push({
      name: 'Authentication',
      path: 'src/auth/.context.md',
      description: `No authentication system detected. Stack: ${model.stack.framework || 'Unknown'}, Runtime: ${model.stack.runtime || 'Unknown'}`,
    });
  }

  if (!g.database.exists) {
    gaps.push({
      name: 'Database',
      path: 'src/database/.context.md',
      description: `No database configuration detected. The app likely needs persistent storage for user data and application state.`,
    });
  }

  if (!g.deployment.exists) {
    gaps.push({
      name: 'Deployment',
      path: 'deploy/.context.md',
      description: `No deployment configuration found. No CI/CD pipeline, no hosting platform config, no containerization.`,
    });
  }

  if (!g.testing.exists) {
    gaps.push({
      name: 'Testing',
      path: 'tests/.context.md',
      description: `No test files detected. The codebase has no automated testing strategy.`,
    });
  }

  if (!g.errorHandling.exists) {
    gaps.push({
      name: 'Error Handling',
      path: 'src/error-handling/.context.md',
      description: `No global error handling strategy detected. Missing error boundaries, global error handlers, or structured error responses.`,
    });
  }

  return gaps;
}

function calculateCompletion(model) {
  const categories = {
    ui: 40,
    routing: 10,
    api: 15,
    auth: 10,
    database: 10,
    deployment: 10,
    testing: 5,
  };

  let earned = 0;
  const g = model.gaps;
  const paths = model.fileTree;

  const hasUI = paths.some((p) => /\.(tsx|jsx|vue|svelte)$/.test(p));
  if (hasUI) earned += categories.ui;

  const hasRouting = paths.some((p) => /route|page|app\.(tsx|jsx)/i.test(p));
  if (hasRouting) earned += categories.routing;

  const hasAPI = paths.some((p) => /api|route|controller|endpoint/i.test(p));
  if (hasAPI) earned += categories.api;

  if (g.auth.exists) earned += categories.auth;
  if (g.database.exists) earned += categories.database;
  if (g.deployment.exists) earned += categories.deployment;
  if (g.testing.exists) earned += categories.testing;

  return earned;
}

module.exports = {
  generateContextFiles,
  calculateCompletion,
  // Exposed for tests / future reuse. Not part of the route surface.
  createSectionParser,
  buildSectionPlan,
  buildCacheablePrefix,
  identifyFeatureDirs,
  identifyActionableGaps,
};
