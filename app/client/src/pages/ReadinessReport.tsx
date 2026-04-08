import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, AlertCircle, Rocket, ClipboardList } from 'lucide-react';
import Header from '../components/Header';
import { fetchProject, type Project, type ReadinessCategory } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const STATUS_ICON = {
  ready: <CheckCircle2 size={18} className="text-emerald-400" />,
  partial: <AlertCircle size={18} className="text-amber-400" />,
  missing: <XCircle size={18} className="text-red-400" />,
};

export default function ReadinessReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchProject(id)
      .then(setProject)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && project && (project.status === 'analyzing' || project.status === 'pending')) {
      navigate(`/takeoff/${id}`, { replace: true });
    }
  }, [loading, project, id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-sky-muted">Loading report...</div>
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-red-400">{error || 'Project not found'}</div>
        </main>
      </div>
    );
  }

  if (project.status === 'analyzing' || project.status === 'pending') {
    return null;
  }

  const score = project.readiness_score ?? 0;
  const categories: Record<string, ReadinessCategory> = project.readiness_categories || {};
  const recommendation = project.recommendation || 'plan';
  const stack = project.stack_info || {};
  const buildPlan = project.build_plan || {};
  const isDeployRecommended = recommendation === 'deploy';

  const stackBadges = [
    stack.framework,
    stack.styling,
    stack.database,
    stack.auth,
    ...(stack.languages || []),
  ].filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo="/" title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 px-6 py-10 max-w-3xl mx-auto w-full space-y-10">
        {/* Score */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-28 h-28 rounded-full border-4 border-gold/30 bg-navy">
            <span className="text-4xl font-bold text-sky-white">{score}%</span>
          </div>
          <h1 className="text-2xl font-semibold text-sky-white">Production Readiness</h1>
          <p className="text-sky-muted text-sm max-w-md mx-auto">
            {score >= 90
              ? 'Your app looks ready to deploy. You can ship it now or review the details below.'
              : `Your app is ${score}% of the way there. We've identified what's missing and built you a plan.`}
          </p>
        </div>

        {/* Stack badges */}
        {stackBadges.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {stackBadges.map((badge) => (
              <span key={badge} className="px-3 py-1 rounded-full text-xs bg-navy border border-sky-border text-sky-off">
                {badge}
              </span>
            ))}
            {buildPlan.type && (
              <span className="px-3 py-1 rounded-full text-xs bg-gold/10 border border-gold/20 text-gold">
                {buildPlan.type === 'static' ? 'Static site' : buildPlan.type === 'fullstack' ? 'Full-stack' : buildPlan.type}
              </span>
            )}
          </div>
        )}

        {/* Category breakdown */}
        <div className="grid gap-2">
          {Object.entries(categories).map(([key, cat]) => (
            <div key={key} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-navy border border-sky-border/50">
              {STATUS_ICON[cat.status]}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-sky-white">{cat.label}</div>
                <div className="text-xs text-sky-muted truncate">{cat.detail}</div>
              </div>
              <div className="text-xs text-sky-muted">{cat.earned}/{cat.weight}</div>
            </div>
          ))}
        </div>

        {/* Dual-path choice */}
        <div className="grid md:grid-cols-2 gap-4">
          <button
            onClick={() => {
              if (!user) {
                alert('Please log in to deploy.');
                return;
              }
              navigate(`/deploy/${id}`);
            }}
            className={`p-6 rounded-xl border text-left transition-all ${
              isDeployRecommended
                ? 'bg-gold/10 border-gold/30 hover:bg-gold/20 ring-1 ring-gold/20'
                : 'bg-navy border-sky-border hover:bg-navy-mid'
            }`}
          >
            <Rocket size={24} className={isDeployRecommended ? 'text-gold mb-3' : 'text-sky-muted mb-3'} />
            <h3 className="font-semibold text-sky-white mb-1">
              {isDeployRecommended ? 'Deploy Now' : 'Deploy Anyway'}
            </h3>
            <p className="text-xs text-sky-muted">
              {isDeployRecommended
                ? 'Your app looks ready. Ship it to the world.'
                : 'Ship as-is. You can improve later.'}
            </p>
            {isDeployRecommended && (
              <span className="inline-block mt-3 text-xs text-gold font-medium">Recommended</span>
            )}
          </button>

          <Link
            to={`/takeoff/${id}/plan`}
            className={`p-6 rounded-xl border text-left transition-all block ${
              !isDeployRecommended
                ? 'bg-gold/10 border-gold/30 hover:bg-gold/20 ring-1 ring-gold/20'
                : 'bg-navy border-sky-border hover:bg-navy-mid'
            }`}
          >
            <ClipboardList size={24} className={!isDeployRecommended ? 'text-gold mb-3' : 'text-sky-muted mb-3'} />
            <h3 className="font-semibold text-sky-white mb-1">
              {!isDeployRecommended ? 'Plan to Ship' : 'See Plan Anyway'}
            </h3>
            <p className="text-xs text-sky-muted">
              {!isDeployRecommended
                ? `${Object.values(categories).filter((c) => c.status === 'missing').length} things to add. Context files + prompts for each step.`
                : 'Review what could be improved with context files for each area.'}
            </p>
            {!isDeployRecommended && (
              <span className="inline-block mt-3 text-xs text-gold font-medium">Recommended</span>
            )}
          </Link>
        </div>
      </main>
    </div>
  );
}
