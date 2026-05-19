import { Link } from 'react-router-dom';
import { ArrowLeft, Rocket, Zap } from 'lucide-react';
import UserMenu from './UserMenu';

export interface HeaderProps {
  /** Optional back link rendered to the left of the brand mark. */
  backTo?: string;
  /** Page title rendered next to the brand mark. In `app` variant it's
   *  appended after a "/" separator; in `workspace` variant it replaces
   *  the "Takeoff / AI in the loop" wordmark so the page name takes the
   *  prominent slot (matches the v2 SecurityReport / Project chrome). */
  title?: string;
  /** Optional subtitle rendered under the title in the `workspace`
   *  variant. Ignored in the `app` variant. */
  subtitle?: React.ReactNode;
  /** Inline content in the LEFT cluster, after the title — typically
   *  breadcrumbs or status pills. Matches the legacy v1 Header API so
   *  existing callers (Landing, Dashboard) keep working unchanged. */
  children?: React.ReactNode;
  /** Page-specific action buttons in the RIGHT cluster, rendered
   *  BEFORE the Dashboard nav link and UserMenu. Use this for things
   *  like Back / Share / Re-analyze on report surfaces. */
  actions?: React.ReactNode;
  /** Visual variant:
   *  - `'app'` (default): legacy v1 chrome — Rocket icon, "Takeoff v0.1"
   *    pill, semantic color tokens. Keep for marketing / list surfaces.
   *  - `'workspace'`: v2 chrome — stone-900 Zap square, stone palette,
   *    white/80 backdrop. Use for product workspace surfaces (project
   *    detail, security report, takeoff progress, build story). */
  variant?: 'app' | 'workspace';
}

export default function Header({
  backTo,
  title,
  subtitle,
  children,
  actions,
  variant = 'app',
}: HeaderProps) {
  if (variant === 'workspace') {
    return (
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/80 backdrop-blur v2-font-sans">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {backTo && (
              <Link
                to={backTo}
                aria-label="Back"
                className="p-1 rounded text-stone-500 hover:text-stone-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 flex-shrink-0"
              >
                <ArrowLeft size={18} />
              </Link>
            )}
            <Link
              to="/"
              aria-label="Takeoff home"
              className="flex items-center gap-3 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 rounded"
            >
              <div className="w-9 h-9 bg-stone-900 rounded flex items-center justify-center flex-shrink-0">
                <Zap className="w-4 h-4 text-stone-50" strokeWidth={2.5} />
              </div>
              {!title && (
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-stone-900 tracking-tight">Takeoff</h1>
                  <p className="text-xs text-stone-500">AI in the loop</p>
                </div>
              )}
            </Link>
            {title && (
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-stone-900 tracking-tight truncate">
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-xs text-stone-500 inline-flex items-center gap-1.5">
                    {subtitle}
                  </p>
                )}
              </div>
            )}
            {children}
          </div>
          <nav className="flex items-center gap-2 flex-shrink-0">
            {actions}
            <Link
              to="/dashboard"
              className="hidden md:inline text-sm text-stone-600 hover:text-stone-900 transition-colors px-2"
            >
              Dashboard
            </Link>
            <UserMenu />
          </nav>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-12 h-[60px] bg-surface/92 backdrop-blur-lg border-b border-line">
      <div className="flex items-center gap-3">
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back"
            className="p-1 rounded-md text-text-faint hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <ArrowLeft size={20} />
          </Link>
        )}
        <Link
          to="/"
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-md"
        >
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shrink-0">
            <Rocket size={17} className="text-white -rotate-45" />
          </div>
          <span className="text-xl font-extrabold tracking-tighter text-text">Takeoff</span>
          <span className="hidden sm:inline px-2 py-0.5 rounded-md bg-surface-2 text-text-faint text-xs font-medium">
            v0.1
          </span>
        </Link>
        {title && (
          <>
            <span className="text-text-disabled" aria-hidden>
              /
            </span>
            <h1 className="text-sm font-medium text-text-muted">{title}</h1>
          </>
        )}
        {children}
      </div>
      <nav className="flex items-center gap-6">
        {actions}
        <Link
          to="/dashboard"
          className="hidden md:inline text-sm font-medium text-text-muted hover:text-text transition-colors"
        >
          Dashboard
        </Link>
        <UserMenu />
      </nav>
    </header>
  );
}
