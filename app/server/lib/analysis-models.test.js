const { test } = require('node:test');
const assert = require('node:assert');

const {
  listAnalysisModels,
  resolveAnalysisModel,
  projectLlmTokens,
  buildEstimate,
} = require('./analysis-models');

test('listAnalysisModels includes haiku, sonnet, opus and a default', () => {
  const catalog = listAnalysisModels();
  const ids = catalog.models.map((m) => m.id);
  assert.deepStrictEqual(ids, ['haiku', 'sonnet', 'opus']);
  assert.ok(['haiku', 'sonnet', 'opus'].includes(catalog.defaultModelId));
  assert.strictEqual(catalog.models.find((m) => m.id === 'sonnet').recommended, true);
});

const SIGNED_IN = { signedIn: true };

test('resolveAnalysisModel accepts ids and full model strings', () => {
  assert.strictEqual(resolveAnalysisModel('haiku').id, 'haiku');
  assert.strictEqual(resolveAnalysisModel('sonnet').id, 'sonnet');
  assert.strictEqual(resolveAnalysisModel('opus', SIGNED_IN).id, 'opus');
  assert.strictEqual(resolveAnalysisModel('claude-haiku-4-5').id, 'haiku');
  assert.strictEqual(resolveAnalysisModel('').id, resolveAnalysisModel(null).id);
});

test('resolveAnalysisModel accepts dated snapshots of a picker model', () => {
  assert.strictEqual(resolveAnalysisModel('claude-haiku-4-5-20251001').id, 'haiku');
});

test('resolveAnalysisModel rejects unknown ids and bare prefixes', () => {
  assert.throws(() => resolveAnalysisModel('gpt-4o'), /Unknown model/);
  assert.throws(() => resolveAnalysisModel('claude'), /Unknown model/);
  assert.throws(() => resolveAnalysisModel('claude-opus'), /Unknown model/);
});

test('opus resolves to a current model id', () => {
  assert.strictEqual(resolveAnalysisModel('opus', SIGNED_IN).model, 'claude-opus-5-5');
});

test('signed-out callers cannot pick opus', () => {
  for (const raw of ['opus', 'claude-opus-5-5']) {
    assert.throws(
      () => resolveAnalysisModel(raw, { signedIn: false }),
      (err) => err.statusCode === 401 && /Sign in to use Opus/.test(err.message),
    );
  }
  // Leaving signedIn out counts as signed out.
  assert.throws(() => resolveAnalysisModel('opus'), /Sign in to use Opus/);
  assert.strictEqual(resolveAnalysisModel('haiku', { signedIn: false }).id, 'haiku');
});

test('the catalog marks opus unavailable only when signed out', () => {
  const opusOf = (catalog) => catalog.models.find((m) => m.id === 'opus');
  assert.strictEqual(opusOf(listAnalysisModels()).available, false);
  assert.strictEqual(opusOf(listAnalysisModels()).unavailableReason, 'Sign in to use Opus.');
  assert.strictEqual(opusOf(listAnalysisModels(SIGNED_IN)).available, true);
  assert.strictEqual(opusOf(listAnalysisModels(SIGNED_IN)).unavailableReason, null);
  for (const m of listAnalysisModels().models.filter((x) => x.id !== 'opus')) {
    assert.strictEqual(m.available, true, m.id);
  }
});

test('an opus env default falls back to sonnet for signed-out callers', () => {
  const prev = process.env.CLAUDE_MODEL;
  process.env.CLAUDE_MODEL = 'claude-opus-5-5';
  try {
    assert.strictEqual(listAnalysisModels().defaultModelId, 'sonnet');
    assert.strictEqual(resolveAnalysisModel(null).id, 'sonnet');
    assert.strictEqual(listAnalysisModels(SIGNED_IN).defaultModelId, 'opus');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = prev;
  }
});

test('projectLlmTokens grows with file count but stays capped', () => {
  const small = projectLlmTokens({ fileCount: 20, treeBytes: 80_000 });
  const large = projectLlmTokens({ fileCount: 400, treeBytes: 2_000_000 });
  assert.ok(large.ingestedFiles <= 150);
  assert.ok(large.inputTokens > small.inputTokens);
  assert.ok(large.treeTokens > small.treeTokens);
  assert.strictEqual(small.treeTokens, Math.ceil(80_000 / 4));
});

test('buildEstimate prices opus above sonnet above haiku', () => {
  const estimate = buildEstimate({ fileCount: 80, treeBytes: 400_000 });
  const byId = Object.fromEntries(estimate.models.map((m) => [m.id, m.estimate]));
  assert.ok(byId.opus.costUsd > byId.sonnet.costUsd);
  assert.ok(byId.sonnet.costUsd > byId.haiku.costUsd);
  assert.ok(byId.sonnet.costUsdLow <= byId.sonnet.costUsd);
  assert.ok(byId.sonnet.costUsdHigh >= byId.sonnet.costUsd);
  assert.strictEqual(estimate.corpus.fileCount, 80);
});

test('buildEstimate defaults to preferredModel when it resolves', () => {
  assert.strictEqual(buildEstimate({ fileCount: 10, preferredModel: 'haiku' }).defaultModelId, 'haiku');
  assert.strictEqual(
    buildEstimate({ fileCount: 10, preferredModel: 'claude-opus-5-5', ...SIGNED_IN }).defaultModelId,
    'opus',
  );
  const fallback = buildEstimate({ fileCount: 10, preferredModel: 'claude-opus-4' }).defaultModelId;
  assert.strictEqual(fallback, buildEstimate({ fileCount: 10 }).defaultModelId);
});

test('buildEstimate ignores a preferred opus for signed-out callers', () => {
  const estimate = buildEstimate({ fileCount: 10, preferredModel: 'opus' });
  assert.notStrictEqual(estimate.defaultModelId, 'opus');
  assert.strictEqual(estimate.models.find((m) => m.id === 'opus').available, false);
});
