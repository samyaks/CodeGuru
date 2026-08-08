/**
 * Code slice builder for "The Read".
 *
 * Selects a bounded slice of REAL source code (from analysis_files, persisted
 * by the analyzer) so claim synthesis is grounded in what the code actually
 * says, not just map/invariant summaries. Also returns every path known for
 * the analysis so evidence citations can be verified (read-confidence.js).
 */

const { analysisFiles } = require('../../lib/db');

const DEFAULT_BUDGET_CHARS = 28000;
const FULL_FILE_CAP = 4000;      // one giant file can't eat the whole budget
const SKELETON_CAP = 1500;
const MIN_REMAINING = 400;       // below this a code fragment isn't useful grounding
const TRUNCATION_MARKER = '\n… [truncated]';

function clipTo(text, cap) {
  if (text.length <= cap) return { text, clipped: false };
  return { text: text.slice(0, cap) + TRUNCATION_MARKER, clipped: true };
}

// score DESC (nulls last), then inbound_degree DESC as centrality tiebreak.
function byImportance(a, b) {
  const scoreA = a.score == null ? -Infinity : Number(a.score);
  const scoreB = b.score == null ? -Infinity : Number(b.score);
  if (scoreA !== scoreB) return scoreB - scoreA;
  const inA = a.inboundDegree == null ? -1 : a.inboundDegree;
  const inB = b.inboundDegree == null ? -1 : b.inboundDegree;
  return inB - inA;
}

/**
 * Pack candidates into the char budget in order. Each candidate:
 * { path, kind, raw, cap, score, inboundDegree }.
 */
function packFiles(candidates, budgetChars) {
  const files = [];
  let remaining = budgetChars;
  let truncated = false;

  for (let i = 0; i < candidates.length; i++) {
    if (remaining < MIN_REMAINING) {
      truncated = true; // budget forced dropping the rest
      break;
    }
    const c = candidates[i];
    const { text: capped, clipped } = clipTo(c.raw, c.cap);
    if (clipped) truncated = true;

    let text = capped;
    if (text.length > remaining) {
      text = c.raw.slice(0, remaining - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
      truncated = true;
    }

    files.push({
      path: c.path,
      kind: c.kind,
      text,
      score: c.score == null ? null : Number(c.score),
      inboundDegree: c.inboundDegree == null ? null : Number(c.inboundDegree),
    });
    remaining -= text.length;
  }

  return { files, truncated };
}

function sliceFromRows(rows, budgetChars) {
  const knownPaths = [...new Set(rows.map((r) => r.path).filter(Boolean))];

  const toCandidate = (r, kind) => ({
    path: r.path,
    kind,
    raw: kind === 'full' ? r.content : r.skeleton,
    cap: kind === 'full' ? FULL_FILE_CAP : SKELETON_CAP,
    score: r.score,
    inboundDegree: r.inbound_degree,
  });

  const fulls = rows
    .filter((r) => r.tier === 'full' && typeof r.content === 'string' && r.content.length > 0)
    .map((r) => toCandidate(r, 'full'))
    .sort(byImportance);
  const skeletons = rows
    .filter((r) => r.tier === 'skeleton' && typeof r.skeleton === 'string' && r.skeleton.length > 0)
    .map((r) => toCandidate(r, 'skeleton'))
    .sort(byImportance);

  const { files, truncated } = packFiles([...fulls, ...skeletons], budgetChars);
  return { files, knownPaths, truncated, source: 'db' };
}

function sliceFromModel(codebaseModel, budgetChars) {
  const fileContents =
    codebaseModel && typeof codebaseModel.fileContents === 'object' && codebaseModel.fileContents
      ? codebaseModel.fileContents
      : {};
  const treePaths = (Array.isArray(codebaseModel && codebaseModel.fileTree) ? codebaseModel.fileTree : [])
    .map((entry) => (typeof entry === 'string' ? entry : entry && entry.path))
    .filter((p) => typeof p === 'string' && p.length > 0);

  const knownPaths = [...new Set([...Object.keys(fileContents), ...treePaths])];

  const candidates = Object.entries(fileContents)
    .filter(([, content]) => typeof content === 'string' && content.length > 0)
    .map(([path, content]) => ({
      path,
      kind: 'full',
      raw: content,
      cap: FULL_FILE_CAP,
      score: null,
      inboundDegree: null,
    }));

  if (candidates.length === 0 && knownPaths.length === 0) {
    return { files: [], knownPaths: [], truncated: false, source: 'empty' };
  }

  const { files, truncated } = packFiles(candidates, budgetChars);
  return { files, knownPaths, truncated, source: 'model' };
}

/**
 * Select a bounded slice of real source code for LLM grounding.
 *
 * @param {string} projectId - deployments.id == analyses.id
 * @param {object} [opts]
 * @param {object|null} [opts.codebaseModel] - in-memory analyzer output; used
 *   as fallback when analysis_files has no rows (old projects, unit tests).
 * @param {number} [opts.budgetChars=28000] - total char budget for files[].text
 * @returns {Promise<{
 *   files: Array<{ path: string, kind: 'full'|'skeleton', text: string, score: number|null, inboundDegree: number|null }>,
 *   knownPaths: string[],
 *   truncated: boolean,
 *   source: 'db'|'model'|'empty'
 * }>}
 */
async function buildCodeSlice(projectId, opts = {}) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('buildCodeSlice requires a projectId');
  }
  const budgetChars =
    Number.isFinite(opts.budgetChars) && opts.budgetChars > 0
      ? opts.budgetChars
      : DEFAULT_BUDGET_CHARS;
  const codebaseModel = opts.codebaseModel || null;

  let rows = [];
  try {
    rows = await analysisFiles.listByAnalysis(projectId);
  } catch (err) {
    console.error(`[read] code slice DB load for ${projectId} failed (falling back): ${err.message}`);
    rows = [];
  }

  if (Array.isArray(rows) && rows.length > 0) {
    return sliceFromRows(rows, budgetChars);
  }
  if (codebaseModel) {
    return sliceFromModel(codebaseModel, budgetChars);
  }
  return { files: [], knownPaths: [], truncated: false, source: 'empty' };
}

module.exports = { buildCodeSlice };
