const DEPLOY_PATTERNS = [
  { pattern: /^\.github\/workflows\/.*\.ya?ml$/, category: 'cicd', platform: 'GitHub Actions' },
  { pattern: /^\.gitlab-ci\.ya?ml$/, category: 'cicd', platform: 'GitLab CI' },
  { pattern: /^Jenkinsfile$/, category: 'cicd', platform: 'Jenkins' },
  { pattern: /^azure-pipelines\.ya?ml$/, category: 'cicd', platform: 'Azure DevOps' },
  { pattern: /^bitbucket-pipelines\.ya?ml$/, category: 'cicd', platform: 'Bitbucket Pipelines' },
  { pattern: /^\.circleci\/config\.ya?ml$/, category: 'cicd', platform: 'CircleCI' },
  { pattern: /^buildspec\.ya?ml$/, category: 'cicd', platform: 'AWS CodeBuild' },
  { pattern: /^cloudbuild\.ya?ml$/, category: 'cicd', platform: 'Google Cloud Build' },

  { pattern: /^vercel\.json$/, category: 'hosting', platform: 'Vercel' },
  { pattern: /^netlify\.toml$/, category: 'hosting', platform: 'Netlify' },
  { pattern: /^fly\.toml$/, category: 'hosting', platform: 'Fly.io' },
  { pattern: /^render\.ya?ml$/, category: 'hosting', platform: 'Render' },
  { pattern: /^railway\.json$/, category: 'hosting', platform: 'Railway' },
  { pattern: /^railway\.toml$/, category: 'hosting', platform: 'Railway' },
  { pattern: /^app\.ya?ml$/, category: 'hosting', platform: 'Google App Engine' },
  { pattern: /^Procfile$/, category: 'hosting', platform: 'Heroku' },
  { pattern: /^appspec\.ya?ml$/, category: 'hosting', platform: 'AWS CodeDeploy' },
  { pattern: /^\.elasticbeanstalk\//, category: 'hosting', platform: 'AWS Elastic Beanstalk' },
  { pattern: /^amplify\.ya?ml$/, category: 'hosting', platform: 'AWS Amplify' },
  { pattern: /^firebase\.json$/, category: 'hosting', platform: 'Firebase' },
  { pattern: /^\.firebaserc$/, category: 'hosting', platform: 'Firebase' },

  { pattern: /(?:^|\/)Dockerfile(?:\.\w+)?$/, category: 'containers', platform: 'Docker' },
  { pattern: /(?:^|\/)docker-compose\.ya?ml$/, category: 'containers', platform: 'Docker Compose' },
  { pattern: /^\.dockerignore$/, category: 'containers', platform: 'Docker' },

  { pattern: /\.tf$/, category: 'iac', platform: 'Terraform' },
  { pattern: /^serverless\.ya?ml$/, category: 'iac', platform: 'Serverless Framework' },
  { pattern: /^(?:k8s|kubernetes)\//, category: 'iac', platform: 'Kubernetes' },
  { pattern: /^Pulumi\.ya?ml$/, category: 'iac', platform: 'Pulumi' },
  { pattern: /^cdk\.json$/, category: 'iac', platform: 'AWS CDK' },
  { pattern: /^sam\.ya?ml$|^template\.ya?ml$/, category: 'iac', platform: 'AWS SAM' },
];

function detectDeploymentFiles(tree) {
  const result = { detected: false, cicd: [], hosting: [], containers: [], iac: [], allPaths: [] };
  const seen = new Set();

  for (const item of tree) {
    if (item.type !== 'blob') continue;
    for (const rule of DEPLOY_PATTERNS) {
      if (rule.pattern.test(item.path) && !seen.has(item.path)) {
        seen.add(item.path);
        result[rule.category].push({ path: item.path, platform: rule.platform });
        result.allPaths.push(item.path);
        result.detected = true;
      }
    }
  }

  return result;
}

function detectDeploymentInPR(filePaths) {
  const fakeTree = filePaths.map((p) => ({ path: p, type: 'blob' }));
  return detectDeploymentFiles(fakeTree);
}

module.exports = { detectDeploymentFiles, detectDeploymentInPR, DEPLOY_PATTERNS };
