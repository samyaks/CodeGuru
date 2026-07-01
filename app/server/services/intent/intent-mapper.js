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
    // Coarse, product-level grouping (services/intent/grouping.js). Presentation
    // only; falls back to feature_area for grouping when null.
    groupLabel: row.group_label ?? null,
    links,
    satisfied: row.satisfied === null || row.satisfied === undefined ? null : Boolean(row.satisfied),
    lastCheckedAt: row.last_checked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

// Turn intent_features DB rows (snake_case) into a label -> metadata lookup for
// enriching area groups with the synthesized persona / job-to-be-done spine.
function featureIndex(features) {
  const idx = new Map();
  for (const f of Array.isArray(features) ? features : []) {
    if (!f || typeof f.label !== 'string') continue;
    idx.set(f.label, {
      summary: f.summary ?? null,
      persona: f.persona_name ? { name: f.persona_name, emoji: f.persona_emoji ?? null } : null,
      job: f.job_title ? { title: f.job_title, priority: f.priority ?? null } : null,
      priority: f.priority ?? null,
      sortOrder: typeof f.sort_order === 'number' ? f.sort_order : null,
    });
  }
  return idx;
}

// Group mapped statements into the IntentListResponse shape. Grouping prefers
// the semantic `groupLabel` (= feature title, services/intent/features.js) and
// falls back to the path-derived `featureArea` when a statement hasn't been
// grouped yet. When `features` are supplied, each area carries its synthesized
// summary + persona + job so the UI can render a Persona -> Job -> Feature plan.
// `areas` are sorted by feature sort_order (falling back to alphabetical), with
// the null group (uncategorized) pinned last; counts drive review progress.
function groupByArea(statements, features = []) {
  const featureMeta = featureIndex(features);
  const byArea = new Map();
  for (const s of statements) {
    const key = s.groupLabel ?? s.featureArea ?? null;
    if (!byArea.has(key)) {
      const meta = key != null ? featureMeta.get(key) : null;
      byArea.set(key, {
        featureArea: key,
        summary: meta?.summary ?? null,
        persona: meta?.persona ?? null,
        job: meta?.job ?? null,
        priority: meta?.priority ?? null,
        sortOrder: meta?.sortOrder ?? null,
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
    // Prefer the synthesized feature order; fall back to alphabetical.
    if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.sortOrder != null && b.sortOrder == null) return -1;
    if (a.sortOrder == null && b.sortOrder != null) return 1;
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
