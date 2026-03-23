/**
 * PresenceList Component
 * 
 * Displays avatars of all active users in the workspace.
 * Shows online status, user names, and optional "typing" indicators.
 */

import React from 'react';
import type { AwarenessUser } from '../client/useCollaboration';

interface PresenceListProps {
  users: Map<number, AwarenessUser>;
  currentUserId?: string;
  maxAvatars?: number;
  showNames?: boolean;
  className?: string;
}

export const PresenceList: React.FC<PresenceListProps> = ({
  users,
  currentUserId,
  maxAvatars = 5,
  showNames = false,
  className = '',
}) => {
  const userArray = Array.from(users.values());
  const visibleUsers = userArray.slice(0, maxAvatars);
  const overflowCount = Math.max(0, userArray.length - maxAvatars);

  // Check if user was active in last 30 seconds
  const isActiveUser = (user: AwarenessUser): boolean => {
    return Date.now() - user.lastActive < 30000;
  };

  return (
    <div className={`presence-list ${className}`}>
      <style>{`
        .presence-list {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .presence-avatars {
          display: flex;
          align-items: center;
          margin-right: 8px;
        }

        .presence-avatar {
          position: relative;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: white;
          cursor: pointer;
          transition: transform 0.2s, z-index 0s;
          margin-left: -8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .presence-avatar:first-child {
          margin-left: 0;
        }

        .presence-avatar:hover {
          transform: scale(1.1);
          z-index: 10;
        }

        .presence-avatar.typing::after {
          content: '';
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          background: #10b981;
          border: 2px solid white;
          border-radius: 50%;
          animation: pulse 1.5s ease-in-out infinite;
        }

        .presence-avatar.inactive {
          opacity: 0.5;
        }

        .presence-tooltip {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          background: #1f2937;
          color: white;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s;
          z-index: 1000;
        }

        .presence-avatar:hover .presence-tooltip {
          opacity: 1;
        }

        .presence-tooltip::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 4px solid transparent;
          border-top-color: #1f2937;
        }

        .presence-overflow {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #e5e7eb;
          border: 2px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          margin-left: -8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .presence-names {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .presence-name {
          font-size: 12px;
          color: #374151;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .presence-name-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(0.8);
          }
        }
      `}</style>

      <div className="presence-avatars">
        {visibleUsers.map((user, index) => {
          const isActive = isActiveUser(user);
          const initials = user.name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

          return (
            <div
              key={user.id}
              className={`presence-avatar ${user.isTyping ? 'typing' : ''} ${!isActive ? 'inactive' : ''}`}
              style={{
                backgroundColor: user.color,
                zIndex: visibleUsers.length - index,
              }}
            >
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                initials
              )}
              
              <div className="presence-tooltip">
                {user.name}
                {user.isTyping && ' (typing...)'}
              </div>
            </div>
          );
        })}

        {overflowCount > 0 && (
          <div className="presence-overflow">
            +{overflowCount}
          </div>
        )}
      </div>

      {showNames && (
        <div className="presence-names">
          {visibleUsers.slice(0, 3).map(user => (
            <div key={user.id} className="presence-name">
              <div
                className="presence-name-dot"
                style={{ backgroundColor: user.color }}
              />
              {user.name}
              {user.isTyping && ' is typing...'}
            </div>
          ))}
          {overflowCount > 0 && (
            <div className="presence-name">
              and {overflowCount} more...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
