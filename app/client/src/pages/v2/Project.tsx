import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertOctagon, FileText, GitCommit, MessageCircle, Users, Zap,
} from 'lucide-react';
import { fetchProjectDetail, type ProjectWithEntries } from '../../services/api';
import { fetchProductMap, type ProductMapData } from '../../services/productMapApi';
import {
  TabBar, MetadataLabel, EmptyState, ChatDrawer,
} from '../../components/v2';
import type { ChatMessage } from '../../components/v2';
import GapsSection from './GapsSection';
import ShippedSection from './ShippedSection';
import MapSection from './MapSection';
import ContextSection from './ContextSection';

const TABS = ['gaps', 'map', 'context', 'shipped'] as const;
type TabId = (typeof TABS)[number];

const TAB_DEFS: Array<{ id: TabId; label: string; icon: typeof AlertOctagon }> = [
  { id: 'gaps', label: 'Gaps', icon: AlertOctagon },
  { id: 'map', label: 'Map', icon: Users },
  { id: 'context', label: 'Context', icon: FileText },
  { id: 'shipped', label: 'Shipped', icon: GitCommit },
];

const PLACEHOLDERS: Record<TabId, { icon: typeof AlertOctagon; title: string }> = {
  gaps: { icon: AlertOctagon, title: 'Gaps will appear here in Phase 3' },
  map: { icon: Users, title: 'Personas and jobs will appear here in Phase 5' },
  context: { icon: FileText, title: 'Project context will appear here in Phase 5' },
  shipped: { icon: GitCommit, title: 'Shipped commits will appear here in Phase 4' },
};

const DEFAULT_QUICK_PROMPTS = ['priorities', 'how does verification work', 'partial commits', 'reject reasons'];

const STUB_REPLIES: Record<string, string> = {
  priori: "Start with Broken gaps — they're shipping risks. Then tackle Missing Functionality blocking your weakest persona.",
  verif: "When you commit code, Takeoff re-scans the affected files and checks if the gap criteria are still met. Verified means it's truly fixed; partial means some files were missed.",
  partial: "Partial verification means your commit addressed some but not all of the gap. Click into the partial item in Shipped to see exactly what's left.",
  reject: "Rejecting a gap means it won't show up in future audits. Useful when something is intentional.",
};

function readHashTab(): TabId {
  if (typeof window === 'undefined') return 'gaps';
  const raw = window.location.hash.replace(/^#/, '').toLowerCase();
  return (TABS as readonly string[]).includes(raw) ? (raw as TabId) : 'gaps';
}

export default function ProjectV2() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [productMap, setProductMap] = useState<ProductMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(readHashTab);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: "I've analyzed your project. Ask me about any gap, or how to prioritize." },
  ]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProjectDetail(id)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    fetchProductMap(id)
      .then((map) => { if (!cancelled) setProductMap(map); })
      .catch(() => { /* product map is best-effort */ });

    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    function onHashChange() { setActiveTab(readHashTab()); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!loading && project && (project.status === 'analyzing' || project.status === 'pending')) {
      navigate(`/takeoff/${id}`, { replace: true });
    }
  }, [loading, project, id, navigate]);

  const setTab = useCallback((next: string) => {
    if ((TABS as readonly string[]).includes(next)) {
      window.location.hash = next;
      setActiveTab(next as TabId);
    }
  }, []);

  const sendChat = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: 'user', text }]);
    window.setTimeout(() => {
      const lower = text.toLowerCase();
      const key = Object.keys(STUB_REPLIES).find((k) => lower.includes(k));
      const reply = key
        ? STUB_REPLIES[key]
        : 'Try asking about: priorities, verification, partial commits, or reject reasons.';
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    }, 600);
  }, []);

  const personas = useMemo(() => {
    if (!productMap) return [] as Array<{ id: string; name: string; emoji: string; readiness: number }>;
    const personaScores = productMap.scores?.persona ?? {};
    return productMap.personas.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji ?? '📌',
      readiness: typeof personaScores[p.id] === 'number'
        ? Math.round(personaScores[p.id]! * 100)
        : Math.round(((productMap.scores?.app ?? 0.5) * 100)),
    }));
  }, [productMap]);

  const stack = useMemo(() => {
    if (!project?.stack_info) return [] as Array<[string, string]>;
    const entries: Array<[string, string]> = [];
    if (project.stack_info.runtime) entries.push(['Runtime', project.stack_info.runtime]);
    if (project.stack_info.framework) entries.push(['Framework', project.stack_info.framework]);
    if (project.stack_info.styling) entries.push(['Styling', project.stack_info.styling]);
    if (project.stack_info.database) entries.push(['Database', project.stack_info.database]);
    if (project.stack_info.auth) entries.push(['Auth', project.stack_info.auth]);
    if (project.deploy_type) entries.push(['Deploy', project.deploy_type]);
    return entries;
  }, [project]);

  const readiness = project?.readiness_score ?? null;

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center">
        <div className="text-stone-500 text-sm">Loading project…</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center px-6">
        <EmptyState
          icon={AlertOctagon}
          title="Couldn't load this project"
          description={error ?? 'Project not found.'}
        />
      </div>
    );
  }

  const placeholder = PLACEHOLDERS[activeTab];
  const showRealGaps = activeTab === 'gaps' && !!id;
  const showRealShipped = activeTab === 'shipped' && !!id;
  const showRealMap = activeTab === 'map' && !!id;
  const showRealContext = activeTab === 'context' && !!id;

  return (
    <div className="min-h-screen bg-stone-50 v2-font-sans">
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-stone-900 rounded flex items-center justify-center">
              <Zap className="w-4 h-4 text-stone-50" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-stone-900 tracking-tight">Takeoff</h1>
              <p className="text-xs text-stone-500">AI in the loop</p>
            </div>
          </div>
          <a href="/" className="text-sm text-stone-600 hover:text-stone-900 transition-colors">
            + New project
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Your project</p>
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-3">
            <h2 className="text-4xl font-bold text-stone-900 tracking-tight v2-font-serif">
              {project.repo || project.repo_url}
            </h2>
            {readiness !== null ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-stone-500">Readiness</span>
                <span className="text-2xl font-bold text-stone-900">{readiness}</span>
                <span className="text-stone-400">/ 100</span>
              </div>
            ) : null}
          </div>
          <p className="text-stone-600 text-sm">
            {project.description ?? project.framework ?? 'Project'}
          </p>
        </div>

        <TabBar
          tabs={TAB_DEFS}
          activeId={activeTab}
          onChange={setTab}
          className="mb-8"
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            {showRealGaps ? (
              <GapsSection projectId={id!} />
            ) : showRealShipped ? (
              <ShippedSection projectId={id!} />
            ) : showRealMap ? (
              <MapSection projectId={id!} />
            ) : showRealContext ? (
              <ContextSection projectId={id!} />
            ) : (
              <EmptyState icon={placeholder.icon} title={placeholder.title} />
            )}
          </div>

          <aside className="space-y-5">
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <MetadataLabel className="mb-3">Stack</MetadataLabel>
              {stack.length === 0 ? (
                <p className="text-xs text-stone-500">Stack details unavailable.</p>
              ) : (
                <div className="space-y-2">
                  {stack.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span className="text-stone-500 text-xs">{k}</span>
                      <span className="font-medium text-stone-900 text-xs text-right">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <MetadataLabel className="mb-3">Personas</MetadataLabel>
              {personas.length === 0 ? (
                <p className="text-xs text-stone-500">No personas yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {personas.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span aria-hidden>{p.emoji}</span>
                        <span className="text-stone-700 truncate">{p.name}</span>
                      </div>
                      <span className="font-medium text-stone-900 flex-shrink-0">{p.readiness}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white rounded-lg p-5 text-left transition-colors group"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold">Ask Claude</p>
                <MessageCircle className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-xs text-stone-300">Get advice on any gap or priority</p>
            </button>
          </aside>
        </div>
      </main>

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        onSend={sendChat}
        quickPrompts={DEFAULT_QUICK_PROMPTS}
      />
    </div>
  );
}
