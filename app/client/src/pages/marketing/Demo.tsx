import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import DemoPreview from '../../components/marketing/DemoPreview';
import CtaBand from '../../components/marketing/CtaBand';
import { GAP_EXPLAINERS } from '../../components/marketing/gapExplainers';
import { Link } from 'react-router-dom';

export default function Demo() {
  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta
        title="Demo"
        description="See what Takeoff finds when it analyzes a real open-source repo — readiness score, gaps, product map, and security scan."
      />

      <MarketingPageHero
        eyebrow="Live demo"
        headline="See what Takeoff"
        headlineAccent="finds in your repo."
        subhead="This is a sample report from shadcn-ui/taxonomy — readiness breakdown, product map, and top gaps. Analyze your own repo to get the real thing."
      />

      <div className="max-w-5xl mx-auto mb-16">
        <DemoPreview />
      </div>

      <div className="max-w-3xl mx-auto mb-20">
        <h2 className="text-lg font-semibold text-stone-900 mb-4 text-center">
          Common gaps we detect
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {GAP_EXPLAINERS.slice(0, 5).map((gap) => (
            <Link
              key={gap.slug}
              to={gap.path}
              className="px-3 py-1.5 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-colors"
            >
              {gap.title}
            </Link>
          ))}
          <Link
            to="/gaps"
            className="px-3 py-1.5 text-xs font-medium text-stone-500 hover:text-stone-700 underline underline-offset-2"
          >
            View all guides
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <CtaBand
          headline="Get your own report in under 2 minutes"
          subhead="Paste a public GitHub URL or connect your account — no install required."
        />
      </div>
    </div>
  );
}
