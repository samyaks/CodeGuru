const github = require('./github');
const { detectDeploymentFiles } = require('./deployment');

const MAX_FILES_TO_READ = 150;

const PRIORITY_FILES = [
  /^package\.json$/,
  /^requirements\.txt$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^pyproject\.toml$/,
  /^pom\.xml$/,
  /^\.env\.example$/,
  /^env\.example$/,
  /^README\.md$/i,
  /^\.cursorrules$/,
  /^CLAUDE\.md$/i,
  /^\.context\.md$/,
  /next\.config\./,
  /nuxt\.config\./,
  /vite\.config\./,
  /vue\.config\./,
  /angular\.json$/,
  /svelte\.config\./,
  /tailwind\.config\./,
  /tsconfig\.json$/,
  /docker-compose\.ya?ml$/,
  /Dockerfile$/,
  /vercel\.json$/,
  /netlify\.toml$/,
  /fly\.toml$/,
  /firebase\.json$/,
];

const PRIORITY_PATH_PATTERNS = [
  /prisma\/schema\.prisma$/,
  /drizzle\.config\./,
  /(?:^|\/)schema\./,
  /(?:^|\/)migrations?\//,
  /(?:^|\/)models?\//,
  /(?:^|\/)routes?\//,
  /(?:^|\/)api\//,
  /(?:^|\/)middleware/,
  /(?:^|\/)auth/,
  /(?:^|\/)login/,
  /(?:^|\/)signup/,
  /(?:^|\/)session/,
  /(?:^|\/)layout\.(tsx?|jsx?)$/,
  /(?:^|\/)page\.(tsx?|jsx?)$/,
  /(?:^|\/)app\.(tsx?|jsx?|js)$/,
  /(?:^|\/)server\.(tsx?|jsx?|js)$/,
  /(?:^|\/)index\.(tsx?|jsx?|js)$/,
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.cache', 'coverage', '.turbo', '.vercel', 'vendor',
  '.svelte-kit', 'target', 'out', '.expo',
]);

const SKIP_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'wav', 'avi', 'mov',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'lock', 'map', 'min.js', 'min.css',
]);

function shouldSkipFile(filePath) {
  const parts = filePath.split('/');
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext && SKIP_EXTENSIONS.has(ext)) return true;
  if (filePath.endsWith('.lock')) return true;
  if (filePath.endsWith('.min.js') || filePath.endsWith('.min.css')) return true;
  return false;
}

function scorePath(filePath) {
  const name = filePath.split('/').pop();
  for (const re of PRIORITY_FILES) {
    if (re.test(name)) return 100;
  }
  for (const re of PRIORITY_PATH_PATTERNS) {
    if (re.test(filePath)) return 50;
  }
  const depth = filePath.split('/').length;
  if (depth <= 2) return 20;
  if (depth <= 3) return 10;
  return 1;
}

async function analyzeRepo(repoUrl, onProgress) {
  const { owner, repo } = github.parseRepoUrl(repoUrl);
  const send = onProgress || (() => {});

  send({ phase: 'meta', message: `Fetching metadata for ${owner}/${repo}...` });
  const repoMeta = await github.fetchRepoMeta(owner, repo);

  const branch = repoMeta.default_branch || 'main';
  send({ phase: 'tree', message: `Reading file tree (branch: ${branch})...` });

  let tree;
  try {
    tree = await github.fetchRepoTree(owner, repo, branch);
  } catch {
    const fallback = branch === 'main' ? 'master' : 'main';
    tree = await github.fetchRepoTree(owner, repo, fallback);
  }

  const allFiles = tree.filter((f) => f.type === 'blob' && !shouldSkipFile(f.path));
  send({ phase: 'tree-done', message: `Found ${allFiles.length} files`, fileCount: allFiles.length });

  const sorted = allFiles
    .map((f) => ({ ...f, score: scorePath(f.path) }))
    .sort((a, b) => b.score - a.score);

  const toRead = sorted.slice(0, MAX_FILES_TO_READ);
  send({ phase: 'reading', message: `Reading ${toRead.length} key files...` });

  const fileContents = {};
  const batchSize = 5;
  for (let i = 0; i < toRead.length; i += batchSize) {
    const batch = toRead.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((f) =>
        github.fetchFileContent(owner, repo, f.path, branch)
          .catch(() => ({ path: f.path, content: null, size: 0 }))
      )
    );
    for (const r of results) {
      if (r.content) fileContents[r.path] = r.content;
    }
    send({
      phase: 'reading',
      message: `Read ${Math.min(i + batchSize, toRead.length)}/${toRead.length} files...`,
    });
  }

  send({ phase: 'analyzing', message: 'Detecting tech stack and capabilities...' });

  const stack = detectStack(allFiles, fileContents);
  const structure = analyzeStructure(allFiles);
  const gaps = detectGaps(allFiles, fileContents, stack);
  const deployInfo = detectDeploymentFiles(tree);
  const features = detectFeatures(allFiles, fileContents);
  const existingContext = detectExistingContext(allFiles);

  if (deployInfo.detected) {
    gaps.deployment.exists = true;
    gaps.deployment.platform = deployInfo.hosting[0]?.platform
      || deployInfo.containers[0]?.platform
      || null;
    gaps.deployment.hasCI = deployInfo.cicd.length > 0;
  }

  send({ phase: 'complete', message: 'Analysis complete' });

  return {
    meta: {
      name: repoMeta.name,
      description: repoMeta.description,
      language: repoMeta.language,
      defaultBranch: branch,
      stars: repoMeta.stargazers_count,
      forks: repoMeta.forks_count,
      owner,
      repo,
      repoUrl,
    },
    stack,
    structure,
    features,
    gaps,
    deployInfo,
    existingContext,
    fileContents,
    fileTree: allFiles.map((f) => f.path),
  };
}

function detectStack(files, contents) {
  const stack = {
    framework: null,
    runtime: null,
    styling: null,
    database: null,
    auth: null,
    deployment: null,
    languages: [],
  };

  const paths = files.map((f) => f.path);
  const pkg = safeJson(contents['package.json']);
  const allDeps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};

  // Runtime
  if (pkg) stack.runtime = 'node';
  if (paths.some((p) => p.endsWith('.py') || p === 'requirements.txt' || p === 'pyproject.toml')) {
    stack.runtime = stack.runtime || 'python';
  }
  if (paths.some((p) => p === 'go.mod')) stack.runtime = stack.runtime || 'go';
  if (paths.some((p) => p === 'Cargo.toml')) stack.runtime = stack.runtime || 'rust';

  // Framework
  if (allDeps.next) stack.framework = 'Next.js';
  else if (allDeps.nuxt) stack.framework = 'Nuxt';
  else if (allDeps['@sveltejs/kit'] || allDeps.svelte) stack.framework = 'SvelteKit';
  else if (allDeps['@angular/core']) stack.framework = 'Angular';
  else if (allDeps.vue) stack.framework = 'Vue';
  else if (allDeps.react) stack.framework = allDeps.express ? 'React + Express' : 'React';
  else if (allDeps.express) stack.framework = 'Express';
  else if (paths.some((p) => p.includes('django'))) stack.framework = 'Django';
  else if (paths.some((p) => p.includes('flask'))) stack.framework = 'Flask';
  else if (paths.some((p) => p.includes('fastapi'))) stack.framework = 'FastAPI';

  // Styling
  if (allDeps.tailwindcss || allDeps['@tailwindcss/vite']) stack.styling = 'Tailwind CSS';
  else if (allDeps['styled-components']) stack.styling = 'styled-components';
  else if (allDeps['@emotion/react']) stack.styling = 'Emotion';
  else if (allDeps['sass'] || allDeps['node-sass']) stack.styling = 'SCSS';

  // Database
  if (allDeps.prisma || allDeps['@prisma/client']) stack.database = 'Prisma';
  else if (allDeps.drizzle || allDeps['drizzle-orm']) stack.database = 'Drizzle';
  else if (allDeps.mongoose) stack.database = 'MongoDB (Mongoose)';
  else if (allDeps.pg || allDeps.postgres) stack.database = 'PostgreSQL';
  else if (allDeps.mysql2) stack.database = 'MySQL';
  else if (allDeps['better-sqlite3'] || allDeps.sqlite3) stack.database = 'SQLite';
  else if (allDeps['@supabase/supabase-js']) stack.database = 'Supabase';
  else if (allDeps.firebase || allDeps['firebase-admin']) stack.database = 'Firebase';

  // Auth
  if (allDeps['next-auth'] || allDeps['@auth/core']) stack.auth = 'NextAuth';
  else if (allDeps['@clerk/nextjs'] || allDeps['@clerk/express']) stack.auth = 'Clerk';
  else if (allDeps['@supabase/auth-helpers-nextjs'] || allDeps['@supabase/ssr']) stack.auth = 'Supabase Auth';
  else if (allDeps.passport) stack.auth = 'Passport.js';
  else if (allDeps['firebase-admin'] || allDeps.firebase) stack.auth = 'Firebase Auth';
  else if (allDeps.jsonwebtoken) stack.auth = 'JWT (custom)';

  // Languages
  const langSet = new Set();
  for (const f of files) {
    const ext = f.path.split('.').pop()?.toLowerCase();
    if (['js', 'jsx'].includes(ext)) langSet.add('JavaScript');
    else if (['ts', 'tsx'].includes(ext)) langSet.add('TypeScript');
    else if (ext === 'py') langSet.add('Python');
    else if (ext === 'go') langSet.add('Go');
    else if (ext === 'rs') langSet.add('Rust');
    else if (ext === 'java') langSet.add('Java');
    else if (ext === 'rb') langSet.add('Ruby');
    else if (ext === 'php') langSet.add('PHP');
    else if (ext === 'swift') langSet.add('Swift');
    else if (ext === 'kt') langSet.add('Kotlin');
  }
  stack.languages = [...langSet];

  return stack;
}

function analyzeStructure(files) {
  const dirs = new Set();
  const entryPoints = [];
  const routeFiles = [];
  const configFiles = [];

  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }

    const name = parts[parts.length - 1];
    if (/^(app|server|index|main)\.(tsx?|jsx?|js|py)$/.test(name)) {
      entryPoints.push(f.path);
    }
    if (/route|api|endpoint/i.test(f.path)) {
      routeFiles.push(f.path);
    }
    if (/\.(config|conf)\./i.test(name) || /^(tsconfig|next\.config|vite\.config|nuxt\.config)/i.test(name)) {
      configFiles.push(f.path);
    }
  }

  return {
    directories: [...dirs].sort(),
    entryPoints,
    routeFiles,
    configFiles,
  };
}

function detectGaps(files, contents, stack) {
  const paths = files.map((f) => f.path);
  const allContent = Object.values(contents).join('\n');

  const hasAuthFiles = paths.some((p) =>
    /auth|login|signup|session|middleware.*auth/i.test(p)
  );
  const hasAuthCode = allContent.includes('signIn') || allContent.includes('login')
    || allContent.includes('session') || allContent.includes('jwt')
    || allContent.includes('passport') || allContent.includes('requireAuth');

  const hasDbFiles = paths.some((p) =>
    /schema|migration|model|prisma|drizzle|database|\.sql$/i.test(p)
  );

  const hasDeployFiles = paths.some((p) =>
    /Dockerfile|docker-compose|vercel\.json|netlify\.toml|fly\.toml|Procfile|\.github\/workflows/i.test(p)
  );

  const hasTestFiles = paths.some((p) =>
    /test|spec|__tests__|\.test\.|\.spec\./i.test(p)
  );

  const hasErrorHandler = allContent.includes('errorHandler')
    || allContent.includes('error-handler')
    || allContent.includes('app.use((err');

  const hasEnvExample = paths.some((p) => /\.env\.example$|^env\.example$/i.test(p));

  const hasPermissions = allContent.includes('role') && (allContent.includes('admin') || allContent.includes('permission'));

  return {
    auth: {
      exists: hasAuthFiles || hasAuthCode,
      provider: stack.auth || null,
      issues: hasAuthFiles && !hasAuthCode
        ? ['Auth files exist but implementation may be incomplete']
        : [],
    },
    database: {
      exists: hasDbFiles || !!stack.database,
      type: stack.database || null,
      hasSchema: paths.some((p) => /schema/i.test(p)),
      hasMigrations: paths.some((p) => /migration/i.test(p)),
    },
    deployment: {
      exists: hasDeployFiles,
      platform: null,
      hasCI: paths.some((p) => p.startsWith('.github/workflows')),
    },
    permissions: {
      exists: hasPermissions,
      hasRoles: hasPermissions,
    },
    testing: {
      exists: hasTestFiles,
      coverage: hasTestFiles ? 'unknown' : 'none',
    },
    errorHandling: {
      exists: hasErrorHandler,
      hasGlobalHandler: hasErrorHandler,
    },
    envConfig: {
      exists: hasEnvExample,
      hasExample: hasEnvExample,
      missingVars: [],
    },
  };
}

function detectFeatures(files, contents) {
  const featureDirs = new Map();

  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length < 2) continue;
    const dir = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0];
    if (!featureDirs.has(dir)) {
      featureDirs.set(dir, { files: [], hasUI: false, hasAPI: false, hasTests: false });
    }
    const entry = featureDirs.get(dir);
    entry.files.push(f.path);

    const ext = f.path.split('.').pop()?.toLowerCase();
    if (['tsx', 'jsx', 'vue', 'svelte'].includes(ext)) entry.hasUI = true;
    if (/route|api|controller|endpoint/i.test(f.path)) entry.hasAPI = true;
    if (/test|spec/i.test(f.path)) entry.hasTests = true;
  }

  return [...featureDirs.entries()].map(([name, data]) => ({
    name,
    path: name,
    hasUI: data.hasUI,
    hasAPI: data.hasAPI,
    hasTests: data.hasTests,
    fileCount: data.files.length,
  }));
}

function detectExistingContext(files) {
  const paths = files.map((f) => f.path);
  return {
    hasCursorRules: paths.some((p) => p.includes('.cursorrules')),
    hasClaudeMd: paths.some((p) => /CLAUDE\.md$/i.test(p)),
    hasContextMd: paths.some((p) => p.includes('.context.md')),
  };
}

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

module.exports = { analyzeRepo };
