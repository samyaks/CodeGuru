interface MarketingPageHeroProps {
  eyebrow?: string;
  headline: string;
  headlineAccent?: string;
  subhead: string;
  centered?: boolean;
}

export default function MarketingPageHero({
  eyebrow,
  headline,
  headlineAccent,
  subhead,
  centered = true,
}: MarketingPageHeroProps) {
  return (
    <div className={`max-w-3xl ${centered ? 'mx-auto text-center' : ''} mb-16`}>
      {eyebrow && (
        <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full inline-block px-3 py-1 mb-6">
          {eyebrow}
        </p>
      )}
      <h1
        className="font-bold text-stone-900 tracking-tight mb-5 v2-font-serif"
        style={{
          fontSize: 'clamp(2rem, 4.5vw, 3.25rem)',
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
        }}
      >
        {headline}
        {headlineAccent && (
          <>
            <br />
            <span className="text-amber-600">{headlineAccent}</span>
          </>
        )}
      </h1>
      <p className="text-base text-stone-600 leading-relaxed max-w-2xl mx-auto">
        {subhead}
      </p>
    </div>
  );
}
