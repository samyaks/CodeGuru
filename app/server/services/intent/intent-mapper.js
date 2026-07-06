// Intent statement mapper.
//
// Translates snake_case `intent_statements` DB rows into camelCase JSON for the
// Context tab. Supports grouping by job (Persona -> Job -> Invariant) and a
// global guarantees bucket.

function toLink(link) {
  return {
    filePath: link.file_path,
    symbol: link.symbol ?? null,
    linkStatus: link.link_status,
    suggestedSymbol: link.suggested_symbol ?? null,
  };
}

function toStatement(row) {
  const links = Array.isArray(row.links) ? row.links.map(toLink) : [];
  return {
    id: row.id,
    text: row.text,
    kind: row.kind,
    status: row.status,
    source: row.source,
    featureArea: row.feature_area ?? null,
    groupLabel: row.group_label ?? null,
    scope: row.scope ?? 'job',
    confidence: row.confidence ?? null,
    confirmedVia: row.confirmed_via ?? null,
    links,
    satisfied: row.satisfied === null || row.satisfied === undefined ? null : Boolean(row.satisfied),
    lastCheckedAt: row.last_checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

function countStatements(stmts) {
  let candidateCount = 0;
  let confirmedCount = 0;
  let rejectedCount = 0;
  let holdsCount = 0;
  let brokenCount = 0;
  for (const s of stmts) {
    if (s.status === 'candidate') candidateCount += 1;
    else if (s.status === 'confirmed') confirmedCount += 1;
    else if (s.status === 'rejected') rejectedCount += 1;
    if (s.satisfied === true) holdsCount += 1;
    else if (s.satisfied === false) brokenCount += 1;
  }
  return { candidateCount, confirmedCount, rejectedCount, holdsCount, brokenCount };
}

/**
 * Group invariants under personas -> jobs via statement_jobs, plus a globals
 * bucket for scope='global' invariants.
 *
 * @param {Array} statementRows - mapped statements (camelCase)
 * @param {object|null} mapFull - product map from getMapByProject (snake_case rows)
 * @param {Array<{statement_id, job_id}>} links - statement_jobs rows
 */
function groupByJob(statementRows, mapFull, links) {
  const statements = Array.isArray(statementRows) ? statementRows : [];
  const linkRows = Array.isArray(links) ? links : [];

  const byJob = new Map();
  for (const l of linkRows) {
    if (!l || !l.job_id || !l.statement_id) continue;
    if (!byJob.has(l.job_id)) byJob.set(l.job_id, new Set());
    byJob.get(l.job_id).add(l.statement_id);
  }

  const stmtById = new Map(statements.map((s) => [s.id, s]));
  const globals = statements.filter((s) => s.scope === 'global');
  const globalIds = new Set(globals.map((s) => s.id));

  const personas = [];
  const personaRows = mapFull && Array.isArray(mapFull.personas) ? mapFull.personas : [];
  const jobRows = mapFull && Array.isArray(mapFull.jobs) ? mapFull.jobs : [];

  for (const p of personaRows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
    const jobs = jobRows
      .filter((j) => j.persona_id === p.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((j) => {
        const ids = byJob.get(j.id) || new Set();
        const jobStmts = [...ids]
          .map((id) => stmtById.get(id))
          .filter((s) => s && !globalIds.has(s.id));
        const counts = countStatements(jobStmts);
        return {
          id: j.id,
          title: j.title,
          priority: j.priority,
          confirmed: Boolean(j.confirmed),
          statements: jobStmts,
          ...counts,
        };
      });

    const allJobStmts = jobs.flatMap((j) => j.statements);
    const personaCounts = countStatements(allJobStmts);
    personas.push({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      description: p.description ?? null,
      confirmed: Boolean(p.confirmed),
      jobs,
      ...personaCounts,
    });
  }

  const globalCounts = countStatements(globals);

  let total = statements.length;
  let confirmed = 0;
  let candidates = 0;
  let rejected = 0;
  let holds = 0;
  let broken = 0;
  for (const s of statements) {
    if (s.status === 'confirmed') confirmed += 1;
    else if (s.status === 'candidate') candidates += 1;
    else if (s.status === 'rejected') rejected += 1;
    if (s.satisfied === true) holds += 1;
    else if (s.satisfied === false) broken += 1;
  }

  return {
    personas,
    globals: {
      title: 'Security & safety basics',
      statements: globals,
      ...globalCounts,
    },
    total,
    confirmed,
    candidates,
    rejected,
    holds,
    broken,
  };
}

// Legacy grouping by feature area (kept for tests/back-compat).
function groupByArea(statements) {
  const byArea = new Map();
  for (const s of statements) {
    const key = s.groupLabel ?? s.featureArea ?? null;
    if (!byArea.has(key)) {
      byArea.set(key, {
        featureArea: key,
        statements: [],
        candidateCount: 0,
        confirmedCount: 0,
        rejectedCount: 0,
      });
    }
    const group = byArea.get(key);
    group.statements.push(s);
    if (s.status === 'candidate') group.candidateCount += 1;
    else if (s.status === 'confirmed') group.confirmedCount += 1;
    else if (s.status === 'rejected') group.rejectedCount += 1;
  }
  const areas = [...byArea.values()].sort((a, b) => {
    if (a.featureArea === null) return 1;
    if (b.featureArea === null) return -1;
    return String(a.featureArea).localeCompare(String(b.featureArea));
  });
  let confirmed = 0;
  let candidates = 0;
  let rejected = 0;
  for (const group of areas) {
    confirmed += group.confirmedCount;
    candidates += group.candidateCount;
    rejected += group.rejectedCount;
  }
  return { areas, total: statements.length, confirmed, candidates, rejected };
}

module.exports = { toStatement, toLink, groupByJob, groupByArea, countStatements };
