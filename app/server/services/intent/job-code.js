/**
 * Resolve the code surfaces a job is grounded in.
 *
 * Primary path: map_edges (type='needs') -> map_entities.file_path.
 * Fallback (Phase 0 gate): title token overlap against all analysis file paths.
 * Then re-extract structure anchors from the resolved file contents.
 */

const { extractStructureAnchors } = require('../structure-extractor');
const { nameTokens } = require('../map-linker');

function entityFilesForJob(job, map) {
  const entityById = new Map((map.entities || []).map((e) => [e.id, e]));
  const needs = (map.edges || []).filter((e) => e && e.type === 'needs' && e.from_id === job.id);
  const files = new Set();
  for (const edge of needs) {
    const ent = entityById.get(edge.to_id);
    const fp = ent && (ent.file_path || ent.filePath);
    if (fp) files.add(fp);
  }
  return { files, needsEdges: needs.length };
}

function titleFallbackFiles(jobTitle, allFilePaths, exclude) {
  const jobToks = new Set(nameTokens(jobTitle));
  if (jobToks.size === 0) return [];
  return allFilePaths.filter((f) => {
    if (exclude.has(f)) return false;
    return nameTokens(f).some((t) => jobToks.has(t));
  });
}

/**
 * Resolve file paths for a job from the product map + optional fallback.
 * @returns {{ files: string[], needsEdges: number, usedFallback: boolean }}
 */
function resolveJobFiles(job, map, allFilePaths = []) {
  const { files: edgeFiles, needsEdges } = entityFilesForJob(job, map);
  const files = new Set(edgeFiles);
  let usedFallback = false;

  if (files.size <= 1 && Array.isArray(allFilePaths) && allFilePaths.length > 0) {
    const extra = titleFallbackFiles(job.title, allFilePaths, files);
    if (extra.length > 0) {
      usedFallback = true;
      for (const f of extra.slice(0, 8)) files.add(f);
    }
  }

  return { files: [...files], needsEdges, usedFallback };
}

function filterContents(contents, filePaths) {
  const out = {};
  for (const p of filePaths) {
    if (contents && typeof contents[p] === 'string') out[p] = contents[p];
  }
  return out;
}

/**
 * Re-extract anchors limited to the job's resolved files.
 */
function extractJobAnchors(contents, filePaths) {
  const subset = filterContents(contents, filePaths);
  if (Object.keys(subset).length === 0) return [];
  return extractStructureAnchors(subset).filter((a) => a && a.file_path);
}

function buildAnchorIndex(anchors) {
  const byFile = new Map();
  for (const a of anchors) {
    if (!a || !a.file_path) continue;
    if (!byFile.has(a.file_path)) byFile.set(a.file_path, []);
    byFile.get(a.file_path).push(a);
  }
  return byFile;
}

module.exports = {
  resolveJobFiles,
  extractJobAnchors,
  buildAnchorIndex,
  filterContents,
  entityFilesForJob,
  titleFallbackFiles,
};
