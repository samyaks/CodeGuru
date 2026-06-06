import type { LucideIcon } from 'lucide-react';
import {
  Lock,
  Database,
  Rocket,
  FileKey,
  FlaskConical,
  AlertTriangle,
  Users,
} from 'lucide-react';

export interface GapExplainer {
  slug: string;
  path: string;
  icon: LucideIcon;
  title: string;
  headline: string;
  headlineAccent: string;
  summary: string;
  whyItMatters: string;
  signs: string[];
  howToFix: { title: string; body: string }[];
  stacks?: { name: string; tip: string }[];
  relatedSlugs: string[];
}

export const GAP_EXPLAINERS: GapExplainer[] = [
  {
    slug: 'missing-auth',
    path: '/gaps/missing-auth',
    icon: Lock,
    title: 'Missing authentication',
    headline: 'No auth means',
    headlineAccent: 'no real users.',
    summary:
      'Authentication is how your app knows who someone is. Without it, you cannot save user-specific data, protect routes, or control permissions — no matter how polished the UI looks.',
    whyItMatters:
      'Vibe-coded apps often ship beautiful login screens that are not wired to anything. Takeoff checks for auth libraries (NextAuth, Clerk, Supabase Auth), session middleware, and protected API routes — not just UI components.',
    signs: [
      'Login/signup pages exist but no auth library in package.json',
      'API routes have no session or token checks',
      'User data is stored in localStorage instead of a backend',
      'No logout, password reset, or OAuth flow implemented',
    ],
    howToFix: [
      {
        title: 'Pick a provider that matches your stack',
        body: 'Supabase Auth if you already use Supabase. NextAuth for Next.js apps. Clerk for the fastest integration with pre-built components.',
      },
      {
        title: 'Protect API routes with middleware',
        body: 'Every route that reads or writes user data should verify a valid session before processing the request.',
      },
      {
        title: 'Add the auth flow end-to-end',
        body: 'Sign up, login, logout, and session refresh. Test with two accounts to confirm data isolation works.',
      },
    ],
    stacks: [
      { name: 'Next.js', tip: 'Use NextAuth.js or Clerk — both integrate in under an hour.' },
      { name: 'Supabase', tip: 'Enable Auth in your project and use @supabase/ssr for server-side sessions.' },
      { name: 'Express', tip: 'Passport.js or Clerk Express middleware for API protection.' },
    ],
    relatedSlugs: ['missing-database', 'missing-permissions'],
  },
  {
    slug: 'missing-database',
    path: '/gaps/missing-database',
    icon: Database,
    title: 'Missing database',
    headline: 'No database means',
    headlineAccent: 'nothing persists.',
    summary:
      'If your app needs users, settings, content, or transactions, you need persistent storage. Mock data and in-memory arrays work for demos — not production.',
    whyItMatters:
      'AI tools often generate UI with hardcoded sample data. Takeoff detects ORMs (Prisma, Drizzle), database clients, schema files, and migrations to tell you whether persistence is real or cosmetic.',
    signs: [
      'No ORM or database client in dependencies',
      'Data resets on every page refresh or deploy',
      'API routes return static JSON instead of querying a store',
      'No schema, migrations, or model files',
    ],
    howToFix: [
      {
        title: 'Choose storage based on your needs',
        body: 'PostgreSQL via Supabase or Neon for most web apps. SQLite for local-first prototypes. MongoDB if your data is document-shaped.',
      },
      {
        title: 'Add a schema and migrations',
        body: 'Define your tables/models in code (Prisma schema, Drizzle definitions) and run migrations from day one.',
      },
      {
        title: 'Wire API routes to the database',
        body: 'Replace hardcoded arrays with real queries. Add connection pooling for serverless deploys.',
      },
    ],
    stacks: [
      { name: 'Next.js + Supabase', tip: 'Create tables in Supabase dashboard, use @supabase/supabase-js in Server Actions.' },
      { name: 'Prisma', tip: 'Run `npx prisma init`, define schema, migrate, and generate the client.' },
      { name: 'Drizzle', tip: 'Lightweight ORM with great TypeScript support — pairs well with Neon or Turso.' },
    ],
    relatedSlugs: ['missing-auth', 'missing-env-config'],
  },
  {
    slug: 'missing-deployment',
    path: '/gaps/missing-deployment',
    icon: Rocket,
    title: 'Missing deployment',
    headline: 'No deploy config means',
    headlineAccent: 'it stays on localhost.',
    summary:
      'Deployment configuration is the bridge between your codebase and a URL users can visit. Without it, shipping means manual steps every time — or never shipping at all.',
    whyItMatters:
      'Takeoff looks for vercel.json, netlify.toml, Dockerfile, docker-compose, GitHub Actions deploy workflows, and platform-specific configs. A repo can be feature-complete and still have no path to production.',
    signs: [
      'No CI/CD pipeline or deploy workflow in .github/',
      'No hosting platform config (Vercel, Netlify, Railway, Fly.io)',
      'No Dockerfile or container setup',
      'README says "run npm dev" but nothing about production',
    ],
    howToFix: [
      {
        title: 'Pick a hosting platform',
        body: 'Vercel for Next.js. Railway or Render for full-stack Node apps. Fly.io for Docker-based deploys.',
      },
      {
        title: 'Add platform config and env vars',
        body: 'Set DATABASE_URL, auth secrets, and API keys in the platform dashboard — not in code.',
      },
      {
        title: 'Automate with CI/CD',
        body: 'Push to main triggers a deploy. Add a preview URL for pull requests.',
      },
    ],
    relatedSlugs: ['missing-env-config', 'missing-testing'],
  },
  {
    slug: 'missing-env-config',
    path: '/gaps/missing-env-config',
    icon: FileKey,
    title: 'Missing environment config',
    headline: 'No .env.example means',
    headlineAccent: 'secrets stay tribal knowledge.',
    summary:
      'Environment variables hold API keys, database URLs, and auth secrets. Without a documented .env.example, every new developer (and every deploy) is a guessing game.',
    whyItMatters:
      'Takeoff flags repos with no .env.example or env.example file. This is one of the fastest wins for production readiness — and one of the most commonly skipped in vibe-coded projects.',
    signs: [
      'No .env.example or env.example in the repo',
      'Secrets hardcoded in source files',
      'README does not list required environment variables',
      'Deploy fails with "missing DATABASE_URL" or similar',
    ],
    howToFix: [
      {
        title: 'Create .env.example with every required var',
        body: 'List each variable with a placeholder value and a comment explaining what it is. Never commit real secrets.',
      },
      {
        title: 'Validate env vars at startup',
        body: 'Use zod or envalid to fail fast if a required variable is missing — instead of crashing mid-request.',
      },
      {
        title: 'Document in README',
        body: 'Add a "Getting started" section: copy .env.example to .env.local, fill in values, run migrations, start dev server.',
      },
    ],
    relatedSlugs: ['missing-deployment', 'missing-database'],
  },
  {
    slug: 'missing-testing',
    path: '/gaps/missing-testing',
    icon: FlaskConical,
    title: 'Missing tests',
    headline: 'No tests means',
    headlineAccent: 'every deploy is a gamble.',
    summary:
      'Automated tests catch regressions before users do. Vibe-coded apps often have zero test coverage — which is fine for a hackathon, risky for anything users depend on.',
    whyItMatters:
      'Takeoff detects test runners (Jest, Vitest, Playwright, Cypress), test files, and CI test steps. Even a handful of integration tests on critical paths dramatically reduces production surprises.',
    signs: [
      'No test script in package.json',
      'No __tests__/, tests/, or *.test.* files',
      'CI pipeline does not run tests before deploy',
      'Bugs reappear after every new feature',
    ],
    howToFix: [
      {
        title: 'Start with critical path tests',
        body: 'Auth flow, main API endpoints, and payment/checkout if applicable. Do not aim for 100% coverage on day one.',
      },
      {
        title: 'Add a test runner',
        body: 'Vitest for Vite/Next projects. Jest for older setups. Playwright for end-to-end browser tests.',
      },
      {
        title: 'Run tests in CI',
        body: 'Block merges when tests fail. Add a pre-push hook locally for faster feedback.',
      },
    ],
    relatedSlugs: ['missing-error-handling', 'missing-deployment'],
  },
  {
    slug: 'missing-error-handling',
    path: '/gaps/missing-error-handling',
    icon: AlertTriangle,
    title: 'Missing error handling',
    headline: 'No error handling means',
    headlineAccent: 'users see white screens.',
    summary:
      'Unhandled errors crash your app or leak stack traces to users. Structured error handling — boundaries, global handlers, consistent API error shapes — is what separates demos from products.',
    whyItMatters:
      'Takeoff looks for error boundaries in React, global Express error middleware, try/catch patterns in API routes, and structured error response formats.',
    signs: [
      'API routes return 500 with raw error messages',
      'No React error boundary wrapping the app',
      'Network failures show blank pages with no recovery',
      'No logging or error tracking (Sentry, etc.)',
    ],
    howToFix: [
      {
        title: 'Add a global error boundary (frontend)',
        body: 'Wrap your app in an error boundary that shows a friendly fallback UI and offers a retry action.',
      },
      {
        title: 'Standardize API error responses',
        body: 'Return { error: string, code?: string } with appropriate HTTP status codes. Never expose stack traces in production.',
      },
      {
        title: 'Add error tracking',
        body: 'Sentry, LogRocket, or similar — so you know about failures before users report them.',
      },
    ],
    relatedSlugs: ['missing-testing', 'missing-auth'],
  },
  {
    slug: 'missing-permissions',
    path: '/gaps/missing-permissions',
    icon: Users,
    title: 'Missing permissions',
    headline: 'No roles means',
    headlineAccent: 'everyone can do everything.',
    summary:
      'Permissions control who can see, edit, or delete what. Admin panels, team features, and multi-tenant apps all need role-based access — not just a login wall.',
    whyItMatters:
      'Takeoff checks for role definitions, authorization middleware, and row-level access patterns. Auth without permissions is like a building with a front door but no locks on individual rooms.',
    signs: [
      'Logged-in users can access any other user\'s data',
      'Admin routes have no role check',
      'No roles, permissions, or ACL tables in the schema',
      '"Admin" UI is visible to all authenticated users',
    ],
    howToFix: [
      {
        title: 'Define roles early',
        body: 'Start with user and admin. Add team/org roles when you need multi-tenancy. Store roles in the database, not hardcoded.',
      },
      {
        title: 'Enforce on the server',
        body: 'UI hiding is not security. Every API route must verify the caller\'s role or ownership before returning data.',
      },
      {
        title: 'Add row-level checks',
        body: 'Queries should filter by user_id or org_id. Never trust client-provided IDs without verifying ownership.',
      },
    ],
    relatedSlugs: ['missing-auth', 'missing-database'],
  },
];

export function getGapExplainer(slug: string): GapExplainer | undefined {
  return GAP_EXPLAINERS.find((g) => g.slug === slug);
}
