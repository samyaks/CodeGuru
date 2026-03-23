// Main export manager - orchestrates the export process

import { PromptFormatter } from './formatters';
import { PromptQualityAnalyzer } from './quality-analyzer';
import { TemplateManager } from './templates';
import {
  AIModel,
  Capture,
  ExportOptions,
  ExportResult,
  ProjectData,
  WorkspaceData
} from './types';

export class ExportManager {
  /**
   * Main export function - generates AI-ready prompt
   */
  static async export(options: ExportOptions): Promise<ExportResult> {
    // Load data from storage
    const workspace = await this.loadWorkspace();
    const project = await this.loadProject();
    const captures = await this.loadCaptures();

    // Apply template if specified
    if (options.template) {
      // Merge template with workspace data
      workspace = this.applyTemplate(workspace, options.template);
    }

    // Format prompt for target AI model
    const prompt = PromptFormatter.formatForModel(
      workspace,
      project,
      captures,
      options
    );

    // Analyze quality
    const quality = PromptQualityAnalyzer.analyze(workspace, project, captures);

    return {
      prompt,
      model: options.model,
      format: options.format || 'markdown',
      metadata: {
        captureCount: captures.length,
        linkCount: project?.links?.length || 0,
        timestamp: Date.now(),
        quality
      }
    };
  }

  /**
   * Copy prompt to clipboard
   */
  static async copyToClipboard(prompt: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(prompt);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }

  /**
   * Download prompt as markdown file
   */
  static async downloadAsMarkdown(prompt: string, filename?: string): Promise<boolean> {
    try {
      const blob = new Blob([prompt], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `prompt-${Date.now()}.md`;
      a.click();
      
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error('Failed to download:', error);
      return false;
    }
  }

  /**
   * Generate shareable link (encode workspace + captures)
   */
  static async generateShareableLink(): Promise<string> {
    const workspace = await this.loadWorkspace();
    const project = await this.loadProject();
    const captures = await this.loadCaptures();

    const data = {
      workspace,
      project,
      captures,
      timestamp: Date.now()
    };

    // Encode data to base64
    const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
    
    // Generate link (you would replace this with your actual domain)
    return `https://updateai.app/import#${encoded}`;
  }

  /**
   * Import from shareable link
   */
  static async importFromLink(link: string): Promise<boolean> {
    try {
      const hash = link.split('#')[1];
      if (!hash) throw new Error('Invalid link format');

      const decoded = JSON.parse(decodeURIComponent(atob(hash)));
      
      // Save to storage
      if (decoded.workspace) {
        await chrome.storage.local.set({ workspace: decoded.workspace });
      }
      if (decoded.project) {
        await chrome.storage.local.set({ project: decoded.project });
      }
      if (decoded.captures) {
        await chrome.storage.local.set({ captures: decoded.captures });
      }

      return true;
    } catch (error) {
      console.error('Failed to import from link:', error);
      return false;
    }
  }

  /**
   * Open prompt in Cursor AI (if installed)
   */
  static async openInCursor(prompt: string): Promise<boolean> {
    try {
      // Try to open Cursor with the prompt
      // This would require Cursor's URL scheme or API
      const cursorUrl = `cursor://prompt?content=${encodeURIComponent(prompt)}`;
      window.open(cursorUrl, '_blank');
      return true;
    } catch (error) {
      console.error('Failed to open in Cursor:', error);
      return false;
    }
  }

  /**
   * Get quality analysis preview
   */
  static async getQualityAnalysis() {
    const workspace = await this.loadWorkspace();
    const project = await this.loadProject();
    const captures = await this.loadCaptures();

    return PromptQualityAnalyzer.analyze(workspace, project, captures);
  }

  // Private helper methods

  private static async loadWorkspace(): Promise<WorkspaceData | null> {
    try {
      const result = await chrome.storage.local.get(['workspace']);
      return result.workspace || null;
    } catch (error) {
      console.error('Failed to load workspace:', error);
      return null;
    }
  }

  private static async loadProject(): Promise<ProjectData | null> {
    try {
      const result = await chrome.storage.local.get(['project']);
      return result.project || null;
    } catch (error) {
      console.error('Failed to load project:', error);
      return null;
    }
  }

  private static async loadCaptures(): Promise<Capture[]> {
    try {
      const result = await chrome.storage.local.get(['captures']);
      return result.captures || [];
    } catch (error) {
      console.error('Failed to load captures:', error);
      return [];
    }
  }

  private static applyTemplate(workspace: WorkspaceData | null, template: any): WorkspaceData | null {
    if (!workspace) {
      // Create new workspace from template
      workspace = {
        id: Date.now().toString(),
        name: 'New Workspace',
        status: 'draft',
        template: {
          what: '',
          requirements: [],
          design: '',
          constraints: [],
          edgeCases: []
        },
        captures: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    // Apply template sections
    template.sections.forEach((section: any) => {
      if (section.content) {
        switch (section.id) {
          case 'objective':
            workspace!.template.what = section.content;
            break;
          case 'requirements':
            workspace!.template.requirements = section.content.split('\n').filter((r: string) => r.trim());
            break;
          case 'constraints':
            workspace!.template.constraints = section.content.split('\n').filter((c: string) => c.trim());
            break;
          case 'edge-cases':
            workspace!.template.edgeCases = section.content.split('\n').filter((e: string) => e.trim());
            break;
        }
      }
    });

    return workspace;
  }
}

/**
 * AI API Integration (optional) - direct calls to AI providers
 */
export class AIAPIIntegration {
  /**
   * Call Claude API
   */
  static async callClaude(prompt: string, apiKey: string): Promise<string> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 8000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      console.error('Claude API call failed:', error);
      throw error;
    }
  }

  /**
   * Call OpenAI API
   */
  static async callOpenAI(prompt: string, apiKey: string): Promise<string> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 4000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API call failed:', error);
      throw error;
    }
  }

  /**
   * Call Gemini API
   */
  static async callGemini(prompt: string, apiKey: string): Promise<string> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Gemini API call failed:', error);
      throw error;
    }
  }

  /**
   * Stream response from AI (for real-time updates)
   */
  static async streamResponse(
    prompt: string,
    apiKey: string,
    model: AIModel,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    // Implement streaming based on model
    // This would use Server-Sent Events (SSE) or fetch streaming
    throw new Error('Streaming not yet implemented');
  }
}
