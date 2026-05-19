#!/usr/bin/env node
/**
 * Compare two scans of the same repo and print a before/after table.
 *
 * Built to validate Phase-2's quality + cost claims after deploying. Pulls
 * every signal that should have moved:
 *   • token & cost rollups, including cache creation / read split
 *   • per-phase LLM call breakdown
 *   • file-tier distribution (full vs skeleton vs tree)
 *   • import-graph populated? (median + max inboundDegree)
 *   • gap detector output (status + confidence per capability)
 *
 * Usage:
 *   node app/server/scripts/compare-scans.js --list                          # show 20 most recent scans across all repos
 *   node app/server/scripts/compare-scans.js --list 50
 *   node app/server/scripts/compare-scans.js --repo owner/name
 *   node app/server/scripts/compare-scans.js --repo owner/name --limit 5     # show last 5 instead of last 2
 *   node app/server/scripts/compare-scans.js --current <id> --baseline <id>
 *
 * Requires DATABASE_URL (auto-loaded from app/.env, same convention as the
 * other scripts in this directory).
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '..', '.env'),
});

const { getDb, analyses, analysisLlmCalls } = require('../lib/db');

function parseArgs(argv) {
  const out = { repo: null, current: null, baseline: null, limit: 2, list: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo')     out.repo = argv[++i];
    else if (a === '--current')  out.current = argv[++i];
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--limit')    out.limit = parseInt(argv[++i], 10) || 2;
    else if (a === '--list') {
      const next = argv[i + 1];
      const n = next && !next.startsWith('--') ? parseInt(next, 10) : NaN;
      if (Number.isFinite(n)) { out.list = n; i++; } else { out.list = 20; }
    }
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

async function listRecent(limit) {
  const { rows } = await getDb().query(
    `SELECT id, owner, repo, status, created_at, completed_at,
            llm_call_count, llm_cost_usd
       FROM analyses
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  if (!rows.length) {
    console.log('No analyses found in this database.');
    return;
  }
  console.log(`Most recent ${rows.length} analyses (newest first):\n`);
  const hdr = `  ${pad('id', 38)} ${pad('owner/repo', 32)} ${pad('status', 11)} ${pad('created_at', 26)} ${pad('calls', 7)} cost`;
  console.log(hdr);
  console.log('  ' + '─'.repeat(hdr.length - 2));
  for (const r of rows) {
    const slug = `${r.owner || '?'}/${r.repo || '?'}`;
    console.log(`  ${pad(r.id, 38)} ${pad(slug, 32)} ${pad(r.status || '', 11)} ${pad(new Date(r.created_at).toISOString(), 26)} ${pad(String(r.llm_call_count ?? 0), 7)} ${fmtUsd(r.llm_cost_usd ?? 0)}`);
  }
  console.log('\nNext step:  node app/server/scripts/compare-scans.js --repo <owner>/<repo>');
}

async function pickRecentForRepo(repoSlug, limit) {
  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) {
    throw new Error(`--repo must be owner/name (got "${repoSlug}")`);
  }
  const { rows } = await getDb().query(
    `SELECT id, created_at, status, completed_at
       FROM analyses
      WHERE owner = $1 AND repo = $2 AND status IN ('completed', 'failed')
      ORDER BY created_at DESC
      LIMIT $3`,
    [owner, repo, limit]
  );
  return rows;
}

async function tierBreakdown(analysisId) {
  const { rows } = await getDb().query(
    `SELECT tier, COUNT(*)::int AS files,
            COALESCE(SUM(size_bytes), 0)::bigint AS bytes,
            COALESCE(SUM(content_tokens), 0)::bigint AS content_tokens,
            COALESCE(SUM(skeleton_tokens), 0)::bigint AS skeleton_tokens
       FROM analysis_files
      WHERE analysis_id = $1
      GROUP BY tier`,
    [analysisId]
  );
  const out = { full: 0, skeleton: 0, tree: 0, bytes: 0n, contentTokens: 0n, skeletonTokens: 0n };
  for (const r of rows) {
    if (out[r.tier] != null) out[r.tier] = r.files;
    out.bytes          += BigInt(r.bytes || 0);
    out.contentTokens  += BigInt(r.content_tokens || 0);
    out.skeletonTokens += BigInt(r.skeleton_tokens || 0);
  }
  return out;
}

async function graphSignals(analysisId) {
  const { rows } = await getDb().query(
    `SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE inbound_degree  > 0)::int AS rows_with_inbound,
        COUNT(*) FILTER (WHERE outbound_degree > 0)::int AS rows_with_outbound,
        COALESCE(MAX(inbound_degree),  0)::int AS max_inbound,
        COALESCE(MAX(outbound_degree), 0)::int AS max_outbound,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY inbound_degree),  0)::numeric AS median_inbound,
        COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY inbound_degree),  0)::numeric AS p90_inbound
       FROM analysis_files
      WHERE analysis_id = $1`,
    [analysisId]
  );
  const r = rows[0] || {};
  return {
    totalRows:        r.total_rows || 0,
    rowsWithInbound:  r.rows_with_inbound || 0,
    rowsWithOutbound: r.rows_with_outbound || 0,
    maxInbound:       r.max_inbound || 0,
    maxOutbound:      r.max_outbound || 0,
    medianInbound:    Number(r.median_inbound || 0),
    p90Inbound:       Number(r.p90_inbound || 0),
  };
}

async function gapSummary(analysisId) {
  // v2 (takeoff flow) persists gaps to deployments.analysis_data.gaps.
  // The legacy /analyze flow writes them to analyses.analysis.gaps. Prefer
  // deployments since that's where 100% of recent scans land; fall back to
  // analyses for the rare legacy scan. Both rows share the same id.
  const { rows: [d] } = await getDb().query(
    `SELECT analysis_data->'gaps' AS gaps FROM deployments WHERE id = $1`,
    [analysisId]
  );
  let g = d?.gaps || null;
  if (!g) {
    const { rows: [a] } = await getDb().query(
      `SELECT analysis->'gaps' AS gaps FROM analyses WHERE id = $1`,
      [analysisId]
    );
    g = a?.gaps || {};
  }
  const out = {};
  for (const k of ['auth', 'database', 'deployment', 'permissions', 'testing', 'errorHandling', 'envConfig']) {
    const v = g[k] || {};
    out[k] = {
      exists:     !!v.exists,
      confidence: Number(v.confidence ?? 0),
      evidence:   Array.isArray(v.evidence) ? v.evidence.length : 0,
    };
  }
  return out;
}

async function loadScan(id) {
  const meta = await analyses.findById(id);
  if (!meta) throw new Error(`no analysis row for id=${id}`);
  const [rollups, phases, tiers, graph, gaps] = await Promise.all([
    analyses.getRollups(id),
    analysisLlmCalls.aggregateByPhase(id),
    tierBreakdown(id),
    graphSignals(id),
    gapSummary(id),
  ]);
  return { meta, rollups: rollups || {}, phases, tiers, graph, gaps };
}

// ── Formatting ────────────────────────────────────────────────────

function fmtInt(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US');
}
function fmtUsd(n) {
  if (n == null) return '—';
  return '$' + Number(n).toFixed(4);
}
function fmtPct(num, den) {
  if (!den) return '—';
  return ((num / den) * 100).toFixed(1) + '%';
}
function delta(curr, base, { kind = 'int' } = {}) {
  const c = Number(curr || 0);
  const b = Number(base || 0);
  if (!b && !c) return '';
  if (!b) return ' (new)';
  const d = c - b;
  const sign = d > 0 ? '+' : '';
  const pct = b ? ` (${sign}${((d / b) * 100).toFixed(1)}%)` : '';
  if (kind === 'usd') return ` (${sign}${fmtUsd(d).replace('$', '$')})${pct}`;
  return ` (${sign}${fmtInt(d)})${pct}`;
}
function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function renderRollup(curr, base) {
  const c = curr.rollups, b = base.rollups;
  const lines = [];
  lines.push(`  files (ingested):     ${fmtInt(c.ingested_file_count)}${delta(c.ingested_file_count, b.ingested_file_count)}`);
  lines.push(`  ingested tokens:      ${fmtInt(c.ingested_tokens)}${delta(c.ingested_tokens, b.ingested_tokens)}`);
  lines.push(`  llm calls:            ${fmtInt(c.llm_call_count)}${delta(c.llm_call_count, b.llm_call_count)}`);
  lines.push(`  llm input tokens:     ${fmtInt(c.llm_input_tokens)}${delta(c.llm_input_tokens, b.llm_input_tokens)}`);
  lines.push(`  llm output tokens:    ${fmtInt(c.llm_output_tokens)}${delta(c.llm_output_tokens, b.llm_output_tokens)}`);
  lines.push(`  cache create tokens:  ${fmtInt(c.llm_cache_creation_tokens)}${delta(c.llm_cache_creation_tokens, b.llm_cache_creation_tokens)}`);
  lines.push(`  cache read tokens:    ${fmtInt(c.llm_cache_read_tokens)}${delta(c.llm_cache_read_tokens, b.llm_cache_read_tokens)}`);

  const cTotalIn = (c.llm_input_tokens || 0) + (c.llm_cache_creation_tokens || 0) + (c.llm_cache_read_tokens || 0);
  const bTotalIn = (b.llm_input_tokens || 0) + (b.llm_cache_creation_tokens || 0) + (b.llm_cache_read_tokens || 0);
  lines.push(`  cache-read share:     ${fmtPct(c.llm_cache_read_tokens || 0, cTotalIn)}  (was ${fmtPct(b.llm_cache_read_tokens || 0, bTotalIn)})`);

  lines.push(`  llm cost (usd):       ${fmtUsd(c.llm_cost_usd)}${delta(c.llm_cost_usd, b.llm_cost_usd, { kind: 'usd' })}`);
  return lines.join('\n');
}

function renderPhases(curr, base) {
  const all = new Set([
    ...curr.phases.map((p) => p.phase),
    ...base.phases.map((p) => p.phase),
  ]);
  const cByPhase = new Map(curr.phases.map((p) => [p.phase, p]));
  const bByPhase = new Map(base.phases.map((p) => [p.phase, p]));
  const hdr = `  ${pad('phase', 28)} ${pad('calls (Δ)', 16)} ${pad('cost (Δ)', 22)} cache-read share`;
  const sep = '  ' + '─'.repeat(hdr.length - 2);
  const lines = [hdr, sep];
  for (const name of [...all].sort()) {
    const c = cByPhase.get(name) || { call_count: 0, cost_usd: 0, input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
    const b = bByPhase.get(name) || { call_count: 0, cost_usd: 0, input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
    const cIn = (c.input_tokens || 0) + (c.cache_creation_tokens || 0) + (c.cache_read_tokens || 0);
    const share = fmtPct(c.cache_read_tokens || 0, cIn);
    lines.push(`  ${pad(name, 28)} ${pad(fmtInt(c.call_count) + delta(c.call_count, b.call_count), 16)} ${pad(fmtUsd(c.cost_usd) + delta(c.cost_usd, b.cost_usd, { kind: 'usd' }), 22)} ${share}`);
  }
  return lines.join('\n');
}

function renderTiers(curr, base) {
  const c = curr.tiers, b = base.tiers;
  return [
    `  full:      ${fmtInt(c.full)}${delta(c.full, b.full)}`,
    `  skeleton:  ${fmtInt(c.skeleton)}${delta(c.skeleton, b.skeleton)}`,
    `  tree:      ${fmtInt(c.tree)}${delta(c.tree, b.tree)}`,
    `  content tokens stored:   ${fmtInt(c.contentTokens.toString())}${delta(Number(c.contentTokens), Number(b.contentTokens))}`,
    `  skeleton tokens stored:  ${fmtInt(c.skeletonTokens.toString())}${delta(Number(c.skeletonTokens), Number(b.skeletonTokens))}`,
  ].join('\n');
}

function renderGraph(curr, base) {
  const c = curr.graph, b = base.graph;
  const cPct = c.totalRows ? ((c.rowsWithInbound / c.totalRows) * 100).toFixed(1) + '%' : '—';
  const bPct = b.totalRows ? ((b.rowsWithInbound / b.totalRows) * 100).toFixed(1) + '%' : '—';
  return [
    `  rows w/ inbound > 0:  ${fmtInt(c.rowsWithInbound)}/${fmtInt(c.totalRows)} = ${cPct}   (was ${fmtInt(b.rowsWithInbound)}/${fmtInt(b.totalRows)} = ${bPct})`,
    `  rows w/ outbound > 0: ${fmtInt(c.rowsWithOutbound)}/${fmtInt(c.totalRows)}   (was ${fmtInt(b.rowsWithOutbound)}/${fmtInt(b.totalRows)})`,
    `  inbound  max / p90 / median:  ${c.maxInbound} / ${c.p90Inbound} / ${c.medianInbound}   (was ${b.maxInbound} / ${b.p90Inbound} / ${b.medianInbound})`,
    `  outbound max:                 ${c.maxOutbound}   (was ${b.maxOutbound})`,
  ].join('\n');
}

function renderGaps(curr, base) {
  const hdr = `  ${pad('capability', 16)} ${pad('current', 28)} baseline`;
  const sep = '  ' + '─'.repeat(hdr.length - 2);
  const lines = [hdr, sep];
  for (const k of ['auth', 'database', 'deployment', 'permissions', 'testing', 'errorHandling', 'envConfig']) {
    const c = curr.gaps[k] || {};
    const b = base.gaps[k] || {};
    const cs = `${c.exists ? 'present' : 'missing'}  conf=${(c.confidence || 0).toFixed(2)}  ev=${c.evidence || 0}`;
    const bs = `${b.exists ? 'present' : 'missing'}  conf=${(b.confidence || 0).toFixed(2)}  ev=${b.evidence || 0}`;
    const flip = c.exists !== b.exists ? '  ←FLIP' : '';
    lines.push(`  ${pad(k, 16)} ${pad(cs, 28)} ${bs}${flip}`);
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.list && !args.repo && !(args.current && args.baseline))) {
    console.log('Usage:');
    console.log('  node app/server/scripts/compare-scans.js --list           # 20 most recent scans across all repos');
    console.log('  node app/server/scripts/compare-scans.js --list 50');
    console.log('  node app/server/scripts/compare-scans.js --repo owner/name');
    console.log('  node app/server/scripts/compare-scans.js --repo owner/name --limit 5');
    console.log('  node app/server/scripts/compare-scans.js --current <id> --baseline <id>');
    process.exit(args.help ? 0 : 1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(2);
  }

  if (args.list) {
    await listRecent(args.list);
    await getDb().end?.();
    return;
  }

  let currentId = args.current;
  let baselineId = args.baseline;
  let history = [];

  if (args.repo) {
    history = await pickRecentForRepo(args.repo, Math.max(args.limit, 2));
    if (history.length < 2) {
      console.error(`Only found ${history.length} completed scan(s) for ${args.repo}. Need at least 2.`);
      process.exit(2);
    }
    currentId  = currentId  || history[0].id;
    baselineId = baselineId || history[1].id;
    console.log(`Repo: ${args.repo}`);
    console.log(`Recent scans (newest first):`);
    for (const h of history) {
      const tag = h.id === currentId ? ' ← CURRENT' : h.id === baselineId ? ' ← BASELINE' : '';
      console.log(`  ${h.id}  ${h.created_at}  ${h.status}${tag}`);
    }
    console.log('');
  }

  const [current, baseline] = await Promise.all([loadScan(currentId), loadScan(baselineId)]);

  console.log(`CURRENT : ${currentId}  (${current.meta.owner}/${current.meta.repo}, ${current.meta.created_at})`);
  console.log(`BASELINE: ${baselineId} (${baseline.meta.owner}/${baseline.meta.repo}, ${baseline.meta.created_at})`);
  console.log('');
  console.log('── Cost & token rollups ──');
  console.log(renderRollup(current, baseline));
  console.log('');
  console.log('── Per-phase LLM breakdown ──');
  console.log(renderPhases(current, baseline));
  console.log('');
  console.log('── File-tier distribution ──');
  console.log(renderTiers(current, baseline));
  console.log('');
  console.log('── Import graph (Phase 2 — should be populated post-deploy) ──');
  console.log(renderGraph(current, baseline));
  console.log('');
  console.log('── Capability detectors ──');
  console.log(renderGaps(current, baseline));
  console.log('');

  await getDb().end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
