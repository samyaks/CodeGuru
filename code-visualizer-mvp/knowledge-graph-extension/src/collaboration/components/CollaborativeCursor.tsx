/**
 * CollaborativeCursor Component
 * 
 * Renders cursors for other users in the workspace.
 * Features:
 * - Smooth position animation
 * - User name labels
 * - Color-coded per user
 * - Automatic cleanup of inactive cursors
 */

import React, { useEffect, useState } from 'react';
import type { AwarenessUser } from '../client/useCollaboration';

interface CollaborativeCursorProps {
  users: Map<number, AwarenessUser>;
  containerRef?: React.RefObject<HTMLElement>;
}

interface CursorState extends AwarenessUser {
  clientId: number;
}

export const CollaborativeCursor: React.FC<CollaborativeCursorProps> = ({
  users,
  containerRef,
}) => {
  const [cursors, setCursors] = useState<CursorState[]>([]);

  useEffect(() => {
    // Filter users with cursor positions and still active
    const activeCursors: CursorState[] = [];
    const now = Date.now();

    users.forEach((user, clientId) => {
      // Only show cursors for users active in last 30 seconds
      if (user.cursor && now - user.lastActive < 30000) {
        activeCursors.push({ ...user, clientId });
      }
    });

    setCursors(activeCursors);
  }, [users]);

  return (
    <>
      <style>{`
        .collab-cursor {
          position: absolute;
          pointer-events: none;
          z-index: 1000;
          transition: transform 0.1s ease-out, opacity 0.2s;
          will-change: transform;
        }

        .collab-cursor-pointer {
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-bottom: 12px solid currentColor;
          transform: rotate(-45deg);
          transform-origin: center;
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
        }

        .collab-cursor-label {
          position: absolute;
          top: 16px;
          left: 8px;
          background: currentColor;
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          animation: fadeIn 0.2s ease-out;
        }

        .collab-cursor-label::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 4px;
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-bottom: 4px solid currentColor;
        }

        .collab-cursor.typing .collab-cursor-label {
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>

      {cursors.map((cursor) => {
        if (!cursor.cursor) return null;

        return (
          <div
            key={cursor.clientId}
            className={`collab-cursor ${cursor.isTyping ? 'typing' : ''}`}
            style={{
              transform: `translate(${cursor.cursor.x}px, ${cursor.cursor.y}px)`,
              color: cursor.color,
            }}
          >
            <div className="collab-cursor-pointer" />
            <div className="collab-cursor-label">
              {cursor.name}
              {cursor.isTyping && ' typing...'}
            </div>
          </div>
        );
      })}
    </>
  );
};
