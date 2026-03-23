/**
 * ConnectionStatus Component
 * 
 * Shows real-time connection status with visual indicators.
 * States: disconnected, connecting, connected, synced, error
 */

import React from 'react';
import type { ConnectionStatus as Status } from '../client/ConnectionManager';

interface ConnectionStatusProps {
  status: Status;
  isSynced: boolean;
  onReconnect?: () => void;
  className?: string;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status,
  isSynced,
  onReconnect,
  className = '',
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'synced':
        return {
          icon: '✓',
          label: 'Synced',
          color: '#10b981',
          bgColor: '#d1fae5',
        };
      case 'connected':
        return {
          icon: '⟳',
          label: isSynced ? 'Synced' : 'Syncing...',
          color: '#3b82f6',
          bgColor: '#dbeafe',
        };
      case 'connecting':
        return {
          icon: '⟳',
          label: 'Connecting...',
          color: '#f59e0b',
          bgColor: '#fef3c7',
        };
      case 'disconnected':
        return {
          icon: '✗',
          label: 'Offline',
          color: '#6b7280',
          bgColor: '#f3f4f6',
        };
      case 'error':
        return {
          icon: '!',
          label: 'Connection Error',
          color: '#ef4444',
          bgColor: '#fee2e2',
        };
      default:
        return {
          icon: '?',
          label: 'Unknown',
          color: '#6b7280',
          bgColor: '#f3f4f6',
        };
    }
  };

  const config = getStatusConfig();
  const showReconnect = (status === 'disconnected' || status === 'error') && onReconnect;

  return (
    <div className={`connection-status ${className}`}>
      <style>{`
        .connection-status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s;
        }

        .connection-status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .connection-status-icon {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
        }

        .connection-status-icon.spinning {
          animation: spin 1s linear infinite;
        }

        .connection-status-label {
          font-weight: 500;
        }

        .connection-status-reconnect {
          background: transparent;
          border: none;
          color: currentColor;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
          font-size: inherit;
          font-weight: 600;
          transition: opacity 0.2s;
        }

        .connection-status-reconnect:hover {
          opacity: 0.7;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div
        style={{
          backgroundColor: config.bgColor,
          color: config.color,
        }}
      >
        <div className="connection-status-indicator">
          <div
            className={`connection-status-icon ${status === 'connecting' ? 'spinning' : ''}`}
            style={{
              backgroundColor: config.color,
              color: 'white',
            }}
          >
            {config.icon}
          </div>
          <span className="connection-status-label">{config.label}</span>
        </div>

        {showReconnect && (
          <>
            <span>•</span>
            <button
              className="connection-status-reconnect"
              onClick={onReconnect}
            >
              Reconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
};
