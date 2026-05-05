import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Trash2, AlertTriangle } from 'lucide-react';
import { MetadataLabel, EmptyState } from '../../components/v2';
import { fetchProjectDetail, deleteProject, type ProjectWithEntries } from '../../services/api';

export interface SettingsSectionProps {
  projectId: string;
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-stone-100 last:border-b-0">
      <span className="text-xs text-stone-500 uppercase tracking-wider flex-shrink-0">{label}</span>
      <span
        className={`text-sm text-stone-900 text-right truncate ${
          mono ? 'font-mono text-xs' : ''
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function SettingsSection({ projectId }: SettingsSectionProps) {
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjectDetail(projectId)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const onDelete = useCallback(async () => {
    if (!project) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(project.id);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError((err as Error).message ?? 'Failed to delete project');
      setDeleting(false);
    }
  }, [project, navigate]);

  if (loading) {
    return <div className="text-sm text-stone-500">Loading settings…</div>;
  }
  if (!project) {
    return <EmptyState title="Couldn't load settings" description={error ?? 'Project not found.'} />;
  }

  const buildPlan = project.build_plan;
  const repoUrl = project.repo_url;
  const isLocal = typeof repoUrl === 'string' && repoUrl.startsWith('local://');
  const expectedConfirm = project.repo || project.id.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">Settings</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Project metadata, build configuration, and the danger zone.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <MetadataLabel className="mb-3">Project</MetadataLabel>
        <div>
          {project.repo ? <Row label="Repo" value={`${project.owner}/${project.repo}`} /> : null}
          <Row label="Branch" value={project.branch || 'main'} />
          {project.framework ? <Row label="Framework" value={project.framework} /> : null}
          {project.deploy_type ? <Row label="Deploy type" value={project.deploy_type} /> : null}
          <Row label="Status" value={project.status} />
          {project.live_url ? (
            <div className="flex items-baseline justify-between gap-3 py-2 border-b border-stone-100 last:border-b-0">
              <span className="text-xs text-stone-500 uppercase tracking-wider">Live URL</span>
              <a
                href={project.live_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-stone-900 hover:underline inline-flex items-center gap-1 truncate"
              >
                {project.live_url}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : null}
          <Row label="Created" value={new Date(project.created_at).toLocaleDateString()} />
        </div>
      </div>

      {buildPlan ? (
        <div className="bg-white border border-stone-200 rounded-lg p-5">
          <MetadataLabel className="mb-3">Build configuration</MetadataLabel>
          <div>
            <Row label="Type" value={buildPlan.type ?? 'auto'} />
            {buildPlan.framework ? <Row label="Framework" value={buildPlan.framework} /> : null}
            {buildPlan.confidence ? <Row label="Confidence" value={String(buildPlan.confidence)} /> : null}
            {buildPlan.buildCommand ? <Row label="Build" value={buildPlan.buildCommand} mono /> : null}
            {buildPlan.startCommand ? <Row label="Start" value={buildPlan.startCommand} mono /> : null}
          </div>
        </div>
      ) : null}

      {!isLocal ? (
        <div className="bg-white border border-stone-200 rounded-lg p-5">
          <MetadataLabel className="mb-3">GitHub integration</MetadataLabel>
          <p className="text-xs text-stone-500 mb-2">
            Takeoff listens to push events on{' '}
            <span className="font-mono text-stone-700">{project.branch || 'main'}</span> and
            matches each commit to your open gaps.
          </p>
          {repoUrl ? (
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900"
            >
              View repo on GitHub
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="bg-red-50 border border-red-200 rounded-lg p-5">
        <div className="flex items-start gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-red-700 flex-shrink-0 mt-0.5" />
          <div>
            <MetadataLabel className="!text-red-800">Danger zone</MetadataLabel>
            <p className="text-xs text-red-700 mt-1.5 leading-relaxed">
              Permanently delete this project and all associated data — gaps, shipped items,
              product map, build history, webhooks. This cannot be undone.
            </p>
          </div>
        </div>

        {error ? (
          <p className="text-xs text-red-700 mt-2 bg-red-100 rounded px-2 py-1.5">{error}</p>
        ) : null}

        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-900 px-3 py-1.5 rounded border border-red-300 hover:bg-red-100 bg-white"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete project
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-red-800">
              Type <code className="bg-white px-1 py-0.5 rounded text-red-900 font-mono">{expectedConfirm}</code> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              className="w-full text-sm border border-red-300 rounded px-2 py-1.5 bg-white"
              placeholder={expectedConfirm}
              aria-label="Confirm project name to delete"
            />
            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setConfirmText(''); }}
                disabled={deleting}
                className="text-xs text-stone-600 hover:text-stone-900 px-2 py-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting || confirmText.trim() !== expectedConfirm}
                className="text-xs font-medium px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsSection;
