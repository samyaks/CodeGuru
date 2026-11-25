'use strict';

// Strict reading of the model's verdict JSON. Anything that does not fit is an
// error, and an error is reported as "couldn't check", never as ✅.

const { VERDICTS } = require('./prompt');

class VerdictError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isStr = (v) => typeof v === 'string';

/** Keep the first three sentences. */
function clampSentences(text, max = 3) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.split(/(?<=[.!?])\s+/).slice(0, max).join(' ').trim();
}

/**
 * @param {string} text the model's JSON
 * @param {{ touchedAreaIds: string[], changedFiles: string[] }} ctx
 * @returns {{ verdict: string, summary: string, conflicts: object[], suggested_agreement: string|null }}
 */
function parseVerdict(text, { touchedAreaIds = [], changedFiles = [] } = {}) {
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
  const areas = new Set(touchedAreaIds);
  const conflicts = raw.conflicts.map((c, i) => {
    if (!c || typeof c !== 'object' || !isStr(c.area) || !isStr(c.rule_or_agreement) || !isStr(c.explanation)) {
      throw new VerdictError('bad_conflict', `Conflict ${i} is missing area, rule_or_agreement or explanation.`);
    }
    return {
      area: c.area.trim(),
      known_area: areas.has(c.area.trim()),
      rule_or_agreement: c.rule_or_agreement.trim(),
      explanation: c.explanation.trim(),
      files: (Array.isArray(c.files) ? c.files : []).filter((f) => isStr(f) && changed.has(f)),
    };
  }).filter((c) => c.rule_or_agreement && c.explanation);

  let verdict = raw.verdict;
  // Never a ✅ that lists conflicts; a drift with nothing to show is a question, not a ✅.
  if (verdict === 'matches' && conflicts.length) verdict = 'drifts';
  if (verdict === 'drifts' && !conflicts.length) verdict = 'needs_decision';

  const suggested = isStr(raw.suggested_agreement) && raw.suggested_agreement.trim() ? raw.suggested_agreement.trim() : null;
  return {
    verdict,
    summary: clampSentences(raw.summary),
    conflicts: verdict === 'drifts' ? conflicts : [],
    suggested_agreement: verdict === 'matches' ? null : suggested,
  };
}

module.exports = { parseVerdict, VerdictError, clampSentences };
