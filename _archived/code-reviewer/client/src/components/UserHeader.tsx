import React, { useState, useRef, useEffect } from 'react';
import { LogOut, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function UserHeader() {
  const { user, loading, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (loading) return null;

  if (!user) {
    return (
      <div className="user-header">
        <button className="btn btn-primary btn-sm" onClick={() => login('github')}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="user-header" ref={menuRef}>
      <button className="user-avatar-btn" onClick={() => setMenuOpen(!menuOpen)}>
        {user.avatar_url ? (
          <img src={user.avatar_url} alt={user.user_name || 'User'} className="user-avatar" />
        ) : (
          <div className="user-avatar user-avatar-fallback"><User size={16} /></div>
        )}
      </button>

      {menuOpen && (
        <div className="user-menu">
          <div className="user-menu-info">
            <span className="user-menu-name">{user.full_name || user.user_name || 'User'}</span>
            <span className="user-menu-email">{user.email}</span>
          </div>
          <div className="user-menu-divider" />
          <button className="user-menu-item" onClick={logout}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
