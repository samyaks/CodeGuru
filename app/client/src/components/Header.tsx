import { Link } from 'react-router-dom';
import { ArrowLeft, Rocket } from 'lucide-react';
import UserMenu from './UserMenu';

interface HeaderProps {
  backTo?: string;
  title?: string;
  children?: React.ReactNode;
}

export default function Header({ backTo, title, children }: HeaderProps) {
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
