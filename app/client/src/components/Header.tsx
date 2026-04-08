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
    <header className="flex items-center justify-between px-6 py-4 border-b border-sky-border/50">
      <div className="flex items-center gap-3">
        {backTo && (
          <Link to={backTo} className="text-sky-muted hover:text-sky-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
        )}
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gold/20 border border-gold/30 flex items-center justify-center font-bold text-sm text-gold">
            T
          </div>
          <span className="font-semibold text-lg text-sky-white">Takeoff</span>
        </Link>
        {title && (
          <>
            <span className="text-sky-border">/</span>
            <h1 className="text-lg font-semibold text-sky-white">{title}</h1>
          </>
        )}
        {children}
      </div>
      <nav className="flex items-center gap-4">
        <Link to="/dashboard" className="text-sm text-sky-muted hover:text-sky-white transition-colors">
          Dashboard
        </Link>
        <UserMenu />
      </nav>
    </header>
  );
}
