/**
 * Ask Takeoff settings (Milestone 8). Read from the environment on each call
 * so tests and a restart pick up changes without a code edit.
 *
 *   TAKEOFF_ASK_ENABLED        '1' or 'true' turns Ask on. Off by default.
 *   TAKEOFF_ASK_PROJECTS       optional comma-separated project ids; when set, Ask
 *                              (and its code index) runs for those projects only
 *   TAKEOFF_ASK_MODEL          model id, default claude-opus-5-5
 *   TAKEOFF_ASK_DAILY_PER_MEMBER  questions per member per project per rolling 24h (30)
 *   TAKEOFF_ASK_MONTHLY_USD    spend per project per calendar month, UTC (20)
 *   TAKEOFF_ASK_USER_MONTHLY_USD   spend per person per month, across all their projects (40)
 *   TAKEOFF_ASK_GLOBAL_MONTHLY_USD spend per month for the whole deployment (300)
 *   TAKEOFF_ASK_MAX_ROUNDS     model calls per question (8); the last one answers without lookups
 *   TAKEOFF_ASK_RESERVE_USD    spend held back for each answer still running (1.50, at least 0.05)
 *   TAKEOFF_ASK_MAX_RUNNING_PER_MEMBER   answers one member may have running at once (2)
 *   TAKEOFF_ASK_MAX_RUNNING_PER_PROJECT  answers a project may have running at once (5)
 *
 * The reserve keeps a burst of questions from overspending the month before
 * their costs are known. It is not a ceiling on one answer: the agent loop
 * also stops an answer once recorded spend reaches the monthly budget.
 */

const { hasPrice } = require('../../lib/model-pricing');

const DEFAULTS = Object.freeze({
  model: 'claude-opus-5-5',
  dailyPerMember: 30,
  monthlyUsd: 20,
  userMonthlyUsd: 40,
  globalMonthlyUsd: 300,
  maxRounds: 8,
  reserveUsd: 1.5,
  minReserveUsd: 0.05,
  maxRunningPerMember: 2,
  maxRunningPerProject: 5,
});

function positive(raw, fallback, { integer = false } = {}) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return integer ? Math.floor(n) || fallback : n;
}


function isAskEnabled(env = process.env) {
  const v = String(env.TAKEOFF_ASK_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** The project ids Ask is limited to, or null when it isn't limited. */
function askProjects(env = process.env) {
  const raw = String(env.TAKEOFF_ASK_PROJECTS || '').trim();
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Ask is on and, when TAKEOFF_ASK_PROJECTS is set, this project is on the list. */
function isAskEnabledFor(project, env = process.env) {
  if (!isAskEnabled(env) || !project || project.id == null) return false;
  const list = askProjects(env);
  return !list || list.includes(String(project.id));
}

function askConfig(env = process.env) {
  const model = String(env.TAKEOFF_ASK_MODEL || '').trim() || DEFAULTS.model;
  return {
    enabled: isAskEnabled(env),
    projects: askProjects(env),
    model,
    dailyPerMember: positive(env.TAKEOFF_ASK_DAILY_PER_MEMBER, DEFAULTS.dailyPerMember, { integer: true }),
    monthlyUsd: positive(env.TAKEOFF_ASK_MONTHLY_USD, DEFAULTS.monthlyUsd),
    // Anyone signed in can add projects, each with its own budget, so a
    // person and the deployment have monthly ceilings too.
    userMonthlyUsd: positive(env.TAKEOFF_ASK_USER_MONTHLY_USD, DEFAULTS.userMonthlyUsd),
    globalMonthlyUsd: positive(env.TAKEOFF_ASK_GLOBAL_MONTHLY_USD, DEFAULTS.globalMonthlyUsd),
    maxRounds: Math.min(positive(env.TAKEOFF_ASK_MAX_ROUNDS, DEFAULTS.maxRounds, { integer: true }), 20),
    reserveUsd: Math.max(DEFAULTS.minReserveUsd, positive(env.TAKEOFF_ASK_RESERVE_USD, DEFAULTS.reserveUsd)),
    maxRunningPerMember: positive(env.TAKEOFF_ASK_MAX_RUNNING_PER_MEMBER, DEFAULTS.maxRunningPerMember, { integer: true }),
    maxRunningPerProject: positive(env.TAKEOFF_ASK_MAX_RUNNING_PER_PROJECT, DEFAULTS.maxRunningPerProject, { integer: true }),
    // A model with no price would be costed at the $3/$15 fallback and could
    // overspend the budget, so Ask refuses to run on one.
    modelPriced: hasPrice(model),
  };
}

module.exports = { DEFAULTS, isAskEnabled, isAskEnabledFor, askProjects, askConfig };
