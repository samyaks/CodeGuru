/**
 * Readiness scorer: takes analyzer output and produces a 0-100 production
 * readiness score with per-category breakdown and a path recommendation.
 */

const CATEGORY_WEIGHTS = {
  frontend:      15,
  backend:       15,
  auth:          15,
  database:      15,
  errorHandling: 10,
  envConfig:     10,
  deployment:    10,
  testing:       10,
};

const DEPLOY_THRESHOLD = 90;

function scoreReadiness({ gaps, stack, fileTree, features, deployInfo, buildPlan }) {
  const categories = {};
  let totalEarned = 0;

  // Frontend — do UI files exist?
  const hasUI = fileTree.some((p) => /\.(tsx|jsx|vue|svelte|html)$/.test(p));
  const hasRouting = fileTree.some((p) => /route|page|layout\.(tsx?|jsx?)/i.test(p));
  const frontendScore = hasUI ? (hasRouting ? 100 : 70) : 0;
  categories.frontend = {
    score: frontendScore,
    weight: CATEGORY_WEIGHTS.frontend,
    earned: Math.round(frontendScore * CATEGORY_WEIGHTS.frontend / 100),
    status: frontendScore >= 70 ? 'ready' : frontendScore > 0 ? 'partial' : 'missing',
    label: 'Frontend / UI',
    detail: hasUI
      ? `${stack.framework || 'HTML'} detected${stack.styling ? ` with ${stack.styling}` : ''}`
      : 'No UI files found',
  };

  // Backend / API
  const hasAPI = fileTree.some((p) => /api|route|controller|endpoint|server\.(js|ts)/i.test(p));
  const hasBackendFramework = ['Express', 'React + Express', 'Next.js', 'Nuxt', 'SvelteKit',
    'Django', 'Flask', 'FastAPI'].includes(stack.framework);
  const backendScore = hasBackendFramework ? 100 : hasAPI ? 60 : 0;
  categories.backend = {
    score: backendScore,
    weight: CATEGORY_WEIGHTS.backend,
    earned: Math.round(backendScore * CATEGORY_WEIGHTS.backend / 100),
    status: backendScore >= 70 ? 'ready' : backendScore > 0 ? 'partial' : 'missing',
    label: 'Backend / API',
    detail: hasBackendFramework
      ? `${stack.framework} server detected`
      : hasAPI ? 'API files found but no framework detected' : 'No backend detected',
  };

  // Auth
  const authScore = gaps.auth.exists ? 100 : 0;
  categories.auth = {
    score: authScore,
    weight: CATEGORY_WEIGHTS.auth,
    earned: Math.round(authScore * CATEGORY_WEIGHTS.auth / 100),
    status: authScore > 0 ? 'ready' : 'missing',
    label: 'Authentication',
    detail: gaps.auth.exists
      ? `${gaps.auth.provider || 'Custom auth'} detected`
      : 'No authentication system found',
  };

  // Database
  const dbScore = gaps.database.exists
    ? (gaps.database.hasSchema ? 100 : 70)
    : 0;
  categories.database = {
    score: dbScore,
    weight: CATEGORY_WEIGHTS.database,
    earned: Math.round(dbScore * CATEGORY_WEIGHTS.database / 100),
    status: dbScore >= 70 ? 'ready' : dbScore > 0 ? 'partial' : 'missing',
    label: 'Database',
    detail: gaps.database.exists
      ? `${gaps.database.type || 'Database'} detected${gaps.database.hasSchema ? ' with schema' : ''}`
      : 'No database configuration found',
  };

  // Error Handling
  const errorScore = gaps.errorHandling.exists ? 100 : 0;
  categories.errorHandling = {
    score: errorScore,
    weight: CATEGORY_WEIGHTS.errorHandling,
    earned: Math.round(errorScore * CATEGORY_WEIGHTS.errorHandling / 100),
    status: errorScore > 0 ? 'ready' : 'missing',
    label: 'Error Handling',
    detail: gaps.errorHandling.exists
      ? 'Global error handling detected'
      : 'No structured error handling found',
  };

  // Environment Config
  const envScore = gaps.envConfig.exists ? 100 : 0;
  categories.envConfig = {
    score: envScore,
    weight: CATEGORY_WEIGHTS.envConfig,
    earned: Math.round(envScore * CATEGORY_WEIGHTS.envConfig / 100),
    status: envScore > 0 ? 'ready' : 'missing',
    label: 'Environment Config',
    detail: gaps.envConfig.exists
      ? '.env.example found'
      : 'No .env.example — environment variables may be undocumented',
  };

  // Deployment
  const deployScore = gaps.deployment.exists ? 100 : 0;
  categories.deployment = {
    score: deployScore,
    weight: CATEGORY_WEIGHTS.deployment,
    earned: Math.round(deployScore * CATEGORY_WEIGHTS.deployment / 100),
    status: deployScore > 0 ? 'ready' : 'missing',
    label: 'Deployment',
    detail: gaps.deployment.exists
      ? `Deploy config found${gaps.deployment.platform ? ` (${gaps.deployment.platform})` : ''}`
      : 'No deployment configuration found',
  };

  // Testing
  const testScore = gaps.testing.exists ? 100 : 0;
  categories.testing = {
    score: testScore,
    weight: CATEGORY_WEIGHTS.testing,
    earned: Math.round(testScore * CATEGORY_WEIGHTS.testing / 100),
    status: testScore > 0 ? 'ready' : 'missing',
    label: 'Testing',
    detail: gaps.testing.exists
      ? 'Test files detected'
      : 'No test files found',
  };

  for (const cat of Object.values(categories)) {
    totalEarned += cat.earned;
  }

  const score = Math.min(100, totalEarned);
  const recommendation = score >= DEPLOY_THRESHOLD ? 'deploy' : 'plan';

  const readyCount = Object.values(categories).filter((c) => c.status === 'ready').length;
  const missingCount = Object.values(categories).filter((c) => c.status === 'missing').length;

  return {
    score,
    recommendation,
    categories,
    summary: {
      readyCount,
      missingCount,
      totalCategories: Object.keys(categories).length,
    },
    threshold: DEPLOY_THRESHOLD,
  };
}

module.exports = { scoreReadiness, DEPLOY_THRESHOLD };
