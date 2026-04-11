const railway = require('@codeguru/railway');

const URL_VAR_NAMES = [
  'APP_URL', 'NEXT_PUBLIC_APP_URL', 'SITE_URL', 'PUBLIC_URL',
  'BASE_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_SITE_URL',
  'VITE_APP_URL', 'VITE_BASE_URL',
];

async function syncLiveUrl(projectId, liveUrl, { railwayProjectId, railwayServiceId, railwayEnvironmentId, envVars, supabaseProjectRef }) {
  const results = [];

  if (railwayProjectId && railwayServiceId && railwayEnvironmentId) {
    const urlUpdates = {};
    for (const name of URL_VAR_NAMES) {
      if (envVars && envVars[name] !== undefined) {
        urlUpdates[name] = liveUrl;
      }
    }

    if (Object.keys(urlUpdates).length > 0) {
      try {
        await railway.setVariables(railwayProjectId, railwayServiceId, railwayEnvironmentId, urlUpdates);
        results.push({ service: 'railway_env', status: 'synced', updated: Object.keys(urlUpdates) });
      } catch (err) {
        results.push({ service: 'railway_env', status: 'failed', error: err.message });
      }
    }
  }

  if (supabaseProjectRef && process.env.SUPABASE_MANAGEMENT_KEY) {
    try {
      await updateSupabaseAuthUrls(supabaseProjectRef, liveUrl);
      results.push({ service: 'supabase_auth', status: 'synced', url: liveUrl });
    } catch (err) {
      results.push({ service: 'supabase_auth', status: 'failed', error: err.message });
    }
  }

  return results;
}

async function updateSupabaseAuthUrls(projectRef, liveUrl) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_MANAGEMENT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        site_url: liveUrl,
        redirect_urls: [`${liveUrl}/auth/callback`, `${liveUrl}/**`],
      }),
    }
  );
  if (!res.ok) throw new Error(`Supabase API ${res.status}: ${await res.text()}`);
}

module.exports = { syncLiveUrl };
