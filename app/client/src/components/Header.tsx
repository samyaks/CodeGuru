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
    <header className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-12 h-[60px] bg-midnight/90 backdrop-blur-lg border-b border-sky-border">
      <div className="flex items-center gap-3">
        {backTo && (
          <Link to={backTo} className="text-sky-muted hover:text-sky-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
        )}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gold/15 flex items-center justify-center">
            <Rocket size={18} className="text-gold rotate-[-45deg]" />
          </div>
          <span className="text-xl font-extrabold tracking-tighter text-sky-white">
            Takeoff
          </span>
          <span className="hidden sm:inline px-2 py-0.5 rounded-md bg-navy-mid text-zinc-500 text-xs font-medium">
            v0.1
          </span>
        </Link>
        {title && (
          <>
            <span className="text-sky-border">/</span>
            <h1 className="text-sm font-medium text-sky-muted">{title}</h1>
          </>
        )}
        {children}
      </div>
      <nav className="flex items-center gap-6">
        <Link
          to="/dashboard"
          className="hidden md:inline text-sm font-medium text-sky-muted hover:text-sky-white transition-colors"
        >
          Dashboard
        </Link>
        <UserMenu />
      </nav>
    </header>
  );
}
