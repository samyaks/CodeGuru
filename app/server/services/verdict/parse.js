'use strict';

// Strict reading of the model's verdict JSON. Anything that does not fit is an
// error, and an error is reported as "couldn't check", never as ✅. A conflict
// is only shown when its quote is really in the intent.

const { VERDICTS } = require('./prompt');

class VerdictError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isStr = (v) => typeof v === 'string';
const ABBREV = /\b(?:e\.g|i\.e|etc|vs|approx|incl|Mr|Ms|Mrs|Dr|St|No)\.$/i;

/** Keep the first `max` sentences ("e.g." and friends don't end one). */
function clampSentences(text, max = 3) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const sentences = [];
  let current = '';
  for (const piece of t.split(/(?<=[.!?])\s+/)) {
    current = current ? `${current} ${piece}` : piece;
    if (!ABBREV.test(current)) {
      sentences.push(current);
      current = '';
    }
  }
  if (current) sentences.push(current);
  return sentences.slice(0, max).join(' ').trim();
}

const norm = (t) => String(t).toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

/**
 * The intent text a conflict quotes, or null. Exact match after normalising,
 * or a quote of at least 12 characters taken from inside one rule.
 * @param {Array<{ area: string|null, text: string }>} known
 */
function findQuoted(known, area, quote) {
  const q = norm(quote);
  if (!q) return null;
  const pool = known.filter((k) => k.area === area || (!k.area && (area === 'product' || area === '')));
  const candidates = pool.length ? pool : known;
  return candidates.find((k) => norm(k.text) === q)
    || (q.length >= 12 ? candidates.find((k) => norm(k.text).includes(q)) : null)
    || null;
}

/**
 * @param {string} text the model's JSON
 * @param {{ known: Array<{ area: string|null, text: string }>, changedFiles: string[] }} ctx
 *   known = rules, never-rules and agreements of the touched areas, plus product-wide agreements
 * @returns {{ verdict: string, summary: string, conflicts: object[], suggested_agreement: string|null, dropped_conflicts: number }}
 */
function parseVerdict(text, { known = [], changedFiles = [] } = {}) {
  let raw;
  try {
    raw = JSON.parse(String(text).trim());
  } catch {
    throw new VerdictError('bad_json', 'The model did not return JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new VerdictError('bad_shape', 'Verdict is not an object.');
  if (!VERDICTS.includes(raw.verdict)) throw new VerdictError('bad_verdict', `Unknown verdict ${JSON.stringify(raw.verdict)}.`);
  if (!isStr(raw.summary) || !raw.summary.trim()) throw new VerdictError('bad_summary', 'Verdict has no summary.');
  if (!Array.isArray(raw.conflicts)) throw new VerdictError('bad_conflicts', '`conflicts` is not a list.');

  const changed = new Set(changedFiles);
  let dropped = 0;
  const conflicts = [];
  raw.conflicts.forEach((c, i) => {
    if (!c || typeof c !== 'object' || !isStr(c.area) || !isStr(c.rule_or_agreement) || !isStr(c.explanation)) {
      throw new VerdictError('bad_conflict', `Conflict ${i} is missing area, rule_or_agreement or explanation.`);
    }
    const hit = findQuoted(known, c.area.trim(), c.rule_or_agreement);
    if (!hit || !c.explanation.trim()) { dropped += 1; return; }
    conflicts.push({
      area: hit.area || 'product',
      rule_or_agreement: hit.text, // the intent's own words, not the model's copy
      explanation: c.explanation.trim(),
      files: (Array.isArray(c.files) ? c.files : []).filter((f) => isStr(f) && changed.has(f)),
    });
  });

  let verdict = raw.verdict;
  // Any real conflict is a drift. A ✅ that named conflicts we couldn't find in
  // the intent contradicts itself, so a person decides. A drift with nothing
  // to show is a question.
  if (conflicts.length) verdict = 'drifts';
  else if (verdict === 'matches' && dropped) verdict = 'needs_decision';
  else if (verdict === 'drifts') verdict = 'needs_decision';

  const suggested = isStr(raw.suggested_agreement) && raw.suggested_agreement.trim() ? raw.suggested_agreement.trim() : null;
  return {
    verdict,
    summary: clampSentences(raw.summary),
    conflicts,
    suggested_agreement: verdict === 'matches' ? null : suggested,
    dropped_conflicts: dropped,
  };
}

/** Code-enforced floor: something a person must look at is never ✅. */
function atLeastNeedsDecision(result) {
  if (result.verdict !== 'matches') return result;
  return { ...result, verdict: 'needs_decision' };
}

module.exports = { parseVerdict, VerdictError, clampSentences, findQuoted, atLeastNeedsDecision };
