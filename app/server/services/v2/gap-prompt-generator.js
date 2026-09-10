// v2 Cursor-prompt generator.
//
// When a user accepts a Gap that doesn't yet have a `cursor_prompt`, we
// generate one with Claude using the same anthropic-tracked wrapper used
// elsewhere. The result is cached on the suggestions row.

const { createMessageTracked } = require('../../lib/anthropic-tracked');
const { CLAUDE_MODEL } = require('../../lib/constants');

const SYSTEM_PROMPT = `You are an expert software engineer writing Cursor prompts.

You will be given:
- The codebase summary (stack, key files, etc.)
- A specific gap (broken thing, missing functionality, or missing infrastructure)
- Cited evidence from the actual repo (file paths, line numbers, snippets) when available

Output a Cursor prompt that another AI agent can execute. The prompt MUST:
- Open with a one-line goal statement naming the real files to change
- Include a "Context:" section with the relevant project facts AND the cited evidence
- Include a numbered "Requirements:" list with concrete steps against those files
- Include exact file paths from the evidence — never invent files, modules, or URLs
- End with verification criteria the agent can self-check

Do NOT write a generic tutorial (for example "add API_URL to .env") unless the evidence shows that work is actually missing.
If the evidence looks already-handled (env-var fallback, test fixture, docs), say so in one sentence and do not invent work.

Do NOT speak to the user. Speak to the AI agent that will implement the gap.
Keep the prompt under ~60 lines, plain markdown, no code fences around the
whole prompt.`;

// Split into project-stable prefix and gap-specific body so the prefix can
// be marked cache_control: ephemeral across calls for the same project.
function buildUserMessageParts({ project, gap }) {
  const stack = project?.stack_info || project?.stack || {};
  const stackLines = Object.entries(stack)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');

  const files = Array.isArray(gap.affectedFiles) && gap.affectedFiles.length
    ? gap.affectedFiles.slice(0, 25).join('\n  - ')
    : '(unspecified)';

  const evidenceLines = Array.isArray(gap.evidence) && gap.evidence.length
    ? gap.evidence.slice(0, 8).map((e) => {
        const loc = e.line ? `${e.file}:${e.line}` : e.file;
        const reason = e.reason ? ` — ${e.reason}` : '';
        const snippet = e.snippet ? `\n    ${String(e.snippet).replace(/\n/g, ' ').slice(0, 160)}` : '';
        return `  - ${loc}${reason}${snippet}`;
      }).join('\n')
    : '  (none — generate only from the title, description, and stack; do not invent files)';

  const projectPrefix = [
    `Project: ${project?.repo || project?.repo_url || 'unnamed'}`,
    stackLines ? `Stack:\n${stackLines}` : null,
  ].filter(Boolean).join('\n');

  const gapBody = [
    `Gap category: ${gap.category}`,
    `Title: ${gap.title}`,
    `Description: ${gap.description}`,
    `Effort estimate: ${gap.effort || 'unknown'}`,
    `Affected files (${Array.isArray(gap.affectedFiles) ? gap.affectedFiles.length : 0}):`,
    `  - ${files}`,
    `Cited evidence:`,
    evidenceLines,
    '',
    'Write the Cursor prompt now. Ground every step in the cited evidence.',
  ].join('\n');

  return { projectPrefix, gapBody };
}

/**
 * Generate a Cursor prompt for a gap. Returns the generated text. Caller is
 * responsible for caching back onto the suggestions row.
 */
async function generateCursorPrompt({ project, gap, refineInstructions, analysisId }) {
  const { projectPrefix, gapBody } = buildUserMessageParts({ project, gap });
  const dynamicBody = refineInstructions
    ? `${gapBody}\n\nUser refinement instructions (apply these before producing the prompt):\n${refineInstructions}`
    : gapBody;

  const response = await createMessageTracked({
    analysisId: analysisId || project?.id || null,
    phase: refineInstructions ? 'v2.gap.refine' : 'v2.gap.prompt',
    targetPath: gap.id,
    params: {
      // The literal `claude-3-5-sonnet-latest` alias was retired by
      // Anthropic, so we fall back to the canonical CLAUDE_MODEL
      // (currently claude-sonnet-4-20250514) which is shared with the
      // rest of the app. V2_CURSOR_PROMPT_MODEL still overrides per-phase.
      model: process.env.V2_CURSOR_PROMPT_MODEL || CLAUDE_MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: projectPrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamicBody },
        ],
      }],
    },
  });

  const text = (response?.content || [])
    .map((block) => (block?.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  return text;
}

module.exports = { generateCursorPrompt };
