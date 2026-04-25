const { CLAUDE_MODEL, anthropic } = require('../lib/constants');
const { createMessageTracked } = require('../lib/anthropic-tracked');
const { AppError } = require('../lib/app-error');

const EXTRACT_PROMPT = `You are a product strategist analyzing an app description.
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
- Extract 2-4 personas (the distinct user types)
- Extract 3-8 jobs per persona (what they need to accomplish)
- Priority: "high" = core value prop, "medium" = important but secondary,
  "low" = nice to have
- Jobs should be concrete actions, not vague goals
- Use emoji that matches the persona's role
- If the description mentions specific features, map them to jobs

Respond ONLY with the JSON object, no markdown, no preamble.`;

function stripJsonFence(text) {
  if (!text) return '';
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * @param {string} description
 * @param {string} [analysisId] — for LLM usage tracking
 */
async function extractProductIntent(description, analysisId = null) {
  const response = await createMessageTracked({
    client: anthropic,
    analysisId: analysisId || 'map-extract',
    phase: 'extract-intent',
    params: {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: EXTRACT_PROMPT,
      messages: [{ role: 'user', content: description }],
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

module.exports = { extractProductIntent, stripJsonFence };
