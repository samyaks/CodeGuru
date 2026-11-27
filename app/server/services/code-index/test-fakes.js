'use strict';

// Test helpers for the code index: a tarball writer, an in-memory store with
// the same API as db.codeIndex, and a fake GitHub client over in-memory
// commits. Used only by tests.

const zlib = require('zlib');
const crypto = require('crypto');
const { Readable } = require('stream');

function header({ name, size = 0, type = '0', prefix = '' }) {
  const h = Buffer.alloc(512, 0);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  if (prefix) h.write(prefix, 345);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += h[i];
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

function pad(buf) {
  const extra = (512 - (buf.length % 512)) % 512;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra)]) : buf;
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body);
  let total = len + String(len).length;
  if (String(total).length !== String(len).length) total = len + String(total).length;
  return Buffer.from(`${total}${body}`);
}

/**
 * entries: [{ path, data (string|Buffer), type?, long?: 'pax'|'gnu', link? }]
 * Every path is put under `root/` (like GitHub's owner-repo-sha/).
 */
function makeTar(entries, { root = 'acme-web-abc123', globalPax = true } = {}) {
  const out = [];
  if (globalPax) {
    const g = paxRecord('comment', 'abc123');
    out.push(header({ name: 'pax_global_header', size: g.length, type: 'g' }), pad(g));
  }
  out.push(header({ name: `${root}/`, type: '5' }));
  for (const e of entries) {
    const full = `${root}/${e.path}`;
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data == null ? '' : String(e.data));
    if (e.type === 'dir') { out.push(header({ name: `${full}/`, type: '5' })); continue; }
    if (e.type === 'symlink') { out.push(header({ name: full, type: '2' })); continue; }
    let name = full;
    let prefix = '';
    if (e.long === 'pax') {
      const rec = paxRecord('path', full);
      out.push(header({ name: 'PaxHeader', size: rec.length, type: 'x' }), pad(rec));
      name = full.slice(0, 99);
    } else if (e.long === 'gnu') {
      const rec = Buffer.from(`${full}\0`);
      out.push(header({ name: '././@LongLink', size: rec.length, type: 'L' }), pad(rec));
      name = full.slice(0, 99);
    } else if (e.long === 'prefix') {
      const cut = full.lastIndexOf('/', 154);
      prefix = full.slice(0, cut);
      name = full.slice(cut + 1);
    }
    out.push(header({ name, size: data.length, prefix }), pad(data));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}

function makeTarGz(entries, opts) {
  return zlib.gzipSync(makeTar(entries, opts));
}

function blobSha(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
}

/** A web-style Response around bytes. */
function response(bytes, { contentLength = true } = {}) {
  const headers = new Map(contentLength ? [['content-length', String(bytes.length)]] : []);
  return {
    ok: true,
    headers: { get: (k) => headers.get(k.toLowerCase()) || null },
    body: Readable.toWeb(Readable.from([bytes])),
    async arrayBuffer() { return bytes; },
  };
}

/**
 * Fake GitHub: commits is { sha: { files: { path: content }, parent?: sha } },
 * branches is { name: sha }. Counts every call.
 */
function fakeGithub({ commits, branches, defaultBranch = 'main' }) {
  const calls = [];
  const ancestors = (sha) => {
    const out = new Set();
    let cur = sha;
    while (cur && commits[cur]) { out.add(cur); cur = commits[cur].parent; }
    return out;
  };
  const err = (status, message) => Object.assign(new Error(message), { status });
  const client = {
    calls,
    fail: null, // (name) => Error | null
    async fetchRepoMeta() { calls.push(['meta']); return { default_branch: defaultBranch, private: true }; },
    async fetchBranch(_o, _r, name) {
      calls.push(['branch', name]);
      if (client.fail && client.fail('branch')) throw client.fail('branch');
      if (!branches[name]) throw err(404, 'Branch not found');
      return { name, commit: { sha: branches[name] } };
    },
    async fetchTarball(_o, _r, sha) {
      calls.push(['tarball', sha]);
      if (client.fail && client.fail('tarball')) throw client.fail('tarball');
      const c = commits[sha];
      if (!c) throw err(404, 'Not Found');
      return response(makeTarGz(Object.entries(c.files).map(([path, data]) => ({ path, data }))));
    },
    async fetchCompare(_o, _r, base, head) {
      calls.push(['compare', base, head]);
      if (!commits[base] || !commits[head]) throw err(404, 'Not Found');
      if (base === head) return { status: 'identical', files: [] };
      const headAnc = ancestors(head);
      const baseAnc = ancestors(base);
      let status = 'diverged';
      if (headAnc.has(base)) status = 'ahead';
      else if (baseAnc.has(head)) status = 'behind';
      const a = commits[base].files;
      const b = commits[head].files;
      const files = [];
      const removed = Object.keys(a).filter((p) => !(p in b));
      const added = Object.keys(b).filter((p) => !(p in a));
      const renames = new Map();
      for (const r of removed) {
        const match = added.find((n) => !renames.has(n) && blobSha(b[n]) === blobSha(a[r]));
        if (match) renames.set(match, r);
      }
      for (const p of removed) if (![...renames.values()].includes(p)) files.push({ filename: p, status: 'removed', sha: blobSha(a[p]) });
      for (const p of Object.keys(b)) {
        if (renames.has(p)) files.push({ filename: p, previous_filename: renames.get(p), status: 'renamed', sha: blobSha(b[p]) });
        else if (!(p in a)) files.push({ filename: p, status: 'added', sha: blobSha(b[p]) });
        else if (blobSha(a[p]) !== blobSha(b[p])) files.push({ filename: p, status: 'modified', sha: blobSha(b[p]) });
      }
      return { status, files };
    },
    async fetchBlobRaw(_o, _r, sha) {
      calls.push(['blob', sha]);
      for (const c of Object.values(commits)) {
        for (const data of Object.values(c.files)) {
          if (blobSha(data) === sha) return response(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        }
      }
      throw err(404, 'Not Found');
    },
  };
  return client;
}

/** In-memory store with db.codeIndex's API. */
function memoryStore() {
  const repos = new Map();
  const files = new Map(); // projectId -> Map(path -> row)
  const symbols = new Map(); // projectId -> Map(path -> [])
  const specs = new Map(); // projectId -> Map(path -> specs)
  const edges = new Map(); // projectId -> [[from,to]]
  let clock = 1;
  const tick = () => { clock += 1; return clock; };
  const leaseLost = () => Object.assign(new Error('code index lease lost'), { code: 'CODE_INDEX_LEASE_LOST' });
  const hold = (pid, token) => {
    const r = repos.get(pid);
    if (!r || r.lease_token !== token || !(r.lease_until > Date.now())) throw leaseLost();
    r.lease_until = Date.now() + 15 * 60 * 1000;
  };
  const fmap = (pid) => { if (!files.has(pid)) files.set(pid, new Map()); return files.get(pid); };
  const drop = (pid, p) => {
    fmap(pid).delete(p);
    symbols.get(pid)?.delete(p);
    specs.get(pid)?.delete(p);
    edges.set(pid, (edges.get(pid) || []).filter(([f]) => f !== p));
  };
  const store = {
    repos, files, symbols, specs, edges,
    async getRepo(pid) { const r = repos.get(pid); return r ? { ...r, lease_until: r.lease_until ? new Date(r.lease_until) : null } : null; },
    async now() { return tick(); },
    async claim(pid, { repo, token }) {
      const r = repos.get(pid);
      const lease = Date.now() + 15 * 60 * 1000;
      const now = tick();
      if (!r) {
        const row = {
          project_id: pid, repo: repo.toLowerCase(), branch: '', indexed_sha: null, status: 'building',
          lease_until: lease, lease_token: token, claimed_at: now, dirty_at: null, error: null,
          full_builds: 0, full_window_start: null, updated_at: new Date(),
        };
        repos.set(pid, row);
        return { ...row };
      }
      if (r.lease_until && r.lease_until > Date.now()) return null;
      Object.assign(r, { lease_until: lease, lease_token: token, claimed_at: now });
      return { ...r };
    },
    async renewLease(pid, token) { hold(pid, token); },
    async setBuilding(pid, token, { repo, branch }) {
      hold(pid, token);
      Object.assign(repos.get(pid), { status: 'building', error: null, repo: repo.toLowerCase(), branch, indexed_sha: null });
    },
    async release(pid, token, { status, indexedSha = null, error = null, attempt = false }) {
      const r = repos.get(pid);
      if (!r || r.lease_token !== token) return { ok: false, dirty: false };
      const fm = fmap(pid);
      const dirty = r.dirty_at != null && r.dirty_at >= r.claimed_at;
      const day = 24 * 60 * 60 * 1000;
      if (attempt) {
        const inWindow = r.full_window_start && Date.now() - r.full_window_start < day;
        r.full_builds = inWindow ? (r.full_builds || 0) + 1 : 1;
        if (!inWindow) r.full_window_start = Date.now();
      }
      Object.assign(r, {
        lease_until: null, lease_token: null, error,
        status: status === 'ready' && dirty ? 'behind' : status,
        indexed_sha: indexedSha || r.indexed_sha,
        file_count: fm.size,
        text_bytes: [...fm.values()].reduce((n, f) => n + (f.content ? Buffer.byteLength(f.content) : 0), 0),
        last_checked_at: tick(),
        updated_at: new Date(),
      });
      return { ok: true, dirty };
    },
    async counts(pid) {
      const fm = fmap(pid);
      return { files: fm.size, textBytes: [...fm.values()].reduce((n, f) => n + (f.content ? Buffer.byteLength(f.content) : 0), 0) };
    },
    async markBehind(pid) {
      const r = repos.get(pid);
      if (!r) return false;
      r.dirty_at = tick();
      if (r.status === 'ready') r.status = 'behind';
      return !!(r.lease_until && r.lease_until > Date.now());
    },
    async upsertFiles(pid, token, list) {
      hold(pid, token);
      const fm = fmap(pid);
      if (!symbols.has(pid)) symbols.set(pid, new Map());
      if (!specs.has(pid)) specs.set(pid, new Map());
      const t = tick();
      for (const f of list) {
        fm.set(f.path, {
          path: f.path, blob_sha: f.blobSha || null, size_bytes: f.sizeBytes, language: f.language,
          content: f.content, skipped_reason: f.skippedReason, redactions: f.redactions, updated_at: t,
        });
        symbols.get(pid).set(f.path, f.symbols || []);
        if (f.specs) specs.get(pid).set(f.path, f.specs); else specs.get(pid).delete(f.path);
      }
    },
    async deletePaths(pid, token, paths) { hold(pid, token); let n = 0; for (const p of paths) { if (fmap(pid).has(p)) n += 1; drop(pid, p); } return n; },
    async sweepOlderThan(pid, token, before) {
      hold(pid, token);
      let n = 0;
      for (const [p, f] of [...fmap(pid)]) if (f.updated_at < before) { drop(pid, p); n += 1; }
      return n;
    },
    async clearFiles(pid, token) { hold(pid, token); for (const p of [...fmap(pid).keys()]) drop(pid, p); },
    async listPaths(pid) { return new Set(fmap(pid).keys()); },
    async blobShas(pid, paths) { const fm = fmap(pid); return new Map(paths.filter((p) => fm.has(p)).map((p) => [p, fm.get(p).blob_sha])); },
    async listSpecs(pid) { return new Map(specs.get(pid) || []); },
    async replaceEdges(pid, token, list) {
      hold(pid, token);
      const fm = fmap(pid);
      edges.set(pid, list.filter(([a, b]) => fm.has(a) && fm.has(b)));
    },
    async deleteForProject(pid) { const had = repos.delete(pid); files.delete(pid); symbols.delete(pid); specs.delete(pid); edges.delete(pid); return had ? 1 : 0; },
    async listForHeal() { return [...repos.values()].filter((r) => r.status !== 'too_large').map((r) => ({ ...r })); },
    async status(pid) { return repos.get(pid) || null; },
    /** What the index holds for a project, comparable between two builds. */
    snapshot(pid) {
      const fm = fmap(pid);
      const out = {};
      for (const p of [...fm.keys()].sort()) {
        const f = fm.get(p);
        out[p] = { content: f.content, skipped: f.skipped_reason, symbols: (symbols.get(pid)?.get(p) || []).map((s) => `${s.kind}:${s.symbol}:${s.line}`) };
      }
      return { files: out, edges: [...(edges.get(pid) || [])].map((e) => e.join('>')).sort() };
    },
  };
  return store;
}

module.exports = { makeTar, makeTarGz, blobSha, response, fakeGithub, memoryStore, paxRecord };
