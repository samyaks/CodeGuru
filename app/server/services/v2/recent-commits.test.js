const {
  pickSummary,
  commitBodySummary,
} = require('./recent-commits');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testPickSummaryPrefersBuildEntry() {
  const result = pickSummary({
    entry: { content: 'We added login so guests can save work.', title: 'Login shipping', approval_status: 'approved' },
    reviewSummary: 'AI said something else',
    shippedDetail: 'Gap closed',
    message: 'feat: auth\n\nLong body',
    title: 'feat: auth',
  });
  assert(result.summarySource === 'build_story', `expected build_story, got ${result.summarySource}`);
  assert(result.summary.includes('login'), 'summary should use build entry content');
  assert(result.summaryTitle === 'Login shipping', 'should surface build entry title');
}

function testPickSummaryFallsBackToReview() {
  const result = pickSummary({
    entry: null,
    reviewSummary: 'Hardened the webhook signature check.',
    shippedDetail: null,
    message: 'fix: webhook',
    title: 'fix: webhook',
  });
  assert(result.summarySource === 'ai_review', `expected ai_review, got ${result.summarySource}`);
  assert(result.summary.includes('webhook'), 'summary should use AI review');
}

function testPickSummarySkipsDismissedEntry() {
  const result = pickSummary({
    entry: {
      content: 'Dismissed draft that should not show.',
      title: 'Nope',
      approval_status: 'dismissed',
    },
    reviewSummary: 'Use the review instead.',
    shippedDetail: null,
    message: 'fix: x',
    title: 'fix: x',
  });
  assert(result.summarySource === 'ai_review', `expected ai_review, got ${result.summarySource}`);
  assert(result.summary.includes('review'), 'dismissed drafts must be skipped');
}

function testPickSummaryFallsBackToBodyThenTitle() {
  const withBody = pickSummary({
    entry: null,
    reviewSummary: null,
    shippedDetail: null,
    message: 'feat: map\n\nDraws personas on the canvas.',
    title: 'feat: map',
  });
  assert(withBody.summarySource === 'commit_body', `expected commit_body, got ${withBody.summarySource}`);
  assert(withBody.summary.includes('personas'), 'should use commit body');

  const titleOnly = pickSummary({
    entry: null,
    reviewSummary: null,
    shippedDetail: null,
    message: 'chore: bump deps',
    title: 'chore: bump deps',
  });
  assert(titleOnly.summarySource === 'commit_title', `expected commit_title, got ${titleOnly.summarySource}`);
  assert(titleOnly.summary === 'chore: bump deps', 'title-only commits use the title as summary');
}

function testCommitBodySummary() {
  assert(commitBodySummary('one line') === null, 'single-line message has no body');
  assert(
    commitBodySummary('title\n\nBody text here') === 'Body text here',
    'should extract body after blank line',
  );
}

function run() {
  testPickSummaryPrefersBuildEntry();
  testPickSummaryFallsBackToReview();
  testPickSummarySkipsDismissedEntry();
  testPickSummaryFallsBackToBodyThenTitle();
  testCommitBodySummary();
  console.log('recent-commits.test.js: ok');
}

run();
