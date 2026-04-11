const API_BASE = '/api';

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Authentication required');
  }
  return res;
}

export interface Review {
  id: string;
  type: 'pr' | 'repo';
  repo_url: string;
  owner: string;
  repo: string;
  pr_number: number | null;
  branch: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  ai_report: string | null;
  human_notes: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  files?: ReviewFile[];
}

export interface ReviewFile {
  id: string;
  review_id: string;
  file_path: string;
  diff: string | null;
  ai_comments: string | null;
  human_comments: string | null;
  severity: 'critical' | 'warning' | 'info' | 'ok' | null;
}

export interface Finding {
  file: string;
  line: number | null;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
}

export interface DeploymentInfo {
  status: 'deployed' | 'partial' | 'no_config_found' | 'not_applicable';
  summary: string;
  platforms: string[];
  cicd: string;
  containerized: boolean;
  iac: string;
  concerns: string[];
  suggestions: string[];
}

export interface AIReport {
  summary: string;
  verdict?: string;
  overallHealth?: string;
  strengths?: string[];
  findings: Finding[];
  filesummaries: { file: string; severity: string; comment: string }[];
  recommendations?: { immediate: string[]; shortTerm: string[]; longTerm: string[] };
  stats: { totalFindings: number; critical: number; warnings: number; info: number };
  deployment?: DeploymentInfo;
}

export async function createReview(params: {
  repoUrl: string;
  prNumber?: number;
  type: 'pr' | 'repo';
  branch?: string;
}): Promise<{ reviewId: string }> {
  const res = await authFetch(`${API_BASE}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create review');
  }
  return res.json();
}

export async function fetchReviews(): Promise<Review[]> {
  const res = await authFetch(`${API_BASE}/reviews`);
  if (!res.ok) throw new Error('Failed to fetch reviews');
  return res.json();
}

export async function fetchReview(id: string): Promise<Review> {
  const res = await authFetch(`${API_BASE}/reviews/${id}`);
  if (!res.ok) throw new Error('Review not found');
  return res.json();
}

export async function updateHumanNotes(id: string, notes: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ human_notes: notes }),
  });
  if (!res.ok) throw new Error('Failed to update notes');
}

export async function updateFileComments(reviewId: string, fileId: string, comments: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/reviews/${reviewId}/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ human_comments: comments }),
  });
  if (!res.ok) throw new Error('Failed to update file comments');
}

export function parseReport(raw: string | null): AIReport | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ========== GitHub Browsing ========== */

export interface GitHubRepo {
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
  html_url: string;
  private: boolean;
  default_branch: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: string;
  user: string;
  user_avatar: string;
  created_at: string;
  updated_at: string;
  head_branch: string;
  base_branch: string;
  additions: number;
  deletions: number;
  changed_files: number;
  html_url: string;
  draft: boolean;
}

export async function fetchGitHubRepos(params: {
  search?: string;
  username?: string;
}): Promise<{ repos: GitHubRepo[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.username) qs.set('username', params.username);
  const res = await authFetch(`${API_BASE}/github/repos?${qs}`);
  if (!res.ok) throw new Error('Failed to fetch repos');
  return res.json();
}

export async function fetchRepoPulls(
  owner: string,
  repo: string,
  state = 'open'
): Promise<{ pulls: GitHubPR[] }> {
  const res = await authFetch(
    `${API_BASE}/github/repos/${owner}/${repo}/pulls?state=${state}`
  );
  if (!res.ok) throw new Error('Failed to fetch pull requests');
  return res.json();
}

/* ========== Fix Prompts ========== */

export interface FixPromptSummary {
  id: string;
  short_id: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  issue_category: string;
  issue_title: string;
  issue_description: string;
  severity: string;
}

export interface FixPromptFull extends FixPromptSummary {
  code_snippet: string | null;
  reference_file_path: string | null;
  reference_snippet: string | null;
  related_files: { path: string; reason: string }[];
  full_prompt: string;
  created_at: string;
  expires_at: string;
}

export async function fetchFixPromptsByReview(reviewId: string): Promise<FixPromptSummary[]> {
  const res = await authFetch(`${API_BASE}/reviews/${reviewId}/fix-prompts`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchFixPrompt(shortId: string): Promise<FixPromptFull> {
  const res = await fetch(`${API_BASE}/fix/${shortId}`);
  if (!res.ok) throw new Error('Fix prompt not found or expired');
  return res.json();
}

export async function postFixEvent(
  shortId: string,
  eventType: string,
  deeplinkTarget?: string
): Promise<void> {
  await fetch(`${API_BASE}/fix/${shortId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: eventType, deeplink_target: deeplinkTarget }),
  });
}
