'use strict';

/**
 * get_plan and rules_for_path: what takeoff.yaml says, read from the stored
 * code index when it is current, otherwise from GitHub at the default
 * branch's head. Rule ids are stable, so an answer can cite one exactly.
 */

const { FILENAME } = require('@takeoff/cli');
const { loadIntent } = require('../../verdict/intent');
const { touchedAreas } = require('../../verdict/globs');
const { AskToolError, normalizePath } = require('./safety');

const sha12 = (sha) => String(sha || '').slice(0, 12);

/**
 * The plan for this question, read once. `{ ok, sha, from, intent, reason, stale }`.
 * `from` is 'index' or 'github'. A plan that can't be read is reported,
 * never guessed at. The promise is cached, so calls made side by side share
 * one read.
 */
function loadPlan(ctx) {
  if (!ctx.cache.plan) ctx.cache.plan = readPlan(ctx);
  return ctx.cache.plan;
}

const UNREADABLE = { ok: false, sha: null, from: null, intent: null, reason: 'unreadable', errors: [] };

async function readPlan(ctx) {
  const { project, deps } = ctx;
  let stored = null;
  try {
    const row = await deps.codeIndex.getRepo(project.id);
    if (row && row.indexed_sha && ['ready', 'behind'].includes(row.status)) {
      stored = { row, file: await deps.codeIndex.readFile(project.id, FILENAME) };
    }
  } catch { /* fall through to GitHub */ }
  const gh = () => deps.clientFor(project);

  if (stored && stored.row.status === 'ready') {
    const sha = stored.row.indexed_sha;
    const { file } = stored;
    if (!file) return fromText(null, sha, 'index');
    // The stored copy is used only when it is the file's exact text. When the
    // index skipped it or hid text in it, read that same commit from GitHub,
    // so rules are quoted as the PR check sees them.
    if (file.content != null && !(Number(file.redactions) > 0)) return fromText(file.content, sha, 'index');
    try {
      const text = await gh().fetchFileTextOrNull(project.owner, project.repo, FILENAME, sha);
      return fromText(text, sha, 'github');
    } catch {
      if (file.content == null) return { ...UNREADABLE, sha };
      return { ...fromText(file.content, sha, 'index'), redacted: true };
    }
  }

  try {
    const meta = await gh().fetchRepoMeta(project.owner, project.repo);
    const branch = (meta && meta.default_branch) || 'main';
    const head = await gh().fetchBranch(project.owner, project.repo, branch);
    const sha = head && head.commit && head.commit.sha;
    if (!sha) throw new Error('no head');
    const text = await gh().fetchFileTextOrNull(project.owner, project.repo, FILENAME, sha);
    return fromText(text, sha, 'github');
  } catch {
    if (!stored) return UNREADABLE;
    const { file, row } = stored;
    if (file && file.content == null) return { ...UNREADABLE, sha: row.indexed_sha };
    return { ...fromText(file ? file.content : null, row.indexed_sha, 'index'), stale: true, redacted: !!(file && Number(file.redactions) > 0) };
  }
}

function fromText(text, sha, from) {
  const loaded = loadIntent(text);
  if (!loaded.present) return { ok: false, sha, from, intent: null, reason: 'missing', errors: [] };
  if (!loaded.ok) return { ok: false, sha, from, intent: null, reason: 'invalid', errors: loaded.errors.slice(0, 5) };
  return { ok: true, sha, from, intent: loaded.intent, reason: null, errors: [] };
}

const REASONS = {
  missing: `This repo has no ${FILENAME} yet, so there is no plan to answer from.`,
  invalid: `${FILENAME} has errors, so the plan can't be read until they're fixed.`,
  unreadable: 'Takeoff can’t read this repo right now, so the plan isn’t available. Agreements, decisions and PR checks still are.',
};

function unavailable(plan) {
  return { available: false, reason: REASONS[plan.reason] || REASONS.unreadable, errors: plan.errors, sources: [] };
}

function planSource(ctx, plan, path, text, extra = {}) {
  const id = `plan@${sha12(plan.sha)}#${path}`;
  ctx.addSource(id, { kind: 'plan', sha: plan.sha, path, text, ...extra });
  return id;
}

function areaOut(ctx, plan, area) {
  // A rule's own id when it has one, so adding a rule doesn't shift the rest.
  const rule = (kind) => (r, i) => ({
    source_id: planSource(ctx, plan, r.id ? `${area.id}.${kind}.${r.id}` : `${area.id}.${kind}[${i}]`, r.text, { area: area.id }),
    text: r.text,
  });
  return {
    id: area.id,
    name: area.name,
    paths: area.paths,
    creators: area.creators.length,
    rules: area.rules.map(rule('rules')),
    never: area.never.map(rule('never')),
  };
}

function agreementOut(ctx, plan, g) {
  return {
    source_id: planSource(ctx, plan, `agreements[${g.id}]`, g.text, { area: g.area, agreementId: g.id }),
    id: g.id,
    area: g.area,
    text: g.text,
  };
}

/** get_plan(area?) */
async function getPlan(ctx, input = {}) {
  const plan = await loadPlan(ctx);
  if (!plan.ok) return unavailable(plan);
  const { intent } = plan;
  let areas = intent.areas;
  if (input.area != null && input.area !== '') {
    const want = String(input.area).toLowerCase();
    areas = areas.filter((a) => a.id.toLowerCase() === want || a.name.toLowerCase() === want);
    if (!areas.length) {
      return {
        available: true,
        sha: plan.sha,
        found: false,
        message: `No area called "${String(input.area).slice(0, 80)}". The areas are: ${intent.areas.map((a) => a.id).join(', ') || 'none'}.`,
        sources: [],
      };
    }
  }
  const areaIds = new Set(areas.map((a) => a.id));
  const agreements = intent.agreements.filter((g) => !input.area || g.area === null || areaIds.has(g.area));
  const out = {
    available: true,
    sha: plan.sha,
    stale: !!plan.stale,
    note: plan.redacted ? 'Some text in the plan looked like a secret and is hidden here.' : undefined,
    product: intent.product,
    areas: areas.map((a) => areaOut(ctx, plan, a)),
    agreements: agreements.map((g) => agreementOut(ctx, plan, g)),
  };
  out.sources = [...out.areas.flatMap((a) => [...a.rules, ...a.never]), ...out.agreements].map((x) => x.source_id);
  return out;
}

/** rules_for_path(path): the areas whose paths cover it, with the same matcher as the PR check. */
async function rulesForPath(ctx, input = {}) {
  const path = normalizePath(input.path);
  const plan = await loadPlan(ctx);
  if (!plan.ok) return unavailable(plan);
  const { touched } = touchedAreas(plan.intent, [path]);
  const areas = touched.map(({ area }) => areaOut(ctx, plan, area));
  const ids = new Set(areas.map((a) => a.id));
  const agreements = plan.intent.agreements
    .filter((g) => g.area === null || ids.has(g.area))
    .map((g) => agreementOut(ctx, plan, g));
  return {
    available: true,
    sha: plan.sha,
    stale: !!plan.stale,
    note: plan.redacted ? 'Some text in the plan looked like a secret and is hidden here.' : undefined,
    path,
    covered: areas.length > 0,
    message: areas.length ? undefined : 'No area in the plan covers this path; only product-wide agreements apply.',
    areas,
    agreements,
    sources: [...areas.flatMap((a) => [...a.rules, ...a.never]), ...agreements].map((x) => x.source_id),
  };
}

module.exports = { loadPlan, getPlan, rulesForPath, AskToolError };
