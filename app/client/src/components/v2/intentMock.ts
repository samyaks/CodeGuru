import type { IntentListResponse } from '../../services/intentApi';

// Dev-only fixture for the Takeoff intent substrate UI.
//
// The Phase 4 backend endpoints (GET /intent, confirm/reject/edit/restore,
// /intent/spec) are not implemented yet — they return HTTP 501. Until they
// land, `IntentSection` falls back to this fixture (in dev builds only) so the
// review flow is demoable end-to-end. The shapes mirror `intentApi.ts` exactly;
// keep them in sync if the contract changes.
//
// Notes on the fixture's shape:
//   - `satisfied` is null everywhere (Phase 6 populates it) so the satisfaction
//     badge stays hidden.
//   - `links[].linkStatus` is mostly 'healthy'; one 'needs_relink' and one
//     'broken' link exist so the (optional) link-health decoration is visible
//     during development without pretending Phase 5 has run.

const now = '2026-06-28T18:04:00.000Z';

export const INTENT_MOCK: IntentListResponse = {
  total: 9,
  confirmed: 2,
  candidates: 6,
  rejected: 1,
  areas: [
    {
      featureArea: 'Authentication',
      candidateCount: 2,
      confirmedCount: 1,
      rejectedCount: 0,
      statements: [
        {
          id: 'stmt-auth-1',
          text: 'Users sign in with a Supabase magic link; there is no password field anywhere in the app.',
          kind: 'behavior',
          status: 'candidate',
          source: 'inferred',
          featureArea: 'Authentication',
          links: [
            { filePath: 'packages/auth/src/client.ts', symbol: 'signInWithOtp', linkStatus: 'healthy' },
            { filePath: 'app/client/src/pages/Login.tsx', symbol: 'LoginPage', linkStatus: 'healthy' },
          ],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: null,
        },
        {
          id: 'stmt-auth-2',
          text: 'Session cookies are httpOnly and scoped to the API origin; the client never reads the raw token.',
          kind: 'constraint',
          status: 'candidate',
          source: 'inferred',
          featureArea: 'Authentication',
          links: [
            { filePath: 'app/server/lib/session.js', symbol: 'issueSession', linkStatus: 'needs_relink', suggestedSymbol: 'createSession' },
          ],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: null,
        },
        {
          id: 'stmt-auth-3',
          text: 'Authenticated routes reject requests without a valid session with a 401 and a JSON error body.',
          kind: 'behavior',
          status: 'confirmed',
          source: 'human',
          featureArea: 'Authentication',
          links: [
            { filePath: 'app/server/middleware/requireAuth.js', symbol: 'requireAuth', linkStatus: 'healthy' },
          ],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    {
      featureArea: 'Repository Analysis',
      candidateCount: 3,
      confirmedCount: 0,
      rejectedCount: 0,
      statements: [
        {
          id: 'stmt-analysis-1',
          text: 'The analyzer reads at most ~30 key files per repo via the GitHub API and never clones the repository.',
          kind: 'constraint',
          status: 'candidate',
          source: 'inferred',
          featureArea: 'Repository Analysis',
          links: [
            { filePath: 'app/server/services/analyzer.js', symbol: 'selectKeyFiles', linkStatus: 'healthy' },
            { filePath: 'packages/github/src/index.ts', symbol: 'getFileContent', linkStatus: 'healthy' },
          ],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: null,
        },
        {
          id: 'stmt-analysis-2',
          text: 'Analysis streams progress to the client over SSE so the UI can show per-stage status live.',
          kind: 'behavior',
          status: 'candidate',
          source: 'inferred',
          featureArea: 'Repository Analysis',
          links: [
            { filePath: 'packages/sse/src/index.ts', symbol: 'createSseStream', linkStatus: 'healthy' },
            { filePath: 'app/server/routes/takeoff.js', symbol: null, linkStatus: 'broken' },
          ],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: null,
        },
        {
          id: 'stmt-analysis-3',
          text: 'We never fabricate analysis — every claim in a .context.md file is grounded in a real file we read.',
          kind: 'constraint',
          status: 'candidate',
          source: 'inferred',
          featureArea: 'Repository Analysis',
          links: [
            { filePath: 'app/server/services/context-generator.js', symbol: 'generateContext', linkStatus: 'healthy' },
          ],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: null,
        },
      ],
    },
    {
      featureArea: 'Chrome Extension',
      candidateCount: 1,
      confirmedCount: 1,
      rejectedCount: 1,
      statements: [
        {
          id: 'stmt-ext-1',
          text: 'The Chrome extension is explicitly out of scope for the current milestone.',
          kind: 'non_goal',
          status: 'confirmed',
          source: 'human',
          featureArea: 'Chrome Extension',
          links: [],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'stmt-ext-2',
          text: 'A future extension would inject .context.md into the editor, but no code for it ships yet.',
          kind: 'non_goal',
          status: 'candidate',
          source: 'inferred',
          featureArea: 'Chrome Extension',
          links: [],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: null,
        },
        {
          id: 'stmt-ext-3',
          text: 'The extension should auto-open on every GitHub page load.',
          kind: 'behavior',
          status: 'rejected',
          source: 'inferred',
          featureArea: 'Chrome Extension',
          links: [],
          satisfied: null,
          lastCheckedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  ],
};

export default INTENT_MOCK;
