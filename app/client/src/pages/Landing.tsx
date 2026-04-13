import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Search, Lock, Star, ChevronDown, Link2, Rocket, FolderUp } from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../hooks/useAuth';
import { startTakeoff, startTakeoffUpload, fetchMyRepos, GitHubRepo } from '../services/api';

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
  const [mode, setMode] = useState<'picker' | 'url' | 'upload'>(user ? 'picker' : 'url');
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
      const { projectId } = await startTakeoffUpload(selectedFiles, uploadProjectName || 'My Project');
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24 relative overflow-hidden">
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(63,63,70,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(63,63,70,0.15) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, transparent 30%, #050505 75%)',
        }} />

        <div className="max-w-3xl w-full text-center space-y-10 relative z-10">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-gold/30 bg-gold/[0.08] text-xs font-medium text-gold">
              <span className="w-[5px] h-[5px] rounded-full bg-gold animate-pulse flex-shrink-0" />
              Now in early access
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-[1.05] gradient-text">
              You built it,<br />now let's ship it!
            </h1>
            <p className="text-lg text-sky-muted max-w-lg mx-auto leading-relaxed">
              {user
                ? 'Select a repo, paste a URL, or upload a folder to get started.'
                : 'Paste a GitHub URL or upload your project folder to get started.'}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-sm">
            {user && (
              <button
                onClick={() => setMode('picker')}
                className={`px-4 py-1.5 rounded-lg transition-colors text-sm font-medium ${mode === 'picker' ? 'bg-gold/[0.12] text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
              >
                My Repos
              </button>
            )}
            <button
              onClick={() => setMode('url')}
              className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium ${mode === 'url' ? 'bg-gold/[0.12] text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
            >
              <Link2 size={14} />
              Paste URL
            </button>
            <button
              onClick={() => setMode('upload')}
              className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium ${mode === 'upload' ? 'bg-gold/[0.12] text-gold border border-gold/30' : 'text-sky-muted hover:text-sky-white'}`}
            >
              <FolderUp size={14} />
              Upload Folder
            </button>
          </div>

          {mode === 'upload' ? (
            <div className="max-w-xl mx-auto space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                onDrop={handleDrop}
                onClick={() => folderInputRef.current?.click()}
                className={`glass rounded-xl p-10 text-center cursor-pointer transition-all ${
                  dragOver ? 'border-gold/50 bg-gold/[0.05]' : 'hover:border-gold/30'
                }`}
              >
                <FolderUp size={32} className="text-gold mx-auto mb-3" />
                <p className="text-sm text-sky-white font-medium mb-1">
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} files selected`
                    : 'Drop a folder here or click to browse'}
                </p>
                <p className="text-xs text-sky-muted">
                  {selectedFiles.length > 0
                    ? uploadProjectName || 'Ready to analyze'
                    : 'Select your project folder \u2014 we\'ll analyze it locally'}
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
                    className="flex-1 px-4 py-3 rounded-xl glass text-sky-white placeholder-sky-muted focus:outline-none focus:ring-2 focus:ring-gold/30 text-sm"
                  />
                  <button
                    onClick={handleUpload}
                    disabled={loading}
                    className="px-6 py-3 rounded-xl bg-gold text-midnight font-semibold text-sm hover:bg-gold-dim transition-all btn-glow disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
                        Uploading {selectedFiles.length} files...
                      </span>
                    ) : 'Analyze'}
                  </button>
                </div>
              )}
            </div>
          ) : user && mode === 'picker' ? (
            <div ref={dropdownRef} className="relative max-w-xl mx-auto">
              <div
                className="glass flex items-center gap-2 px-4 py-3 rounded-xl text-sky-white cursor-pointer hover:border-gold/40 transition-colors"
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
                <div className="absolute z-50 top-full mt-1 w-full rounded-xl glass shadow-lg max-h-80 overflow-y-auto">
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
                className="flex-1 px-4 py-3.5 rounded-xl glass text-sky-white placeholder-sky-muted focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold/50 transition-all text-sm font-mono"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !repoUrl.trim()}
                className="px-6 py-3.5 rounded-xl bg-gold text-midnight font-semibold text-sm hover:bg-gold-dim transition-all btn-glow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-midnight/30 border-t-midnight rounded-full animate-spin" />
                    Analyzing...
                  </span>
                ) : (
                  <>Analyze</>
                )}
              </button>
            </form>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
              {error}
            </div>
          )}

          {mode === 'url' && (
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
            <div className="glass rounded-xl p-6 text-left hover:border-gold/30 transition-all group">
              <CheckCircle2 size={20} className="text-gold mb-4" />
              <h3 className="text-base font-semibold text-sky-white mb-2">Readiness Score</h3>
              <p className="text-sm text-sky-muted leading-relaxed">See exactly what's ready and what's missing — auth, database, tests, and more.</p>
            </div>
            <div className="glass rounded-xl p-6 text-left hover:border-gold/30 transition-all group">
              <ClipboardList size={20} className="text-gold mb-4" />
              <h3 className="text-base font-semibold text-sky-white mb-2">Plan to Ship</h3>
              <p className="text-sm text-sky-muted leading-relaxed">Step-by-step plan with context files and Cursor prompts for each thing you need to add.</p>
            </div>
            <div className="glass rounded-xl p-6 text-left hover:border-gold/30 transition-all group">
              <Rocket size={20} className="text-gold mb-4" />
              <h3 className="text-base font-semibold text-sky-white mb-2">One-Click Deploy</h3>
              <p className="text-sm text-sky-muted leading-relaxed">When you're ready, deploy to production with a single click. No config needed.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-sky-muted border-t border-sky-border">
        Takeoff &middot; From vibe code to production
      </footer>
    </div>
  );
}
