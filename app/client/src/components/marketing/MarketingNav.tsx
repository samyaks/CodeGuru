import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Zap, Menu, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const NAV_LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/demo', label: 'Demo' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/pricing', label: 'Pricing' },
];

const USE_CASE_LINKS = [
  { to: '/for/vibe-coders', label: 'Vibe coders' },
  { to: '/for/pms', label: 'PMs' },
  { to: '/for/agencies', label: 'Agencies' },
];

function NavLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const active = pathname === to;
  return (
    <Link
      to={to}
      className={`text-sm transition-colors ${
        active
          ? 'text-stone-900 font-medium'
          : 'text-stone-600 hover:text-stone-900'
      }`}
    >
      {label}
    </Link>
  );
}

export default function MarketingNav() {
  const { user, login } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [useCasesOpen, setUseCasesOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/80 backdrop-blur v2-font-sans">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link
          to="/"
          aria-label="Takeoff home"
          className="flex items-center gap-3 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 rounded"
        >
          <div className="w-9 h-9 bg-stone-900 rounded flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-stone-50" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <span className="text-lg font-bold text-stone-900 tracking-tight block leading-tight">
              Takeoff
            </span>
            <span className="text-xs text-stone-500 hidden sm:block">AI in the loop</span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} {...link} />
          ))}
          <div
            className="relative"
            onMouseEnter={() => setUseCasesOpen(true)}
            onMouseLeave={() => setUseCasesOpen(false)}
          >
            <button
              type="button"
              className="text-sm text-stone-600 hover:text-stone-900 transition-colors"
            >
              Use cases
            </button>
            {useCasesOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2">
                <div className="bg-white border border-stone-200 rounded-lg shadow-lg py-2 min-w-[160px]">
                  {USE_CASE_LINKS.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className="block px-4 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </nav>

        <div className="flex items-center gap-2 flex-shrink-0">
          {user ? (
            <Link
              to="/dashboard"
              className="hidden sm:inline text-sm text-stone-600 hover:text-stone-900 transition-colors px-2"
            >
              Dashboard
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => login('github')}
              className="hidden sm:inline text-sm text-stone-600 hover:text-stone-900 transition-colors px-2"
            >
              Sign in
            </button>
          )}
          <Link
            to="/#analyze"
            className="inline-flex items-center justify-center bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors rounded px-4 py-2 text-sm font-medium"
          >
            Analyze repo
          </Link>
          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="lg:hidden p-2 text-stone-600 hover:text-stone-900"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-stone-200 bg-white px-6 py-4 space-y-4">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className="block text-sm text-stone-700"
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-stone-100">
            <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">
              Use cases
            </p>
            {USE_CASE_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className="block py-1.5 text-sm text-stone-700"
              >
                {link.label}
              </Link>
            ))}
          </div>
          {!user && (
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                login('github');
              }}
              className="block text-sm text-stone-700"
            >
              Sign in with GitHub
            </button>
          )}
        </div>
      )}
    </header>
  );
}
