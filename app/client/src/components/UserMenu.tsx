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
        className="flex items-center gap-1.5 text-sm font-medium text-sky-muted hover:text-sky-white transition-colors"
      >
        <Github size={14} />
        Sign in
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-sky-muted hover:text-sky-white transition-colors"
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="w-6 h-6 rounded-full ring-1 ring-sky-border"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-navy-mid flex items-center justify-center text-xs font-bold text-gold">
            {(user.full_name || user.user_name || user.email)[0].toUpperCase()}
          </div>
        )}
        <span className="hidden sm:inline text-sm">{user.full_name || user.user_name || 'Account'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl glass shadow-lg py-1 z-50">
          <div className="px-3 py-2 text-xs text-sky-muted border-b border-sky-border truncate">
            {user.email}
          </div>
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-sky-muted hover:text-sky-white hover:bg-navy-mid transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
