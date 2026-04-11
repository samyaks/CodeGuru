import { handleApiResponse } from '../lib/api-error';

const API_BASE = '/api';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

// Analysis
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

// Fix prompts
export interface FixPromptFull {
  short_id: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  issue_category: string;
  issue_title: string;
  issue_description: string;
  severity: string;
  code_snippet: string;
  reference_file_path: string | null;
  reference_snippet: string | null;
  related_files: { path: string; reason: string }[];
  full_prompt: string;
  created_at: string;
  expires_at: string;
}

export async function fetchFixPrompt(shortId: string): Promise<FixPromptFull> {
  const res = await authFetch(`${API_BASE}/fix/${shortId}`);
  if (!res.ok) throw new Error('Fix prompt not found');
  return res.json();
}

export async function postFixEvent(
  shortId: string,
  eventType: string,
  deeplinkTarget?: string,
) {
  await authFetch(`${API_BASE}/fix/${shortId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: eventType, deeplink_target: deeplinkTarget }),
  });
}

// GitHub
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

export async function fetchMyRepos(page = 1): Promise<{ repos: GitHubRepo[]; total: number; needsRelogin?: boolean }> {
  const res = await authFetch(`${API_BASE}/github/my-repos?page=${page}&per_page=100`);
  if (res.status === 401) return { repos: [], total: 0, needsRelogin: true };
  if (!res.ok) return { repos: [], total: 0 };
  return res.json();
}

// Takeoff types

export interface ReadinessCategory {
  score: number;
  weight: number;
  earned: number;
  status: 'ready' | 'partial' | 'missing';
  label: string;
  detail: string;
}

export interface EnvVarDef {
  name: string;
  hasDefault: boolean;
  value: string | null;
}

export interface BuildPlan {
  type: string;
  framework: string;
  confidence: string;
  reason?: string;
  buildCommand?: string | null;
  startCommand?: string | null;
  envVarsRequired?: EnvVarDef[];
}

export interface StackInfo {
  framework: string | null;
  runtime: string | null;
  styling: string | null;
  database: string | null;
  auth: string | null;
  languages: string[];
}

export interface PlanStep {
  id: string;
  stepNumber: number;
  title: string;
  category: string;
  effort: 'small' | 'medium' | 'large';
  why: string;
  contextFile: string | null;
  cursorPrompt: string | null;
  status: 'todo' | 'done';
  isDeploy?: boolean;
}

export interface GapInfo {
  exists: boolean;
  provider?: string | null;
  type?: string | null;
  platform?: string | null;
  issues?: string[];
  hasSchema?: boolean;
  hasMigrations?: boolean;
  hasCI?: boolean;
  hasRoles?: boolean;
  coverage?: string;
  hasGlobalHandler?: boolean;
  hasExample?: boolean;
  missingVars?: string[];
}

export interface FeatureInfo {
  name: string;
  path: string;
  hasUI: boolean;
  hasAPI: boolean;
  hasTests: boolean;
  fileCount: number;
}

export interface AnalysisData {
  meta: {
    name: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
  };
  structure: {
    directories: string[];
    entryPoints: string[];
    routeFiles: string[];
    configFiles: string[];
  };
  features: FeatureInfo[];
  gaps: Record<string, GapInfo>;
  deployInfo: {
    detected: boolean;
    hosting: Array<{ platform: string }>;
    containers: Array<{ platform: string }>;
    cicd: Array<{ platform: string }>;
  };
  existingContext: {
    hasCursorRules: boolean;
    hasClaudeMd: boolean;
    hasContextMd: boolean;
  };
  fileTree: string[];
}

export interface Project {
  id: string;
  user_id: string | null;
  repo_url: string;
  owner: string;
  repo: string;
  branch: string;
  framework: string | null;
  description: string | null;
  deploy_type: string | null;
  stack_info: StackInfo | null;
  build_plan: BuildPlan | null;
  readiness_score: number | null;
  readiness_categories: Record<string, ReadinessCategory> | null;
  plan_steps: PlanStep[] | null;
  recommendation: 'deploy' | 'plan' | null;
  analysis_data: AnalysisData | null;
  features_summary: string | null;
  slug: string | null;
  status: string;
  live_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
}

// Takeoff
export async function startTakeoff(repoUrl: string): Promise<{ projectId: string; slug: string; status: string }> {
  const res = await authFetch(`${API_BASE}/takeoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
  return handleApiResponse<{ projectId: string; slug: string; status: string }>(res);
}

export async function fetchProject(id: string): Promise<Project> {
  const res = await authFetch(`${API_BASE}/takeoff/${id}`);
  return handleApiResponse<Project>(res);
}

export async function updatePlanStep(projectId: string, stepId: string, status: 'todo' | 'done') {
  const res = await authFetch(`${API_BASE}/takeoff/${projectId}/plan/${stepId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return handleApiResponse<{ step: PlanStep }>(res);
}

// Env vars
export async function saveEnvVars(projectId: string, vars: Record<string, string>) {
  const res = await authFetch(`${API_BASE}/takeoff/${projectId}/env-vars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vars }),
  });
  return handleApiResponse(res);
}

export async function getEnvVars(projectId: string): Promise<Record<string, string>> {
  const res = await authFetch(`${API_BASE}/takeoff/${projectId}/env-vars`);
  const data = await handleApiResponse<{ vars: Record<string, string> }>(res);
  return data.vars || {};
}

// Deploy
export async function triggerDeploy(projectId: string) {
  const res = await authFetch(`${API_BASE}/deploy/${projectId}`, { method: 'POST' });
  return handleApiResponse<{ status: string; projectId: string }>(res);
}

export async function triggerRedeploy(projectId: string) {
  const res = await authFetch(`${API_BASE}/deploy/${projectId}/redeploy`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Failed to redeploy' }));
    throw new Error(body.error || 'Failed to redeploy');
  }
  return res.json();
}

// Build Story types

export interface BuildEntry {
  id: string;
  project_id: string;
  user_id: string;
  entry_type: 'prompt' | 'note' | 'decision' | 'milestone' | 'deploy_event' | 'file';
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  is_public: number;
  created_at: string;
  updated_at: string | null;
  sort_order: number;
}

export interface ProjectWithEntries extends Project {
  entries?: BuildEntry[];
}

// Projects

export async function fetchProjects(): Promise<Project[]> {
  const res = await authFetch(`${API_BASE}/projects`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchProjectDetail(id: string): Promise<ProjectWithEntries> {
  const res = await authFetch(`${API_BASE}/projects/${id}`);
  return handleApiResponse<ProjectWithEntries>(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
  await handleApiResponse<{ deleted: boolean }>(res);
}

// Build Story

export async function fetchBuildStory(projectId: string): Promise<BuildEntry[]> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/story`);
  if (!res.ok) return [];
  return res.json();
}

export async function createBuildEntry(projectId: string, entry: {
  entry_type: BuildEntry['entry_type'];
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<BuildEntry> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/story`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  return handleApiResponse<BuildEntry>(res);
}

export async function updateBuildEntry(projectId: string, entryId: string, fields: {
  title?: string;
  content?: string;
  entry_type?: BuildEntry['entry_type'];
  is_public?: number;
}): Promise<BuildEntry> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/story/${entryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return handleApiResponse<BuildEntry>(res);
}

export async function deleteBuildEntry(projectId: string, entryId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/story/${entryId}`, { method: 'DELETE' });
  await handleApiResponse<{ deleted: boolean }>(res);
}

export async function generateContextFromStory(projectId: string): Promise<{ contextFile: string }> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/story/generate-context`, { method: 'POST' });
  return handleApiResponse<{ contextFile: string }>(res);
}

// Commits (live from GitHub, not stored)

export async function fetchProjectCommits(projectId: string) {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/commits`);
  if (!res.ok) return { commits: [], reason: 'fetch_failed' };
  return res.json();
}

export async function fetchCommitDetail(projectId: string, sha: string) {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/commits/${sha}`);
  if (!res.ok) throw new Error('Failed to load commit detail');
  return res.json();
}

// Public story (no auth)

export type PublicBuildEntry = Omit<BuildEntry, 'user_id' | 'metadata'>;

export interface PublicStoryData {
  project: {
    owner: string;
    repo: string;
    framework: string | null;
    description: string | null;
    readiness_score: number | null;
    live_url: string | null;
    status: string;
    slug: string;
  };
  entries: PublicBuildEntry[];
  social_summary: string | null;
}

export async function fetchPublicStory(slug: string): Promise<PublicStoryData> {
  const res = await fetch(`${API_BASE}/story/${slug}`);
  return handleApiResponse<PublicStoryData>(res);
}

export async function generateSocialSummary(slug: string): Promise<{ summary: string }> {
  const res = await fetch(`${API_BASE}/story/${slug}/summary`);
  return handleApiResponse<{ summary: string }>(res);
}
