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
    <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
      <div className="flex items-center gap-3">
        {backTo && (
          <Link to={backTo} className="text-zinc-400 hover:text-zinc-100 transition-colors">
            <ArrowLeft size={20} />
          </Link>
        )}
        <Link to="/" className="flex items-center gap-2">
          <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20 -rotate-[10deg]">
            <Rocket size={22} stroke="black" strokeWidth={2.5} />
          </div>
          <span className="text-2xl font-extrabold tracking-tighter text-zinc-100">Takeoff</span>
          <span className="text-xs font-semibold px-2 py-0.5 bg-zinc-800 rounded text-zinc-500 uppercase tracking-widest">v1.0</span>
        </Link>
        {title && (
          <>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
          </>
        )}
        {children}
      </div>
      <nav className="flex items-center gap-4">
        <Link to="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">
          Dashboard
        </Link>
        <UserMenu />
      </nav>
    </header>
  );
}
