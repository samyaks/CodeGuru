// v2 Gap mapper.
//
// Translates the existing v1 Suggestion model (suggestions table) into the v2
// Gap shape used by /api/v2/projects/:id/gaps and the Gaps tab in the v2 UI.
//
// Categorization rules (in order; first hit wins):
//   1. infra-style capability categories (auth/database/deployment/permissions/
//      testing/errorHandling/envConfig as defined in suggestion-rules.js
//      runGapSuggestions) → 'missing_infrastructure'
//   2. type 'feature' or 'idea'                              → 'missing_functionality'
//   3. type 'bug', 'fix', or 'perf' with high/critical priority → 'broken'
//   4. priority 'high' or 'critical' fallback                → 'broken'
//   5. Default                                                → 'missing_functionality'

const INFRA_CATEGORIES = new Set([
  'auth',
  'database',
  'deployment',
  'permissions',
  'testing',
  'errorHandling',
  'envConfig',
  'infrastructure',
  'email',
  'payments',
  'storage',
]);

const BROKEN_TYPES = new Set(['bug', 'fix', 'perf']);
const FUNCTIONAL_TYPES = new Set(['feature', 'idea']);
const HIGH_PRIORITIES = new Set(['critical', 'high']);

function categorize(suggestion) {
  if (suggestion.v2_category) return suggestion.v2_category;

  const cat = String(suggestion.category || '').toLowerCase();
  if (INFRA_CATEGORIES.has(cat)) return 'missing_infrastructure';

  const type = String(suggestion.type || '').toLowerCase();
  if (FUNCTIONAL_TYPES.has(type)) return 'missing_functionality';

  const priority = String(suggestion.priority || '').toLowerCase();
  if (BROKEN_TYPES.has(type) && HIGH_PRIORITIES.has(priority)) return 'broken';
  if (HIGH_PRIORITIES.has(priority)) return 'broken';

  return 'missing_functionality';
}

function effortLabel(rawEffort) {
  const e = String(rawEffort || '').toLowerCase();
  if (e === 'quick' || e === 'small') return e === 'quick' ? 'Quick fix' : 'Small';
  if (e === 'medium') return 'Medium';
  if (e === 'large' || e === 'big') return 'Large';
  return rawEffort || null;
}

// Map v1 suggestion status (open/dismissed/done) → v2 status when v2_status not
// yet set. Phase 0's migration backfilled v2_status to 'untriaged' for every
// row so this is mostly a fallback. Always emits kebab-case ('in-progress')
// because that's what GapCard's GapStatus type expects.
function v2StatusFor(suggestion) {
  const raw = suggestion.v2_status
    ? String(suggestion.v2_status)
    : (() => {
        switch (String(suggestion.status || '').toLowerCase()) {
          case 'dismissed': return 'rejected';
          case 'done': return 'shipped';
          default: return 'untriaged';
        }
      })();
  return raw === 'in_progress' ? 'in-progress' : raw;
}

function affectedFilesCount(row) {
  if (Array.isArray(row.affected_files)) return row.affected_files.length;
  if (Array.isArray(row.files)) return row.files.length;
  return null;
}

/** Convert a raw `suggestions` row into the v2 Gap shape consumed by the UI. */
function toGap(row) {
  const category = categorize(row);
  const status = v2StatusFor(row);
  const filesCount = affectedFilesCount(row);
  return {
    id: row.id,
    category: category === 'broken'
      ? 'broken'
      : category === 'missing_functionality'
        ? 'missing'
        : 'infra',
    title: row.title,
    description: row.description,
    effort: effortLabel(row.effort),
    files: typeof filesCount === 'number' ? filesCount : undefined,
    affects: Array.isArray(row.affects) ? row.affects : undefined,
    required_for: Array.isArray(row.required_for) ? row.required_for : undefined,
    prompt: row.cursor_prompt || null,
    status,
    verification: row.verification || null,
    rawCategory: category, // for grouping into broken/missing/infra buckets
    priority: row.priority,
    type: row.type,
    affectedFiles: Array.isArray(row.affected_files) ? row.affected_files : [],
    rejectedReason: row.v2_rejected_reason || null,
    committedAt: row.v2_committed_at || null,
  };
}

/** Group an array of `toGap()` results into { broken, missing, infra }. */
function groupGaps(gaps) {
  const broken = [];
  const missing = [];
  const infra = [];
  for (const g of gaps) {
    const bucket = g.rawCategory;
    if (bucket === 'broken') broken.push(g);
    else if (bucket === 'missing_functionality') missing.push(g);
    else infra.push(g);
  }
  return { broken, missing, infra };
}

module.exports = { categorize, toGap, groupGaps, v2StatusFor };
