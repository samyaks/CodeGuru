/**
 * Ask Takeoff caps. `decide` is pure: it takes the usage that
 * db.askMessages.usage() reads and the config from ./config, and says
 * whether one more question may start. db.askMessages.startQuestion calls it
 * inside the transaction that records the question.
 *
 * Reasons, in the order they're checked:
 *   disabled       Ask is off for this deployment
 *   daily_limit    the member asked dailyPerMember questions in the last 24h
 *   monthly_budget the project's spend this month, plus a reserve for each
 *                  answer still running, would pass monthlyUsd
 */

const { askConfig } = require('./config');

const DAY_MS = 24 * 60 * 60 * 1000;

/** First instant of the next calendar month, UTC. */
function nextMonthStartUtc(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

function toDate(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{ questionsToday?: number, oldestToday?: Date|string|null, spentThisMonth?: number, running?: number }} usage
 * @param {{ config?: object, now?: Date|number }} [opts]
 * @returns {{ allowed: boolean, reason: string|null, resetsAt: string|null,
 *            questionsLeft: number, budgetLeftUsd: number }}
 */
function decide(usage = {}, { config = askConfig(), now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const asked = Math.max(0, Number(usage.questionsToday) || 0);
  const spent = Math.max(0, Number(usage.spentThisMonth) || 0);
  const running = Math.max(0, Number(usage.running) || 0);

  const questionsLeft = Math.max(0, config.dailyPerMember - asked);
  const committed = spent + running * config.reserveUsd;
  const budgetLeftUsd = Math.max(0, Math.round((config.monthlyUsd - committed) * 10000) / 10000);
  const base = { questionsLeft, budgetLeftUsd };

  if (!config.enabled) {
    return { allowed: false, reason: 'disabled', resetsAt: null, ...base };
  }
  if (asked >= config.dailyPerMember) {
    // The window rolls: a slot frees up 24h after the oldest question in it.
    const oldest = toDate(usage.oldestToday);
    const resetsAt = new Date((oldest ? oldest.getTime() : nowMs) + DAY_MS).toISOString();
    return { allowed: false, reason: 'daily_limit', resetsAt, ...base };
  }
  // One more answer will also need its reserve, so it must fit too.
  if (committed + config.reserveUsd > config.monthlyUsd || spent >= config.monthlyUsd) {
    return { allowed: false, reason: 'monthly_budget', resetsAt: nextMonthStartUtc(nowMs).toISOString(), ...base };
  }
  return { allowed: true, reason: null, resetsAt: null, ...base };
}

/** What a member reads when a question can't start. */
function limitMessage(verdict) {
  switch (verdict && verdict.reason) {
    case 'disabled':
      return 'Ask Takeoff is not turned on for this workspace.';
    case 'daily_limit':
      return 'You have reached today’s question limit for this project. You can ask again once the oldest question is a day old.';
    case 'monthly_budget':
      return 'This project has used its Ask Takeoff budget for the month. It resets on the first of next month (UTC).';
    case 'thread_not_found':
      return 'That conversation was not found.';
    default:
      return 'This question can’t be answered right now.';
  }
}

module.exports = { decide, limitMessage, nextMonthStartUtc };
