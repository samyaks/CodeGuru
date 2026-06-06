import { Link } from 'react-router-dom';

const FOOTER_LINKS = {
  Product: [
    { to: '/features', label: 'Features' },
    { to: '/demo', label: 'Demo' },
    { to: '/how-it-works', label: 'How it works' },
    { to: '/pricing', label: 'Pricing' },
  ],
  Resources: [
    { to: '/gaps', label: 'Gap guides' },
    { to: '/gaps/missing-auth', label: 'Missing auth' },
    { to: '/gaps/missing-database', label: 'Missing database' },
    { to: '/gaps/missing-deployment', label: 'Missing deployment' },
  ],
  'Use cases': [
    { to: '/for/vibe-coders', label: 'Vibe coders' },
    { to: '/for/pms', label: 'Product managers' },
    { to: '/for/agencies', label: 'Agencies' },
  ],
};

export default function MarketingFooter() {
  return (
    <footer className="border-t border-stone-200 bg-white v2-font-sans">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div>
            <p className="text-sm font-bold text-stone-900 mb-2">Takeoff</p>
            <p className="text-sm text-stone-600 leading-relaxed max-w-xs">
              From vibe code to production. Analyze your repo, map it to user needs, and ship
              with AI context.
            </p>
          </div>
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-3">
                {heading}
              </p>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-sm text-stone-600 hover:text-stone-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 pt-6 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <span>&copy; {new Date().getFullYear()} Takeoff</span>
          <span>Reads ~30 key files via GitHub API — never clones your repo</span>
        </div>
      </div>
    </footer>
  );
}
