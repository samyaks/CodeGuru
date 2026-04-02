const API_BASE = '/api';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

// Analysis
export async function analyzeRepo(repoUrl: string): Promise<{ projectId: string }> {
  const res = await authFetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Failed to start analysis' }));
    throw new Error(body.error || 'Failed to start analysis');
  }
  return res.json();
}

export async function fetchAnalysis(id: string) {
  const res = await authFetch(`${API_BASE}/analyze/${id}`);
  if (!res.ok) throw new Error('Analysis not found');
  return res.json();
}

export async function fetchAnalyses() {
  const res = await authFetch(`${API_BASE}/analyze`);
  if (!res.ok) return [];
  return res.json();
}

// Reviews
export async function createReview(data: {
  repoUrl: string;
  prNumber?: number;
  type?: 'pr' | 'repo';
  branch?: string;
}): Promise<{ reviewId: string }> {
  const res = await authFetch(`${API_BASE}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Failed to create review' }));
    throw new Error(body.error || 'Failed to create review');
  }
  return res.json();
}

export async function fetchReview(id: string) {
  const res = await authFetch(`${API_BASE}/reviews/${id}`);
  if (!res.ok) throw new Error('Review not found');
  return res.json();
}

export async function fetchReviews() {
  const res = await authFetch(`${API_BASE}/reviews`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchFixPrompts(reviewId: string) {
  const res = await authFetch(`${API_BASE}/reviews/${reviewId}/fix-prompts`);
  if (!res.ok) return [];
  return res.json();
}

// GitHub
export async function searchGitHubRepos(query: string) {
  const res = await authFetch(`${API_BASE}/github/repos?search=${encodeURIComponent(query)}`);
  if (!res.ok) return { repos: [], total: 0 };
  return res.json();
}

export async function fetchRepoPulls(owner: string, repo: string) {
  const res = await authFetch(`${API_BASE}/github/repos/${owner}/${repo}/pulls`);
  if (!res.ok) return { pulls: [] };
  return res.json();
}
