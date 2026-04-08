import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, CheckCircle2, ClipboardList, Zap, Search, Lock, Star, ChevronDown, Link2 } from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';
import { startTakeoff, fetchMyRepos, GitHubRepo } from '../services/api';

const EXAMPLES = [
  { label: 'shadcn/taxonomy', url: 'https://github.com/shadcn-ui/taxonomy' },
  { label: 'excalidraw', url: 'https://github.com/excalidraw/excalidraw' },
  { label: 'cal.com', url: 'https://github.com/calcom/cal.com' },
];

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'picker' | 'url'>('picker');

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [needsRelogin, setNeedsRelogin] = useState(false);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { login } = useAuth();

  useEffect(() => {
    if (user && mode === 'picker') {
      setReposLoading(true);
      setNeedsRelogin(false);
      fetchMyRepos()
        .then((data) => {
          setRepos(data.repos);
          if (data.needsRelogin) setNeedsRelogin(true);
        })
        .catch(() => setRepos([]))
        .finally(() => setReposLoading(false));
    }
  }, [user, mode]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = repos.filter((r) => {
    const q = search.toLowerCase();
    return r.full_name.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.language || '').toLowerCase().includes(q);
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    await analyze(repoUrl.trim());
  };

  const analyze = async (url: string) => {
    setLoading(true);
    setError(null);
    try {
      const { projectId } = await startTakeoff(url);
      navigate(`/takeoff/${projectId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to start analysis');
      setLoading(false);
    }
  };

  const selectRepo = (repo: GitHubRepo) => {
    setShowDropdown(false);
    analyze(repo.html_url);
  };

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-2xl w-full text-center space-y-10">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gold/10 border border-gold/20 text-gold text-xs font-medium">
              <Zap size={12} />
              Analyze &middot; Plan &middot; Deploy
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              You built the front end.
              <br />
              <span className="text-gold">We'll tell you what it needs to ship.</span>
            </h1>
            <p className="text-lg text-sky-muted max-w-xl mx-auto">
              {user
                ? 'Select a repo below or paste any GitHub URL to get started.'
                : 'Paste a GitHub repo — get a production readiness score, a step-by-step plan, and deploy when you\'re ready.'}
            </p>
          </div>

          {user && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <button
                onClick={() => setMode('picker')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${mode === 'picker' ? 'bg-gold/15 text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
              >
                My Repos
              </button>
              <button
                onClick={() => setMode('url')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${mode === 'url' ? 'bg-gold/15 text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
              >
                <Link2 size={14} />
                Paste URL
              </button>
            </div>
          )}

          {user && mode === 'picker' ? (
            <div ref={dropdownRef} className="relative max-w-xl mx-auto">
              <div
                className="flex items-center gap-2 px-4 py-3 rounded-lg bg-navy border border-sky-border text-sky-white cursor-pointer hover:border-gold/40 transition-colors"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                <Search size={16} className="text-sky-muted shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
                  onClick={(e) => { e.stopPropagation(); setShowDropdown(true); }}
                  placeholder="Search your repos..."
                  className="flex-1 bg-transparent outline-none placeholder-sky-muted text-sm"
                  disabled={loading}
                />
                <ChevronDown size={16} className={`text-sky-muted transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </div>

              {showDropdown && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-lg bg-navy border border-sky-border shadow-2xl max-h-80 overflow-y-auto">
                  {reposLoading ? (
                    <div className="px-4 py-6 text-center text-sky-muted text-sm">
                      <span className="inline-block w-4 h-4 border-2 border-sky-muted/30 border-t-sky-muted rounded-full animate-spin mr-2" />
                      Loading your repos...
                    </div>
                  ) : needsRelogin ? (
                    <div className="px-4 py-6 text-center text-sm space-y-2">
                      <p className="text-sky-muted">GitHub access needs to be refreshed.</p>
                      <button
                        onClick={() => login('github')}
                        className="text-gold hover:text-gold-dim underline underline-offset-2 transition-colors"
                      >
                        Sign in again to load your repos
                      </button>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sky-muted text-sm">
                      {search ? 'No repos match your search' : 'No repos found'}
                    </div>
                  ) : (
                    filtered.map((repo) => (
                      <button
                        key={repo.full_name}
                        onClick={() => selectRepo(repo)}
                        disabled={loading}
                        className="w-full text-left px-4 py-3 hover:bg-gold/5 border-b border-sky-border/30 last:border-b-0 transition-colors disabled:opacity-50 group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-sky-white group-hover:text-gold transition-colors truncate">
                            {repo.full_name}
                          </span>
                          {repo.private && <Lock size={12} className="text-sky-muted shrink-0" />}
                          {repo.stargazers_count > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-sky-muted shrink-0">
                              <Star size={10} /> {repo.stargazers_count}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {repo.language && (
                            <span className="text-xs text-sky-muted">{repo.language}</span>
                          )}
                          {repo.description && (
                            <span className="text-xs text-sky-muted truncate">{repo.description}</span>
                          )}
                          <span className="text-xs text-sky-muted/60 shrink-0 ml-auto">{timeAgo(repo.updated_at)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {loading && (
                <div className="mt-3 flex items-center justify-center gap-2 text-gold text-sm">
                  <span className="w-4 h-4 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
                  Analyzing...
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex gap-2 max-w-xl mx-auto">
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="flex-1 px-4 py-3 rounded-lg bg-navy border border-sky-border text-sky-white placeholder-sky-muted focus:outline-none focus:ring-2 focus:ring-gold/40 focus:border-gold/50 transition-all"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !repoUrl.trim()}
                className="px-6 py-3 rounded-lg bg-gold text-midnight font-semibold hover:bg-gold-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
                    Analyzing...
                  </span>
                ) : (
                  <>Analyze My App</>
                )}
              </button>
            </form>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          {(!user || mode === 'url') && (
            <div className="text-sm text-sky-muted">
              Try an example:
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => { setRepoUrl(ex.url); analyze(ex.url); }}
                  disabled={loading}
                  className="ml-2 text-gold hover:text-gold-dim underline underline-offset-2 transition-colors disabled:opacity-50"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-4 pt-6">
            <div className="p-5 rounded-xl bg-navy border border-sky-border/50 text-left">
              <CheckCircle2 size={20} className="text-emerald-400 mb-3" />
              <h3 className="font-medium text-sky-white text-sm mb-1">Readiness Score</h3>
              <p className="text-xs text-sky-muted">See exactly what's ready and what's missing — auth, database, tests, and more.</p>
            </div>
            <div className="p-5 rounded-xl bg-navy border border-sky-border/50 text-left">
              <ClipboardList size={20} className="text-gold mb-3" />
              <h3 className="font-medium text-sky-white text-sm mb-1">Plan to Ship</h3>
              <p className="text-xs text-sky-muted">Step-by-step plan with context files and Cursor prompts for each thing you need to add.</p>
            </div>
            <div className="p-5 rounded-xl bg-navy border border-sky-border/50 text-left">
              <Rocket size={20} className="text-star mb-3" />
              <h3 className="font-medium text-sky-white text-sm mb-1">One-Click Deploy</h3>
              <p className="text-xs text-sky-muted">When you're ready, deploy to production with a single click. No config needed.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-sky-muted border-t border-sky-border/50">
        Takeoff &middot; From vibe code to production
      </footer>
    </div>
  );
}
