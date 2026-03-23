// Prompt quality analyzer - checks prompts for common issues

import { QualityAnalysis, QualityIssue, WorkspaceData, ProjectData, Capture } from './types';

export class PromptQualityAnalyzer {
  /**
   * Analyze prompt quality and provide score + suggestions
   */
  static analyze(
    workspace: WorkspaceData | null,
    project: ProjectData | null,
    captures: Capture[]
  ): QualityAnalysis {
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];
    const strengths: string[] = [];
    
    let score = 10; // Start with perfect score, deduct for issues

    // Check if there's any content at all
    if (!workspace && !project && captures.length === 0) {
      issues.push({
        severity: 'critical',
        category: 'completeness',
        message: 'No context provided',
        suggestion: 'Add workspace content, project links, or capture some context before exporting'
      });
      return {
        score: 1,
        issues,
        suggestions: ['Start by adding some context to your workspace'],
        strengths: []
      };
    }

    // Analyze workspace content
    if (workspace) {
      // Check objective/description
      if (!workspace.template.what || workspace.template.what.trim().length < 20) {
        issues.push({
          severity: 'critical',
          category: 'clarity',
          message: 'Missing or too brief objective description',
          suggestion: 'Add a clear description of what you want to build (at least 20 characters)'
        });
        score -= 2;
      } else if (workspace.template.what.trim().length < 50) {
        issues.push({
          severity: 'warning',
          category: 'clarity',
          message: 'Objective description is quite brief',
          suggestion: 'Consider adding more details about the purpose and expected outcome'
        });
        score -= 0.5;
      } else {
        strengths.push('Clear objective description');
      }

      // Check requirements
      if (!workspace.template.requirements || workspace.template.requirements.length === 0) {
        issues.push({
          severity: 'critical',
          category: 'completeness',
          message: 'No requirements specified',
          suggestion: 'Add functional requirements to guide the implementation'
        });
        score -= 2;
      } else if (workspace.template.requirements.length < 3) {
        issues.push({
          severity: 'warning',
          category: 'completeness',
          message: 'Only a few requirements listed',
          suggestion: 'Consider adding more detailed requirements for better results'
        });
        score -= 0.5;
      } else {
        strengths.push(`${workspace.template.requirements.length} requirements defined`);
      }

      // Check for vague requirements
      const vagueWords = ['some', 'better', 'good', 'nice', 'should work', 'etc', 'stuff'];
      const hasVagueRequirements = workspace.template.requirements?.some(req => 
        vagueWords.some(word => req.toLowerCase().includes(word))
      );
      
      if (hasVagueRequirements) {
        issues.push({
          severity: 'warning',
          category: 'clarity',
          message: 'Some requirements use vague language',
          suggestion: 'Be specific: instead of "good performance", say "response time under 200ms"'
        });
        score -= 1;
      }

      // Check constraints
      if (!workspace.template.constraints || workspace.template.constraints.length === 0) {
        issues.push({
          severity: 'warning',
          category: 'technical',
          message: 'No technical constraints specified',
          suggestion: 'Add constraints like tech stack, performance targets, or compatibility requirements'
        });
        score -= 1;
      } else {
        strengths.push('Technical constraints specified');
      }

      // Check edge cases
      if (!workspace.template.edgeCases || workspace.template.edgeCases.length === 0) {
        issues.push({
          severity: 'warning',
          category: 'completeness',
          message: 'No edge cases mentioned',
          suggestion: 'Consider error handling: What if network fails? Invalid input? Missing data?'
        });
        score -= 1;
      } else {
        strengths.push(`${workspace.template.edgeCases.length} edge cases considered`);
      }

      // Check for error handling mentions
      const hasErrorHandling = 
        workspace.template.requirements?.some(r => r.toLowerCase().includes('error')) ||
        workspace.template.edgeCases?.some(e => e.toLowerCase().includes('error')) ||
        workspace.template.constraints?.some(c => c.toLowerCase().includes('error'));
      
      if (!hasErrorHandling) {
        issues.push({
          severity: 'warning',
          category: 'technical',
          message: 'No mention of error handling',
          suggestion: 'Specify how errors should be handled (validation, network errors, etc.)'
        });
        score -= 0.5;
      }

      // Check for testing mentions
      const hasTestingMention = 
        workspace.template.requirements?.some(r => r.toLowerCase().includes('test')) ||
        workspace.template.constraints?.some(c => c.toLowerCase().includes('test'));
      
      if (!hasTestingMention) {
        issues.push({
          severity: 'info',
          category: 'completeness',
          message: 'No testing requirements',
          suggestion: 'Consider specifying testing expectations (unit tests, integration tests, etc.)'
        });
      }
    }

    // Analyze captured context
    if (captures.length === 0) {
      suggestions.push('Capture relevant context from Jira, Slack, or Docs to enrich your prompt');
    } else if (captures.length < 3) {
      suggestions.push('More captures would provide better context for the AI');
    } else {
      strengths.push(`${captures.length} contextual captures included`);
    }

    // Check capture diversity
    if (captures.length > 0) {
      const captureTypes = new Set(captures.map(c => c.type));
      if (captureTypes.size > 1) {
        strengths.push('Diverse context from multiple sources');
      }
    }

    // Analyze project links
    if (project && project.links && project.links.length > 0) {
      const categorizedLinks = project.links.filter(link => link.category);
      const uncategorizedLinks = project.links.filter(link => !link.category);
      
      if (uncategorizedLinks.length > 0) {
        issues.push({
          severity: 'info',
          category: 'structure',
          message: `${uncategorizedLinks.length} project links are uncategorized`,
          suggestion: 'Categorize links (progress, decisions, blockers) for better prompt structure'
        });
        score -= 0.5;
      }
      
      const linksWithNotes = project.links.filter(link => link.notes && link.notes.length > 0);
      if (linksWithNotes.length > 0) {
        strengths.push(`${linksWithNotes.length} links have detailed notes`);
      } else {
        suggestions.push('Add notes to project links to provide more context');
      }
    }

    // Check overall context richness
    const totalContext = 
      (workspace?.template.what?.length || 0) +
      (workspace?.template.requirements?.join('').length || 0) +
      captures.reduce((sum, c) => sum + c.content.length, 0);
    
    if (totalContext < 200) {
      issues.push({
        severity: 'warning',
        category: 'completeness',
        message: 'Limited context provided',
        suggestion: 'Add more details to help the AI understand your needs better'
      });
      score -= 1;
    }

    // Check for specific technical details
    const technicalKeywords = [
      'api', 'database', 'authentication', 'framework', 'library',
      'typescript', 'javascript', 'python', 'react', 'node',
      'sql', 'nosql', 'rest', 'graphql', 'microservice'
    ];
    
    const allText = [
      workspace?.template.what || '',
      ...(workspace?.template.requirements || []),
      ...(workspace?.template.constraints || [])
    ].join(' ').toLowerCase();
    
    const hasTechnicalDetails = technicalKeywords.some(keyword => allText.includes(keyword));
    
    if (!hasTechnicalDetails && workspace) {
      issues.push({
        severity: 'info',
        category: 'technical',
        message: 'No specific technical stack mentioned',
        suggestion: 'Specify technologies, frameworks, or languages to use for better results'
      });
    }

    // Ensure score is in valid range
    score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));

    // Add general suggestions based on score
    if (score < 5) {
      suggestions.push('Your prompt needs significant improvement. Address critical issues first.');
    } else if (score < 7) {
      suggestions.push('Good start! Address the warnings to improve AI output quality.');
    } else if (score < 9) {
      suggestions.push('Solid prompt! Minor improvements could make it even better.');
    } else {
      suggestions.push('Excellent prompt! The AI has great context to work with.');
    }

    return {
      score,
      issues,
      suggestions,
      strengths
    };
  }

  /**
   * Get human-readable quality score label
   */
  static getScoreLabel(score: number): string {
    if (score >= 9) return 'Excellent';
    if (score >= 7) return 'Good';
    if (score >= 5) return 'Fair';
    if (score >= 3) return 'Poor';
    return 'Needs Work';
  }

  /**
   * Get score color for UI
   */
  static getScoreColor(score: number): string {
    if (score >= 9) return '#10b981'; // green
    if (score >= 7) return '#3b82f6'; // blue
    if (score >= 5) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  }

  /**
   * Generate improvement tips based on analysis
   */
  static generateImprovementTips(analysis: QualityAnalysis): string[] {
    const tips: string[] = [];

    // Tips for critical issues
    const criticalIssues = analysis.issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      tips.push('🚨 Fix critical issues first - they significantly impact AI output quality');
    }

    // Category-specific tips
    const clarityIssues = analysis.issues.filter(i => i.category === 'clarity');
    if (clarityIssues.length > 0) {
      tips.push('💡 Be more specific: Replace vague terms with concrete details and measurements');
    }

    const completenessIssues = analysis.issues.filter(i => i.category === 'completeness');
    if (completenessIssues.length > 0) {
      tips.push('📋 Add missing sections: Requirements, constraints, and edge cases improve results');
    }

    const technicalIssues = analysis.issues.filter(i => i.category === 'technical');
    if (technicalIssues.length > 0) {
      tips.push('⚙️ Specify technical details: Tech stack, APIs, frameworks, and performance targets');
    }

    // General best practices
    if (analysis.score < 8) {
      tips.push('✨ Pro tip: Include examples of similar features or reference implementations');
    }

    return tips;
  }

  /**
   * Quick quality check - returns true if prompt is good enough to export
   */
  static isExportReady(analysis: QualityAnalysis): boolean {
    // Must have score above 4 and no critical issues
    return analysis.score >= 4 && 
           !analysis.issues.some(i => i.severity === 'critical');
  }
}
