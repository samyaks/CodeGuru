import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Bug, Wrench, Sparkles, Lightbulb, Zap,
  Copy, Check, X, CheckCircle2,
  ChevronDown, ChevronRight, ArrowLeft,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchProject,
  fetchSuggestions,
  updateSuggestionStatus,
  type Project,
  type Suggestion,
} from '../services/api';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  bug: <Bug size={16} className="text-red-600" />,
  fix: <Wrench size={16} className="text-amber-600" />,
  feature: <Sparkles size={16} className="text-gold" />,
  idea: <Lightbulb size={16} className="text-sky-off" />,
  perf: <Zap size={16} className="text-emerald-600" />,
};

const TYPE_LABELS: Record<string, string> = {
  bug: 'Bugs',
  fix: 'Fixes',
  feature: 'Features',
  idea: 'Ideas',
  perf: 'Perf',
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
  high: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  medium: 'bg-gold/10 text-gold border-gold/20',
  low: 'bg-sky-muted/10 text-sky-muted border-sky-border',
};

function SuggestionCard({
  suggestion,
  onDismiss,
  onDone,
  copiedId,
  onCopy,
}: {
  suggestion: Suggestion;
  onDismiss: (id: string) => void;
  onDone: (id: string) => void;
  copiedId: string | null;
  onCopy: (id: string, prompt: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl bg-navy border border-sky-border/50 overflow-hidden">
      <div className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{TYPE_ICONS[suggestion.type] ?? <Sparkles size={16} className="text-sky-muted" />}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${PRIORITY_STYLES[suggestion.priority] ?? PRIORITY_STYLES.low}`}>
                {suggestion.priority}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy-mid border border-sky-border text-sky-muted">
                {suggestion.category}
              </span>
              {suggestion.source === 'ai' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  AI
                </span>
              )}
            </div>
            <h3 className="text-sm font-medium text-sky-white">{suggestion.title}</h3>
          </div>
        </div>

        <p className="text-sm text-sky-off leading-relaxed">{suggestion.description}</p>

        <div className="flex items-center gap-2">
          <span className="text-xs text-sky-muted">
            ⏱ {suggestion.effort === 'quick' ? 'Quick fix' : suggestion.effort === 'medium' ? 'Medium effort' : 'Large effort'}
          </span>
        </div>

        {suggestion.evidence && suggestion.evidence.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-sky-muted hover:text-sky-white transition-colors"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {suggestion.evidence.length} file{suggestion.evidence.length > 1 ? 's' : ''} affected
          </button>
        )}

        {expanded && suggestion.evidence && (
          <div className="space-y-2 pl-2 border-l-2 border-sky-border/30">
            {suggestion.evidence.map((e, i) => (
              <div key={i} className="text-xs">
                <code className="text-gold">{e.file}{e.line ? `:${e.line}` : ''}</code>
                {e.snippet && (
                  <pre className="mt-1 p-2 rounded bg-midnight/50 text-sky-muted overflow-x-auto text-[11px]">{e.snippet}</pre>
                )}
                <p className="text-sky-muted mt-0.5">{e.reason}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          {suggestion.cursor_prompt ? (
            <button
              onClick={() => onCopy(suggestion.id, suggestion.cursor_prompt as string)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gold/10 hover:bg-gold/20 text-gold border border-gold/20 transition-colors"
            >
              {copiedId === suggestion.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              {copiedId === suggestion.id ? 'Copied!' : 'Copy Cursor Prompt'}
            </button>
          ) : null}
          <button
            onClick={() => onDone(suggestion.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20 transition-colors"
          >
            <CheckCircle2 size={12} /> Done
          </button>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-sky-muted hover:bg-sky-border/10 border border-transparent hover:border-sky-border/30 transition-colors"
          >
            <X size={12} /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuggestionsView() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiDonePolling, setAiDonePolling] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const pollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setAiDonePolling(false);
    Promise.all([
      fetchProject(id),
      fetchSuggestions(id),
    ]).then(([proj, data]) => {
      if (cancelled) return;
      setProject(proj);
      setSuggestions(data.suggestions);
      const hasAi = data.suggestions.some((s: Suggestion) => s.source === 'ai');
      if (!hasAi && data.suggestions.length > 0 && proj.status === 'ready') {
        const reFetch = () => fetchSuggestions(id).then(fresh => {
          if (!cancelled) setSuggestions(fresh.suggestions);
        }).catch(() => {});
        pollTimers.current.push(setTimeout(() => { if (!cancelled) reFetch(); }, 15000));
        pollTimers.current.push(setTimeout(() => {
          if (cancelled) return;
          reFetch().finally(() => { if (!cancelled) setAiDonePolling(true); });
        }, 45000));
      } else {
        setAiDonePolling(true);
      }
    }).catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; pollTimers.current.forEach(clearTimeout); pollTimers.current = []; };
  }, [id]);

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); };
  }, []);

  const handleCopy = async (suggestionId: string, prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedId(suggestionId);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDismiss = async (suggestionId: string) => {
    if (!id) return;
    const prev = suggestions;
    setSuggestions(s => s.map(x => x.id === suggestionId ? { ...x, status: 'dismissed' as const } : x));
    try {
      await updateSuggestionStatus(id, suggestionId, 'dismissed');
    } catch {
      setSuggestions(prev);
    }
  };

  const handleDone = async (suggestionId: string) => {
    if (!id) return;
    const prev = suggestions;
    setSuggestions(s => s.map(x => x.id === suggestionId ? { ...x, status: 'done' as const } : x));
    try {
      await updateSuggestionStatus(id, suggestionId, 'done');
    } catch {
      setSuggestions(prev);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-sky-muted">Loading suggestions...</div>
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-red-600">{error || 'Project not found'}</div>
        </main>
      </div>
    );
  }

  const totalOpen = suggestions.filter(s => s.status === 'open').length;
  const totalDone = suggestions.filter(s => s.status === 'done').length;
  const totalAll = suggestions.length;
  const dismissedCount = suggestions.filter(s => s.status === 'dismissed').length;
  const addressableCount = totalAll - dismissedCount;

  const filtered = activeFilter === 'all'
    ? suggestions.filter(s => s.status === 'open')
    : suggestions.filter(s => s.status === 'open' && s.type === activeFilter);

  if (suggestions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo={`/takeoff/${id}/report`} title={`${project.owner}/${project.repo}`} />
        <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full space-y-8">
          <div className="text-center py-16 space-y-3">
            <Sparkles size={40} className="text-sky-muted mx-auto" />
            <h3 className="text-lg font-semibold text-sky-white">No suggestions yet</h3>
            <p className="text-sm text-sky-muted">Suggestions are generated during analysis. Re-analyze to get fresh suggestions.</p>
          </div>
          <Link to={`/takeoff/${id}/report`} className="inline-flex items-center gap-1.5 text-sm text-sky-muted hover:text-gold transition-colors">
            <ArrowLeft size={14} /> Back to report
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo={`/takeoff/${id}/report`} title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full space-y-8">
        {/* AI analysis in-progress banner — auto-hides after polling completes */}
        {suggestions.length > 0 && !suggestions.some(s => s.source === 'ai') && project.status === 'ready' && !aiDonePolling && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10 text-xs text-purple-400">
            <Sparkles size={14} className="animate-pulse flex-shrink-0" />
            AI is analyzing your codebase for deeper suggestions — they'll appear here shortly.
          </div>
        )}

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-sky-muted">
            <span>{totalDone} of {addressableCount} addressed</span>
            <span>{totalOpen} remaining</span>
          </div>
          <div className="h-1.5 rounded-full bg-navy-mid overflow-hidden">
            <div
              className="h-full rounded-full bg-gold transition-all"
              style={{ width: `${addressableCount > 0 ? (totalDone / addressableCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Filter tabs — counts derived from local state */}
        {(() => {
          const openItems = suggestions.filter(s => s.status === 'open');
          const typeCounts: Record<string, number> = {};
          for (const s of openItems) typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
          return (
            <div className="flex items-center justify-center gap-2 text-sm flex-wrap">
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-4 py-1.5 rounded-lg transition-colors ${activeFilter === 'all' ? 'bg-gold/15 text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
              >
                All {openItems.length}
              </button>
              {Object.entries(typeCounts).map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => setActiveFilter(type)}
                  className={`px-4 py-1.5 rounded-lg transition-colors ${activeFilter === type ? 'bg-gold/15 text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
                >
                  {TYPE_LABELS[type] || type} {count}
                </button>
              ))}
            </div>
          );
        })()}

        {/* Grouped suggestion cards */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-sky-muted text-sm">
            No open suggestions in this category.
          </div>
        ) : (
          <div className="space-y-6">
            {(['critical', 'high', 'medium', 'low'] as const).map(priority => {
              const group = filtered.filter(s => s.priority === priority);
              if (group.length === 0) return null;
              return (
                <div key={priority} className="space-y-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-sky-muted">
                    {priority} · {group.length}
                  </h3>
                  {group.map(s => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      onDismiss={handleDismiss}
                      onDone={handleDone}
                      copiedId={copiedId}
                      onCopy={handleCopy}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Back link */}
        <Link to={`/takeoff/${id}/report`} className="inline-flex items-center gap-1.5 text-sm text-sky-muted hover:text-gold transition-colors">
          <ArrowLeft size={14} /> Back to report
        </Link>
      </main>
    </div>
  );
}
