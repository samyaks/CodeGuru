const { test } = require('node:test');
const assert = require('node:assert');

const { decide, limitMessage, nextMonthStartUtc } = require('./limits');
const { askConfig, isAskEnabled, isAskEnabledFor, DEFAULTS } = require('./config');

const ON = { ...askConfig({}), enabled: true };
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0); // 2026-11-27T12:00Z

test('config defaults: off, Opus 5.5, 30/day, $20/month, 8 rounds, $1.50 reserve', () => {
  const c = askConfig({});
  assert.strictEqual(c.enabled, false);
  assert.strictEqual(c.model, 'claude-opus-5-5');
  assert.strictEqual(c.dailyPerMember, 30);
  assert.strictEqual(c.monthlyUsd, 20);
  assert.strictEqual(c.maxRounds, 8);
  assert.strictEqual(c.reserveUsd, 1.5);
  assert.strictEqual(c.maxRunningPerMember, 2);
  assert.strictEqual(c.maxRunningPerProject, 5);
  assert.strictEqual(c.modelPriced, true);
});

test('config reads overrides and ignores junk', () => {
  const c = askConfig({
    TAKEOFF_ASK_ENABLED: 'TRUE', TAKEOFF_ASK_MODEL: ' claude-sonnet-5-5 ',
    TAKEOFF_ASK_DAILY_PER_MEMBER: '5', TAKEOFF_ASK_MONTHLY_USD: '2.5',
    TAKEOFF_ASK_MAX_ROUNDS: '99', TAKEOFF_ASK_RESERVE_USD: '0.01',
  });
  assert.strictEqual(c.enabled, true);
  assert.strictEqual(c.model, 'claude-sonnet-5-5');
  assert.strictEqual(c.dailyPerMember, 5);
  assert.strictEqual(c.monthlyUsd, 2.5);
  assert.strictEqual(c.maxRounds, 20);
  assert.strictEqual(c.reserveUsd, DEFAULTS.minReserveUsd);

  const bad = askConfig({ TAKEOFF_ASK_DAILY_PER_MEMBER: '-3', TAKEOFF_ASK_MONTHLY_USD: 'lots', TAKEOFF_ASK_RESERVE_USD: '-1' });
  assert.strictEqual(bad.dailyPerMember, 30);
  assert.strictEqual(bad.monthlyUsd, 20);
  assert.strictEqual(bad.reserveUsd, DEFAULTS.reserveUsd);
  assert.strictEqual(askConfig({ TAKEOFF_ASK_RESERVE_USD: '0' }).reserveUsd, DEFAULTS.reserveUsd);
});

test('isAskEnabled accepts only 1/true', () => {
  assert.strictEqual(isAskEnabled({ TAKEOFF_ASK_ENABLED: '1' }), true);
  assert.strictEqual(isAskEnabled({ TAKEOFF_ASK_ENABLED: 'yes' }), false);
  assert.strictEqual(isAskEnabled({}), false);
});

test('disabled wins over everything', () => {
  const v = decide({}, { config: askConfig({}), now: NOW });
  assert.strictEqual(v.allowed, false);
  assert.strictEqual(v.reason, 'disabled');
});

test('fresh member on a fresh project may ask', () => {
  const v = decide({ questionsToday: 0, spentThisMonth: 0, running: 0 }, { config: ON, now: NOW });
  assert.deepStrictEqual(v, { allowed: true, reason: null, resetsAt: null, questionsLeft: 30, budgetLeftUsd: 20 });
});

test('daily limit is inclusive and resets 24h after the oldest question', () => {
  const oldest = new Date(NOW - 3 * 60 * 60 * 1000);
  assert.strictEqual(decide({ questionsToday: 29, oldestToday: oldest }, { config: ON, now: NOW }).allowed, true);
  const v = decide({ questionsToday: 30, oldestToday: oldest.toISOString() }, { config: ON, now: NOW });
  assert.strictEqual(v.allowed, false);
  assert.strictEqual(v.reason, 'daily_limit');
  assert.strictEqual(v.resetsAt, new Date(oldest.getTime() + 86400000).toISOString());
  assert.strictEqual(v.questionsLeft, 0);
});

test('monthly budget counts a reserve for running answers and for the new one', () => {
  // $18.40 spent + new answer's $1.50 reserve = $19.90: fits.
  assert.strictEqual(decide({ spentThisMonth: 18.4 }, { config: ON, now: NOW }).allowed, true);
  // $18.40 + one running ($1.50) + new ($1.50) = $21.40: doesn't fit.
  const v = decide({ spentThisMonth: 18.4, running: 1 }, { config: ON, now: NOW });
  assert.strictEqual(v.allowed, false);
  assert.strictEqual(v.reason, 'monthly_budget');
  assert.strictEqual(v.resetsAt, '2026-12-01T00:00:00.000Z');
  assert.strictEqual(v.budgetLeftUsd, 0.1);
});

test('runningReserve replaces the flat reserve, so spend is not counted twice', () => {
  // One running answer has spent $1.20 (already in spentThisMonth), so only
  // $0.30 of its reserve is still held: $18.40 + $0.30 + $1.50 = $20.20.
  assert.strictEqual(decide({ spentThisMonth: 18.4, running: 1, runningReserve: 0.3 }, { config: ON, now: NOW }).allowed, false);
  assert.strictEqual(decide({ spentThisMonth: 18.0, running: 1, runningReserve: 0.3 }, { config: ON, now: NOW }).allowed, true);
});

test('busy when the member or the project has the most answers running', () => {
  assert.strictEqual(decide({ running: 2, runningMine: 2 }, { config: { ...ON, monthlyUsd: 100 }, now: NOW }).reason, 'busy');
  assert.strictEqual(decide({ running: 5, runningMine: 0 }, { config: { ...ON, monthlyUsd: 100 }, now: NOW }).reason, 'busy');
  assert.strictEqual(decide({ running: 1, runningMine: 1 }, { config: { ...ON, monthlyUsd: 100 }, now: NOW }).allowed, true);
});

test('a model with no price stops Ask', () => {
  const cfg = askConfig({ TAKEOFF_ASK_ENABLED: '1', TAKEOFF_ASK_MODEL: 'some-other-model' });
  assert.strictEqual(cfg.modelPriced, false);
  assert.strictEqual(decide({}, { config: cfg, now: NOW }).reason, 'unpriced_model');
});

test('spend at or over the budget blocks even with no reserve', () => {
  const cfg = { ...ON, reserveUsd: 0 };
  assert.strictEqual(decide({ spentThisMonth: 19.99 }, { config: cfg, now: NOW }).allowed, true);
  assert.strictEqual(decide({ spentThisMonth: 20 }, { config: cfg, now: NOW }).reason, 'monthly_budget');
});

test('daily limit is checked before the budget', () => {
  const v = decide({ questionsToday: 30, spentThisMonth: 50 }, { config: ON, now: NOW });
  assert.strictEqual(v.reason, 'daily_limit');
});

test('nextMonthStartUtc rolls the year', () => {
  assert.strictEqual(nextMonthStartUtc(Date.UTC(2026, 11, 31, 23, 59)).toISOString(), '2027-01-01T00:00:00.000Z');
});

test('limitMessage has a line for every reason', () => {
  for (const reason of ['disabled', 'unpriced_model', 'busy', 'daily_limit', 'monthly_budget', 'thread_not_found', 'other']) {
    assert.ok(limitMessage({ reason }).length > 10, reason);
  }
});

test('a person and the deployment have monthly ceilings across projects', () => {
  const c = askConfig({ TAKEOFF_ASK_USER_MONTHLY_USD: '10', TAKEOFF_ASK_GLOBAL_MONTHLY_USD: '100' });
  assert.deepStrictEqual([askConfig({}).userMonthlyUsd, askConfig({}).globalMonthlyUsd], [40, 300]);
  const cfg = { ...c, enabled: true };
  assert.strictEqual(decide({ spentThisMonth: 0, spentByUserThisMonth: 8 }, { config: cfg, now: NOW }).allowed, true);
  let v = decide({ spentThisMonth: 0, spentByUserThisMonth: 8.6 }, { config: cfg, now: NOW });
  assert.deepStrictEqual([v.allowed, v.reason, v.resetsAt], [false, 'user_budget', '2026-12-01T00:00:00.000Z']);
  v = decide({ spentThisMonth: 0, spentByUserThisMonth: 5, runningReserveByUser: 4 }, { config: cfg, now: NOW });
  assert.strictEqual(v.reason, 'user_budget', 'their answers running on other projects count');
  v = decide({ spentThisMonth: 0, spentByUserThisMonth: 0, spentAllThisMonth: 99 }, { config: cfg, now: NOW });
  assert.strictEqual(v.reason, 'global_budget');
  assert.match(limitMessage({ reason: 'user_budget' }), /across your projects/);
  assert.match(limitMessage({ reason: 'global_budget' }), /reached its budget/);
});

test('TAKEOFF_ASK_PROJECTS limits Ask to the listed projects', () => {
  const on = { TAKEOFF_ASK_ENABLED: '1' };
  assert.strictEqual(isAskEnabledFor({ id: 'p1' }, on), true);
  assert.strictEqual(askConfig(on).projects, null);
  const listed = { ...on, TAKEOFF_ASK_PROJECTS: ' p2 , p1 ,' };
  assert.deepStrictEqual(askConfig(listed).projects, ['p2', 'p1']);
  assert.strictEqual(isAskEnabledFor({ id: 'p1' }, listed), true);
  assert.strictEqual(isAskEnabledFor({ id: 'p3' }, listed), false);
  assert.strictEqual(isAskEnabledFor({ id: 'p1' }, { TAKEOFF_ASK_PROJECTS: 'p1' }), false);
  assert.strictEqual(isAskEnabledFor(null, listed), false);
  // Set but holding no ids: no project.
  assert.strictEqual(isAskEnabledFor({ id: 'p1' }, { ...on, TAKEOFF_ASK_PROJECTS: ' , ' }), false);
});
