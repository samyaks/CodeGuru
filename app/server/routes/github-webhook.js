const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { deployments, commitReviews } = require('../lib/db');
const { runCommitReviewJobSafe } = require('../services/commit-review-runner');

const router = express.Router();

const ZERO_SHA = '0000000000000000000000000000000000000000';

function verifyGitHubSignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[github-webhook] GITHUB_WEBHOOK_SECRET is required in production');
      return false;
    }
    console.warn('[github-webhook] GITHUB_WEBHOOK_SECRET not set — allowing unsigned webhooks (development only)');
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const theirHex = signatureHeader.slice('sha256='.length);
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    const a = Buffer.from(theirHex, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function enqueueCommitReviewForProject({
  projectId,
  projectBranch,
  deliveryId,
  owner,
  repo,
  after,
  before,
  ref,
  headTitle,
  headBody,
  pusher,
}) {
  const pushedBranch = ref ? ref.replace('refs/heads/', '') : null;
  const trackedBranch = projectBranch || 'main';
  if (pushedBranch && pushedBranch !== trackedBranch) {
    console.log(JSON.stringify({
      event: 'webhook_push_branch_skipped',
      projectId,
      pushedBranch,
      trackedBranch,
      deliveryId,
    }));
    return;
  }

  const existing = await commitReviews.findByProjectAndSha(projectId, after);
  if (existing) {
    if (existing.status === 'completed') return;
    if (existing.status === 'pending' || existing.status === 'in_progress') return;
    await commitReviews.resetToPending(existing.id);
    setImmediate(() => {
      runCommitReviewJobSafe({
        commitReviewId: existing.id,
        projectId,
        owner,
        repo,
        afterSha: after,
        beforeSha: before,
        ref,
        headCommitTitle: headTitle,
        headCommitBody: headBody,
      });
    });
    return;
  }

  const id = uuidv4();
  const inserted = await commitReviews.create({
    id,
    project_id: projectId,
    commit_sha: after,
    before_sha: before,
    ref,
    pusher_login: pusher,
    status: 'pending',
  });

  if (!inserted) return; // duplicate — already being handled

  console.log(JSON.stringify({ event: 'commit_review_enqueued', projectId, commitSha: after, deliveryId }));

  setImmediate(() => {
    runCommitReviewJobSafe({
      commitReviewId: id,
      projectId,
      owner,
      repo,
      afterSha: after,
      beforeSha: before,
      ref,
      headCommitTitle: headTitle,
      headCommitBody: headBody,
    });
  });
}

router.post('/', async (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const raw = req.body;
  if (!Buffer.isBuffer(raw)) {
    return res.status(400).json({ error: 'Expected raw body' });
  }

  const sig = req.get('X-Hub-Signature-256') || '';
  if (!verifyGitHubSignature(raw, sig, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const event = req.get('X-GitHub-Event') || '';
  const deliveryId = req.get('X-GitHub-Delivery') || null;
  if (event !== 'push') {
    return res.status(200).json({ ok: true, ignored: event });
  }

  if (!payload.repository?.full_name || !payload.after) {
    return res.status(200).json({ ok: true, skipped: 'incomplete_payload' });
  }

  if (payload.after === ZERO_SHA) {
    return res.status(200).json({ ok: true, skipped: 'branch_deleted' });
  }

  const [owner, repo] = payload.repository.full_name.split('/');
  const after = payload.after;
  const before = payload.before;
  const ref = payload.ref;
  const headCommit = payload.head_commit;
  const headTitle = headCommit?.message?.split('\n')[0]?.trim() || '';
  const headBody = headCommit?.message || '';
  const pusher = payload.pusher?.name || payload.pusher?.login || null;

  res.status(202).json({ ok: true, accepted: true });

  try {
    const projects = await deployments.findByGithubRepo(owner, repo);
    if (!projects.length) {
      console.log(JSON.stringify({ event: 'webhook_push_no_project', owner, repo, after, deliveryId }));
      return;
    }
    console.log(JSON.stringify({ event: 'webhook_push_received', owner, repo, after, ref, deliveryId, projectCount: projects.length }));
    for (const project of projects) {
      try {
        await enqueueCommitReviewForProject({
          projectId: project.id,
          projectBranch: project.branch,
          deliveryId,
          owner,
          repo,
          after,
          before,
          ref,
          headTitle,
          headBody,
          pusher,
        });
      } catch (err) {
        console.error(`enqueueCommitReviewForProject ${project.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('github webhook push handling:', err.message);
  }
});

module.exports = router;
module.exports.recoverStaleCommitReviews = recoverStaleCommitReviews;

async function recoverStaleCommitReviews() {
  try {
    const rows = await commitReviews.resetStaleInProgress();
    console.log(JSON.stringify({ event: 'stale_recovery', count: rows.length }));
    for (const row of rows) {
      setImmediate(() => {
        runCommitReviewJobSafe({
          commitReviewId: row.id,
          projectId: row.project_id,
          owner: row.owner,
          repo: row.repo,
          afterSha: row.commit_sha,
          beforeSha: row.before_sha,
          ref: row.ref,
        });
      });
    }
  } catch (err) {
    console.error('[github-webhook] recoverStaleCommitReviews failed:', err.message);
  }
}
