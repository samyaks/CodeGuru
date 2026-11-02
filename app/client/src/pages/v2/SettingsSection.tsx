import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { MetadataLabel, EmptyState } from '../../components/v2';
import { fetchProjectDetail, deleteProject, type ProjectWithEntries } from '../../services/api';
import ContextSection from './ContextSection';

export interface SettingsSectionProps {
  projectId: string;
  /** Signed-out / non-owner view: no danger zone, no re-analyze. */
  readOnly?: boolean;
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-line last:border-b-0">
      <span className="text-xs text-ink-muted uppercase tracking-wider flex-shrink-0">{label}</span>
      <span
        className={`text-sm text-ink text-right truncate ${
          mono ? 'font-mono text-xs' : ''
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function SettingsSection({ projectId, readOnly = false }: SettingsSectionProps) {
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // `reload` is callable from the Retry button on the load-error
  // empty state. The cancelled-ref guard isn't needed here because
  // the manual reload is user-triggered (vs the auto reload on
  // mount/projectId change, which still uses the cancelled-flag
  // pattern below).
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchProjectDetail(projectId);
      setProject(p);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
    return <div className="text-sm text-ink-muted">Loading settings…</div>;
  }
  if (!project) {
    return (
      <EmptyState
        title="Couldn't load settings"
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

  const buildPlan = project.build_plan;
  const repoUrl = project.repo_url;
  const isLocal = typeof repoUrl === 'string' && repoUrl.startsWith('local://');
  const expectedConfirm = project.repo || project.id.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-ink mb-2 v2-font-serif">Settings</h3>
        <p className="text-ink-muted text-sm leading-relaxed">
          {readOnly
            ? 'How this project is connected, and the context files it generates.'
            : 'How this project is connected, the context files it generates, and the danger zone.'}
        </p>
      </div>

      <div className="bg-paper-raised border border-line rounded-lg p-5">
        <MetadataLabel className="mb-3">Project</MetadataLabel>
        <div>
          {project.repo ? <Row label="Repo" value={`${project.owner}/${project.repo}`} /> : null}
          <Row label="Branch" value={project.branch || 'main'} />
          {project.framework ? <Row label="Framework" value={project.framework} /> : null}
          {project.deploy_type ? <Row label="Deploy type" value={project.deploy_type} /> : null}
          <Row label="Status" value={project.status} />
          {project.live_url ? (
            <div className="flex items-baseline justify-between gap-3 py-2 border-b border-line last:border-b-0">
              <span className="text-xs text-ink-muted uppercase tracking-wider">Live URL</span>
              <a
                href={project.live_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-ink hover:underline inline-flex items-center gap-1 truncate"
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
        <div className="bg-paper-raised border border-line rounded-lg p-5">
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
        <div className="bg-paper-raised border border-line rounded-lg p-5">
          <MetadataLabel className="mb-3">GitHub integration</MetadataLabel>
          <p className="text-xs text-ink-muted mb-2">
            Takeoff listens to push events on{' '}
            <span className="font-mono text-ink">{project.branch || 'main'}</span> and
            matches each commit to your open gaps.
          </p>
          {repoUrl ? (
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-ink hover:text-ink"
            >
              View repo on GitHub
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
        </div>
      ) : null}

      <ContextSection projectId={projectId} readOnly={readOnly} />

      {readOnly ? null : (
      <div className="bg-grounded-soft border border-grounded rounded-lg p-5">
        <div className="flex items-start gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-grounded flex-shrink-0 mt-0.5" />
          <div>
            <MetadataLabel className="!text-grounded">Danger zone</MetadataLabel>
            <p className="text-xs text-grounded mt-1.5 leading-relaxed">
              Permanently delete this project and all associated data — gaps, shipped items,
              product map, build history, webhooks. This cannot be undone.
            </p>
          </div>
        </div>

        {error ? (
          <p className="text-xs text-grounded mt-2 bg-grounded-soft rounded px-2 py-1.5">{error}</p>
        ) : null}

        {!confirmOpen ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-grounded hover:text-grounded px-3 py-1.5 rounded border border-grounded hover:bg-grounded-soft bg-paper-raised"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete project
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-grounded">
              Type <code className="bg-paper-raised px-1 py-0.5 rounded text-grounded font-mono">{expectedConfirm}</code> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              className="w-full text-sm border border-grounded rounded px-2 py-1.5 bg-paper-raised"
              placeholder={expectedConfirm}
              aria-label="Confirm project name to delete"
            />
            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setConfirmText(''); }}
                disabled={deleting}
                className="text-xs text-ink-muted hover:text-ink px-2 py-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting || confirmText.trim() !== expectedConfirm}
                className="text-xs font-medium px-3 py-1.5 rounded bg-grounded text-paper hover:bg-grounded disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" />
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default SettingsSection;
