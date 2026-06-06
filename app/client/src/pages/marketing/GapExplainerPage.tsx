import { Link, Navigate, useParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import CtaBand from '../../components/marketing/CtaBand';
import { getGapExplainer, GAP_EXPLAINERS } from '../../components/marketing/gapExplainers';

export default function GapExplainerPage() {
  const { slug } = useParams<{ slug: string }>();
  const gap = slug ? getGapExplainer(slug) : undefined;

  if (!gap) {
    return <Navigate to="/gaps" replace />;
  }

  const Icon = gap.icon;
  const related = GAP_EXPLAINERS.filter((g) => gap.relatedSlugs.includes(g.slug));

  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta title={gap.title} description={gap.summary} />

      <MarketingPageHero
        eyebrow="Gap guide"
        headline={gap.headline}
        headlineAccent={gap.headlineAccent}
        subhead={gap.summary}
      />

      <div className="max-w-3xl mx-auto space-y-12 mb-20">
        {/* Why it matters */}
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
              <Icon className="w-5 h-5 text-amber-700" />
            </div>
            <h2 className="text-lg font-semibold text-stone-900">Why it matters</h2>
          </div>
          <p className="text-sm text-stone-600 leading-relaxed">{gap.whyItMatters}</p>
        </section>

        {/* Signs */}
        <section>
          <h2 className="text-lg font-semibold text-stone-900 mb-4">Signs you have this gap</h2>
          <ul className="space-y-2">
            {gap.signs.map((sign) => (
              <li
                key={sign}
                className="flex items-start gap-3 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg px-4 py-3"
              >
                <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                {sign}
              </li>
            ))}
          </ul>
        </section>

        {/* How to fix */}
        <section>
          <h2 className="text-lg font-semibold text-stone-900 mb-4">How to fix it</h2>
          <div className="space-y-4">
            {gap.howToFix.map((step, i) => (
              <div
                key={step.title}
                className="flex gap-4 bg-white border border-stone-200 rounded-xl p-5"
              >
                <div className="w-8 h-8 rounded-full bg-stone-900 text-stone-50 flex items-center justify-center text-sm font-bold shrink-0">
                  {i + 1}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-stone-900 mb-1">{step.title}</h3>
                  <p className="text-sm text-stone-600 leading-relaxed">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Stack tips */}
        {gap.stacks && gap.stacks.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-stone-900 mb-4">Stack-specific tips</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {gap.stacks.map((stack) => (
                <div
                  key={stack.name}
                  className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3"
                >
                  <p className="text-xs font-semibold text-stone-900 mb-1">{stack.name}</p>
                  <p className="text-xs text-stone-600 leading-relaxed">{stack.tip}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Analyze CTA inline */}
        <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 flex items-start gap-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-stone-900 mb-1">
              Not sure if your repo has this gap?
            </h3>
            <p className="text-sm text-stone-600 leading-relaxed mb-3">
              Takeoff scans your actual codebase and flags {gap.title.toLowerCase()} automatically —
              with copy-paste prompts to fix it.
            </p>
            <Link
              to="/#analyze"
              className="inline-flex items-center justify-center bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors rounded px-4 py-2 text-sm font-medium"
            >
              Analyze my repo
            </Link>
          </div>
        </section>
      </div>

      {related.length > 0 && (
        <div className="max-w-3xl mx-auto mb-12 text-center">
          <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-4">
            Related gaps
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {related.map((r) => (
              <Link
                key={r.slug}
                to={r.path}
                className="px-4 py-2 bg-white border border-stone-200 rounded-full text-sm text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-colors"
              >
                {r.title}
              </Link>
            ))}
            <Link
              to="/gaps"
              className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 underline underline-offset-2"
            >
              All guides
            </Link>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        <CtaBand />
      </div>
    </div>
  );
}
