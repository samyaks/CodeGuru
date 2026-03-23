/**
 * UpdateAI Collaboration System
 * 
 * Real-time collaboration for UpdateAI workspaces using Y.js CRDTs.
 * 
 * @example Basic Usage
 * ```tsx
 * import { useCollaboration, CollaborativeEditor, PresenceList } from './collaboration';
 * 
 * function MyWorkspace() {
 *   const { ydoc, provider, awareness, users, isConnected } = useCollaboration({
 *     workspaceId: 'workspace-123',
 *     user: {
 *       id: 'user-1',
 *       name: 'John Doe',
 *       color: '#3b82f6',
 *     },
 *   });
 * 
 *   return (
 *     <div>
 *       <PresenceList users={users} />
 *       <CollaborativeEditor
 *         ydoc={ydoc}
 *         provider={provider}
 *         awareness={awareness}
 *         user={{ name: 'John Doe', color: '#3b82f6' }}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */

// Core hook
export { useCollaboration } from './client/useCollaboration';
export type { 
  CollaborationConfig, 
  CollaborationState, 
  CollaborationUser,
  AwarenessUser 
} from './client/useCollaboration';

// Connection management
export { ConnectionManager } from './client/ConnectionManager';
export type { 
  ConnectionStatus, 
  ConnectionConfig,
  ConnectionStatusCallback 
} from './client/ConnectionManager';

// Components
export { CollaborativeEditor } from './components/CollaborativeEditor';
export { PresenceList } from './components/PresenceList';
export { CollaborativeCursor } from './components/CollaborativeCursor';
export { ConnectionStatus } from './components/ConnectionStatus';

// Demo
export { DemoWorkspace } from './demo/DemoWorkspace';

// Utilities
export { 
  throttle, 
  debounce, 
  debounceLeading,
  rafThrottle,
  batchUpdates 
} from './utils/performance';
