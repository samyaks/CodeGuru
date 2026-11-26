import { handleApiResponse } from '../lib/api-error';

// Project members, invites and recommendations (Takeoff Milestone 2).
// /api/projects/:id/team needs a signed-in member; /api/invites/:token is the
// invite page's API and works signed out until accepting.

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export type MemberLabel = 'creator' | 'builder';

export interface TeamMember {
  userId: string;
  name: string | null;
  email: string | null;
  labels: MemberLabel[];
  isOwner: boolean;
  joinedAt: string | null;
}

export interface TeamInvite {
  id: string;
  email: string | null;
  githubLogin: string | null;
  invitedBy: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface Recommendation {
  id: string;
  actionType: string;
  summary: string;
  /** Set for a drift decision: the PR whose review page has every change. */
  prNumber: number | null;
  status: 'pending' | 'confirming' | 'confirmed' | 'dismissed' | 'failed';
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  error: string | null;
}

export interface Team {
  you: {
    userId: string;
    isOwner: boolean;
    labels: MemberLabel[];
    githubConnected: boolean;
    githubLogin: string | null;
  };
  members: TeamMember[];
  invites: TeamInvite[];
  labels: MemberLabel[];
  recommendations: Recommendation[];
}

export interface CreatedInvite {
  invite: TeamInvite;
  /** Relative path of the invite link; the page adds its own origin. */
  path: string;
  link: string | null;
  emailSent: boolean;
  emailError: string | null;
}

const team = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/team`;

export async function fetchTeam(projectId: string): Promise<Team> {
  return handleApiResponse<Team>(await authFetch(team(projectId)));
}

export async function createInvite(projectId: string, target: string): Promise<CreatedInvite> {
  return handleApiResponse<CreatedInvite>(await authFetch(`${team(projectId)}/invites`, jsonInit('POST', { target })));
}

export async function revokeInvite(projectId: string, inviteId: string): Promise<{ revoked: boolean }> {
  return handleApiResponse(await authFetch(`${team(projectId)}/invites/${encodeURIComponent(inviteId)}`, jsonInit('DELETE')));
}

export async function setMyLabels(projectId: string, labels: MemberLabel[]): Promise<TeamMember> {
  return handleApiResponse<TeamMember>(await authFetch(`${team(projectId)}/me`, jsonInit('PATCH', { labels })));
}

export async function removeMember(projectId: string, userId: string): Promise<{ removed: boolean }> {
  return handleApiResponse(await authFetch(`${team(projectId)}/members/${encodeURIComponent(userId)}`, jsonInit('DELETE')));
}

export async function confirmRecommendation(projectId: string, id: string): Promise<{ recommendation: Recommendation }> {
  return handleApiResponse(await authFetch(`${team(projectId)}/recommendations/${encodeURIComponent(id)}/confirm`, jsonInit('POST')));
}

export async function dismissRecommendation(projectId: string, id: string): Promise<{ recommendation: Recommendation }> {
  return handleApiResponse(await authFetch(`${team(projectId)}/recommendations/${encodeURIComponent(id)}/dismiss`, jsonInit('POST')));
}

export interface InvitePreview {
  state: 'open' | 'used' | 'expired' | 'revoked';
  kind: 'email' | 'github';
  /** Masked email, or the GitHub username. */
  invitedFor: string;
  invitedByName: string | null;
  projectName: string;
  labels: MemberLabel[];
  signedIn: boolean;
  alreadyMember: boolean;
  projectId: string | null;
  matches: boolean;
  reason: string | null;
}

const invite = (token: string) => `/api/invites/${encodeURIComponent(token)}`;

export async function previewInvite(token: string): Promise<InvitePreview> {
  return handleApiResponse<InvitePreview>(await authFetch(invite(token)));
}

export async function requestInviteSignInLink(token: string): Promise<{ sent: boolean; to: string }> {
  return handleApiResponse(await authFetch(`${invite(token)}/sign-in-link`, jsonInit('POST')));
}

export async function acceptInvite(token: string, labels: MemberLabel[]): Promise<{ projectId: string; alreadyMember: boolean }> {
  return handleApiResponse(await authFetch(`${invite(token)}/accept`, jsonInit('POST', { labels })));
}
