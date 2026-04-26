const github = require('./github');
const { projectServices } = require('../lib/db');

const SERVICE_TYPE = 'github';

/**
 * Attempt to register a push webhook on the user's repo and store it in
 * project_services.  Returns { ok, needsReauth, hookId, error }.
 *
 * needsReauth=true when the token lacks admin:repo_hook scope (HTTP 403/404).
 */
async function connectWebhook({ projectId, owner, repo, userToken }) {
  const hookUrl = process.env.API_URL
    ? `${process.env.API_URL}/api/github/webhook`
    : null;

  if (!hookUrl) {
    return { ok: false, error: 'API_URL env var is not set — cannot build webhook URL' };
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, error: 'GITHUB_WEBHOOK_SECRET is not configured on this server' };
  }

  if (!userToken) {
    return { ok: false, needsReauth: true, error: 'No GitHub token — please reconnect with GitHub' };
  }

  try {
    const hook = await github.createRepoWebhook(owner, repo, userToken, hookUrl, secret);
    const existing = await projectServices.findByProjectAndType(projectId, SERVICE_TYPE);
    if (existing) {
      await projectServices.update(existing.id, {
        external_id: String(hook.id),
        config: { hook_url: hookUrl, created_at: new Date().toISOString() },
        synced_at: new Date().toISOString(),
      });
    } else {
      await projectServices.create({
        project_id: projectId,
        service_type: SERVICE_TYPE,
        external_id: String(hook.id),
        config: { hook_url: hookUrl, created_at: new Date().toISOString() },
      });
    }
    console.log(JSON.stringify({ event: 'webhook_connected', projectId, owner, repo, hookId: hook.id }));
    return { ok: true, hookId: hook.id };
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      return { ok: false, needsReauth: true, error: err.message };
    }
    if (err.status === 422) {
      // Hook already exists on GitHub — find it by URL and persist it so we record it as connected
      try {
        const hooks = await github.listRepoWebhooks(owner, repo, userToken);
        const match = hooks.find((h) => h.config?.url === hookUrl);
        if (match) {
          const existing = await projectServices.findByProjectAndType(projectId, SERVICE_TYPE);
          if (existing) {
            await projectServices.update(existing.id, {
              external_id: String(match.id),
              config: { hook_url: hookUrl, created_at: new Date().toISOString() },
              synced_at: new Date().toISOString(),
            });
          } else {
            await projectServices.create({
              project_id: projectId,
              service_type: SERVICE_TYPE,
              external_id: String(match.id),
              config: { hook_url: hookUrl, created_at: new Date().toISOString() },
            });
          }
          console.log(JSON.stringify({ event: 'webhook_reconnected', projectId, owner, repo, hookId: match.id }));
          return { ok: true, hookId: match.id };
        }
      } catch (listErr) {
        console.warn(`listRepoWebhooks fallback failed for ${owner}/${repo}:`, listErr.message);
      }
      return { ok: false, alreadyExists: true, error: 'A webhook with this URL already exists on the repo but could not be claimed' };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Remove the webhook from GitHub and delete the project_services record.
 */
async function disconnectWebhook({ projectId, owner, repo, userToken }) {
  const svc = await projectServices.findByProjectAndType(projectId, SERVICE_TYPE);
  if (svc && svc.external_id && userToken) {
    try {
      await github.deleteRepoWebhook(owner, repo, userToken, svc.external_id);
    } catch (err) {
      console.warn(`deleteRepoWebhook ${owner}/${repo} #${svc.external_id}:`, err.message);
    }
  }
  if (svc) {
    await projectServices.delete(svc.id);
  }
  console.log(JSON.stringify({ event: 'webhook_disconnected', projectId, owner, repo }));
  return { ok: true };
}

/**
 * Returns the stored webhook status for a project.
 * { connected, hookId, hookUrl }
 */
async function getWebhookStatus(projectId) {
  const svc = await projectServices.findByProjectAndType(projectId, SERVICE_TYPE);
  if (!svc || !svc.external_id) return { connected: false };
  return {
    connected: true,
    hookId: svc.external_id,
    hookUrl: svc.config?.hook_url || null,
  };
}

module.exports = { connectWebhook, disconnectWebhook, getWebhookStatus };
