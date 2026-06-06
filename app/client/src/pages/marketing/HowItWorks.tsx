import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import CtaBand from '../../components/marketing/CtaBand';
import { HOW_IT_WORKS_STEPS, STACK_LOGOS } from '../../components/marketing/marketingContent';

export default function HowItWorks() {
  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta
        title="How it works"
        description="Connect your GitHub repo, get a readiness map in under two minutes, and ship with AI context files and gap-fix prompts."
      />

      <MarketingPageHero
        eyebrow="How it works"
        headline="Three steps from"
        headlineAccent="vibe code to production."
        subhead="No install, no clone. Takeoff reads your repo via the GitHub API and tells you exactly what to build next."
      />

      <div className="max-w-3xl mx-auto space-y-8 mb-20">
        {HOW_IT_WORKS_STEPS.map((step) => (
          <div
            key={step.step}
            className="flex gap-6 bg-white border border-stone-200 rounded-xl p-6"
          >
            <div className="w-10 h-10 rounded-full bg-stone-900 text-stone-50 flex items-center justify-center text-sm font-bold shrink-0">
              {step.step}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-stone-900 mb-2">{step.title}</h3>
              <p className="text-sm text-stone-600 leading-relaxed">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-3xl mx-auto mb-20 text-center">
        <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-4">
          Works with your stack
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {STACK_LOGOS.map((name) => (
            <span
              key={name}
              className="px-3 py-1.5 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-600"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <CtaBand />
      </div>
    </div>
  );
}
