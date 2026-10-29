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
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageMeta from '../components/marketing/PageMeta';
import FaqAccordion from '../components/marketing/FaqAccordion';
import CtaBand from '../components/marketing/CtaBand';
import { MARKETING_FAQ, STACK_LOGOS } from '../components/marketing/marketingContent';
import { useAuth } from '../hooks/useAuth';
import { startTakeoff, startTakeoffUpload, fetchMyRepos, summarizeUploadFiles, GitHubRepo } from '../services/api';
import { AnalysisConfirmModal, type AnalysisConfirmSource } from '../components/v2';
import {
  classifyRepoAccessError,
  repoAccessErrorCopy,
} from '../lib/repo-access-error';

const EXAMPLES = [
  { label: 'shadcn/taxonomy', url: 'https://github.com/shadcn-ui/taxonomy' },
  { label: 'excalidraw', url: 'https://github.com/excalidraw/excalidraw' },
  { label: 'cal.com', url: 'https://github.com/calcom/cal.com' },
];

type Mode = 'connect' | 'picker' | 'url' | 'upload';

// Primary CTA used across modes. Stone-900 on stone-50 is the v2 detail-page
// idiom; full-width is opt-in via className so we can drop it inline next
// to text inputs in the URL/Upload forms without breaking the layout.
function PrimaryButton({
  type = 'button',
  onClick,
  disabled,
  className = '',
  children,
}: {
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 bg-stone-900 text-stone-50 hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded px-5 py-2.5 text-sm font-medium ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { user, login } = useAuth();

  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSource, setConfirmSource] = useState<AnalysisConfirmSource | null>(null);

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
    setError(null);
    setConfirmSource({ kind: 'repo', repoUrl: url, label: url.replace(/^https?:\/\/github\.com\//i, '') });
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
    const stats = summarizeUploadFiles(selectedFiles);
    if (stats.fileCount === 0) {
      setError('No uploadable source files found in the selected folder');
      return;
    }
    setError(null);
    setConfirmSource({
      kind: 'upload',
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      label: uploadProjectName || 'Uploaded folder',
    });
  };

  const handleConfirmAnalysis = async (modelId: string) => {
    if (!confirmSource) return;
    setLoading(true);
    setError(null);
    try {
      if (confirmSource.kind === 'repo') {
        const { projectId } = await startTakeoff(confirmSource.repoUrl, { model: modelId });
        navigate(`/takeoff/${projectId}`);
        return;
      }
      if (confirmSource.kind === 'upload') {
        const { projectId } = await startTakeoffUpload(
          selectedFiles,
          uploadProjectName || 'My Project',
          { model: modelId },
        );
        navigate(`/takeoff/${projectId}`);
        return;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start analysis';
      setError(message);
      setLoading(false);
      throw err;
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

  // Feature strip beneath the hero. Icons share the stone-900 accent so the
  // page reads as a single design system rather than three accent colors.
  const features = [
    {
      icon: <Map className="w-4 h-4 text-stone-900" />,
      title: 'Product Map',
      body: "Jobs and personas scored against your codebase — see what users actually need.",
    },
    {
      icon: <CheckCircle2 className="w-4 h-4 text-stone-900" />,
      title: 'Readiness Score',
      body: 'Weighted by real user impact, not just technical completeness.',
    },
    {
      icon: <Rocket className="w-4 h-4 text-stone-900 -rotate-45" />,
      title: 'One-Click Deploy',
      body: 'From analysis to live URL. Env vars set automatically.',
    },
  ];

  return (
    <>
      <PageMeta
        title="Takeoff — From vibe code to production"
        description="Analyze your GitHub repo, map it to user needs, and get AI context files to finish the last 40% of your app."
      />

      <div className="flex flex-col items-center px-6 pb-16 pt-10">
        <div id="analyze" className="max-w-[640px] w-full text-center">
          {/* Early-access pill */}
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-xs font-medium text-amber-700 mb-8">
            <span className="w-[5px] h-[5px] rounded-full bg-amber-500 animate-pulse" />
            Now in early access
          </div>

          {/* Hero */}
          <h1
            className="font-bold text-stone-900 tracking-tight mb-5 v2-font-serif"
            style={{
              fontSize: 'clamp(2.4rem, 5.5vw, 4rem)',
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
            }}
          >
            You built it,
            <br />
            <span className="text-amber-600">now let&rsquo;s ship it.</span>
          </h1>
          <p className="text-base text-stone-600 max-w-[440px] mx-auto leading-relaxed mb-10">
            {user
              ? 'Pick a repo from your GitHub, paste a URL, or upload a folder. We will analyze the code and tell you exactly what to build next.'
              : "Connect your GitHub repo. We'll analyze the code, map it to your users' needs, and tell you exactly what to build next."}
          </p>

          {/* ── Connect GitHub (default for signed-out users) ── */}
          {mode === 'connect' && (
            <div className="flex flex-col items-center gap-4">
              <PrimaryButton
                onClick={() => login('github')}
                className="w-full max-w-[320px] !py-3 !text-base"
              >
                <Github className="w-4 h-4" />
                Connect GitHub
              </PrimaryButton>
              <div className="flex items-center gap-3 text-[13px] text-stone-500">
                <button
                  type="button"
                  onClick={() => setMode('url')}
                  className="underline underline-offset-[3px] hover:text-stone-700 transition-colors"
                >
                  or paste a public repo URL
                </button>
                <span className="text-stone-300" aria-hidden>
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => setMode('upload')}
                  className="underline underline-offset-[3px] hover:text-stone-700 transition-colors"
                >
                  upload a folder
                </button>
              </div>
            </div>
          )}

          {/* ── Repo picker (signed-in default) ── */}
          {mode === 'picker' && (
            <div className="max-w-[520px] mx-auto">
              <div className="flex items-center gap-2 mb-4 px-3.5 py-2 bg-emerald-50 border border-emerald-200 rounded text-[13px] text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.5} />
                GitHub connected — pick a repo to analyze
              </div>

              <div ref={dropdownRef} className="relative text-left">
                <div
                  className="flex items-center gap-2 bg-white border border-stone-200 rounded-lg px-3.5 py-3 cursor-text shadow-sm"
                  onClick={() => setShowDropdown(true)}
                >
                  <Search className="w-4 h-4 text-stone-400 shrink-0" />
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
                    className="flex-1 bg-transparent outline-none text-sm text-stone-900 placeholder:text-stone-400"
                    disabled={loading}
                  />
                  <ChevronDown
                    className={`w-4 h-4 text-stone-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                  />
                </div>

                {showDropdown && (
                  <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-stone-200 rounded-lg overflow-hidden z-50 shadow-lg max-h-80 overflow-y-auto">
                    {reposLoading ? (
                      <div className="px-4 py-6 text-center text-stone-600 text-sm">
                        <Loader2 className="inline-block w-4 h-4 animate-spin mr-2 align-middle text-stone-400" />
                        Loading your repos...
                      </div>
                    ) : needsRelogin ? (
                      <div className="px-4 py-6 text-center text-sm space-y-2">
                        <p className="text-stone-600">GitHub access needs to be refreshed.</p>
                        <button
                          type="button"
                          onClick={() => login('github')}
                          className="text-stone-900 hover:text-stone-700 underline underline-offset-2 transition-colors"
                        >
                          Sign in again to load your repos
                        </button>
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-stone-500 text-sm">
                        {search ? 'No repos match your search' : 'No repos found'}
                      </div>
                    ) : (
                      filtered.map((repo) => (
                        <button
                          key={repo.full_name}
                          type="button"
                          onClick={() => selectRepo(repo)}
                          disabled={loading}
                          className="w-full text-left px-4 py-3 hover:bg-stone-50 border-b border-stone-100 last:border-b-0 transition-colors disabled:opacity-50 group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-stone-900 group-hover:text-stone-700 transition-colors truncate">
                              {repo.full_name}
                            </span>
                            {repo.private && <Lock className="w-3 h-3 text-stone-400 shrink-0" />}
                            {repo.stargazers_count > 0 && (
                              <span className="flex items-center gap-0.5 text-[11px] text-stone-500 shrink-0">
                                <Star className="w-2.5 h-2.5" /> {repo.stargazers_count}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            {repo.language && (
                              <span className="text-[11px] text-stone-600">{repo.language}</span>
                            )}
                            {repo.description && (
                              <span className="text-[11px] text-stone-500 truncate">
                                {repo.description}
                              </span>
                            )}
                            <span className="text-[11px] text-stone-300 shrink-0 ml-auto">
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
                <div className="mt-3 flex items-center justify-center gap-2 text-stone-700 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                  Analyzing...
                </div>
              )}

              <div className="mt-5 flex items-center justify-center gap-3 text-[13px] text-stone-500">
                <button
                  type="button"
                  onClick={() => setMode('url')}
                  className="underline underline-offset-[3px] hover:text-stone-700 transition-colors"
                >
                  paste a public URL
                </button>
                <span className="text-stone-300" aria-hidden>
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => setMode('upload')}
                  className="underline underline-offset-[3px] hover:text-stone-700 transition-colors"
                >
                  upload a folder
                </button>
              </div>
            </div>
          )}

          {/* ── Paste URL ── */}
          {mode === 'url' && (
            <div className="max-w-[520px] mx-auto text-left">
              <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3 text-[13px] text-stone-600 leading-relaxed">
                <Lock className="w-3.5 h-3.5 text-stone-500 mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium text-stone-800">
                    Public repos only
                  </p>
                  <p className="mt-0.5">
                    Pasting a URL reads the repo anonymously via the GitHub API.
                    Private repos won&rsquo;t show up — use{' '}
                    <button
                      type="button"
                      onClick={() => setMode(user ? 'picker' : 'connect')}
                      className="underline underline-offset-2 text-stone-900 hover:text-stone-700"
                    >
                      {user ? 'your connected GitHub repos' : 'Connect GitHub'}
                    </button>
                    {' '}or upload a folder.
                  </p>
                </div>
              </div>
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="https://github.com/owner/repo"
                  disabled={loading}
                  aria-describedby="paste-url-hint"
                  className="flex-1 px-4 py-3 rounded-lg bg-white border border-stone-200 text-stone-900 text-sm font-mono outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-100 transition-all shadow-sm"
                />
                <PrimaryButton type="submit" disabled={loading || !repoUrl.trim()}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    'Analyze'
                  )}
                </PrimaryButton>
              </form>
              <p id="paste-url-hint" className="mt-2 text-[12px] text-stone-500">
                Format: https://github.com/owner/repo — must be a public repository.
              </p>
              <div className="mt-3 text-[13px] text-stone-500">
                Try a public example:
                {EXAMPLES.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setRepoUrl(ex.url);
                      analyze(ex.url);
                    }}
                    disabled={loading}
                    className="ml-1.5 text-stone-900 hover:text-stone-700 underline underline-offset-2 transition-colors disabled:opacity-50"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setMode(user ? 'picker' : 'connect')}
                className="mt-4 inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-700 underline underline-offset-[3px] transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                {user ? 'Back to my repos' : 'Connect GitHub instead'}
              </button>
            </div>
          )}

          {/* ── Upload folder ── */}
          {mode === 'upload' && (
            <div className="max-w-[520px] mx-auto text-left space-y-3">
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
                  'rounded-lg p-10 text-center cursor-pointer transition-all border bg-white shadow-sm',
                  dragOver ? 'border-stone-900 bg-stone-50' : 'border-stone-200 hover:border-stone-400',
                ].join(' ')}
              >
                <FolderUp className="w-8 h-8 text-stone-900 mx-auto mb-3" />
                <p className="text-sm text-stone-900 font-semibold mb-1">
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} files selected`
                    : 'Drop a folder here or click to browse'}
                </p>
                <p className="text-xs text-stone-600">
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
                    className="flex-1 px-4 py-3 rounded-lg bg-white border border-stone-200 text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-100 text-sm transition-all shadow-sm"
                  />
                  <PrimaryButton onClick={handleUpload} disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading {selectedFiles.length} files...
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </PrimaryButton>
                </div>
              )}
              <button
                type="button"
                onClick={() => setMode(user ? 'picker' : 'connect')}
                className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-700 underline underline-offset-[3px] transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                {user ? 'Back to my repos' : 'Connect GitHub instead'}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-5 max-w-[520px] mx-auto text-left rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              {(() => {
                const kind = classifyRepoAccessError(error);
                if (!kind || kind === 'other') {
                  return <p className="text-red-700 text-sm">{error}</p>;
                }
                const copy = repoAccessErrorCopy(kind);
                return (
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-red-900">{copy.title}</p>
                    <p className="text-[13px] text-red-800 leading-relaxed">{copy.body}</p>
                    <p className="text-[11px] text-red-700/80 font-mono break-words">{error}</p>
                    {(kind === 'private_or_missing' || kind === 'rate_limit') && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setMode(user ? 'picker' : 'connect');
                        }}
                        className="mt-1 text-[13px] font-medium text-red-950 underline underline-offset-2 hover:text-red-800"
                      >
                        {user ? 'Pick from my GitHub repos' : 'Connect GitHub'}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Feature strip ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-14">
            {features.map((card) => (
              <div
                key={card.title}
                className="bg-white border border-stone-200 rounded-lg p-5 text-left transition-all hover:border-stone-400 hover:shadow-sm"
              >
                <div className="w-9 h-9 rounded bg-stone-100 flex items-center justify-center mb-3">
                  {card.icon}
                </div>
                <div className="text-sm font-semibold text-stone-900 mb-1">{card.title}</div>
                <div className="text-xs text-stone-600 leading-relaxed">{card.body}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-stone-500">
            <Link to="/features" className="underline underline-offset-2 hover:text-stone-700 transition-colors">
              See all features
            </Link>
            {' · '}
            <Link to="/demo" className="underline underline-offset-2 hover:text-stone-700 transition-colors">
              View demo report
            </Link>
          </p>
        </div>

        {/* ── Stacks ── */}
        <div className="max-w-3xl w-full mt-24 text-center">
          <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-4">
            Works with your stack
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {STACK_LOGOS.map((name) => (
              <span
                key={name}
                className="px-3 py-1.5 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-600"
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* ── FAQ ── */}
        <div className="max-w-3xl w-full mt-24">
          <FaqAccordion items={MARKETING_FAQ} />
        </div>

        {/* ── CTA ── */}
        <div className="max-w-3xl w-full mt-24">
          <CtaBand />
        </div>
      </div>

      <AnalysisConfirmModal
        open={confirmSource != null}
        source={confirmSource}
        onClose={() => { if (!loading) setConfirmSource(null); }}
        onConfirm={handleConfirmAnalysis}
      />
    </>
  );
}
