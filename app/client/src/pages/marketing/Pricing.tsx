import { useState } from 'react';
import { Check } from 'lucide-react';
import PageMeta from '../../components/marketing/PageMeta';
import MarketingPageHero from '../../components/marketing/MarketingPageHero';
import CtaBand from '../../components/marketing/CtaBand';
import FaqAccordion from '../../components/marketing/FaqAccordion';
import { PRICING_TIERS, MARKETING_FAQ } from '../../components/marketing/marketingContent';
import { useAuth } from '../../hooks/useAuth';

export default function Pricing() {
  const { login } = useAuth();
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSent, setWaitlistSent] = useState(false);

  function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!waitlistEmail.trim()) return;
    // No backend yet — store locally so the UX feels real during early access.
    try {
      const existing = JSON.parse(localStorage.getItem('takeoff_waitlist') || '[]');
      if (!existing.includes(waitlistEmail.trim())) {
        existing.push(waitlistEmail.trim());
        localStorage.setItem('takeoff_waitlist', JSON.stringify(existing));
      }
    } catch {
      /* ignore storage errors */
    }
    setWaitlistSent(true);
  }

  return (
    <div className="px-6 py-16 sm:py-24">
      <PageMeta
        title="Pricing"
        description="Takeoff is free during early access. Pro plans for teams coming soon."
      />

      <MarketingPageHero
        eyebrow="Pricing"
        headline="Free while we"
        headlineAccent="build with you."
        subhead="Early access includes the full product — no credit card, no time limit while we are in beta."
      />

      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
        {PRICING_TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`rounded-xl p-6 flex flex-col ${
              tier.highlighted
                ? 'bg-stone-900 text-stone-50 border-2 border-stone-900'
                : 'bg-white border border-stone-200'
            }`}
          >
            <div className="mb-6">
              <h3
                className={`text-lg font-semibold mb-1 ${
                  tier.highlighted ? 'text-stone-50' : 'text-stone-900'
                }`}
              >
                {tier.name}
              </h3>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-bold v2-font-serif ${
                    tier.highlighted ? 'text-stone-50' : 'text-stone-900'
                  }`}
                >
                  {tier.price}
                </span>
                {tier.period && (
                  <span
                    className={`text-sm ${
                      tier.highlighted ? 'text-stone-400' : 'text-stone-500'
                    }`}
                  >
                    {tier.period}
                  </span>
                )}
              </div>
              <p
                className={`text-sm mt-2 ${
                  tier.highlighted ? 'text-stone-400' : 'text-stone-600'
                }`}
              >
                {tier.description}
              </p>
            </div>

            <ul className="space-y-3 mb-8 flex-1">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      tier.highlighted ? 'text-amber-400' : 'text-stone-900'
                    }`}
                  />
                  <span className={tier.highlighted ? 'text-stone-300' : 'text-stone-600'}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            {tier.highlighted ? (
              <button
                type="button"
                onClick={() => login('github')}
                className="w-full inline-flex items-center justify-center bg-stone-50 text-stone-900 hover:bg-stone-200 transition-colors rounded px-5 py-2.5 text-sm font-medium"
              >
                {tier.cta}
              </button>
            ) : waitlistSent ? (
              <p className="text-sm text-stone-500 text-center py-2.5">
                You&apos;re on the list — we&apos;ll be in touch.
              </p>
            ) : (
              <form onSubmit={handleWaitlist} className="space-y-2">
                <input
                  type="email"
                  required
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-4 py-2.5 rounded-lg bg-white border border-stone-200 text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-400 text-sm"
                />
                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors rounded px-5 py-2.5 text-sm font-medium"
                >
                  {tier.cta}
                </button>
              </form>
            )}
          </div>
        ))}
      </div>

      <div className="max-w-3xl mx-auto mb-20">
        <FaqAccordion items={MARKETING_FAQ.filter((_, i) => i >= 3)} title="Pricing questions" />
      </div>

      <div className="max-w-3xl mx-auto">
        <CtaBand headline="Start free today" subhead="Full product access during early access — no credit card required." />
      </div>
    </div>
  );
}
