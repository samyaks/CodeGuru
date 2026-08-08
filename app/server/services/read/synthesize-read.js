/**
 * The Read — claim synthesis.
 *
 * ONE bounded Claude call drafts the three claims of "the read":
 *   objective — what the product does
 *   audience  — who it's for (nearly always the least code-grounded claim,
 *               so it carries a structured alternative for the user to settle)
 *   core_job  — the one thing it can't get wrong (the most load-bearing
 *               invariant read from the code)
 *
 * The prompt is code-grounded: alongside the product map and invariants it
 * carries real source excerpts (inputs.codeSlice, budgeted upstream by
 * code-slice.js), any human-settled claims (ground truth the other claims
 * must stay coherent with), and — when pick-core-job found one — the exact
 * invariant the core_job claim must phrase.
 *
 * Confidence is NOT the model's self-score: after parsing we resolve the
 * model's evidence hints against real data (source-slice paths, invariant
 * links, map entities), verify every cited path via read-confidence's
 * verifyEvidence, and score each claim with the verified evidence only.
 *
 * Pure service: no DB, no Express. The orchestrator (run-read.js) persists.
 */

const { CLAUDE_MODEL, anthropic, truncate } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { verifyEvidence, scoreClaimConfidence } = require('./read-confidence');

const SLOTS = ['objective', 'audience', 'core_job'];
const MAX_INVARIANTS = 8;
const MAX_EVIDENCE = 3;
const FEATURES_CAP = 1500;
const DESCRIPTION_CAP = 400;
const MAX_TOKENS = 2000; // source-grounded evidence hints run longer

const SYSTEM_PROMPT = `You are the editor of "the read" — a short, plain-prose account of what an app is, drafted from its code and set in type for its builder to correct.

You will be given what we actually know about a repo: its domain, personas and their jobs (with priorities), guarantees extracted from the code (invariants, each tied to real files), source code excerpts from the repo's most load-bearing files, a features summary, and the repo description.

Draft exactly THREE claims. Each is a lowercase-leading phrase that must fit this sentence template:
  "<Name> {objective}. It's for {audience} — and the one thing it can't get wrong is {core_job}."

- objective: what it does, in one warm plain phrase (e.g. "helps people build lasting habits through fast daily check-ins")
- audience: who it's really for (e.g. "someone improving on their own"). Code rarely proves this — so ALSO offer two alternative worlds the builder can choose between, and say what each implies for the build.
- core_job: the single most load-bearing guarantee from the provided invariants, phrased as the thing it can't get wrong (e.g. "letting them log a habit in under ten seconds")

Grounding rules:
- evidenceHints MUST cite file paths that appear in the provided source code excerpts or invariant links ONLY — never invent a path. For each claim, cite the 1-3 files that most directly support it. (Persona/job names from the inputs are also acceptable hints for the audience claim.)
- If a "Settled claims" section appears, the builder has personally corrected those claims. Treat them as ground truth and keep the other claims consistent with them. Still return all three claims.
- If a "Core job (already decided)" section appears, the core_job claim MUST be a plain-language phrasing of that specific guarantee — not a free choice among the invariants.

Voice: an editor writing for a non-engineer. No jargon, no marketing copy. Say only what the inputs support.

Respond with ONLY a JSON object, no prose, no fences:
{
  "claims": [
    { "slot": "objective", "text": "...", "evidenceHints": ["file paths, symbols, or persona/job names from the inputs that support this"] },
    { "slot": "audience", "text": "...", "evidenceHints": ["..."],
      "alternative": {
        "question": "Who's this really for? This decides what has to be true before launch.",
        "options": [
          { "id": "a", "label": "short world name", "detail": "what this world implies for the build", "claimText": "lowercase phrase to swap into the sentence" },
          { "id": "b", "label": "...", "detail": "...", "claimText": "..." }
        ]
      }
    },
    { "slot": "core_job", "text": "...", "evidenceHints": ["..."] }
  ]
}`;

function baseName(filePath) {
  const parts = String(filePath || '').split('/');
  return parts[parts.length - 1] || String(filePath || '');
}

// ── prompt assembly ────────────────────────────────────────────────

function topInvariants(invariants) {
  const list = Array.isArray(invariants) ? invariants.filter((i) => i && i.text) : [];
  return [...list]
    .sort((a, b) => (typeof b.confidence === 'number' ? b.confidence : 0) - (typeof a.confidence === 'number' ? a.confidence : 0))
    .slice(0, MAX_INVARIANTS);
}

function formatInvariants(invariants) {
  if (invariants.length === 0) return '(none extracted)';
  return invariants
    .map((inv, i) => {
      const links = (inv.links || [])
        .map((l) => `${l.file_path}${l.symbol ? `:${l.symbol}` : ''}`)
        .join(', ');
      const holds = inv.satisfied === false ? 'BROKEN in code' : inv.satisfied === true ? 'holds in code' : 'unverified';
      return `${i + 1}. ${inv.text} [${inv.kind || 'behavior'}, ${holds}${links ? `, from: ${links}` : ''}]`;
    })
    .join('\n');
}

function formatMap(map) {
  if (!map) return 'Domain: (no product map)';
  const personas = (map.personas || [])
    .slice(0, 6)
    .map((p) => `- ${p.emoji || ''} ${p.name} (${p.priority || 'medium'} priority)`.trim())
    .join('\n');
  const personaName = new Map((map.personas || []).map((p) => [p.id, p.name]));
  const jobs = (map.jobs || [])
    .slice(0, 12)
    .map((j) => `- ${j.title} (${j.priority || 'medium'} priority, for ${personaName.get(j.persona_id) || 'user'})`)
    .join('\n');
  return [
    `Domain: ${map.domain || 'General'}`,
    personas ? `Personas:\n${personas}` : 'Personas: (none)',
    jobs ? `Jobs:\n${jobs}` : 'Jobs: (none)',
  ].join('\n');
}

// The slice arrives already budgeted by code-slice.js — embed it as given.
function formatCodeSlice(codeSlice) {
  const files = codeSlice && Array.isArray(codeSlice.files) ? codeSlice.files : [];
  const usable = files.filter((f) => f && f.path && typeof f.text === 'string' && f.text);
  if (usable.length === 0) return null;
  return usable.map((f) => `--- ${f.path} (${f.kind || 'full'}) ---\n${f.text}`).join('\n\n');
}

function formatSettledClaims(settledClaims) {
  const list = Array.isArray(settledClaims)
    ? settledClaims.filter((c) => c && c.slot && c.text)
    : [];
  if (list.length === 0) return null;
  return list.map((c) => `- ${c.slot}: "${c.text}"`).join('\n');
}

function formatCoreJobDirective(candidate) {
  const inv = candidate && candidate.invariant;
  if (!inv || !inv.text) return null;
  const links = (Array.isArray(inv.links) ? inv.links : [])
    .map((l) => {
      const fp = l && (l.file_path || l.filePath);
      return fp ? `${fp}${l.symbol ? `:${l.symbol}` : ''}` : null;
    })
    .filter(Boolean)
    .join(', ');
  const lines = [`"${inv.text}"`];
  if (links) lines.push(`Linked files: ${links}`);
  if (candidate.job && candidate.job.title) {
    lines.push(`Serves the job: ${candidate.job.title}${candidate.personaName ? ` (for ${candidate.personaName})` : ''}`);
  }
  return lines.join('\n');
}

function buildUserContent(inputs, invariants) {
  const parts = [
    formatMap(inputs.map),
    '',
    'Guarantees read from the code (invariants):',
    formatInvariants(invariants),
  ];
  const sourceBlock = formatCodeSlice(inputs.codeSlice);
  if (sourceBlock) {
    parts.push('', 'Source code excerpts (real files from this repo — cite these paths in evidenceHints):', sourceBlock);
  }
  const settledBlock = formatSettledClaims(inputs.settledClaims);
  if (settledBlock) {
    parts.push(
      '',
      'Settled claims — the builder has personally settled these; treat them as ground truth and keep the other claims consistent with them:',
      settledBlock
    );
  }
  const coreJobBlock = formatCoreJobDirective(inputs.coreJobCandidate);
  if (coreJobBlock) {
    parts.push(
      '',
      'Core job (already decided) — the core_job claim must be a plain-language phrasing of THIS specific guarantee, not a free choice:',
      coreJobBlock
    );
  }
  if (inputs.featuresSummary) {
    parts.push('', 'Features summary:', truncate(inputs.featuresSummary, FEATURES_CAP));
  }
  if (inputs.repoDescription) {
    parts.push('', `Repo description: ${truncate(inputs.repoDescription, DESCRIPTION_CAP)}`);
  }
  if (typeof inputs.fileCount === 'number') {
    parts.push('', `Repo size: ${inputs.fileCount} files analyzed.`);
  }
  return parts.join('\n');
}

// ── parsing ────────────────────────────────────────────────────────

function normalizeAlternative(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = String(raw.question || '').trim();
  const optionsIn = Array.isArray(raw.options) ? raw.options : [];
  const options = [];
  for (const o of optionsIn) {
    if (!o || typeof o !== 'object') continue;
    const label = String(o.label || '').trim();
    const claimText = String(o.claimText || '').trim();
    if (!label || !claimText) continue;
    options.push({
      id: String(o.id || '').trim() || `opt-${options.length + 1}`,
      label,
      detail: String(o.detail || '').trim(),
      claimText,
    });
    if (options.length === 2) break;
  }
  if (!question || options.length < 2) return null;
  return { question, options };
}

/**
 * Parse the model response into one raw claim per slot.
 * Throws a descriptive Error when the response is unusable — the
 * orchestrator catches it.
 */
function parseReadClaims(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(String(rawText || '')));
  } catch (err) {
    throw new Error(`Read synthesis returned unparsable JSON: ${err.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.claims) ? parsed.claims : null;
  if (!list) {
    throw new Error('Read synthesis response has no "claims" array');
  }

  const bySlot = {};
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const slot = String(raw.slot || '').trim();
    if (!SLOTS.includes(slot) || bySlot[slot]) continue;
    const text = String(raw.text || '').trim();
    if (!text) continue;
    bySlot[slot] = {
      slot,
      text,
      evidenceHints: Array.isArray(raw.evidenceHints)
        ? raw.evidenceHints.map((h) => String(h || '').trim()).filter(Boolean)
        : [],
      alternative: slot === 'audience' ? normalizeAlternative(raw.alternative) : null,
    };
  }

  const missing = SLOTS.filter((s) => !bySlot[s]);
  if (missing.length > 0) {
    throw new Error(`Read synthesis response is missing claim slot(s): ${missing.join(', ')}`);
  }
  return bySlot;
}

// ── evidence resolution ────────────────────────────────────────────

function collectInvariantLinks(invariants) {
  const out = [];
  const seen = new Set();
  for (const inv of invariants) {
    for (const link of Array.isArray(inv.links) ? inv.links : []) {
      const fp = link && (link.file_path || link.filePath);
      if (!fp) continue;
      const key = `${fp}::${link.symbol || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ filePath: fp, symbol: link.symbol || null, invariant: inv });
    }
  }
  return out;
}

function hintMatchesLink(hint, link) {
  const h = hint.toLowerCase();
  const fp = link.filePath.toLowerCase();
  const base = baseName(link.filePath).toLowerCase();
  const sym = (link.symbol || '').toLowerCase();
  return fp.includes(h) || h.includes(base) || (sym && (sym === h || h.includes(sym)));
}

function hintMatchesPath(hint, filePath) {
  const h = hint.toLowerCase();
  const fp = filePath.toLowerCase();
  const base = baseName(filePath).toLowerCase();
  return fp.includes(h) || h.includes(base);
}

function slicePathsOf(codeSlice) {
  return codeSlice && Array.isArray(codeSlice.knownPaths)
    ? codeSlice.knownPaths.filter((p) => typeof p === 'string' && p)
    : [];
}

function entityPathsOf(map) {
  const out = [];
  for (const ent of Array.isArray(map && map.entities) ? map.entities : []) {
    const fp = ent && (ent.file_path || ent.filePath);
    if (fp) out.push(fp);
  }
  return out;
}

function groundedNote(entry, { sure }) {
  const where = `${baseName(entry.filePath)}${entry.symbol ? ` (${entry.symbol})` : ''}`;
  return sure
    ? `Read plainly from ${where} — we're sure of this one.`
    : `Read from ${where}.`;
}

// Flag entries via read-confidence's verifier; tolerate a defensive miss.
function withVerification(entries, verifyCtx) {
  const flagged = verifyEvidence(entries, verifyCtx);
  return Array.isArray(flagged) ? flagged : entries;
}

// Only entries whose cited path actually verifies survive — a matched-but-
// unverified path must not be presented as something we read from the code.
function verifiedOnly(entries, verifyCtx) {
  return withVerification(entries, verifyCtx).filter((e) => e && e.verified);
}

function finalizeGrounded(entries, { sure }) {
  return entries.slice(0, MAX_EVIDENCE).map((e) => ({ ...e, note: groundedNote(e, { sure }) }));
}

/**
 * Resolve a code-grounded claim's evidence: match the model's hints against
 * the source-slice paths and invariant links, verify every cited path, and
 * only fall back to honest "we're guessing" prose when nothing verifies.
 */
function resolveCodeEvidence(claim, ctx) {
  const { allLinks, invariants, slicePaths, verifyCtx } = ctx;

  const candidates = [];
  const seenPaths = new Set();
  const seenKeys = new Set();
  const add = (filePath, symbol) => {
    const key = `${filePath}::${symbol || ''}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    seenPaths.add(filePath);
    candidates.push({ filePath, symbol: symbol || null });
  };

  // Invariant links first (they carry symbols), then bare slice paths.
  for (const link of allLinks) {
    if (claim.evidenceHints.some((h) => hintMatchesLink(h, link))) add(link.filePath, link.symbol);
  }
  for (const p of slicePaths) {
    if (seenPaths.has(p)) continue;
    if (claim.evidenceHints.some((h) => hintMatchesPath(h, p))) add(p, null);
  }

  const matched = verifiedOnly(candidates, verifyCtx);
  if (matched.length > 0) {
    return finalizeGrounded(matched, { sure: matched.length >= 2 });
  }

  // Fallback: the most load-bearing invariant's own links (invariants arrive
  // sorted by confidence, so the first with links wins) — still verified.
  const anchor = invariants.find((inv) => Array.isArray(inv.links) && inv.links.length > 0);
  if (anchor) {
    const anchorEntries = verifiedOnly(
      collectInvariantLinks([anchor]).map((l) => ({ filePath: l.filePath, symbol: l.symbol })),
      verifyCtx
    );
    if (anchorEntries.length > 0) {
      return finalizeGrounded(anchorEntries, { sure: false });
    }
  }

  return withVerification(
    [
      {
        filePath: null,
        symbol: null,
        note: 'Drafted from the shape of the code — no single file pins this down. Worth your eyes.',
      },
    ],
    verifyCtx
  );
}

function resolveAudienceEvidence(claim, map) {
  const personas = (map && map.personas) || [];
  const jobs = (map && map.jobs) || [];
  const entities = (map && map.entities) || [];
  const hints = claim.evidenceHints.map((h) => h.toLowerCase());

  // A map entity with a real file that the model pointed at — rare, but real.
  const entityHit = entities.find((e) => {
    const fp = e && (e.file_path || e.filePath);
    if (!fp) return false;
    const label = String(e.label || e.key || '').toLowerCase();
    return hints.some((h) => fp.toLowerCase().includes(h) || (label && (h.includes(label) || label.includes(h))));
  });
  if (entityHit) {
    const fp = entityHit.file_path || entityHit.filePath;
    return [
      {
        filePath: fp,
        symbol: null,
        note: `Read from ${baseName(fp)} — the surface this persona actually touches.`,
      },
    ];
  }

  // Otherwise this is an inference from persona/job names alone — say so.
  const persona =
    personas.find((p) => hints.some((h) => String(p.name || '').toLowerCase().includes(h) || h.includes(String(p.name || '').toLowerCase()))) ||
    personas.find((p) => p.priority === 'high') ||
    personas[0] ||
    null;
  const job = persona ? jobs.find((j) => j.persona_id === persona.id) : null;
  const basis = persona
    ? `Inferred from the ${persona.name} persona${job ? ` and their job "${job.title}"` : ''}.`
    : 'Inferred from the overall shape of the app.';
  return [
    {
      filePath: null,
      symbol: null,
      note: `We're guessing. ${basis} Nothing in the code proves who it's for — but absence isn't proof. Worth your eyes.`,
    },
  ];
}

// ── main entry ─────────────────────────────────────────────────────

/**
 * Draft the three claims of "the read" from analysis outputs.
 *
 * @param {object} inputs - { projectId, map, invariants, featuresSummary,
 *                            repoDescription, fileCount, stack,
 *                            codeSlice, settledClaims, coreJobCandidate }
 *   codeSlice        - buildCodeSlice output ({ files, knownPaths, ... });
 *                      null or source:'empty' degrades to map-only prompting
 *   settledClaims    - [{ slot, text }] human-settled claims (may be empty)
 *   coreJobCandidate - pickCoreJob output or null
 * @param {object} [opts] - { client } optional Anthropic client override
 * @returns {Promise<{claims: Array}>} exactly three claims
 *          (slots: objective, audience, core_job)
 */
async function synthesizeRead(inputs, opts = {}) {
  if (!inputs || !inputs.projectId) {
    throw new Error('synthesizeRead requires inputs.projectId');
  }

  const invariants = topInvariants(inputs.invariants);
  const userContent = buildUserContent(inputs, invariants);

  let response;
  try {
    response = await createMessageTracked({
      client: opts.client || anthropic,
      analysisId: inputs.projectId,
      phase: 'read.synthesize',
      params: {
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      },
    });
  } catch (err) {
    throw new Error(`Read synthesis Claude call failed: ${err.message}`);
  }

  const bySlot = parseReadClaims(extractText(response));

  const allLinks = collectInvariantLinks(invariants);
  const slicePaths = slicePathsOf(inputs.codeSlice);
  const verifyCtx = {
    // Slice paths plus map-entity paths: both come from the analyzer, so an
    // audience claim citing an entity's file still verifies as real.
    knownPaths: [...new Set([...slicePaths, ...entityPathsOf(inputs.map)])],
    invariantLinks: allLinks.map((l) => ({ filePath: l.filePath, symbol: l.symbol })),
  };

  const claims = SLOTS.map((slot) => {
    const raw = bySlot[slot];
    const evidence =
      slot === 'audience'
        ? withVerification(resolveAudienceEvidence(raw, inputs.map), verifyCtx)
        : resolveCodeEvidence(raw, { allLinks, invariants, slicePaths, verifyCtx });
    return {
      slot,
      text: raw.text,
      confidence: scoreClaimConfidence({ slot, evidence }),
      evidence,
      alternative: raw.alternative,
    };
  });

  return { claims };
}

module.exports = {
  synthesizeRead,
  parseReadClaims,
  collectInvariantLinks,
  resolveCodeEvidence,
  resolveAudienceEvidence,
  topInvariants,
  buildUserContent,
  SYSTEM_PROMPT,
};
