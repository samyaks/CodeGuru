import { Link } from 'react-router-dom';
import { ArrowLeft, Github } from 'lucide-react';
import UserMenu from './UserMenu';

interface HeaderProps {
  backTo?: string;
  title?: string;
  children?: React.ReactNode;
}

export default function Header({ backTo, title, children }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/50">
      <div className="flex items-center gap-3">
        {backTo && (
          <Link to={backTo} className="text-neutral-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
        )}
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-sm">
            C
          </div>
          <span className="font-semibold text-lg">CodeGuru</span>
        </Link>
        {title && (
          <>
            <span className="text-neutral-700">/</span>
            <h1 className="text-lg font-semibold">{title}</h1>
          </>
        )}
        {children}
      </div>
      <nav className="flex items-center gap-4">
        <Link to="/dashboard" className="text-sm text-neutral-400 hover:text-white transition-colors">
          Dashboard
        </Link>
        <UserMenu />
        <a
          href="https://github.com/samyaks/CodeGuru"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-400 hover:text-white transition-colors"
        >
          <Github size={20} />
        </a>
      </nav>
    </header>
  );
}
