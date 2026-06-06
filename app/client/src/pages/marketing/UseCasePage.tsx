import { Link, Navigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import CtaBand from '../../components/marketing/CtaBand';
import { USE_CASES } from '../../components/marketing/marketingContent';

export default function UseCasePage() {
  const { slug } = useParams<{ slug: string }>();
  const config = USE_CASES.find((c) => c.slug === slug);

  if (!config) {
    return <Navigate to="/" replace />;
  }

  const Icon = config.icon;
  const otherCases = USE_CASES.filter((c) => c.slug !== slug);

  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta
        title={config.eyebrow}
        description={config.subhead}
      />

      <MarketingPageHero
        eyebrow={config.eyebrow}
        headline={config.headline}
        headlineAccent={config.headlineAccent}
        subhead={config.subhead}
      />

      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 mb-20">
        <div>
          <h2 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center">
              <X className="w-4 h-4 text-red-600" />
            </span>
            Sound familiar?
          </h2>
          <ul className="space-y-3">
            {config.pains.map((pain) => (
              <li
                key={pain}
                className="flex items-start gap-3 text-sm text-stone-600 bg-white border border-stone-200 rounded-lg px-4 py-3"
              >
                <span className="text-stone-300 mt-0.5">—</span>
                {pain}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-stone-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
              <Icon className="w-4 h-4 text-emerald-600" />
            </span>
            What Takeoff gives you
          </h2>
          <div className="space-y-4">
            {config.outcomes.map((outcome) => (
              <div
                key={outcome.title}
                className="bg-white border border-stone-200 rounded-lg px-4 py-4"
              >
                <h3 className="text-sm font-semibold text-stone-900 mb-1">{outcome.title}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{outcome.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {config.quote && (
        <blockquote className="max-w-2xl mx-auto text-center mb-20">
          <p className="text-lg text-stone-700 italic v2-font-serif leading-relaxed mb-3">
            &ldquo;{config.quote.text}&rdquo;
          </p>
          <footer className="text-sm text-stone-500">— {config.quote.attribution}</footer>
        </blockquote>
      )}

      <div className="max-w-3xl mx-auto mb-12">
        <CtaBand />
      </div>

      <div className="max-w-3xl mx-auto text-center">
        <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-4">
          Also for
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {otherCases.map((c) => (
            <Link
              key={c.slug}
              to={c.path}
              className="px-4 py-2 bg-white border border-stone-200 rounded-full text-sm text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-colors"
            >
              {c.eyebrow}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
