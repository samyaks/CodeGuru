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
        <div className="max-w-3xl w-full text-center space-y-10">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-medium">
              <Zap size={12} />
              Analyze &middot; Plan &middot; Deploy
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-tight gradient-text">
              Your Vibe, Flight-Ready.
            </h1>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
              {user
                ? 'Select a repo below or paste any GitHub URL to get started.'
                : 'Drop your repo. We\'ll handle the boring stuff so you can focus on the business.'}
            </p>
          </div>

          {user && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <button
                onClick={() => setMode('picker')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${mode === 'picker' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'text-zinc-400 hover:text-zinc-100'}`}
              >
                My Repos
              </button>
              <button
                onClick={() => setMode('url')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${mode === 'url' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'text-zinc-400 hover:text-zinc-100'}`}
              >
                <Link2 size={14} />
                Paste URL
              </button>
            </div>
          )}

          {user && mode === 'picker' ? (
            <div ref={dropdownRef} className="relative max-w-xl mx-auto">
              <div
                className="glass flex items-center gap-2 px-4 py-3 rounded-xl text-zinc-100 cursor-pointer hover:border-sky-500/40 transition-colors"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                <Search size={16} className="text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
                  onClick={(e) => { e.stopPropagation(); setShowDropdown(true); }}
                  placeholder="Search your repos..."
                  className="flex-1 bg-transparent outline-none placeholder-zinc-500 text-sm"
                  disabled={loading}
                />
                <ChevronDown size={16} className={`text-zinc-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </div>

              {showDropdown && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-xl glass shadow-2xl max-h-80 overflow-y-auto">
                  {reposLoading ? (
                    <div className="px-4 py-6 text-center text-zinc-400 text-sm">
                      <span className="inline-block w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin mr-2" />
                      Loading your repos...
                    </div>
                  ) : needsRelogin ? (
                    <div className="px-4 py-6 text-center text-sm space-y-2">
                      <p className="text-zinc-400">GitHub access needs to be refreshed.</p>
                      <button
                        onClick={() => login('github')}
                        className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
                      >
                        Sign in again to load your repos
                      </button>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="px-4 py-6 text-center text-zinc-400 text-sm">
                      {search ? 'No repos match your search' : 'No repos found'}
                    </div>
                  ) : (
                    filtered.map((repo) => (
                      <button
                        key={repo.full_name}
                        onClick={() => selectRepo(repo)}
                        disabled={loading}
                        className="w-full text-left px-4 py-3 hover:bg-sky-500/5 border-b border-zinc-700/30 last:border-b-0 transition-colors disabled:opacity-50 group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-zinc-100 group-hover:text-sky-400 transition-colors truncate">
                            {repo.full_name}
                          </span>
                          {repo.private && <Lock size={12} className="text-zinc-500 shrink-0" />}
                          {repo.stargazers_count > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-zinc-500 shrink-0">
                              <Star size={10} /> {repo.stargazers_count}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {repo.language && (
                            <span className="text-xs text-zinc-500">{repo.language}</span>
                          )}
                          {repo.description && (
                            <span className="text-xs text-zinc-500 truncate">{repo.description}</span>
                          )}
                          <span className="text-xs text-zinc-600 shrink-0 ml-auto">{timeAgo(repo.updated_at)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {loading && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sky-400 text-sm">
                  <span className="w-4 h-4 border-2 border-sky-500/30 border-t-sky-400 rounded-full animate-spin" />
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
                className="flex-1 px-4 py-3 rounded-xl glass text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/50 transition-all"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !repoUrl.trim()}
                className="px-6 py-3 rounded-xl bg-sky-500 text-black font-bold hover:bg-sky-400 transition-all btn-glow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Analyzing...
                  </span>
                ) : (
                  <>Analyze My App</>
                )}
              </button>
            </form>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
              {error}
            </div>
          )}

          {(!user || mode === 'url') && (
            <div className="text-sm text-zinc-500">
              Try an example:
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => { setRepoUrl(ex.url); analyze(ex.url); }}
                  disabled={loading}
                  className="ml-2 text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors disabled:opacity-50"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-4 pt-6">
            <div className="glass p-6 rounded-2xl text-left">
              <CheckCircle2 size={20} className="text-emerald-400 mb-3" />
              <h3 className="font-bold text-zinc-100 text-sm mb-1">Readiness Score</h3>
              <p className="text-xs text-zinc-500">See exactly what's ready and what's missing — auth, database, tests, and more.</p>
            </div>
            <div className="glass p-6 rounded-2xl text-left">
              <ClipboardList size={20} className="text-sky-400 mb-3" />
              <h3 className="font-bold text-zinc-100 text-sm mb-1">Plan to Ship</h3>
              <p className="text-xs text-zinc-500">Step-by-step plan with context files and Cursor prompts for each thing you need to add.</p>
            </div>
            <div className="glass p-6 rounded-2xl text-left">
              <Rocket size={20} className="text-zinc-400 mb-3" />
              <h3 className="font-bold text-zinc-100 text-sm mb-1">One-Click Deploy</h3>
              <p className="text-xs text-zinc-500">When you're ready, deploy to production with a single click. No config needed.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-zinc-600 border-t border-zinc-800/60">
        Takeoff &middot; From vibe code to production
      </footer>
    </div>
  );
}
