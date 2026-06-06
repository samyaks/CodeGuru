import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import CtaBand from '../../components/marketing/CtaBand';
import { GAP_EXPLAINERS } from '../../components/marketing/gapExplainers';

export default function GapsIndex() {
  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta
        title="Gap guides"
        description="Learn what each shipping gap means — missing auth, database, deployment, tests, and more — and how to fix it in your vibe-coded app."
      />

      <MarketingPageHero
        eyebrow="Gap guides"
        headline="Know what's missing"
        headlineAccent="before you ship."
        subhead="Takeoff detects seven categories of production gaps. Each guide explains why it matters, how to spot it, and how to fix it — then analyze your repo to see which ones you have."
      />

      <div className="max-w-3xl mx-auto grid grid-cols-1 gap-4 mb-20">
        {GAP_EXPLAINERS.map((gap) => {
          const Icon = gap.icon;
          return (
            <Link
              key={gap.slug}
              to={gap.path}
              className="group flex items-start gap-4 bg-white border border-stone-200 rounded-xl p-5 hover:border-stone-400 hover:shadow-sm transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center shrink-0 group-hover:bg-stone-200 transition-colors">
                <Icon className="w-5 h-5 text-stone-900" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-stone-900 mb-1">{gap.title}</h3>
                <p className="text-sm text-stone-600 leading-relaxed">{gap.summary}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-stone-400 shrink-0 mt-1 group-hover:text-stone-700 transition-colors" />
            </Link>
          );
        })}
      </div>

      <div className="max-w-3xl mx-auto">
        <CtaBand subhead="Paste a GitHub URL and Takeoff will tell you which of these gaps your repo has." />
      </div>
    </div>
  );
}
