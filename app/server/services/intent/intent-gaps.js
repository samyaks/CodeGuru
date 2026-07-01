/**
 * Intent gaps-as-views (Phase 6).
 *
 * Gaps are NOT a separate stored lifecycle here — they're synthesized fresh on
 * every read from the intent substrate, mirroring services/v2/gap-mapper.js
 * `synthesizeMapGaps`. A confirmed statement becomes a gap when the code that's
 * supposed to uphold it has drifted:
 *   - `unsatisfied`: the satisfaction re-check (Phase 6) marked satisfied=false.
 *   - `broken_link`: reconciliation (Phase 5) marked a linked anchor broken, so
 *     the statement no longer points at real code.
 *
 * Pure and dependency-free: a deterministic transform over statement rows so it
 * can be unit-tested and called from the route without side effects.
 */

// Trim a statement to a short, single-line gap title.
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

/**
 * Synthesize intent gaps from confirmed statement rows (snake_case DB rows).
 * `unsatisfied` takes precedence over `broken_link` when both apply, since a
 * failing behavior is the more actionable signal.
 *
 * @param {Array<object>} confirmedStatements - rows with status 'confirmed'
 * @returns {Array<{ id, statementId, title, description, kind, featureArea, links, reason, lastCheckedAt }>}
 */
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
    const title = unsatisfied
      ? `Drifted: ${short}`
      : `Broken link: ${short}`;
    const description = unsatisfied
      ? `This confirmed ${s.kind} is no longer satisfied by its linked code. The code changed \u2014 update the code to restore the behavior, or edit the intent if it changed on purpose.`
      : `A code anchor for this confirmed ${s.kind} no longer exists. Relink it to the current code or mark it broken in Link health.`;

    gaps.push({
      id: `intent-${s.id}`,
      statementId: s.id,
      title,
      description,
      kind: s.kind,
      featureArea: s.feature_area ?? null,
      links: links.map(toLink),
      reason,
      lastCheckedAt: s.last_checked_at ?? null,
    });
  }
  return gaps;
}

module.exports = { synthesizeIntentGaps };
