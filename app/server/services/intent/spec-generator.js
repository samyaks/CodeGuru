// Living-spec generator (Phase 4b).
//
// Renders CONFIRMED intent statements into a read-only markdown "living spec"
// mapped onto the .context.md section vocabulary. This is a pure derived VIEW:
// no editing, no new source of truth. The confirmed statements ARE the truth;
// this just projects them into the doc shape vibe coders already recognize.
//
// Section mapping (intent kind -> .context.md heading):
//   behavior   -> ## purpose
//   constraint -> ## constraints
//   non_goal   -> ## non-goals
//
// Within each section statements are grouped by feature area, and each bullet
// cites the code it's grounded in (file[:symbol]) so the spec stays anchored to
// real anchors, not prose.

// Order sections are rendered in, mapping intent kind -> .context.md heading.
const SECTIONS = [
  { kind: 'behavior', heading: 'purpose' },
  { kind: 'constraint', heading: 'constraints' },
  { kind: 'non_goal', heading: 'non-goals' },
];

// Render the code anchors for a statement as a compact citation suffix, e.g.
// "(server/auth.js:login, server/db.js)". Skips broken/empty links quietly.
function citation(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const parts = links
    .filter((l) => l && l.file_path)
    .map((l) => (l.symbol ? `${l.file_path}:${l.symbol}` : l.file_path));
  if (parts.length === 0) return '';
  return ` (${parts.join(', ')})`;
}

// Group statements by feature area, preserving row order within each area (rows
// arrive pre-sorted by feature_area then created_at from the repo). Returns
// [featureArea|null, statements[]] entries with the null area pinned last.
function groupByArea(statements) {
  const byArea = new Map();
  for (const s of statements) {
    const key = s.feature_area ?? null;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(s);
  }
  return [...byArea.entries()].sort(([a], [b]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
}

// Build the full living-spec markdown from confirmed DB rows (snake_case).
// Returns a string; empty-but-valid markdown when there are no confirmed
// statements yet so the UI renders a coherent (if sparse) doc.
function buildLivingSpec(statements) {
  const rows = Array.isArray(statements) ? statements : [];
  const lines = ['# Living spec', ''];

  if (rows.length === 0) {
    lines.push('_No confirmed intent statements yet. Confirm candidates in the Context tab to build the spec._');
    lines.push('');
    return lines.join('\n');
  }

  for (const { kind, heading } of SECTIONS) {
    const forKind = rows.filter((s) => s.kind === kind);
    if (forKind.length === 0) continue;

    lines.push(`## ${heading}`);
    lines.push('');

    for (const [area, areaStatements] of groupByArea(forKind)) {
      lines.push(`### ${area ?? 'Uncategorized'}`);
      for (const s of areaStatements) {
        lines.push(`- ${s.text}${citation(s.links)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = { buildLivingSpec };
