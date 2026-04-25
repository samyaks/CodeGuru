import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderGit2,
  FileText,
  Loader2,
  ExternalLink,
  Rocket,
  Plus,
  Lightbulb,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchProjects,
  fetchAnalyses,
  fetchReviews,
  type Project,
} from '../services/api';

interface Analysis {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  status: string;
  completion_pct: number;
  created_at: string;
}

interface Review {
  id: string;
  type: string;
  repo_url: string;
  owner: string;
  repo: string;
  pr_number: number | null;
  status: string;
  created_at: string;
}

type Tab = 'projects' | 'analyses' | 'reviews';

const STATUS_COLORS: Record<string, string> = {
  live: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  deployed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  deploying: 'bg-gold/10 text-gold border-gold/20',
  building: 'bg-gold/10 text-gold border-gold/20',
  ready: 'bg-sky-muted/10 text-sky-muted border-sky-border',
  scored: 'bg-sky-muted/10 text-sky-muted border-sky-border',
  failed: 'bg-red-500/10 text-red-600 border-red-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  analyzing: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

function statusBadgeClass(status: string): string {
  return STATUS_COLORS[status] || 'bg-sky-muted/10 text-sky-muted border-sky-border';
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('projects');

  useEffect(() => {
    Promise.all([
      fetchProjects().catch(() => []),
      fetchAnalyses().catch(() => []),
      fetchReviews().catch(() => []),
    ]).then(([p, a, r]) => {
      setProjects(p);
      setAnalyses(a);
      setReviews(r);
      setLoading(false);
    });
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'projects', label: 'Projects' },
    { key: 'analyses', label: 'Analyses' },
    { key: 'reviews', label: 'Reviews' },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo="/" title="Dashboard">
        <Link
          to="/"
          className="ml-4 inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
        >
          <Plus size={16} />
          Analyze New App
        </Link>
      </Header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-navy rounded-lg p-1 w-fit border border-sky-border/50">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-gold/10 text-gold border border-gold/20'
                  : 'text-sky-muted hover:text-sky-white border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-24">
            <Loader2 size={32} className="animate-spin text-sky-muted" />
          </div>
        )}

        {/* Projects Tab */}
        {!loading && tab === 'projects' && projects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={48} />}
            title="No projects yet"
            description="Analyze your first app to get started."
          />
        )}

        {!loading && tab === 'projects' && projects.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}

        {/* Analyses Tab */}
        {!loading && tab === 'analyses' && analyses.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={48} />}
            title="No analyses yet"
            description="Run an analysis on a GitHub repo to see it here."
          />
        )}

        {!loading && tab === 'analyses' && analyses.length > 0 && (
          <div className="space-y-3">
            {analyses.map((a) => (
              <Link
                key={a.id}
                to={a.status === 'completed' ? `/results/${a.id}` : `/analyze/${a.id}`}
                className="block bg-navy border border-sky-border/50 rounded-xl px-5 py-4 hover:border-gold/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sky-white">{a.owner}/{a.repo}</p>
                    <p className="text-xs text-sky-muted mt-0.5">
                      {new Date(a.created_at).toLocaleDateString()} · {a.status}
                    </p>
                  </div>
                  {a.completion_pct != null && (
                    <span className="text-sm font-semibold text-gold">{a.completion_pct}%</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Reviews Tab */}
        {!loading && tab === 'reviews' && reviews.length === 0 && (
          <EmptyState
            icon={<FileText size={48} />}
            title="No reviews yet"
            description="Create a code review to see it here."
          />
        )}

        {!loading && tab === 'reviews' && reviews.length > 0 && (
          <div className="space-y-3">
            {reviews.map((r) => (
              <Link
                key={r.id}
                to={r.status === 'completed' ? `/review/${r.id}` : `/review/${r.id}/progress`}
                className="block bg-navy border border-sky-border/50 rounded-xl px-5 py-4 hover:border-gold/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sky-white">
                      {r.owner}/{r.repo}
                      {r.pr_number && <span className="text-sky-muted"> #{r.pr_number}</span>}
                    </p>
                    <p className="text-xs text-sky-muted mt-0.5">
                      {r.type} review · {new Date(r.created_at).toLocaleDateString()} · {r.status}
                    </p>
                  </div>
                  <ExternalLink size={16} className="text-sky-muted" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const score = project.readiness_score;
  const deployed = project.status === 'live' || project.status === 'deployed';
  const displayDate = project.updated_at || project.created_at;

  return (
    <div className="bg-navy border border-sky-border/50 rounded-xl hover:border-gold/30 transition-colors group">
    <Link
      to={`/projects/${project.id}`}
      className="block p-5"
    >
      {/* Top: name + status */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-sky-white truncate group-hover:text-gold transition-colors">
            {project.owner}/{project.repo}
          </p>
        </div>
        <span
          className={`flex-shrink-0 px-2 py-0.5 rounded text-[11px] font-medium border ${statusBadgeClass(project.status)}`}
        >
          {project.status}
        </span>
      </div>

      {/* Middle: score + framework */}
      <div className="flex items-center gap-4 mb-3">
        {score != null && (
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full border-2 border-gold/30 bg-midnight flex items-center justify-center">
              <span className="text-sm font-bold text-sky-white">{score}%</span>
            </div>
            <span className="text-xs text-sky-muted">Readiness</span>
          </div>
        )}
        {project.framework && (
          <span className="px-2 py-0.5 rounded text-xs bg-navy-mid border border-sky-border text-sky-off">
            {project.framework}
          </span>
        )}
        {project.suggestions_count != null && project.suggestions_count > 0 && (
          <span className="px-2 py-0.5 rounded text-xs bg-gold/10 border border-gold/20 text-gold flex items-center gap-1">
            <Lightbulb size={10} />
            {project.suggestions_count}
          </span>
        )}
      </div>

      {/* Bottom: live URL or date */}
      <div className="flex items-center justify-between text-xs">
        {deployed && project.live_url ? (
          <span className="flex items-center gap-1 text-emerald-600">
            <Rocket size={12} />
            Live
          </span>
        ) : (
          <span className="text-sky-muted">
            {displayDate ? new Date(displayDate).toLocaleDateString() : ''}
          </span>
        )}
        <span className="text-sky-muted group-hover:text-gold transition-colors">
          View →
        </span>
      </div>
    </Link>
    <div className="px-5 pb-3 -mt-1 border-t border-sky-border/40">
      <Link
        to={`/projects/${project.id}/map`}
        className="text-xs font-medium text-rose-400/90 hover:text-rose-400 transition-colors"
      >
        Product map →
      </Link>
    </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
      <div className="text-sky-muted">{icon}</div>
      <h2 className="text-xl font-semibold text-sky-white">{title}</h2>
      <p className="text-sky-muted max-w-md">{description}</p>
      <Link
        to="/"
        className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold text-midnight text-sm font-semibold hover:bg-gold-dim transition-colors"
      >
        <Plus size={16} />
        Analyze a repo
      </Link>
    </div>
  );
}
