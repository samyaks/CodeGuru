const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub('../lib/db', { deployments: {}, buildEntries: {} });
stub('../lib/constants', { CLAUDE_MODEL: 'x', anthropic: {} });

const { _internal: { isPublicStory } } = require('./public-story');

test('a private repo has no public story', () => {
  assert.strictEqual(isPublicStory({ repo_private: true }), false);
  assert.strictEqual(isPublicStory({ repo_private: false, github_installation_id: 7 }), true);
  assert.strictEqual(isPublicStory({ repo_private: false }), true);
});

test('a project scanned before repo_private existed is hidden if it reads through the App', () => {
  assert.strictEqual(isPublicStory({ repo_private: null, github_installation_id: 7 }), false);
  assert.strictEqual(isPublicStory({ repo_private: null, github_installation_id: null }), true);
  assert.strictEqual(isPublicStory(null), false);
});
