'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { checkAnalysisView, checkAnalysisManage, publicAnalysis } = require('./analysis-access');

const projects = new Map([['claimed', { id: 'claimed', user_id: 'olive' }]]);
const deps = { deployments: { findById: async (id) => projects.get(id) || null } };
const req = (userId, members = []) => ({ user: userId ? { id: userId } : null, memberProjectIds: new Set(members) });

test('only the owner, or a project member for reading, sees an owned analysis', async () => {
  const owned = { id: 'a1', user_id: 'olive' };
  assert.strictEqual(await checkAnalysisView(owned, req('olive'), deps), owned);
  await assert.rejects(checkAnalysisView(owned, req(null), deps), (e) => e.statusCode === 404);
  await assert.rejects(checkAnalysisView(owned, req('eve'), deps), (e) => e.statusCode === 404);
  assert.strictEqual(await checkAnalysisView(owned, req('sam', ['a1']), deps), owned);

  assert.strictEqual(await checkAnalysisManage(owned, req('olive'), deps), owned);
  await assert.rejects(checkAnalysisManage(owned, req('sam', ['a1']), deps), (e) => e.statusCode === 403);
  await assert.rejects(checkAnalysisManage(owned, req('eve'), deps), (e) => e.statusCode === 404);
  await assert.rejects(checkAnalysisView(null, req('olive'), deps), (e) => e.statusCode === 404);
});

test('an analysis row made before its project was claimed follows the project owner', async () => {
  const early = { id: 'claimed', user_id: null };
  await assert.rejects(checkAnalysisView(early, req(null), deps), (e) => e.statusCode === 404);
  await assert.rejects(checkAnalysisManage(early, req('eve'), deps), (e) => e.statusCode === 404);
  assert.strictEqual(await checkAnalysisManage(early, req('olive'), deps), early);
  // With no owner anywhere, a signed-out analysis stays open by link.
  const anon = { id: 'anon', user_id: null };
  assert.strictEqual(await checkAnalysisView(anon, req(null), deps), anon);
});

test('Railway tokens never leave the server', () => {
  const out = publicAnalysis({ id: 'a1', status: 'complete', railway_access_token: 't', railway_refresh_token: 'r', railway_token_expires_at: 'x', railway_project_id: 'p' });
  assert.deepStrictEqual(out, { id: 'a1', status: 'complete', railway_project_id: 'p' });
});
