import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Zap, Search, Lock, Star, ChevronDown, Link2, Rocket } from 'lucide-react';
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

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24 relative overflow-hidden">
        {/* Grid background */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(#dddbd4 1px, transparent 1px), linear-gradient(90deg, #dddbd4 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          opacity: 0.4,
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, transparent 30%, #fafaf8 75%)',
        }} />

        <div className="max-w-3xl w-full text-center space-y-10 relative z-10">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 border border-gold/40 bg-gold/[0.08] font-mono text-[0.58rem] tracking-[0.25em] uppercase text-gold">
              <span className="w-[5px] h-[5px] rounded-full bg-gold flex-shrink-0" />
              Now in early access
            </div>
            <h1 className="font-serif font-light text-[clamp(3.2rem,8vw,6.5rem)] leading-[0.98] tracking-[-0.025em] text-ink">
              You built it.<br />Now <em className="italic text-gold">ship</em> it.
            </h1>
            <p className="font-serif italic font-light text-[clamp(1rem,2vw,1.35rem)] text-sky-muted max-w-lg mx-auto leading-relaxed">
              {user
                ? 'Select a repo below or paste any GitHub URL to get started.'
                : 'The missing last mile for AI-built apps — auth, database, payments, deploy. One click.'}
            </p>
          </div>

          {user && (
            <div className="flex items-center justify-center gap-2 text-sm">
              <button
                onClick={() => setMode('picker')}
                className={`px-3 py-1.5 rounded-lg transition-colors font-mono text-xs tracking-wider uppercase ${mode === 'picker' ? 'bg-gold/[0.08] text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
              >
                My Repos
              </button>
              <button
                onClick={() => setMode('url')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-mono text-xs tracking-wider uppercase ${mode === 'url' ? 'bg-gold/[0.08] text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
              >
                <Link2 size={14} />
                Paste URL
              </button>
            </div>
          )}

          {user && mode === 'picker' ? (
            <div ref={dropdownRef} className="relative max-w-xl mx-auto">
              <div
                className="glass flex items-center gap-2 px-4 py-3 rounded-lg text-sky-white cursor-pointer hover:border-gold/40 transition-colors"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                <Search size={16} className="text-sky-muted shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
                  onClick={(e) => { e.stopPropagation(); setShowDropdown(true); }}
                  placeholder="Search your repos..."
                  className="flex-1 bg-transparent outline-none placeholder-sky-muted text-sm font-sans"
                  disabled={loading}
                />
                <ChevronDown size={16} className={`text-sky-muted transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
              </div>

              {showDropdown && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-lg glass shadow-lg max-h-80 overflow-y-auto">
                  {reposLoading ? (
                    <div className="px-4 py-6 text-center text-sky-muted text-sm">
                      <span className="inline-block w-4 h-4 border-2 border-sky-border border-t-sky-muted rounded-full animate-spin mr-2" />
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
                        className="w-full text-left px-4 py-3 hover:bg-navy-mid border-b border-sky-border/30 last:border-b-0 transition-colors disabled:opacity-50 group"
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
                          <span className="text-xs text-border-dark shrink-0 ml-auto">{timeAgo(repo.updated_at)}</span>
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
                className="flex-1 px-4 py-3.5 glass text-ink placeholder-sky-muted focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold/50 transition-all text-sm font-mono"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !repoUrl.trim()}
                className="px-6 py-3.5 bg-ink text-paper font-mono text-[0.68rem] tracking-[0.18em] uppercase hover:bg-sky-off transition-all btn-glow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-paper/30 border-t-paper rounded-full animate-spin" />
                    Analyzing...
                  </span>
                ) : (
                  <>Analyze</>
                )}
              </button>
            </form>
          )}

          {error && (
            <div className="text-red-600 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          {(!user || mode === 'url') && (
            <div className="text-sm text-sky-muted font-mono text-xs tracking-wide">
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

          <div className="grid sm:grid-cols-3 gap-[1px] bg-sky-border pt-6">
            <div className="bg-midnight p-8 text-left hover:bg-navy transition-colors group">
              <CheckCircle2 size={20} className="text-gold mb-4" />
              <h3 className="font-serif text-lg font-normal text-ink mb-2">Readiness Score</h3>
              <p className="text-sm text-sky-muted leading-relaxed">See exactly what's ready and what's missing — auth, database, tests, and more.</p>
            </div>
            <div className="bg-midnight p-8 text-left hover:bg-navy transition-colors group">
              <ClipboardList size={20} className="text-gold mb-4" />
              <h3 className="font-serif text-lg font-normal text-ink mb-2">Plan to Ship</h3>
              <p className="text-sm text-sky-muted leading-relaxed">Step-by-step plan with context files and Cursor prompts for each thing you need to add.</p>
            </div>
            <div className="bg-midnight p-8 text-left hover:bg-navy transition-colors group">
              <Rocket size={20} className="text-gold mb-4" />
              <h3 className="font-serif text-lg font-normal text-ink mb-2">One-Click Deploy</h3>
              <p className="text-sm text-sky-muted leading-relaxed">When you're ready, deploy to production with a single click. No config needed.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center py-6 font-mono text-[0.56rem] tracking-[0.08em] text-border-dark border-t border-sky-border">
        Takeoff &middot; From vibe code to production
      </footer>
    </div>
  );
}
