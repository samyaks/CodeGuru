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

Output a Cursor prompt that another AI agent can execute. The prompt MUST:
- Open with a one-line goal statement
- Include a "Context:" section with the relevant project facts
- Include a numbered "Requirements:" list with concrete steps
- Include exact file paths and module names where relevant
- End with verification criteria the agent can self-check

Do NOT speak to the user. Speak to the AI agent that will implement the gap.
Keep the prompt under ~60 lines, plain markdown, no code fences around the
whole prompt.`;

function buildUserMessage({ project, gap }) {
  const stack = project?.stack_info || project?.stack || {};
  const stackLines = Object.entries(stack)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');

  const files = Array.isArray(gap.affectedFiles) && gap.affectedFiles.length
    ? gap.affectedFiles.slice(0, 25).join('\n  - ')
    : '(unspecified)';

  return [
    `Project: ${project?.repo || project?.repo_url || 'unnamed'}`,
    stackLines ? `Stack:\n${stackLines}` : null,
    '',
    `Gap category: ${gap.category}`,
    `Title: ${gap.title}`,
    `Description: ${gap.description}`,
    `Effort estimate: ${gap.effort || 'unknown'}`,
    `Affected files (${Array.isArray(gap.affectedFiles) ? gap.affectedFiles.length : 0}):`,
    `  - ${files}`,
    '',
    'Write the Cursor prompt now.',
  ].filter(Boolean).join('\n');
}

/**
 * Generate a Cursor prompt for a gap. Returns the generated text. Caller is
 * responsible for caching back onto the suggestions row.
 */
async function generateCursorPrompt({ project, gap, refineInstructions }) {
  const baseUser = buildUserMessage({ project, gap });
  const userMessage = refineInstructions
    ? `${baseUser}\n\nUser refinement instructions (apply these before producing the prompt):\n${refineInstructions}`
    : baseUser;

  const response = await createMessageTracked({
    phase: refineInstructions ? 'v2.gap.refine' : 'v2.gap.prompt',
    targetPath: gap.id,
    params: {
      // The literal `claude-3-5-sonnet-latest` alias was retired by
      // Anthropic, so we fall back to the canonical CLAUDE_MODEL
      // (currently claude-sonnet-4-20250514) which is shared with the
      // rest of the app. V2_CURSOR_PROMPT_MODEL still overrides per-phase.
      model: process.env.V2_CURSOR_PROMPT_MODEL || CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    },
  });

  const text = (response?.content || [])
    .map((block) => (block?.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  return text;
}

module.exports = { generateCursorPrompt };
