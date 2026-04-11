import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
          <span className="w-[7px] h-[7px] rounded-full bg-gold shadow-[0_0_0_2px_rgba(201,164,32,0.2)] animate-pulse flex-shrink-0" />
          <span className="font-serif text-xl font-normal tracking-[0.04em] text-sky-white">
            Takeoff
          </span>
        </Link>
        {title && (
          <>
            <span className="text-sky-border">/</span>
            <h1 className="text-sm font-medium text-sky-off">{title}</h1>
          </>
        )}
        {children}
      </div>
      <nav className="flex items-center gap-6">
        <Link
          to="/dashboard"
          className="hidden md:inline font-mono text-[0.62rem] tracking-[0.18em] uppercase text-sky-muted hover:text-sky-white transition-colors"
        >
          Dashboard
        </Link>
        <UserMenu />
      </nav>
    </header>
  );
}
