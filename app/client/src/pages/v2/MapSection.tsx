import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lightbulb, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { EmptyState, ProgressBar } from '../../components/v2';
import {
  fetchProductMap,
  regenerateProductMap,
  addPersona,
  removePersona,
  addJob,
  removeJob,
  setJobPriority,
  type ProductMapData,
} from '../../services/productMapApi';

export interface MapSectionProps {
  projectId: string;
}

type Priority = 'high' | 'medium' | 'low';

interface PersonaJobs {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  jobs: { id: string; title: string; priority: Priority }[];
  readiness: number;
}

function readinessFor(personaId: string, data: ProductMapData): number {
  const personaScores = data.scores?.persona ?? {};
  const raw = personaScores[personaId];
  if (typeof raw === 'number') return Math.round(raw * 100);
  return Math.round((data.scores?.app ?? 0.5) * 100);
}

function shapePersonas(data: ProductMapData): PersonaJobs[] {
  const jobsByPersona = new Map<string, PersonaJobs['jobs']>();
  for (const job of data.jobs) {
    const list = jobsByPersona.get(job.personaId) ?? [];
    list.push({
      id: job.id,
      title: job.title,
      priority: (job.priority as Priority) ?? 'medium',
    });
    jobsByPersona.set(job.personaId, list);
  }
  return data.personas.map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji ?? '📌',
    description: p.description,
    jobs: jobsByPersona.get(p.id) ?? [],
    readiness: readinessFor(p.id, data),
  }));
}

export function MapSection({ projectId }: MapSectionProps) {
  const [data, setData] = useState<ProductMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedPersonaId, setExpandedPersonaId] = useState<string | null>(null);
  const [showAddPersona, setShowAddPersona] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchProductMap(projectId);
      setData(next);
      return next;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProductMap(projectId)
      .then((next) => { if (!cancelled) setData(next); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const personas = useMemo(() => (data ? shapePersonas(data) : []), [data]);
  const weakest = useMemo(() => {
    if (personas.length === 0) return null;
    return personas.reduce((min, p) => (p.readiness < min.readiness ? p : min), personas[0]);
  }, [personas]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const next = await regenerateProductMap(projectId);
      setData(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [projectId]);

  const handleAddPersona = useCallback(
    async (input: { name: string; emoji: string; description: string }) => {
      if (!data) return;
      setBusyId('add-persona');
      try {
        await addPersona(data.id, {
          name: input.name.trim(),
          emoji: input.emoji.trim() || '👤',
          description: input.description.trim(),
        });
        await reload();
        setShowAddPersona(false);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [data, reload],
  );

  const handleRemovePersona = useCallback(
    async (personaId: string) => {
      if (!data) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm('Remove this persona and all its jobs?')) return;
      setBusyId(personaId);
      try {
        await removePersona(data.id, personaId);
        await reload();
        if (expandedPersonaId === personaId) setExpandedPersonaId(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [data, reload, expandedPersonaId],
  );

  const handleAddJob = useCallback(
    async (personaId: string, input: { title: string; priority: Priority }) => {
      if (!data) return;
      setBusyId(`add-job-${personaId}`);
      try {
        await addJob(data.id, {
          personaId,
          title: input.title.trim(),
          priority: input.priority,
        });
        await reload();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [data, reload],
  );

  const handleRemoveJob = useCallback(
    async (jobId: string) => {
      if (!data) return;
      setBusyId(jobId);
      try {
        await removeJob(data.id, jobId);
        await reload();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [data, reload],
  );

  const handleSetPriority = useCallback(
    async (jobId: string, priority: Priority) => {
      if (!data) return;
      setBusyId(jobId);
      try {
        await setJobPriority(data.id, jobId, priority);
        await reload();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [data, reload],
  );

  if (loading) {
    return <div className="text-sm text-stone-500">Loading personas…</div>;
  }

  if (error && !data) {
    return <EmptyState title="Couldn't load product map" description={error} />;
  }

  // No map yet — show the create-flow CTA. The Phase 5 deletion of the
  // v1 wizard left this empty before; now we offer auto-extract + a
  // manual fallback so projects can populate without leaving the tab.
  if (!data || personas.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-stone-200 rounded-lg p-6 text-center">
          <Sparkles className="w-8 h-8 text-stone-400 mx-auto mb-3" aria-hidden />
          <h3 className="text-lg font-semibold text-stone-900 v2-font-serif">
            Map who this is for, automatically
          </h3>
          <p className="text-sm text-stone-600 mt-2 max-w-md mx-auto">
            Claude will read your project's description and extract personas + jobs to be done.
            You can edit, add, or remove anything afterwards.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded-md hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? 'Generating…' : 'Generate from your codebase'}
          </button>
          {error ? (
            <p className="mt-3 text-xs text-red-600">{error}</p>
          ) : null}
          <div className="mt-4 text-xs text-stone-500">
            or{' '}
            <button
              type="button"
              onClick={() => setShowAddPersona(true)}
              className="text-stone-900 underline hover:no-underline"
            >
              build manually
            </button>
            {showAddPersona ? (
              <div className="mt-3 max-w-md mx-auto text-left">
                <PersonaForm
                  onSubmit={handleAddPersona}
                  onCancel={() => setShowAddPersona(false)}
                  busy={busyId === 'add-persona'}
                />
                <p className="mt-3 text-[11px] text-stone-400 text-center">
                  Adding your first persona will create the map automatically.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">Who it's for, what they need</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Personas Claude detected, weighted by how much your code already supports their jobs.
            Click a persona to edit its jobs.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          title="Re-run Claude extraction (overwrites edits if a row doesn't already exist)"
          className="text-xs text-stone-600 hover:text-stone-900 inline-flex items-center gap-1 mt-1 disabled:opacity-50"
        >
          <Sparkles className="w-3 h-3" />
          {generating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {personas.map((p) => (
          <PersonaEditor
            key={p.id}
            persona={p}
            expanded={expandedPersonaId === p.id}
            onToggle={() => setExpandedPersonaId((cur) => (cur === p.id ? null : p.id))}
            onRemovePersona={() => handleRemovePersona(p.id)}
            onAddJob={(input) => handleAddJob(p.id, input)}
            onRemoveJob={handleRemoveJob}
            onSetPriority={handleSetPriority}
            busyId={busyId}
          />
        ))}

        {showAddPersona ? (
          <div className="bg-white border border-stone-300 rounded-lg p-4">
            <PersonaForm
              onSubmit={handleAddPersona}
              onCancel={() => setShowAddPersona(false)}
              busy={busyId === 'add-persona'}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddPersona(true)}
            className="bg-stone-50 border border-dashed border-stone-300 rounded-lg p-5 flex items-center justify-center text-stone-500 hover:text-stone-900 hover:border-stone-400 hover:bg-white transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4 mr-1" /> Add persona
          </button>
        )}
      </div>

      {weakest ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <Lightbulb className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <strong>{weakest.name} is your weakest persona</strong> at {weakest.readiness}%. The Missing Functionality gaps that affect them are likely your highest-impact fixes.
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface PersonaEditorProps {
  persona: PersonaJobs;
  expanded: boolean;
  onToggle: () => void;
  onRemovePersona: () => void;
  onAddJob: (input: { title: string; priority: Priority }) => void;
  onRemoveJob: (jobId: string) => void;
  onSetPriority: (jobId: string, priority: Priority) => void;
  busyId: string | null;
}

function PersonaEditor({
  persona,
  expanded,
  onToggle,
  onRemovePersona,
  onAddJob,
  onRemoveJob,
  onSetPriority,
  busyId,
}: PersonaEditorProps) {
  const [showAddJob, setShowAddJob] = useState(false);
  const personaIsBusy = busyId === persona.id;

  return (
    <div
      className={`bg-white border rounded-lg p-5 transition-colors ${
        expanded ? 'border-stone-400 shadow-sm' : 'border-stone-200 hover:border-stone-300'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-3 text-left flex-1 min-w-0"
        >
          <div className="text-2xl" aria-hidden>{persona.emoji}</div>
          <div className="min-w-0">
            <p className="font-semibold text-stone-900 truncate">{persona.name}</p>
            <p className="text-xs text-stone-500">
              {persona.jobs.length} job{persona.jobs.length === 1 ? '' : 's'} to be done
            </p>
          </div>
        </button>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="text-2xl font-bold text-stone-900 leading-none">
              {persona.readiness}
              <span className="text-sm text-stone-400">%</span>
            </p>
            <p className="text-[11px] text-stone-500">ready</p>
          </div>
          <button
            type="button"
            onClick={onRemovePersona}
            disabled={personaIsBusy}
            title="Remove persona"
            className="text-stone-400 hover:text-red-600 disabled:opacity-50 p-1 -mt-1 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <ProgressBar value={persona.readiness} label={`${persona.name} readiness`} />

      {persona.description ? (
        <p className="text-xs text-stone-500 mt-3 leading-relaxed">{persona.description}</p>
      ) : null}

      {expanded ? (
        <div className="mt-4 pt-4 border-t border-stone-100 space-y-2">
          {persona.jobs.length === 0 ? (
            <p className="text-xs text-stone-400 italic">No jobs yet. Add one below.</p>
          ) : (
            persona.jobs.map((job) => {
              const jobIsBusy = busyId === job.id;
              return (
                <div key={job.id} className="flex items-center gap-2 text-sm">
                  <select
                    value={job.priority}
                    onChange={(e) => onSetPriority(job.id, e.target.value as Priority)}
                    disabled={jobIsBusy}
                    className="text-[11px] uppercase tracking-wide font-medium border border-stone-200 rounded px-1.5 py-0.5 bg-white disabled:opacity-50"
                  >
                    <option value="high">High</option>
                    <option value="medium">Med</option>
                    <option value="low">Low</option>
                  </select>
                  <span className="flex-1 text-stone-700 truncate">{job.title}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveJob(job.id)}
                    disabled={jobIsBusy}
                    title="Remove job"
                    className="text-stone-400 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}

          {showAddJob ? (
            <JobForm
              onSubmit={(input) => {
                onAddJob(input);
                setShowAddJob(false);
              }}
              onCancel={() => setShowAddJob(false)}
              busy={busyId === `add-job-${persona.id}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowAddJob(true)}
              className="text-xs text-stone-600 hover:text-stone-900 inline-flex items-center gap-1 mt-2"
            >
              <Plus className="w-3 h-3" /> Add job
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface PersonaFormProps {
  onSubmit: (input: { name: string; emoji: string; description: string }) => void;
  onCancel: () => void;
  busy: boolean;
}

function PersonaForm({ onSubmit, onCancel, busy }: PersonaFormProps) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👤');
  const [description, setDescription] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name, emoji, description });
      }}
      className="space-y-2"
    >
      <div className="flex gap-2">
        <input
          aria-label="Emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          maxLength={4}
          className="w-12 text-center text-lg border border-stone-200 rounded px-2 py-1.5"
        />
        <input
          aria-label="Persona name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Persona name (e.g. New developer)"
          autoFocus
          className="flex-1 text-sm border border-stone-200 rounded px-2 py-1.5"
        />
      </div>
      <input
        aria-label="Persona description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full text-xs border border-stone-200 rounded px-2 py-1.5 text-stone-600"
      />
      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-stone-600 hover:text-stone-900 px-2 py-1"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="text-xs font-medium px-3 py-1 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Adding…' : 'Add persona'}
        </button>
      </div>
    </form>
  );
}

interface JobFormProps {
  onSubmit: (input: { title: string; priority: Priority }) => void;
  onCancel: () => void;
  busy: boolean;
}

function JobForm({ onSubmit, onCancel, busy }: JobFormProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onSubmit({ title, priority });
        setTitle('');
      }}
      className="flex items-center gap-2 mt-2"
    >
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as Priority)}
        className="text-[11px] uppercase tracking-wide font-medium border border-stone-200 rounded px-1.5 py-0.5 bg-white"
      >
        <option value="high">High</option>
        <option value="medium">Med</option>
        <option value="low">Low</option>
      </select>
      <input
        aria-label="Job title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What does this persona need to do?"
        autoFocus
        className="flex-1 text-sm border border-stone-200 rounded px-2 py-1"
      />
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="text-xs font-medium px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Adding…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-stone-600 hover:text-stone-900"
      >
        Cancel
      </button>
    </form>
  );
}

export default MapSection;
