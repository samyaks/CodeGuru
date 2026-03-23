/**
 * DemoWorkspace Component
 * 
 * Complete demo showing all collaboration features:
 * - Collaborative editor
 * - Presence list
 * - Collaborative cursors
 * - Connection status
 * - Multiple sections
 */

import React, { useState, useRef, useEffect } from 'react';
import { useCollaboration } from '../client/useCollaboration';
import { CollaborativeEditor } from '../components/CollaborativeEditor';
import { PresenceList } from '../components/PresenceList';
import { CollaborativeCursor } from '../components/CollaborativeCursor';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { rafThrottle } from '../utils/performance';

interface DemoWorkspaceProps {
  workspaceId: string;
  user: {
    id: string;
    name: string;
    color: string;
    avatar?: string;
  };
  serverUrl?: string;
}

export const DemoWorkspace: React.FC<DemoWorkspaceProps> = ({
  workspaceId,
  user,
  serverUrl,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>('what');

  // Initialize collaboration
  const {
    ydoc,
    provider,
    awareness,
    users,
    isConnected,
    isSynced,
    connectionStatus,
    reconnect,
    updateCursor,
  } = useCollaboration({
    workspaceId,
    user,
    serverUrl,
    enablePersistence: true,
  });

  // Track mouse position and update cursor for others
  useEffect(() => {
    if (!containerRef.current) return;

    const throttledUpdate = rafThrottle((event: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      updateCursor(x, y, activeSection);
    });

    const handleMouseMove = (event: MouseEvent) => {
      throttledUpdate(event);
    };

    const handleMouseLeave = () => {
      updateCursor(-1, -1); // Hide cursor
    };

    const container = containerRef.current;
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [updateCursor, activeSection]);

  const sections = [
    { id: 'what', label: 'What', placeholder: 'Describe what you\'re building...' },
    { id: 'requirements', label: 'Requirements', placeholder: 'List key requirements...' },
    { id: 'design', label: 'Design', placeholder: 'Design decisions and approach...' },
    { id: 'constraints', label: 'Constraints', placeholder: 'Technical constraints and limitations...' },
    { id: 'edgeCases', label: 'Edge Cases', placeholder: 'Edge cases to consider...' },
  ];

  return (
    <div className="demo-workspace" ref={containerRef}>
      <style>{`
        .demo-workspace {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          position: relative;
        }

        .demo-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid #e5e7eb;
        }

        .demo-title {
          font-size: 24px;
          font-weight: 700;
          color: #111827;
        }

        .demo-controls {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .demo-content {
          display: flex;
          gap: 24px;
        }

        .demo-sidebar {
          width: 200px;
          flex-shrink: 0;
        }

        .demo-nav {
          position: sticky;
          top: 24px;
        }

        .demo-nav-item {
          padding: 10px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          color: #6b7280;
          transition: all 0.2s;
          margin-bottom: 4px;
        }

        .demo-nav-item:hover {
          background: #f3f4f6;
          color: #374151;
        }

        .demo-nav-item.active {
          background: #eff6ff;
          color: #3b82f6;
        }

        .demo-main {
          flex: 1;
          min-width: 0;
        }

        .demo-section {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .demo-section-header {
          font-size: 18px;
          font-weight: 600;
          color: #111827;
          margin-bottom: 16px;
        }

        .demo-footer {
          margin-top: 32px;
          padding-top: 16px;
          border-top: 1px solid #e5e7eb;
          text-align: center;
          color: #6b7280;
          font-size: 13px;
        }

        .demo-instructions {
          background: #fffbeb;
          border: 1px solid #fcd34d;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 24px;
          font-size: 14px;
          color: #92400e;
        }

        .demo-instructions strong {
          font-weight: 600;
          color: #78350f;
        }
      `}</style>

      {/* Header */}
      <div className="demo-header">
        <h1 className="demo-title">Collaborative Workspace Demo</h1>
        <div className="demo-controls">
          <PresenceList users={users} currentUserId={user.id} maxAvatars={5} />
          <ConnectionStatus
            status={connectionStatus}
            isSynced={isSynced}
            onReconnect={reconnect}
          />
        </div>
      </div>

      {/* Instructions */}
      <div className="demo-instructions">
        <strong>💡 Try it out:</strong> Open this page in multiple browser tabs or share
        the URL with a friend. Changes will sync in real-time! You can also try going offline
        and back online to see the automatic sync.
      </div>

      {/* Content */}
      <div className="demo-content">
        {/* Sidebar Navigation */}
        <div className="demo-sidebar">
          <nav className="demo-nav">
            {sections.map((section) => (
              <div
                key={section.id}
                className={`demo-nav-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </div>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="demo-main">
          {sections.map((section) => (
            <div
              key={section.id}
              id={section.id}
              className="demo-section"
              style={{ display: activeSection === section.id ? 'block' : 'none' }}
            >
              <h2 className="demo-section-header">{section.label}</h2>
              <CollaborativeEditor
                ydoc={ydoc}
                provider={provider}
                awareness={awareness}
                fieldName={section.id}
                placeholder={section.placeholder}
                user={user}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Collaborative Cursors Overlay */}
      <CollaborativeCursor users={users} containerRef={containerRef} />

      {/* Footer */}
      <div className="demo-footer">
        <p>
          Powered by Y.js CRDT + Tiptap Editor • {users.size} active user{users.size !== 1 ? 's' : ''} •
          {isConnected ? ' Connected' : ' Offline'}
        </p>
      </div>
    </div>
  );
};
