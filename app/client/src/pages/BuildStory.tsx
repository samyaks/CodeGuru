import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Terminal,
  FileText,
  GitBranch,
  GitCommit as GitCommitIcon,
  Flag,
  Rocket,
  File,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Copy,
  Check,
  X,
  Sparkles,
  Share2,
  Eye,
  EyeOff,
  Link as LinkIcon,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchBuildStory,
  fetchProjectDetail,
  createBuildEntry,
  updateBuildEntry,
  deleteBuildEntry,
  generateContextFromStory,
  generateSocialSummary,
  type BuildEntry,
  type ProjectWithEntries,
} from '../services/api';
import { useCommits, type GitCommit } from '../hooks/useCommits';

type TimelineItem =
  | { kind: 'entry'; data: BuildEntry; date: string }
  | { kind: 'commit'; data: GitCommit; date: string };

type FilterMode = 'all' | 'commits' | 'entries';

function mergeTimeline(entries: BuildEntry[], commits: GitCommit[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...entries.map((e) => ({ kind: 'entry' as const, data: e, date: e.created_at })),
    ...commits.map((c) => ({ kind: 'commit' as const, data: c, date: c.date })),
  ];
  return items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

interface BuildStoryProps {
  projectId?: string;
  onCounts?: (commits: number, entries: number) => void;
}

const ENTRY_TYPES: BuildEntry['entry_type'][] = [
  'prompt',
  'note',
  'decision',
  'milestone',
  'deploy_event',
  'file',
];

const TYPE_ICON: Record<BuildEntry['entry_type'], React.ReactNode> = {
  prompt: <Terminal size={16} />,
  note: <FileText size={16} />,
  decision: <GitBranch size={16} />,
  milestone: <Flag size={16} />,
  deploy_event: <Rocket size={16} />,
  file: <File size={16} />,
};

const TYPE_COLORS: Record<BuildEntry['entry_type'], string> = {
  prompt: 'bg-info-bg text-info border-info-border',
  note: 'bg-surface-2 text-text-muted border-line',
  decision: 'bg-warning-bg text-warning border-warning-border',
  milestone: 'bg-success-bg text-success border-success-border',
  deploy_event: 'bg-brand-tint text-brand border-brand-tint-border',
  file: 'bg-surface-2 text-text-muted border-line',
};

const TYPE_LINE_COLORS: Record<BuildEntry['entry_type'], string> = {
  prompt: 'bg-info-bg',
  note: 'bg-line',
  decision: 'bg-warning-bg',
  milestone: 'bg-success-bg',
  deploy_event: 'bg-brand-tint-2',
  file: 'bg-line',
};

interface EntryForm {
  entry_type: BuildEntry['entry_type'];
  title: string;
  content: string;
}

const EMPTY_FORM: EntryForm = { entry_type: 'note', title: '', content: '' };

export default function BuildStory({ projectId: propProjectId, onCounts }: BuildStoryProps) {
  const params = useParams<{ id: string }>();
  const projectId = propProjectId || params.id || '';
  const isStandalone = !propProjectId;

  const [entries, setEntries] = useState<BuildEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<EntryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EntryForm>(EMPTY_FORM);

  const [generating, setGenerating] = useState(false);
  const [contextResult, setContextResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [socialSummary, setSocialSummary] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null);

  const { commits, loading: commitsLoading, reason: commitsReason } = useCommits(projectId);

  useEffect(() => {
    if (!projectId) return;
    fetchBuildStory(projectId)
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    fetchProjectDetail(projectId)
      .then(setProject)
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    onCounts?.(commits.length, entries.length);
  }, [commits.length, entries.length, onCounts]);

  const timeline = mergeTimeline(entries, commits);
  const filteredTimeline = filter === 'all'
    ? timeline
    : timeline.filter((item) => item.kind === (filter === 'commits' ? 'commit' : 'entry'));
  const isLoading = loading || commitsLoading;

  const handleCreate = useCallback(async () => {
    if (!addForm.content.trim()) return;
    setSaving(true);
    try {
      const entry = await createBuildEntry(projectId, {
        entry_type: addForm.entry_type,
        title: addForm.title || undefined,
        content: addForm.content,
      });
      setEntries((prev) => [entry, ...prev]);
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create entry');
    } finally {
      setSaving(false);
    }
  }, [projectId, addForm]);

  const startEdit = useCallback((entry: BuildEntry) => {
    setEditingId(entry.id);
    setEditForm({
      entry_type: entry.entry_type,
      title: entry.title || '',
      content: entry.content,
    });
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!editingId || !editForm.content.trim()) return;
    setSaving(true);
    try {
      const updated = await updateBuildEntry(projectId, editingId, {
        entry_type: editForm.entry_type,
        title: editForm.title || undefined,
        content: editForm.content,
      });
      setEntries((prev) => prev.map((e) => (e.id === editingId ? updated : e)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update entry');
    } finally {
      setSaving(false);
    }
  }, [projectId, editingId, editForm]);

  const handleDelete = useCallback(async (entryId: string) => {
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    try {
      await deleteBuildEntry(projectId, entryId);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  }, [projectId]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await generateContextFromStory(projectId);
      setContextResult(result.contextFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate context');
    } finally {
      setGenerating(false);
    }
  }, [projectId]);

  const copyContext = useCallback(async () => {
    if (!contextResult) return;
    try {
      await navigator.clipboard.writeText(contextResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy — clipboard access denied');
    }
  }, [contextResult]);

  const toggleVisibility = useCallback(async (entry: BuildEntry) => {
    setTogglingVisibility(entry.id);
    try {
      const newVal = entry.is_public ? 0 : 1;
      const updated = await updateBuildEntry(projectId, entry.id, { is_public: newVal });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility');
    } finally {
      setTogglingVisibility(null);
    }
  }, [projectId]);

  const copyShareLink = useCallback(async () => {
    if (!project?.slug) return;
    try {
      const url = `${window.location.origin}/story/${project.slug}`;
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError('Failed to copy — clipboard access denied');
    }
  }, [project?.slug]);

  const handleGenerateSummary = useCallback(async () => {
    if (!project?.slug) return;
    setGeneratingSummary(true);
    try {
      const result = await generateSocialSummary(project.slug);
      setSocialSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setGeneratingSummary(false);
    }
  }, [project?.slug]);

  const content = (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-danger-bg border border-danger-border text-danger text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Share bar */}
      {project?.slug && (
        <div className="bg-surface border border-line rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text">
            <Share2 size={16} className="text-brand" />
            Share your build story
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-page border border-line text-sm text-text-soft overflow-hidden">
              <LinkIcon size={14} className="text-text-muted flex-shrink-0" />
              <span className="truncate">
                {window.location.origin}/story/{project.slug}
              </span>
            </div>
            <button
              onClick={copyShareLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-hov transition-colors flex-shrink-0"
            >
              {linkCopied ? <Check size={14} /> : <Copy size={14} />}
              {linkCopied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleGenerateSummary}
              disabled={generatingSummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-line text-text-soft hover:text-text hover:border-line transition-colors disabled:opacity-50"
            >
              {generatingSummary ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {generatingSummary ? 'Generating...' : 'Generate summary'}
            </button>
            {socialSummary && (
              <p className="text-xs text-text-muted italic flex-1 min-w-0 truncate">
                {socialSummary}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Add Entry button / form */}
      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hov transition-colors"
        >
          <Plus size={16} />
          Add Entry
        </button>
      ) : (
        <EntryFormCard
          form={addForm}
          onChange={setAddForm}
          onSave={handleCreate}
          onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
          saving={saving}
          saveLabel="Add Entry"
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-text-muted" />
        </div>
      )}

      {/* Empty states */}
      {!isLoading && entries.length === 0 && commits.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <FileText size={48} className="mx-auto text-text-muted" />
          <h3 className="text-lg font-semibold text-text">Your BuildStory is empty</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {commitsReason
              ? "Commit history couldn't be loaded (private repo or rate limit). Add entries manually to document your build."
              : 'Start documenting your build journey — prompts, decisions, milestones, and more.'}
          </p>
        </div>
      )}

      {!isLoading && entries.length === 0 && commits.length > 0 && (
        <div className="bg-surface border border-line rounded-xl p-5 text-center space-y-2">
          <p className="text-sm text-text font-medium">
            Your commit history is here — {commits.length} commit{commits.length !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-text-muted">
            Add a note, decision, or milestone to tell the story behind what you built.
          </p>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hov transition-colors mt-2"
            >
              <Plus size={16} />
              Add First Entry
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      {!isLoading && timeline.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted mr-1">Show:</span>
          {(['all', 'commits', 'entries'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                filter === mode
                  ? 'bg-brand-tint text-brand border border-brand-tint-border'
                  : 'text-text-muted hover:text-text border border-transparent'
              }`}
            >
              {mode === 'all' ? 'All' : mode === 'commits' ? 'Commits only' : 'My entries only'}
            </button>
          ))}
        </div>
      )}

      {/* Merged timeline */}
      {!isLoading && filteredTimeline.length > 0 && (
        <div className="relative">
          {filteredTimeline.map((item, idx) => {
            const isLast = idx === filteredTimeline.length - 1;

            if (item.kind === 'commit') {
              return (
                <CommitCard
                  key={item.data.sha}
                  commit={item.data}
                  isLast={isLast}
                  projectId={projectId}
                />
              );
            }

            const entry = item.data;
            const isEditing = editingId === entry.id;

            return (
              <div key={entry.id} className="relative flex gap-4">
                {/* Timeline line + dot */}
                <div className="flex flex-col items-center flex-shrink-0 w-8">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center border ${TYPE_COLORS[entry.entry_type]}`}
                  >
                    {TYPE_ICON[entry.entry_type]}
                  </div>
                  {!isLast && (
                    <div className={`w-0.5 flex-1 min-h-6 ${TYPE_LINE_COLORS[entry.entry_type]}`} />
                  )}
                </div>

                {/* Entry content */}
                <div className="flex-1 pb-6 min-w-0">
                  {isEditing ? (
                    <EntryFormCard
                      form={editForm}
                      onChange={setEditForm}
                      onSave={handleUpdate}
                      onCancel={() => setEditingId(null)}
                      saving={saving}
                      saveLabel="Save Changes"
                    />
                  ) : (
                    <div className="bg-surface border border-line rounded-xl p-4 group">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border ${TYPE_COLORS[entry.entry_type]}`}
                          >
                            {entry.entry_type}
                          </span>
                          {entry.title && (
                            <span className="text-sm font-medium text-text">
                              {entry.title}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${entry.is_public ? 'text-success bg-success-bg' : 'text-text-muted bg-surface-2'}`}>
                            {entry.is_public ? 'Public' : 'Private'}
                          </span>
                          <button
                            onClick={() => toggleVisibility(entry)}
                            disabled={togglingVisibility === entry.id}
                            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-page transition-colors disabled:opacity-50"
                            title={entry.is_public ? 'Make private' : 'Make public'}
                          >
                            {togglingVisibility === entry.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : entry.is_public ? (
                              <Eye size={14} />
                            ) : (
                              <EyeOff size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => startEdit(entry)}
                            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-page transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger-bg transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-text-soft whitespace-pre-wrap break-words">
                        {entry.content}
                      </p>
                      <p className="text-[11px] text-text-muted mt-2">
                        {new Date(entry.created_at).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Generate context button */}
      {!isLoading && entries.length > 0 && (
        <div className="pt-4 border-t border-divider">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hov transition-colors disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {generating ? 'Generating...' : 'Generate .context.md'}
          </button>
        </div>
      )}

      {/* Context result panel */}
      {contextResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-line rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h3 className="font-semibold text-text">Generated .context.md</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyContext}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-hov transition-colors"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => setContextResult(null)}
                  className="p-1.5 rounded-md text-text-muted hover:text-text transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <pre className="text-xs text-text-soft whitespace-pre-wrap font-mono">{contextResult}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isStandalone) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo={`/projects/${projectId}`} title="Build Story" />
        <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
          {content}
        </main>
      </div>
    );
  }

  return content;
}

function EntryFormCard({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  saveLabel,
}: {
  form: EntryForm;
  onChange: (form: EntryForm) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveLabel: string;
}) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 space-y-3">
      {/* Type selector */}
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Type</label>
        <select
          value={form.entry_type}
          onChange={(e) => onChange({ ...form, entry_type: e.target.value as BuildEntry['entry_type'] })}
          className="w-full px-3 py-2 rounded-lg bg-page border border-line text-sm text-text focus:outline-none focus:border-brand"
        >
          {ENTRY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Title (optional)</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          placeholder="Brief title for this entry"
          className="w-full px-3 py-2 rounded-lg bg-page border border-line text-sm text-text placeholder-text-disabled focus:outline-none focus:border-brand"
        />
      </div>

      {/* Content */}
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Content</label>
        <textarea
          value={form.content}
          onChange={(e) => onChange({ ...form, content: e.target.value })}
          placeholder="What happened? What did you decide?"
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-page border border-line text-sm text-text placeholder-text-disabled focus:outline-none focus:border-brand resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving || !form.content.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hov transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saveLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CommitCard({ commit, isLast, projectId }: { commit: GitCommit; isLast: boolean; projectId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!commit.filesChanged) {
      setLoadingFiles(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/commits/${commit.sha}`, { credentials: 'include' });
        const data = await res.json();
        commit.filesChanged = data.files;
      } catch {
        // silently fail — files just won't show
      } finally {
        setLoadingFiles(false);
      }
    }
    setExpanded(true);
  };

  const timeAgo = formatRelativeTime(commit.date);

  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center flex-shrink-0 w-8">
        <div className="w-8 h-8 rounded-full flex items-center justify-center border border-sky-400/30 bg-sky-400/10 text-sky-400/60">
          <GitCommitIcon size={16} />
        </div>
        {!isLast && <div className="w-0.5 flex-1 min-h-6 bg-sky-400/20" />}
      </div>

      <div className="flex-1 pb-6 min-w-0">
        <div className="bg-page border border-sky-400/20 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs bg-sky-400/10 text-sky-400/80 px-1.5 py-0.5 rounded flex-shrink-0">
                {commit.shortSha}
              </span>
              <span className="text-sm text-text truncate">{commit.title}</span>
            </div>
            <a
              href={commit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded text-text-muted hover:text-text transition-colors flex-shrink-0"
              title="Open in GitHub"
            >
              <ExternalLink size={13} />
            </a>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            {commit.authorAvatar && (
              <img src={commit.authorAvatar} alt="" className="w-4 h-4 rounded-full" />
            )}
            <span>{commit.authorLogin || commit.author}</span>
            <span>·</span>
            <span>{timeAgo}</span>
          </div>

          <button
            onClick={handleExpand}
            className="mt-2 flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
          >
            {loadingFiles ? (
              <Loader2 size={12} className="animate-spin" />
            ) : expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            {commit.filesChanged
              ? `${commit.filesChanged.length} file${commit.filesChanged.length !== 1 ? 's' : ''} changed`
              : 'Show files'}
          </button>

          {expanded && commit.filesChanged && (
            <div className="mt-2 space-y-1">
              {commit.filesChanged.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-xs font-mono">
                  <span className={
                    f.status === 'added' ? 'text-success' :
                    f.status === 'removed' ? 'text-danger' :
                    f.status === 'renamed' ? 'text-warning' :
                    'text-text-muted'
                  }>
                    {f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                  </span>
                  <span className="text-text-soft truncate">{f.path}</span>
                  <span className="ml-auto flex-shrink-0 text-text-muted">
                    {f.additions > 0 && <span className="text-success">+{f.additions}</span>}
                    {f.additions > 0 && f.deletions > 0 && ' '}
                    {f.deletions > 0 && <span className="text-danger">-{f.deletions}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
