// Code Visualizer Backend Server
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Storage
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Ensure projects directory exists
async function initializeStorage() {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    console.log('📁 Projects directory ready');
  } catch (error) {
    console.error('❌ Failed to create projects directory:', error);
  }
}

// Storage for SSE connections
const projectConnections = {};

// API Routes

// Analyze repository
app.post('/api/analyze', async (req, res) => {
  try {
    const { repoUrl } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'Repository URL is required' });
    }

    console.log(`🔍 Analyzing repository: ${repoUrl}`);

    // Mock repository analysis (in real version would clone/fetch repo)
    const analysis = await analyzeRepository(repoUrl);

    res.json(analysis);

  } catch (error) {
    console.error('❌ Error analyzing repository:', error);
    res.status(500).json({ error: 'Failed to analyze repository' });
  }
});

// Fetch file content
app.post('/api/file-content', async (req, res) => {
  try {
    const { repoUrl, filePath } = req.body;

    if (!repoUrl || !filePath) {
      return res.status(400).json({ error: 'Repository URL and file path are required' });
    }

    console.log(`📄 Fetching file content: ${filePath} from ${repoUrl}`);

    // Extract owner and repo from GitHub URL
    const urlParts = repoUrl.replace('.git', '').split('/');
    const owner = urlParts[urlParts.length - 2];
    const repoName = urlParts[urlParts.length - 1];

    if (!owner || !repoName || !repoUrl.includes('github.com')) {
      return res.status(400).json({ error: 'Please provide a valid GitHub repository URL' });
    }

    try {
      // Fetch file content from GitHub API
      const fileResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`);

      if (!fileResponse.ok) {
        throw new Error(`File not found: ${filePath}`);
      }

      const fileData = await fileResponse.json();

      // Decode base64 content
      const content = Buffer.from(fileData.content, 'base64').toString('utf-8');

      res.json({
        path: filePath,
        content: content,
        size: fileData.size,
        encoding: fileData.encoding,
        sha: fileData.sha
      });

    } catch (error) {
      console.error('Error fetching file from GitHub API:', error);
      res.status(404).json({ error: `Failed to fetch file content: ${error.message}` });
    }

  } catch (error) {
    console.error('❌ Error fetching file content:', error);
    res.status(500).json({ error: 'Failed to fetch file content' });
  }
});

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { userPrompt } = req.body;

    if (!userPrompt) {
      return res.status(400).json({ error: 'User prompt is required' });
    }

    const projectId = uuidv4();
    const project = {
      id: projectId,
      userPrompt,
      createdAt: new Date().toISOString(),
      files: {},
      commits: [],
      userFeedback: {},
      visualization: {
        fileTree: [],
        connections: [],
        highlights: []
      }
    };

    await saveProject(projectId, project);

    console.log(`🚀 Created project ${projectId}: "${userPrompt}"`);

    res.json({
      projectId,
      message: 'Project created successfully',
      project: project
    });

  } catch (error) {
    console.error('❌ Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get project details
app.get('/api/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await loadProject(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    console.error('❌ Error loading project:', error);
    res.status(500).json({ error: 'Failed to load project' });
  }
});

// Start AI building process
app.post('/api/projects/:projectId/build', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { request } = req.body;

    const project = await loadProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log(`🤖 Starting AI build for project ${projectId}: "${request}"`);

    // Start the AI building process (async)
    processAIBuildRequest(projectId, request, project);

    res.json({
      message: 'AI building process started',
      status: 'building'
    });

  } catch (error) {
    console.error('❌ Error starting AI build:', error);
    res.status(500).json({ error: 'Failed to start AI build' });
  }
});

// Record user feedback
app.post('/api/projects/:projectId/commits/:commitId/feedback', async (req, res) => {
  try {
    const { projectId, commitId } = req.params;
    const { feedback } = req.body;

    const project = await loadProject(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    project.userFeedback[commitId] = {
      ...feedback,
      timestamp: new Date().toISOString()
    };

    await saveProject(projectId, project);

    console.log(`👤 Feedback recorded for commit ${commitId}: ${feedback.type}`);

    res.json({ message: 'Feedback recorded successfully' });

  } catch (error) {
    console.error('❌ Error recording feedback:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

// Get real-time updates (SSE)
app.get('/api/projects/:projectId/stream', (req, res) => {
  const { projectId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  res.write(`data: ${JSON.stringify({ type: 'connected', projectId })}\n\n`);

  if (!projectConnections[projectId]) {
    projectConnections[projectId] = [];
  }
  projectConnections[projectId].push(res);

  req.on('close', () => {
    const connections = projectConnections[projectId] || [];
    const index = connections.indexOf(res);
    if (index !== -1) {
      connections.splice(index, 1);
    }
  });
});

// Helper Functions
async function saveProject(projectId, project) {
  const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
  await fs.writeFile(filePath, JSON.stringify(project, null, 2));
}

async function loadProject(projectId) {
  try {
    const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function broadcastToProject(projectId, data) {
  const connections = projectConnections[projectId] || [];
  const message = `data: ${JSON.stringify(data)}\n\n`;

  connections.forEach((res, index) => {
    try {
      res.write(message);
    } catch (error) {
      connections.splice(index, 1);
    }
  });
}

// AI Building Process
async function processAIBuildRequest(projectId, request, project) {
  try {
    console.log(`🤖 Processing: "${request}" for project ${projectId}`);

    const plan = await planImplementation(request, project);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      console.log(`📝 Executing step ${i + 1}/${plan.steps.length}: ${step.description}`);

      const result = await executeStep(step, project);

      const commit = {
        id: uuidv4(),
        message: step.description,
        explanation: result.explanation,
        files: result.files.map(f => f.path),
        timestamp: new Date().toISOString(),
        stepIndex: i + 1,
        totalSteps: plan.steps.length
      };

      result.files.forEach(file => {
        project.files[file.path] = {
          content: file.content,
          explanation: file.explanation,
          addedInCommit: commit.id,
          lastModified: commit.timestamp
        };
      });

      project.commits.push(commit);
      project.visualization = generateVisualization(project);

      await saveProject(projectId, project);

      broadcastToProject(projectId, {
        type: 'commit',
        commit: commit,
        project: project
      });

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    broadcastToProject(projectId, {
      type: 'completed',
      message: 'AI building process completed!',
      project: project
    });

    console.log(`✅ Completed AI build for project ${projectId}`);

  } catch (error) {
    console.error(`❌ Error in AI build process for project ${projectId}:`, error);
    broadcastToProject(projectId, {
      type: 'error',
      error: 'Failed to complete AI build process'
    });
  }
}

async function planImplementation(request, project) {
  console.log(`🧠 Planning implementation for: "${request}"`);

  const requestLower = request.toLowerCase();
  let steps = [];

  if (requestLower.includes('todo') || requestLower.includes('task')) {
    steps = [
      {
        description: 'Create HTML structure for todo app',
        goal: 'Set up the basic webpage layout',
        concepts: ['HTML', 'DOM structure', 'semantic markup']
      },
      {
        description: 'Add CSS styling for todo interface',
        goal: 'Make the app look clean and user-friendly',
        concepts: ['CSS', 'styling', 'responsive design']
      },
      {
        description: 'Implement JavaScript functionality',
        goal: 'Add interactive features for managing todos',
        concepts: ['JavaScript', 'event handling', 'DOM manipulation']
      }
    ];
  } else {
    steps = [
      {
        description: 'Initialize project structure',
        goal: 'Create the foundation files for the web application',
        concepts: ['project structure', 'HTML', 'CSS', 'JavaScript']
      },
      {
        description: 'Build main application interface',
        goal: 'Create the primary user interface',
        concepts: ['UI design', 'user experience', 'responsive layout']
      },
      {
        description: 'Add core functionality',
        goal: 'Implement the main features requested',
        concepts: ['interactive features', 'user interaction', 'application logic']
      }
    ];
  }

  return { steps, reasoning: 'Breaking into teachable steps', estimatedCommits: steps.length };
}

async function executeStep(step, project) {
  const files = [];
  const explanation = {
    simple: step.description,
    expandable: {
      'Why this approach?': step.goal,
      'What other ways could work?': 'There are other approaches, but this one is beginner-friendly',
      'How does this work technically?': `This introduces: ${step.concepts.join(', ')}`,
      'What happens next?': 'This sets up the foundation for the next features'
    }
  };

  if (step.description.includes('HTML') || step.description.includes('structure')) {
    files.push(generateHTMLFile(step, project));
  }
  if (step.description.includes('CSS') || step.description.includes('styling')) {
    files.push(generateCSSFile(step, project));
  }
  if (step.description.includes('JavaScript') || step.description.includes('functionality')) {
    files.push(generateJSFile(step, project));
  }

  if (files.length === 0) {
    files.push(generateHTMLFile(step, project));
    files.push(generateCSSFile(step, project));
    files.push(generateJSFile(step, project));
  }

  return { files, explanation };
}

function generateHTMLFile(step, project) {
  let content = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My App</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>Welcome to My App</h1>
        <p>This is your new web application!</p>
    </div>
    <script src="script.js"></script>
</body>
</html>`;

  if (step.description.includes('todo')) {
    content = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Todo App</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h1>My Todo App</h1>
        <div class="todo-input">
            <input type="text" id="todoInput" placeholder="Add a new task...">
            <button id="addBtn">Add Task</button>
        </div>
        <ul id="todoList"></ul>
    </div>
    <script src="script.js"></script>
</body>
</html>`;
  }

  return {
    path: 'index.html',
    content,
    explanation: 'Main webpage that users will see and interact with',
    isNew: !project.files['index.html']
  };
}

function generateCSSFile(step, project) {
  const content = `/* App Styles */
body {
    font-family: Arial, sans-serif;
    line-height: 1.6;
    margin: 0;
    padding: 20px;
    background-color: #f4f4f4;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    background: white;
    padding: 30px;
    border-radius: 10px;
    box-shadow: 0 0 10px rgba(0,0,0,0.1);
}

h1 {
    color: #333;
    text-align: center;
}

.todo-input {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
}

#todoInput {
    flex: 1;
    padding: 10px;
    border: 2px solid #ddd;
    border-radius: 5px;
    font-size: 16px;
}

#addBtn {
    padding: 10px 20px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
}

#todoList {
    list-style: none;
    padding: 0;
}

.todo-item {
    background: #f8f9fa;
    padding: 15px;
    margin: 10px 0;
    border-radius: 5px;
}`;

  return {
    path: 'style.css',
    content,
    explanation: 'Styles that make the webpage look good and user-friendly',
    isNew: !project.files['style.css']
  };
}

function generateJSFile(step, project) {
  const content = `// App JavaScript
document.addEventListener('DOMContentLoaded', function() {
    console.log('App loaded successfully!');

    const todoInput = document.getElementById('todoInput');
    const addBtn = document.getElementById('addBtn');
    const todoList = document.getElementById('todoList');

    let todos = [];

    function addTodo() {
        const text = todoInput.value.trim();
        if (text === '') return;

        const todo = {
            id: Date.now(),
            text: text,
            completed: false
        };

        todos.push(todo);
        todoInput.value = '';
        renderTodos();
    }

    function renderTodos() {
        todoList.innerHTML = '';
        todos.forEach(todo => {
            const li = document.createElement('li');
            li.className = 'todo-item';
            li.textContent = todo.text;
            todoList.appendChild(li);
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', addTodo);
    }

    if (todoInput) {
        todoInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') addTodo();
        });
    }
});`;

  return {
    path: 'script.js',
    content,
    explanation: 'JavaScript code that makes the webpage interactive',
    isNew: !project.files['script.js']
  };
}

function generateVisualization(project) {
  const files = Object.keys(project.files);

  return {
    fileTree: files.map(path => ({
      path,
      type: path.endsWith('.html') ? 'html' :
            path.endsWith('.css') ? 'css' :
            path.endsWith('.js') ? 'javascript' : 'other'
    })),
    connections: [
      { from: 'index.html', to: 'style.css', reason: 'styling' },
      { from: 'index.html', to: 'script.js', reason: 'functionality' }
    ].filter(conn => files.includes(conn.from) && files.includes(conn.to)),
    highlights: files.slice(-2)
  };
}

// Repository Analysis Function
async function analyzeRepository(repoUrl) {
  console.log(`📊 Analyzing repository structure for: ${repoUrl}`);

  // Extract owner and repo from GitHub URL
  const urlParts = repoUrl.replace('.git', '').split('/');
  const owner = urlParts[urlParts.length - 2];
  const repoName = urlParts[urlParts.length - 1];

  if (!owner || !repoName || !repoUrl.includes('github.com')) {
    throw new Error('Please provide a valid GitHub repository URL');
  }

  try {
    // Fetch repository data from GitHub API
    const repoData = await fetchGitHubRepository(owner, repoName);
    return repoData;
  } catch (error) {
    console.error('Error fetching from GitHub API:', error);
    // Fall back to enhanced mock data based on repo name
    return generateEnhancedMockData(repoName, repoUrl);
  }
}

// Fetch real repository data from GitHub API
async function fetchGitHubRepository(owner, repoName) {
  const baseUrl = 'https://api.github.com';

  // Fetch repository info
  const repoResponse = await fetch(`${baseUrl}/repos/${owner}/${repoName}`);
  if (!repoResponse.ok) {
    throw new Error(`Repository not found: ${owner}/${repoName}`);
  }

  const repoInfo = await repoResponse.json();

  // Fetch repository contents
  const contentsResponse = await fetch(`${baseUrl}/repos/${owner}/${repoName}/contents`);
  const contents = contentsResponse.ok ? await contentsResponse.json() : [];

  // Fetch latest commit info
  const commitsResponse = await fetch(`${baseUrl}/repos/${owner}/${repoName}/commits?per_page=1`);
  const commits = commitsResponse.ok ? await commitsResponse.json() : [];
  const latestCommit = commits.length > 0 ? commits[0] : null;

  // Fetch branches info
  const branchesResponse = await fetch(`${baseUrl}/repos/${owner}/${repoName}/branches`);
  const branches = branchesResponse.ok ? await branchesResponse.json() : [];
  const defaultBranch = repoInfo.default_branch;

  // Analyze the fetched data
  const files = await analyzeRepositoryContents(owner, repoName, contents);
  const connections = generateConnectionsFromFiles(files);

  return formatRepositoryAnalysis(repoName, repoInfo, files, connections, latestCommit, defaultBranch, branches);
}

// Analyze repository contents recursively
async function analyzeRepositoryContents(owner, repoName, contents, basePath = '', depth = 0) {
  const files = [];
  const maxDepth = 3; // Limit recursion depth to avoid too many API calls

  for (const item of contents) {
    if (item.type === 'file') {
      const file = await analyzeFile(owner, repoName, item, basePath);
      if (file) files.push(file);
    } else if (item.type === 'dir' && depth < maxDepth) {
      // Recursively fetch directory contents
      try {
        const dirResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${item.path}`);
        if (dirResponse.ok) {
          const dirContents = await dirResponse.json();
          const subFiles = await analyzeRepositoryContents(owner, repoName, dirContents, item.path, depth + 1);
          files.push(...subFiles);
        }
      } catch (error) {
        console.log(`Warning: Could not fetch directory ${item.path}:`, error.message);
      }
    }
  }

  return files;
}

// Analyze individual file
async function analyzeFile(owner, repoName, fileItem, basePath) {
  const filePath = basePath ? `${basePath}/${fileItem.name}` : fileItem.name;
  const fileExtension = fileItem.name.split('.').pop().toLowerCase();

  // Categorize file
  const category = categorizeFile(filePath, fileExtension);

  // For code files, fetch content and analyze it
  let components = [];
  if (shouldAnalyzeFileContent(fileExtension)) {
    try {
      components = await analyzeFileContent(owner, repoName, filePath, fileExtension);
    } catch (error) {
      console.log(`Warning: Could not analyze content for ${filePath}:`, error.message);
      // Fall back to mock components
      components = generateComponentsForFile(filePath, fileExtension);
    }
  } else {
    // For non-code files, use simple mock components
    components = generateComponentsForFile(filePath, fileExtension);
  }

  return {
    path: filePath,
    type: getFileType(fileExtension),
    size: Math.floor(fileItem.size / 20) || 25, // Estimate lines from bytes
    category,
    components
  };
}

// Categorize files into our 5 categories
function categorizeFile(filePath, extension) {
  const path = filePath.toLowerCase();

  // Frontend files
  if (extension.match(/^(js|jsx|ts|tsx|vue|html|css|scss|sass|less)$/)) {
    if (path.includes('component') || path.includes('src/') || path.includes('public/')) {
      return 'Frontend';
    }
  }

  // Backend files
  if (extension.match(/^(js|ts|py|java|go|rs|php|rb|c|cpp|h|hpp)$/)) {
    if (path.includes('server') || path.includes('api') || path.includes('backend') ||
        path.includes('controller') || path.includes('model') || path.includes('route') ||
        extension === 'php' || extension === 'py' || extension === 'java' ||
        extension === 'go' || extension === 'rs' || extension === 'rb') {
      return 'Backend';
    }
  }

  // Data files
  if (extension.match(/^(sql|json|xml|csv|yaml|yml)$/)) {
    return 'Data';
  }

  // Infrastructure files
  if (filePath.includes('Dockerfile') || filePath.includes('docker-compose') ||
      extension.match(/^(tf|yml|yaml)$/) || filePath.includes('.github/') ||
      filePath.includes('nginx') || filePath.includes('README') ||
      extension.match(/^(md|txt|rst)$/) || filePath.includes('LICENSE') ||
      filePath.includes('.gitignore')) {
    return 'Infra';
  }

  // Tools/Config files
  if (filePath.includes('package.json') || filePath.includes('webpack') ||
      filePath.includes('babel') || filePath.includes('eslint') ||
      extension.match(/^(conf|config|lock)$/) || filePath.includes('composer')) {
    return 'Tools';
  }

  // Default fallback - categorize remaining code files
  if (extension.match(/^(js|ts|jsx|tsx|py|php|java|go|rs|rb|c|cpp|h|hpp|cs|swift|kt)$/)) {
    return 'Backend'; // Default code files to Backend
  }

  // Other files go to Tools category
  return 'Tools';
}

// Check if we should analyze file content for real functions/objects
function shouldAnalyzeFileContent(extension) {
  return extension.match(/^(js|jsx|ts|tsx|py|php|java|go|rs|rb|c|cpp|cs|swift|kt)$/);
}

// Analyze file content to extract real functions, classes, objects
async function analyzeFileContent(owner, repoName, filePath, fileExtension) {
  // Fetch file content from GitHub API
  const fileResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`);

  if (!fileResponse.ok) {
    throw new Error(`Could not fetch file: ${filePath}`);
  }

  const fileData = await fileResponse.json();
  const content = Buffer.from(fileData.content, 'base64').toString('utf-8');

  // Parse content based on file type
  return parseCodeContent(content, fileExtension, filePath);
}

// Parse code content to extract functions, classes, objects
function parseCodeContent(content, extension, filePath) {
  const components = [];
  const lines = content.split('\n');

  switch (extension) {
    case 'php':
      return parsePHPContent(content, lines);
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return parseJavaScriptContent(content, lines);
    case 'py':
      return parsePythonContent(content, lines);
    case 'java':
      return parseJavaContent(content, lines);
    case 'json':
      return parseJSONContent(content);
    default:
      return parseGenericContent(content, lines, extension);
  }
}

// Parse PHP content
function parsePHPContent(content, lines) {
  const components = [];

  // Find classes
  const classMatches = content.match(/class\s+(\w+)[\s\S]*?\{/gi) || [];
  classMatches.forEach(match => {
    const className = match.match(/class\s+(\w+)/i)?.[1];
    if (className) {
      components.push({
        name: className,
        type: 'class',
        params: [],
        description: `PHP class ${className}`
      });
    }
  });

  // Find functions
  const functionMatches = content.match(/function\s+(\w+)\s*\([^)]*\)/gi) || [];
  functionMatches.forEach(match => {
    const funcName = match.match(/function\s+(\w+)/i)?.[1];
    const params = extractParameters(match);
    if (funcName) {
      components.push({
        name: funcName,
        type: 'function',
        params: params,
        description: `PHP function ${funcName}`
      });
    }
  });

  // Find WordPress hooks
  const hookMatches = content.match(/(add_action|add_filter)\s*\(\s*['"]([^'"]+)['"]/gi) || [];
  hookMatches.forEach(match => {
    const hookName = match.match(/['"]([^'"]+)['"]/)?.[1];
    if (hookName) {
      components.push({
        name: hookName,
        type: 'hook',
        params: [],
        description: `WordPress hook ${hookName}`
      });
    }
  });

  return components;
}

// Parse JavaScript/TypeScript content
function parseJavaScriptContent(content, lines) {
  const components = [];

  // Find function declarations
  const functionMatches = content.match(/function\s+(\w+)\s*\([^)]*\)/gi) || [];
  functionMatches.forEach(match => {
    const funcName = match.match(/function\s+(\w+)/i)?.[1];
    const params = extractParameters(match);
    if (funcName) {
      components.push({
        name: funcName,
        type: 'function',
        params: params,
        description: `Function ${funcName}`
      });
    }
  });

  // Find arrow functions
  const arrowMatches = content.match(/const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/gi) || [];
  arrowMatches.forEach(match => {
    const funcName = match.match(/const\s+(\w+)/i)?.[1];
    const params = extractParameters(match);
    if (funcName) {
      components.push({
        name: funcName,
        type: 'function',
        params: params,
        description: `Arrow function ${funcName}`
      });
    }
  });

  // Find React components
  const componentMatches = content.match(/(?:function|const)\s+(\w+)\s*(?:\([^)]*\))?\s*(?:=>)?\s*{[\s\S]*?return\s*\(/gi) || [];
  componentMatches.forEach(match => {
    const compName = match.match(/(?:function|const)\s+(\w+)/i)?.[1];
    if (compName && compName[0] === compName[0].toUpperCase()) {
      components.push({
        name: compName,
        type: 'component',
        params: ['props'],
        description: `React component ${compName}`
      });
    }
  });

  // Find classes
  const classMatches = content.match(/class\s+(\w+)[\s\S]*?\{/gi) || [];
  classMatches.forEach(match => {
    const className = match.match(/class\s+(\w+)/i)?.[1];
    if (className) {
      components.push({
        name: className,
        type: 'class',
        params: [],
        description: `Class ${className}`
      });
    }
  });

  return components;
}

// Parse Python content
function parsePythonContent(content, lines) {
  const components = [];

  // Find classes
  const classMatches = content.match(/class\s+(\w+)[\s\S]*?:/gi) || [];
  classMatches.forEach(match => {
    const className = match.match(/class\s+(\w+)/i)?.[1];
    if (className) {
      components.push({
        name: className,
        type: 'class',
        params: [],
        description: `Python class ${className}`
      });
    }
  });

  // Find functions
  const functionMatches = content.match(/def\s+(\w+)\s*\([^)]*\)/gi) || [];
  functionMatches.forEach(match => {
    const funcName = match.match(/def\s+(\w+)/i)?.[1];
    const params = extractParameters(match);
    if (funcName) {
      components.push({
        name: funcName,
        type: 'function',
        params: params,
        description: `Python function ${funcName}`
      });
    }
  });

  return components;
}

// Parse Java content
function parseJavaContent(content, lines) {
  const components = [];

  // Find classes
  const classMatches = content.match(/(?:public\s+|private\s+|protected\s+)?class\s+(\w+)/gi) || [];
  classMatches.forEach(match => {
    const className = match.match(/class\s+(\w+)/i)?.[1];
    if (className) {
      components.push({
        name: className,
        type: 'class',
        params: [],
        description: `Java class ${className}`
      });
    }
  });

  // Find methods
  const methodMatches = content.match(/(?:public\s+|private\s+|protected\s+)?\w+\s+(\w+)\s*\([^)]*\)/gi) || [];
  methodMatches.forEach(match => {
    const methodName = match.match(/\s+(\w+)\s*\(/)?.[1];
    const params = extractParameters(match);
    if (methodName && !['class', 'interface', 'enum'].includes(methodName.toLowerCase())) {
      components.push({
        name: methodName,
        type: 'method',
        params: params,
        description: `Java method ${methodName}`
      });
    }
  });

  return components;
}

// Parse JSON content
function parseJSONContent(content) {
  const components = [];

  try {
    const jsonData = JSON.parse(content);
    const keys = Object.keys(jsonData);

    keys.forEach(key => {
      components.push({
        name: key,
        type: 'property',
        params: [],
        description: `JSON property ${key}`
      });
    });
  } catch (error) {
    // If JSON parsing fails, return empty components
  }

  return components;
}

// Parse generic content
function parseGenericContent(content, lines, extension) {
  const components = [];

  // For config files, extract key-value pairs
  if (extension.match(/^(yml|yaml|toml|ini|conf|config)$/)) {
    const keyMatches = content.match(/^(\w+)[\s]*[:=]/gm) || [];
    keyMatches.forEach(match => {
      const key = match.match(/^(\w+)/)?.[1];
      if (key) {
        components.push({
          name: key,
          type: 'config',
          params: [],
          description: `Configuration ${key}`
        });
      }
    });
  }

  return components;
}

// Extract parameters from function signatures
function extractParameters(functionSignature) {
  const paramMatch = functionSignature.match(/\(([^)]*)\)/);
  if (!paramMatch || !paramMatch[1].trim()) return [];

  return paramMatch[1]
    .split(',')
    .map(param => param.trim().split(/\s+/).pop()) // Get just parameter name
    .filter(param => param && param !== '');
}

// Generate mock components based on file type
function generateComponentsForFile(filePath, extension) {
  const fileName = filePath.split('/').pop().replace(/\.[^/.]+$/, "");

  if (extension.match(/^(js|jsx|ts|tsx)$/)) {
    return [
      { name: fileName, type: 'component', params: ['props'], description: `${fileName} component` },
      { name: 'useState', type: 'hook', params: ['initialState'], description: 'React state hook' },
      { name: 'handleClick', type: 'function', params: ['event'], description: 'Click event handler' }
    ];
  }

  if (extension === 'css') {
    return [
      { name: `.${fileName}`, type: 'class', params: [], description: `${fileName} styles` },
      { name: '.container', type: 'class', params: [], description: 'Container layout' }
    ];
  }

  if (extension === 'py') {
    return [
      { name: `${fileName.charAt(0).toUpperCase() + fileName.slice(1)}`, type: 'class', params: [], description: `${fileName} class` },
      { name: '__init__', type: 'method', params: ['self'], description: 'Constructor method' }
    ];
  }

  return [
    { name: fileName, type: 'object', params: [], description: `${fileName} configuration` }
  ];
}

// Helper functions
function getFileType(extension) {
  const typeMap = {
    'js': 'JavaScript',
    'jsx': 'React Component',
    'ts': 'TypeScript',
    'tsx': 'React TypeScript',
    'css': 'Stylesheet',
    'html': 'HTML Template',
    'py': 'Python',
    'java': 'Java',
    'go': 'Go',
    'rs': 'Rust',
    'sql': 'SQL',
    'json': 'JSON Config',
    'yml': 'YAML Config',
    'yaml': 'YAML Config',
    'md': 'Documentation'
  };
  return typeMap[extension] || 'File';
}

function generateConnectionsFromFiles(files) {
  const connections = [];

  // Simple heuristic: connect files that likely import each other
  const frontendFiles = files.filter(f => f.category === 'Frontend');
  const backendFiles = files.filter(f => f.category === 'Backend');

  // Connect main app to components
  const mainApp = frontendFiles.find(f => f.path.toLowerCase().includes('app.'));
  if (mainApp) {
    frontendFiles.forEach(file => {
      if (file !== mainApp && file.path.includes('component')) {
        connections.push({
          from: mainApp.path,
          to: file.path,
          reason: 'imports component'
        });
      }
    });
  }

  return connections;
}

function formatRepositoryAnalysis(repoName, repoInfo, files, connections, latestCommit, defaultBranch, branches) {
  // Organize files by category
  const filesByCategory = {
    Frontend: files.filter(f => f.category === 'Frontend'),
    Backend: files.filter(f => f.category === 'Backend'),
    Data: files.filter(f => f.category === 'Data'),
    Tools: files.filter(f => f.category === 'Tools'),
    Infra: files.filter(f => f.category === 'Infra')
  };

  return {
    repository: repoName,
    files,
    filesByCategory,
    connections,
    metadata: {
      name: repoInfo?.name || repoName,
      fullName: repoInfo?.full_name || repoName,
      owner: repoInfo?.owner?.login || 'unknown',
      defaultBranch: defaultBranch || 'main',
      totalBranches: branches?.length || 1,
      lastCommit: latestCommit ? {
        sha: latestCommit.sha?.substring(0, 7),
        message: latestCommit.commit?.message,
        author: latestCommit.commit?.author?.name,
        authorLogin: latestCommit.author?.login,
        date: latestCommit.commit?.author?.date,
        url: latestCommit.html_url
      } : null,
      createdAt: repoInfo?.created_at,
      updatedAt: repoInfo?.updated_at,
      size: repoInfo?.size,
      language: repoInfo?.language,
      visibility: repoInfo?.private ? 'private' : 'public'
    },
    summary: {
      totalFiles: files.length,
      totalLines: files.reduce((sum, file) => sum + file.size, 0),
      languages: [...new Set(files.map(f => f.type))],
      categories: {
        Frontend: filesByCategory.Frontend.length,
        Backend: filesByCategory.Backend.length,
        Data: filesByCategory.Data.length,
        Tools: filesByCategory.Tools.length,
        Infra: filesByCategory.Infra.length
      },
      description: repoInfo?.description || 'No description available',
      stars: repoInfo?.stargazers_count || 0,
      forks: repoInfo?.forks_count || 0
    }
  };
}

// Enhanced mock data generator (fallback)
function generateEnhancedMockData(repoName, repoUrl) {
  console.log(`📦 Generating enhanced mock data for: ${repoName}`);

  // Generate realistic mock data based on repo name
  const mockFiles = [
    {
      path: 'src/App.js',
      type: 'React Component',
      size: 150,
      category: 'Frontend',
      components: [
        { name: 'App', type: 'component', params: ['props'], description: 'Main application component' },
        { name: 'useEffect', type: 'hook', params: ['callback', 'deps'], description: 'Side effect handler' },
        { name: 'handleSubmit', type: 'function', params: ['event'], description: 'Form submission handler' }
      ]
    },
    {
      path: 'src/components/Header.js',
      type: 'React Component',
      size: 45,
      category: 'Frontend',
      components: [
        { name: 'Header', type: 'component', params: ['title', 'user'], description: 'Navigation header component' },
        { name: 'toggleMenu', type: 'function', params: [], description: 'Toggle mobile menu' }
      ]
    },
    {
      path: 'src/components/Footer.js',
      type: 'React Component',
      size: 30,
      category: 'Frontend',
      components: [
        { name: 'Footer', type: 'component', params: [], description: 'Site footer component' }
      ]
    },
    {
      path: 'src/components/Sidebar.js',
      type: 'React Component',
      size: 85,
      category: 'Frontend',
      components: [
        { name: 'Sidebar', type: 'component', params: ['isOpen', 'onClose'], description: 'Navigation sidebar' },
        { name: 'MenuItem', type: 'component', params: ['item', 'active'], description: 'Individual menu item' }
      ]
    },
    {
      path: 'src/pages/Dashboard.js',
      type: 'React Page',
      size: 200,
      category: 'Frontend',
      components: [
        { name: 'Dashboard', type: 'component', params: [], description: 'Main dashboard page' },
        { name: 'useDashboardData', type: 'hook', params: [], description: 'Custom hook for dashboard data' },
        { name: 'refreshData', type: 'function', params: [], description: 'Refresh dashboard data' }
      ]
    },
    {
      path: 'src/styles/main.css',
      type: 'Stylesheet',
      size: 120,
      category: 'Frontend',
      components: [
        { name: '.container', type: 'class', params: [], description: 'Main container layout' },
        { name: '.btn-primary', type: 'class', params: [], description: 'Primary button styles' },
        { name: '@media (max-width: 768px)', type: 'media-query', params: [], description: 'Mobile responsive styles' }
      ]
    },
    {
      path: 'src/styles/components.css',
      type: 'Stylesheet',
      size: 90,
      category: 'Frontend',
      components: [
        { name: '.header', type: 'class', params: [], description: 'Header component styles' },
        { name: '.sidebar', type: 'class', params: [], description: 'Sidebar component styles' }
      ]
    },
    {
      path: 'public/index.html',
      type: 'HTML Template',
      size: 35,
      category: 'Frontend',
      components: [
        { name: 'root', type: 'element', params: [], description: 'React mounting point' },
        { name: 'meta viewport', type: 'element', params: [], description: 'Mobile viewport configuration' }
      ]
    },

    // Backend
    {
      path: 'server/app.js',
      type: 'Express Server',
      size: 300,
      category: 'Backend',
      components: [
        { name: 'app', type: 'object', params: [], description: 'Express application instance' },
        { name: 'startServer', type: 'function', params: [], description: 'Initialize and start server' },
        { name: 'errorHandler', type: 'function', params: ['err', 'req', 'res', 'next'], description: 'Global error handler' }
      ]
    },
    {
      path: 'server/routes/api.js',
      type: 'API Routes',
      size: 150,
      category: 'Backend',
      components: [
        { name: 'router', type: 'object', params: [], description: 'Express router instance' },
        { name: 'GET /users', type: 'route', params: [], description: 'Fetch all users' },
        { name: 'POST /users', type: 'route', params: [], description: 'Create new user' },
        { name: 'validateUser', type: 'function', params: ['userData'], description: 'User data validation' }
      ]
    },
    {
      path: 'server/middleware/auth.js',
      type: 'Middleware',
      size: 75,
      category: 'Backend',
      components: [
        { name: 'authenticate', type: 'function', params: ['req', 'res', 'next'], description: 'JWT authentication middleware' },
        { name: 'authorize', type: 'function', params: ['roles'], description: 'Role-based authorization' }
      ]
    },
    {
      path: 'server/controllers/userController.js',
      type: 'Controller',
      size: 120,
      category: 'Backend',
      components: [
        { name: 'UserController', type: 'class', params: [], description: 'User business logic controller' },
        { name: 'createUser', type: 'method', params: ['userData'], description: 'Create new user' },
        { name: 'getUserById', type: 'method', params: ['id'], description: 'Fetch user by ID' },
        { name: 'updateUser', type: 'method', params: ['id', 'updates'], description: 'Update user data' }
      ]
    },
    {
      path: 'server/models/User.js',
      type: 'Database Model',
      size: 90,
      category: 'Backend',
      components: [
        { name: 'User', type: 'class', params: [], description: 'User database model' },
        { name: 'schema', type: 'object', params: [], description: 'User schema definition' },
        { name: 'validate', type: 'method', params: [], description: 'Model validation' }
      ]
    },

    // Data
    {
      path: 'database/schema.sql',
      type: 'Database Schema',
      size: 100,
      category: 'Data',
      components: [
        { name: 'users', type: 'table', params: [], description: 'User accounts table' },
        { name: 'posts', type: 'table', params: [], description: 'User posts table' },
        { name: 'user_posts_fk', type: 'constraint', params: [], description: 'Foreign key constraint' }
      ]
    },
    {
      path: 'database/migrations/001_initial.sql',
      type: 'Migration',
      size: 45,
      category: 'Data',
      components: [
        { name: 'CREATE TABLE users', type: 'statement', params: [], description: 'Create users table' },
        { name: 'CREATE INDEX idx_email', type: 'statement', params: [], description: 'Email index for performance' }
      ]
    },
    {
      path: 'data/seed.json',
      type: 'Seed Data',
      size: 80,
      category: 'Data',
      components: [
        { name: 'users', type: 'array', params: [], description: 'Sample user data' },
        { name: 'posts', type: 'array', params: [], description: 'Sample post data' }
      ]
    },
    {
      path: 'src/utils/api.js',
      type: 'API Client',
      size: 110,
      category: 'Data',
      components: [
        { name: 'apiClient', type: 'object', params: [], description: 'HTTP client configuration' },
        { name: 'get', type: 'function', params: ['url', 'config'], description: 'GET request wrapper' },
        { name: 'post', type: 'function', params: ['url', 'data', 'config'], description: 'POST request wrapper' },
        { name: 'handleError', type: 'function', params: ['error'], description: 'API error handler' }
      ]
    },

    // Tools
    {
      path: 'package.json',
      type: 'Package Config',
      size: 25,
      category: 'Tools',
      components: [
        { name: 'dependencies', type: 'object', params: [], description: 'Runtime dependencies' },
        { name: 'devDependencies', type: 'object', params: [], description: 'Development dependencies' },
        { name: 'scripts', type: 'object', params: [], description: 'NPM scripts' }
      ]
    },
    {
      path: 'webpack.config.js',
      type: 'Build Config',
      size: 65,
      category: 'Tools',
      components: [
        { name: 'module.exports', type: 'object', params: [], description: 'Webpack configuration' },
        { name: 'entry', type: 'property', params: [], description: 'Application entry point' },
        { name: 'plugins', type: 'array', params: [], description: 'Build plugins' }
      ]
    },
    {
      path: 'babel.config.js',
      type: 'Transpiler Config',
      size: 20,
      category: 'Tools',
      components: [
        { name: 'presets', type: 'array', params: [], description: 'Babel presets' },
        { name: 'plugins', type: 'array', params: [], description: 'Babel plugins' }
      ]
    },
    {
      path: 'eslint.config.js',
      type: 'Linting Config',
      size: 30,
      category: 'Tools',
      components: [
        { name: 'rules', type: 'object', params: [], description: 'ESLint rules' },
        { name: 'extends', type: 'array', params: [], description: 'Extended configurations' }
      ]
    },
    {
      path: 'scripts/build.sh',
      type: 'Build Script',
      size: 40,
      category: 'Tools',
      components: [
        { name: 'build_frontend', type: 'function', params: [], description: 'Build React application' },
        { name: 'build_backend', type: 'function', params: [], description: 'Build Node.js server' }
      ]
    },

    // Infra
    {
      path: 'Dockerfile',
      type: 'Container Config',
      size: 25,
      category: 'Infra',
      components: [
        { name: 'FROM node:18', type: 'instruction', params: [], description: 'Base image' },
        { name: 'COPY package*.json', type: 'instruction', params: [], description: 'Copy package files' },
        { name: 'RUN npm install', type: 'instruction', params: [], description: 'Install dependencies' }
      ]
    },
    {
      path: 'docker-compose.yml',
      type: 'Container Orchestration',
      size: 35,
      category: 'Infra',
      components: [
        { name: 'web', type: 'service', params: [], description: 'Web application service' },
        { name: 'database', type: 'service', params: [], description: 'PostgreSQL database service' },
        { name: 'volumes', type: 'section', params: [], description: 'Persistent storage' }
      ]
    },
    {
      path: '.github/workflows/ci.yml',
      type: 'CI/CD Pipeline',
      size: 50,
      category: 'Infra',
      components: [
        { name: 'test', type: 'job', params: [], description: 'Run automated tests' },
        { name: 'build', type: 'job', params: [], description: 'Build application' },
        { name: 'deploy', type: 'job', params: [], description: 'Deploy to production' }
      ]
    },
    {
      path: 'terraform/main.tf',
      type: 'Infrastructure Code',
      size: 80,
      category: 'Infra',
      components: [
        { name: 'aws_instance', type: 'resource', params: [], description: 'EC2 instance configuration' },
        { name: 'aws_s3_bucket', type: 'resource', params: [], description: 'S3 bucket for assets' },
        { name: 'variables', type: 'block', params: [], description: 'Input variables' }
      ]
    },
    {
      path: 'nginx.conf',
      type: 'Web Server Config',
      size: 45,
      category: 'Infra',
      components: [
        { name: 'server', type: 'block', params: [], description: 'Server configuration' },
        { name: 'location /', type: 'block', params: [], description: 'Root location handler' },
        { name: 'upstream backend', type: 'block', params: [], description: 'Backend server pool' }
      ]
    },
    {
      path: 'README.md',
      type: 'Documentation',
      size: 60,
      category: 'Infra',
      components: [
        { name: 'Installation', type: 'section', params: [], description: 'Setup instructions' },
        { name: 'Usage', type: 'section', params: [], description: 'Usage examples' },
        { name: 'API Reference', type: 'section', params: [], description: 'API documentation' }
      ]
    }
  ];

  const mockConnections = [
    { from: 'src/App.js', to: 'src/components/Header.js', reason: 'imports component' },
    { from: 'src/App.js', to: 'src/components/Footer.js', reason: 'imports component' },
    { from: 'src/App.js', to: 'src/utils/api.js', reason: 'uses API functions' },
    { from: 'src/App.js', to: 'src/styles/main.css', reason: 'imports styles' }
  ];

  // Organize files by category
  const filesByCategory = {
    Frontend: mockFiles.filter(f => f.category === 'Frontend'),
    Backend: mockFiles.filter(f => f.category === 'Backend'),
    Data: mockFiles.filter(f => f.category === 'Data'),
    Tools: mockFiles.filter(f => f.category === 'Tools'),
    Infra: mockFiles.filter(f => f.category === 'Infra')
  };

  return {
    repository: repoName,
    files: mockFiles, // Keep flat list for compatibility
    filesByCategory,
    connections: mockConnections,
    metadata: {
      name: repoName,
      fullName: `example/${repoName}`,
      owner: 'example',
      defaultBranch: 'main',
      totalBranches: 3,
      lastCommit: {
        sha: 'abc1234',
        message: 'Initial commit with project structure',
        author: 'Example Developer',
        authorLogin: 'dev-example',
        date: new Date().toISOString(),
        url: `https://github.com/example/${repoName}/commit/abc1234`
      },
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: new Date().toISOString(),
      size: 1024,
      language: 'JavaScript',
      visibility: 'public'
    },
    summary: {
      totalFiles: mockFiles.length,
      totalLines: mockFiles.reduce((sum, file) => sum + file.size, 0),
      languages: ['JavaScript', 'CSS', 'SQL', 'YAML', 'HTML'],
      categories: {
        Frontend: filesByCategory.Frontend.length,
        Backend: filesByCategory.Backend.length,
        Data: filesByCategory.Data.length,
        Tools: filesByCategory.Tools.length,
        Infra: filesByCategory.Infra.length
      },
      description: `${repoName} is a sample repository for demonstration purposes`,
      stars: 42,
      forks: 12
    }
  };
}

// Start server
async function startServer() {
  await initializeStorage();

  app.listen(PORT, () => {
    console.log(`🚀 Code Visualizer server running on port ${PORT}`);
    console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});