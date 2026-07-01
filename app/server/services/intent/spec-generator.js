// Living-spec generator (Phase 4b, restructured for the JTBD feature layer).
//
// Renders CONFIRMED intent statements into a read-only markdown "living spec"
// organized as a product plan: Persona -> Job-to-be-done -> Feature -> the
// confirmed statements that implement it, each citing the code it's grounded in.
// This is a pure derived VIEW: the confirmed statements ARE the truth; this just
// projects them (plus the synthesized feature/persona/job spine from
// services/intent/features.js) into a doc shape.
//
// Statements join to features via `group_label = intent_features.label`. When no
// features are available (e.g. an un-synthesized project) it degrades to a flat
// grouping by group_label so the spec still renders.

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

// Non-behavior kinds get a light inline tag so meaning survives the flattening.
function kindPrefix(kind) {
  if (kind === 'constraint') return 'Constraint: ';
  if (kind === 'non_goal') return 'Non-goal: ';
  return '';
}

function statementLine(s) {
  return `- ${kindPrefix(s.kind)}${s.text}${citation(s.links)}`;
}

// A statement's feature label (the synthesis join key), null-safe.
function labelOf(s) {
  return s.group_label ?? null;
}

// Build the full living-spec markdown.
// @param {Array} statements - confirmed intent_statements rows (snake_case).
// @param {Array} features   - intent_features rows (snake_case), sort-ordered.
function buildLivingSpec(statements, features = []) {
  const rows = Array.isArray(statements) ? statements : [];
  const featureRows = Array.isArray(features) ? features : [];
  const lines = ['# Living spec', ''];

  if (rows.length === 0) {
    lines.push('_No confirmed intent statements yet. Confirm candidates in the Context tab to build the spec._');
    lines.push('');
    return lines.join('\n');
  }

  // Bucket confirmed statements by feature label.
  const byLabel = new Map();
  for (const s of rows) {
    const key = labelOf(s);
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push(s);
  }

  // Group features (in sort order) into persona -> job -> [feature]. Only keep
  // features that have at least one confirmed statement.
  const personaOrder = [];
  const personas = new Map(); // personaName -> { emoji, jobs: Map<jobTitle, feature[]>, jobOrder: [] }
  const usedLabels = new Set();

  function personaBucket(name, emoji) {
    if (!personas.has(name)) {
      personas.set(name, { emoji: emoji || null, jobs: new Map(), jobOrder: [] });
      personaOrder.push(name);
    }
    return personas.get(name);
  }

  for (const f of featureRows) {
    const confirmed = byLabel.get(f.label);
    if (!confirmed || confirmed.length === 0) continue;
    usedLabels.add(f.label);
    const personaName = f.persona_name || 'General';
    const jobTitle = f.job_title || 'General';
    const bucket = personaBucket(personaName, f.persona_emoji);
    if (!bucket.jobs.has(jobTitle)) {
      bucket.jobs.set(jobTitle, []);
      bucket.jobOrder.push(jobTitle);
    }
    bucket.jobs.get(jobTitle).push({ feature: f, statements: confirmed });
  }

  // Render persona -> job -> feature -> statements.
  for (const personaName of personaOrder) {
    const bucket = personas.get(personaName);
    const heading = bucket.emoji ? `${bucket.emoji} ${personaName}` : personaName;
    lines.push(`## ${heading}`);
    lines.push('');
    for (const jobTitle of bucket.jobOrder) {
      lines.push(`### ${jobTitle}`);
      lines.push('');
      for (const { feature, statements: stmts } of bucket.jobs.get(jobTitle)) {
        lines.push(`#### ${feature.label}`);
        if (feature.summary) {
          lines.push(`_${feature.summary}_`);
        }
        for (const s of stmts) lines.push(statementLine(s));
        lines.push('');
      }
    }
  }

  // Anything confirmed but not covered by a feature (no synthesis yet, or a
  // straggler label) is listed flat so nothing is silently dropped.
  const leftover = [];
  for (const [label, stmts] of byLabel.entries()) {
    if (label !== null && usedLabels.has(label)) continue;
    for (const s of stmts) leftover.push({ label, s });
  }
  if (leftover.length > 0) {
    lines.push('## Other');
    lines.push('');
    // Preserve label grouping for readability.
    const byLeftoverLabel = new Map();
    for (const { label, s } of leftover) {
      const key = label ?? 'Uncategorized';
      if (!byLeftoverLabel.has(key)) byLeftoverLabel.set(key, []);
      byLeftoverLabel.get(key).push(s);
    }
    for (const [label, stmts] of byLeftoverLabel.entries()) {
      lines.push(`### ${label}`);
      for (const s of stmts) lines.push(statementLine(s));
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = { buildLivingSpec };
