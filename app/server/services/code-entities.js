/**
 * Extract structured code entities from analyzer output (codebaseModel).
 */
function extractCodeEntities(codebaseModel) {
  if (!codebaseModel) return [];
  const fileTree = codebaseModel.fileTree || [];
  const fileContents = codebaseModel.fileContents || {};
  const gaps = codebaseModel.gaps || {};
  const entities = [];

  const pagePatterns = [
    { re: /app\/(.+?)\/page\.(tsx?|jsx?)$/, framework: 'nextjs-app' },
    { re: /pages\/(.+?)\.(tsx?|jsx?)$/, framework: 'nextjs-pages' },
    { re: /src\/pages\/(.+?)\.(tsx?|jsx?)$/, framework: 'react-router' },
    { re: /src\/views\/(.+?)\.(vue)$/, framework: 'vue' },
    { re: /src\/routes\/(.+?)\.(svelte)$/, framework: 'svelte' },
  ];
  for (const filePath of fileTree) {
    for (const { re, framework } of pagePatterns) {
      const match = filePath.match(re);
      if (match) {
        const routePath = `/${match[1]
          .replace(/\/page$/, '')
          .replace(/\/index$/, '')
          .replace(/\[(.+?)\]/g, ':$1')}`;
        entities.push({
          id: `page:${routePath}`,
          type: 'page',
          key: routePath,
          label: routePath === '/' ? 'Landing page' : `${routePath.split('/').filter(Boolean).pop() || ''} page`,
          filePath,
          status: 'detected',
          module: null,
          metadata: { framework },
        });
        break;
      }
    }
  }

  const routePatterns = [
    /app\/api\/(.+?)\/route\.(ts|js)$/,
    /pages\/api\/(.+?)\.(ts|js)$/,
    /server\/routes?\/(.+?)\.(ts|js)$/,
    /api\/(.+?)\.(ts|js)$/,
  ];
  for (const filePath of fileTree) {
    for (const re of routePatterns) {
      const match = filePath.match(re);
      if (match) {
        const routePath = `/api/${match[1]}`;
        const content = fileContents[filePath] || '';
        const methods = [];
        if (/export\s+(async\s+)?function\s+GET/i.test(content) || /\.get\(/i.test(content)) methods.push('GET');
        if (/export\s+(async\s+)?function\s+POST/i.test(content) || /\.post\(/i.test(content)) methods.push('POST');
        if (/export\s+(async\s+)?function\s+PUT/i.test(content) || /\.put\(/i.test(content)) methods.push('PUT');
        if (/export\s+(async\s+)?function\s+DELETE/i.test(content) || /\.delete\(/i.test(content)) methods.push('DELETE');
        if (methods.length === 0) methods.push('*');

        // `fileContents` is the slim, budget-capped sample (~50 files
        // of full content), NOT the whole repo. When a route file is
        // outside that sample, `content` is the empty string and the
        // old `content.length < 200 → stub` rule fired on every
        // unselected route — producing a flood of bogus
        // "Finish <route>" synthetic gaps. Only stub when we actually
        // looked at the file AND it's short or has stub markers.
        const sampled = content.length > 0;
        const looksStub = sampled
          && (content.length < 200 || /todo|placeholder|stub|not.?implemented/i.test(content));

        for (const method of methods) {
          entities.push({
            id: `route:${method} ${routePath}`,
            type: 'route',
            key: `${method} ${routePath}`,
            label: `${method} ${routePath}`,
            filePath,
            status: looksStub ? 'stub' : 'detected',
            module: null,
            metadata: { method },
          });
        }
        break;
      }
    }
  }

  const componentDirs = ['components', 'src/components', 'app/components', 'lib/components'];
  for (const filePath of fileTree) {
    for (const dir of componentDirs) {
      if (filePath.startsWith(`${dir}/`) && /\.(tsx?|jsx?|vue|svelte)$/.test(filePath)) {
        const name = filePath.split('/').pop().replace(/\.(tsx?|jsx?|vue|svelte)$/, '');
        if (name.startsWith('_') || name === 'index') break;
        entities.push({
          id: `comp:${name}`,
          type: 'component',
          key: name,
          label: name,
          filePath,
          status: 'detected',
          module: null,
          metadata: {},
        });
        break;
      }
    }
  }

  const capMap = [
    { gapKey: 'auth', label: 'Authentication', module: 'auth' },
    { gapKey: 'database', label: 'Database', module: 'database' },
    { gapKey: 'deployment', label: 'Deployment', module: 'deploy' },
    { gapKey: 'testing', label: 'Testing', module: null },
    { gapKey: 'envConfig', label: 'Environment Config', module: null },
    { gapKey: 'errorHandling', label: 'Error Handling', module: null },
  ];
  // Status threshold mirrors `capability-detectors/*.js`: ≥0.7
  // confidence flips a capability from 'partial' to 'present', so we
  // adopt the same line for 'full' here. The legacy
  // `hasSchema || provider` rule was missing fields the new detectors
  // don't populate (`platform`, `hasGlobalHandler`, `hasRoles`, …)
  // and silently collapsed every capability to 'partial', which is
  // what produced the flood of "Finish <Capability>" synthetic gaps.
  const FULL_CONFIDENCE = 0.7;
  for (const { gapKey, label, module } of capMap) {
    const gap = gaps[gapKey];
    let status;
    if (!gap || !gap.exists) status = 'none';
    else if ((gap.confidence ?? 0) >= FULL_CONFIDENCE) status = 'full';
    else status = 'partial';
    entities.push({
      id: `cap:${gapKey}`,
      type: 'capability',
      key: gapKey,
      label,
      filePath: null,
      status,
      module,
      metadata: { detail: (gap && (gap.provider || gap.platform || gap.type)) || '' },
    });
  }

  const extraCaps = [
    { key: 'payments', label: 'Payments', module: 'payments' },
    { key: 'email', label: 'Email', module: 'email' },
    { key: 'storage', label: 'File Storage', module: 'storage' },
  ];
  for (const { key, label, module } of extraCaps) {
    const hasPayments = fileTree.some((f) => /stripe|payment|checkout|billing/i.test(f));
    const hasEmail = fileTree.some((f) => /email|sendgrid|postmark|resend|mailgun/i.test(f));
    const hasStorage = fileTree.some((f) => /upload|storage|s3|cloudinary/i.test(f));
    const exists = key === 'payments' ? hasPayments : key === 'email' ? hasEmail : hasStorage;
    entities.push({
      id: `cap:${key}`,
      type: 'capability',
      key,
      label,
      filePath: null,
      status: exists ? 'partial' : 'none',
      module,
      metadata: {},
    });
  }

  for (const [filePath, content] of Object.entries(fileContents)) {
    if (filePath.includes('schema.prisma')) {
      const models = [...content.matchAll(/model\s+(\w+)\s*\{/g)];
      for (const m of models) {
        entities.push({
          id: `table:${m[1].toLowerCase()}`,
          type: 'table',
          key: m[1].toLowerCase(),
          label: m[1],
          filePath,
          status: 'detected',
          module: null,
          metadata: {},
        });
      }
    }
    if (/migration|schema\.sql/i.test(filePath)) {
      const tables = [...content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi)];
      for (const t of tables) {
        entities.push({
          id: `table:${t[1].toLowerCase()}`,
          type: 'table',
          key: t[1].toLowerCase(),
          label: t[1],
          filePath,
          status: 'detected',
          module: null,
          metadata: {},
        });
      }
    }
  }

  const seen = new Set();
  return entities.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

module.exports = { extractCodeEntities };
