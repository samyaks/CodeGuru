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
    title: 'Readiness Score',
    body: 'Weighted by real user impact, not just technical completeness.',
    detail:
      'A single score that reflects how close you are to shipping something people can actually use. Auth, database, deployment, and permissions all factor in — weighted by how much they matter to your users.',
  },
  {
    icon: Rocket,
    title: 'One-Click Deploy',
    body: 'From analysis to live URL. Env vars set automatically.',
    detail:
      'When your gaps are closed, Takeoff helps you get to a live URL faster — with deployment guidance and environment configuration surfaced from your actual codebase.',
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
      'No. Takeoff reads up to ~30 key files via the GitHub API — package manifests, configs, routes, auth files, and similar. We never clone your repo and do not persist full source code.',
  },
  {
    question: 'Can I analyze a private repo?',
    answer:
      'Yes. Connect GitHub with OAuth and pick any repo you have access to. Public repos can be analyzed by pasting a URL — no account required.',
  },
  {
    question: 'What stacks do you support?',
    answer:
      'Any JavaScript/TypeScript, Python, Go, or Rust repo on GitHub. We detect Next.js, Vite, Express, Supabase, Prisma, and dozens of other frameworks automatically from your files.',
  },
  {
    question: 'How is this different from a linter or CI check?',
    answer:
      'Linters catch syntax and style. Takeoff maps your codebase to user needs, scores shipping readiness, and generates AI context — the stuff vibe coders get stuck on after the UI looks done.',
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
    quote: {
      text: 'I finally stopped re-explaining my repo to ChatGPT every session.',
      attribution: 'Early access user',
    },
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
      'No shared view of readiness across stakeholders',
      'Security risks discovered too late',
    ],
    outcomes: [
      {
        title: 'Readiness score you can share',
        body: 'One number backed by concrete gaps — not gut feel or story points.',
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
    quote: {
      text: 'It is the first tool that shows me the gap between the demo and production.',
      attribution: 'PM, early access',
    },
  },
  {
    slug: 'agencies',
    path: '/for/agencies',
    icon: Briefcase,
    eyebrow: 'For agencies & consultants',
    headline: 'Audit client repos',
    headlineAccent: 'in two minutes.',
    subhead:
      'Before you quote a build or hand off a project, run Takeoff on the repo. Get a readiness report, security scan, and gap list you can share with the client — no manual code review required.',
    pains: [
      'Discovery calls without visibility into codebase quality',
      'Surprise infra debt after project kickoff',
      'Hard to justify scope without evidence',
      'Security issues found post-launch hurt your reputation',
    ],
    outcomes: [
      {
        title: 'Fast technical due diligence',
        body: 'Analyze any public repo by URL. Connect GitHub for private client repos.',
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
    quote: {
      text: 'We use it in every discovery call now. Saves hours of manual review.',
      attribution: 'Agency founder, early access',
    },
  },
];

export const HOW_IT_WORKS_STEPS = [
  {
    step: '1',
    title: 'Connect your repo',
    body: 'Sign in with GitHub, paste a public repo URL, or upload a folder. No clone, no install — we read key files via the GitHub API.',
  },
  {
    step: '2',
    title: 'Get your readiness map',
    body: 'Takeoff analyzes your stack, maps features to user jobs, scores gaps by impact, and runs a security scan — usually in under two minutes.',
  },
  {
    step: '3',
    title: 'Ship with AI context',
    body: 'Download .context.md files, copy gap-fix prompts into Cursor or Claude Code, and close the last 40% with grounded instructions instead of guesswork.',
  },
];

export const PRICING_TIERS = [
  {
    name: 'Early access',
    price: 'Free',
    period: 'while in beta',
    description: 'Full product access for solo builders and small teams.',
    features: [
      'Unlimited public repo analysis',
      'Private repos via GitHub OAuth',
      'Product map & readiness score',
      'Security report & gap prompts',
      '.context.md generation',
      'Shareable build stories',
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
