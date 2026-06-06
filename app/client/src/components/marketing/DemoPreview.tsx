import { Link } from 'react-router-dom';
import { Shield, ExternalLink } from 'lucide-react';
import { Badge, ProgressBar } from '../v2';
import { DEMO_PROJECT, DEMO_PROJECT_ID } from './demoContent';

function ReadinessRow({
  label,
  score,
  status,
  detail,
}: {
  label: string;
  score: number;
  status: 'missing' | 'partial' | 'ready';
  detail: string;
}) {
  const tone = status === 'ready' ? 'success' : status === 'partial' ? 'warning' : 'danger';
  return (
    <div className="flex items-center gap-4 py-2">
      <span className="text-sm text-stone-700 w-36 shrink-0">{label}</span>
      <div className="flex-1">
        <ProgressBar value={score} tone={tone} label={`${label} readiness`} />
      </div>
      <span className="text-xs text-stone-500 w-44 shrink-0 text-right hidden sm:block truncate">
        {detail}
      </span>
    </div>
  );
}

export default function DemoPreview() {
  const { repo, framework, description, readinessScore, securityScore, readinessCategories, gaps, personas } =
    DEMO_PROJECT;

  return (
    <div className="relative">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
          Sample report — not your repo
        </span>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden mt-2">
        {/* Project header */}
        <div className="px-6 py-6 border-b border-stone-100 bg-stone-50/50">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Example analysis</p>
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h3 className="text-2xl font-bold text-stone-900 v2-font-serif">{repo}</h3>
              <p className="text-sm text-stone-500 mt-1">{framework} · {description.slice(0, 80)}…</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-xs text-stone-500 mb-1">Readiness</p>
                <p className="text-3xl font-bold text-stone-900 tabular-nums v2-font-serif">{readinessScore}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-stone-500 mb-1 flex items-center gap-1 justify-center">
                  <Shield className="w-3 h-3" /> Security
                </p>
                <p className="text-3xl font-bold text-stone-900 tabular-nums v2-font-serif">{securityScore}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-stone-100">
          {/* Readiness breakdown */}
          <div className="px-6 py-6">
            <h4 className="text-sm font-semibold text-stone-900 mb-4">Readiness breakdown</h4>
            <div className="space-y-1">
              {readinessCategories.map((cat) => (
                <ReadinessRow key={cat.label} {...cat} />
              ))}
            </div>
          </div>

          {/* Product map teaser */}
          <div className="px-6 py-6">
            <h4 className="text-sm font-semibold text-stone-900 mb-4">Product map</h4>
            <div className="space-y-3">
              {personas.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between bg-stone-50 border border-stone-100 rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">{p.name}</p>
                    <p className="text-xs text-stone-500">{p.topJob}</p>
                  </div>
                  <span
                    className={`text-lg font-bold tabular-nums v2-font-serif ${
                      p.score >= 70 ? 'text-emerald-600' : p.score >= 50 ? 'text-amber-600' : 'text-red-600'
                    }`}
                  >
                    {p.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sample gaps */}
        <div className="px-6 py-6 border-t border-stone-100">
          <h4 className="text-sm font-semibold text-stone-900 mb-4">Top gaps detected</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {gaps.map((gap) => (
              <div
                key={gap.id}
                className="bg-white border border-stone-200 rounded-lg p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={gap.category}>{gap.category}</Badge>
                  <span className="text-xs text-stone-500">{gap.effort} effort</span>
                </div>
                <h5 className="text-sm font-semibold text-stone-900 mb-1">{gap.title}</h5>
                <p className="text-xs text-stone-600 leading-relaxed line-clamp-3">{gap.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 bg-stone-50 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            This is a representative sample. Your report is generated from your actual codebase.
          </p>
          <div className="flex items-center gap-3">
            {DEMO_PROJECT_ID ? (
              <Link
                to={`/projects/${DEMO_PROJECT_ID}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 hover:text-stone-900 transition-colors"
              >
                View full live report
                <ExternalLink className="w-3 h-3" />
              </Link>
            ) : null}
            <Link
              to="/#analyze"
              className="inline-flex items-center justify-center bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors rounded px-4 py-2 text-xs font-medium"
            >
              Analyze your repo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
