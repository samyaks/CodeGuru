// Living-spec generator — Persona -> Job -> Invariant + Global section.

function citation(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const parts = links
    .filter((l) => l && l.file_path)
    .map((l) => (l.symbol ? `${l.file_path}:${l.symbol}` : l.file_path));
  if (parts.length === 0) return '';
  return ` (${parts.join(', ')})`;
}

function kindPrefix(kind) {
  if (kind === 'constraint') return 'Constraint: ';
  if (kind === 'non_goal') return 'Non-goal: ';
  return '';
}

function statementLine(s) {
  return `- ${kindPrefix(s.kind)}${s.text}${citation(s.links)}`;
}

function buildLivingSpec(confirmedStatements, mapFull = null, links = []) {
  const rows = (Array.isArray(confirmedStatements) ? confirmedStatements : [])
    .filter((s) => s && s.status === 'confirmed' && !s.archived);
  const lines = ['# Living spec', ''];

  if (rows.length === 0) {
    lines.push('_No confirmed guarantees yet. Confirm jobs in the Map tab to build your spec._');
    lines.push('');
    return lines.join('\n');
  }

  const byJob = new Map();
  for (const l of links || []) {
    if (!l || !l.job_id || !l.statement_id) continue;
    if (!byJob.has(l.job_id)) byJob.set(l.job_id, []);
    byJob.get(l.job_id).push(l.statement_id);
  }
  const stmtById = new Map(rows.map((s) => [s.id, s]));
  const used = new Set();

  const personaRows = mapFull && Array.isArray(mapFull.personas) ? mapFull.personas : [];
  const jobRows = mapFull && Array.isArray(mapFull.jobs) ? mapFull.jobs : [];

  for (const p of personaRows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
    const heading = p.emoji ? `${p.emoji} ${p.name}` : p.name;
    lines.push(`## ${heading}`);
    lines.push('');
    const jobs = jobRows.filter((j) => j.persona_id === p.id);
    for (const j of jobs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
      lines.push(`### ${j.title}`);
      const ids = byJob.get(j.id) || [];
      const stmts = ids.map((id) => stmtById.get(id)).filter(Boolean);
      if (stmts.length === 0) {
        lines.push('_No confirmed guarantees for this job yet._');
      } else {
        for (const s of stmts) {
          lines.push(statementLine(s));
          used.add(s.id);
        }
      }
      lines.push('');
    }
  }

  const globals = rows.filter((s) => s.scope === 'global');
  if (globals.length > 0) {
    lines.push('## Security & safety basics');
    lines.push('');
    for (const s of globals) {
      lines.push(statementLine(s));
      used.add(s.id);
    }
    lines.push('');
  }

  const leftover = rows.filter((s) => !used.has(s.id));
  if (leftover.length > 0) {
    lines.push('## Other');
    lines.push('');
    for (const s of leftover) lines.push(statementLine(s));
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { buildLivingSpec };
