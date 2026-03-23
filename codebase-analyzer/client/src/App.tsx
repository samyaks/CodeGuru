import React, { useState, useEffect } from 'react';
import './App.css';

interface AnalysisResult {
  executiveSummary: string;
  technologyStack: {
    primary: string[];
    secondary: string[];
    versions: string;
  };
  architecture: {
    pattern: string;
    complexity: string;
    scalability: string;
  };
  codeQuality: {
    overall: string;
    maintainability: string;
    documentation: string;
    testing: string;
  };
  security: {
    level: string;
    concerns: string[];
    recommendations: string[];
  };
  technicalDebt: {
    level: string;
    areas: string[];
    impact: string;
  };
  onboarding: {
    difficulty: string;
    timeEstimate: string;
    recommendations: string[];
  };
  risks: {
    technical: string[];
    business: string[];
    mitigation: string[];
  };
  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
}

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [streamingMessage, setStreamingMessage] = useState('');

  const analyzeRepository = async () => {
    if (!repoUrl.trim()) return;

    setIsAnalyzing(true);
    setAnalysisResult(null);
    setStreamingMessage('');

    try {
      const response = await fetch('http://localhost:3002/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          analysisType: 'comprehensive'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start analysis');
      }

      const { analysisId: id } = await response.json();
      setAnalysisId(id);

      // Set up SSE connection
      const eventSource = new EventSource(`http://localhost:3002/api/analyses/${id}/stream`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'analysis-progress') {
            setStreamingMessage(data.message);
          } else if (data.type === 'analysis-completed') {
            setAnalysisResult(data.results);
            setIsAnalyzing(false);
            eventSource.close();
          } else if (data.type === 'analysis-error') {
            console.error('Analysis error:', data.error);
            setIsAnalyzing(false);
            eventSource.close();
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        setIsAnalyzing(false);
        eventSource.close();
      };

    } catch (error) {
      console.error('Error starting analysis:', error);
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Codebase Analyzer</h1>
              <p className="text-gray-600">AI-powered codebase analysis for CTOs and tech leaders</p>
            </div>
            <div className="text-sm text-gray-500">
              Powered by Claude AI
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Input Section */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Analyze Repository</h2>
          <div className="flex gap-4">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="Enter GitHub repository URL (e.g., https://github.com/facebook/react)"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isAnalyzing}
              onKeyPress={(e) => e.key === 'Enter' && analyzeRepository()}
            />
            <button
              onClick={analyzeRepository}
              disabled={isAnalyzing || !repoUrl.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
        </div>

        {/* Analysis Progress */}
        {isAnalyzing && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <div className="flex items-center justify-center mb-4">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mr-3"></div>
              <h3 className="text-lg font-semibold text-blue-900">Analyzing Repository...</h3>
            </div>
            {streamingMessage && (
              <div className="bg-white border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium text-blue-700">AI Analysis in Progress</span>
                </div>
                <div className="bg-gray-50 rounded p-3 max-h-48 overflow-y-auto">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                    {streamingMessage}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analysis Results */}
        {analysisResult && (
          <div className="space-y-6">
            {/* Executive Summary */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Executive Summary</h3>
              <p className="text-gray-700 leading-relaxed">{analysisResult.executiveSummary}</p>
            </div>

            {/* Technology Stack */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">🛠️ Technology Stack</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Primary Technologies</h4>
                  <div className="flex flex-wrap gap-2">
                    {analysisResult.technologyStack.primary.map((tech, index) => (
                      <span key={index} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Secondary Technologies</h4>
                  <div className="flex flex-wrap gap-2">
                    {analysisResult.technologyStack.secondary.map((tech, index) => (
                      <span key={index} className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Code Quality */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">📈 Code Quality Assessment</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Overall Quality</h4>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    analysisResult.codeQuality.overall === 'excellent' ? 'bg-green-100 text-green-700' :
                    analysisResult.codeQuality.overall === 'good' ? 'bg-blue-100 text-blue-700' :
                    analysisResult.codeQuality.overall === 'fair' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {analysisResult.codeQuality.overall}
                  </span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Maintainability</h4>
                  <p className="text-sm text-gray-600">{analysisResult.codeQuality.maintainability}</p>
                </div>
              </div>
            </div>

            {/* Security Assessment */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">🔒 Security Assessment</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Security Level</h4>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    analysisResult.security.level === 'high' ? 'bg-green-100 text-green-700' :
                    analysisResult.security.level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {analysisResult.security.level}
                  </span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Key Concerns</h4>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {analysisResult.security.concerns.map((concern, index) => (
                      <li key={index}>{concern}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Technical Debt */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">⚠️ Technical Debt</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Debt Level</h4>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    analysisResult.technicalDebt.level === 'low' ? 'bg-green-100 text-green-700' :
                    analysisResult.technicalDebt.level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {analysisResult.technicalDebt.level}
                  </span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Problem Areas</h4>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {analysisResult.technicalDebt.areas.map((area, index) => (
                      <li key={index}>{area}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">💡 Recommendations</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Immediate Actions</h4>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {analysisResult.recommendations.immediate.map((rec, index) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Short-term</h4>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {analysisResult.recommendations.shortTerm.map((rec, index) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Long-term</h4>
                  <ul className="text-sm text-gray-600 list-disc list-inside">
                    {analysisResult.recommendations.longTerm.map((rec, index) => (
                      <li key={index}>{rec}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;