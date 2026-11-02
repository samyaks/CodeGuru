#!/usr/bin/env node
// Prints the acquisition funnel, waitlist size, scan timings and Claude
// spend for the last N days. Run from app/:
//
//   npm run report:funnel            # last 7 days
//   npm run report:funnel -- 30      # last 30 days
//
// Reads DATABASE_URL via dotenv like the server does.

require('dotenv').config();
const { getDb } = require('../lib/db');

const FUNNEL = [
  ['landing_viewed', 'Landed'],
  ['scan_started', 'Started a scan'],
  ['scan_ready', 'Scan finished'],
  ['read_viewed', 'Opened the Spec'],
  ['build_viewed', 'Opened Build'],
  ['prompt_loaded', 'Prompt loaded'],
  ['prompt_copied', 'Copied a prompt'],
  ['sign_in_clicked', 'Clicked sign in'],
];

function pct(n, d) {
  if (!d) return '   —';
  return `${String(Math.round((n / d) * 100)).padStart(3)}%`;
}

function fmtSec(s) {
  if (s == null) return '—';
  const n = Number(s);
  return n >= 90 ? `${(n / 60).toFixed(1)}m` : `${Math.round(n)}s`;
}

async function main() {
  const days = Math.max(1, parseInt(process.argv[2], 10) || 7);
  const db = getDb();
  const since = `now() - interval '${days} days'`;

  // Sessions per step. scan_ready/scan_failed are server-side (session_id
  // 'server'), so count those by project instead.
  const { rows: ev } = await db.query(
    `SELECT event,
            count(DISTINCT CASE WHEN session_id <> 'server' THEN session_id END) AS sessions,
            count(DISTINCT project_id) AS projects,
            count(*) AS total
       FROM funnel_events
      WHERE created_at >= ${since}
      GROUP BY event`,
  );
  const byEvent = Object.fromEntries(ev.map((r) => [r.event, r]));

  const { rows: [scans] } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'ready')  AS ready,
            count(*) FILTER (WHERE status = 'failed') AS failed,
            count(*)                                  AS total
       FROM deployments
      WHERE created_at >= ${since}`,
  );

  const { rows: [timing] } = await db.query(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at - created_at))) AS p50,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at - created_at))) AS p90,
            count(*) AS n
       FROM analyses
      WHERE completed_at IS NOT NULL AND created_at >= ${since}`,
  );

  const { rows: [spend] } = await db.query(
    `SELECT count(*) AS scans,
            round(coalesce(sum(s), 0)::numeric, 2) AS total_usd,
            round(coalesce(avg(s), 0)::numeric, 3) AS avg_usd,
            round(coalesce(max(s), 0)::numeric, 3) AS max_usd
       FROM (SELECT analysis_id, sum(cost_usd) AS s
               FROM analysis_llm_calls
              WHERE created_at >= ${since}
              GROUP BY analysis_id) t`,
  );

  const { rows: byPhase } = await db.query(
    `SELECT phase, round(sum(cost_usd)::numeric, 2) AS usd, count(*) AS calls
       FROM analysis_llm_calls
      WHERE created_at >= ${since}
      GROUP BY phase ORDER BY sum(cost_usd) DESC LIMIT 8`,
  );

  const { rows: [wl] } = await db.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE created_at >= ${since}) AS recent
       FROM waitlist`,
  );
  const { rows: wlSources } = await db.query(
    `SELECT coalesce(source, '—') AS source, count(*) AS n FROM waitlist GROUP BY source ORDER BY n DESC`,
  );

  const landed = Number(byEvent.landing_viewed?.sessions || 0);

  console.log(`\nTakeoff — last ${days} day${days === 1 ? '' : 's'}\n`);
  console.log('FUNNEL (unique browsers; scan finished = projects)');
  for (const [event, label] of FUNNEL) {
    const r = byEvent[event];
    const n = event === 'scan_ready' ? Number(r?.projects || 0) : Number(r?.sessions || 0);
    console.log(`  ${label.padEnd(18)} ${String(n).padStart(6)}  ${pct(n, landed)} of landed`);
  }
  if (byEvent.scan_failed) {
    console.log(`  ${'Scan failed'.padEnd(18)} ${String(byEvent.scan_failed.projects).padStart(6)}`);
  }

  console.log('\nSCANS');
  console.log(`  started ${scans.total}, ready ${scans.ready}, failed ${scans.failed}`);
  console.log(`  time to ready: p50 ${fmtSec(timing.p50)}, p90 ${fmtSec(timing.p90)}  (n=${timing.n})`);

  console.log('\nCLAUDE SPEND');
  console.log(`  $${spend.total_usd} across ${spend.scans} scans — avg $${spend.avg_usd}, max $${spend.max_usd}`);
  for (const r of byPhase) {
    console.log(`    ${String(r.phase).padEnd(28)} $${String(r.usd).padStart(7)}  (${r.calls} calls)`);
  }

  console.log('\nWAITLIST');
  console.log(`  ${wl.total} total, ${wl.recent} in window`);
  for (const r of wlSources) console.log(`    ${String(r.source).padEnd(16)} ${r.n}`);
  console.log('');

  await db.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
