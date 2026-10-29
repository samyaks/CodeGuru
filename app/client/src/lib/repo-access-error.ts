/**
 * Classify GitHub repo fetch failures so the paste-URL / confirm UI can
 * explain what's visible (public via paste) vs what needs Connect GitHub
 * or a folder upload.
 */
export type RepoAccessErrorKind = 'private_or_missing' | 'rate_limit' | 'invalid_url' | 'other';

export function classifyRepoAccessError(message: string | null | undefined): RepoAccessErrorKind | null {
  if (!message) return null;
  const m = message.toLowerCase();

  if (
    m.includes('could not parse owner/repo')
    || m.includes('valid github repository url')
    || m.includes('provide a valid url')
    || m.includes('invalid github url')
  ) {
    return 'invalid_url';
  }

  if (m.includes('rate limit')) {
    return 'rate_limit';
  }

  if (
    m.includes('not found')
    || m.includes('private')
    || m.includes('could not read the repository')
  ) {
    return 'private_or_missing';
  }

  return 'other';
}

export function repoAccessErrorCopy(kind: RepoAccessErrorKind): {
  title: string;
  body: string;
} {
  switch (kind) {
    case 'private_or_missing':
      return {
        title: 'This repo isn’t reachable via a pasted URL',
        body:
          'Paste only works for public GitHub repositories. Private repos (and anything the server can’t see) look like “not found.” Connect GitHub to pick from your repos, or upload a folder.',
      };
    case 'rate_limit':
      return {
        title: 'GitHub rate limit hit',
        body:
          'Too many anonymous GitHub requests. Connect GitHub or try again in a few minutes.',
      };
    case 'invalid_url':
      return {
        title: 'That doesn’t look like a GitHub repo URL',
        body: 'Use https://github.com/owner/repo — no tree/blob paths or other hosts.',
      };
    default:
      return {
        title: 'Couldn’t read that repository',
        body: 'Check the URL and try again, or connect GitHub / upload a folder instead.',
      };
  }
}
