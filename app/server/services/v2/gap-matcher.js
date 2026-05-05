// v2 commit ↔ gap matcher.
//
// Tries the strategies in order; first hit with confidence > 0.7 wins.
//   1. Conventional commit reference: "fix(gap:<id>):", "[gap-<id>]" → 1.0
//   2. File overlap > 50% with gap.affectedFiles                    → 0.9
//   3. Keyword overlap with gap title + at least one matching file  → 0.8
//   4. Claude classifier (handled at the call site if reachable)    → returned by Claude
//
// All matches are returned with `strategy` + `confidence` for telemetry.

const MIN_CONFIDENCE = 0.7;

function extractGapRef(message) {
  if (!message) return null;
  // forms: "fix(gap:abc123):", "[gap-abc123]", "(gap:abc123)"
  const re1 = /\bgap[:\-\s]?([a-z0-9_-]+)\b/i;
  const m1 = re1.exec(message);
  if (m1 && m1[1]) return m1[1];
  return null;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'when',
  'have', 'will', 'your', 'their', 'they', 'them', 'what', 'which',
  'should', 'could', 'would', 'about', 'there', 'these', 'those',
  'before', 'after', 'while', 'each', 'every', 'some', 'more',
]);

function keywords(text) {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

function tryRefMatch(commit, openGaps) {
  const ref = extractGapRef(commit.message);
  if (!ref) return null;
  const match = openGaps.find((g) => g.id === ref || g.id.endsWith(ref) || g.id.startsWith(ref));
  if (!match) return null;
  return { gapId: match.id, confidence: 1.0, strategy: 'commit_ref' };
}

function tryFileOverlapMatch(commit, openGaps) {
  if (!Array.isArray(commit.files) || commit.files.length === 0) return null;
  const commitSet = new Set(commit.files);
  let best = null;
  for (const gap of openGaps) {
    const gapFiles = Array.isArray(gap.affectedFiles) ? gap.affectedFiles : [];
    if (gapFiles.length === 0) continue;
    let overlap = 0;
    for (const f of gapFiles) if (commitSet.has(f)) overlap += 1;
    const ratio = overlap / gapFiles.length;
    if (ratio > 0.5 && (!best || ratio > best.ratio)) {
      best = { gapId: gap.id, ratio };
    }
  }
  if (!best) return null;
  return { gapId: best.gapId, confidence: 0.9, strategy: 'file_overlap', detail: { ratio: best.ratio } };
}

function tryKeywordMatch(commit, openGaps) {
  const msgKeywords = new Set(keywords(commit.message));
  if (msgKeywords.size === 0) return null;
  const commitFiles = new Set(Array.isArray(commit.files) ? commit.files : []);
  let best = null;
  for (const gap of openGaps) {
    const titleKeywords = new Set(keywords(gap.title));
    let overlap = 0;
    for (const k of titleKeywords) if (msgKeywords.has(k)) overlap += 1;
    if (overlap < 2) continue;
    const gapFiles = Array.isArray(gap.affectedFiles) ? gap.affectedFiles : [];
    const hasFileTouch = gapFiles.some((f) => commitFiles.has(f));
    if (!hasFileTouch && commitFiles.size > 0 && gapFiles.length > 0) continue;
    const score = overlap / Math.max(titleKeywords.size, 1);
    if (!best || score > best.score) {
      best = { gapId: gap.id, score, overlap };
    }
  }
  if (!best) return null;
  return { gapId: best.gapId, confidence: 0.8, strategy: 'keyword', detail: { overlap: best.overlap } };
}

/**
 * Try each strategy in order. Returns null if no candidate above MIN_CONFIDENCE.
 * Caller decides whether to additionally invoke a Claude classifier.
 */
function matchCommitToGap(commit, openGaps) {
  if (!Array.isArray(openGaps) || openGaps.length === 0) return null;
  const tries = [tryRefMatch, tryFileOverlapMatch, tryKeywordMatch];
  for (const fn of tries) {
    const out = fn(commit, openGaps);
    if (out && out.confidence >= MIN_CONFIDENCE) {
      return out;
    }
  }
  return null;
}

module.exports = {
  matchCommitToGap,
  MIN_CONFIDENCE,
  // exposed for tests
  extractGapRef,
  tryRefMatch,
  tryFileOverlapMatch,
  tryKeywordMatch,
};
