import type { LucideIcon } from 'lucide-react';
import {
  Map,
  CheckCircle2,
  Rocket,
  Shield,
  FileText,
  Zap,
  Target,
  Briefcase,
} from 'lucide-react';

export interface MarketingFeature {
  icon: LucideIcon;
  title: string;
  body: string;
  detail: string;
}

export const MARKETING_FEATURES: MarketingFeature[] = [
  {
    icon: Map,
    title: 'Product Map',
    body: "Jobs and personas scored against your codebase — see what users actually need.",
    detail:
      'Takeoff reads your routes, components, and API layers to map real features to user jobs. Personas get scored so you know which gaps block which users — not just what is technically missing.',
  },
  {
    icon: CheckCircle2,
    title: 'The Read',
    body: 'A plain-English spec drafted from your code — what it does, who it is for, what it cannot get wrong.',
    detail:
      'Takeoff writes the spec your repo implies: objective, audience, and the one job it must not break, each tied to the files it came from. You correct it in place; every correction is kept and the next read starts from what you settled.',
  },
  {
    icon: Rocket,
    title: 'The Next Thing',
    body: 'One thing to build next, with the exact prompt for Cursor or Claude Code.',
    detail:
      'Given the spec, Takeoff picks the single gap that stands between your app and its first real user, explains why, and writes the prompt for your builder — scoped to your files, your stack, and the rules it must not break.',
  },
  {
    icon: Shield,
    title: 'Security Report',
    body: 'Find exposed secrets, injection risks, and infra gaps before you ship.',
    detail:
      'Static analysis flags critical issues like committed API keys, SQL injection patterns, and missing security headers. Share a redacted report with your team or clients.',
  },
  {
    icon: FileText,
    title: 'Context Files',
    body: 'Generate .context.md files that ground Cursor and Claude Code in your repo.',
    detail:
      'AI tools fail at backend work because they lack project context. Takeoff generates structured context files — purpose, constraints, decisions, dependencies — from your real code.',
  },
  {
    icon: Zap,
    title: 'Gap Prompts',
    body: 'Copy-paste prompts to fix each gap with the right files and constraints.',
    detail:
      'Every gap comes with a ready-to-use prompt scoped to your stack, file count, and architecture. Paste into Cursor or Claude Code and keep building instead of guessing.',
  },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: FaqItem[] = [
  {
    question: 'Do you clone or store my source code?',
    answer:
      'We never clone your repo. Takeoff reads files through the GitHub API, prioritising the ones that describe the app — manifests, configs, routes, auth, schema — and skipping build output and vendored code. A typical scan reads a few hundred files. We keep what we need to track changes between scans; you can delete a project and its data at any time.',
  },
  {
    question: 'Can I analyze a private repo?',
    answer:
      'Not yet. Today Takeoff reads public repos by URL — no account required — or a folder you upload. Private-repo access through a GitHub App is in progress; sign in and we will tell you when it lands.',
  },
  {
    question: 'What stacks do you support?',
    answer:
      'JavaScript and TypeScript repos get the deepest read — Next.js, Vite, Express, Supabase, Prisma and similar are detected from your files. Python, Go, and Rust repos are read structurally with less depth for now.',
  },
  {
    question: 'How is this different from a linter or CI check?',
    answer:
      'Linters catch syntax and style. Takeoff reads what the app is for, maps the code to the jobs your users need done, and tells you the one thing to build next — the part vibe coders get stuck on after the UI looks done.',
  },
  {
    question: 'Is Takeoff free during early access?',
    answer:
      'Yes. Early access is free while we refine the product. Paid plans will come later with generous free tier limits for solo builders.',
  },
];

export interface UseCaseConfig {
  slug: string;
  path: string;
  icon: LucideIcon;
  eyebrow: string;
  headline: string;
  headlineAccent: string;
  subhead: string;
  pains: string[];
  outcomes: { title: string; body: string }[];
  quote?: { text: string; attribution: string };
}

export const USE_CASES: UseCaseConfig[] = [
  {
    slug: 'vibe-coders',
    path: '/for/vibe-coders',
    icon: Zap,
    eyebrow: 'For vibe coders',
    headline: 'Your UI is done.',
    headlineAccent: 'Your backend context is not.',
    subhead:
      'You shipped the screens in a weekend. Now auth, database, and deployment are blocking you — and AI keeps generating the wrong infrastructure. Takeoff reads your repo and tells you exactly what to build next.',
    pains: [
      'Cursor generates great components but wrong API patterns',
      'No idea if auth or database setup is actually complete',
      'Stuck at ~60% with no clear priority list',
      'Every new AI session starts from zero context',
    ],
    outcomes: [
      {
        title: 'Know what is actually missing',
        body: 'Gaps ranked by user impact — auth before polish, database before features nobody asked for.',
      },
      {
        title: 'Ground your AI in real context',
        body: 'Generated .context.md files so Cursor and Claude Code stop guessing your architecture.',
      },
      {
        title: 'Copy prompts that fix each gap',
        body: 'Scoped to your files and stack. Paste, run, ship.',
      },
    ],
  },
  {
    slug: 'pms',
    path: '/for/pms',
    icon: Target,
    eyebrow: 'For product managers',
    headline: 'See what is built',
    headlineAccent: 'vs. what was promised.',
    subhead:
      'Your eng team says it is 80% done. Takeoff analyzes the actual codebase and maps features to user jobs — so you can prioritize what blocks launch, not what looks good in a demo.',
    pains: [
      'Hard to verify backend completeness without reading code',
      'Demo UI hides missing auth, permissions, and error handling',
      'No shared, evidence-backed view of what is actually built',
      'Security risks discovered too late',
    ],
    outcomes: [
      {
        title: 'A spec drafted from the code, not the deck',
        body: 'What the repo actually does, who it serves, and which jobs are built — with a file trail for every claim.',
      },
      {
        title: 'Product map from real code',
        body: 'Personas and jobs scored against what exists in the repo today.',
      },
      {
        title: 'Security report for launch review',
        body: 'Share a redacted report with leadership before go-live.',
      },
    ],
  },
  {
    slug: 'agencies',
    path: '/for/agencies',
    icon: Briefcase,
    eyebrow: 'For agencies & consultants',
    headline: 'Audit client repos',
    headlineAccent: 'before you quote.',
    subhead:
      'Before you quote a build or hand off a project, run Takeoff on the repo. Get a plain-English read of what is built, a security scan, and a ranked gap list you can share with the client — no manual code review required.',
    pains: [
      'Discovery calls without visibility into codebase quality',
      'Surprise infra debt after project kickoff',
      'Hard to justify scope without evidence',
      'Security issues found post-launch hurt your reputation',
    ],
    outcomes: [
      {
        title: 'Fast technical due diligence',
        body: 'Analyze any public repo by URL, or upload a folder for repos you cannot share. Private-repo access via GitHub App is coming.',
      },
      {
        title: 'Shareable security reports',
        body: 'Redacted public links your clients can open without an account.',
      },
      {
        title: 'Clear deliverable list',
        body: 'Gaps with effort estimates become your statement of work.',
      },
    ],
  },
];

export const HOW_IT_WORKS_STEPS = [
  {
    step: '1',
    title: 'Connect your repo',
    body: 'Paste a public repo URL or upload a folder. No clone, no install — we read the files that describe your app through the GitHub API.',
  },
  {
    step: '2',
    title: 'Read the spec it finds',
    body: 'Takeoff drafts what your app is for, maps the code to user jobs, ranks the gaps, and runs a security scan. Most repos take two to three minutes.',
  },
  {
    step: '3',
    title: 'Build the next thing',
    body: 'Copy the prompt for the one gap that matters most into Cursor or Claude Code. Push, and Takeoff re-reads the affected files to check it landed.',
  },
];

export const PRICING_TIERS = [
  {
    name: 'Early access',
    price: 'Free',
    period: 'while in beta',
    description: 'Full product access for solo builders and small teams.',
    features: [
      'Public repo analysis by URL, or folder upload',
      'The Read: a spec drafted from your code',
      'Product map, ranked gaps, and the next thing to build',
      'Builder prompts for Cursor and Claude Code',
      'Security report with shareable links',
      '.context.md generation',
    ],
    cta: 'Start analyzing',
    highlighted: true,
  },
  {
    name: 'Pro',
    price: 'Coming soon',
    period: '',
    description: 'For teams shipping multiple products with deeper integrations.',
    features: [
      'Everything in Early access',
      'Team workspace & shared projects',
      'Priority analysis queue',
      'Custom context templates',
      'Analytics & usage insights',
      'SLA support',
    ],
    cta: 'Join waitlist',
    highlighted: false,
  },
];

export const STACK_LOGOS = [
  'Next.js',
  'React',
  'Supabase',
  'Prisma',
  'Vercel',
  'Express',
  'Tailwind',
  'TypeScript',
];
