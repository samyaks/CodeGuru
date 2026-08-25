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

function publicEvidence(row) {
  const raw = Array.isArray(row.evidence) ? row.evidence : [];
  return raw.slice(0, 8).map((e) => ({
    file: e.file || null,
    line: typeof e.line === 'number' ? e.line : null,
    reason: e.reason || null,
    snippet: typeof e.snippet === 'string' ? e.snippet.slice(0, 160) : null,
  })).filter((e) => e.file);
}

const CANNED_PROMPT_PREFIXES = [
  'Add Row Level Security to all Supabase tables',
  'Move all hardcoded secrets and API keys',
  'Add express-rate-limit to protect API endpoints',
  'Add helmet to set security headers',
  'Add zod for input validation',
  'Add a global error handling middleware',
  'Set up a basic test suite',
  'Replace all hardcoded localhost URLs',
  'Add environment variable validation at app startup',
  'Add a /health endpoint',
  'Add user authentication to this project',
  'Set up a database for this project',
  'Add database schema and migration files',
  'Add deployment configuration to this project',
  'Add a GitHub Actions CI workflow',
  'Add role-based access control (RBAC)',
  'Set up automated testing with vitest',
  'Add global error handling to the Express app',
  'Create a `.env.example` file',
  'Scaffold a frontend for this project',
  'Create an Express backend API',
];

/**
 * Static rules used to persist canned Cursor tutorials that never
 * mentioned the files they flagged. Hide those from the UI so Accept
 * generates a grounded prompt from evidence instead.
 */
function isCannedCursorPrompt(row) {
  const prompt = row.cursor_prompt;
  if (!prompt || row.source !== 'static') return false;
  const start = String(prompt).trimStart();
  return CANNED_PROMPT_PREFIXES.some((p) => start.startsWith(p));
}

/** Convert a raw `suggestions` row into the v2 Gap shape consumed by the UI. */
function toGap(row) {
  const category = categorize(row);
  const status = v2StatusFor(row);
  const filesCount = affectedFilesCount(row);
  const evidence = publicEvidence(row);
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
    prompt: isCannedCursorPrompt(row) ? null : (row.cursor_prompt || null),
    status,
    verification: row.verification || null,
    rawCategory: category, // for grouping into broken/missing/infra buckets
    priority: row.priority,
    type: row.type,
    affectedFiles: Array.isArray(row.affected_files) ? row.affected_files : [],
    evidence,
    rejectedReason: row.v2_rejected_reason || null,
    committedAt: row.v2_committed_at || null,
    // Persisted by `services/v2/gap-job-linker.js` (migration 013).
    // `null` means "not linked yet" — UI can show a soft placeholder
    // and the next analysis run / page load will populate it. `[]`
    // means "linked, no jobs apply".
    jobLinks: parseJobLinks(row),
    // Security tag (migration 014). `isSecurity` is the lens flag —
    // the v2 Gaps tab and the Security report both consume it. These
    // are PUBLIC fields and survive `pruneInternalFields` in the v2
    // route handlers; do not move them into the rest of the
    // pruned-internal block.
    isSecurity:        !!row.is_security,
    securitySeverity:  row.security_severity || null,
    cweId:             row.cwe_id || null,
    securityDetector:  row.security_detector || null,
    source: row.source === 'security' ? 'security' : 'ai',
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

// Confidence threshold above which a capability detector's verdict
// overrides the LLM-extracted entity status. 0.7 mirrors the threshold
// the detectors themselves use to flip `status` from 'partial' to
// 'present' (see e.g. `capability-detectors/auth.js`).
const DETECTOR_OVERRIDE_CONFIDENCE = 0.7;

// Map an entity to the detector key in `gaps` that vets it. Capability
// entities (`type: 'capability'`, `key: 'auth'/'deployment'/…`) map
// directly; route/page/component entities have no deterministic
// detector to cross-check against and aren't overridden here.
function detectorKeyFor(entity) {
  if (!entity || entity.type !== 'capability') return null;
  return entity.key || null;
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
 *
 * Detector override (added 2026-05 — diagnostic finding):
 *   The LLM map extractor frequently marks capability entities
 *   (`auth`, `deployment`, `errorHandling`, …) as `partial` even when
 *   the deterministic capability detectors say `exists=true conf≥0.95`.
 *   `detectorGaps` (the capability-detector output, shaped by
 *   `projectToLegacyGapShape`) is the source of truth for capability
 *   presence; when it says present, we skip the synthetic
 *   "Finish <Capability>" gap regardless of what the entity row claims.
 */
function synthesizeMapGaps(productMap, existingGaps, detectorGaps = {}) {
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

    // Detector override: if a capability detector says this thing is
    // present with high confidence, the entity status is stale/wrong
    // and we suppress the synthetic gap. Routes/pages/components
    // aren't cross-checkable this way, so they fall through to the
    // entity-status rule above.
    const detectorKey = detectorKeyFor(entity);
    if (detectorKey) {
      const det = detectorGaps?.[detectorKey];
      if (det?.exists && (det?.confidence ?? 0) >= DETECTOR_OVERRIDE_CONFIDENCE) {
        continue;
      }
    }

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
      // Synthetic map gaps are never security-tagged. Keep the shape
      // consistent with `toGap` so the v2 frontend can rely on these
      // fields existing on every gap rather than guarding undefined.
      isSecurity:        false,
      securitySeverity:  null,
      cweId:             null,
      securityDetector:  null,
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
  isCannedCursorPrompt,
};
