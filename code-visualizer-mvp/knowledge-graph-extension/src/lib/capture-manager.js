// src/lib/capture-manager.js
// Core capture management logic - Framework agnostic
// Can be used in: Extension, Workspace App, CLI tools, etc.

/**
 * CaptureManager - Handles all capture operations
 * Storage agnostic - pass in your own storage adapter
 */
export class CaptureManager {
  constructor(storage) {
    this.storage = storage; // Storage adapter (chrome.storage, localStorage, IndexedDB, etc.)
  }

  /**
   * Get all captures
   */
  async getAll() {
    try {
      const captures = await this.storage.get('captures');
      return captures || [];
    } catch (error) {
      console.error('[CaptureManager] Failed to get captures:', error);
      return [];
    }
  }

  /**
   * Add a new capture
   */
  async add(capture) {
    try {
      // Validate capture
      if (!this.validateCapture(capture)) {
        throw new Error('Invalid capture data');
      }

      // Add metadata
      const enrichedCapture = {
        ...capture,
        id: capture.id || this.generateId(),
        timestamp: capture.timestamp || Date.now(),
        version: '1.0'
      };

      // Get existing captures
      const captures = await this.getAll();
      
      // Add new capture
      captures.push(enrichedCapture);
      
      // Save
      await this.storage.set('captures', captures);
      
      return { success: true, capture: enrichedCapture, count: captures.length };
    } catch (error) {
      console.error('[CaptureManager] Failed to add capture:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a capture by ID
   */
  async remove(captureId) {
    try {
      const captures = await this.getAll();
      const filtered = captures.filter(c => c.id !== captureId);
      
      if (filtered.length === captures.length) {
        return { success: false, error: 'Capture not found' };
      }
      
      await this.storage.set('captures', filtered);
      return { success: true, count: filtered.length };
    } catch (error) {
      console.error('[CaptureManager] Failed to remove capture:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear all captures
   */
  async clear() {
    try {
      await this.storage.set('captures', []);
      return { success: true };
    } catch (error) {
      console.error('[CaptureManager] Failed to clear captures:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get captures by type
   */
  async getByType(type) {
    const captures = await this.getAll();
    return captures.filter(c => c.type === type);
  }

  /**
   * Get captures by source
   */
  async getBySource(source) {
    const captures = await this.getAll();
    return captures.filter(c => c.source === source);
  }

  /**
   * Search captures
   */
  async search(query) {
    const captures = await this.getAll();
    const lowerQuery = query.toLowerCase();
    
    return captures.filter(c => 
      c.content?.toLowerCase().includes(lowerQuery) ||
      c.title?.toLowerCase().includes(lowerQuery) ||
      c.source?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get capture statistics
   */
  async getStats() {
    const captures = await this.getAll();
    
    const stats = {
      total: captures.length,
      byType: {},
      bySource: {},
      oldest: null,
      newest: null
    };

    captures.forEach(capture => {
      // Count by type
      stats.byType[capture.type] = (stats.byType[capture.type] || 0) + 1;
      
      // Count by source
      stats.bySource[capture.source] = (stats.bySource[capture.source] || 0) + 1;
      
      // Track oldest/newest
      if (!stats.oldest || capture.timestamp < stats.oldest) {
        stats.oldest = capture.timestamp;
      }
      if (!stats.newest || capture.timestamp > stats.newest) {
        stats.newest = capture.timestamp;
      }
    });

    return stats;
  }

  /**
   * Export captures to JSON
   */
  async exportToJSON() {
    const captures = await this.getAll();
    return JSON.stringify({
      version: '1.0',
      exportedAt: Date.now(),
      count: captures.length,
      captures
    }, null, 2);
  }

  /**
   * Import captures from JSON
   */
  async importFromJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      if (!data.captures || !Array.isArray(data.captures)) {
        throw new Error('Invalid import format');
      }

      // Validate all captures
      const validCaptures = data.captures.filter(c => this.validateCapture(c));
      
      if (validCaptures.length === 0) {
        throw new Error('No valid captures found');
      }

      // Get existing captures
      const existing = await this.getAll();
      
      // Merge (avoiding duplicates by ID)
      const existingIds = new Set(existing.map(c => c.id));
      const newCaptures = validCaptures.filter(c => !existingIds.has(c.id));
      
      const merged = [...existing, ...newCaptures];
      await this.storage.set('captures', merged);
      
      return { 
        success: true, 
        imported: newCaptures.length,
        skipped: validCaptures.length - newCaptures.length,
        total: merged.length
      };
    } catch (error) {
      console.error('[CaptureManager] Failed to import:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate capture structure
   */
  validateCapture(capture) {
    if (!capture) return false;
    if (!capture.type) return false;
    if (!capture.source) return false;
    if (!capture.content) return false;
    if (!capture.url) return false;
    return true;
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
}

/**
 * Factory function for creating CaptureManager with common storage adapters
 */
export function createCaptureManager(storageType = 'chrome') {
  let storage;

  switch (storageType) {
    case 'chrome':
      storage = {
        async get(key) {
          const result = await chrome.storage.local.get([key]);
          return result[key];
        },
        async set(key, value) {
          await chrome.storage.local.set({ [key]: value });
        }
      };
      break;

    case 'localStorage':
      storage = {
        async get(key) {
          const value = localStorage.getItem(key);
          return value ? JSON.parse(value) : null;
        },
        async set(key, value) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      };
      break;

    case 'memory':
      const memoryStore = {};
      storage = {
        async get(key) {
          return memoryStore[key];
        },
        async set(key, value) {
          memoryStore[key] = value;
        }
      };
      break;

    default:
      throw new Error(`Unknown storage type: ${storageType}`);
  }

  return new CaptureManager(storage);
}
