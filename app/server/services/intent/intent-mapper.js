// Intent statement mapper.
//
// Translates snake_case `intent_statements` DB rows into the camelCase JSON
// shapes the Context-tab UI consumes (see app/client/src/services/intentApi.ts:
// IntentStatement / IntentLink / IntentListResponse / IntentAreaGroup). This is
// the single serialization boundary — route handlers map rows through here so
// the wire contract stays in one place.

function toLink(link) {
  return {
    filePath: link.file_path,
    symbol: link.symbol ?? null,
    linkStatus: link.link_status,
    // Only populated by Phase 5 reconciliation; keep the key present so the
    // frontend's optional `suggestedSymbol` reads consistently.
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
    links,
    satisfied: row.satisfied === null || row.satisfied === undefined ? null : Boolean(row.satisfied),
    lastCheckedAt: row.last_checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

// Group mapped statements by feature area into the IntentListResponse shape.
// `statements` are already camelCase (post-toStatement). Areas are sorted
// alphabetically with the null area (uncategorized) pinned last; per-area and
// top-level counts drive the UI's review-progress display.
function groupByArea(statements) {
  const byArea = new Map();
  for (const s of statements) {
    const key = s.featureArea ?? null;
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
    return a.featureArea.localeCompare(b.featureArea);
  });

  let confirmed = 0;
  let candidates = 0;
  let rejected = 0;
  for (const group of areas) {
    confirmed += group.confirmedCount;
    candidates += group.candidateCount;
    rejected += group.rejectedCount;
  }

  return {
    areas,
    total: statements.length,
    confirmed,
    candidates,
    rejected,
  };
}

module.exports = { toStatement, groupByArea };
