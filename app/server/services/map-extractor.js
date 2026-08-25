const { CLAUDE_MODEL, anthropic } = require('../lib/constants');
const { createMessageTracked } = require('../lib/anthropic-tracked');
const { AppError } = require('../lib/app-error');

const EXTRACT_PROMPT = `You are a product strategist analyzing an app.
You are given the app DESCRIPTION and, when available, a summary of the app's
actual CODE SURFACES (pages, routes, detected capabilities). Ground your output
in what the code actually does — every job should correspond to real
functionality present in the code, not aspirational marketing copy. When the
description and the code disagree, trust the code.

Extract the following in JSON format:

{
  "domain": "short domain label",
  "personas": [
    { "name": "...", "description": "...", "emoji": "..." }
  ],
  "jobs": [
    { "personaIndex": 0, "title": "...", "priority": "high|medium|low" }
  ]
}

Rules:
- Extract 2-4 personas (the distinct user types the code actually serves)
- Extract 3-8 jobs per persona (what they accomplish, evidenced by the code)
- Priority: "high" = core value prop, "medium" = important but secondary,
  "low" = nice to have
- Jobs should be concrete actions grounded in real pages/routes/capabilities,
  not vague goals
- Use emoji that matches the persona's role

Respond ONLY with the JSON object, no markdown, no preamble.`;

function stripJsonFence(text) {
  if (!text) return '';
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

// Compact, prompt-friendly summary of the code surfaces the map extracted, so
// persona/job derivation is grounded in real functionality rather than only the
// prose description. Pure — operates on the logical entity list from
// code-entities.js. Caps each list to keep the prompt bounded.
function summarizeCodeContext(entities, { perTypeCap = 25 } = {}) {
  const list = Array.isArray(entities) ? entities : [];
  if (list.length === 0) return '';

  const byType = { page: [], route: [], component: [], capability: [] };
  for (const e of list) {
    if (!e || !byType[e.type]) continue;
    if (e.type === 'capability') {
      const name = (e.key || e.label || '').replace(/^cap:/, '');
      if (name) byType.capability.push(`${name} (${e.status || 'present'})`);
    } else {
      const name = e.label || e.key;
      if (name) byType[e.type].push(String(name));
    }
  }

  const lines = [];
  const push = (heading, arr) => {
    const items = [...new Set(arr)].slice(0, perTypeCap);
    if (items.length) lines.push(`${heading}: ${items.join(', ')}`);
  };
  push('Pages', byType.page);
  push('Routes', byType.route);
  push('Capabilities detected', byType.capability);
  push('Components', byType.component);
  return lines.join('\n');
}

/**
 * @param {string} description
 * @param {string} [analysisId] — for LLM usage tracking
 * @param {string} [codeContext] — optional summary of real code surfaces
 *   (from summarizeCodeContext) to ground persona/job derivation.
 */
async function extractProductIntent(description, analysisId = null, codeContext = '') {
  const userContent = codeContext
    ? `App description:\n${description}\n\nActual code surfaces (ground your jobs in these):\n${codeContext}`
    : description;

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: analysisId || null,
    phase: 'extract-intent',
    params: {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: EXTRACT_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });

  const raw = response.content?.[0]?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch (_e) {
    throw AppError.badRequest('Could not parse product intent from model response');
  }

  const personas = (parsed.personas || []).map((p, i) => ({
    id: `persona:${i}`,
    name: p.name || `Persona ${i + 1}`,
    description: p.description || '',
    emoji: p.emoji || '👤',
    confirmed: false,
  }));

  const jobs = (parsed.jobs || []).map((j, i) => ({
    id: `job:${i}`,
    personaId: `persona:${Number.isInteger(j.personaIndex) ? j.personaIndex : 0}`,
    title: j.title || 'Untitled job',
    priority: ['high', 'medium', 'low'].includes(j.priority) ? j.priority : 'medium',
    weight: j.priority === 'high' ? 3 : j.priority === 'low' ? 1 : 2,
    confirmed: false,
  }));

  return {
    domain: parsed.domain || 'General',
    personas,
    jobs,
  };
}

module.exports = { extractProductIntent, stripJsonFence, summarizeCodeContext };
