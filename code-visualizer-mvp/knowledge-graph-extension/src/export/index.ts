// UpdateAI Export System - Main Entry Point
// Import and re-export all modules for easy access

export * from './types';
export * from './formatters';
export * from './templates';
export * from './quality-analyzer';
export * from './export-manager';

// Re-export main classes for convenience
export { PromptFormatter } from './formatters';
export { TemplateManager, DEFAULT_TEMPLATES } from './templates';
export { PromptQualityAnalyzer } from './quality-analyzer';
export { ExportManager, AIAPIIntegration } from './export-manager';

/**
 * Quick Start Example:
 * 
 * ```typescript
 * import { ExportManager } from './export';
 * 
 * // Export for Claude
 * const result = await ExportManager.export({
 *   model: 'claude-3.5-sonnet',
 *   format: 'markdown'
 * });
 * 
 * // Copy to clipboard
 * await ExportManager.copyToClipboard(result.prompt);
 * ```
 */
