import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Search,
  Lock,
  Star,
  ChevronDown,
  Rocket,
  FolderUp,
  Github,
  Map,
  ArrowLeft,
} from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';
import { startTakeoff, startTakeoffUpload, fetchMyRepos, GitHubRepo } from '../services/api';
import { Button, DotGridBg } from '../components/ui';

const EXAMPLES = [
  { label: 'shadcn/taxonomy', url: 'https://github.com/shadcn-ui/taxonomy' },
  { label: 'excalidraw', url: 'https://github.com/excalidraw/excalidraw' },
  { label: 'cal.com', url: 'https://github.com/calcom/cal.com' },
];

type Mode = 'connect' | 'picker' | 'url' | 'upload';

export default function Landing() {
  const navigate = useNavigate();
  const { user, login } = useAuth();

  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When signed in we default to the repo picker; otherwise we lead with the
  // GitHub connect CTA (kit's `mode==='github'`).
  const [mode, setMode] = useState<Mode>(user ? 'picker' : 'connect');

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProjectName, setUploadProjectName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [needsRelogin, setNeedsRelogin] = useState(false);
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && mode === 'connect') setMode('picker');
  }, [user, mode]);

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
    return (
      r.full_name.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.language || '').toLowerCase().includes(q)
    );
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

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(files);
    const firstPath = files[0].webkitRelativePath || files[0].name;
    const topDir = firstPath.split('/')[0];
    if (topDir) setUploadProjectName(topDir);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    try {
      const items = Array.from(e.dataTransfer.items);
      const files: File[] = [];

      const entries: FileSystemEntry[] = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }

      async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
        const all: FileSystemEntry[] = [];
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          all.push(...batch);
        } while (batch.length > 0);
        return all;
      }

      async function readEntry(entry: FileSystemEntry, path: string): Promise<void> {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => {
            (entry as FileSystemFileEntry).file(resolve, reject);
          });
          const newFile = new File([file], path + file.name, { type: file.type });
          files.push(newFile);
        } else if (entry.isDirectory) {
          const dirReader = (entry as FileSystemDirectoryEntry).createReader();
          const subEntries = await readAllEntries(dirReader);
          for (const subEntry of subEntries) {
            await readEntry(subEntry, path + entry.name + '/');
          }
        }
      }

      for (const entry of entries) {
        await readEntry(entry, '');
      }

      if (files.length > 0) {
        setSelectedFiles(files);
        const topDir = entries[0]?.name;
        if (topDir) setUploadProjectName(topDir);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to read dropped files');
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const { projectId } = await startTakeoffUpload(
        selectedFiles,
        uploadProjectName || 'My Project',
      );
      navigate(`/takeoff/${projectId}`);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setLoading(false);
    }
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

  const features = [
    {
      icon: <Map size={17} className="text-brand" />,
      title: 'Product Map',
      body: "Jobs and personas scored against your codebase — see what users actually need.",
    },
    {
      icon: <CheckCircle2 size={17} className="text-brand" />,
      title: 'Readiness Score',
      body: 'Weighted by real user impact, not just technical completeness.',
    },
    {
      icon: <Rocket size={17} className="text-brand -rotate-45" />,
      title: 'One-Click Deploy',
      body: 'From analysis to live URL. Env vars set automatically.',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-page">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24 pt-10 relative">
        <DotGridBg />

        <div className="max-w-[560px] w-full text-center relative z-10">
          {/* Early-access pill */}
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-amber-border bg-amber-bg text-xs font-medium text-amber-fg mb-6">
            <span className="w-[5px] h-[5px] rounded-full bg-amber animate-ds-pulse" />
            Now in early access
          </div>

          {/* Hero */}
          <h1
            className="font-extrabold text-text mb-4"
            style={{
              fontSize: 'clamp(2.2rem, 5vw, 3.6rem)',
              letterSpacing: '-0.05em',
              lineHeight: 1.05,
            }}
          >
            You built it,
            <br />
            <span className="text-amber">now let&rsquo;s ship it.</span>
          </h1>
          <p className="text-base text-text-muted max-w-[400px] mx-auto leading-relaxed mb-9">
            {user
              ? 'Pick a repo from your GitHub, paste a URL, or upload a folder. We will analyze the code and tell you exactly what to build next.'
              : "Connect your GitHub repo. We'll analyze the code, map it to your users' needs, and tell you exactly what to build next."}
          </p>

          {/* ── Connect GitHub (default for signed-out users) ── */}
          {mode === 'connect' && (
            <div className="flex flex-col items-center gap-3.5">
              <Button
                size="lg"
                onClick={() => login('github')}
                className="w-full max-w-[320px]"
              >
                <Github size={18} />
                Connect GitHub
              </Button>
              <div className="flex items-center gap-3 text-[13px] text-text-faint">
                <button
                  onClick={() => setMode('url')}
                  className="underline underline-offset-[3px] hover:text-text-muted transition-colors"
                >
                  or paste a public repo URL
                </button>
                <span className="text-text-disabled" aria-hidden>
                  ·
                </span>
                <button
                  onClick={() => setMode('upload')}
                  className="underline underline-offset-[3px] hover:text-text-muted transition-colors"
                >
                  upload a folder
                </button>
              </div>
            </div>
          )}

          {/* ── Repo picker (signed-in default) ── */}
          {mode === 'picker' && (
            <div className="max-w-[480px] mx-auto">
              <div className="flex items-center gap-1.5 mb-3 px-3.5 py-2 bg-success-bg border border-success-border rounded-[9px] text-[13px] text-success font-medium">
                <CheckCircle2 size={14} strokeWidth={2.5} />
                GitHub connected — pick a repo to analyze
              </div>

              <div ref={dropdownRef} className="relative text-left">
                <div
                  className="flex items-center gap-2 bg-surface border border-line rounded-[10px] px-3.5 py-2.5 shadow-card cursor-text"
                  onClick={() => setShowDropdown(true)}
                >
                  <Search size={16} className="text-text-faint shrink-0" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setShowDropdown(true);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDropdown(true);
                    }}
                    placeholder="Search your repos..."
                    className="flex-1 bg-transparent outline-none text-[13px] text-text placeholder:text-text-faint"
                    disabled={loading}
                  />
                  <ChevronDown
                    size={16}
                    className={`text-text-faint transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                  />
                </div>

                {showDropdown && (
                  <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-surface border border-line rounded-xl overflow-hidden z-50 shadow-card-hov max-h-80 overflow-y-auto">
                    {reposLoading ? (
                      <div className="px-4 py-6 text-center text-text-muted text-sm">
                        <span className="inline-block w-4 h-4 border-2 border-line border-t-text-muted rounded-full animate-spin mr-2 align-middle" />
                        Loading your repos...
                      </div>
                    ) : needsRelogin ? (
                      <div className="px-4 py-6 text-center text-sm space-y-2">
                        <p className="text-text-muted">GitHub access needs to be refreshed.</p>
                        <button
                          onClick={() => login('github')}
                          className="text-brand hover:text-brand-hov underline underline-offset-2 transition-colors"
                        >
                          Sign in again to load your repos
                        </button>
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-text-muted text-sm">
                        {search ? 'No repos match your search' : 'No repos found'}
                      </div>
                    ) : (
                      filtered.map((repo) => (
                        <button
                          key={repo.full_name}
                          onClick={() => selectRepo(repo)}
                          disabled={loading}
                          className="w-full text-left px-4 py-3 hover:bg-page border-b border-divider last:border-b-0 transition-colors disabled:opacity-50 group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[13px] text-text group-hover:text-brand transition-colors truncate">
                              {repo.full_name}
                            </span>
                            {repo.private && <Lock size={12} className="text-text-faint shrink-0" />}
                            {repo.stargazers_count > 0 && (
                              <span className="flex items-center gap-0.5 text-[11px] text-text-faint shrink-0">
                                <Star size={10} /> {repo.stargazers_count}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            {repo.language && (
                              <span className="text-[11px] text-text-muted">{repo.language}</span>
                            )}
                            {repo.description && (
                              <span className="text-[11px] text-text-faint truncate">
                                {repo.description}
                              </span>
                            )}
                            <span className="text-[11px] text-text-disabled shrink-0 ml-auto">
                              {timeAgo(repo.updated_at)}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {loading && (
                <div className="mt-3 flex items-center justify-center gap-2 text-brand text-sm">
                  <span className="w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                  Analyzing...
                </div>
              )}

              <div className="mt-4 flex items-center justify-center gap-3 text-[13px] text-text-faint">
                <button
                  onClick={() => setMode('url')}
                  className="underline underline-offset-[3px] hover:text-text-muted transition-colors"
                >
                  paste a URL
                </button>
                <span className="text-text-disabled" aria-hidden>
                  ·
                </span>
                <button
                  onClick={() => setMode('upload')}
                  className="underline underline-offset-[3px] hover:text-text-muted transition-colors"
                >
                  upload a folder
                </button>
              </div>
            </div>
          )}

          {/* ── Paste URL ── */}
          {mode === 'url' && (
            <div className="max-w-[480px] mx-auto text-left">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  disabled={loading}
                  className="flex-1 px-4 py-3 rounded-[10px] bg-surface border border-line text-text text-[13px] font-mono outline-none shadow-card focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
                />
                <Button type="submit" disabled={loading || !repoUrl.trim()}>
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    'Analyze'
                  )}
                </Button>
              </form>
              <div className="mt-3 text-[13px] text-text-faint">
                Try:
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setRepoUrl(ex.url);
                      analyze(ex.url);
                    }}
                    disabled={loading}
                    className="ml-1.5 text-brand hover:text-brand-hov underline underline-offset-2 transition-colors disabled:opacity-50"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setMode(user ? 'picker' : 'connect')}
                className="mt-4 inline-flex items-center gap-1 text-[13px] text-text-faint hover:text-text-muted underline underline-offset-[3px] transition-colors"
              >
                <ArrowLeft size={12} />
                {user ? 'Back to my repos' : 'Connect GitHub instead'}
              </button>
            </div>
          )}

          {/* ── Upload folder ── */}
          {mode === 'upload' && (
            <div className="max-w-[480px] mx-auto text-left space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                }}
                onDrop={handleDrop}
                onClick={() => folderInputRef.current?.click()}
                className={[
                  'rounded-[14px] p-10 text-center cursor-pointer transition-all border bg-surface shadow-card',
                  dragOver ? 'border-brand bg-brand-tint' : 'border-line hover:border-brand',
                ].join(' ')}
              >
                <FolderUp size={32} className="text-brand mx-auto mb-3" />
                <p className="text-sm text-text font-semibold mb-1">
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} files selected`
                    : 'Drop a folder here or click to browse'}
                </p>
                <p className="text-xs text-text-muted">
                  {selectedFiles.length > 0
                    ? uploadProjectName || 'Ready to analyze'
                    : "Select your project folder \u2014 we'll analyze it locally"}
                </p>
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-expect-error webkitdirectory is not in React types
                  webkitdirectory=""
                  directory=""
                  multiple
                  className="hidden"
                  onChange={handleFolderSelect}
                />
              </div>
              {selectedFiles.length > 0 && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={uploadProjectName}
                    onChange={(e) => setUploadProjectName(e.target.value)}
                    placeholder="Project name (optional)"
                    className="flex-1 px-4 py-3 rounded-[10px] bg-surface border border-line text-text placeholder:text-text-faint outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 text-sm transition-all"
                  />
                  <Button onClick={handleUpload} disabled={loading}>
                    {loading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Uploading {selectedFiles.length} files...
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </Button>
                </div>
              )}
              <button
                onClick={() => setMode(user ? 'picker' : 'connect')}
                className="inline-flex items-center gap-1 text-[13px] text-text-faint hover:text-text-muted underline underline-offset-[3px] transition-colors"
              >
                <ArrowLeft size={12} />
                {user ? 'Back to my repos' : 'Connect GitHub instead'}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-5 max-w-[480px] mx-auto text-danger text-sm bg-danger-bg border border-danger-border rounded-lg px-4 py-2 text-left">
              {error}
            </div>
          )}

          {/* ── Feature strip ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-13" style={{ marginTop: 52 }}>
            {features.map((card) => (
              <div
                key={card.title}
                className="bg-surface border border-line rounded-[14px] px-4 py-4.5 text-left shadow-card transition-all hover:border-brand hover:-translate-y-px hover:shadow-card-hov"
                style={{ padding: '18px 16px' }}
              >
                <div className="w-[34px] h-[34px] rounded-lg bg-surface-2 flex items-center justify-center mb-3">
                  {card.icon}
                </div>
                <div className="text-[13px] font-semibold text-text mb-1">{card.title}</div>
                <div className="text-xs text-text-muted leading-relaxed">{card.body}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="text-center py-4 text-xs text-text-faint border-t border-line bg-page">
        Takeoff &middot; From vibe code to production
      </footer>
    </div>
  );
}
