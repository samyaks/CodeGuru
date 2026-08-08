// Deterministic "core job" picker for The Read.
//
// Pure — no DB, no LLM. The synthesis (synthesize-read.js) receives the
// winner as `coreJobCandidate` and merely phrases it; the pick itself is
// reproducible from the persisted product map + invariant rows.

// Job association note: intentStatements.findByProjectId returns raw
// intent_statements rows, which carry NO job ids — the statement<->job
// many-to-many lives in statement_jobs ({ statement_id, job_id } pairs,
// see db.js statementJobs.findLinksForProject). Callers that fetched those
// pairs can attach them to a row as `job_ids` (or `jobIds` / `job_id` /
// `_jobId`, the in-memory shape generate-invariants uses pre-persist).
// When no explicit ids are present we fall back to the convention that
// generate-invariants writes the job title into `group_label` and
// `feature_area`, and match those against map job titles.

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

function normTitle(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function linkCount(inv) {
  return Array.isArray(inv.links) ? inv.links.length : 0;
}

// Explicit job ids attached to the row, in every shape callers use.
function explicitJobIds(inv) {
  const ids = [];
  for (const arr of [inv.job_ids, inv.jobIds]) {
    if (Array.isArray(arr)) ids.push(...arr);
  }
  for (const one of [inv.job_id, inv._jobId]) {
    if (one) ids.push(one);
  }
  return ids.filter(Boolean);
}

// Resolve the map jobs an invariant is associated with.
function resolveJobs(inv, jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const explicit = explicitJobIds(inv)
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  // Fallback: generate-invariants stamps the job title on group_label /
  // feature_area at creation time.
  const labels = new Set(
    [inv.group_label, inv.feature_area].map(normTitle).filter(Boolean)
  );
  if (labels.size === 0) return [];
  return jobs.filter((j) => labels.has(normTitle(j.title)));
}

function bestPriorityRank(resolvedJobs) {
  let best = 0;
  for (const j of resolvedJobs) {
    const rank = PRIORITY_RANK[j && j.priority] || 0;
    if (rank > best) best = rank;
  }
  return best;
}

// The single job to surface: the highest-priority resolved job (stable by
// title on ties so the pick never flickers between equivalent jobs).
function primaryJob(resolvedJobs) {
  if (resolvedJobs.length === 0) return null;
  return [...resolvedJobs].sort((a, b) => {
    const d = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
    if (d !== 0) return d;
    return normTitle(a.title).localeCompare(normTitle(b.title));
  })[0];
}

/**
 * Deterministically pick the most load-bearing invariant + its job.
 *
 * Ranking:
 *  1. Job-scoped invariants only (scope === 'job'); returns null if none.
 *  2. Invariants with satisfied === false are excluded — a broken guarantee
 *     can't be "the one thing it can't get wrong". EXCEPT when every
 *     candidate is broken: then the strongest broken one wins and `reason`
 *     says so.
 *  3. Sort: confidence DESC, then linked job priority (high > medium > low),
 *     then link count DESC, then stable by id, then text.
 *
 * @param {{ map: object|null, invariants: Array }} args
 *   map: productMap.getMapByProject shape (personas, jobs with priority)
 *   invariants: intent statement rows (scope, confidence, satisfied, links,
 *     job associations — see the job-association note at the top of this file)
 * @returns {{ invariant: object, job: object|null, personaName: string|null, reason: string } | null}
 */
function pickCoreJob({ map, invariants } = {}) {
  const rows = Array.isArray(invariants) ? invariants : [];
  const jobScoped = rows.filter((r) => r && r.scope === 'job');
  if (jobScoped.length === 0) return null;

  const holding = jobScoped.filter((r) => r.satisfied !== false);
  const allBroken = holding.length === 0;
  const candidates = allBroken ? jobScoped : holding;

  const jobs = (map && Array.isArray(map.jobs)) ? map.jobs : [];
  const personas = (map && Array.isArray(map.personas)) ? map.personas : [];

  const ranked = candidates
    .map((inv) => {
      const resolved = resolveJobs(inv, jobs);
      return {
        inv,
        resolved,
        confidence: toNumber(inv.confidence),
        priorityRank: bestPriorityRank(resolved),
        links: linkCount(inv),
      };
    })
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.priorityRank !== a.priorityRank) return b.priorityRank - a.priorityRank;
      if (b.links !== a.links) return b.links - a.links;
      const aId = String(a.inv.id || '');
      const bId = String(b.inv.id || '');
      if (aId !== bId) return aId.localeCompare(bId);
      return String(a.inv.text || '').localeCompare(String(b.inv.text || ''));
    });

  const winner = ranked[0];
  const job = primaryJob(winner.resolved);
  const persona = job
    ? personas.find((p) => p && p.id === job.persona_id) || null
    : null;

  const jobPart = job
    ? `for ${job.priority || 'medium'}-priority job "${job.title}"`
    : 'with no resolvable map job';
  const brokenPart = allBroken
    ? '; every job-scoped invariant is currently broken, picked the strongest anyway'
    : '';
  const reason =
    `Picked "${winner.inv.text}" (confidence ${winner.confidence}, ` +
    `${winner.links} link${winner.links === 1 ? '' : 's'}) ${jobPart}${brokenPart}.`;

  return {
    invariant: winner.inv,
    job,
    personaName: persona ? persona.name : null,
    reason,
  };
}

module.exports = { pickCoreJob };
