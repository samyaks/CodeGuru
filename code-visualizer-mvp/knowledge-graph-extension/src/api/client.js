// src/api/client.js
// Backend API Client with Auth Management

const API_CONFIG = {
  BASE_URL: process.env.API_BASE_URL || 'https://api.updateai.app',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000
};

class APIClient {
  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.authToken = null;
    this.refreshToken = null;
    this.isRefreshing = false;
    this.refreshQueue = [];
  }

  /**
   * Initialize client by loading stored auth tokens
   */
  async init() {
    try {
      const result = await chrome.storage.local.get(['authToken', 'refreshToken', 'user']);
      this.authToken = result.authToken;
      this.refreshToken = result.refreshToken;
      this.user = result.user;
      return !!this.authToken;
    } catch (error) {
      console.error('[APIClient] Init error:', error);
      return false;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.authToken;
  }

  /**
   * Get current user info
   */
  getUser() {
    return this.user;
  }

  /**
   * Login with magic link token or OAuth code
   */
  async login(token, type = 'magic_link') {
    try {
      const response = await this._fetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token, type })
      });

      if (response.success) {
        await this._storeAuth(response.data);
        return { success: true, user: response.data.user };
      }

      return { success: false, error: response.error || 'Login failed' };
    } catch (error) {
      console.error('[APIClient] Login error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Request magic link via email
   */
  async requestMagicLink(email) {
    try {
      const response = await this._fetch('/auth/magic-link', {
        method: 'POST',
        body: JSON.stringify({ email })
      });

      return {
        success: response.success,
        message: response.message || 'Magic link sent to your email'
      };
    } catch (error) {
      console.error('[APIClient] Magic link error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Logout and clear auth data
   */
  async logout() {
    try {
      if (this.authToken) {
        await this._fetch('/auth/logout', { method: 'POST' });
      }
    } catch (error) {
      console.error('[APIClient] Logout error:', error);
    } finally {
      await this._clearAuth();
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    if (this.isRefreshing) {
      // Wait for ongoing refresh
      return new Promise((resolve, reject) => {
        this.refreshQueue.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;

    try {
      const response = await this._fetch('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      if (response.success) {
        await this._storeAuth(response.data);
        
        // Resolve queued requests
        this.refreshQueue.forEach(({ resolve }) => resolve(response.data.authToken));
        this.refreshQueue = [];
        
        return response.data.authToken;
      }

      throw new Error('Token refresh failed');
    } catch (error) {
      console.error('[APIClient] Token refresh error:', error);
      
      // Reject queued requests
      this.refreshQueue.forEach(({ reject }) => reject(error));
      this.refreshQueue = [];
      
      // Clear auth if refresh fails
      await this._clearAuth();
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Sync capture to backend
   */
  async syncCapture(capture) {
    try {
      const response = await this._fetch('/captures', {
        method: 'POST',
        body: JSON.stringify(capture)
      });

      if (response.success) {
        return {
          success: true,
          capture: response.data,
          syncedAt: Date.now()
        };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Sync capture error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all captures from backend
   */
  async getCaptures(params = {}) {
    try {
      const queryString = new URLSearchParams(params).toString();
      const url = `/captures${queryString ? '?' + queryString : ''}`;
      
      const response = await this._fetch(url);

      if (response.success) {
        return {
          success: true,
          captures: response.data.captures,
          total: response.data.total
        };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Get captures error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update capture
   */
  async updateCapture(captureId, updates) {
    try {
      const response = await this._fetch(`/captures/${captureId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });

      if (response.success) {
        return { success: true, capture: response.data };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Update capture error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete capture
   */
  async deleteCapture(captureId) {
    try {
      const response = await this._fetch(`/captures/${captureId}`, {
        method: 'DELETE'
      });

      return { success: response.success };
    } catch (error) {
      console.error('[APIClient] Delete capture error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user workspaces
   */
  async getWorkspaces() {
    try {
      const response = await this._fetch('/workspaces');

      if (response.success) {
        return {
          success: true,
          workspaces: response.data.workspaces
        };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Get workspaces error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create new workspace
   */
  async createWorkspace(workspaceData) {
    try {
      const response = await this._fetch('/workspaces', {
        method: 'POST',
        body: JSON.stringify(workspaceData)
      });

      if (response.success) {
        return { success: true, workspace: response.data };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Create workspace error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add capture to workspace
   */
  async addCaptureToWorkspace(workspaceId, captureId) {
    try {
      const response = await this._fetch(`/workspaces/${workspaceId}/captures`, {
        method: 'POST',
        body: JSON.stringify({ captureId })
      });

      if (response.success) {
        return { success: true, workspace: response.data };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Add to workspace error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get workspace activity (for real-time updates)
   */
  async getWorkspaceActivity(workspaceId, since) {
    try {
      const params = since ? { since } : {};
      const queryString = new URLSearchParams(params).toString();
      const url = `/workspaces/${workspaceId}/activity${queryString ? '?' + queryString : ''}`;
      
      const response = await this._fetch(url);

      if (response.success) {
        return {
          success: true,
          activities: response.data.activities
        };
      }

      return { success: false, error: response.error };
    } catch (error) {
      console.error('[APIClient] Get activity error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Core fetch wrapper with auth and retry logic
   */
  async _fetch(endpoint, options = {}, retryCount = 0) {
    const url = `${this.baseURL}${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Add auth token if available
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle 401 - token expired
      if (response.status === 401 && this.refreshToken && !endpoint.includes('/auth/')) {
        try {
          await this.refreshAccessToken();
          // Retry with new token
          return this._fetch(endpoint, options, retryCount);
        } catch (refreshError) {
          throw new Error('Authentication failed');
        }
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      // Retry on network errors
      if (retryCount < API_CONFIG.RETRY_ATTEMPTS && this._shouldRetry(error)) {
        await this._delay(API_CONFIG.RETRY_DELAY * Math.pow(2, retryCount));
        return this._fetch(endpoint, options, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Store auth tokens securely
   */
  async _storeAuth(data) {
    this.authToken = data.authToken;
    this.refreshToken = data.refreshToken;
    this.user = data.user;

    await chrome.storage.local.set({
      authToken: this.authToken,
      refreshToken: this.refreshToken,
      user: this.user,
      lastAuthUpdate: Date.now()
    });
  }

  /**
   * Clear auth tokens
   */
  async _clearAuth() {
    this.authToken = null;
    this.refreshToken = null;
    this.user = null;

    await chrome.storage.local.remove(['authToken', 'refreshToken', 'user', 'lastAuthUpdate']);
  }

  /**
   * Check if error should trigger retry
   */
  _shouldRetry(error) {
    return error.name === 'AbortError' || 
           error.message.includes('network') ||
           error.message.includes('fetch');
  }

  /**
   * Delay helper for retries
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
const apiClient = new APIClient();
export default apiClient;
