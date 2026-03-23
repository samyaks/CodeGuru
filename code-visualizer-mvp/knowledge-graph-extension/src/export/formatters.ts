// AI Model-specific prompt formatters

import { AIModel, Capture, ProjectData, WorkspaceData, ExportOptions } from './types';

export class PromptFormatter {
  /**
   * Main entry point - formats workspace data for specific AI model
   */
  static formatForModel(
    workspace: WorkspaceData | null,
    project: ProjectData | null,
    captures: Capture[],
    options: ExportOptions
  ): string {
    switch (options.model) {
      case 'claude-3.5-sonnet':
        return this.formatForClaude(workspace, project, captures, options);
      case 'gpt-4':
        return this.formatForGPT4(workspace, project, captures, options);
      case 'gemini-1.5-pro':
        return this.formatForGemini(workspace, project, captures, options);
      case 'cursor-ai':
        return this.formatForCursor(workspace, project, captures, options);
      default:
        return this.formatForClaude(workspace, project, captures, options);
    }
  }

  /**
   * Claude 3.5 Sonnet formatter - optimized for artifacts and thinking
   */
  private static formatForClaude(
    workspace: WorkspaceData | null,
    project: ProjectData | null,
    captures: Capture[],
    options: ExportOptions
  ): string {
    let prompt = '';

    // Use XML-style tags for Claude (it performs better with structured XML)
    prompt += '<task>\n';
    
    if (options.template) {
      prompt += `<objective>\n${options.template.sections.find(s => s.id === 'objective')?.content || 'Build the requested feature'}\n</objective>\n\n`;
    }

    if (workspace) {
      prompt += '<workspace_context>\n';
      prompt += `<project_name>${workspace.name}</project_name>\n`;
      
      if (workspace.template.what) {
        prompt += `<description>\n${workspace.template.what}\n</description>\n`;
      }
      
      if (workspace.template.requirements && workspace.template.requirements.length > 0) {
        prompt += '<requirements>\n';
        workspace.template.requirements.forEach((req, i) => {
          prompt += `  <requirement id="${i + 1}">${req}</requirement>\n`;
        });
        prompt += '</requirements>\n';
      }
      
      if (workspace.template.constraints && workspace.template.constraints.length > 0) {
        prompt += '<constraints>\n';
        workspace.template.constraints.forEach((constraint, i) => {
          prompt += `  <constraint id="${i + 1}">${constraint}</constraint>\n`;
        });
        prompt += '</constraints>\n';
      }
      
      if (workspace.template.edgeCases && workspace.template.edgeCases.length > 0) {
        prompt += '<edge_cases>\n';
        workspace.template.edgeCases.forEach((edge, i) => {
          prompt += `  <case id="${i + 1}">${edge}</case>\n`;
        });
        prompt += '</edge_cases>\n';
      }
      
      prompt += '</workspace_context>\n\n';
    }

    // Add captured context
    if (captures && captures.length > 0) {
      prompt += '<captured_context>\n';
      prompt += `<!-- ${captures.length} captures from your research -->\n\n`;
      
      captures.forEach((capture, i) => {
        prompt += `<capture id="${i + 1}" source="${capture.type}">\n`;
        prompt += `  <source_url>${capture.url || 'N/A'}</source_url>\n`;
        prompt += `  <title>${capture.source}</title>\n`;
        prompt += `  <content>\n${this.sanitizeContent(capture.content)}\n  </content>\n`;
        if (capture.metadata) {
          prompt += `  <metadata>${JSON.stringify(capture.metadata)}</metadata>\n`;
        }
        prompt += `  <captured_at>${new Date(capture.timestamp).toISOString()}</captured_at>\n`;
        prompt += '</capture>\n\n';
      });
      
      prompt += '</captured_context>\n\n';
    }

    // Add project links if available
    if (project && project.links && project.links.length > 0) {
      prompt += '<project_links>\n';
      
      const grouped = this.groupLinksByCategory(project.links);
      
      Object.entries(grouped).forEach(([category, links]) => {
        if (links.length === 0) return;
        
        prompt += `<category name="${category}">\n`;
        links.forEach((link, i) => {
          prompt += `  <link id="${i + 1}">\n`;
          prompt += `    <title>${link.title}</title>\n`;
          prompt += `    <url>${link.url}</url>\n`;
          if (link.notes && link.notes.length > 0) {
            prompt += `    <notes>\n`;
            link.notes.forEach(note => {
              prompt += `      <note>${note.text}</note>\n`;
            });
            prompt += `    </notes>\n`;
          }
          prompt += `  </link>\n`;
        });
        prompt += `</category>\n\n`;
      });
      
      prompt += '</project_links>\n\n';
    }

    // Add instructions
    prompt += '<instructions>\n';
    prompt += 'Using the context provided above:\n\n';
    
    if (options.template) {
      const taskSection = options.template.sections.find(s => s.id === 'task');
      if (taskSection?.content) {
        prompt += `${taskSection.content}\n\n`;
      }
    } else {
      prompt += '1. Analyze all captured context carefully\n';
      prompt += '2. Understand the requirements and constraints\n';
      prompt += '3. Design a solution that addresses all edge cases\n';
      prompt += '4. Implement clean, maintainable code\n';
      prompt += '5. Add proper error handling and validation\n';
      prompt += '6. Include relevant tests\n\n';
    }
    
    prompt += 'Please think through the problem step by step, then provide your implementation.\n';
    prompt += '</instructions>\n';
    
    prompt += '</task>\n';

    return prompt;
  }

  /**
   * GPT-4 formatter - optimized for structured markdown
   */
  private static formatForGPT4(
    workspace: WorkspaceData | null,
    project: ProjectData | null,
    captures: Capture[],
    options: ExportOptions
  ): string {
    let prompt = '';

    // GPT-4 works well with clear markdown structure
    prompt += '# Task Overview\n\n';
    
    if (workspace) {
      prompt += `## Project: ${workspace.name}\n\n`;
      
      if (workspace.template.what) {
        prompt += `**Description:**\n${workspace.template.what}\n\n`;
      }
      
      if (workspace.template.requirements && workspace.template.requirements.length > 0) {
        prompt += '## Requirements\n\n';
        workspace.template.requirements.forEach((req, i) => {
          prompt += `${i + 1}. ${req}\n`;
        });
        prompt += '\n';
      }
      
      if (workspace.template.constraints && workspace.template.constraints.length > 0) {
        prompt += '## Technical Constraints\n\n';
        workspace.template.constraints.forEach((constraint) => {
          prompt += `- ${constraint}\n`;
        });
        prompt += '\n';
      }
      
      if (workspace.template.edgeCases && workspace.template.edgeCases.length > 0) {
        prompt += '## Edge Cases to Handle\n\n';
        workspace.template.edgeCases.forEach((edge) => {
          prompt += `- ${edge}\n`;
        });
        prompt += '\n';
      }
    }

    // Add captured context
    if (captures && captures.length > 0) {
      prompt += `## Captured Context (${captures.length} items)\n\n`;
      prompt += '*Context gathered from your research and documentation:*\n\n';
      
      captures.forEach((capture, i) => {
        prompt += `### Capture ${i + 1}: ${capture.source}\n\n`;
        prompt += `**Source:** ${capture.type}\n`;
        if (capture.url) {
          prompt += `**URL:** ${capture.url}\n`;
        }
        prompt += `**Captured:** ${new Date(capture.timestamp).toLocaleString()}\n\n`;
        prompt += '**Content:**\n```\n';
        prompt += this.sanitizeContent(capture.content);
        prompt += '\n```\n\n';
      });
    }

    // Add project links
    if (project && project.links && project.links.length > 0) {
      prompt += '## Project Links & Notes\n\n';
      
      const grouped = this.groupLinksByCategory(project.links);
      
      Object.entries(grouped).forEach(([category, links]) => {
        if (links.length === 0) return;
        
        prompt += `### ${this.formatCategoryName(category)}\n\n`;
        links.forEach((link) => {
          prompt += `- **${link.title}**\n`;
          prompt += `  - URL: ${link.url}\n`;
          if (link.notes && link.notes.length > 0) {
            link.notes.forEach(note => {
              prompt += `  - Note: ${note.text}\n`;
            });
          }
        });
        prompt += '\n';
      });
    }

    // Add instructions
    prompt += '## Your Task\n\n';
    
    if (options.template) {
      const taskSection = options.template.sections.find(s => s.id === 'task');
      if (taskSection?.content) {
        prompt += `${taskSection.content}\n\n`;
      }
    } else {
      prompt += 'Based on the context above:\n\n';
      prompt += '1. Analyze all requirements and constraints\n';
      prompt += '2. Review the captured context for relevant implementation details\n';
      prompt += '3. Design a comprehensive solution\n';
      prompt += '4. Implement with proper error handling\n';
      prompt += '5. Consider all edge cases\n';
      prompt += '6. Provide clean, well-documented code\n\n';
    }
    
    prompt += '**Please provide a detailed implementation plan followed by the code.**\n';

    return prompt;
  }

  /**
   * Gemini formatter - optimized for multimodal and long context
   */
  private static formatForGemini(
    workspace: WorkspaceData | null,
    project: ProjectData | null,
    captures: Capture[],
    options: ExportOptions
  ): string {
    let prompt = '';

    // Gemini handles natural language well with clear sections
    prompt += '🎯 **TASK BRIEF**\n\n';
    
    if (workspace) {
      prompt += `Project Name: **${workspace.name}**\n\n`;
      
      if (workspace.template.what) {
        prompt += `**What needs to be built:**\n${workspace.template.what}\n\n`;
      }
      
      if (workspace.template.requirements && workspace.template.requirements.length > 0) {
        prompt += '**Must-Have Requirements:**\n';
        workspace.template.requirements.forEach((req, i) => {
          prompt += `${i + 1}. ${req}\n`;
        });
        prompt += '\n';
      }
      
      if (workspace.template.constraints && workspace.template.constraints.length > 0) {
        prompt += '**Technical Constraints:**\n';
        workspace.template.constraints.forEach((constraint) => {
          prompt += `• ${constraint}\n`;
        });
        prompt += '\n';
      }
      
      if (workspace.template.edgeCases && workspace.template.edgeCases.length > 0) {
        prompt += '**Edge Cases:**\n';
        workspace.template.edgeCases.forEach((edge) => {
          prompt += `⚠️ ${edge}\n`;
        });
        prompt += '\n';
      }
    }

    prompt += '---\n\n';

    // Add captured context
    if (captures && captures.length > 0) {
      prompt += `📚 **RESEARCH CONTEXT** (${captures.length} captures)\n\n`;
      prompt += '*Here\'s the context I gathered:*\n\n';
      
      captures.forEach((capture, i) => {
        const icon = this.getSourceIcon(capture.type);
        prompt += `${icon} **${capture.source}**\n`;
        prompt += `*From: ${capture.type} | Captured: ${new Date(capture.timestamp).toLocaleString()}*\n\n`;
        prompt += '```\n';
        prompt += this.sanitizeContent(capture.content);
        prompt += '\n```\n\n';
      });
      
      prompt += '---\n\n';
    }

    // Add project links
    if (project && project.links && project.links.length > 0) {
      prompt += '🔗 **RELATED WORK & CONTEXT**\n\n';
      
      const grouped = this.groupLinksByCategory(project.links);
      
      Object.entries(grouped).forEach(([category, links]) => {
        if (links.length === 0) return;
        
        const categoryIcon = this.getCategoryIcon(category);
        prompt += `${categoryIcon} **${this.formatCategoryName(category)}**\n\n`;
        
        links.forEach((link) => {
          prompt += `• ${link.title}\n`;
          if (link.notes && link.notes.length > 0) {
            link.notes.forEach(note => {
              prompt += `  → ${note.text}\n`;
            });
          }
        });
        prompt += '\n';
      });
      
      prompt += '---\n\n';
    }

    // Add instructions
    prompt += '✨ **WHAT I NEED FROM YOU**\n\n';
    
    if (options.template) {
      const taskSection = options.template.sections.find(s => s.id === 'task');
      if (taskSection?.content) {
        prompt += `${taskSection.content}\n\n`;
      }
    } else {
      prompt += 'Please help me by:\n\n';
      prompt += '1. 🔍 Analyzing all the context I\'ve provided\n';
      prompt += '2. 🎨 Designing a solid solution\n';
      prompt += '3. 💻 Writing clean, production-ready code\n';
      prompt += '4. 🛡️ Adding proper error handling\n';
      prompt += '5. ✅ Covering all edge cases\n';
      prompt += '6. 📝 Including helpful comments\n\n';
    }
    
    prompt += 'Let me know if you need any clarification!\n';

    return prompt;
  }

  /**
   * Cursor AI formatter - optimized for in-IDE context
   */
  private static formatForCursor(
    workspace: WorkspaceData | null,
    project: ProjectData | null,
    captures: Capture[],
    options: ExportOptions
  ): string {
    let prompt = '';

    // Cursor works best with concise, directive prompts
    if (workspace && workspace.template.what) {
      prompt += `${workspace.template.what}\n\n`;
    }

    // Requirements
    if (workspace && workspace.template.requirements && workspace.template.requirements.length > 0) {
      prompt += 'Requirements:\n';
      workspace.template.requirements.forEach((req) => {
        prompt += `- ${req}\n`;
      });
      prompt += '\n';
    }

    // Constraints
    if (workspace && workspace.template.constraints && workspace.template.constraints.length > 0) {
      prompt += 'Constraints:\n';
      workspace.template.constraints.forEach((constraint) => {
        prompt += `- ${constraint}\n`;
      });
      prompt += '\n';
    }

    // Captured context (condensed)
    if (captures && captures.length > 0) {
      prompt += `Context from research (${captures.length} captures):\n\n`;
      captures.forEach((capture) => {
        prompt += `[${capture.type}] ${capture.source}:\n`;
        prompt += `${this.sanitizeContent(capture.content, 200)}\n\n`;
      });
    }

    // Edge cases
    if (workspace && workspace.template.edgeCases && workspace.template.edgeCases.length > 0) {
      prompt += 'Edge cases to handle:\n';
      workspace.template.edgeCases.forEach((edge) => {
        prompt += `- ${edge}\n`;
      });
      prompt += '\n';
    }

    if (options.template) {
      const taskSection = options.template.sections.find(s => s.id === 'task');
      if (taskSection?.content) {
        prompt += `\n${taskSection.content}\n`;
      }
    }

    return prompt.trim();
  }

  /**
   * Helper: Group links by category
   */
  private static groupLinksByCategory(links: ProjectData['links']) {
    const grouped: Record<string, ProjectData['links']> = {
      progress: [],
      decision: [],
      blocker: [],
      next_step: [],
      uncategorized: []
    };

    links.forEach(link => {
      const category = link.category || 'uncategorized';
      if (grouped[category]) {
        grouped[category].push(link);
      } else {
        grouped.uncategorized.push(link);
      }
    });

    return grouped;
  }

  /**
   * Helper: Sanitize and truncate content
   */
  private static sanitizeContent(content: string, maxLength?: number): string {
    let sanitized = content.trim();
    
    if (maxLength && sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '...';
    }
    
    return sanitized;
  }

  /**
   * Helper: Format category names
   */
  private static formatCategoryName(category: string): string {
    const names: Record<string, string> = {
      progress: '✅ Progress Made',
      decision: '💡 Key Decisions',
      blocker: '⚠️ Blockers',
      next_step: '➡️ Next Steps',
      uncategorized: '📎 Additional Context'
    };
    return names[category] || category;
  }

  /**
   * Helper: Get category icon
   */
  private static getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      progress: '✅',
      decision: '💡',
      blocker: '⚠️',
      next_step: '➡️',
      uncategorized: '📎'
    };
    return icons[category] || '📌';
  }

  /**
   * Helper: Get source icon
   */
  private static getSourceIcon(type: string): string {
    const icons: Record<string, string> = {
      jira: '📋',
      slack: '💬',
      'google-docs': '📝',
      figma: '🎨',
      github: '🐙',
      notion: '📓'
    };
    return icons[type] || '📄';
  }
}
