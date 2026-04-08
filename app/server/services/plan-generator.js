/**
 * Plan generator: takes gaps and readiness scoring, produces an ordered
 * list of steps to make an app production-ready. Each step includes a
 * context file (for AI tools) and a ready-to-paste Cursor prompt.
 *
 * For MVP, context files and prompts are generated from templates.
 * Phase 2 will use Claude to generate richer, project-specific context.
 */

const STEP_TEMPLATES = {
  auth: {
    title: 'Add Authentication',
    category: 'auth',
    effort: 'medium',
    priority: 1,
    why: 'Your app has no authentication. Users can\'t log in, sign up, or have their own data.',
    buildContextFile(stack) {
      const rec = recommendAuth(stack);
      return `## owner\n@your-team\n\n## purpose\nAuthentication system for the app. Handles user signup, login, session management, and protected routes.\n\n## constraints\n- Must support email/password and at least one OAuth provider (GitHub recommended)\n- Sessions must be server-side or use httpOnly cookies — no JWT in localStorage\n- All API routes that access user data must be protected\n- Auth state must persist across page refreshes\n\n## decisions\n### Use ${rec.provider}\n${rec.rationale}\n\n## dependencies\nUpstream: none (auth is foundational)\nDownstream: all user-facing features depend on this\n\n## status\nStage: not started`;
    },
    buildPrompt(stack) {
      const rec = recommendAuth(stack);
      return `Add ${rec.provider} authentication to this ${stack.framework || stack.runtime || ''} app.\n\nRequirements:\n- Email/password signup and login\n- GitHub OAuth login\n- Session management with httpOnly cookies\n- Middleware to protect API routes (requireAuth)\n- Frontend: login/signup pages, auth state hook, protected route wrapper\n- Store user sessions securely — no JWT in localStorage\n\nTech stack: ${stack.framework || 'Unknown framework'}, ${stack.runtime || 'Unknown runtime'}\n${stack.database ? `Database: ${stack.database}` : 'No database yet — you may need to add one first.'}\n\nRefer to the .context.md file in the auth directory for constraints and decisions.`;
    },
  },

  database: {
    title: 'Set Up Database',
    category: 'database',
    effort: 'medium',
    priority: 2,
    why: 'No database detected. Your app can\'t persist data between sessions or across users.',
    buildContextFile(stack) {
      const rec = recommendDatabase(stack);
      return `## owner\n@your-team\n\n## purpose\nDatabase layer for persistent storage. Handles schema definition, migrations, and data access.\n\n## constraints\n- Use ${rec.provider} as the database\n- All database access through a single module (no direct queries scattered across files)\n- Schema must be version-controlled (migrations or schema file)\n- Must handle connection pooling and graceful shutdown\n\n## decisions\n### Use ${rec.provider}\n${rec.rationale}\n\n## dependencies\nUpstream: none\nDownstream: auth, API routes, any feature that stores data\n\n## status\nStage: not started`;
    },
    buildPrompt(stack) {
      const rec = recommendDatabase(stack);
      return `Set up ${rec.provider} for this ${stack.framework || stack.runtime || ''} app.\n\nRequirements:\n- Schema definition with at least a users table\n- Migration system or schema file that can be version-controlled\n- Database client/connection module (single source of truth)\n- Connection pooling and graceful shutdown handling\n- Example queries for CRUD operations\n\nTech stack: ${stack.framework || 'Unknown'}, ${stack.runtime || 'Unknown'}\n\nRefer to the .context.md file in the database directory for constraints.`;
    },
  },

  errorHandling: {
    title: 'Add Error Handling',
    category: 'errorHandling',
    effort: 'small',
    priority: 3,
    why: 'No global error handling found. Unhandled errors will crash your app or show cryptic messages to users.',
    buildContextFile(stack) {
      return `## owner\n@your-team\n\n## purpose\nGlobal error handling strategy. Catches unhandled errors, returns structured responses, and prevents crashes.\n\n## constraints\n- API errors must return JSON with { error, code } format\n- Never expose stack traces or internal details to users in production\n- Frontend must have an error boundary that shows a friendly message\n- All async operations must have try/catch\n- Log errors with enough context to debug\n\n## decisions\n### Centralized error handler middleware\nAll Express errors flow through a single error handler. Custom AppError class for typed errors.\n\n## status\nStage: not started`;
    },
    buildPrompt(stack) {
      return `Add global error handling to this ${stack.framework || stack.runtime || ''} app.\n\nRequirements:\n- Custom AppError class with statusCode and error code\n- Express error handler middleware (catches all errors)\n- API responses: { error: "message", code: "ERROR_CODE" }\n- Frontend: React error boundary component\n- Never expose stack traces in production\n- Log errors with request context\n\nRefer to the .context.md file for constraints.`;
    },
  },

  envConfig: {
    title: 'Create Environment Config',
    category: 'envConfig',
    effort: 'small',
    priority: 4,
    why: 'No .env.example found. Other developers (and AI tools) won\'t know what environment variables are needed.',
    buildContextFile(stack) {
      return `## owner\n@your-team\n\n## purpose\nEnvironment configuration. Documents all required and optional environment variables.\n\n## constraints\n- Never commit .env files with secrets to git\n- Always provide .env.example with placeholder values\n- All env vars must have defaults or clear error messages when missing\n- Validate required env vars at startup\n\n## status\nStage: not started`;
    },
    buildPrompt(stack) {
      return `Create environment configuration for this ${stack.framework || stack.runtime || ''} app.\n\nRequirements:\n- Create .env.example with all required variables and placeholder values\n- Add .env to .gitignore (if not already)\n- Add startup validation: check required vars exist, warn about optional ones\n- Document each variable with a comment explaining what it's for\n- Group variables: Required, Optional, Feature Flags`;
    },
  },

  deployment: {
    title: 'Add Deployment Config',
    category: 'deployment',
    effort: 'small',
    priority: 5,
    why: 'No deployment configuration found. Your app can\'t be deployed to production without this.',
    buildContextFile(stack) {
      return `## owner\n@your-team\n\n## purpose\nDeployment configuration. Defines how the app is built and deployed to production.\n\n## constraints\n- Must work with a single command or click\n- Build output must be deterministic\n- Environment variables must be configurable per environment\n- Health check endpoint required\n\n## decisions\n### Deploy via Takeoff\nOne-click deploy handles build detection, environment setup, and hosting.\n\n## status\nStage: not started — use Takeoff's Deploy button to set this up automatically`;
    },
    buildPrompt(stack) {
      return `This app is ready to deploy. Use Takeoff's Deploy button to deploy automatically, or manually add:\n\n- Dockerfile or platform config (vercel.json, railway.toml, etc.)\n- Health check endpoint (GET /health returning 200)\n- Build command in package.json scripts\n- Start command for production\n\nTakeoff will auto-detect your ${stack.framework || 'app'} configuration.`;
    },
  },

  testing: {
    title: 'Add Tests',
    category: 'testing',
    effort: 'large',
    priority: 6,
    why: 'No test files found. Without tests, you can\'t safely change code or catch regressions.',
    buildContextFile(stack) {
      const runner = stack.runtime === 'python' ? 'pytest' : 'vitest';
      return `## owner\n@your-team\n\n## purpose\nAutomated testing. Ensures code works correctly and catches regressions when changes are made.\n\n## constraints\n- Use ${runner} as the test runner\n- Cover critical paths: auth, API endpoints, data mutations\n- Tests must run in CI before deploy\n- No tests that depend on external services without mocking\n\n## decisions\n### Start with integration tests for API routes\nUnit tests for utilities, integration tests for endpoints. E2E tests can come later.\n\n## status\nStage: not started`;
    },
    buildPrompt(stack) {
      const runner = stack.runtime === 'python' ? 'pytest' : 'vitest';
      return `Add automated testing to this ${stack.framework || stack.runtime || ''} app using ${runner}.\n\nRequirements:\n- Set up ${runner} with config file\n- Add test script to package.json\n- Write tests for at least 2 critical API routes\n- Write tests for at least 2 utility functions\n- Mock external services (database, APIs)\n- Add a test:ci script for CI environments`;
    },
  },
};

function recommendAuth(stack) {
  if (stack.framework === 'Next.js') return { provider: 'NextAuth.js', rationale: 'Native Next.js integration, supports multiple OAuth providers, handles sessions automatically.' };
  if (stack.database === 'Supabase') return { provider: 'Supabase Auth', rationale: 'Already using Supabase — use its built-in auth for zero additional dependencies.' };
  if (stack.database === 'Firebase') return { provider: 'Firebase Auth', rationale: 'Already using Firebase — use its built-in auth.' };
  if (stack.runtime === 'node') return { provider: 'Supabase Auth', rationale: 'Simple setup, handles OAuth + email auth, works with any Node framework.' };
  if (stack.runtime === 'python') return { provider: 'Auth0 or Supabase Auth', rationale: 'Both have good Python SDKs and handle the complexity of auth.' };
  return { provider: 'Supabase Auth', rationale: 'Low complexity, OAuth + email support out of the box.' };
}

function recommendDatabase(stack) {
  if (stack.framework === 'Next.js') return { provider: 'Prisma + PostgreSQL', rationale: 'Type-safe ORM, excellent Next.js integration, schema-driven development.' };
  if (stack.database === 'Supabase') return { provider: 'Supabase (PostgreSQL)', rationale: 'Already configured — Supabase provides a full Postgres database.' };
  if (stack.runtime === 'python') return { provider: 'SQLAlchemy + PostgreSQL', rationale: 'Industry standard for Python, great migration support with Alembic.' };
  if (stack.runtime === 'node') return { provider: 'Prisma + PostgreSQL', rationale: 'Type-safe, auto-generated client, schema file as source of truth.' };
  return { provider: 'PostgreSQL', rationale: 'Reliable, free tiers available, works with every runtime.' };
}

/**
 * Generate a production plan from readiness scoring results.
 *
 * @param {object} params
 * @param {object} params.categories - from scoreReadiness()
 * @param {object} params.stack - from analyzer
 * @param {object} params.gaps - from analyzer
 * @returns {object[]} ordered plan steps
 */
function generatePlan({ categories, stack, gaps }) {
  const steps = [];
  let stepNum = 0;

  const missingCategories = Object.entries(categories)
    .filter(([, cat]) => cat.status === 'missing')
    .map(([key]) => key);

  const orderedKeys = Object.keys(STEP_TEMPLATES)
    .filter((key) => missingCategories.includes(key))
    .sort((a, b) => STEP_TEMPLATES[a].priority - STEP_TEMPLATES[b].priority);

  for (const key of orderedKeys) {
    const template = STEP_TEMPLATES[key];
    stepNum++;
    steps.push({
      id: `step-${stepNum}`,
      stepNumber: stepNum,
      title: template.title,
      category: template.category,
      effort: template.effort,
      why: template.why,
      contextFile: template.buildContextFile(stack),
      cursorPrompt: template.buildPrompt(stack),
      status: 'todo',
    });
  }

  // Always add Deploy as final step
  stepNum++;
  steps.push({
    id: `step-${stepNum}`,
    stepNumber: stepNum,
    title: 'Deploy',
    category: 'deployment',
    effort: 'small',
    why: steps.length > 0
      ? 'Once you\'ve completed the steps above, deploy your production-ready app.'
      : 'Your app looks ready — deploy it to the world.',
    contextFile: null,
    cursorPrompt: null,
    status: 'todo',
    isDeploy: true,
  });

  return steps;
}

module.exports = { generatePlan, STEP_TEMPLATES };
