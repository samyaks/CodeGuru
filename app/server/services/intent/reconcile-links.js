// Intent substrate — Phase 5 link reconciliation (pure, dependency-free).
//
// Re-classifies every intent_code_link against a freshly re-extracted set of
// structure anchors. Links are a disposable cache (see migration 019): on each
// analysis we compare what a statement *claims* to point at against what the
// code actually still exposes, and either self-heal (clean file moves), flag
// for human relink (symbol renamed), or mark broken (real deletion).
//
// Nothing here touches the DB, network, git, or an LLM — it is a deterministic
// transform over plain data so it can be unit tested in isolation and wired
// into the pipeline in a later wave.

// Similarity threshold for treating a surviving symbol as a plausible rename of
// a vanished one. Tuned so small edits / version bumps / pluralization match
// while unrelated symbols do not. Deterministic and dependency-free.
const RELINK_SIMILARITY_THRESHOLD = 0.55;

/**
 * Reconcile a project's intent links against fresh structure anchors.
 *
 * @param {object} params
 * @param {Array<{ file_path: string, symbol: string, kind: string, feature_area: string }>} params.anchors
 *   Fresh anchors from the Phase 2 structure extractor.
 * @param {Array<{ id: string, text: string, feature_area: string|null,
 *   links: Array<{ file_path: string, symbol: string|null,
 *     link_status: 'healthy'|'needs_relink'|'broken', suggested_symbol?: string|null }> }>} params.statements
 * @returns {{
 *   statements: Array<object>,
 *   triage: Array<{ statementId: string, statementText: string, featureArea: string|null, link: object }>
 * }} Updated statements (links reclassified in place on fresh copies) and a
 *   triage list of every link that ended up needs_relink or broken.
 */
function reconcileLinks({ anchors, statements }) {
  const anchorList = Array.isArray(anchors) ? anchors : [];
  const statementList = Array.isArray(statements) ? statements : [];

  const filesPresent = new Set(anchorList.map((a) => a.file_path));

  // symbol -> Set of file_paths exposing it (used for exact-symbol relocation).
  const filesBySymbol = new Map();
  // file_path -> Array of symbols in that file (used for same-file rename hunt).
  const symbolsByFile = new Map();
  for (const a of anchorList) {
    if (a.symbol != null) {
      if (!filesBySymbol.has(a.symbol)) filesBySymbol.set(a.symbol, new Set());
      filesBySymbol.get(a.symbol).add(a.file_path);
    }
    if (!symbolsByFile.has(a.file_path)) symbolsByFile.set(a.file_path, []);
    if (a.symbol != null) symbolsByFile.get(a.file_path).push(a.symbol);
  }

  const triage = [];

  const updatedStatements = statementList.map((statement) => {
    const links = Array.isArray(statement.links) ? statement.links : [];
    const updatedLinks = links.map((link) => {
      const newLink = classifyLink(link, {
        filesPresent,
        filesBySymbol,
        symbolsByFile,
      });
      if (newLink.link_status === 'needs_relink' || newLink.link_status === 'broken') {
        triage.push({
          statementId: statement.id,
          statementText: statement.text,
          featureArea: statement.feature_area ?? null,
          link: newLink,
        });
      }
      return newLink;
    });
    return { ...statement, links: updatedLinks };
  });

  return { statements: updatedStatements, triage };
}

/**
 * Classify a single link against the anchor lookups and return a fresh link
 * object with an updated link_status (and file_path / suggested_symbol when
 * relevant). Never mutates the input link.
 */
function classifyLink(link, { filesPresent, filesBySymbol, symbolsByFile }) {
  // File-level link (no symbol): healthy iff the file still exists. There's no
  // symbol to chase a successor with, so a missing file is simply broken.
  if (link.symbol == null) {
    if (filesPresent.has(link.file_path)) return healthy(link);
    return broken(link);
  }

  const filesForSymbol = filesBySymbol.get(link.symbol);

  // 1. Exact match still present at the recorded location -> healthy no-op.
  if (filesForSymbol && filesForSymbol.has(link.file_path)) {
    return healthy(link);
  }

  // 2. Same symbol now lives elsewhere. If it's unambiguous (exactly one file),
  //    treat it as a clean file move/rename and self-heal the path.
  if (filesForSymbol && filesForSymbol.size > 0) {
    if (filesForSymbol.size === 1) {
      const [newPath] = [...filesForSymbol];
      return healthy(link, { file_path: newPath });
    }
    // The symbol is now exposed from multiple files — we can't pick safely, so
    // hand it to a human rather than guess.
    return needsRelink(link, link.symbol);
  }

  // 3. Symbol is gone. Hunt for a plausible successor by name similarity.
  //    Prefer symbols in the same file (a rename in place); if the whole file
  //    disappeared, widen the search to every surviving symbol.
  const scope = symbolsByFile.has(link.file_path)
    ? symbolsByFile.get(link.file_path)
    : [...new Set([].concat(...[...symbolsByFile.values()]))];

  const candidate = bestSimilar(link.symbol, scope);
  if (candidate) return needsRelink(link, candidate);

  // 4. No plausible successor anywhere -> broken.
  return broken(link);
}

function healthy(link, extra) {
  const next = { ...link, ...extra, link_status: 'healthy' };
  delete next.suggested_symbol;
  return next;
}

function needsRelink(link, suggestedSymbol) {
  return { ...link, link_status: 'needs_relink', suggested_symbol: suggestedSymbol };
}

function broken(link) {
  return { ...link, link_status: 'broken', suggested_symbol: null };
}

/**
 * Return the most similar symbol from `candidates` to `target` if it clears the
 * relink threshold, else null. Ties are broken deterministically by original
 * order (first wins).
 */
function bestSimilar(target, candidates) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (candidate === target) continue;
    const score = similarity(target, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= RELINK_SIMILARITY_THRESHOLD ? best : null;
}

/**
 * Deterministic 0..1 name similarity. Combines a normalized Levenshtein ratio
 * with a shared-prefix ratio so both in-place edits (typos, version bumps) and
 * prefix-preserving renames (getUser -> getUserById) score as related.
 */
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;

  const maxLen = Math.max(na.length, nb.length);
  const levRatio = 1 - levenshtein(na, nb) / maxLen;

  let prefix = 0;
  const minLen = Math.min(na.length, nb.length);
  while (prefix < minLen && na[prefix] === nb[prefix]) prefix += 1;
  const prefixRatio = prefix / maxLen;

  return Math.max(levRatio, prefixRatio);
}

function normalize(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = j;
  for (let i = 1; i < rows; i += 1) {
    const curr = new Array(cols);
    curr[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[cols - 1];
}

module.exports = { reconcileLinks };
