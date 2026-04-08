/**
 * Build detector: takes analyzer output and produces a deploy plan
 * that Railway (or any PaaS) can use to build and serve the app.
 */

const FRAMEWORK_PLANS = {
  'Next.js': {
    type: 'fullstack',
    buildCommand: 'npm run build',
    startCommand: 'npm start',
    outputDir: '.next',
    port: 3000,
  },
  'Nuxt': {
    type: 'fullstack',
    buildCommand: 'npm run build',
    startCommand: 'node .output/server/index.mjs',
    outputDir: '.output',
    port: 3000,
  },
  'SvelteKit': {
    type: 'fullstack',
    buildCommand: 'npm run build',
    startCommand: 'node build',
    outputDir: 'build',
    port: 3000,
  },
  'React': {
    type: 'static',
    buildCommand: 'npm run build',
    startCommand: null,
    outputDir: 'dist',
    port: null,
  },
  'React + Express': {
    type: 'fullstack',
    buildCommand: 'npm run build',
    startCommand: 'npm start',
    outputDir: null,
    port: 3000,
  },
  'Vue': {
    type: 'static',
    buildCommand: 'npm run build',
    startCommand: null,
    outputDir: 'dist',
    port: null,
  },
  'Angular': {
    type: 'static',
    buildCommand: 'npm run build',
    startCommand: null,
    outputDir: 'dist',
    port: null,
  },
  'Express': {
    type: 'server',
    buildCommand: null,
    startCommand: 'npm start',
    outputDir: null,
    port: 3000,
  },
  'Django': {
    type: 'server',
    buildCommand: 'pip install -r requirements.txt',
    startCommand: 'gunicorn config.wsgi:application',
    outputDir: null,
    port: 8000,
  },
  'Flask': {
    type: 'server',
    buildCommand: 'pip install -r requirements.txt',
    startCommand: 'gunicorn app:app',
    outputDir: null,
    port: 5000,
  },
  'FastAPI': {
    type: 'server',
    buildCommand: 'pip install -r requirements.txt',
    startCommand: 'uvicorn main:app --host 0.0.0.0',
    outputDir: null,
    port: 8000,
  },
};

const RUNTIME_DEFAULTS = {
  node: { type: 'server', startCommand: 'npm start', port: 3000 },
  python: { type: 'server', startCommand: 'python app.py', port: 5000 },
  go: { type: 'server', startCommand: null, port: 8080 },
  rust: { type: 'server', startCommand: null, port: 8080 },
};

/**
 * Detect if the project uses Vite (which outputs to dist/) vs CRA (which outputs to build/)
 */
function detectOutputDir(fileTree, packageJson) {
  if (!packageJson) return 'dist';

  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (allDeps.vite || allDeps['@vitejs/plugin-react']) return 'dist';
  if (allDeps['react-scripts']) return 'build';
  if (allDeps['@angular/cli']) return `dist/${packageJson.name || 'app'}`;

  if (fileTree.some((f) => f.includes('vite.config'))) return 'dist';
  return 'dist';
}

/**
 * Try to determine the start command from package.json scripts
 */
function detectStartCommand(packageJson) {
  if (!packageJson?.scripts) return null;
  const { scripts } = packageJson;
  if (scripts.start) return 'npm start';
  if (scripts.serve) return 'npm run serve';
  if (scripts.preview) return 'npm run preview';
  return null;
}

/**
 * Try to determine the build command from package.json scripts
 */
function detectBuildCommand(packageJson) {
  if (!packageJson?.scripts) return null;
  if (packageJson.scripts.build) return 'npm run build';
  return null;
}

/**
 * Detect the port the app listens on from package.json scripts or common patterns
 */
function detectPort(packageJson, fileContents) {
  if (packageJson?.scripts?.start) {
    const portMatch = packageJson.scripts.start.match(/(?:PORT|port)[=:\s]+(\d+)/);
    if (portMatch) return parseInt(portMatch[1], 10);
  }

  for (const [, content] of Object.entries(fileContents || {})) {
    if (typeof content !== 'string') continue;
    const listenMatch = content.match(/\.listen\(\s*(\d{4,5})/);
    if (listenMatch) return parseInt(listenMatch[1], 10);
    const portEnv = content.match(/PORT\s*\|\|\s*(\d{4,5})/);
    if (portEnv) return parseInt(portEnv[1], 10);
  }

  return null;
}

/**
 * Parse .env.example to find required environment variables
 */
function detectEnvVars(fileContents) {
  const envVars = [];
  const envFile = fileContents['.env.example'] || fileContents['env.example'];
  if (!envFile) return envVars;

  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) {
      const name = match[1];
      const hasValue = trimmed.length > match[0].length && !trimmed.endsWith('=');
      envVars.push({
        name,
        hasDefault: hasValue,
        value: hasValue ? trimmed.slice(match[0].length) : null,
      });
    }
  }
  return envVars;
}

/**
 * Determine if this is a static site that needs a static file server
 */
function isStaticSite(stack, fileTree) {
  if (stack.framework === 'Express' || stack.framework === 'Django'
    || stack.framework === 'Flask' || stack.framework === 'FastAPI') {
    return false;
  }
  if (stack.framework === 'Next.js' || stack.framework === 'Nuxt'
    || stack.framework === 'SvelteKit' || stack.framework === 'React + Express') {
    return false;
  }

  const hasServerFiles = fileTree.some((f) =>
    /^(server|backend|api)\//i.test(f) ||
    /server\.(js|ts)$/.test(f) ||
    /app\.(py|rb)$/.test(f)
  );
  if (hasServerFiles) return false;

  return true;
}

/**
 * Main entry point: produce a deploy plan from analyzer output.
 *
 * @param {object} params
 * @param {object} params.stack - from analyzer detectStack()
 * @param {string[]} params.fileTree - flat list of file paths
 * @param {object} params.fileContents - { path: content } for key files
 * @param {object} params.deployInfo - from detectDeploymentFiles()
 * @returns {object} deployPlan
 */
function detectBuildPlan({ stack, fileTree, fileContents, deployInfo }) {
  const packageJson = safeJson(fileContents['package.json']);

  const hasDockerfile = (deployInfo?.containers || []).some(
    (c) => c.platform === 'Docker' && /Dockerfile/.test(c.path)
  );

  // If a Dockerfile exists, Railway will use it automatically — minimal overrides needed
  if (hasDockerfile) {
    const envVars = detectEnvVars(fileContents);
    return {
      type: 'docker',
      framework: stack.framework || 'custom',
      runtime: stack.runtime || 'unknown',
      buildCommand: null,
      startCommand: null,
      outputDir: null,
      port: detectPort(packageJson, fileContents) || 3000,
      hasDockerfile: true,
      envVarsRequired: envVars,
      nixpacksOverrides: {},
      confidence: 'high',
      reason: 'Dockerfile detected — Railway will build from Dockerfile',
    };
  }

  // Try framework-specific plan
  const frameworkPlan = FRAMEWORK_PLANS[stack.framework];
  if (frameworkPlan) {
    const staticType = isStaticSite(stack, fileTree);
    const type = staticType ? 'static' : frameworkPlan.type;
    const outputDir = type === 'static'
      ? detectOutputDir(fileTree, packageJson)
      : frameworkPlan.outputDir;

    return {
      type,
      framework: stack.framework,
      runtime: stack.runtime || 'node',
      buildCommand: detectBuildCommand(packageJson) || frameworkPlan.buildCommand,
      startCommand: type === 'static' ? null : (detectStartCommand(packageJson) || frameworkPlan.startCommand),
      outputDir,
      port: type === 'static' ? null : (detectPort(packageJson, fileContents) || frameworkPlan.port),
      hasDockerfile: false,
      envVarsRequired: detectEnvVars(fileContents),
      nixpacksOverrides: {},
      confidence: 'high',
      reason: `Detected ${stack.framework} project`,
    };
  }

  // Fallback: runtime-based plan
  const runtimePlan = RUNTIME_DEFAULTS[stack.runtime];
  if (runtimePlan) {
    return {
      type: runtimePlan.type,
      framework: stack.framework || 'none',
      runtime: stack.runtime,
      buildCommand: detectBuildCommand(packageJson),
      startCommand: detectStartCommand(packageJson) || runtimePlan.startCommand,
      outputDir: null,
      port: detectPort(packageJson, fileContents) || runtimePlan.port,
      hasDockerfile: false,
      envVarsRequired: detectEnvVars(fileContents),
      nixpacksOverrides: {},
      confidence: 'medium',
      reason: `Detected ${stack.runtime} project (no specific framework matched)`,
    };
  }

  // Plain HTML fallback — check if index.html exists at root
  const hasIndexHtml = fileTree.some((f) => f === 'index.html');
  if (hasIndexHtml) {
    return {
      type: 'static',
      framework: 'html',
      runtime: 'static',
      buildCommand: null,
      startCommand: null,
      outputDir: '.',
      port: null,
      hasDockerfile: false,
      envVarsRequired: [],
      nixpacksOverrides: {},
      confidence: 'medium',
      reason: 'Plain HTML site (index.html at root)',
    };
  }

  return {
    type: 'unknown',
    framework: stack.framework || 'unknown',
    runtime: stack.runtime || 'unknown',
    buildCommand: detectBuildCommand(packageJson),
    startCommand: detectStartCommand(packageJson),
    outputDir: null,
    port: detectPort(packageJson, fileContents) || 3000,
    hasDockerfile: false,
    envVarsRequired: detectEnvVars(fileContents),
    nixpacksOverrides: {},
    confidence: 'low',
    reason: 'Could not confidently detect project type — Railway Nixpacks will attempt auto-detection',
  };
}

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

module.exports = { detectBuildPlan };
