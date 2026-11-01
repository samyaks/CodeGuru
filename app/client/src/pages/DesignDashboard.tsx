import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DashboardProject } from '../services/api';
import { DashboardView, type Analysis, type DashboardTab, type Review } from './Dashboard';

// Dev-only preview of the dashboard with made-up projects, since the real
// one needs a signed-in API. Mounted at /design/dashboard only when
// import.meta.env.DEV. ?state=projects|empty|error|loading|legacy.

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const SAMPLE_PROJECTS: DashboardProject[] = [
  {
    id: 'sample-bakery',
    repo_url: 'https://github.com/sample/bakery-orders',
    owner: 'sample',
    repo: 'bakery-orders',
    status: 'ready',
    readiness_score: 72,
    recommendation: 'plan',
    framework: 'Next.js',
    live_url: null,
    deployed_at: null,
    created_at: ago(30),
    updated_at: ago(3),
    description: null,
    app_summary:
      'lets a small bakery take pre-orders online, see what to bake each morning, and send customers a pickup reminder',
    audience: 'a bakery owner who takes orders by phone and on paper today',
    persona: null,
    personas: [
      { id: 'p1', name: 'Bakery owner', emoji: null, description: null, readiness: 82 },
      { id: 'p2', name: 'Regular customer', emoji: null, description: null, readiness: 64 },
    ],
    missing: {
      next: { title: 'Customers can order, but nobody tells them when it is ready.', why: null },
      items: [
        { id: 'g1', title: 'No pickup reminder is sent after an order', category: 'missing' },
        { id: 'g2', title: 'Anyone can open another customer’s order page', category: 'broken' },
        { id: 'g3', title: 'Set up email sending', category: 'infra' },
      ],
      count: 7,
    },
    last_commit: {
      sha: '0000000000000000000000000000000000000001',
      shortSha: '0000001',
      title: 'Add the morning bake list',
      date: ago(1),
      author: null,
      source: 'github',
    },
  },
  {
    id: 'sample-clinic',
    repo_url: 'https://github.com/sample/clinic-booking',
    owner: 'sample',
    repo: 'clinic-booking',
    status: 'live',
    readiness_score: 91,
    recommendation: 'deploy',
    framework: 'Express',
    live_url: 'https://clinic.example.com',
    deployed_at: ago(10),
    created_at: ago(60),
    updated_at: ago(5),
    description: null,
    app_summary: 'lets patients book, move and cancel appointments at a small physio clinic',
    audience: 'a clinic receptionist juggling a paper diary',
    persona: null,
    personas: [{ id: 'p3', name: 'Receptionist', emoji: null, description: null, readiness: 95 }],
    missing: { next: null, items: [], count: 0 },
    last_commit: null,
  },
  {
    id: 'sample-tutor',
    repo_url: 'https://github.com/sample/tutor-notes-and-homework-tracker',
    owner: 'sample',
    repo: 'tutor-notes-and-homework-tracker',
    status: 'analyzing',
    readiness_score: null,
    recommendation: null,
    framework: null,
    live_url: null,
    deployed_at: null,
    created_at: ago(0),
    updated_at: null,
    description: null,
    app_summary: null,
    audience: null,
    persona: null,
    personas: [],
    missing: { next: null, items: [], count: 0 },
    last_commit: null,
  },
  {
    id: 'sample-garden',
    repo_url: 'local://garden-planner',
    owner: 'local',
    repo: 'garden-planner',
    status: 'failed',
    readiness_score: null,
    recommendation: null,
    framework: 'React',
    live_url: null,
    deployed_at: null,
    created_at: ago(12),
    updated_at: ago(12),
    description: null,
    error: 'We couldn’t read this repo. It may be private or empty.',
    app_summary: null,
    audience: null,
    persona: null,
    personas: [],
    missing: { next: null, items: [], count: 0 },
    last_commit: null,
  },
];

const SAMPLE_ANALYSES: Analysis[] = [
  { id: 'a1', repo_url: '', owner: 'sample', repo: 'bakery-orders', status: 'completed', completion_pct: 72, created_at: ago(3) },
];

const SAMPLE_REVIEWS: Review[] = [
  { id: 'r1', type: 'security', repo_url: '', owner: 'sample', repo: 'clinic-booking', pr_number: 12, status: 'completed', created_at: ago(5) },
];

export default function DesignDashboard() {
  const [searchParams] = useSearchParams();
  const state = searchParams.get('state') ?? 'projects';
  const [tab, setTab] = useState<DashboardTab>('projects');
  const legacyMode = state === 'legacy';

  return (
    <DashboardView
      loading={state === 'loading'}
      legacyMode={legacyMode}
      activeTab={legacyMode ? tab : 'projects'}
      onTabChange={setTab}
      onRetry={() => {}}
      projects={state === 'empty' || state === 'error' ? [] : SAMPLE_PROJECTS}
      analyses={SAMPLE_ANALYSES}
      reviews={SAMPLE_REVIEWS}
      projectsError={state === 'error' ? 'The server didn’t answer.' : null}
      analysesError={null}
      reviewsError={null}
    />
  );
}
