export interface DemoReadinessCategory {
  label: string;
  score: number;
  status: 'missing' | 'partial' | 'ready';
  detail: string;
}

export interface DemoGap {
  id: string;
  category: 'broken' | 'missing' | 'infra';
  title: string;
  description: string;
  effort: string;
  isSecurity?: boolean;
  securitySeverity?: 'critical' | 'high' | 'medium' | 'low';
}

export interface DemoPersona {
  name: string;
  score: number;
  topJob: string;
}

export const DEMO_PROJECT = {
  repo: 'shadcn-ui/taxonomy',
  framework: 'Next.js',
  description: 'An open source application built using the new router, server components, and everything new in Next.js 13.',
  readinessScore: 62,
  securityScore: 71,
  readinessCategories: [
    { label: 'Authentication', score: 100, status: 'ready' as const, detail: 'NextAuth detected' },
    { label: 'Database', score: 70, status: 'partial' as const, detail: 'Prisma detected' },
    { label: 'Deployment', score: 0, status: 'missing' as const, detail: 'No deployment config found' },
    { label: 'Environment', score: 0, status: 'missing' as const, detail: 'No .env.example found' },
    { label: 'Error Handling', score: 100, status: 'ready' as const, detail: 'Global error handling detected' },
    { label: 'Testing', score: 0, status: 'missing' as const, detail: 'No test files detected' },
  ] satisfies DemoReadinessCategory[],
  gaps: [
    {
      id: 'demo-1',
      category: 'infra',
      title: 'Deployment — not configured',
      description:
        'No vercel.json, netlify.toml, Dockerfile, or CI deploy workflow detected. The app has no documented path from code to production.',
      effort: 'Medium',
    },
    {
      id: 'demo-2',
      category: 'missing',
      title: 'Environment variables undocumented',
      description:
        'No .env.example file found. Required secrets like DATABASE_URL and NEXTAUTH_SECRET may be undocumented for new contributors.',
      effort: 'Small',
    },
    {
      id: 'demo-3',
      category: 'broken',
      title: 'No input validation on API routes',
      description:
        'API routes accept requests but no validation library (zod, joi) is in use. Bad input can crash handlers or open security holes.',
      effort: 'Medium',
    },
    {
      id: 'demo-4',
      category: 'infra',
      title: 'No automated tests',
      description:
        'No test runner or test files detected. Shipping without tests means regressions go unnoticed until users hit them.',
      effort: 'Large',
      isSecurity: false,
    },
  ] satisfies DemoGap[],
  personas: [
    { name: 'Developer', score: 78, topJob: 'Browse and fork example components' },
    { name: 'Product builder', score: 54, topJob: 'Clone the stack as a starter template' },
    { name: 'Team lead', score: 41, topJob: 'Evaluate production readiness before adopting' },
  ] satisfies DemoPersona[],
};

/** Set VITE_DEMO_PROJECT_ID to link to a live public project report. */
export const DEMO_PROJECT_ID = import.meta.env.VITE_DEMO_PROJECT_ID as string | undefined;
