/**
 * Connection Manager for Y.js WebSocket Provider
 * 
 * Handles:
 * - Connection lifecycle (connect, disconnect, reconnect)
 * - Network status monitoring
 * - Exponential backoff for reconnection
 * - Connection health checks
 */

export type ConnectionStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'error';

export interface ConnectionConfig {
  url: string;
  workspaceId: string;
  token?: string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  maxReconnectDelay?: number;
}

export type ConnectionStatusCallback = (status: ConnectionStatus) => void;

export class ConnectionManager {
  private config: Required<ConnectionConfig>;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimeout?: NodeJS.Timeout;
  private statusCallbacks: Set<ConnectionStatusCallback> = new Set();
  private online = true;

  constructor(config: ConnectionConfig) {
    this.config = {
      maxReconnectAttempts: 10,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      token: '',
      ...config,
    };

    // Monitor network status
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Set connection status and notify listeners
   */
  setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      console.log(`[ConnectionManager] Status: ${this.status} → ${status}`);
      this.status = status;
      this.notifyStatusChange(status);
    }
  }

  /**
   * Register callback for status changes
   */
  onStatusChange(callback: ConnectionStatusCallback): () => void {
    this.statusCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  /**
   * Notify all listeners of status change
   */
  private notifyStatusChange(status: ConnectionStatus): void {
    this.statusCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('[ConnectionManager] Error in status callback:', error);
      }
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect(reconnectFn: () => void): void {
    // Clear existing timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Check if we've exceeded max attempts
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[ConnectionManager] Max reconnection attempts reached');
      this.setStatus('error');
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    console.log(`[ConnectionManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      reconnectFn();
    }, delay);
  }

  /**
   * Reset reconnection attempts (call on successful connection)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  /**
   * Check if network is online
   */
  isOnline(): boolean {
    return this.online;
  }

  /**
   * Handle online event
   */
  private handleOnline = (): void => {
    console.log('[ConnectionManager] Network online');
    this.online = true;
    // Trigger reconnection will be handled by the provider
  };

  /**
   * Handle offline event
   */
  private handleOffline = (): void => {
    console.log('[ConnectionManager] Network offline');
    this.online = false;
    this.setStatus('disconnected');
  };

  /**
   * Build WebSocket URL with authentication
   */
  buildWebSocketUrl(): string {
    const url = new URL(this.config.url);
    url.pathname = `/${this.config.workspaceId}`;
    
    if (this.config.token) {
      url.searchParams.set('token', this.config.token);
    }

    return url.toString();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }

    this.statusCallbacks.clear();
  }
}
