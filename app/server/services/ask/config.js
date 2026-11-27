/**
 * Ask Takeoff settings (Milestone 8). Read from the environment on each call
 * so tests and a restart pick up changes without a code edit.
 *
 *   TAKEOFF_ASK_ENABLED        '1' or 'true' turns Ask on. Off by default.
 *   TAKEOFF_ASK_MODEL          model id, default claude-opus-5-5
 *   TAKEOFF_ASK_DAILY_PER_MEMBER  questions per member per project per rolling 24h (30)
 *   TAKEOFF_ASK_MONTHLY_USD    spend per project per calendar month, UTC (20)
 *   TAKEOFF_ASK_MAX_ROUNDS     tool rounds per question (8)
 *   TAKEOFF_ASK_RESERVE_USD    spend held back for each answer still running (0.50)
 */

const DEFAULTS = Object.freeze({
  model: 'claude-opus-5-5',
  dailyPerMember: 30,
  monthlyUsd: 20,
  maxRounds: 8,
  reserveUsd: 0.5,
});

function positive(raw, fallback, { integer = false } = {}) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return integer ? Math.floor(n) || fallback : n;
}

function nonNegative(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isAskEnabled(env = process.env) {
  const v = String(env.TAKEOFF_ASK_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

function askConfig(env = process.env) {
  const model = String(env.TAKEOFF_ASK_MODEL || '').trim() || DEFAULTS.model;
  return {
    enabled: isAskEnabled(env),
    model,
    dailyPerMember: positive(env.TAKEOFF_ASK_DAILY_PER_MEMBER, DEFAULTS.dailyPerMember, { integer: true }),
    monthlyUsd: positive(env.TAKEOFF_ASK_MONTHLY_USD, DEFAULTS.monthlyUsd),
    maxRounds: Math.min(positive(env.TAKEOFF_ASK_MAX_ROUNDS, DEFAULTS.maxRounds, { integer: true }), 20),
    reserveUsd: nonNegative(env.TAKEOFF_ASK_RESERVE_USD, DEFAULTS.reserveUsd),
  };
}

module.exports = { DEFAULTS, isAskEnabled, askConfig };
