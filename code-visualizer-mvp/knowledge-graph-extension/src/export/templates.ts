// Prompt templates for common use cases

import { PromptTemplate } from './types';

/**
 * Default prompt templates for common software development scenarios
 */
export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'feature-implementation',
    name: 'Feature Implementation',
    description: 'Build a new feature from scratch with proper architecture and testing',
    category: 'feature',
    sections: [
      {
        id: 'objective',
        title: 'Feature Objective',
        placeholder: 'What feature are you building and why?',
        required: true,
        hints: [
          'Describe the user problem this solves',
          'Explain the expected user flow',
          'Mention any business requirements'
        ]
      },
      {
        id: 'requirements',
        title: 'Functional Requirements',
        placeholder: 'List all functional requirements',
        required: true,
        hints: [
          'What actions can users perform?',
          'What data needs to be stored/retrieved?',
          'What are the success criteria?'
        ]
      },
      {
        id: 'technical-spec',
        title: 'Technical Specifications',
        placeholder: 'Technical constraints and architecture decisions',
        required: true,
        hints: [
          'Tech stack (languages, frameworks, libraries)',
          'API endpoints or data models needed',
          'Authentication/authorization requirements',
          'Performance considerations'
        ]
      },
      {
        id: 'ui-ux',
        title: 'UI/UX Requirements',
        placeholder: 'User interface and experience details',
        required: false,
        hints: [
          'Wireframes or mockups',
          'Design system/component library to use',
          'Responsive design requirements',
          'Accessibility considerations'
        ]
      },
      {
        id: 'edge-cases',
        title: 'Edge Cases & Error Handling',
        placeholder: 'What could go wrong?',
        required: true,
        hints: [
          'What if the user provides invalid input?',
          'How to handle network failures?',
          'What if data is missing or corrupted?',
          'Concurrent access scenarios'
        ]
      },
      {
        id: 'testing',
        title: 'Testing Requirements',
        placeholder: 'How should this be tested?',
        required: false,
        hints: [
          'Unit tests for business logic',
          'Integration tests for API calls',
          'E2E tests for critical flows',
          'Test data needed'
        ]
      },
      {
        id: 'task',
        title: 'Task',
        content: 'Implement the feature as described above. Provide:\n1. Architecture overview\n2. Complete implementation code\n3. Tests\n4. Usage examples\n5. Deployment considerations',
        required: true
      }
    ],
    variables: {
      '{{projectName}}': '',
      '{{techStack}}': '',
      '{{designSystem}}': ''
    },
    modelOptimizations: {
      'claude-3.5-sonnet': {
        formatStyle: 'xml',
        thinkingEnabled: true,
        artifactEnabled: true,
        systemPrompt: 'You are an expert software architect. Think through the problem systematically before implementing.'
      },
      'gpt-4': {
        formatStyle: 'markdown',
        systemPrompt: 'You are a senior full-stack developer. Provide production-ready code with comprehensive error handling.'
      }
    }
  },
  
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Debug and fix issues with step-by-step analysis',
    category: 'bugfix',
    sections: [
      {
        id: 'objective',
        title: 'Bug Description',
        placeholder: 'What is the bug? What is the expected vs actual behavior?',
        required: true,
        hints: [
          'What should happen?',
          'What actually happens?',
          'How to reproduce the bug?',
          'When did this start happening?'
        ]
      },
      {
        id: 'reproduction',
        title: 'Steps to Reproduce',
        placeholder: 'Detailed steps to reproduce the bug',
        required: true,
        hints: [
          'Step-by-step instructions',
          'Specific test data or inputs',
          'Environment details (browser, OS, etc.)',
          'Screenshots or error messages'
        ]
      },
      {
        id: 'context',
        title: 'Code Context',
        placeholder: 'Relevant code, error logs, or stack traces',
        required: true,
        hints: [
          'Files involved in the bug',
          'Error messages or logs',
          'Stack traces',
          'Recent changes to related code'
        ]
      },
      {
        id: 'impact',
        title: 'Impact & Priority',
        placeholder: 'How critical is this bug?',
        required: false,
        hints: [
          'Which users are affected?',
          'How many users impacted?',
          'Business impact',
          'Workarounds available?'
        ]
      },
      {
        id: 'task',
        title: 'Task',
        content: 'Analyze the bug and provide:\n1. Root cause analysis\n2. Proposed fix with explanation\n3. Complete code changes\n4. Test cases to prevent regression\n5. Impact assessment',
        required: true
      }
    ],
    modelOptimizations: {
      'claude-3.5-sonnet': {
        formatStyle: 'xml',
        thinkingEnabled: true,
        systemPrompt: 'You are a debugging expert. Analyze the issue methodically, identify the root cause, and propose a minimal fix.'
      }
    }
  },
  
  {
    id: 'api-integration',
    name: 'API Integration',
    description: 'Integrate with third-party APIs and services',
    category: 'api',
    sections: [
      {
        id: 'objective',
        title: 'Integration Goal',
        placeholder: 'Which API are you integrating with and why?',
        required: true,
        hints: [
          'Name of the API/service',
          'What data needs to be exchanged?',
          'Use case for the integration'
        ]
      },
      {
        id: 'api-details',
        title: 'API Documentation',
        placeholder: 'Link to API docs and key endpoints',
        required: true,
        hints: [
          'API documentation URL',
          'Authentication method (API key, OAuth, etc.)',
          'Endpoints to integrate',
          'Request/response formats',
          'Rate limits or quotas'
        ]
      },
      {
        id: 'requirements',
        title: 'Integration Requirements',
        placeholder: 'What needs to be implemented?',
        required: true,
        hints: [
          'Data mapping (your system ↔ API)',
          'Sync vs async calls',
          'Caching strategy',
          'Retry logic for failures'
        ]
      },
      {
        id: 'error-handling',
        title: 'Error Handling',
        placeholder: 'How to handle API failures?',
        required: true,
        hints: [
          'Network timeouts',
          'Rate limiting (429 errors)',
          'Invalid credentials (401/403)',
          'Service downtime',
          'Data validation errors'
        ]
      },
      {
        id: 'security',
        title: 'Security Considerations',
        placeholder: 'How to keep API keys and data secure?',
        required: true,
        hints: [
          'Where to store API keys?',
          'Encryption for sensitive data',
          'Input validation',
          'CORS configuration'
        ]
      },
      {
        id: 'task',
        title: 'Task',
        content: 'Implement the API integration with:\n1. Client/wrapper class for the API\n2. Authentication handling\n3. Request/response mappers\n4. Comprehensive error handling\n5. Tests with mocked responses\n6. Usage examples',
        required: true
      }
    ],
    variables: {
      '{{apiName}}': '',
      '{{authMethod}}': ''
    }
  },
  
  {
    id: 'code-refactor',
    name: 'Code Refactor',
    description: 'Improve existing code quality, structure, and maintainability',
    category: 'refactor',
    sections: [
      {
        id: 'objective',
        title: 'Refactoring Goal',
        placeholder: 'What needs to be improved and why?',
        required: true,
        hints: [
          'Current problems with the code',
          'Technical debt being addressed',
          'Performance issues',
          'Maintainability concerns'
        ]
      },
      {
        id: 'current-code',
        title: 'Current Implementation',
        placeholder: 'Existing code that needs refactoring',
        required: true,
        hints: [
          'Files and functions to refactor',
          'Known issues or code smells',
          'Dependencies to consider'
        ]
      },
      {
        id: 'requirements',
        title: 'Refactoring Requirements',
        placeholder: 'What should the refactored code achieve?',
        required: true,
        hints: [
          'Must maintain existing functionality',
          'Performance targets',
          'Code quality goals (readability, testability)',
          'New patterns or architecture to follow'
        ]
      },
      {
        id: 'constraints',
        title: 'Constraints',
        placeholder: 'Limitations and boundaries',
        required: false,
        hints: [
          'Backward compatibility requirements',
          'Can\'t change public APIs',
          'Must avoid breaking changes',
          'Time/scope constraints'
        ]
      },
      {
        id: 'task',
        title: 'Task',
        content: 'Refactor the code with:\n1. Analysis of current issues\n2. Proposed improvements\n3. Step-by-step refactoring plan\n4. Complete refactored code\n5. Before/after comparison\n6. Tests to ensure no regressions',
        required: true
      }
    ],
    modelOptimizations: {
      'claude-3.5-sonnet': {
        formatStyle: 'xml',
        thinkingEnabled: true,
        systemPrompt: 'You are a code quality expert. Focus on maintainability, readability, and following best practices while preserving functionality.'
      }
    }
  },
  
  {
    id: 'architecture-design',
    name: 'Architecture Design',
    description: 'Design system architecture and high-level technical solutions',
    category: 'architecture',
    sections: [
      {
        id: 'objective',
        title: 'System Overview',
        placeholder: 'What system are you designing?',
        required: true,
        hints: [
          'Purpose of the system',
          'Key users/stakeholders',
          'Scale requirements (users, data volume)',
          'Business goals'
        ]
      },
      {
        id: 'requirements',
        title: 'Functional Requirements',
        placeholder: 'What must the system do?',
        required: true,
        hints: [
          'Core features and capabilities',
          'User workflows',
          'Integration points',
          'Data requirements'
        ]
      },
      {
        id: 'non-functional',
        title: 'Non-Functional Requirements',
        placeholder: 'Performance, scalability, security, etc.',
        required: true,
        hints: [
          'Performance targets (response time, throughput)',
          'Scalability needs (concurrent users, data growth)',
          'Security requirements',
          'Reliability/uptime goals',
          'Compliance requirements'
        ]
      },
      {
        id: 'constraints',
        title: 'Technical Constraints',
        placeholder: 'Limitations and boundaries',
        required: true,
        hints: [
          'Technology stack constraints',
          'Budget limitations',
          'Timeline',
          'Team expertise',
          'Infrastructure constraints'
        ]
      },
      {
        id: 'task',
        title: 'Task',
        content: 'Design the system architecture including:\n1. High-level architecture diagram\n2. Component breakdown\n3. Data models and flows\n4. Technology recommendations\n5. Scalability strategy\n6. Security architecture\n7. Deployment architecture\n8. Trade-offs and alternatives considered',
        required: true
      }
    ],
    variables: {
      '{{projectName}}': '',
      '{{targetScale}}': '',
      '{{budgetRange}}': ''
    },
    modelOptimizations: {
      'claude-3.5-sonnet': {
        formatStyle: 'xml',
        thinkingEnabled: true,
        systemPrompt: 'You are a solutions architect. Think comprehensively about scalability, maintainability, and trade-offs. Use diagrams where helpful.'
      },
      'gpt-4': {
        formatStyle: 'markdown',
        systemPrompt: 'You are an experienced system architect. Provide detailed architectural designs with clear reasoning.'
      }
    }
  }
];

/**
 * Template manager for CRUD operations
 */
export class TemplateManager {
  private static readonly STORAGE_KEY = 'promptTemplates';

  /**
   * Get all templates (default + custom)
   */
  static async getAllTemplates(): Promise<PromptTemplate[]> {
    const customTemplates = await this.getCustomTemplates();
    return [...DEFAULT_TEMPLATES, ...customTemplates];
  }

  /**
   * Get custom user-created templates
   */
  static async getCustomTemplates(): Promise<PromptTemplate[]> {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      return result[this.STORAGE_KEY] || [];
    } catch (error) {
      console.error('Failed to load custom templates:', error);
      return [];
    }
  }

  /**
   * Get template by ID
   */
  static async getTemplate(id: string): Promise<PromptTemplate | null> {
    const templates = await this.getAllTemplates();
    return templates.find(t => t.id === id) || null;
  }

  /**
   * Save custom template
   */
  static async saveTemplate(template: PromptTemplate): Promise<boolean> {
    try {
      const customTemplates = await this.getCustomTemplates();
      
      // Check if updating existing
      const existingIndex = customTemplates.findIndex(t => t.id === template.id);
      
      if (existingIndex >= 0) {
        customTemplates[existingIndex] = template;
      } else {
        // Ensure unique ID
        if (DEFAULT_TEMPLATES.find(t => t.id === template.id)) {
          throw new Error('Template ID conflicts with default template');
        }
        customTemplates.push(template);
      }
      
      await chrome.storage.local.set({ [this.STORAGE_KEY]: customTemplates });
      return true;
    } catch (error) {
      console.error('Failed to save template:', error);
      return false;
    }
  }

  /**
   * Delete custom template
   */
  static async deleteTemplate(id: string): Promise<boolean> {
    try {
      // Can't delete default templates
      if (DEFAULT_TEMPLATES.find(t => t.id === id)) {
        throw new Error('Cannot delete default templates');
      }
      
      const customTemplates = await this.getCustomTemplates();
      const filtered = customTemplates.filter(t => t.id !== id);
      
      await chrome.storage.local.set({ [this.STORAGE_KEY]: filtered });
      return true;
    } catch (error) {
      console.error('Failed to delete template:', error);
      return false;
    }
  }

  /**
   * Create template from current workspace
   */
  static createTemplateFromWorkspace(
    workspace: any,
    name: string,
    description: string,
    category: PromptTemplate['category'] = 'custom'
  ): PromptTemplate {
    const template: PromptTemplate = {
      id: `custom-${Date.now()}`,
      name,
      description,
      category,
      sections: []
    };

    // Map workspace fields to template sections
    if (workspace.template?.what) {
      template.sections.push({
        id: 'objective',
        title: 'Objective',
        content: workspace.template.what,
        required: true
      });
    }

    if (workspace.template?.requirements && workspace.template.requirements.length > 0) {
      template.sections.push({
        id: 'requirements',
        title: 'Requirements',
        content: workspace.template.requirements.join('\n'),
        required: true
      });
    }

    if (workspace.template?.constraints && workspace.template.constraints.length > 0) {
      template.sections.push({
        id: 'constraints',
        title: 'Constraints',
        content: workspace.template.constraints.join('\n'),
        required: false
      });
    }

    if (workspace.template?.edgeCases && workspace.template.edgeCases.length > 0) {
      template.sections.push({
        id: 'edge-cases',
        title: 'Edge Cases',
        content: workspace.template.edgeCases.join('\n'),
        required: false
      });
    }

    return template;
  }

  /**
   * Get template by category
   */
  static async getTemplatesByCategory(category: PromptTemplate['category']): Promise<PromptTemplate[]> {
    const templates = await this.getAllTemplates();
    return templates.filter(t => t.category === category);
  }
}
