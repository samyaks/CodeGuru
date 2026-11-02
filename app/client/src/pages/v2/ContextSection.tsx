import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  RefreshCw,
  Copy,
  Download,
  FileText,
} from 'lucide-react';
import { MetadataLabel, EmptyState, ReanalyzeModal } from '../../components/v2';
import {
  fetchProjectDetail,
  type ProjectWithEntries,
  type ContextFile,
} from '../../services/api';

// Context files, detected stack and repo shape. Rendered inside the
// Settings tab; the living spec (IntentSection) lives on the Spec tab.

// `existing` files (refreshed context for paths that already have a .context.md)
// surface first; prescriptive `gap` files (specs for missing capabilities) come
// after so missing-pieces work is grouped together at the bottom of the list.
const CONTEXT_FILE_TYPE_ORDER: Record<ContextFile['type'], number> = {
  existing: 0,
  gap: 1,
};

const CONTEXT_FILE_TYPE_LABEL: Record<ContextFile['type'], string> = {
  existing: 'refresh',
  gap: 'missing',
};

// `gap` files are prescriptive specs for capabilities the repo doesn't have
// yet — they're action items, so they earn the amber accent. `existing` files
// are regenerated documentation for paths that already exist, so they're
// purely informational.
const CONTEXT_FILE_TYPE_PILL: Record<ContextFile['type'], string> = {
  existing: 'bg-paper-sunk text-ink-muted border-line',
  gap: 'bg-holding-soft text-holding border-holding',
};

function sortContextFiles(files: ContextFile[]): ContextFile[] {
  return files.slice().sort((a, b) => {
    const t = CONTEXT_FILE_TYPE_ORDER[a.type] - CONTEXT_FILE_TYPE_ORDER[b.type];
    if (t !== 0) return t;
    return a.path.localeCompare(b.path);
  });
}

// `path` ends in `.context.md` but contains slashes; OSes don't love that in a
// `download` attribute. We keep the last two segments (e.g. `auth/.context.md`
// -> `auth__.context.md`) so the file is recognizable without being literal.
function fileToDownloadName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 1) return p;
  return parts.slice(-2).join('__');
}

function downloadBlob(filename: string, content: string, mime = 'text/markdown') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Non-secure contexts (http://) and some Safari versions reject clipboard
    // writes. Surfacing via console keeps the UI from looking broken.
    console.warn('clipboard write failed:', err);
    return false;
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export interface ContextSectionProps {
  projectId: string;
  /** Signed-out / non-owner view: no re-analyze affordance. */
  readOnly?: boolean;
}

function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-paper-raised border border-line rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-paper-sunk transition-colors"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-ink-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ink-muted flex-shrink-0" />
        )}
        <span className="text-sm font-semibold text-ink">{title}</span>
        {subtitle ? (
          <span className="text-xs text-ink-muted truncate">{subtitle}</span>
        ) : null}
      </button>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </div>
  );
}

function ContextFileRow({ file }: { file: ContextFile }) {
  const [copyLabel, setCopyLabel] = useState<'Copy' | 'Copied!'>('Copy');
  const [open, setOpen] = useState(false);

  const tokenEstimate = useMemo(() => estimateTokens(file.content), [file.content]);
  const downloadName = useMemo(() => fileToDownloadName(file.path), [file.path]);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(file.content);
    if (ok) {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    }
  };

  const onDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadBlob(downloadName, file.content);
  };

  return (
    <div className="bg-paper-raised border border-line rounded-lg overflow-hidden">
      {/* Below sm: stack path/pill/tokens above Copy/Download so the
          row doesn't crush the path to a few characters. Above sm:
          keep the original single-line layout. The button group
          right-aligns on mobile via `self-end` to avoid full-width
          buttons that would shout louder than the path itself. */}
      <div className="w-full px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 hover:bg-paper-sunk transition-colors">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-left flex-wrap sm:flex-nowrap"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-ink-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-ink-muted flex-shrink-0" />
          )}
          <FileText className="w-4 h-4 text-ink-muted flex-shrink-0" />
          <code className="text-xs font-mono text-ink truncate min-w-0 flex-1 sm:flex-initial">{file.path}</code>
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${CONTEXT_FILE_TYPE_PILL[file.type]}`}
          >
            {CONTEXT_FILE_TYPE_LABEL[file.type]}
          </span>
          <span className="text-[11px] text-ink-muted flex-shrink-0">
            ~{tokenEstimate.toLocaleString()} tokens
          </span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0 self-end sm:self-auto">
          <button
            type="button"
            onClick={onCopy}
            className="text-xs px-2 py-1 rounded border border-line text-ink hover:bg-paper-sunk transition-colors inline-flex items-center gap-1"
            aria-label={`Copy ${file.path}`}
          >
            <Copy className="w-3 h-3" />
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="text-xs px-2 py-1 rounded border border-line text-ink hover:bg-paper-sunk transition-colors inline-flex items-center gap-1"
            aria-label={`Download ${file.path}`}
          >
            <Download className="w-3 h-3" />
            Download
          </button>
        </div>
      </div>
      {open ? (
        <pre className="text-xs text-ink font-mono whitespace-pre-wrap bg-paper-sunk border-t border-line px-4 py-3 max-h-80 overflow-y-auto">
          {file.content}
        </pre>
      ) : null}
    </div>
  );
}

function ContextFilesCard({
  files,
  bundleBaseName,
}: {
  files: ContextFile[];
  bundleBaseName: string;
}) {
  const [copyAllLabel, setCopyAllLabel] = useState<'Copy all' | 'Copied!'>('Copy all');
  const ordered = useMemo(() => sortContextFiles(files), [files]);

  const bundled = useMemo(
    () =>
      ordered
        .map((f) => `## ${f.path}\n\n${f.content.trim()}\n`)
        .join('\n\n---\n\n'),
    [ordered],
  );

  const onCopyAll = async () => {
    const ok = await copyToClipboard(bundled);
    if (ok) {
      setCopyAllLabel('Copied!');
      setTimeout(() => setCopyAllLabel('Copy all'), 1500);
    }
  };

  const onDownloadAll = () => {
    const safeBase = bundleBaseName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    downloadBlob(`${safeBase}-context.md`, bundled);
  };

  return (
    <div className="bg-paper-raised border border-line rounded-lg p-5">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <MetadataLabel>AI-ready context files</MetadataLabel>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-night text-on-night font-medium">
          {ordered.length}
        </span>
        <p className="text-xs text-ink-muted flex-1 min-w-[12rem]">
          Commit these alongside your code so Cursor / Claude reads them as it works.
        </p>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={onCopyAll}
            className="text-xs px-2.5 py-1 rounded border border-line text-ink hover:bg-paper-sunk transition-colors inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" />
            {copyAllLabel}
          </button>
          <button
            type="button"
            onClick={onDownloadAll}
            className="text-xs px-2.5 py-1 rounded border border-ink bg-night text-on-night hover:bg-night transition-colors inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            Download all
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {ordered.map((file) => (
          <ContextFileRow key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}

export function ContextSection({ projectId, readOnly = false }: ContextSectionProps) {
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reanalyzeModalOpen, setReanalyzeModalOpen] = useState(false);

  const handleReanalyzeTriggered = useCallback((id: string) => {
    setReanalyzeModalOpen(false);
    navigate(`/takeoff/${id}`);
  }, [navigate]);

  // `reload` is the user-triggered Retry path on the load-error empty state.
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchProjectDetail(projectId);
      setProject(p);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load context');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProjectDetail(projectId)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading && !project) {
    return <div className="text-sm text-ink-muted">Loading context…</div>;
  }
  if (error || !project) {
    return (
      <EmptyState
        title="Couldn't load context"
        description={error ?? 'Project not found.'}
        action={
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-paper-raised border border-line-strong rounded hover:bg-paper-sunk transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        }
      />
    );
  }

  // Local uploads (`local://…`) can't be re-analyzed because we don't
  // persist the original files. Hide the Re-analyze affordance for
  // those projects rather than show a button that always 400s.
  // SettingsSection.tsx applies the same check on `repoUrl`.
  const isLocalProject = typeof project.repo_url === 'string' && project.repo_url.startsWith('local://');

  const stack: Array<[string, string]> = [];
  if (project.stack_info?.runtime) stack.push(['Runtime', project.stack_info.runtime]);
  if (project.stack_info?.framework) stack.push(['Framework', project.stack_info.framework]);
  if (project.stack_info?.styling) stack.push(['Styling', project.stack_info.styling]);
  if (project.stack_info?.database) stack.push(['Database', project.stack_info.database]);
  if (project.stack_info?.auth) stack.push(['Auth', project.stack_info.auth]);
  if (project.deploy_type) stack.push(['Deploy', project.deploy_type]);

  const analysis = project.analysis_data;
  const structure = analysis?.structure;
  const fileTree = analysis?.fileTree ?? [];

  return (
    <div className="space-y-6">
      <div>
        <MetadataLabel className="mb-1">Repo &amp; context</MetadataLabel>
        <p className="text-ink-muted text-sm leading-relaxed">
          Context files for Cursor and Claude Code, the stack we detected, and the shape of the repo.
        </p>
      </div>

      {project.context_files && project.context_files.length > 0 ? (
        <ContextFilesCard
          files={project.context_files}
          bundleBaseName={project.repo || project.owner || project.slug || 'project'}
        />
      ) : (
        /* The Context-Files generator runs as part of the takeoff
           pipeline, but projects analyzed before that wiring landed
           (or those where the stage failed silently) have no files
           on disk. Say so instead of silently hiding the card. */
        <EmptyState
          icon={FileText}
          title="No context files yet"
          description={
            isLocalProject
              ? "This was an uploaded folder, so we can't re-analyze to generate context files."
              : readOnly
                ? 'This project was analyzed before the context-file generator landed. The owner can re-analyze to generate them.'
                : 'This project was analyzed before the context-file generator landed (or the stage failed). Re-analyze to generate them.'
          }
          action={
            !isLocalProject && !readOnly ? (
              <button
                type="button"
                onClick={() => setReanalyzeModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-on-night bg-night rounded hover:bg-night transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Re-analyze
              </button>
            ) : undefined
          }
        />
      )}

      <div className="bg-paper-raised border border-line rounded-lg p-5">
        <MetadataLabel className="mb-3">Tech stack</MetadataLabel>
        {stack.length === 0 ? (
          <p className="text-xs text-ink-muted">Stack details unavailable.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {stack.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-ink-muted">{k}</span>
                <span className="font-medium text-ink">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {structure ? (
        <Collapsible
          title="Project structure"
          subtitle={`${fileTree.length} file${fileTree.length === 1 ? '' : 's'} · ${
            (structure.directories ?? []).length
          } dir${(structure.directories ?? []).length === 1 ? '' : 's'}`}
        >
          <div className="space-y-3">
            {(structure.entryPoints ?? []).length > 0 ? (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider text-ink-muted mb-1.5">
                  Entry points
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {structure.entryPoints.map((f) => (
                    <code
                      key={f}
                      className="text-xs px-2 py-1 rounded bg-cleared-soft border border-cleared text-cleared font-mono"
                    >
                      {f}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
            {(structure.routeFiles ?? []).length > 0 ? (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider text-ink-muted mb-1.5">
                  Routes / API
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {structure.routeFiles.map((f) => (
                    <code
                      key={f}
                      className="text-xs px-2 py-1 rounded bg-paper-sunk border border-line text-ink font-mono"
                    >
                      {f}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
            {(structure.configFiles ?? []).length > 0 ? (
              <div>
                <h4 className="text-[11px] uppercase tracking-wider text-ink-muted mb-1.5">
                  Config files
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {structure.configFiles.map((f) => (
                    <code
                      key={f}
                      className="text-xs px-2 py-1 rounded bg-paper-sunk border border-line text-ink-muted font-mono"
                    >
                      {f}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Collapsible>
      ) : null}

      {fileTree.length > 0 ? (
        <Collapsible title="File tree" subtitle={`${fileTree.length} file${fileTree.length === 1 ? '' : 's'}`}>
          <div className="max-h-64 overflow-y-auto rounded bg-paper-sunk border border-line p-3 space-y-0.5">
            {fileTree.map((f) => (
              <div key={f} className="text-xs text-ink-muted font-mono truncate">
                <FolderTree className="inline w-3 h-3 text-ink-muted mr-1" />
                {f}
              </div>
            ))}
          </div>
        </Collapsible>
      ) : null}

      {!isLocalProject && !readOnly ? (
        <ReanalyzeModal
          open={reanalyzeModalOpen}
          onClose={() => setReanalyzeModalOpen(false)}
          projectId={projectId}
          projectLabel={project.repo ? `${project.owner}/${project.repo}` : project.repo_url || projectId}
          onTriggered={handleReanalyzeTriggered}
        />
      ) : null}
    </div>
  );
}

export default ContextSection;
