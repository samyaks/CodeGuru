/**
 * The Read — "so the next thing to build".
 *
 * Two steps:
 *   1. pickNextCandidate(inputs) — deterministic, pure, unit-testable pick of
 *      THE one thing standing between the app and its first real user.
 *      Priority: missing auth on a multi-user read > critical security
 *      finding > highest-weight missing readiness category > top gap.
 *   2. ONE Claude call that writes the editorial copy for that candidate:
 *      a short title, a plain-language why (conditioned on the claims the
 *      person has settled — corrections MUST change the copy), and a
 *      numbered builder prompt written for the actual stack.
 *
 * Pure service: no DB, no Express.
 */

const { CLAUDE_MODEL, anthropic, truncate } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');

const GAP_CAP = 5;
const FINDING_CAP = 5;

const SYSTEM_PROMPT = `You write the "next thing to build" for "the read" — a plain-prose account of an app, drafted from its code, that its builder has just corrected.

You are given: the ONE thing to build next (already decided — do not pick a different thing), the claims the person has settled as true about their app (including their own corrections), the app's actual stack, and supporting detail.

Write three pieces:
- "title": short and editorial, like a headline set in type. E.g. "A way to tell its people apart." Not a task name ("Add authentication") — a sentence fragment about what the app is missing.
- "why": 2-3 sentences, plain language a non-engineer follows. It MUST take the settled claims seriously — if the person corrected who the app is for, the why has to reckon with what that changes (e.g. if they said people share data, sharing is now the heart of the argument).
- "prompt": the exact instructions to hand a builder (an AI coding agent). Start with the headline action, then numbered steps. Reference the ACTUAL stack and real names from the inputs — e.g. "Add Supabase Auth to Loop, using the existing supabase client in lib/db.ts. 1. Add email magic-link sign-in... 2. ... 3. Turn on row-level security so a person can read and write only their own rows."

Respond with ONLY a JSON object, no prose, no fences:
{ "title": "...", "why": "...", "prompt": "..." }`;

// ── step 1: deterministic candidate pick ──────────────────────────

function isMultiUser(map) {
  return Boolean(map && Array.isArray(map.personas) && map.personas.length > 1);
}

function missingCategories(readiness) {
  const cats = readiness && readiness.categories ? readiness.categories : {};
  return Object.entries(cats)
    .filter(([, c]) => c && c.status === 'missing')
    .sort((a, b) => (b[1].weight || 0) - (a[1].weight || 0));
}

/**
 * Pick THE one thing to build next. Pure and deterministic — no LLM.
 *
 * @param {object} inputs - { projectId, readiness, gaps, securityFindings, stack, map }
 * @returns {{ kind: string, category: string, headline: string, detail: object|null }}
 */
function pickNextCandidate(inputs) {
  const { readiness, gaps, securityFindings, map } = inputs || {};

  const authMissing =
    readiness &&
    readiness.categories &&
    readiness.categories.auth &&
    readiness.categories.auth.status === 'missing';

  // 1. No auth while the read says multiple kinds of people use it: every
  //    row is readable by anyone who asks. Nothing else matters until fixed.
  if (authMissing && isMultiUser(map)) {
    return {
      kind: 'auth_multi_user',
      category: 'auth',
      headline:
        'The app has no sign-in, but its read says more than one kind of person uses it — it cannot tell its people apart.',
      detail: {
        personas: (map.personas || []).map((p) => p.name),
        readinessDetail: readiness.categories.auth.detail || null,
      },
    };
  }

  // 2. A detector-backed security finding is a hole in the hull.
  const findings = Array.isArray(securityFindings) ? securityFindings.filter(Boolean) : [];
  if (findings.length > 0) {
    const f = findings[0];
    return {
      kind: 'security_finding',
      category: 'security',
      headline: `A security detector flagged: ${f.title || f.detector}${f.file ? ` (in ${f.file})` : ''}.`,
      detail: f,
    };
  }

  // 3. The heaviest missing readiness category.
  const missing = missingCategories(readiness);
  if (missing.length > 0) {
    const [key, cat] = missing[0];
    return {
      kind: 'readiness_category',
      category: key,
      headline: `${cat.label || key} is missing entirely${cat.detail ? ` — ${cat.detail.toLowerCase()}` : ''}.`,
      detail: cat,
    };
  }

  // 4. The top open gap.
  const gapList = Array.isArray(gaps) ? gaps.filter(Boolean) : [];
  if (gapList.length > 0) {
    const g = gapList[0];
    return {
      kind: 'gap',
      category: g.category || 'general',
      headline: g.title || 'The top open gap in the analysis.',
      detail: g,
    };
  }

  // 5. Nothing structural is missing — the next thing is a real user.
  return {
    kind: 'polish',
    category: 'general',
    headline: 'Nothing structural is missing — the next thing is putting it in front of a real person.',
    detail: null,
  };
}

// ── step 2: the editorial copy ─────────────────────────────────────

function formatSettledClaims(settledClaims) {
  const list = Array.isArray(settledClaims) ? settledClaims.filter((c) => c && c.slot && c.text) : [];
  if (list.length === 0) return '(none settled yet — the draft stands as written)';
  return list
    .map((c) => {
      const corrected = c.source && c.source !== 'inferred' && c.source !== 'drafted';
      return `- ${c.slot}${corrected ? ' (CORRECTED BY THE PERSON — take this as ground truth)' : ' (drafted from code)'}: "${c.text}"`;
    })
    .join('\n');
}

function buildUserContent(inputs, settledClaims, candidate) {
  const parts = [
    'The one thing to build next (already decided — write for exactly this):',
    `- kind: ${candidate.kind}`,
    `- category: ${candidate.category}`,
    `- ${candidate.headline}`,
  ];
  if (candidate.detail) {
    parts.push(`- detail: ${truncate(JSON.stringify(candidate.detail), 600)}`);
  }

  parts.push('', 'What the person has settled as true about their app:', formatSettledClaims(settledClaims));

  if (inputs.stack) {
    parts.push('', `Actual stack (reference it by name in the prompt): ${truncate(JSON.stringify(inputs.stack), 500)}`);
  }
  if (inputs.map && inputs.map.domain) {
    parts.push('', `Domain: ${inputs.map.domain}`);
  }

  const gapList = (Array.isArray(inputs.gaps) ? inputs.gaps : []).slice(0, GAP_CAP);
  if (gapList.length > 0) {
    parts.push('', 'Other open gaps (context only):', gapList.map((g) => `- [${g.category || 'general'}] ${g.title}`).join('\n'));
  }
  const findings = (Array.isArray(inputs.securityFindings) ? inputs.securityFindings : []).slice(0, FINDING_CAP);
  if (findings.length > 0) {
    parts.push('', 'Security findings (context only):', findings.map((f) => `- ${f.detector}: ${f.title}${f.file ? ` (${f.file})` : ''}`).join('\n'));
  }
  return parts.join('\n');
}

function parseNextThing(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(String(rawText || '')));
  } catch (err) {
    throw new Error(`Next-thing generation returned unparsable JSON: ${err.message}`);
  }
  const title = parsed && typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const why = parsed && typeof parsed.why === 'string' ? parsed.why.trim() : '';
  const prompt = parsed && typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
  if (!title || !why || !prompt) {
    const missing = [!title && 'title', !why && 'why', !prompt && 'prompt'].filter(Boolean).join(', ');
    throw new Error(`Next-thing generation response is missing field(s): ${missing}`);
  }
  return { title, why, prompt };
}

/**
 * Derive the "next thing to build" from analysis inputs + settled claims.
 *
 * @param {object} inputs - { projectId, readiness, gaps, securityFindings, stack, map }
 * @param {Array<{slot: string, text: string, source: string}>} settledClaims
 *        current claims including human corrections — they condition the copy
 * @param {object} [opts] - { client } optional Anthropic client override
 * @returns {Promise<{title: string, why: string, prompt: string, category: string}>}
 */
async function deriveNextThing(inputs, settledClaims, opts = {}) {
  if (!inputs || !inputs.projectId) {
    throw new Error('deriveNextThing requires inputs.projectId');
  }

  const candidate = pickNextCandidate(inputs);
  const userContent = buildUserContent(inputs, settledClaims, candidate);

  let response;
  try {
    response = await createMessageTracked({
      client: opts.client || anthropic,
      analysisId: inputs.projectId,
      phase: 'read.next',
      params: {
        model: CLAUDE_MODEL,
        // The builder prompt alone can run several hundred tokens; 1200 was
        // observed truncating mid-JSON on a real project.
        max_tokens: 2500,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      },
    });
  } catch (err) {
    throw new Error(`Next-thing Claude call failed: ${err.message}`);
  }

  const copy = parseNextThing(extractText(response));
  return { ...copy, category: candidate.category };
}

module.exports = {
  deriveNextThing,
  pickNextCandidate,
  parseNextThing,
  SYSTEM_PROMPT,
};
