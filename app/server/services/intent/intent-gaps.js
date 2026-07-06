/**
 * Intent gaps-as-views + findings (broken guarantees).
 *
 * Gaps synthesize from confirmed statements that drifted. Findings also surface
 * candidate invariants that are broken (satisfied=false) so the UI can lead
 * with "what must hold and what's broken" before confirmation.
 */

function shortText(text, max = 80) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}\u2026` : t;
}

function toLink(link) {
  return {
    filePath: link.file_path,
    symbol: link.symbol ?? null,
    linkStatus: link.link_status,
    suggestedSymbol: link.suggested_symbol ?? null,
  };
}

function synthesizeIntentGaps(confirmedStatements) {
  const gaps = [];
  for (const s of Array.isArray(confirmedStatements) ? confirmedStatements : []) {
    if (!s || s.status !== 'confirmed') continue;
    const links = Array.isArray(s.links) ? s.links : [];
    const unsatisfied = s.satisfied === false;
    const hasBroken = links.some((l) => l && l.link_status === 'broken');
    if (!unsatisfied && !hasBroken) continue;

    const reason = unsatisfied ? 'unsatisfied' : 'broken_link';
    const short = shortText(s.text);
    gaps.push({
      id: `intent-${s.id}`,
      statementId: s.id,
      title: unsatisfied ? `Drifted: ${short}` : `Broken link: ${short}`,
      description: unsatisfied
        ? `This confirmed ${s.kind} is no longer satisfied by its linked code.`
        : `A code anchor for this confirmed ${s.kind} no longer exists.`,
      kind: s.kind,
      featureArea: s.feature_area ?? null,
      scope: s.scope ?? 'job',
      links: links.map(toLink),
      reason,
      lastCheckedAt: s.last_checked_at ?? null,
    });
  }
  return gaps;
}

/**
 * Findings = broken guarantees (candidate or confirmed) for the findings-first UX.
 */
function synthesizeFindings(statements) {
  const findings = [];
  for (const s of Array.isArray(statements) ? statements : []) {
    if (!s || s.archived) continue;
    if (s.satisfied !== false) continue;
    if (s.status === 'rejected') continue;
    const links = Array.isArray(s.links) ? s.links : [];
    findings.push({
      id: `finding-${s.id}`,
      statementId: s.id,
      title: shortText(s.text),
      description: 'This guarantee is not currently upheld by the linked code.',
      kind: s.kind,
      scope: s.scope ?? 'job',
      status: s.status,
      featureArea: s.feature_area ?? null,
      links: links.map(toLink),
      reason: 'broken',
      confidence: s.confidence ?? null,
    });
  }
  return findings;
}

module.exports = { synthesizeIntentGaps, synthesizeFindings, shortText };
