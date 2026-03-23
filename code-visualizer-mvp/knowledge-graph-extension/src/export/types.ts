// Type definitions for the export system

export interface Capture {
  id: string;
  type: 'jira' | 'slack' | 'google-docs' | 'figma' | 'github' | 'notion';
  source: string;
  content: string;
  url?: string;
  timestamp: number;
  metadata?: {
    author?: string;
    channel?: string;
    ticketId?: string;
    [key: string]: any;
  };
}

export interface WorkspaceData {
  id: string;
  name: string;
  status: string;
  template: {
    what: string;
    requirements: string[];
    design: string;
    constraints: string[];
    edgeCases: string[];
  };
  captures: Capture[];
  collaborators?: Array<{
    name: string;
    initials: string;
    role: string;
    color: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectData {
  name: string;
  links: Array<{
    title: string;
    url: string;
    platform: string;
    icon: string;
    addedAt: number;
    lastUpdated?: number;
    category?: 'progress' | 'decision' | 'blocker' | 'next_step';
    notes?: Array<{
      text: string;
      addedAt: number;
    }>;
  }>;
  createdAt: number;
}

export type AIModel = 'claude-3.5-sonnet' | 'gpt-4' | 'gemini-1.5-pro' | 'cursor-ai';

export interface ExportOptions {
  model: AIModel;
  template?: PromptTemplate;
  includeMetadata?: boolean;
  format?: 'markdown' | 'xml' | 'json';
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'feature' | 'bugfix' | 'api' | 'refactor' | 'architecture' | 'custom';
  sections: PromptSection[];
  variables?: Record<string, string>;
  modelOptimizations?: Partial<Record<AIModel, ModelOptimization>>;
}

export interface PromptSection {
  id: string;
  title: string;
  placeholder?: string;
  required: boolean;
  content?: string;
  hints?: string[];
}

export interface ModelOptimization {
  formatStyle: 'xml' | 'markdown' | 'json';
  specialInstructions?: string;
  systemPrompt?: string;
  thinkingEnabled?: boolean;
  artifactEnabled?: boolean;
}

export interface QualityAnalysis {
  score: number; // 1-10
  issues: QualityIssue[];
  suggestions: string[];
  strengths: string[];
}

export interface QualityIssue {
  severity: 'critical' | 'warning' | 'info';
  category: 'clarity' | 'completeness' | 'technical' | 'structure';
  message: string;
  suggestion?: string;
}

export interface ExportResult {
  prompt: string;
  model: AIModel;
  format: string;
  metadata: {
    captureCount: number;
    linkCount: number;
    timestamp: number;
    quality?: QualityAnalysis;
  };
}
