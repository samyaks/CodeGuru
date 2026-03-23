// src/lib/project-manager.js
// Project management logic - Framework agnostic

/**
 * ProjectManager - Handles project operations
 */
export class ProjectManager {
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Get current project
   */
  async get() {
    try {
      const project = await this.storage.get('project');
      return project;
    } catch (error) {
      console.error('[ProjectManager] Failed to get project:', error);
      return null;
    }
  }

  /**
   * Create new project
   */
  async create(name, initialLink = null) {
    try {
      if (!name || name.trim().length === 0) {
        throw new Error('Project name is required');
      }

      const project = {
        name: name.trim(),
        links: initialLink ? [initialLink] : [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await this.storage.set('project', project);
      return { success: true, project };
    } catch (error) {
      console.error('[ProjectManager] Failed to create project:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add link to project
   */
  async addLink(link) {
    try {
      const project = await this.get();
      
      if (!project) {
        throw new Error('No project found. Create a project first.');
      }

      // Check if link already exists
      const exists = project.links.some(l => l.url === link.url);
      if (exists) {
        return { success: false, error: 'Link already in project' };
      }

      project.links.push({
        ...link,
        addedAt: Date.now()
      });
      
      project.updatedAt = Date.now();
      
      await this.storage.set('project', project);
      return { success: true, project };
    } catch (error) {
      console.error('[ProjectManager] Failed to add link:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove link from project
   */
  async removeLink(url) {
    try {
      const project = await this.get();
      
      if (!project) {
        throw new Error('No project found');
      }

      const originalLength = project.links.length;
      project.links = project.links.filter(l => l.url !== url);
      
      if (project.links.length === originalLength) {
        return { success: false, error: 'Link not found' };
      }

      project.updatedAt = Date.now();
      
      await this.storage.set('project', project);
      return { success: true, project };
    } catch (error) {
      console.error('[ProjectManager] Failed to remove link:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if URL is in project
   */
  async hasLink(url) {
    const project = await this.get();
    if (!project || !project.links) return false;
    return project.links.some(l => l.url === url);
  }

  /**
   * Delete project
   */
  async delete() {
    try {
      await this.storage.set('project', null);
      return { success: true };
    } catch (error) {
      console.error('[ProjectManager] Failed to delete project:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update project name
   */
  async updateName(newName) {
    try {
      const project = await this.get();
      
      if (!project) {
        throw new Error('No project found');
      }

      project.name = newName.trim();
      project.updatedAt = Date.now();
      
      await this.storage.set('project', project);
      return { success: true, project };
    } catch (error) {
      console.error('[ProjectManager] Failed to update name:', error);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Factory function
 */
export function createProjectManager(storageType = 'chrome') {
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

    default:
      throw new Error(`Unknown storage type: ${storageType}`);
  }

  return new ProjectManager(storage);
}
