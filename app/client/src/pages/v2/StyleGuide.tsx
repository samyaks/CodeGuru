import { useState } from 'react';
import {
  AlertOctagon, FileText, GitCommit, Users, Wrench, Server,
  CheckCircle, AlertTriangle, Clock,
} from 'lucide-react';
import {
  Card, MetadataLabel, Badge, TabBar, ProgressBar, EmptyState,
  PersonaCard, GapCard, ShippedItem, ChatDrawer,
} from '../../components/v2';
import type { GapData, ShippedItemData, ChatMessage } from '../../components/v2';

// Throwaway QA route. Renders every v2 component in its main states so we can
// visually verify them. This file is deleted in Phase 6b.

const SAMPLE_GAPS: GapData[] = [
  {
    id: 'b1',
    category: 'broken',
    title: 'No input validation on API routes',
    description:
      'API routes accept requests but no validation library (zod, joi, yup) is in use. Bad input can crash the app or open security holes.',
    effort: 'Medium',
    files: 38,
    affects: ['Tech Lead'],
    prompt:
      'Add input validation to all API routes.\n\nContext: Your project has 38 API route files.\n\nRequirements:\n1. Install zod\n2. Add request body schemas\n3. Validate at the top of each handler',
  },
  {
    id: 'm1',
    category: 'missing',
    title: 'Decision reports for leadership',
    description:
      'Engineering Managers need exportable decision summaries. Currently 74% built — missing PDF export and email delivery.',
    effort: 'Medium',
    completion: 74,
    affects: ['Engineering Manager', 'Tech Lead'],
  },
  {
    id: 'i1',
    category: 'infra',
    title: 'Email — not built',
    description:
      'No email module detected. Required for: notification workflows, password reset, decision report delivery.',
    effort: 'Medium',
    required_for: ['Notifications', 'Password reset', 'Report delivery'],
  },
  // Phase 2 slice (a): the security lens. One sample per severity so
  // we can eyeball the shield badge color + callout in StyleGuide
  // without spinning up a real analysis run.
  {
    id: 'sec1',
    category: 'broken',
    title: 'Possible Anthropic API key committed in app/server/keys.ts',
    description:
      'A line in app/server/keys.ts matches the pattern of an Anthropic API key. Anyone with read access to this repo can see this credential. Move it to an environment variable and rotate the key (assume it\'s already compromised).',
    effort: 'Small',
    files: 1,
    isSecurity: true,
    securitySeverity: 'critical',
    cweId: 'CWE-798',
    securityDetector: 'exposed-secrets',
    source: 'security',
  },
  {
    id: 'sec2',
    category: 'broken',
    title: 'Possible SQL injection at app/server/users.ts:42',
    description:
      'This line builds a SQL query via template-literal interpolation. If any interpolated value is user-controlled, an attacker can terminate the intended query and run their own. Use parameterised queries instead.',
    effort: 'Medium',
    files: 1,
    isSecurity: true,
    securitySeverity: 'high',
    cweId: 'CWE-89',
    securityDetector: 'sql-injection-patterns',
    source: 'security',
  },
  {
    id: 'sec3',
    category: 'infra',
    title: 'Express app is missing helmet security headers',
    description:
      'helmet is a one-line middleware that sets a bundle of HTTP security headers. Without it, the app is more exposed to XSS, clickjacking, and MIME-confusion attacks than it needs to be.',
    effort: 'Small',
    isSecurity: true,
    securitySeverity: 'medium',
    cweId: 'CWE-693',
    securityDetector: 'missing-helmet',
    source: 'security',
  },
  {
    id: 'sec4',
    category: 'broken',
    title: 'eval() in app/server/util.ts:18',
    description:
      'eval() is in use here but no obvious user-input flow reaches it. The immediate risk is low, but eval() remains a footgun that any future refactor can turn into a critical eval-injection issue.',
    effort: 'Small',
    files: 1,
    isSecurity: true,
    securitySeverity: 'low',
    cweId: 'CWE-95',
    securityDetector: 'eval-with-input',
    source: 'security',
  },
];

const SAMPLE_SHIPPED: ShippedItemData[] = [
  {
    id: 's1',
    title: 'Add zod for input validation',
    commit: '3d3d39b9',
    commitMessage: 'feat: add zod validation across API routes',
    filesChanged: 38,
    verification: 'verified',
    verificationDetail: 'All 38 routes now have request schemas',
    shippedAt: 'Yesterday, 4:22pm',
    deployedTo: 'Railway',
  },
  {
    id: 's3',
    title: 'Environment variable validation',
    commit: 'a4f9c2',
    commitMessage: 'fix: validate env vars at startup',
    filesChanged: 8,
    verification: 'partial',
    verificationDetail: '2 of 10 files still read process.env directly',
    partialItems: ['app/server/db.ts', 'packages/auth/index.js'],
    shippedAt: '2 hours ago',
    deployedTo: null,
  },
  {
    id: 's4',
    title: 'Suggestions UI — full page view',
    commit: 'd3d39b9',
    commitMessage: 'feat: add suggestions UI',
    filesChanged: 23,
    verification: 'pending',
    verificationDetail: 'Re-scanning to confirm all suggestion paths render',
    shippedAt: 'Just now',
    deployedTo: null,
  },
];

export default function StyleGuide() {
  const [activeTab, setActiveTab] = useState('gaps');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: 'Hello — this is a stubbed chat for QA.' },
  ]);
  const [gapStatuses, setGapStatuses] = useState<Record<string, 'untriaged' | 'in-progress' | 'rejected' | 'shipped'>>({
    b1: 'in-progress',
    m1: 'untriaged',
    i1: 'rejected',
    sec1: 'untriaged',
    sec2: 'in-progress',
    sec3: 'untriaged',
    sec4: 'rejected',
  });

  return (
    <div className="min-h-screen bg-stone-50 v2-font-sans">
      <main className="max-w-6xl mx-auto px-6 py-12 space-y-12">
        <header>
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">v2 design system</p>
          <h1 className="text-4xl font-bold text-stone-900 v2-font-serif">Style guide</h1>
          <p className="text-stone-600 mt-2">Throwaway QA route. Deleted in Phase 6b.</p>
        </header>

        <Section title="Card variants">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card>Default card</Card>
            <Card variant="hover">Hover card</Card>
            <Card variant="active">Active card</Card>
            <Card variant="subtle">Subtle card</Card>
          </div>
        </Section>

        <Section title="MetadataLabel">
          <MetadataLabel>Personas</MetadataLabel>
          <MetadataLabel>Stack</MetadataLabel>
          <MetadataLabel>In a nutshell</MetadataLabel>
        </Section>

        <Section title="Badge variants">
          <div className="flex flex-wrap gap-2">
            <Badge variant="broken" icon={AlertOctagon}>Broken</Badge>
            <Badge variant="missing" icon={Wrench}>Missing Functionality</Badge>
            <Badge variant="infra" icon={Server}>Missing Infrastructure</Badge>
            <Badge variant="verified" icon={CheckCircle}>Verified</Badge>
            <Badge variant="partial" icon={AlertTriangle}>Partial</Badge>
            <Badge variant="pending" icon={Clock}>Verifying...</Badge>
            <Badge variant="in-progress">In progress</Badge>
            <Badge variant="rejected">Rejected</Badge>
            <Badge variant="neutral">Neutral</Badge>
          </div>
        </Section>

        <Section title="TabBar">
          <TabBar
            tabs={[
              { id: 'gaps', label: 'Gaps', icon: AlertOctagon, badge: 5 },
              { id: 'map', label: 'Map', icon: Users },
              { id: 'context', label: 'Context', icon: FileText },
              { id: 'shipped', label: 'Shipped', icon: GitCommit, badge: 2, badgeColor: 'emerald' },
            ]}
            activeId={activeTab}
            onChange={setActiveTab}
          />
        </Section>

        <Section title="ProgressBar">
          <div className="space-y-3 max-w-md">
            <ProgressBar value={95} label="Strong" />
            <ProgressBar value={82} label="Warning" />
            <ProgressBar value={42} label="Danger" />
          </div>
        </Section>

        <Section title="PersonaCard">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PersonaCard persona={{ name: 'Tech Lead', icon: '👷', readiness: 78, jobs: 5 }} onEdit={() => {}} />
            <PersonaCard persona={{ name: 'Product Manager', icon: '📋', readiness: 93, jobs: 4 }} onEdit={() => {}} />
          </div>
        </Section>

        <Section title="GapCard (all states)">
          <div className="space-y-3">
            {SAMPLE_GAPS.map((gap) => (
              <GapCard
                key={gap.id}
                gap={gap}
                status={gapStatuses[gap.id] ?? 'untriaged'}
                onAccept={(id) => setGapStatuses((s) => ({ ...s, [id]: 'in-progress' }))}
                onReject={(id) => setGapStatuses((s) => ({ ...s, [id]: 'rejected' }))}
                onRestore={(id) => setGapStatuses((s) => { const n = { ...s }; delete n[id]; return n; })}
                onMarkCommitted={(id) => setGapStatuses((s) => ({ ...s, [id]: 'shipped' }))}
                onCopyPrompt={() => {}}
              />
            ))}
          </div>
        </Section>

        <Section title="ShippedItem (all verifications)">
          <div className="space-y-3">
            {SAMPLE_SHIPPED.map((item) => (
              <ShippedItem key={item.id} item={item} onReopenAsGap={() => {}} />
            ))}
          </div>
        </Section>

        <Section title="EmptyState">
          <EmptyState
            icon={GitCommit}
            title="Nothing shipped yet"
            description="Accept a gap, commit your work, and it'll appear here verified."
          />
        </Section>

        <Section title="ChatDrawer">
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-md text-sm font-medium"
          >
            Open chat
          </button>
        </Section>
      </main>

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        quickPrompts={['priorities', 'verification', 'partial commits']}
        onSend={(text) => {
          setMessages((prev) => [
            ...prev,
            { role: 'user', text },
            { role: 'assistant', text: 'This is a stubbed reply for the style guide.' },
          ]);
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-stone-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}
