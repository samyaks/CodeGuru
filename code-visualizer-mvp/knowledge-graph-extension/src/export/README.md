# UpdateAI Export System Documentation

## Overview

The Export System transforms your captured context, project links, and workspace content into optimized prompts for various AI models. It includes quality analysis, multiple export formats, and direct integrations with leading AI platforms.

## Architecture

```
src/export/
├── types.ts              # TypeScript type definitions
├── formatters.ts         # AI model-specific prompt formatters
├── templates.ts          # Reusable prompt templates
├── quality-analyzer.ts   # Prompt quality scoring
├── export-manager.ts     # Main export orchestration & API integration
├── export-ui.js          # Export modal UI component
├── export-ui.css         # Export modal styles
└── README.md            # This file
```

## Features

### 1. AI Model-Specific Formatters

The system formats prompts optimally for each AI model:

#### **Claude 3.5 Sonnet**
- Uses XML-style tags for better structure
- Enables thinking mode for complex reasoning
- Optimized for artifacts
- Example:
  ```xml
  <task>
    <workspace_context>
      <project_name>My Project</project_name>
      <requirements>
        <requirement id="1">Feature requirement</requirement>
      </requirements>
    </workspace_context>
  </task>
  ```

#### **GPT-4 / ChatGPT**
- Clean markdown structure
- Hierarchical sections with clear headers
- Code blocks for captured content
- Example:
  ```markdown
  # Task Overview
  
  ## Requirements
  1. First requirement
  2. Second requirement
  
  ## Captured Context
  ### Capture 1: Jira Ticket
  ...
  ```

#### **Gemini 1.5 Pro**
- Natural language with emojis
- Conversational tone
- Optimized for long context windows
- Example:
  ```
  🎯 **TASK BRIEF**
  
  📚 **RESEARCH CONTEXT**
  Here's the context I gathered...
  ```

#### **Cursor AI**
- Concise, directive format
- Minimal boilerplate
- Optimized for in-IDE usage
- Example:
  ```
  Build authentication system
  
  Requirements:
  - JWT tokens
  - Refresh tokens
  ...
  ```

### 2. Template System

Pre-built templates for common scenarios:

#### **Feature Implementation**
For building new features from scratch
- Sections: Objective, Requirements, Technical Spec, UI/UX, Edge Cases, Testing
- Variables: `{{projectName}}`, `{{techStack}}`, `{{designSystem}}`

#### **Bug Fix**
For debugging and fixing issues
- Sections: Bug Description, Reproduction Steps, Code Context, Impact

#### **API Integration**
For third-party API integrations
- Sections: Integration Goal, API Details, Requirements, Error Handling, Security

#### **Code Refactor**
For improving code quality
- Sections: Refactoring Goal, Current Code, Requirements, Constraints

#### **Architecture Design**
For system design and architecture
- Sections: System Overview, Requirements, Non-Functional Requirements, Constraints

#### **Custom Templates**
- Create templates from your workspace
- Save and reuse for similar tasks
- Share templates with team

### 3. Quality Analyzer

Analyzes prompts and provides actionable feedback:

#### **Quality Score (1-10)**
Based on:
- Clarity of objective
- Completeness of requirements
- Technical details specified
- Edge cases mentioned
- Error handling considerations

#### **Issue Detection**
- **Critical**: Missing objective, no requirements
- **Warning**: Vague language, missing constraints, no edge cases
- **Info**: No testing requirements, no tech stack mentioned

#### **Suggestions**
- Specific improvements for each issue
- Best practices tips
- Model-specific optimizations

#### **Strengths**
- Highlights what's done well
- Encourages good practices

### 4. Export Options

Multiple ways to export your prompt:

#### **Copy to Clipboard**
- Instantly copy formatted prompt
- Ready to paste into any AI chat

#### **Download as Markdown**
- Save as `.md` file
- Include in documentation
- Version control friendly

#### **Generate Shareable Link**
- Encode workspace data
- Share with team members
- Import into other devices

#### **Open in Cursor** (if available)
- Direct integration with Cursor IDE
- Prompt appears in Cursor chat
- Seamless workflow

### 5. API Integration (Optional)

Direct calls to AI providers:

#### **Supported APIs**
- **Claude API** (Anthropic)
- **OpenAI API** (GPT-4)
- **Gemini API** (Google)

#### **Features**
- Stream responses in real-time
- Track token usage
- Handle rate limits
- Error recovery

#### **Setup**
```javascript
// Store API key securely
await chrome.storage.local.set({ 
  apiKeys: { 
    claude: 'sk-...',
    openai: 'sk-...',
    gemini: 'AIza...' 
  } 
});

// Call API
const response = await AIAPIIntegration.callClaude(
  prompt,
  apiKey
);
```

## Usage

### Basic Export

```javascript
import { ExportManager } from './export/export-manager';

// Export with default options
const result = await ExportManager.export({
  model: 'claude-3.5-sonnet',
  format: 'markdown'
});

console.log(result.prompt);
console.log(`Quality Score: ${result.metadata.quality.score}/10`);
```

### Using Templates

```javascript
import { TemplateManager } from './export/templates';

// Get template
const template = await TemplateManager.getTemplate('feature-implementation');

// Export with template
const result = await ExportManager.export({
  model: 'gpt-4',
  template: template
});
```

### Quality Analysis

```javascript
import { ExportManager } from './export/export-manager';

// Analyze before exporting
const analysis = await ExportManager.getQualityAnalysis();

console.log(`Score: ${analysis.score}/10`);
console.log('Issues:', analysis.issues);
console.log('Suggestions:', analysis.suggestions);
```

### Custom Templates

```javascript
import { TemplateManager } from './export/templates';

// Create from workspace
const template = TemplateManager.createTemplateFromWorkspace(
  workspace,
  'My Custom Template',
  'Template for microservices',
  'custom'
);

// Save for reuse
await TemplateManager.saveTemplate(template);
```

## UI Integration

The export modal is automatically integrated into the popup:

1. **Export Button** appears in the captures section
2. Click **"✨ Export to AI"**
3. View quality score and issues
4. Select AI model
5. Choose optional template
6. Export via clipboard, download, or shareable link

## Data Flow

```
User Content (Captures + Workspace + Project)
    ↓
Quality Analyzer (checks for issues)
    ↓
Template System (applies template if selected)
    ↓
Prompt Formatter (formats for target AI model)
    ↓
Export Manager (handles output: clipboard/download/API)
    ↓
User gets optimized prompt
```

## Best Practices

### For Best Results

1. **Be Specific**
   - Use concrete details instead of vague terms
   - Example: "Response time < 200ms" not "good performance"

2. **Include Context**
   - Capture relevant documentation
   - Add project links with notes
   - Specify technical constraints

3. **Consider Edge Cases**
   - What could go wrong?
   - How to handle errors?
   - Invalid inputs?

4. **Mention Testing**
   - Unit tests needed?
   - Integration tests?
   - Test data requirements?

5. **Use Templates**
   - Start with a template for common tasks
   - Customize as needed
   - Save custom templates for reuse

### Quality Checklist

Before exporting, ensure:
- [ ] Clear objective (20+ characters)
- [ ] At least 3 requirements
- [ ] Technical constraints specified
- [ ] Edge cases mentioned
- [ ] Error handling considered
- [ ] Testing approach defined

## API Reference

### ExportManager

```typescript
class ExportManager {
  // Main export
  static async export(options: ExportOptions): Promise<ExportResult>
  
  // Utilities
  static async copyToClipboard(prompt: string): Promise<boolean>
  static async downloadAsMarkdown(prompt: string, filename?: string): Promise<boolean>
  static async generateShareableLink(): Promise<string>
  static async importFromLink(link: string): Promise<boolean>
  static async getQualityAnalysis(): Promise<QualityAnalysis>
}
```

### TemplateManager

```typescript
class TemplateManager {
  static async getAllTemplates(): Promise<PromptTemplate[]>
  static async getTemplate(id: string): Promise<PromptTemplate | null>
  static async saveTemplate(template: PromptTemplate): Promise<boolean>
  static async deleteTemplate(id: string): Promise<boolean>
  static createTemplateFromWorkspace(workspace, name, description, category): PromptTemplate
}
```

### PromptQualityAnalyzer

```typescript
class PromptQualityAnalyzer {
  static analyze(workspace, project, captures): QualityAnalysis
  static getScoreLabel(score: number): string
  static getScoreColor(score: number): string
  static generateImprovementTips(analysis: QualityAnalysis): string[]
  static isExportReady(analysis: QualityAnalysis): boolean
}
```

### AIAPIIntegration

```typescript
class AIAPIIntegration {
  static async callClaude(prompt: string, apiKey: string): Promise<string>
  static async callOpenAI(prompt: string, apiKey: string): Promise<string>
  static async callGemini(prompt: string, apiKey: string): Promise<string>
}
```

## Examples

### Example 1: Feature Implementation

```javascript
// Captured context from Jira, Figma, and Docs
const captures = [
  { type: 'jira', content: 'Build payment system...' },
  { type: 'figma', content: 'UI mockup...' },
  { type: 'google-docs', content: 'Technical spec...' }
];

// Export for Claude
const result = await ExportManager.export({
  model: 'claude-3.5-sonnet',
  template: await TemplateManager.getTemplate('feature-implementation')
});

// Quality: 8.5/10
// Prompt optimized for Claude with XML structure
```

### Example 2: Bug Fix

```javascript
// Captured error logs and stack traces
const captures = [
  { type: 'slack', content: 'Users reporting 500 errors...' },
  { type: 'github', content: 'Stack trace: ...' }
];

// Export for GPT-4
const result = await ExportManager.export({
  model: 'gpt-4',
  template: await TemplateManager.getTemplate('bug-fix')
});

// Get clean markdown with structured bug analysis
```

## Troubleshooting

### Export button disabled?
- Ensure you have captures or project links
- Check browser console for errors

### Low quality score?
- Add more specific requirements
- Include technical constraints
- Mention edge cases and error handling

### API calls failing?
- Verify API key is correct
- Check network permissions in manifest
- Review API rate limits

## Future Enhancements

Planned features:
- [ ] Streaming API responses with progress
- [ ] Template marketplace for sharing
- [ ] A/B testing different prompt formats
- [ ] Prompt versioning and history
- [ ] Team collaboration on prompts
- [ ] AI model comparison tool

## License

Part of UpdateAI Chrome Extension
