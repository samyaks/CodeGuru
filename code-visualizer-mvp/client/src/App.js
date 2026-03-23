import React, { useState } from 'react';
import { FileText, Folder, Eye, Code, GitBranch, Server, Monitor, Database, Wrench, Cloud, ChevronRight, ChevronDown, Zap, Box, Settings, Layers, Calendar, User, Star, GitFork, ExternalLink } from 'lucide-react';

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [visualization, setVisualization] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showCode, setShowCode] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [fileContent, setFileContent] = useState('');
  const [loadingFileContent, setLoadingFileContent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;

    setLoading(true);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl })
      });

      const data = await response.json();
      setVisualization(data);
      setLoading(false);

    } catch (error) {
      console.error(error);
      setLoading(false);
      alert('Failed to analyze repository');
    }
  };

  const handleFileClick = async (file) => {
    setSelectedFile(file);
    setShowCode(true);
    setLoadingFileContent(true);
    setFileContent('');

    try {
      const response = await fetch('/api/file-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: repoUrl,
          filePath: file.path
        })
      });

      if (response.ok) {
        const data = await response.json();
        setFileContent(data.content);
      } else {
        setFileContent(`// Error loading file content: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error fetching file content:', error);
      setFileContent(`// Error loading file content: ${error.message}`);
    } finally {
      setLoadingFileContent(false);
    }
  };

  const toggleFileExpansion = (filePath) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath);
    } else {
      newExpanded.add(filePath);
    }
    setExpandedFiles(newExpanded);
  };

  const getCategoryIcon = (category) => {
    const iconStyle = { color: getCategoryColor(category) };
    switch(category) {
      case 'Frontend': return <Monitor className="w-5 h-5" style={iconStyle} />;
      case 'Backend': return <Server className="w-5 h-5" style={iconStyle} />;
      case 'Data': return <Database className="w-5 h-5" style={iconStyle} />;
      case 'Tools': return <Wrench className="w-5 h-5" style={iconStyle} />;
      case 'Infra': return <Cloud className="w-5 h-5" style={iconStyle} />;
      default: return <Folder className="w-5 h-5" style={{ color: '#666' }} />;
    }
  };

  const getCategoryColor = (category) => {
    switch(category) {
      case 'Frontend': return '#61dafb';
      case 'Backend': return '#68d391';
      case 'Data': return '#f687b3';
      case 'Tools': return '#fbb034';
      case 'Infra': return '#9f7aea';
      default: return '#666';
    }
  };

  const getComponentIcon = (type) => {
    const iconStyle = { color: '#6b7280' };
    switch(type) {
      case 'component': return <Box className="w-3 h-3" style={{ color: '#3b82f6' }} />;
      case 'function': return <Zap className="w-3 h-3" style={{ color: '#10b981' }} />;
      case 'class': return <Layers className="w-3 h-3" style={{ color: '#f59e0b' }} />;
      case 'hook': return <Settings className="w-3 h-3" style={{ color: '#8b5cf6' }} />;
      case 'method': return <Zap className="w-3 h-3" style={{ color: '#10b981' }} />;
      case 'object': return <Box className="w-3 h-3" style={{ color: '#3b82f6' }} />;
      case 'route': return <GitBranch className="w-3 h-3" style={{ color: '#ef4444' }} />;
      default: return <Code className="w-3 h-3" style={iconStyle} />;
    }
  };

  const getFileIcon = (type) => {
    if (type.includes('Component')) return <Code className="w-4 h-4" style={{ color: '#61dafb' }} />;
    if (type.includes('Stylesheet')) return <FileText className="w-4 h-4" style={{ color: '#1572b6' }} />;
    if (type.includes('Configuration')) return <FileText className="w-4 h-4" style={{ color: '#f39c12' }} />;
    return <FileText className="w-4 h-4" style={{ color: '#666' }} />;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        borderBottom: '1px solid #e2e8f0',
        padding: '20px 0'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 20px' }}>
          <h1 style={{
            fontSize: '2.5rem',
            fontWeight: 'bold',
            color: '#1a202c',
            margin: '0 0 8px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <Folder style={{ color: '#4299e1' }} />
            Code Visualizer
          </h1>
          <p style={{ color: '#718096', fontSize: '1.1rem', margin: 0 }}>
            Analyze and visualize your GitHub repository structure with dependency mapping
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px' }}>

        {/* Input Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="Enter GitHub repository URL (e.g., https://github.com/facebook/react)"
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  border: '2px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '16px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  ':focus': { borderColor: '#4299e1' }
                }}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !repoUrl.trim()}
                style={{
                  padding: '12px 24px',
                  backgroundColor: loading ? '#a0aec0' : '#4299e1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background-color 0.2s'
                }}
              >
                {loading ? (
                  <>
                    <div style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid #ffffff40',
                      borderTop: '2px solid #ffffff',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Analyze Repository
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Repository Metadata */}
        {visualization && !loading && visualization.metadata && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            padding: '20px',
            marginBottom: '24px',
            border: '2px solid #e2e8f0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
              {/* Repository Info */}
              <div style={{ flex: 1, minWidth: '300px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '12px'
                }}>
                  <GitBranch className="w-6 h-6" style={{ color: '#4299e1' }} />
                  <h2 style={{
                    margin: 0,
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: '#1a202c'
                  }}>
                    {visualization.metadata.fullName}
                  </h2>
                  <span style={{
                    backgroundColor: visualization.metadata.visibility === 'private' ? '#fed7d7' : '#c6f6d5',
                    color: visualization.metadata.visibility === 'private' ? '#c53030' : '#2d7d32',
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    textTransform: 'uppercase'
                  }}>
                    {visualization.metadata.visibility}
                  </span>
                </div>

                {/* Repository Stats */}
                <div style={{
                  display: 'flex',
                  gap: '20px',
                  alignItems: 'center',
                  marginBottom: '16px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <GitBranch className="w-4 h-4" style={{ color: '#6b7280' }} />
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                      {visualization.metadata.defaultBranch}
                    </span>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                      ({visualization.metadata.totalBranches} branches)
                    </span>
                  </div>

                  {visualization.summary.stars > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Star className="w-4 h-4" style={{ color: '#fbbf24' }} />
                      <span style={{ fontSize: '14px', color: '#374151' }}>
                        {visualization.summary.stars.toLocaleString()}
                      </span>
                    </div>
                  )}

                  {visualization.summary.forks > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <GitFork className="w-4 h-4" style={{ color: '#6b7280' }} />
                      <span style={{ fontSize: '14px', color: '#374151' }}>
                        {visualization.summary.forks.toLocaleString()}
                      </span>
                    </div>
                  )}

                  {visualization.metadata.language && (
                    <div style={{
                      backgroundColor: '#f3f4f6',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '500',
                      color: '#374151'
                    }}>
                      {visualization.metadata.language}
                    </div>
                  )}
                </div>

                {/* Description */}
                {visualization.summary.description && visualization.summary.description !== 'No description available' && (
                  <p style={{
                    fontSize: '14px',
                    color: '#6b7280',
                    margin: '0 0 16px 0',
                    lineHeight: '1.5'
                  }}>
                    {visualization.summary.description}
                  </p>
                )}
              </div>

              {/* Last Commit Info */}
              {visualization.metadata.lastCommit && (
                <div style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '8px',
                  padding: '16px',
                  minWidth: '280px',
                  border: '1px solid #e2e8f0'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px'
                  }}>
                    <Calendar className="w-4 h-4" style={{ color: '#6b7280' }} />
                    <span style={{
                      fontSize: '12px',
                      fontWeight: '600',
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      Latest Commit
                    </span>
                  </div>

                  <div style={{ marginBottom: '8px' }}>
                    <code style={{
                      backgroundColor: '#e5e7eb',
                      color: '#1f2937',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600'
                    }}>
                      {visualization.metadata.lastCommit.sha}
                    </code>
                  </div>

                  <div style={{
                    fontSize: '13px',
                    color: '#374151',
                    marginBottom: '8px',
                    lineHeight: '1.4',
                    fontWeight: '500'
                  }}>
                    {visualization.metadata.lastCommit.message?.split('\n')[0] || 'No commit message'}
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '6px'
                  }}>
                    <User className="w-3 h-3" style={{ color: '#6b7280' }} />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      {visualization.metadata.lastCommit.author || 'Unknown'}
                      {visualization.metadata.lastCommit.authorLogin && (
                        <span style={{ fontWeight: '600', color: '#4299e1' }}>
                          {' '}(@{visualization.metadata.lastCommit.authorLogin})
                        </span>
                      )}
                    </span>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {formatDate(visualization.metadata.lastCommit.date)}
                    </span>
                    {visualization.metadata.lastCommit.url && (
                      <a
                        href={visualization.metadata.lastCommit.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: '#4299e1',
                          textDecoration: 'none',
                          fontSize: '12px'
                        }}
                      >
                        <ExternalLink className="w-3 h-3" />
                        View
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {visualization && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: showCode ? '1fr 1fr' : '1fr 1fr', gap: '24px' }}>

            {/* Files Panel */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '20px',
                borderBottom: '1px solid #e2e8f0',
                backgroundColor: '#f7fafc'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '1.25rem',
                  fontWeight: '600',
                  color: '#2d3748',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <FileText className="w-5 h-5" style={{ color: '#4299e1' }} />
                  Repository Files ({visualization.files?.length || 0})
                </h2>
              </div>
              <div style={{ padding: '16px', maxHeight: '500px', overflowY: 'auto' }}>
                {visualization.filesByCategory ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {Object.entries(visualization.filesByCategory).map(([category, files]) => (
                      <div key={category}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '12px',
                          paddingBottom: '8px',
                          borderBottom: `2px solid ${getCategoryColor(category)}20`
                        }}>
                          {getCategoryIcon(category)}
                          <h3 style={{
                            margin: 0,
                            fontSize: '16px',
                            fontWeight: '600',
                            color: '#2d3748'
                          }}>
                            {category}
                          </h3>
                          <span style={{
                            backgroundColor: getCategoryColor(category),
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: '500',
                            padding: '2px 8px',
                            borderRadius: '12px'
                          }}>
                            {files.length}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {files.map((file, index) => (
                            <div key={`${category}-${index}`}>
                              {/* File Header */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '10px',
                                  marginLeft: '16px',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  backgroundColor: selectedFile?.path === file.path ? '#ebf8ff' : 'transparent',
                                  borderLeft: `3px solid ${getCategoryColor(category)}`
                                }}
                                onMouseEnter={(e) => {
                                  if (selectedFile?.path !== file.path) {
                                    e.currentTarget.style.backgroundColor = '#f7fafc';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (selectedFile?.path !== file.path) {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }
                                }}
                              >
                                {/* Expand/Collapse Button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFileExpansion(file.path);
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '2px',
                                    marginRight: '6px'
                                  }}
                                >
                                  {expandedFiles.has(file.path) ? (
                                    <ChevronDown className="w-4 h-4" style={{ color: '#9ca3af' }} />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" style={{ color: '#9ca3af' }} />
                                  )}
                                </button>

                                {getFileIcon(file.type)}
                                <div
                                  style={{ marginLeft: '10px', flex: 1 }}
                                  onClick={() => handleFileClick(file)}
                                >
                                  <div style={{
                                    fontFamily: 'Monaco, "Cascadia Code", Consolas, monospace',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    color: '#2d3748'
                                  }}>
                                    {file.path}
                                  </div>
                                  <div style={{
                                    fontSize: '11px',
                                    color: '#718096',
                                    marginTop: '2px'
                                  }}>
                                    {file.type} • {file.size} lines • {file.components?.length || 0} components
                                  </div>
                                </div>
                                <Eye
                                  className="w-4 h-4"
                                  style={{ color: '#a0aec0' }}
                                  onClick={() => handleFileClick(file)}
                                />
                              </div>

                              {/* Components List */}
                              {expandedFiles.has(file.path) && file.components && (
                                <div style={{
                                  marginLeft: '40px',
                                  marginTop: '6px',
                                  marginBottom: '6px'
                                }}>
                                  {file.components.map((component, compIndex) => (
                                    <div
                                      key={compIndex}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '6px 8px',
                                        margin: '2px 0',
                                        backgroundColor: '#f8fafc',
                                        borderRadius: '4px',
                                        borderLeft: '2px solid #e5e7eb'
                                      }}
                                    >
                                      {getComponentIcon(component.type)}
                                      <div style={{ marginLeft: '8px', flex: 1 }}>
                                        <div style={{
                                          fontFamily: 'Monaco, "Cascadia Code", Consolas, monospace',
                                          fontSize: '12px',
                                          fontWeight: '500',
                                          color: '#374151'
                                        }}>
                                          {component.name}
                                          {component.params && component.params.length > 0 && (
                                            <span style={{ color: '#6b7280', fontWeight: 'normal' }}>
                                              ({component.params.join(', ')})
                                            </span>
                                          )}
                                        </div>
                                        <div style={{
                                          fontSize: '10px',
                                          color: '#9ca3af',
                                          marginTop: '2px'
                                        }}>
                                          {component.description}
                                        </div>
                                      </div>
                                      <span style={{
                                        fontSize: '10px',
                                        color: '#6b7280',
                                        backgroundColor: '#e5e7eb',
                                        padding: '1px 4px',
                                        borderRadius: '2px'
                                      }}>
                                        {component.type}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#a0aec0', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                    No files found...
                  </p>
                )}
              </div>
            </div>

            {/* Architecture/Code Panel */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '20px',
                borderBottom: '1px solid #e2e8f0',
                backgroundColor: '#f7fafc',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '1.25rem',
                  fontWeight: '600',
                  color: '#2d3748',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {showCode ? (
                    <>
                      <Code className="w-5 h-5" style={{ color: '#38a169' }} />
                      File Content
                    </>
                  ) : (
                    <>
                      <GitBranch className="w-5 h-5" style={{ color: '#9f7aea' }} />
                      Architecture Overview
                    </>
                  )}
                </h2>
                {selectedFile && (
                  <button
                    onClick={() => setShowCode(!showCode)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#4299e1',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {showCode ? 'View Architecture' : 'View Code'}
                  </button>
                )}
              </div>

              <div style={{ padding: '16px', maxHeight: '500px', overflowY: 'auto' }}>
                {showCode && selectedFile ? (
                  <div>
                    <div style={{
                      backgroundColor: '#f7fafc',
                      padding: '12px',
                      borderRadius: '6px',
                      marginBottom: '16px',
                      fontSize: '14px',
                      color: '#4a5568'
                    }}>
                      <strong>{selectedFile.path}</strong> - {selectedFile.type}
                    </div>
                    <pre style={{
                      backgroundColor: '#1a202c',
                      color: '#e2e8f0',
                      padding: '16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      overflow: 'auto',
                      fontFamily: 'Monaco, "Cascadia Code", Consolas, monospace',
                      minHeight: '200px'
                    }}>
                      {loadingFileContent ? (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '200px',
                          color: '#a0aec0'
                        }}>
                          <div style={{
                            width: '20px',
                            height: '20px',
                            border: '2px solid #4a5568',
                            borderTop: '2px solid #e2e8f0',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                            marginRight: '12px'
                          }} />
                          Loading file content...
                        </div>
                      ) : (
                        fileContent || '// Click on a file to view its content'
                      )}
                    </pre>
                  </div>
                ) : (
                  visualization.connections && visualization.connections.length > 0 ? (
                    <div>
                      <p style={{
                        fontSize: '14px',
                        color: '#718096',
                        marginBottom: '16px',
                        lineHeight: '1.5'
                      }}>
                        Dependency relationships and file connections:
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {visualization.connections.map((conn, i) => (
                          <div key={i} style={{
                            padding: '16px',
                            backgroundColor: '#f7fafc',
                            borderRadius: '8px',
                            borderLeft: '4px solid #4299e1'
                          }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              marginBottom: '8px'
                            }}>
                              <code style={{
                                backgroundColor: '#e2e8f0',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}>
                                {conn.from}
                              </code>
                              <span style={{ color: '#a0aec0', fontSize: '18px' }}>→</span>
                              <code style={{
                                backgroundColor: '#e2e8f0',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}>
                                {conn.to}
                              </code>
                            </div>
                            <div style={{
                              fontSize: '13px',
                              color: '#4a5568',
                              fontStyle: 'italic'
                            }}>
                              {conn.reason}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: '#a0aec0', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                      No connections found. Click "Analyze Repository" to see file dependencies.
                    </p>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            padding: '60px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid #e2e8f0',
              borderTop: '4px solid #4299e1',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px'
            }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#2d3748', margin: '0 0 8px 0' }}>
              Analyzing Repository
            </h3>
            <p style={{ color: '#718096', margin: 0 }}>
              Scanning files and mapping dependencies...
            </p>
          </div>
        )}

        {/* Empty State */}
        {!visualization && !loading && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            padding: '60px',
            textAlign: 'center'
          }}>
            <Folder style={{
              width: '64px',
              height: '64px',
              color: '#cbd5e0',
              margin: '0 auto 20px'
            }} />
            <h3 style={{ fontSize: '1.5rem', fontWeight: '600', color: '#2d3748', margin: '0 0 8px 0' }}>
              Ready to analyze your code?
            </h3>
            <p style={{ color: '#718096', fontSize: '1.1rem', margin: 0 }}>
              Enter a GitHub repository URL above to visualize its structure and dependencies
            </p>
          </div>
        )}
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default App;