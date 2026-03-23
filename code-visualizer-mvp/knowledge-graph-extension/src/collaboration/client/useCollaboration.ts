/**
 * useCollaboration Hook
 * 
 * Main React hook for real-time collaboration features.
 * Provides:
 * - Y.js document for CRDT synchronization
 * - WebSocket provider for network sync
 * - Awareness protocol for presence/cursors
 * - Connection status and management
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { ConnectionManager, ConnectionStatus } from './ConnectionManager';

export interface CollaborationUser {
  id: string;
  name: string;
  color: string;
  avatar?: string;
}

export interface CollaborationConfig {
  workspaceId: string;
  user: CollaborationUser;
  serverUrl?: string;
  token?: string;
  enablePersistence?: boolean;
}

export interface AwarenessUser extends CollaborationUser {
  cursor?: {
    x: number;
    y: number;
    sectionId?: string;
  } | null;
  selection?: {
    anchor: number;
    head: number;
  } | null;
  lastActive: number;
  isTyping: boolean;
}

export interface CollaborationState {
  ydoc: Y.Doc;
  provider: WebsocketProvider | null;
  awareness: any; // Awareness instance from y-protocols
  users: Map<number, AwarenessUser>;
  isConnected: boolean;
  isSynced: boolean;
  connectionStatus: ConnectionStatus;
  reconnect: () => void;
  disconnect: () => void;
  updateCursor: (x: number, y: number, sectionId?: string) => void;
  updateSelection: (anchor: number, head: number) => void;
  setTyping: (isTyping: boolean) => void;
}

const DEFAULT_SERVER_URL = 'ws://localhost:1234';

export function useCollaboration(config: CollaborationConfig): CollaborationState {
  const {
    workspaceId,
    user,
    serverUrl = DEFAULT_SERVER_URL,
    token,
    enablePersistence = true,
  } = config;

  // Persistent refs
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);
  const connectionManagerRef = useRef<ConnectionManager | null>(null);

  // State
  const [users, setUsers] = useState<Map<number, AwarenessUser>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Initialize Y.js document (only once)
  if (!ydocRef.current) {
    ydocRef.current = new Y.Doc();
    console.log('[useCollaboration] Y.js document created');
  }

  const ydoc = ydocRef.current;

  // Initialize connection manager
  useEffect(() => {
    connectionManagerRef.current = new ConnectionManager({
      url: serverUrl,
      workspaceId,
      token,
    });

    const unsubscribe = connectionManagerRef.current.onStatusChange(setConnectionStatus);

    return () => {
      unsubscribe();
      connectionManagerRef.current?.destroy();
    };
  }, [serverUrl, workspaceId, token]);

  // Initialize persistence (IndexedDB)
  useEffect(() => {
    if (!enablePersistence || typeof window === 'undefined') return;

    console.log('[useCollaboration] Initializing IndexedDB persistence');
    
    const persistence = new IndexeddbPersistence(workspaceId, ydoc);
    persistenceRef.current = persistence;

    persistence.on('synced', () => {
      console.log('[useCollaboration] Local state loaded from IndexedDB');
    });

    return () => {
      persistence.destroy();
    };
  }, [workspaceId, ydoc, enablePersistence]);

  // Initialize WebSocket provider and awareness
  useEffect(() => {
    console.log('[useCollaboration] Initializing WebSocket provider');
    
    const wsUrl = connectionManagerRef.current?.buildWebSocketUrl() || `${serverUrl}/${workspaceId}`;
    
    const provider = new WebsocketProvider(wsUrl, workspaceId, ydoc, {
      connect: true,
      // WebSocket options
      WebSocketPolyfill: typeof WebSocket !== 'undefined' ? WebSocket : undefined,
      maxBackoffTime: 10000,
    });

    providerRef.current = provider;
    const { awareness } = provider;

    // Set local user info
    awareness.setLocalStateField('user', user);
    awareness.setLocalStateField('lastActive', Date.now());
    awareness.setLocalStateField('isTyping', false);

    // Connection event handlers
    provider.on('status', ({ status }: { status: string }) => {
      console.log('[useCollaboration] Provider status:', status);
      
      setIsConnected(status === 'connected');
      
      if (status === 'connected') {
        connectionManagerRef.current?.setStatus('connected');
        connectionManagerRef.current?.resetReconnectAttempts();
      } else if (status === 'disconnected') {
        connectionManagerRef.current?.setStatus('disconnected');
        
        // Schedule reconnection
        connectionManagerRef.current?.scheduleReconnect(() => {
          provider.connect();
        });
      }
    });

    provider.on('sync', (synced: boolean) => {
      console.log('[useCollaboration] Sync status:', synced);
      setIsSynced(synced);
      
      if (synced) {
        connectionManagerRef.current?.setStatus('synced');
      }
    });

    // Awareness change handler (for other users)
    const handleAwarenessChange = () => {
      const states = awareness.getStates();
      const updatedUsers = new Map<number, AwarenessUser>();
      
      states.forEach((state: any, clientId: number) => {
        // Skip local user
        if (clientId === awareness.clientID) return;
        
        updatedUsers.set(clientId, {
          id: state.user?.id || `user-${clientId}`,
          name: state.user?.name || 'Anonymous',
          color: state.user?.color || '#888888',
          avatar: state.user?.avatar,
          cursor: state.cursor || null,
          selection: state.selection || null,
          lastActive: state.lastActive || Date.now(),
          isTyping: state.isTyping || false,
        });
      });
      
      setUsers(updatedUsers);
    };

    awareness.on('change', handleAwarenessChange);

    // Cleanup
    return () => {
      provider.off('status', () => {});
      provider.off('sync', () => {});
      awareness.off('change', handleAwarenessChange);
      provider.disconnect();
      provider.destroy();
    };
  }, [workspaceId, serverUrl, ydoc, user]);

  // Update cursor position
  const updateCursor = useCallback((x: number, y: number, sectionId?: string) => {
    const awareness = providerRef.current?.awareness;
    if (!awareness) return;

    awareness.setLocalStateField('cursor', { x, y, sectionId });
    awareness.setLocalStateField('lastActive', Date.now());
  }, []);

  // Update text selection
  const updateSelection = useCallback((anchor: number, head: number) => {
    const awareness = providerRef.current?.awareness;
    if (!awareness) return;

    awareness.setLocalStateField('selection', { anchor, head });
    awareness.setLocalStateField('lastActive', Date.now());
  }, []);

  // Set typing indicator
  const setTyping = useCallback((isTyping: boolean) => {
    const awareness = providerRef.current?.awareness;
    if (!awareness) return;

    awareness.setLocalStateField('isTyping', isTyping);
    awareness.setLocalStateField('lastActive', Date.now());
  }, []);

  // Manual reconnect
  const reconnect = useCallback(() => {
    console.log('[useCollaboration] Manual reconnect triggered');
    providerRef.current?.connect();
  }, []);

  // Manual disconnect
  const disconnect = useCallback(() => {
    console.log('[useCollaboration] Manual disconnect triggered');
    providerRef.current?.disconnect();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[useCollaboration] Cleaning up');
      providerRef.current?.disconnect();
      providerRef.current?.destroy();
    };
  }, []);

  return {
    ydoc,
    provider: providerRef.current,
    awareness: providerRef.current?.awareness,
    users,
    isConnected,
    isSynced,
    connectionStatus,
    reconnect,
    disconnect,
    updateCursor,
    updateSelection,
    setTyping,
  };
}
