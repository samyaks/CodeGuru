/**
 * Every package.json the analyzer read, not just the root one.
 *
 * Monorepos and apps kept in a subfolder (`app/`, `apps/web/`, `packages/*`)
 * declare their real dependencies below the root; reading only the root
 * `package.json` left stack and capability detection blind on them (no
 * framework, no database, no auth — and "Add user authentication" on an app
 * that uses Clerk from `apps/web/package.json`).
 */

// Example, fixture and template apps declare dependencies the product itself
// doesn't use, so they don't count toward its stack.
const IGNORED_DIRS = new Set([
  'node_modules',
  'example', 'examples',
  'fixture', 'fixtures', '__fixtures__', '__mocks__',
  'template', 'templates',
]);

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function isPackageManifest(filePath) {
  const parts = String(filePath).split('/');
  if (parts[parts.length - 1] !== 'package.json') return false;
  return !parts.slice(0, -1).some((dir) => IGNORED_DIRS.has(dir));
}

/**
 * Parseable package.json files, root first, then shallowest.
 * @returns {Array<{path: string, pkg: object}>}
 */
function listPackageManifests(fileContents) {
  const manifests = [];
  for (const [path, content] of Object.entries(fileContents || {})) {
    if (!isPackageManifest(path)) continue;
    const pkg = safeJson(content);
    if (pkg && typeof pkg === 'object') manifests.push({ path, pkg });
  }
  const depth = (p) => p.split('/').length;
  return manifests.sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
}

/**
 * dependencies + devDependencies merged across every manifest, plus the
 * manifest that declares each one (the shallowest, when several do) so
 * evidence can cite the real file.
 *
 * @returns {{
 *   deps: Object<string, string>,
 *   depFiles: Object<string, string>,
 *   manifests: Array<{path: string, pkg: object}>,
 * }}
 */
function collectPackageDeps(fileContents) {
  const manifests = listPackageManifests(fileContents);
  const deps = {};
  const depFiles = {};
  for (const { path, pkg } of manifests) {
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (Object.prototype.hasOwnProperty.call(deps, name)) continue;
      deps[name] = version;
      depFiles[name] = path;
    }
  }
  return { deps, depFiles, manifests };
}

module.exports = { collectPackageDeps, listPackageManifests, isPackageManifest };
