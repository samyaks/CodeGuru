import { useEffect, useState, useRef } from 'react';
import {
  Bug,
  Wrench,
  Sparkles,
  Lightbulb,
  Zap,
  Copy,
  Check,
  X,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  fetchSuggestions,
  updateSuggestionStatus,
  type Suggestion,
} from '../services/api';
import { Badge } from './ui';
import type { BadgeStatus } from './ui';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  bug: <Bug size={16} className="text-danger" />,
  fix: <Wrench size={16} className="text-warning" />,
  feature: <Sparkles size={16} className="text-brand" />,
  idea: <Lightbulb size={16} className="text-text-soft" />,
  perf: <Zap size={16} className="text-success" />,
};

const TYPE_LABELS: Record<string, string> = {
  bug: 'Bugs',
  fix: 'Fixes',
  feature: 'Features',
  idea: 'Ideas',
  perf: 'Perf',
};

const PRIORITY_BADGE: Record<string, BadgeStatus> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
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
    <div className="rounded-[14px] bg-surface border border-line overflow-hidden shadow-card">
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {TYPE_ICONS[suggestion.type] ?? (
              <Sparkles size={16} className="text-text-faint" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <Badge status={PRIORITY_BADGE[suggestion.priority] ?? 'low'}>
                {suggestion.priority}
              </Badge>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 border border-line text-text-faint font-medium">
                {suggestion.category}
              </span>
              {suggestion.source === 'ai' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-tint-2 border border-brand-tint-border text-brand font-mono font-semibold">
                  AI
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-text">{suggestion.title}</h3>
          </div>
        </div>

        <p className="text-sm text-text-soft leading-relaxed">{suggestion.description}</p>

        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            ⏱{' '}
            {suggestion.effort === 'quick'
              ? 'Quick fix'
              : suggestion.effort === 'medium'
              ? 'Medium effort'
              : 'Large effort'}
          </span>
        </div>

        {suggestion.evidence && suggestion.evidence.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 text-xs text-text-faint hover:text-text transition-colors self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {suggestion.evidence.length} file
            {suggestion.evidence.length > 1 ? 's' : ''} affected
          </button>
        )}

        {expanded && suggestion.evidence && (
          <div className="flex flex-col gap-2 pl-2.5 border-l-2 border-line">
            {suggestion.evidence.map((e, i) => (
              <div key={i} className="text-xs">
                <code className="text-brand font-mono">
                  {e.file}
                  {e.line ? `:${e.line}` : ''}
                </code>
                {e.snippet && (
                  <pre className="mt-1 p-2 rounded bg-page border border-line text-text-soft overflow-x-auto text-[11px] font-mono">
                    {e.snippet}
                  </pre>
                )}
                <p className="text-text-muted mt-0.5">{e.reason}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 flex-wrap">
          {suggestion.cursor_prompt ? (
            <button
              onClick={() => onCopy(suggestion.id, suggestion.cursor_prompt as string)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-tint hover:bg-brand-tint-2 text-brand border border-brand-tint-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              {copiedId === suggestion.id ? (
                <Check size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
              {copiedId === suggestion.id ? 'Copied!' : 'Copy Cursor Prompt'}
            </button>
          ) : null}
          <button
            onClick={() => onDone(suggestion.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-success hover:bg-success-bg border border-transparent hover:border-success-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/30"
          >
            <CheckCircle2 size={12} /> Done
          </button>
          <button
            onClick={() => onDismiss(suggestion.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:bg-page border border-transparent hover:border-line transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-faint/30"
          >
            <X size={12} /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuggestionsPanel({
  projectId,
  projectStatus,
}: {
  projectId: string;
  projectStatus: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiDonePolling, setAiDonePolling] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const pollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAiDonePolling(false);

    fetchSuggestions(projectId)
      .then((data) => {
        if (cancelled) return;
        setSuggestions(data.suggestions);
        const hasAi = data.suggestions.some((s: Suggestion) => s.source === 'ai');
        if (!hasAi && data.suggestions.length > 0 && projectStatus === 'ready') {
          const reFetch = () =>
            fetchSuggestions(projectId)
              .then((fresh) => {
                if (!cancelled) setSuggestions(fresh.suggestions);
              })
              .catch(() => {});
          pollTimers.current.push(
            setTimeout(() => {
              if (!cancelled) reFetch();
            }, 15000),
          );
          pollTimers.current.push(
            setTimeout(() => {
              if (cancelled) return;
              reFetch().finally(() => {
                if (!cancelled) setAiDonePolling(true);
              });
            }, 45000),
          );
        } else {
          setAiDonePolling(true);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      pollTimers.current.forEach(clearTimeout);
      pollTimers.current = [];
    };
  }, [projectId, projectStatus]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
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
    setSuggestions((s) =>
      s.map((x) => (x.id === suggestionId ? { ...x, status: 'dismissed' as const } : x)),
    );
    try {
      await updateSuggestionStatus(projectId, suggestionId, 'dismissed');
    } catch {
      setSuggestions((s) =>
        s.map((x) => (x.id === suggestionId ? { ...x, status: 'open' as const } : x)),
      );
    }
  };

  const handleDone = async (suggestionId: string) => {
    setSuggestions((s) =>
      s.map((x) => (x.id === suggestionId ? { ...x, status: 'done' as const } : x)),
    );
    try {
      await updateSuggestionStatus(projectId, suggestionId, 'done');
    } catch {
      setSuggestions((s) =>
        s.map((x) => (x.id === suggestionId ? { ...x, status: 'open' as const } : x)),
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-text-faint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-danger text-sm">
        Failed to load suggestions: {error}
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="text-center py-16 flex flex-col items-center gap-3">
        <Sparkles size={40} className="text-text-disabled" />
        <h3 className="text-lg font-semibold text-text">No suggestions yet</h3>
        <p className="text-sm text-text-muted max-w-md">
          Suggestions are generated during analysis. Re-analyze to get fresh suggestions.
        </p>
      </div>
    );
  }

  const totalOpen = suggestions.filter((s) => s.status === 'open').length;
  const totalDone = suggestions.filter((s) => s.status === 'done').length;
  const dismissedCount = suggestions.filter((s) => s.status === 'dismissed').length;
  const addressableCount = suggestions.length - dismissedCount;
  const pct = addressableCount > 0 ? (totalDone / addressableCount) * 100 : 0;

  const filtered =
    activeFilter === 'all'
      ? suggestions.filter((s) => s.status === 'open')
      : suggestions.filter((s) => s.status === 'open' && s.type === activeFilter);

  const openItems = suggestions.filter((s) => s.status === 'open');
  const typeCounts: Record<string, number> = {};
  for (const s of openItems) typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;

  return (
    <div className="flex flex-col gap-5">
      {/* AI polling banner */}
      {suggestions.length > 0 &&
        !suggestions.some((s) => s.source === 'ai') &&
        projectStatus === 'ready' &&
        !aiDonePolling && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-brand-tint border border-brand-tint-border text-xs text-brand">
            <Sparkles size={14} className="animate-pulse shrink-0" />
            AI is analyzing your codebase for deeper suggestions &mdash; they'll appear here shortly.
          </div>
        )}

      {/* Progress */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-text-faint">
          <span>
            {totalDone} of {addressableCount} addressed
          </span>
          <span>{totalOpen} remaining</span>
        </div>
        <div
          className="h-1.5 rounded-full bg-surface-2 border border-line overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 text-sm flex-wrap">
        <FilterButton
          active={activeFilter === 'all'}
          onClick={() => setActiveFilter('all')}
          label="All"
          count={openItems.length}
        />
        {Object.entries(typeCounts).map(([type, count]) => (
          <FilterButton
            key={type}
            active={activeFilter === type}
            onClick={() => setActiveFilter(type)}
            label={TYPE_LABELS[type] || type}
            count={count}
          />
        ))}
      </div>

      {/* Grouped cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          No open suggestions in this category.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {(['critical', 'high', 'medium', 'low'] as const).map((priority) => {
            const group = filtered.filter((s) => s.priority === priority);
            if (group.length === 0) return null;
            return (
              <div key={priority} className="flex flex-col gap-2.5">
                <h3 className="eyebrow text-text-faint">
                  {priority} &middot; {group.length}
                </h3>
                {group.map((s) => (
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
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        active
          ? 'bg-brand-tint text-brand border-brand-tint-border'
          : 'bg-transparent text-text-muted border-transparent hover:text-text hover:bg-page',
      ].join(' ')}
    >
      {label} {count}
    </button>
  );
}
