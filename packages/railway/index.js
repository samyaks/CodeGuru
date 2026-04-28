const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';

function getToken(overrideToken) {
  if (overrideToken) return overrideToken;
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) throw new Error('RAILWAY_API_TOKEN is not set');
  return token;
}

async function railwayFetch(query, variables = {}, token) {
  const res = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken(token)}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Railway API ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join('; ');
    const err = new Error(`Railway API error: ${messages}`);
    err.graphqlErrors = json.errors;
    throw err;
  }

  return json.data;
}

// ── Projects ──

async function createProject(name) {
  const data = await railwayFetch(
    `mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        name
        environments { edges { node { id name } } }
      }
    }`,
    { input: { name } }
  );
  const project = data.projectCreate;
  const envEdges = project.environments?.edges || [];
  const productionEnv = envEdges.find((e) => e.node.name === 'production')
    || envEdges[0];

  return {
    id: project.id,
    name: project.name,
    environmentId: productionEnv?.node?.id || null,
  };
}

async function deleteProject(projectId) {
  await railwayFetch(
    `mutation($id: String!) { projectDelete(id: $id) }`,
    { id: projectId }
  );
}

async function getProject(projectId, token) {
  const data = await railwayFetch(
    `query($id: String!) {
      project(id: $id) {
        id
        name
        services { edges { node { id name } } }
        environments { edges { node { id name } } }
      }
    }`,
    { id: projectId },
    token
  );
  return data.project;
}

// ── Services ──

async function createServiceFromRepo(projectId, repoFullName, branch = 'main') {
  const data = await railwayFetch(
    `mutation($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId,
        source: { repo: repoFullName },
        branch,
      },
    }
  );
  return data.serviceCreate;
}

async function connectServiceToRepo(serviceId, repoFullName, branch = 'main') {
  const data = await railwayFetch(
    `mutation($id: String!, $input: ServiceConnectInput!) {
      serviceConnect(id: $id, input: $input) { id }
    }`,
    { id: serviceId, input: { repo: repoFullName, branch } }
  );
  return data.serviceConnect;
}

async function deleteService(serviceId) {
  await railwayFetch(
    `mutation($id: String!) { serviceDelete(id: $id) }`,
    { id: serviceId }
  );
}

async function updateServiceInstance(serviceId, environmentId, settings) {
  const data = await railwayFetch(
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) 
    }`,
    { serviceId, environmentId, input: settings }
  );
  return data.serviceInstanceUpdate;
}

// ── Deployments ──

async function triggerDeploy(serviceId, environmentId) {
  const data = await railwayFetch(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId }
  );
  return data.serviceInstanceDeploy;
}

async function getDeployment(deploymentId, token) {
  const data = await railwayFetch(
    `query($id: String!) {
      deployment(id: $id) {
        id
        status
        createdAt
        updatedAt
        canRollback
        meta
      }
    }`,
    { id: deploymentId },
    token
  );
  return data.deployment;
}

async function getLatestDeployment(serviceId, environmentId, token) {
  const data = await railwayFetch(
    `query($input: DeploymentListInput!) {
      deployments(first: 1, input: $input) {
        edges {
          node {
            id
            status
            createdAt
            updatedAt
            canRollback
          }
        }
      }
    }`,
    { input: { serviceId, environmentId } },
    token
  );
  const edges = data.deployments?.edges || [];
  return edges.length > 0 ? edges[0].node : null;
}

async function listDeployments(serviceId, environmentId, first = 10, token) {
  const data = await railwayFetch(
    `query($first: Int!, $input: DeploymentListInput!) {
      deployments(first: $first, input: $input) {
        edges { node { id status createdAt updatedAt canRollback } }
      }
    }`,
    { first, input: { serviceId, environmentId } },
    token
  );
  return (data.deployments?.edges || []).map((e) => e.node);
}

async function getDeploymentLogs(deploymentId, { limit = 500 } = {}, token) {
  const data = await railwayFetch(
    `query($deploymentId: String!, $limit: Int) {
      deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
        timestamp
        message
        severity
      }
    }`,
    { deploymentId, limit },
    token
  );
  return data.deploymentLogs || [];
}

async function getBuildLogs(deploymentId, { limit = 500 } = {}, token) {
  const data = await railwayFetch(
    `query($deploymentId: String!, $limit: Int) {
      buildLogs(deploymentId: $deploymentId, limit: $limit) {
        timestamp
        message
      }
    }`,
    { deploymentId, limit },
    token
  );
  return data.buildLogs || [];
}

async function redeployDeployment(deploymentId) {
  const data = await railwayFetch(
    `mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }`,
    { id: deploymentId }
  );
  return data.deploymentRedeploy;
}

async function cancelDeployment(deploymentId) {
  await railwayFetch(
    `mutation($id: String!) { deploymentCancel(id: $id) }`,
    { id: deploymentId }
  );
}

// ── Variables ──

async function setVariables(projectId, serviceId, environmentId, variables) {
  await railwayFetch(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    { input: { projectId, serviceId, environmentId, variables } }
  );
}

async function getVariables(projectId, serviceId, environmentId) {
  const data = await railwayFetch(
    `query($projectId: String!, $serviceId: String!, $environmentId: String!) {
      variables(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { projectId, serviceId, environmentId }
  );
  return data.variables || {};
}

// ── Domains ──

async function addRailwayDomain(serviceId, environmentId) {
  const data = await railwayFetch(
    `mutation($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { domain }
    }`,
    { input: { serviceId, environmentId } }
  );
  return data.serviceDomainCreate.domain;
}

async function addCustomDomain(serviceId, environmentId, domain) {
  const data = await railwayFetch(
    `mutation($input: CustomDomainCreateInput!) {
      customDomainCreate(input: $input) {
        id
        domain
        status { dnsRecords { hostlabel type requiredValue } }
      }
    }`,
    { input: { serviceId, environmentId, domain } }
  );
  return data.customDomainCreate;
}

// ── OAuth-mode helpers ──

async function listProjects(token) {
  const data = await railwayFetch(
    `query {
      me {
        projects {
          edges {
            node {
              id
              name
              services {
                edges {
                  node {
                    id
                    name
                    repoTriggers {
                      edges {
                        node {
                          repository
                          branch
                        }
                      }
                    }
                  }
                }
              }
              environments {
                edges { node { id name } }
              }
            }
          }
        }
      }
    }`,
    {},
    token
  );

  const projects = (data?.me?.projects?.edges || []).map((edge) => {
    const node = edge.node;
    const services = (node.services?.edges || []).map((sEdge) => {
      const sNode = sEdge.node;
      const repos = (sNode.repoTriggers?.edges || []).map((r) => ({
        repository: r.node.repository,
        branch: r.node.branch,
      }));
      return { id: sNode.id, name: sNode.name, repos };
    });
    const envEdges = node.environments?.edges || [];
    const productionEnv = envEdges.find((e) => e.node.name === 'production') || envEdges[0];
    return {
      id: node.id,
      name: node.name,
      services,
      environmentId: productionEnv?.node?.id || null,
      environments: envEdges.map((e) => ({ id: e.node.id, name: e.node.name })),
    };
  });

  return projects;
}

function normalizeRepoName(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
}

async function findProjectByRepo(token, repoFullName) {
  const projects = await listProjects(token);
  const target = normalizeRepoName(repoFullName);
  for (const project of projects) {
    for (const service of project.services) {
      for (const repo of service.repos) {
        if (repo.repository && normalizeRepoName(repo.repository) === target) {
          return {
            project,
            service,
            environmentId: project.environmentId,
            branch: repo.branch || 'main',
          };
        }
      }
    }
  }
  return null;
}

const ACTIVE_DOMAIN_STATUSES = new Set(['ACTIVE', 'OK', 'VERIFIED', 'COMPLETE']);

async function getServiceDomains(projectId, serviceId, environmentId, token) {
  try {
    const data = await railwayFetch(
      `query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        domains(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          serviceDomains { domain }
          customDomains { domain status }
        }
      }`,
      { projectId, serviceId, environmentId },
      token
    );
    const serviceDomains = (data?.domains?.serviceDomains || []).map((d) => d.domain).filter(Boolean);
    const customDomains = (data?.domains?.customDomains || [])
      .filter((d) => !d.status || ACTIVE_DOMAIN_STATUSES.has(String(d.status).toUpperCase()))
      .map((d) => d.domain)
      .filter(Boolean);
    const allDomains = [...customDomains, ...serviceDomains];
    const primary = allDomains[0] || null;
    return {
      domain: primary,
      url: primary ? `https://${primary}` : null,
      allDomains,
    };
  } catch (err) {
    return { domain: null, url: null, allDomains: [] };
  }
}

// ── Polling helper ──

const TERMINAL_STATUSES = new Set([
  'SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED',
]);

const ACTIVE_STATUSES = new Set([
  'BUILDING', 'DEPLOYING', 'QUEUED', 'WAITING', 'INITIALIZING',
]);

async function pollDeploymentStatus(deploymentId, {
  intervalMs = 5000,
  timeoutMs = 300000,
  onStatus,
} = {}) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const deployment = await getDeployment(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    if (onStatus) onStatus(deployment);

    if (TERMINAL_STATUSES.has(deployment.status)) {
      return deployment;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Deployment ${deploymentId} timed out after ${timeoutMs}ms`);
}

// ── High-level deploy flow ──

async function deployFromRepo(repoFullName, {
  projectName,
  branch = 'main',
  variables = {},
  onProgress,
} = {}) {
  const send = onProgress || (() => {});

  send({ phase: 'creating-project', message: `Creating project: ${projectName || repoFullName}...` });
  const project = await createProject(projectName || repoFullName.replace('/', '-'));
  const environmentId = project.environmentId;

  send({ phase: 'creating-service', message: 'Connecting to GitHub repo...' });
  const service = await createServiceFromRepo(project.id, repoFullName, branch);

  if (variables && Object.keys(variables).length > 0) {
    send({ phase: 'setting-variables', message: `Setting ${Object.keys(variables).length} environment variables...` });
    await setVariables(project.id, service.id, environmentId, variables);
  }

  send({ phase: 'adding-domain', message: 'Generating URL...' });
  const domain = await addRailwayDomain(service.id, environmentId);

  send({ phase: 'deploying', message: 'Triggering deployment...' });

  // Railway auto-deploys when a service is connected to a repo.
  // Wait a moment then poll for the deployment.
  await new Promise((r) => setTimeout(r, 3000));

  const latestDeploy = await getLatestDeployment(service.id, environmentId);
  if (!latestDeploy) {
    // If no deployment exists yet, trigger one explicitly
    const deployId = await triggerDeploy(service.id, environmentId);
    send({ phase: 'building', message: 'Building your app...' });

    const final = await pollDeploymentStatus(deployId, {
      onStatus: (d) => {
        if (d.status === 'BUILDING') send({ phase: 'building', message: 'Building your app...' });
        if (d.status === 'DEPLOYING') send({ phase: 'deploying-live', message: 'Deploying to production...' });
      },
    });

    return {
      projectId: project.id,
      serviceId: service.id,
      environmentId,
      deploymentId: deployId,
      domain,
      url: `https://${domain}`,
      status: final.status,
    };
  }

  send({ phase: 'building', message: 'Building your app...' });
  const final = await pollDeploymentStatus(latestDeploy.id, {
    onStatus: (d) => {
      if (d.status === 'BUILDING') send({ phase: 'building', message: 'Building your app...' });
      if (d.status === 'DEPLOYING') send({ phase: 'deploying-live', message: 'Deploying to production...' });
    },
  });

  return {
    projectId: project.id,
    serviceId: service.id,
    environmentId,
    deploymentId: latestDeploy.id,
    domain,
    url: `https://${domain}`,
    status: final.status,
  };
}

module.exports = {
  // Projects
  createProject,
  deleteProject,
  getProject,

  // Services
  createServiceFromRepo,
  connectServiceToRepo,
  deleteService,
  updateServiceInstance,

  // Deployments
  triggerDeploy,
  getDeployment,
  getLatestDeployment,
  listDeployments,
  getDeploymentLogs,
  getBuildLogs,
  redeployDeployment,
  cancelDeployment,
  pollDeploymentStatus,

  // Variables
  setVariables,
  getVariables,

  // Domains
  addRailwayDomain,
  addCustomDomain,

  // ── OAuth-mode helpers ──
  listProjects,
  findProjectByRepo,
  getServiceDomains,

  // High-level
  deployFromRepo,

  // Constants
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
};
