const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3002;

// Initialize Claude API
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// Store analysis results in memory (in production, use a database)
const analyses = new Map();
const analysisConnections = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'Codebase Analyzer',
    version: '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Codebase Analyzer API',
    description: 'AI-powered codebase analysis for CTOs and tech leaders',
    endpoints: [
      'POST /api/analyze',
      'GET /api/analyses/:id',
      'GET /api/analyses/:id/stream'
    ]
  });
});

// Analyze repository
app.post('/api/analyze', async (req, res) => {
  try {
    const { repoUrl, analysisType = 'comprehensive' } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required' });
    }

    console.log(`🔍 Analyzing repository: ${repoUrl}`);

    // Extract owner and repo from URL
    const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }

    const [, owner, repo] = repoMatch;
    const analysisId = uuidv4();

    // Create analysis record
    const analysis = {
      id: analysisId,
      repoUrl,
      owner,
      repo,
      analysisType,
      status: 'analyzing',
      createdAt: new Date().toISOString(),
      results: null
    };

    analyses.set(analysisId, analysis);

    // Start analysis in background
    performAnalysis(analysisId, owner, repo, analysisType).catch(error => {
      console.error('❌ Analysis failed:', error);
      const analysis = analyses.get(analysisId);
      if (analysis) {
        analysis.status = 'failed';
        analysis.error = error.message;
      }
    });

    res.json({
      analysisId,
      status: 'started',
      message: 'Analysis started successfully'
    });

  } catch (error) {
    console.error('❌ Error starting analysis:', error);
    res.status(500).json({ error: 'Failed to start analysis' });
  }
});

// Get analysis results
app.get('/api/analyses/:id', (req, res) => {
  const { id } = req.params;
  const analysis = analyses.get(id);

  if (!analysis) {
    return res.status(404).json({ error: 'Analysis not found' });
  }

  res.json(analysis);
});

// SSE endpoint for real-time updates
app.get('/api/analyses/:id/stream', (req, res) => {
  const { id } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', analysisId: id })}\n\n`);

  // Store connection
  if (!analysisConnections.has(id)) {
    analysisConnections.set(id, []);
  }
  analysisConnections.get(id).push(res);

  // Heartbeat
  const heartbeat = setInterval(() => {
    try {
      res.write('data: {"type":"heartbeat"}\n\n');
    } catch (error) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const connections = analysisConnections.get(id) || [];
    const index = connections.indexOf(res);
    if (index !== -1) {
      connections.splice(index, 1);
    }
  });
});

// Broadcast to analysis connections
function broadcastToAnalysis(analysisId, data) {
  const connections = analysisConnections.get(analysisId) || [];
  const message = `data: ${JSON.stringify(data)}\n\n`;
  
  connections.forEach((res, index) => {
    try {
      res.write(message);
    } catch (error) {
      connections.splice(index, 1);
    }
  });
}

// Perform the actual analysis
async function performAnalysis(analysisId, owner, repo, analysisType) {
  console.log(`🔍 Starting analysis for ${owner}/${repo}`);

  try {
    // Send initial analysis message
    broadcastToAnalysis(analysisId, {
      type: 'analysis-started',
      message: `Starting comprehensive analysis of ${owner}/${repo}...`
    });

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 2000,
      stream: true,
      messages: [{
        role: "user",
        content: `You are a senior software architect and CTO advisor. Analyze this GitHub repository: ${owner}/${repo}

        Provide a comprehensive analysis suitable for CTOs and tech leaders including:
        - Executive summary of the codebase
        - Technology stack and architecture assessment
        - Code quality and maintainability analysis
        - Security and performance considerations
        - Technical debt identification
        - Team onboarding recommendations
        - Risk assessment and recommendations

        Return a JSON object with this structure:
        {
          "executiveSummary": "High-level overview for CTOs",
          "technologyStack": {
            "primary": ["main technologies"],
            "secondary": ["supporting technologies"],
            "versions": "version information"
          },
          "architecture": {
            "pattern": "Architecture pattern used",
            "complexity": "beginner/intermediate/advanced",
            "scalability": "assessment of scalability"
          },
          "codeQuality": {
            "overall": "excellent/good/fair/poor",
            "maintainability": "assessment",
            "documentation": "documentation quality",
            "testing": "test coverage and quality"
          },
          "security": {
            "level": "high/medium/low",
            "concerns": ["security issues identified"],
            "recommendations": ["security improvements"]
          },
          "technicalDebt": {
            "level": "high/medium/low",
            "areas": ["problematic areas"],
            "impact": "business impact assessment"
          },
          "onboarding": {
            "difficulty": "easy/medium/hard",
            "timeEstimate": "estimated onboarding time",
            "recommendations": ["onboarding suggestions"]
          },
          "risks": {
            "technical": ["technical risks"],
            "business": ["business risks"],
            "mitigation": ["risk mitigation strategies"]
          },
          "recommendations": {
            "immediate": ["immediate actions"],
            "shortTerm": ["short-term improvements"],
            "longTerm": ["long-term strategic recommendations"]
          }
        }

        Focus on business and technical leadership insights.`
      }]
    });

    let fullResponse = '';
    
    for await (const chunk of response) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        fullResponse += chunk.delta.text;
        
        // Broadcast streaming response
        broadcastToAnalysis(analysisId, {
          type: 'analysis-progress',
          message: fullResponse
        });
      }
    }

    console.log('🔍 DEBUG: Full analysis response:', fullResponse);
    
    // Parse the JSON response
    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        let cleanedJson = jsonMatch[0];
        cleanedJson = cleanedJson.replace(/`/g, '\\`');
        cleanedJson = cleanedJson.replace(/\\`([^`]*)\\\`/g, '`$1`');
        
        const results = JSON.parse(cleanedJson);
        console.log('🔍 DEBUG: Parsed analysis results:', results);
        
        // Update analysis with results
        const analysis = analyses.get(analysisId);
        if (analysis) {
          analysis.status = 'completed';
          analysis.results = results;
          analysis.completedAt = new Date().toISOString();
        }
        
        // Broadcast completion
        broadcastToAnalysis(analysisId, {
          type: 'analysis-completed',
          results: results
        });
        
        return results;
      } catch (parseError) {
        console.error('❌ JSON parsing error:', parseError);
        throw new Error('Failed to parse analysis response');
      }
    } else {
      throw new Error('No valid JSON found in analysis response');
    }
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    const analysis = analyses.get(analysisId);
    if (analysis) {
      analysis.status = 'failed';
      analysis.error = error.message;
    }
    
    broadcastToAnalysis(analysisId, {
      type: 'analysis-error',
      error: error.message
    });
    
    throw error;
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Codebase Analyzer server running on port ${PORT}`);
  console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
});

module.exports = app;


