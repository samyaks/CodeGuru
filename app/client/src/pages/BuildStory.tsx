import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Terminal,
  FileText,
  GitBranch,
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
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchBuildStory,
  createBuildEntry,
  updateBuildEntry,
  deleteBuildEntry,
  generateContextFromStory,
  type BuildEntry,
} from '../services/api';

interface BuildStoryProps {
  projectId?: string;
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
  prompt: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  note: 'bg-sky-muted/10 text-sky-muted border-sky-border',
  decision: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  milestone: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  deploy_event: 'bg-gold/10 text-gold border-gold/20',
  file: 'bg-sky-muted/10 text-sky-muted border-sky-border',
};

const TYPE_LINE_COLORS: Record<BuildEntry['entry_type'], string> = {
  prompt: 'bg-blue-500/30',
  note: 'bg-sky-border',
  decision: 'bg-amber-500/30',
  milestone: 'bg-emerald-500/30',
  deploy_event: 'bg-gold/30',
  file: 'bg-sky-border',
};

interface EntryForm {
  entry_type: BuildEntry['entry_type'];
  title: string;
  content: string;
}

const EMPTY_FORM: EntryForm = { entry_type: 'note', title: '', content: '' };

export default function BuildStory({ projectId: propProjectId }: BuildStoryProps) {
  const params = useParams<{ id: string }>();
  const projectId = propProjectId || params.id || '';
  const isStandalone = !propProjectId;

  const [entries, setEntries] = useState<BuildEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<EntryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EntryForm>(EMPTY_FORM);

  const [generating, setGenerating] = useState(false);
  const [contextResult, setContextResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetchBuildStory(projectId)
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

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
    await navigator.clipboard.writeText(contextResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contextResult]);

  const content = (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Add Entry button / form */}
      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
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
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-sky-muted" />
        </div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <FileText size={48} className="mx-auto text-sky-muted" />
          <h3 className="text-lg font-semibold text-sky-white">No entries yet</h3>
          <p className="text-sm text-sky-muted max-w-md mx-auto">
            Start documenting your build journey — prompts, decisions, milestones, and more.
          </p>
        </div>
      )}

      {/* Timeline */}
      {!loading && entries.length > 0 && (
        <div className="relative">
          {entries.map((entry, idx) => {
            const isEditing = editingId === entry.id;
            const isLast = idx === entries.length - 1;

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
                    <div className="bg-navy border border-sky-border/50 rounded-xl p-4 group">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border ${TYPE_COLORS[entry.entry_type]}`}
                          >
                            {entry.entry_type}
                          </span>
                          {entry.title && (
                            <span className="text-sm font-medium text-sky-white">
                              {entry.title}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={() => startEdit(entry)}
                            className="p-1.5 rounded-md text-sky-muted hover:text-sky-white hover:bg-navy-mid transition-colors"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-1.5 rounded-md text-sky-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-sky-off whitespace-pre-wrap break-words">
                        {entry.content}
                      </p>
                      <p className="text-[11px] text-sky-muted mt-2">
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
      {!loading && entries.length > 0 && (
        <div className="pt-4 border-t border-sky-border/30">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-midnight/80 backdrop-blur-sm p-4">
          <div className="bg-navy border border-sky-border rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-sky-border/50">
              <h3 className="font-semibold text-sky-white">Generated .context.md</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyContext}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gold text-midnight hover:bg-gold-dim transition-colors"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => setContextResult(null)}
                  className="p-1.5 rounded-md text-sky-muted hover:text-sky-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <pre className="text-xs text-sky-off whitespace-pre-wrap font-mono">
                {contextResult}
              </pre>
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
    <div className="bg-navy border border-sky-border/50 rounded-xl p-4 space-y-3">
      {/* Type selector */}
      <div>
        <label className="block text-xs font-medium text-sky-muted mb-1">Type</label>
        <select
          value={form.entry_type}
          onChange={(e) => onChange({ ...form, entry_type: e.target.value as BuildEntry['entry_type'] })}
          className="w-full px-3 py-2 rounded-lg bg-midnight border border-sky-border/50 text-sm text-sky-white focus:outline-none focus:border-gold/50"
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
        <label className="block text-xs font-medium text-sky-muted mb-1">Title (optional)</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          placeholder="Brief title for this entry"
          className="w-full px-3 py-2 rounded-lg bg-midnight border border-sky-border/50 text-sm text-sky-white placeholder-sky-muted/50 focus:outline-none focus:border-gold/50"
        />
      </div>

      {/* Content */}
      <div>
        <label className="block text-xs font-medium text-sky-muted mb-1">Content</label>
        <textarea
          value={form.content}
          onChange={(e) => onChange({ ...form, content: e.target.value })}
          placeholder="What happened? What did you decide?"
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-midnight border border-sky-border/50 text-sm text-sky-white placeholder-sky-muted/50 focus:outline-none focus:border-gold/50 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving || !form.content.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saveLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-sky-muted hover:text-sky-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
