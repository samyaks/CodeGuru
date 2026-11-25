'use strict';

// Who a signed-in Takeoff user is on GitHub, if we know. Two sources, best
// first: the account they connected through the Takeoff App (stored at
// callback time), then a GitHub sign-in to Takeoff itself (Supabase's GitHub
// identity, which GitHub verified).

/** @returns {{ githubLogin: string, githubUserId: number|null, source: 'app'|'signin' }|null} */
function signinGithubIdentity(user) {
  const ids = Array.isArray(user?.identities) ? user.identities : [];
  const gh = ids.find((i) => i && i.provider === 'github');
  const login = gh?.identity_data?.user_name || gh?.identity_data?.preferred_username
    || (user?.app_metadata?.provider === 'github' ? user?.user_metadata?.user_name : null);
  if (!login || typeof login !== 'string') return null;
  const id = Number(gh?.identity_data?.provider_id || gh?.id || user?.user_metadata?.provider_id) || null;
  return { githubLogin: login, githubUserId: id, source: 'signin' };
}

async function githubIdentity(user, deps) {
  if (!user?.id) return null;
  const link = await deps.userGithubLinks.get(user.id).catch(() => null);
  if (link?.github_login) {
    return { githubLogin: String(link.github_login), githubUserId: Number(link.github_user_id) || null, source: 'app' };
  }
  return signinGithubIdentity(user);
}

/** Display name for people lists: full name, else GitHub login, else email. */
function displayName(user) {
  const m = user?.user_metadata || {};
  return (typeof m.full_name === 'string' && m.full_name.trim())
    || (typeof m.name === 'string' && m.name.trim())
    || (typeof m.user_name === 'string' && m.user_name)
    || (typeof user?.email === 'string' && user.email)
    || null;
}

module.exports = { githubIdentity, signinGithubIdentity, displayName };
