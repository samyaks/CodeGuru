const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { deployments, commitReviews, webhookEvents, githubRepoAccess, processedPushes } = require('../lib/db');
const { runCommitReviewJobSafe } = require('../services/commit-review-runner');
const { processPush: processPushV2 } = require('../services/v2/shipped-runner');

// Two senders share this endpoint:
//   - per-repo hooks (services/github-webhook-manager.js), signed with
//     GITHUB_WEBHOOK_SECRET
//   - the Takeoff GitHub App, for every repo it's installed on, signed with
//     GITHUB_APP_WEBHOOK_SECRET
// Separate secrets rotate independently, and let us trust `installation.id`
// only when the App signed the delivery. Push payloads are otherwise the same.

const ZERO_SHA = '0000000000000000000000000000000000000000';
const INSTALLATION_EVENTS = new Set(['installation', 'installation_repositories']);

function defaultDeps() {
  return {
    deployments,
    commitReviews,
    webhookEvents,
    githubRepoAccess,
    processedPushes,
    runCommitReviewJobSafe,
    processPushV2,
    secrets: () => ({
      appSecret: process.env.GITHUB_APP_WEBHOOK_SECRET || null,
      repoHookSecret: process.env.GITHUB_WEBHOOK_SECRET || null,
    }),
  };
}

function signatureMatches(rawBody, signatureHeader, secret) {
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

/** 'app' | 'repo_hook' | 'unsigned' (dev, no secrets set) | null (reject). */
function identifySender(rawBody, signatureHeader, { appSecret, repoHookSecret }) {
  if (!appSecret && !repoHookSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[github-webhook] GITHUB_WEBHOOK_SECRET or GITHUB_APP_WEBHOOK_SECRET is required in production');
      return null;
    }
    console.warn('[github-webhook] no webhook secret set — allowing unsigned webhooks (development only)');
    return 'unsigned';
  }
  if (appSecret && signatureMatches(rawBody, signatureHeader, appSecret)) return 'app';
  if (repoHookSecret && signatureMatches(rawBody, signatureHeader, repoHookSecret)) return 'repo_hook';
  return null;
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
}, deps) {
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

  const existing = await deps.commitReviews.findByProjectAndSha(projectId, after);
  if (existing) {
    if (existing.status === 'completed') return;
    if (existing.status === 'pending' || existing.status === 'in_progress') return;
    await deps.commitReviews.resetToPending(existing.id);
    setImmediate(() => {
      deps.runCommitReviewJobSafe({
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
  const inserted = await deps.commitReviews.create({
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
    deps.runCommitReviewJobSafe({
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

// An App push names the installation covering the repo. Point the project at
// it (new project, or a reinstall changed the id) only when the project's
// owner granted this repo through that installation, so background reads
// never use access the owner doesn't have.
async function recordInstallation(project, { owner, repo, installationId, deliveryId }, deps) {
  if (Number(project.github_installation_id) === installationId) return;
  const grant = project.user_id
    ? await deps.githubRepoAccess.findForUserRepo(project.user_id, owner, repo)
    : null;
  if (!grant || Number(grant.installation_id) !== installationId) {
    console.log(JSON.stringify({
      event: 'webhook_installation_not_recorded',
      projectId: project.id,
      installationId,
      reason: project.user_id ? 'no_matching_grant' : 'no_project_owner',
      deliveryId,
    }));
    return;
  }
  await deps.deployments.update(project.id, { github_installation_id: installationId });
  console.log(JSON.stringify({
    event: 'project_installation_recorded',
    projectId: project.id,
    from: project.github_installation_id ?? null,
    to: installationId,
    deliveryId,
  }));
  project.github_installation_id = installationId;
}

async function handlePush({ payload, deliveryId, source, installationId }, deps) {
  const [owner, repo] = payload.repository.full_name.split('/');
  const after = payload.after;
  const before = payload.before;
  const ref = payload.ref;
  const headCommit = payload.head_commit;
  const headTitle = headCommit?.message?.split('\n')[0]?.trim() || '';
  const headBody = headCommit?.message || '';
  const pusher = payload.pusher?.name || payload.pusher?.login || null;
  const archiveSource = source === 'app' ? 'github_app' : 'github';

  const projects = await deps.deployments.findByGithubRepo(owner, repo);
  if (!projects.length) {
    console.log(JSON.stringify({ event: 'webhook_push_no_project', owner, repo, after, deliveryId, source }));
    // Archive per-repo hook deliveries even with no project — useful for
    // debugging missing connections. The App delivers for every repo it's
    // installed on, scanned or not, so those aren't worth keeping.
    if (source !== 'app') {
      await deps.webhookEvents.create({
        delivery_id: deliveryId,
        event_type: 'push',
        source: archiveSource,
        project_id: null,
        payload,
        signature_ok: true,
      }).catch((err) => console.error('webhook_events archive failed:', err.message));
    }
    return;
  }
  console.log(JSON.stringify({ event: 'webhook_push_received', owner, repo, after, ref, deliveryId, source, projectCount: projects.length }));
  for (const project of projects) {
    // Archive the raw payload per project for replay/debugging
    deps.webhookEvents.create({
      delivery_id: deliveryId,
      event_type: 'push',
      source: archiveSource,
      project_id: project.id,
      payload,
      signature_ok: true,
    }).catch((err) => console.error('webhook_events archive failed:', err.message));

    if (installationId) {
      try {
        await recordInstallation(project, { owner, repo, installationId, deliveryId }, deps);
      } catch (err) {
        console.error(`recordInstallation ${project.id}:`, err.message);
      }
    }

    // Already idempotent per (project, sha) via the commit_reviews unique
    // index; a later delivery retries a review that failed.
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
      }, deps);
    } catch (err) {
      console.error(`enqueueCommitReviewForProject ${project.id}:`, err.message);
    }

    // The matcher/verifier and auto re-analyze have no per-sha guard of their
    // own until the verifier finishes, so the first delivery of this push
    // claims them. If the claim can't be written (e.g. migration 026 not
    // applied), process anyway, as before the claim existed.
    let firstDelivery = true;
    try {
      firstDelivery = await deps.processedPushes.claim({
        projectId: project.id, ref: ref || '', before: before || '', after, deliveryId, source,
      });
    } catch (err) {
      console.error(`processedPushes.claim ${project.id} failed, processing anyway:`, err.message);
    }
    if (!firstDelivery) {
      console.log(JSON.stringify({ event: 'webhook_push_duplicate', projectId: project.id, ref, after, deliveryId, source }));
      continue;
    }

    // v2: kick off matcher + verifier in the background — never block v1.
    setImmediate(() => {
      deps.processPushV2({ project, payload }).catch((err) => {
        console.error(`[v2/shipped] processPush failed for project ${project.id}:`, err.message);
      });
    });
  }
}

// Logged and archived only, for now; uninstall/suspend handling builds on these.
async function handleInstallationEvent({ event, payload, deliveryId, source }, deps) {
  const names = (list) => (Array.isArray(list) ? list.map((r) => r.full_name).filter(Boolean) : []);
  const repos = names(payload.repositories);
  const added = names(payload.repositories_added);
  const removed = names(payload.repositories_removed);
  console.log(JSON.stringify({
    event: 'github_app_installation_event',
    githubEvent: event,
    action: payload.action || null,
    installationId: payload.installation?.id ?? null,
    account: payload.installation?.account?.login || null,
    repos: repos.slice(0, 20),
    reposAdded: added.slice(0, 20),
    reposRemoved: removed.slice(0, 20),
    counts: { repos: repos.length, added: added.length, removed: removed.length },
    deliveryId,
    source,
  }));
  await deps.webhookEvents.create({
    delivery_id: deliveryId,
    event_type: event,
    source: source === 'app' ? 'github_app' : 'github',
    project_id: null,
    payload,
    signature_ok: true,
  }).catch((err) => console.error('webhook_events archive failed:', err.message));
}

/** POST handler; resolves once the delivery has been processed (after responding). */
function createWebhookHandler(deps = defaultDeps()) {
  return async function handleWebhook(req, res) {
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      return res.status(400).json({ error: 'Expected raw body' });
    }

    const sender = identifySender(raw, req.get('X-Hub-Signature-256') || '', deps.secrets());
    if (!sender) {
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
    // Per-repo hook payloads carry no `installation`; one that does but was
    // signed with the per-repo secret is treated as a per-repo delivery.
    const source = sender === 'repo_hook' || !payload.installation ? 'repo_hook' : 'app';
    const installationId = source === 'app' && payload.installation?.id ? Number(payload.installation.id) : null;

    if (INSTALLATION_EVENTS.has(event)) {
      res.status(200).json({ ok: true, logged: event });
      try {
        await handleInstallationEvent({ event, payload, deliveryId, source }, deps);
      } catch (err) {
        console.error(`github webhook ${event} handling:`, err.message);
      }
      return;
    }

    if (event !== 'push') {
      return res.status(200).json({ ok: true, ignored: event });
    }

    if (!payload.repository?.full_name || !payload.after) {
      return res.status(200).json({ ok: true, skipped: 'incomplete_payload' });
    }

    if (payload.after === ZERO_SHA) {
      return res.status(200).json({ ok: true, skipped: 'branch_deleted' });
    }

    res.status(202).json({ ok: true, accepted: true });

    try {
      await handlePush({ payload, deliveryId, source, installationId }, deps);
    } catch (err) {
      console.error('github webhook push handling:', err.message);
    }
  };
}

const router = express.Router();
router.post('/', createWebhookHandler());

module.exports = router;
module.exports.recoverStaleCommitReviews = recoverStaleCommitReviews;
module.exports.createWebhookHandler = createWebhookHandler;

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
