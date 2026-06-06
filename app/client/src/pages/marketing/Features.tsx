import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import CtaBand from '../../components/marketing/CtaBand';
import { MARKETING_FEATURES } from '../../components/marketing/marketingContent';

export default function Features() {
  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta
        title="Features"
        description="Product map, readiness score, security reports, and AI context files — everything you need to ship your vibe-coded app."
      />

      <MarketingPageHero
        eyebrow="Features"
        headline="Everything you need to"
        headlineAccent="finish the last 40%."
        subhead="Takeoff reads your real codebase and turns it into actionable maps, scores, and context — so you stop guessing and start shipping."
      />

      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
        {MARKETING_FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="bg-white border border-stone-200 rounded-xl p-6 hover:border-stone-400 hover:shadow-sm transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-stone-900" />
              </div>
              <h3 className="text-lg font-semibold text-stone-900 mb-2">{feature.title}</h3>
              <p className="text-sm text-stone-600 leading-relaxed mb-3">{feature.body}</p>
              <p className="text-sm text-stone-500 leading-relaxed">{feature.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="max-w-3xl mx-auto">
        <CtaBand />
      </div>
    </div>
  );
}
