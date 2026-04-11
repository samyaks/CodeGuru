import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Terminal,
  FileText,
  GitBranch,
  Flag,
  Rocket,
  File,
  ExternalLink,
  Loader2,
  Gauge,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { fetchPublicStory, type PublicStoryData, type PublicBuildEntry } from '../services/api';
import { ApiError } from '../lib/api-error';

const TYPE_ICON: Record<PublicBuildEntry['entry_type'], React.ReactNode> = {
  prompt: <Terminal size={16} />,
  note: <FileText size={16} />,
  decision: <GitBranch size={16} />,
  milestone: <Flag size={16} />,
  deploy_event: <Rocket size={16} />,
  file: <File size={16} />,
};

const TYPE_STYLES: Record<PublicBuildEntry['entry_type'], { badge: string; dot: string; line: string; label: string }> = {
  prompt: {
    badge: 'bg-gold/10 text-gold border-gold/20',
    dot: 'border-gold/40 text-gold',
    line: 'bg-gold/20',
    label: 'Prompt',
  },
  decision: {
    badge: 'bg-gold/10 text-gold border-gold/20',
    dot: 'border-gold/40 text-gold',
    line: 'bg-gold/20',
    label: 'Decision',
  },
  milestone: {
    badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    dot: 'border-emerald-500/40 text-emerald-600',
    line: 'bg-emerald-500/20',
    label: 'Milestone',
  },
  deploy_event: {
    badge: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    dot: 'border-blue-500/40 text-blue-600',
    line: 'bg-blue-500/20',
    label: 'Deploy',
  },
  note: {
    badge: 'bg-sky-muted/10 text-sky-muted border-sky-border',
    dot: 'border-sky-border text-sky-muted',
    line: 'bg-sky-border/40',
    label: 'Note',
  },
  file: {
    badge: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    dot: 'border-amber-500/40 text-amber-600',
    line: 'bg-amber-500/20',
    label: 'File',
  },
};

function useOgMeta(story: PublicStoryData | null) {
  useEffect(() => {
    if (!story) return;

    const { owner, repo } = story.project;
    document.title = `${owner}/${repo} — Build Story`;

    const tags: Record<string, string> = {
      'og:title': `${owner}/${repo} — Build Story`,
      'og:description': story.social_summary || 'See how this app was built and deployed with Takeoff',
      'og:type': 'article',
      'og:url': window.location.href,
    };

    const cleanup: HTMLMetaElement[] = [];
    for (const [property, content] of Object.entries(tags)) {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', property);
        document.head.appendChild(el);
        cleanup.push(el);
      }
      el.setAttribute('content', content);
    }

    return () => {
      cleanup.forEach((el) => el.remove());
      document.title = 'Takeoff';
    };
  }, [story]);
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' :
    score >= 50 ? 'text-gold border-gold/30 bg-gold/10' :
    'text-red-600 border-red-500/30 bg-red-500/10';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${color}`}>
      <Gauge size={13} />
      {score}% ready
    </span>
  );
}

export default function ShareableStory() {
  const { slug } = useParams<{ slug: string }>();
  const [story, setStory] = useState<PublicStoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOgMeta(story);

  const loadStory = () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    fetchPublicStory(slug)
      .then(setStory)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof Error ? err.message : 'Something went wrong');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(loadStory, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-midnight flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-gold" />
          <p className="text-sm text-sky-muted">Loading build story...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-midnight flex flex-col">
        <StoryHeader />
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <AlertTriangle size={28} className="text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-sky-white">Something went wrong</h1>
          <p className="text-sky-muted max-w-md">{error}</p>
          <button
            onClick={loadStory}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
          >
            <RefreshCw size={16} />
            Try again
          </button>
        </main>
      </div>
    );
  }

  if (notFound || !story) {
    return (
      <div className="min-h-screen bg-midnight flex flex-col">
        <StoryHeader />
        <main className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-navy border border-sky-border/50 flex items-center justify-center">
            <FileText size={28} className="text-sky-muted" />
          </div>
          <h1 className="text-2xl font-bold text-sky-white">Story not found</h1>
          <p className="text-sky-muted max-w-md">
            This build story doesn't exist or the link may have changed.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
          >
            Go to Takeoff
          </Link>
        </main>
      </div>
    );
  }

  const { project, entries, social_summary } = story;
  const hasEntries = entries.length > 0;

  return (
    <div className="min-h-screen bg-midnight flex flex-col">
      <StoryHeader />

      {/* Hero */}
      <section className="border-b border-sky-border/30">
        <div className="max-w-3xl mx-auto w-full px-6 py-12 space-y-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-sky-white tracking-tight">
            {project.owner}/{project.repo}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            {project.framework && (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-navy border border-sky-border/50 text-sky-off">
                {project.framework}
              </span>
            )}
            {project.readiness_score != null && (
              <ScoreBadge score={project.readiness_score} />
            )}
            {project.live_url && (
              <a
                href={project.live_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
              >
                <ExternalLink size={12} />
                Live site
              </a>
            )}
          </div>

          {project.description && (
            <p className="text-sky-off text-base leading-relaxed max-w-2xl">
              {project.description}
            </p>
          )}

          {social_summary && (
            <blockquote className="border-l-2 border-gold/40 pl-4 text-sm text-sky-off italic">
              {social_summary}
            </blockquote>
          )}
        </div>
      </section>

      {/* Timeline */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-10">
        {!hasEntries ? (
          <div className="text-center py-20 space-y-3">
            <FileText size={48} className="mx-auto text-sky-muted" />
            <h2 className="text-lg font-semibold text-sky-white">
              This build story hasn't been shared yet
            </h2>
            <p className="text-sm text-sky-muted max-w-md mx-auto">
              The author hasn't made any entries public yet. Check back later!
            </p>
          </div>
        ) : (
          <div className="relative">
            {entries.map((entry, idx) => {
              const style = TYPE_STYLES[entry.entry_type];
              const isLast = idx === entries.length - 1;

              return (
                <div key={entry.id} className="relative flex gap-4">
                  <div className="flex flex-col items-center flex-shrink-0 w-9">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center border-2 bg-midnight ${style.dot}`}
                    >
                      {TYPE_ICON[entry.entry_type]}
                    </div>
                    {!isLast && (
                      <div className={`w-0.5 flex-1 min-h-8 ${style.line}`} />
                    )}
                  </div>

                  <div className="flex-1 pb-8 min-w-0">
                    <div className="bg-navy border border-sky-border/40 rounded-xl p-5">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${style.badge}`}>
                          {style.label}
                        </span>
                        {entry.title && (
                          <span className="text-sm font-medium text-sky-white">
                            {entry.title}
                          </span>
                        )}
                        <span className="text-[11px] text-sky-muted ml-auto flex-shrink-0">
                          {new Date(entry.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-sky-off whitespace-pre-wrap break-words leading-relaxed">
                        {entry.content}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-sky-border/30 py-10">
        <div className="max-w-3xl mx-auto w-full px-6 text-center space-y-4">
          <p className="text-sm text-sky-muted">
            Built and deployed with{' '}
            <Link to="/" className="text-gold hover:text-gold-dim transition-colors font-medium">
              Takeoff
            </Link>
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
          >
            Analyze your app
            <ArrowRight size={16} />
          </Link>
        </div>
      </footer>
    </div>
  );
}

function StoryHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-sky-border">
      <Link to="/" className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center font-bold text-sm text-gold">
          T
        </div>
        <span className="font-semibold text-lg text-sky-white">Takeoff</span>
      </Link>
    </header>
  );
}
