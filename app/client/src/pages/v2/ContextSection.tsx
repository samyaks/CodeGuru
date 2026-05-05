import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MetadataLabel, EmptyState } from '../../components/v2';
import { fetchProjectDetail, fetchBuildStory, type ProjectWithEntries, type BuildEntry } from '../../services/api';

export interface ContextSectionProps {
  projectId: string;
}

export function ContextSection({ projectId }: ContextSectionProps) {
  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [story, setStory] = useState<BuildEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProjectDetail(projectId)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    fetchBuildStory(projectId)
      .then((entries) => { if (!cancelled) setStory(entries.slice(0, 10)); })
      .catch(() => { /* best-effort */ });

    return () => { cancelled = true; };
  }, [projectId]);

  if (loading && !project) {
    return <div className="text-sm text-stone-500">Loading context…</div>;
  }
  if (error || !project) {
    return <EmptyState title="Couldn't load context" description={error ?? 'Project not found.'} />;
  }

  const stack: Array<[string, string]> = [];
  if (project.stack_info?.runtime) stack.push(['Runtime', project.stack_info.runtime]);
  if (project.stack_info?.framework) stack.push(['Framework', project.stack_info.framework]);
  if (project.stack_info?.styling) stack.push(['Styling', project.stack_info.styling]);
  if (project.stack_info?.database) stack.push(['Database', project.stack_info.database]);
  if (project.stack_info?.auth) stack.push(['Auth', project.stack_info.auth]);
  if (project.deploy_type) stack.push(['Deploy', project.deploy_type]);

  const summary =
    project.features_summary ||
    project.description ||
    `${project.repo} is a ${project.framework ?? 'project'}.`;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">What you've built</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Reference layer. The plain-English summary, your tech stack, recent build events.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <MetadataLabel className="mb-3">In a nutshell</MetadataLabel>
        <p className="text-stone-700 leading-relaxed v2-font-serif">{summary}</p>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <MetadataLabel className="mb-3">Tech stack</MetadataLabel>
        {stack.length === 0 ? (
          <p className="text-xs text-stone-500">Stack details unavailable.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {stack.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-stone-500">{k}</span>
                <span className="font-medium text-stone-900">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <MetadataLabel>Build history</MetadataLabel>
          <Link
            to={`/projects/${projectId}/story`}
            className="text-xs text-stone-600 hover:text-stone-900 font-medium"
          >
            View full history →
          </Link>
        </div>
        {story.length === 0 ? (
          <p className="text-xs text-stone-500">No build entries yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {story.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                <span className="text-xs text-stone-400 mt-0.5 uppercase tracking-wider">
                  {entry.entry_type}
                </span>
                <span className="text-stone-700 truncate flex-1">
                  {entry.title || entry.content.slice(0, 80)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ContextSection;
