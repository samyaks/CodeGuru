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

function parseJobLinks(row) {
  const raw = row.v2_job_links;
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
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
    // Persisted by `services/v2/gap-job-linker.js` (migration 013).
    // `null` means "not linked yet" — UI can show a soft placeholder
    // and the next analysis run / page load will populate it. `[]`
    // means "linked, no jobs apply".
    jobLinks: parseJobLinks(row),
    source: 'ai',
  };
}

/**
 * Enrich an array of gap shapes with display-ready `affectedJobs`
 * (persona name/emoji/title) using the project's product map. Pure —
 * does not write to the DB.
 */
function attachAffectedJobs(gaps, productMap) {
  if (!productMap || !Array.isArray(productMap.jobs) || !Array.isArray(productMap.personas)) {
    return gaps.map((g) => ({ ...g, affectedJobs: [] }));
  }
  const jobsById = new Map(productMap.jobs.map((j) => [j.id, j]));
  const personasById = new Map(productMap.personas.map((p) => [p.id, p]));
  return gaps.map((g) => {
    const links = Array.isArray(g.jobLinks) ? g.jobLinks : [];
    const affectedJobs = [];
    for (const link of links) {
      const job = jobsById.get(link.jobId);
      if (!job) continue;
      const personaId = link.personaId || job.persona_id || job.personaId;
      const persona = personasById.get(personaId);
      affectedJobs.push({
        jobId: job.id,
        jobTitle: job.title,
        personaId: personaId || null,
        personaName: persona?.name || null,
        personaEmoji: persona?.emoji || null,
        confidence: typeof link.confidence === 'number' ? link.confidence : null,
        method: link.method || null,
        reason: link.reason || null,
      });
    }
    return { ...g, affectedJobs };
  });
}

/**
 * Synthesize map-derived gaps for entities that jobs need but aren't
 * built yet. These are computed fresh on every GET — they don't live in
 * the `suggestions` table and they don't have a cached `cursor_prompt`
 * (the UI fetches one on demand via `/gaps/:id/prompt`).
 *
 * Dedupe rule (revised after code-review H3):
 *   - Heuristic links carry the entity they were derived from
 *     (`link.entityId`). For those, we suppress only the matching
 *     `(jobId, entityId)` synthetic gap so an AI gap covering
 *     `cap:auth` for "Sign up" doesn't also suppress the synthetic
 *     "Build Login form for Sign up".
 *   - Claude links don't tell us which entity they had in mind, so
 *     we still fall back to a `(jobId, *)` wildcard for those —
 *     accepting some over-suppression as the price of not
 *     double-surfacing the same job under two gap sources.
 *   - File overlap (gap.affectedFiles ∩ entity.filePath) gives us
 *     entity-specific coverage even without a heuristic link record,
 *     so we add those too.
 */
function synthesizeMapGaps(productMap, existingGaps) {
  if (!productMap || !Array.isArray(productMap.jobs) || !Array.isArray(productMap.entities) || !Array.isArray(productMap.edges)) {
    return [];
  }
  const jobsById = new Map(productMap.jobs.map((j) => [j.id, j]));
  const personasById = new Map(productMap.personas.map((p) => [p.id, p]));
  const entitiesById = new Map(productMap.entities.map((e) => [e.id, e]));

  // file path → entityId index (single pass over entities). Was a
  // nested loop inside the existingGaps walk before; that was O(gaps ×
  // files × entities) and got noisy on large projects (review M8).
  const pathToEntityId = new Map();
  for (const e of productMap.entities) {
    const path = e.filePath || e.file_path;
    if (path) pathToEntityId.set(path, e.id);
  }

  // Build the suppression set. See dedupe rule in the docblock.
  const covered = new Set();
  for (const g of existingGaps) {
    const links = Array.isArray(g.jobLinks) ? g.jobLinks : [];
    const files = Array.isArray(g.affectedFiles) ? g.affectedFiles : [];

    const fileEntityIds = [];
    for (const f of files) {
      const eid = pathToEntityId.get(f);
      if (eid) fileEntityIds.push(eid);
    }

    for (const link of links) {
      if (link.entityId) {
        covered.add(`${link.jobId}::${link.entityId}`);
      } else {
        covered.add(`${link.jobId}::*`);
      }
      for (const eid of fileEntityIds) {
        covered.add(`${link.jobId}::${eid}`);
      }
    }
  }

  const synthetic = [];
  for (const edge of productMap.edges) {
    if (edge.type !== 'needs') continue;
    // Raw db rows use snake_case; `graphFromDbRow` returns camelCase.
    // Both shapes show up here depending on caller — accept either.
    const fromId = edge.fromId || edge.from_id;
    const toId = edge.toId || edge.to_id;
    if (!fromId || !toId) continue;
    const job = jobsById.get(fromId);
    if (!job) continue;
    const entity = entitiesById.get(toId);
    if (!entity) continue;
    const status = String(entity.status || '').toLowerCase();
    const isBlocking = status === 'partial' || status === 'stub' || status === 'missing'
      || (status !== 'detected' && status !== 'confirmed' && status !== 'full');
    if (!isBlocking) continue;

    const pairKey = `${job.id}::${entity.id}`;
    const wildcardKey = `${job.id}::*`;
    if (covered.has(pairKey) || covered.has(wildcardKey)) continue;

    const persona = personasById.get(job.persona_id || job.personaId);
    const entityLabel = entity.label || entity.key || 'Component';
    const partial = status === 'partial' || status === 'stub';

    synthetic.push({
      // `map-` prefix is the routing signal: the GET /gaps/:id/prompt
      // endpoint inspects the prefix and generates a prompt on demand
      // (these gaps don't live in the DB, so there's nothing to cache).
      id: `map-${entity.id}-${job.id}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      category: 'missing',
      title: partial
        ? `Finish ${entityLabel}`
        : `Build ${entityLabel}`,
      description: partial
        ? `${persona?.name || 'Someone'} needs to "${job.title}". ${entityLabel} is partially built — fill in the gaps so this job can be completed end-to-end.`
        : `${persona?.name || 'Someone'} needs to "${job.title}". ${entityLabel} isn't built yet, so this job is blocked.`,
      effort: partial ? 'Medium' : 'Large',
      files: undefined,
      affects: persona?.name ? [persona.name] : undefined,
      required_for: [job.title],
      prompt: null, // generated lazily via /gaps/:id/prompt
      status: 'untriaged',
      verification: null,
      rawCategory: 'missing_functionality',
      priority: partial ? 'medium' : 'high',
      type: 'feature',
      affectedFiles: entity.filePath || entity.file_path ? [entity.filePath || entity.file_path] : [],
      rejectedReason: null,
      committedAt: null,
      jobLinks: [{
        jobId: job.id,
        personaId: persona?.id || null,
        confidence: 1,
        reason: `Job "${job.title}" has a needs edge to ${entityLabel}`,
        method: 'synthetic',
        entityId: entity.id,
      }],
      affectedJobs: [{
        jobId: job.id,
        jobTitle: job.title,
        personaId: persona?.id || null,
        personaName: persona?.name || null,
        personaEmoji: persona?.emoji || null,
        confidence: 1,
        method: 'synthetic',
        reason: null,
      }],
      // Marker so the UI / lazy prompt route can treat these specially.
      source: 'map',
      // Carrying the entity reference makes the prompt route's job easy.
      mapEntityId: entity.id,
      mapJobId: job.id,
    });
  }
  return synthetic;
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

module.exports = {
  categorize,
  toGap,
  groupGaps,
  v2StatusFor,
  attachAffectedJobs,
  synthesizeMapGaps,
  parseJobLinks,
};
