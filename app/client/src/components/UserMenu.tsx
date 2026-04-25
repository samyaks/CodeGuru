import { useState, useRef, useEffect } from 'react';
import { LogOut, Github } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function UserMenu() {
  const { user, loading, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (loading) return null;

  if (!user) {
    return (
      <button
        onClick={() => login('github')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-md px-1 py-0.5"
      >
        <Github size={14} />
        Sign in
      </button>
    );
  }

  const initial = (user.full_name || user.user_name || user.email || '?')[0].toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-full"
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="w-7 h-7 rounded-full ring-1 ring-line"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-[11px] font-bold text-white border border-brand-hov">
            {initial}
          </div>
        )}
        <span className="hidden sm:inline text-sm">
          {user.full_name || user.user_name || 'Account'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-surface border border-line shadow-card-hov py-1 z-50"
        >
          <div className="px-3 py-2 text-xs text-text-muted border-b border-line truncate">
            {user.email}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            role="menuitem"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
