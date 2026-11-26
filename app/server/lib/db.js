const { Pool } = require('pg');
const crypto = require('crypto');

// ── Connection & pool ─────────────────────────────────────────────

let pool;

function describeDbUrl(connectionString) {
  try {
    const u = new URL(connectionString);
    const direct = /\.supabase\.co$/.test(u.hostname);
    const pooler = /\.pooler\.supabase\.com$/.test(u.hostname);
    return {
      host: u.hostname,
      port: u.port,
      user: u.username,
      database: (u.pathname || '/').replace(/^\//, ''),
      kind: direct ? 'DIRECT (IPv6-only — will fail on Railway)'
        : pooler ? 'POOLER (IPv4 — Railway-compatible)'
        : 'OTHER',
    };
  } catch (_e) {
    return { host: '<unparseable>', port: '?', user: '?', database: '?', kind: 'UNPARSEABLE' };
  }
}

function getDb() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — cannot connect to Postgres');
  }
  const info = describeDbUrl(connectionString);
  console.log(
    `[db] Initializing pg pool: host=${info.host} port=${info.port} user=${info.user} database=${info.database} kind=${info.kind}`
  );
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => {
    console.error('Unexpected pg pool error:', err);
  });
  return pool;
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function withTransaction(fn) {
  const client = await getDb().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// ── JSONB / boolean helpers ────────────────────────────────────────
//
// Defensive: pg serializes JS objects/arrays into JSONB natively. But some
// callers still pre-stringify (legacy from the SQLite era). If we get a
// string, try to parse; if that fails, wrap under { raw } so the insert
// doesn't blow up on invalid JSONB literals. Remove the shim once every
// caller has been cleaned up.

// Serializes values for JSONB columns. Must return either `null` or a JSON-text
// string. We cannot return a JS array unchanged — pg-node would encode it as a
// Postgres array literal (`{a,b}`) which Postgres cannot parse as JSONB. We
// also can't return plain JS objects unchanged for consistency, so everything
// that isn't null/undefined gets serialized here.
function toJsonb(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch (_e) {
      console.warn('[db] toJsonb: received non-JSON string, wrapping in { raw } shim');
      return JSON.stringify({ raw: value });
    }
  }
  return JSON.stringify(value);
}

function toBool(value) {
  if (value === undefined || value === null) return null;
  return !!value;
}

// Columns that are JSONB in the live schema. Used by dynamic update builders
// so we coerce only those fields through toJsonb. Everything else is passed
// through untouched.
// NOTE: features_summary was JSONB historically but is TEXT as of migration
// 004_schema_fixes.sql — the app writes free-form markdown, not JSON. Do NOT
// add it back to these sets or toJsonb will wrap the string in { raw: "..." }.
const DEPLOYMENTS_JSONB = new Set([
  'stack_info', 'build_plan', 'readiness_categories', 'plan_steps',
  'analysis_data', 'env_vars',
]);
const ANALYSES_JSONB = new Set(['analysis', 'context_files']);
const BUILD_ENTRIES_JSONB = new Set(['metadata']);

// ── Dynamic UPDATE helper ─────────────────────────────────────────

function buildUpdate(table, id, fields, { allowed, jsonb, boolCols } = {}) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    if (allowed && !allowed.has(key)) {
      console.warn(`[db] buildUpdate(${table}): ignoring unknown column "${key}"`);
      continue;
    }
    let v = value;
    if (jsonb && jsonb.has(key)) v = toJsonb(value);
    else if (boolCols && boolCols.has(key)) v = toBool(value);
    params.push(v);
    sets.push(`${key} = $${params.length}`);
  }
  if (sets.length === 0) return null;
  params.push(id);
  return {
    sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  };
}

// ── Reviews ───────────────────────────────────────────────────────

const reviews = {
  async create(review) {
    const params = [
      review.id,
      review.type,
      review.repo_url,
      review.owner,
      review.repo,
      review.pr_number ?? null,
      review.branch ?? null,
      review.status,
      review.created_at,
      review.user_id || null,
    ];
    await getDb().query(
      `INSERT INTO reviews (id, type, repo_url, owner, repo, pr_number, branch, status, created_at, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      params
    );
    return review;
  },
  async findById(id) {
    const { rows } = await getDb().query('SELECT * FROM reviews WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async list({ limit = 20, offset = 0, userId = null } = {}) {
    if (userId) {
      const { rows } = await getDb().query(
        'SELECT * FROM reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset]
      );
      return rows;
    }
    const { rows } = await getDb().query(
      'SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows;
  },
  async updateStatus(id, status, extra = {}) {
    const sets = [];
    const params = [];
    params.push(status);
    sets.push(`status = $${params.length}`);
    if (extra.ai_report !== undefined) {
      params.push(toJsonb(extra.ai_report));
      sets.push(`ai_report = $${params.length}`);
    }
    if (extra.error !== undefined) {
      params.push(extra.error);
      sets.push(`error = $${params.length}`);
    }
    if (status === 'completed') {
      params.push(new Date().toISOString());
      sets.push(`completed_at = $${params.length}`);
    }
    params.push(id);
    await getDb().query(
      `UPDATE reviews SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  },
  async updateHumanNotes(id, notes) {
    // human_notes remains TEXT in the schema
    const value = typeof notes === 'string' ? notes : JSON.stringify(notes);
    await getDb().query('UPDATE reviews SET human_notes = $1 WHERE id = $2', [value, id]);
  },
};

// ── Review Files ──────────────────────────────────────────────────

const reviewFiles = {
  async create(file) {
    await getDb().query(
      `INSERT INTO review_files (id, review_id, file_path, diff, ai_comments, severity)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        file.id,
        file.review_id,
        file.file_path,
        file.diff ?? null,
        toJsonb(file.ai_comments),
        file.severity ?? null,
      ]
    );
    return file;
  },
  async findByReviewId(reviewId) {
    const { rows } = await getDb().query(
      'SELECT * FROM review_files WHERE review_id = $1 ORDER BY file_path',
      [reviewId]
    );
    return rows;
  },
  async updateHumanComments(id, comments) {
    await getDb().query(
      'UPDATE review_files SET human_comments = $1 WHERE id = $2',
      [toJsonb(comments), id]
    );
  },
  async updateAiComments(id, comments, severity) {
    await getDb().query(
      'UPDATE review_files SET ai_comments = $1, severity = $2 WHERE id = $3',
      [toJsonb(comments), severity || null, id]
    );
  },
};

// ── Fix Prompts ───────────────────────────────────────────────────

const fixPrompts = {
  async create(prompt) {
    await getDb().query(
      `INSERT INTO fix_prompts (id, short_id, review_id, file_path, line_start, line_end,
        issue_category, issue_title, issue_description, severity, code_snippet,
        reference_file_path, reference_snippet, related_files, full_prompt, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        prompt.id,
        prompt.short_id,
        prompt.review_id,
        prompt.file_path,
        prompt.line_start ?? null,
        prompt.line_end ?? null,
        prompt.issue_category ?? null,
        prompt.issue_title,
        prompt.issue_description,
        prompt.severity ?? null,
        prompt.code_snippet ?? null,
        prompt.reference_file_path ?? null,
        prompt.reference_snippet ?? null,
        toJsonb(prompt.related_files ?? []),
        prompt.full_prompt,
        prompt.created_at,
        prompt.expires_at,
      ]
    );
    return prompt;
  },
  async findByShortId(shortId) {
    const { rows } = await getDb().query(
      'SELECT * FROM fix_prompts WHERE short_id = $1 AND expires_at > $2',
      [shortId, new Date().toISOString()]
    );
    return rows[0] || null;
  },
  async findByReviewId(reviewId) {
    const { rows } = await getDb().query(
      'SELECT * FROM fix_prompts WHERE review_id = $1 ORDER BY file_path, line_start',
      [reviewId]
    );
    return rows;
  },
  async shortIdExists(shortId) {
    const { rows } = await getDb().query(
      'SELECT 1 FROM fix_prompts WHERE short_id = $1',
      [shortId]
    );
    return rows.length > 0;
  },
};

// ── Fix Prompt Events ─────────────────────────────────────────────

const fixPromptEvents = {
  async create(event) {
    await getDb().query(
      `INSERT INTO fix_prompt_events (id, fix_prompt_id, event_type, deeplink_target, created_at)
        VALUES ($1, $2, $3, $4, $5)`,
      [
        event.id,
        event.fix_prompt_id,
        event.event_type,
        event.deeplink_target ?? null,
        event.created_at,
      ]
    );
    return event;
  },
};

// ── Deployments ───────────────────────────────────────────────────

const DEPLOYMENTS_ALLOWED_COLUMNS = new Set([
  'status', 'owner', 'repo', 'branch', 'framework', 'deploy_type', 'stack_info',
  'build_plan', 'readiness_score', 'readiness_categories', 'plan_steps',
  'recommendation', 'description', 'analysis_data', 'features_summary',
  'railway_project_id', 'railway_service_id', 'railway_environment_id',
  'railway_deployment_id', 'railway_domain', 'live_url', 'error', 'build_logs',
  'updated_at', 'deployed_at', 'user_id', 'slug', 'social_summary', 'env_vars',
  'suggestions_count', 'security_score', 'github_installation_id', 'repo_private',
]);

const deployments = {
  async create(deployment) {
    const d = {
      branch: 'main',
      user_id: null,
      ...deployment,
    };
    await getDb().query(
      `INSERT INTO deployments (id, user_id, repo_url, owner, repo, branch, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [d.id, d.user_id, d.repo_url, d.owner, d.repo, d.branch, d.status, d.created_at]
    );
    return deployment;
  },
  async findById(id) {
    const { rows } = await getDb().query('SELECT * FROM deployments WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async findBySlug(slug) {
    const { rows } = await getDb().query('SELECT * FROM deployments WHERE slug = $1', [slug]);
    return rows[0] || null;
  },
  /** Projects `userId` owns or is a member of, newest first. */
  async findByMember(userId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await getDb().query(
      `SELECT d.* FROM deployments d
        WHERE d.user_id = $1
           OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = d.id AND m.user_id = $1)
        ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },
  async findByUserId(userId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await getDb().query(
      'SELECT * FROM deployments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return rows;
  },
  async update(id, fields) {
    const built = buildUpdate('deployments', id, fields, {
      allowed: DEPLOYMENTS_ALLOWED_COLUMNS,
      jsonb: DEPLOYMENTS_JSONB,
    });
    if (!built) return;
    await getDb().query(built.sql, built.params);
  },
  async delete(id) {
    await getDb().query('DELETE FROM deployments WHERE id = $1', [id]);
  },
  async countUserDeployments(userId) {
    const { rows } = await getDb().query(
      `SELECT COUNT(*)::int AS count FROM deployments
        WHERE user_id = $1 AND status IN ('live', 'building', 'deploying')`,
      [userId]
    );
    return rows[0] ? rows[0].count : 0;
  },
  async countUserActiveBuilds(userId) {
    const { rows } = await getDb().query(
      `SELECT COUNT(*)::int AS count FROM deployments
        WHERE user_id = $1 AND status IN ('building', 'deploying')`,
      [userId]
    );
    return rows[0] ? rows[0].count : 0;
  },
  /** GitHub-linked projects only (excludes folder uploads). */
  async findByGithubRepo(owner, repo) {
    const { rows } = await getDb().query(
      `SELECT * FROM deployments
       WHERE LOWER(owner) = LOWER($1) AND LOWER(repo) = LOWER($2)
         AND repo_url NOT LIKE 'local://%'
       ORDER BY updated_at DESC NULLS LAST, created_at DESC`,
      [owner, repo]
    );
    return rows;
  },
};

// Projects stop reading through an installation that is gone or no longer covers their repo.
deployments.clearInstallation = async function clearInstallation(installationId) {
  const { rowCount } = await getDb().query(
    'UPDATE deployments SET github_installation_id = NULL WHERE github_installation_id = $1',
    [installationId]);
  return rowCount;
};
deployments.clearInstallationForRepos = async function clearInstallationForRepos(installationId, fullNames) {
  if (!fullNames.length) return 0;
  const { rowCount } = await getDb().query(
    `UPDATE deployments SET github_installation_id = NULL
      WHERE github_installation_id = $1 AND LOWER(owner || '/' || repo) = ANY($2::text[])`,
    [installationId, fullNames.map((n) => n.toLowerCase())]);
  return rowCount;
};

// ── GitHub App repo access ────────────────────────────────────────

const GRANT_UPSERT_SQL = `INSERT INTO github_repo_access
     (user_id, installation_id, repo_id, repo_full_name, private, account_login, github_user_id, granted_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, now())
   ON CONFLICT (user_id, repo_id) DO UPDATE SET
     installation_id = EXCLUDED.installation_id,
     repo_full_name = EXCLUDED.repo_full_name,
     private = EXCLUDED.private,
     account_login = EXCLUDED.account_login,
     github_user_id = EXCLUDED.github_user_id,
     granted_at = now()`;

const githubRepoAccess = {
  /** Replace everything a user can read via the app with a fresh listing. */
  async replaceForUser(userId, grants) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM github_repo_access WHERE user_id = $1', [userId]);
      for (const g of grants) {
        await client.query(GRANT_UPSERT_SQL,
          [userId, g.installationId, g.repoId, g.repoFullName, g.private, g.accountLogin, g.githubUserId ?? null]);
      }
    });
  },
  /** A GitHub user revoked their authorization of the app: drop what they granted. */
  async deleteForGithubUser(githubUserId) {
    const { rowCount } = await getDb().query(
      'DELETE FROM github_repo_access WHERE github_user_id = $1', [githubUserId]);
    return rowCount;
  },
  /** The app was uninstalled: nobody reads through this installation any more. */
  async deleteForInstallation(installationId) {
    const { rowCount } = await getDb().query(
      'DELETE FROM github_repo_access WHERE installation_id = $1', [installationId]);
    return rowCount;
  },
  /** Repos were removed from an installation. */
  async deleteForRepos(installationId, repoIds) {
    if (!repoIds.length) return 0;
    const { rowCount } = await getDb().query(
      'DELETE FROM github_repo_access WHERE installation_id = $1 AND repo_id = ANY($2::bigint[])',
      [installationId, repoIds]);
    return rowCount;
  },
  async findForUserRepo(userId, owner, repo) {
    const { rows } = await getDb().query(
      `SELECT * FROM github_repo_access
        WHERE user_id = $1 AND LOWER(repo_full_name) = LOWER($2)
        LIMIT 1`,
      [userId, `${owner}/${repo}`],
    );
    return rows[0] || null;
  },
  async listForUser(userId) {
    const { rows } = await getDb().query(
      `SELECT repo_full_name, private, account_login, granted_at
         FROM github_repo_access WHERE user_id = $1
        ORDER BY LOWER(repo_full_name)`,
      [userId],
    );
    return rows;
  },
};

// ── Commit reviews (webhook-triggered per push head) ──────────────

const commitReviews = {
  async create(row) {
    const {
      id, project_id, commit_sha, before_sha, ref, pusher_login, status = 'pending',
    } = row;
    const { rows } = await getDb().query(
      `INSERT INTO commit_reviews (id, project_id, commit_sha, before_sha, ref, pusher_login, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (project_id, commit_sha) DO NOTHING
       RETURNING id`,
      [id, project_id, commit_sha, before_sha || null, ref || null, pusher_login || null, status]
    );
    return rows[0] ? row : null; // null means a duplicate — already exists
  },
  async findByProjectAndSha(projectId, commitSha) {
    const { rows } = await getDb().query(
      'SELECT * FROM commit_reviews WHERE project_id = $1 AND commit_sha = $2',
      [projectId, commitSha]
    );
    return rows[0] || null;
  },
  async findById(id) {
    const { rows } = await getDb().query('SELECT * FROM commit_reviews WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async listByProject(projectId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await getDb().query(
      `SELECT id, project_id, commit_sha, before_sha, ref, pusher_login, status, error,
              created_at, completed_at,
              ai_report->>'summary' AS report_summary,
              ai_report->>'verdict' AS report_verdict,
              ai_report->'stats' AS report_stats
       FROM commit_reviews WHERE project_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [projectId, limit, offset]
    );
    return rows;
  },
  async resetToPending(id) {
    await getDb().query(
      `UPDATE commit_reviews
       SET status = 'pending', error = NULL, ai_report = NULL, completed_at = NULL
       WHERE id = $1`,
      [id]
    );
  },
  async markInProgress(id) {
    await getDb().query(
      `UPDATE commit_reviews SET status = 'in_progress', updated_at = now() WHERE id = $1`,
      [id]
    );
  },
  async markCompleted(id, aiReport) {
    await getDb().query(
      `UPDATE commit_reviews SET status = 'completed', ai_report = $2::jsonb, error = NULL, completed_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(aiReport)]
    );
  },
  async markFailed(id, errorMessage) {
    await getDb().query(
      `UPDATE commit_reviews SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`,
      [id, errorMessage]
    );
  },
  async resetStaleInProgress(olderThanMs = 10 * 60 * 1000) {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { rows } = await getDb().query(
      `UPDATE commit_reviews cr
       SET status = 'pending', error = 'recovered from stale in_progress',
           completed_at = NULL, updated_at = now()
       FROM deployments d
       WHERE cr.project_id = d.id
         AND cr.status = 'in_progress'
         AND COALESCE(cr.updated_at, cr.created_at) < $1
       RETURNING cr.id, cr.project_id, d.owner, d.repo, cr.commit_sha, cr.before_sha, cr.ref`,
      [cutoff]
    );
    return rows;
  },
};

// ── Build Entries ─────────────────────────────────────────────────

const BUILD_ENTRIES_ALLOWED = new Set([
  'title', 'content', 'metadata', 'is_public', 'updated_at', 'sort_order', 'entry_type',
  'source_commit_sha', 'approval_status',
]);
const BUILD_ENTRIES_BOOL = new Set(['is_public']);

const buildEntries = {
  async create(entry) {
    const prepared = {
      is_public: false,
      sort_order: 0,
      source_commit_sha: null,
      approval_status: null,
      ...entry,
    };
    await getDb().query(
      `INSERT INTO build_entries
        (id, project_id, user_id, entry_type, title, content, metadata, is_public,
         created_at, sort_order, source_commit_sha, approval_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        prepared.id,
        prepared.project_id,
        prepared.user_id,
        prepared.entry_type,
        prepared.title ?? null,
        prepared.content,
        toJsonb(prepared.metadata),
        toBool(prepared.is_public),
        prepared.created_at,
        prepared.sort_order ?? 0,
        prepared.source_commit_sha ?? null,
        prepared.approval_status ?? null,
      ]
    );
    return entry;
  },
  async findByProjectId(projectId, { limit = 100, offset = 0 } = {}) {
    const { rows } = await getDb().query(
      `SELECT * FROM build_entries WHERE project_id = $1
        ORDER BY sort_order ASC, created_at ASC LIMIT $2 OFFSET $3`,
      [projectId, limit, offset]
    );
    return rows;
  },
  async findPublicByProjectId(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM build_entries WHERE project_id = $1 AND is_public = TRUE
        ORDER BY sort_order ASC, created_at ASC`,
      [projectId]
    );
    return rows;
  },
  async findById(id) {
    const { rows } = await getDb().query('SELECT * FROM build_entries WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async findBySourceCommitSha(projectId, sha) {
    const { rows } = await getDb().query(
      `SELECT * FROM build_entries
         WHERE project_id = $1 AND source_commit_sha = $2
         ORDER BY created_at DESC LIMIT 1`,
      [projectId, sha]
    );
    return rows[0] || null;
  },
  async findPendingBySourceCommitSha(projectId, sha) {
    const { rows } = await getDb().query(
      `SELECT * FROM build_entries
         WHERE project_id = $1 AND source_commit_sha = $2 AND approval_status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
      [projectId, sha]
    );
    return rows[0] || null;
  },
  async update(id, fields) {
    const built = buildUpdate('build_entries', id, fields, {
      allowed: BUILD_ENTRIES_ALLOWED,
      jsonb: BUILD_ENTRIES_JSONB,
      boolCols: BUILD_ENTRIES_BOOL,
    });
    if (!built) return;
    await getDb().query(built.sql, built.params);
  },
  async delete(id) {
    await getDb().query('DELETE FROM build_entries WHERE id = $1', [id]);
  },
};

// ── Project Services ──────────────────────────────────────────────

const projectServices = {
  async create(data) {
    const id = crypto.randomUUID();
    await getDb().query(
      `INSERT INTO project_services (id, project_id, service_type, external_id, config)
        VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        data.project_id,
        data.service_type,
        data.external_id || null,
        toJsonb(data.config || {}),
      ]
    );
    return { id, ...data };
  },
  async findByProject(projectId) {
    const { rows } = await getDb().query(
      'SELECT * FROM project_services WHERE project_id = $1',
      [projectId]
    );
    return rows;
  },
  async findByProjectAndType(projectId, serviceType) {
    const { rows } = await getDb().query(
      'SELECT * FROM project_services WHERE project_id = $1 AND service_type = $2 LIMIT 1',
      [projectId, serviceType]
    );
    return rows[0] || null;
  },
  async update(id, data) {
    const sets = [];
    const params = [];
    if (data.external_id !== undefined) {
      params.push(data.external_id);
      sets.push(`external_id = $${params.length}`);
    }
    if (data.config !== undefined) {
      params.push(toJsonb(data.config));
      sets.push(`config = $${params.length}`);
    }
    if (data.synced_at !== undefined) {
      params.push(data.synced_at);
      sets.push(`synced_at = $${params.length}`);
    }
    if (sets.length === 0) return;
    params.push(id);
    await getDb().query(
      `UPDATE project_services SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  },
  async delete(id) {
    await getDb().query('DELETE FROM project_services WHERE id = $1', [id]);
  },
};

// ── Project Events (Analytics) ────────────────────────────────────

const projectEvents = {
  async create(event) {
    await getDb().query(
      `INSERT INTO project_events (id, project_id, event, path, referrer, device, session_id, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.id,
        event.project_id,
        event.event,
        event.path ?? null,
        event.referrer ?? null,
        event.device ?? null,
        event.session_id ?? null,
        toJsonb(event.metadata),
        event.created_at,
      ]
    );
    return event;
  },

  async createBatch(events) {
    if (!events || events.length === 0) return;
    await withTransaction(async (client) => {
      for (const row of events) {
        await client.query(
          `INSERT INTO project_events (id, project_id, event, path, referrer, device, session_id, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            row.id,
            row.project_id,
            row.event,
            row.path ?? null,
            row.referrer ?? null,
            row.device ?? null,
            row.session_id ?? null,
            toJsonb(row.metadata),
            row.created_at,
          ]
        );
      }
    });
  },

  async findByProjectId(projectId, { event, since, limit = 100 } = {}) {
    const conditions = ['project_id = $1'];
    const params = [projectId];
    if (event) { params.push(event); conditions.push(`event = $${params.length}`); }
    if (since) { params.push(since); conditions.push(`created_at >= $${params.length}`); }
    params.push(limit);
    const { rows } = await getDb().query(
      `SELECT * FROM project_events WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return rows;
  },

  async countByProject(projectId, { event, since } = {}) {
    const conditions = ['project_id = $1'];
    const params = [projectId];
    if (event) { params.push(event); conditions.push(`event = $${params.length}`); }
    if (since) { params.push(since); conditions.push(`created_at >= $${params.length}`); }
    const { rows } = await getDb().query(
      `SELECT COUNT(*)::int AS count FROM project_events WHERE ${conditions.join(' AND ')}`,
      params
    );
    return rows[0] ? rows[0].count : 0;
  },

  async aggregateByPath(projectId, { since } = {}) {
    const conditions = ['project_id = $1'];
    const params = [projectId];
    if (since) { params.push(since); conditions.push(`created_at >= $${params.length}`); }
    const { rows } = await getDb().query(
      `SELECT path, COUNT(*)::int AS count FROM project_events WHERE ${conditions.join(' AND ')}
        GROUP BY path ORDER BY count DESC`,
      params
    );
    return rows;
  },

  async aggregateByReferrer(projectId, { since } = {}) {
    const conditions = ['project_id = $1'];
    const params = [projectId];
    if (since) { params.push(since); conditions.push(`created_at >= $${params.length}`); }
    const { rows } = await getDb().query(
      `SELECT referrer, COUNT(*)::int AS count FROM project_events WHERE ${conditions.join(' AND ')}
        GROUP BY referrer ORDER BY count DESC`,
      params
    );
    return rows;
  },

  async aggregateByEvent(projectId, { since } = {}) {
    const conditions = ['project_id = $1'];
    const params = [projectId];
    if (since) { params.push(since); conditions.push(`created_at >= $${params.length}`); }
    const { rows } = await getDb().query(
      `SELECT event, COUNT(*)::int AS count FROM project_events WHERE ${conditions.join(' AND ')}
        GROUP BY event ORDER BY count DESC`,
      params
    );
    return rows;
  },

  async uniqueSessions(projectId, { since } = {}) {
    const conditions = ['project_id = $1'];
    const params = [projectId];
    if (since) { params.push(since); conditions.push(`created_at >= $${params.length}`); }
    const { rows } = await getDb().query(
      `SELECT COUNT(DISTINCT session_id)::int AS count FROM project_events WHERE ${conditions.join(' AND ')}`,
      params
    );
    return rows[0] ? rows[0].count : 0;
  },

  async overviewStats(projectId, { today, week, month }) {
    const { rows } = await getDb().query(
      `SELECT
        COUNT(DISTINCT CASE WHEN created_at >= $1 THEN session_id END)::int AS visitors_today,
        COUNT(DISTINCT CASE WHEN created_at >= $2 THEN session_id END)::int AS visitors_week,
        COUNT(DISTINCT CASE WHEN created_at >= $3 THEN session_id END)::int AS visitors_month,
        SUM(CASE WHEN event = 'pageview' AND created_at >= $4 THEN 1 ELSE 0 END)::int AS pageviews_today,
        SUM(CASE WHEN event = 'pageview' AND created_at >= $5 THEN 1 ELSE 0 END)::int AS pageviews_week,
        SUM(CASE WHEN event = 'pageview' AND created_at >= $6 THEN 1 ELSE 0 END)::int AS pageviews_month
      FROM project_events
      WHERE project_id = $7`,
      [today, week, month, today, week, month, projectId]
    );
    const row = rows[0] || {};
    return {
      visitors: {
        today: row.visitors_today || 0,
        week: row.visitors_week || 0,
        month: row.visitors_month || 0,
      },
      pageviews: {
        today: row.pageviews_today || 0,
        week: row.pageviews_week || 0,
        month: row.pageviews_month || 0,
      },
    };
  },
};

// ── Suggestions ───────────────────────────────────────────────────

const suggestions = {
  async createBatch(items) {
    if (!items || items.length === 0) return;
    await withTransaction(async (client) => {
      for (const row of items) {
        const scopedId = row.project_id
          ? crypto.createHash('sha256').update(row.project_id + ':' + row.id).digest('hex').slice(0, 16)
          : row.id;
        await client.query(
          `INSERT INTO suggestions
            (id, project_id, type, category, priority, title, description, evidence, effort,
             cursor_prompt, affected_files, source, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO NOTHING`,
          [
            scopedId,
            row.project_id,
            row.type,
            row.category,
            row.priority,
            row.title,
            row.description,
            toJsonb(row.evidence ?? []),
            row.effort ?? null,
            row.cursor_prompt ?? null,
            toJsonb(row.affected_files ?? []),
            row.source,
            row.status || 'open',
            row.created_at || new Date().toISOString(),
          ]
        );
      }
    });
  },
  async findByProjectId(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM suggestions WHERE project_id = $1
        ORDER BY CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END, created_at DESC`,
      [projectId]
    );
    return rows;
  },
  async updateStatus(id, projectId, status) {
    await getDb().query(
      'UPDATE suggestions SET status = $1 WHERE id = $2 AND project_id = $3',
      [status, id, projectId]
    );
  },
  async deleteByProjectId(projectId) {
    await getDb().query('DELETE FROM suggestions WHERE project_id = $1', [projectId]);
  },

  // ── Triage snapshot / restore ─────────────────────────────────
  //
  // `runPipeline` does a full `DELETE FROM suggestions … project_id = …`
  // followed by `createBatch` on every run. That wipes every user-set
  // v2 column (`v2_status`, reject reason, refined-from link, job
  // links, verification, refined cursor prompt). For re-analyses this
  // is unacceptable — the user's accept/reject/ship decisions are
  // their most precious state.
  //
  // These helpers let callers snapshot triage before the delete and
  // restore it onto the freshly-inserted rows. They work because all
  // three suggestion sources (static rules, AI suggestions, security
  // detectors) emit content-stable ids (sha256 of project_id +
  // rule/finding key, see services/suggestion-rules.js:5,
  // services/suggestion-ai.js:135, services/security/persist.js:70).
  // A gap whose underlying signal still exists will return with the
  // same id and pick up the restored triage; a gap whose signal is
  // gone won't be re-inserted and the snapshot row is simply
  // discarded.

  // Capture every row whose v2 columns differ from defaults. Rows
  // still on the untriaged-default-empty profile aren't snapshotted —
  // we don't need to "restore" `v2_status='untriaged'` onto a fresh
  // insert that already defaults to that value.
  async snapshotV2Triage(projectId) {
    const { rows } = await getDb().query(
      `SELECT id, v2_status, v2_rejected_reason, v2_committed_at,
              v2_refined_from_id, v2_job_links, verification, cursor_prompt
         FROM suggestions
        WHERE project_id = $1
          AND (v2_status <> 'untriaged'
               OR v2_refined_from_id IS NOT NULL
               OR v2_job_links IS NOT NULL
               OR verification IS NOT NULL)`,
      [projectId]
    );
    return rows;
  },

  // Apply each snapshot row's triage fields onto the suggestion that
  // shares its id. Rows whose id no longer exists (signal gone) are
  // silently skipped — they're not errors.
  //
  // `cursor_prompt` is only restored when the snapshot carried user-
  // touched intent — i.e. (a) the row was actively triaged
  // (status != untriaged) OR (b) the row was refined
  // (v2_refined_from_id IS NOT NULL — refineV2Gap sets that flag and
  // resets v2_status back to 'untriaged'). For genuinely fresh
  // untriaged rows we want the new pipeline's prompt to win rather
  // than stomp it with an older one.
  //
  // Returns `{ restored, skipped }` so callers can log a meaningful
  // summary.
  async restoreV2Triage(projectId, snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return { restored: 0, skipped: 0 };
    }
    let restored = 0;
    let skipped = 0;
    await withTransaction(async (client) => {
      for (const snap of snapshots) {
        const wasTriaged = snap.v2_status && snap.v2_status !== 'untriaged';
        const wasRefined = snap.v2_refined_from_id != null;
        const restoreCursorPrompt = (wasTriaged || wasRefined) && snap.cursor_prompt != null;
        const sets = [
          'v2_status = $1',
          'v2_rejected_reason = $2',
          'v2_committed_at = $3',
          'v2_refined_from_id = $4',
          'v2_job_links = $5::jsonb',
          'verification = $6',
        ];
        const params = [
          snap.v2_status ?? 'untriaged',
          snap.v2_rejected_reason ?? null,
          snap.v2_committed_at ?? null,
          snap.v2_refined_from_id ?? null,
          toJsonb(snap.v2_job_links ?? null),
          snap.verification ?? null,
        ];
        if (restoreCursorPrompt) {
          sets.push(`cursor_prompt = $${params.length + 1}`);
          params.push(snap.cursor_prompt);
        }
        params.push(snap.id, projectId);
        const { rowCount } = await client.query(
          `UPDATE suggestions SET ${sets.join(', ')}
             WHERE id = $${params.length - 1} AND project_id = $${params.length}`,
          params
        );
        if (rowCount > 0) restored += 1;
        else skipped += 1;
      }
    });
    return { restored, skipped };
  },
  async countByProjectId(projectId) {
    const { rows } = await getDb().query(
      `SELECT COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END), 0)::int AS critical,
        COALESCE(SUM(CASE WHEN priority = 'high'     THEN 1 ELSE 0 END), 0)::int AS high,
        COALESCE(SUM(CASE WHEN priority = 'medium'   THEN 1 ELSE 0 END), 0)::int AS medium,
        COALESCE(SUM(CASE WHEN priority = 'low'      THEN 1 ELSE 0 END), 0)::int AS low
        FROM suggestions WHERE project_id = $1 AND status = 'open'`,
      [projectId]
    );
    return rows[0] || { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
  },
  async summary(projectId) {
    const { rows } = await getDb().query(
      `SELECT type, COUNT(*)::int AS count FROM suggestions
        WHERE project_id = $1 AND status = 'open' GROUP BY type`,
      [projectId]
    );
    const byType = {};
    for (const r of rows) byType[r.type] = r.count;
    const counts = await this.countByProjectId(projectId);
    return {
      total: counts.total,
      byType,
      byPriority: {
        critical: counts.critical,
        high: counts.high,
        medium: counts.medium,
        low: counts.low,
      },
    };
  },

  // ── v2 (Gap) methods ───────────────────────────────────────────
  // These all read/write the suggestions table but use the v2_* columns added
  // by migration 010_v2_gap_fields.sql so v1 endpoints keep working.

  async findOpenCardGapsByProjectIds(projectIds, { perProject = 3 } = {}) {
    if (!projectIds.length) return { itemsByProject: new Map(), counts: new Map() };
    const placeholders = projectIds.map((_, i) => `$${i + 1}`).join(', ');
    const openWhere = `
      project_id IN (${placeholders})
      AND COALESCE(v2_status, 'untriaged') NOT IN ('shipped', 'rejected')
      AND COALESCE(status, 'open') NOT IN ('done', 'dismissed')`;
    const [ranked, counted] = await Promise.all([
      getDb().query(
        `SELECT * FROM (
            SELECT s.*,
                   ROW_NUMBER() OVER (
                     PARTITION BY s.project_id
                     ORDER BY CASE s.priority
                       WHEN 'critical' THEN 0
                       WHEN 'high' THEN 1
                       WHEN 'medium' THEN 2
                       WHEN 'low' THEN 3
                       ELSE 4
                     END, s.created_at DESC
                   ) AS rn
              FROM suggestions s
             WHERE ${openWhere}
          ) ranked
          WHERE ranked.rn <= $${projectIds.length + 1}`,
        [...projectIds, perProject]
      ),
      getDb().query(
        `SELECT project_id, COUNT(*)::int AS n
           FROM suggestions
          WHERE ${openWhere}
          GROUP BY project_id`,
        projectIds
      ),
    ]);
    const itemsByProject = new Map();
    for (const row of ranked.rows) {
      const list = itemsByProject.get(row.project_id) || [];
      list.push(row);
      itemsByProject.set(row.project_id, list);
    }
    const counts = new Map(counted.rows.map((r) => [r.project_id, r.n]));
    return { itemsByProject, counts };
  },

  async findV2GapsByProjectId(projectId, { v2Status } = {}) {
    const params = [projectId];
    let where = 'project_id = $1';
    if (v2Status) {
      params.push(v2Status);
      where += ` AND v2_status = $${params.length}`;
    }
    const { rows } = await getDb().query(
      `SELECT * FROM suggestions
        WHERE ${where}
        ORDER BY CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END, created_at DESC`,
      params
    );
    return rows;
  },

  async findV2GapById(id, projectId) {
    const { rows } = await getDb().query(
      'SELECT * FROM suggestions WHERE id = $1 AND project_id = $2',
      [id, projectId]
    );
    return rows[0] || null;
  },

  // Insert a single v2 gap (e.g. from the reopen flow or a security
  // detector) and return the row as actually stored. Like createBatch
  // this hashes the id with the project id so callers can't guess
  // sibling ids — but unlike createBatch it returns the inserted shape
  // so the caller can act on the real id.
  //
  // Security columns are accepted optionally. The DB constraint
  // suggestions_security_severity_consistency requires is_security and
  // security_severity to agree, so callers MUST pass both or neither.
  async createV2Gap(row) {
    if (!row || !row.project_id || !row.id) {
      throw new Error('createV2Gap: project_id and id required');
    }
    const scopedId = crypto
      .createHash('sha256')
      .update(`${row.project_id}:${row.id}`)
      .digest('hex')
      .slice(0, 16);
    const isSecurity = !!row.is_security;
    const severity = isSecurity ? (row.security_severity || null) : null;
    if (isSecurity && !severity) {
      throw new Error('createV2Gap: is_security=true requires security_severity');
    }
    const { rows } = await getDb().query(
      `INSERT INTO suggestions
        (id, project_id, type, category, priority, title, description,
         evidence, effort, cursor_prompt, affected_files, source, status,
         v2_status, v2_category, v2_refined_from_id,
         is_security, security_severity, cwe_id, security_detector,
         security_fingerprint, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (id) DO NOTHING
        RETURNING *`,
      [
        scopedId,
        row.project_id,
        row.type,
        row.category,
        row.priority,
        row.title,
        row.description,
        toJsonb(row.evidence ?? []),
        row.effort ?? null,
        row.cursor_prompt ?? null,
        toJsonb(row.affected_files ?? []),
        row.source,
        row.status || 'open',
        row.v2_status ?? 'untriaged',
        row.v2_category ?? null,
        row.v2_refined_from_id ?? null,
        isSecurity,
        severity,
        row.cwe_id ?? null,
        row.security_detector ?? null,
        row.security_fingerprint ?? null,
        row.created_at || new Date().toISOString(),
      ]
    );
    return rows[0] || null;
  },

  async setV2Status(id, projectId, v2Status, extra = {}) {
    const sets = ['v2_status = $1'];
    const params = [v2Status, id, projectId];
    let idx = 3;
    if (extra.rejectedReason !== undefined) {
      idx += 1;
      sets.push(`v2_rejected_reason = $${idx}`);
      params.push(extra.rejectedReason);
    }
    if (extra.committedAt !== undefined) {
      idx += 1;
      sets.push(`v2_committed_at = $${idx}`);
      params.push(extra.committedAt);
    }
    if (extra.verification !== undefined) {
      idx += 1;
      sets.push(`verification = $${idx}`);
      params.push(extra.verification);
    }
    const { rows } = await getDb().query(
      `UPDATE suggestions SET ${sets.join(', ')}
        WHERE id = $2 AND project_id = $3
        RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  async setCursorPrompt(id, projectId, cursorPrompt) {
    const { rows } = await getDb().query(
      `UPDATE suggestions SET cursor_prompt = $1
        WHERE id = $2 AND project_id = $3
        RETURNING *`,
      [cursorPrompt, id, projectId]
    );
    return rows[0] || null;
  },

  // gap-job linking (migration 013). v2_job_links is JSONB. `null` means
  // "not yet linked" (linker will pick it up). `[]` means "linked, no
  // jobs apply" — final until the next regenerate.
  async findUnlinkedV2GapsByProjectId(projectId, { limit = 100 } = {}) {
    const { rows } = await getDb().query(
      `SELECT * FROM suggestions
        WHERE project_id = $1 AND v2_job_links IS NULL
        ORDER BY created_at ASC
        LIMIT $2`,
      [projectId, limit]
    );
    return rows;
  },

  async setV2JobLinks(id, projectId, jobLinks) {
    const { rows } = await getDb().query(
      `UPDATE suggestions SET v2_job_links = $1::jsonb
        WHERE id = $2 AND project_id = $3
        RETURNING *`,
      [toJsonb(jobLinks ?? []), id, projectId]
    );
    return rows[0] || null;
  },

  // ── v2 security tagging (migration 014). The security feature treats
  // `is_security` as a lens on top of the existing category, never as a
  // fourth category. These helpers read/write that lens; the high-level
  // dedupe + upgrade logic lives in `services/security/persist.js`.

  // List unaddressed (untriaged or in_progress) security gaps for a
  // project, ordered by severity. Used by the score computation and the
  // /security-summary endpoint. `addressedToo: true` returns rejected /
  // shipped rows as well — only the report view ever needs that.
  async findV2SecurityGapsByProjectId(projectId, { addressedToo = false } = {}) {
    const params = [projectId];
    let where = 'project_id = $1 AND is_security = TRUE';
    if (!addressedToo) {
      where += ` AND v2_status IN ('untriaged', 'in_progress')`;
    }
    const { rows } = await getDb().query(
      `SELECT * FROM suggestions
        WHERE ${where}
        ORDER BY CASE security_severity
          WHEN 'critical' THEN 0
          WHEN 'high'     THEN 1
          WHEN 'medium'   THEN 2
          WHEN 'low'      THEN 3
          ELSE 4
        END, created_at DESC`,
      params
    );
    return rows;
  },

  // Look up an existing gap by its security fingerprint. The persistence
  // layer uses this both for "have we already flagged this?" (skip) and
  // as the input to the upgrade path (overlap an existing non-security
  // gap on file path before falling back to insert).
  async findV2GapByFingerprint(projectId, fingerprint) {
    if (!fingerprint) return null;
    const { rows } = await getDb().query(
      `SELECT * FROM suggestions
        WHERE project_id = $1 AND security_fingerprint = $2
        LIMIT 1`,
      [projectId, fingerprint]
    );
    return rows[0] || null;
  },

  // Upgrade an existing (typically non-security) gap to security, or
  // refresh detector metadata on a row that's already tagged. The DB
  // CHECK constraint requires is_security and severity to agree, so
  // we always set both. `severity` MUST be non-null.
  async applySecurityFlags(id, projectId, { severity, cweId, detector, fingerprint }) {
    if (!severity) {
      throw new Error('applySecurityFlags: severity is required');
    }
    const { rows } = await getDb().query(
      `UPDATE suggestions SET
          is_security          = TRUE,
          security_severity    = $1,
          cwe_id               = COALESCE($2, cwe_id),
          security_detector    = COALESCE($3, security_detector),
          security_fingerprint = COALESCE($4, security_fingerprint)
        WHERE id = $5 AND project_id = $6
        RETURNING *`,
      [severity, cweId ?? null, detector ?? null, fingerprint ?? null, id, projectId]
    );
    return rows[0] || null;
  },

  // Find a candidate gap to upgrade for a given finding, looking only at
  // rows that aren't already security-tagged. Match heuristic: any
  // overlap between the candidate's `affected_files` JSONB array and the
  // finding's file path. Returns the most-recently-created hit so the
  // upgrade lands on the freshest row.
  async findUpgradeCandidate(projectId, filePath) {
    if (!filePath) return null;
    const { rows } = await getDb().query(
      `SELECT * FROM suggestions
        WHERE project_id = $1
          AND is_security = FALSE
          AND v2_status IN ('untriaged', 'in_progress')
          AND affected_files @> $2::jsonb
        ORDER BY created_at DESC
        LIMIT 1`,
      [projectId, JSON.stringify([filePath])]
    );
    return rows[0] || null;
  },

  async refineV2Gap(id, projectId, { title, description, cursorPrompt, refinedFromId }) {
    const sets = [];
    const params = [];
    let idx = 0;
    if (title !== undefined) { idx += 1; sets.push(`title = $${idx}`); params.push(title); }
    if (description !== undefined) { idx += 1; sets.push(`description = $${idx}`); params.push(description); }
    if (cursorPrompt !== undefined) { idx += 1; sets.push(`cursor_prompt = $${idx}`); params.push(cursorPrompt); }
    if (refinedFromId !== undefined) {
      idx += 1; sets.push(`v2_refined_from_id = $${idx}`); params.push(refinedFromId);
    }
    // Refine always returns a gap to "untriaged"
    idx += 1; sets.push(`v2_status = $${idx}`); params.push('untriaged');

    if (sets.length === 0) return await this.findV2GapById(id, projectId);

    params.push(id, projectId);
    const idIdx = idx + 1;
    const projectIdx = idx + 2;
    const { rows } = await getDb().query(
      `UPDATE suggestions SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND project_id = $${projectIdx}
        RETURNING *`,
      params
    );
    return rows[0] || null;
  },
};

// ── Analyses ──────────────────────────────────────────────────────

const ANALYSES_ALLOWED_COLUMNS = new Set([
  'status', 'owner', 'repo', 'analysis', 'context_files', 'completion_pct', 'completed_at', 'user_id', 'features_summary',
  'file_count', 'tree_total_bytes', 'tree_estimated_tokens', 'tree_truncated',
  'ingested_file_count', 'ingested_bytes', 'ingested_tokens',
  'llm_call_count', 'llm_input_tokens', 'llm_output_tokens', 'llm_cost_usd',
  'railway_access_token', 'railway_refresh_token', 'railway_token_expires_at',
  'railway_project_id', 'railway_service_id', 'railway_environment_id',
]);
const ANALYSES_BOOL = new Set(['tree_truncated']);

const analyses = {
  async create(analysis) {
    await getDb().query(
      `INSERT INTO analyses (id, repo_url, owner, repo, status, created_at, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        analysis.id,
        analysis.repo_url,
        analysis.owner,
        analysis.repo,
        analysis.status,
        analysis.created_at,
        analysis.user_id || null,
      ]
    );
    return analysis;
  },
  async findById(id) {
    const { rows } = await getDb().query('SELECT * FROM analyses WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async list({ limit = 20, offset = 0, userId = null } = {}) {
    if (userId) {
      const { rows } = await getDb().query(
        'SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset]
      );
      return rows;
    }
    const { rows } = await getDb().query(
      'SELECT * FROM analyses ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows;
  },
  async update(id, fields) {
    const built = buildUpdate('analyses', id, fields, {
      allowed: ANALYSES_ALLOWED_COLUMNS,
      jsonb: ANALYSES_JSONB,
      boolCols: ANALYSES_BOOL,
    });
    if (!built) return;
    await getDb().query(built.sql, built.params);
  },
  async setTreeStats(id, { file_count, tree_total_bytes, tree_estimated_tokens, tree_truncated }) {
    await getDb().query(
      `UPDATE analyses SET file_count = $1, tree_total_bytes = $2, tree_estimated_tokens = $3, tree_truncated = $4
        WHERE id = $5`,
      [
        file_count == null ? null : file_count,
        tree_total_bytes == null ? null : tree_total_bytes,
        tree_estimated_tokens == null ? null : tree_estimated_tokens,
        tree_truncated == null ? false : !!tree_truncated,
        id,
      ]
    );
  },
  async incrementIngested(id, { files = 0, bytes = 0, tokens = 0 } = {}) {
    await getDb().query(
      `UPDATE analyses
        SET ingested_file_count = COALESCE(ingested_file_count, 0) + $1,
            ingested_bytes      = COALESCE(ingested_bytes, 0)      + $2,
            ingested_tokens     = COALESCE(ingested_tokens, 0)     + $3
        WHERE id = $4`,
      [files || 0, bytes || 0, tokens || 0, id]
    );
  },
  async incrementLlm(id, {
    calls = 1,
    input_tokens = 0,
    output_tokens = 0,
    cost_usd = 0,
    cache_creation_tokens = 0,
    cache_read_tokens = 0,
  } = {}) {
    await getDb().query(
      `UPDATE analyses
        SET llm_call_count             = COALESCE(llm_call_count, 0)             + $1,
            llm_input_tokens           = COALESCE(llm_input_tokens, 0)           + $2,
            llm_output_tokens          = COALESCE(llm_output_tokens, 0)          + $3,
            llm_cost_usd               = COALESCE(llm_cost_usd, 0)               + $4,
            llm_cache_creation_tokens  = COALESCE(llm_cache_creation_tokens, 0)  + $5,
            llm_cache_read_tokens      = COALESCE(llm_cache_read_tokens, 0)      + $6
        WHERE id = $7`,
      [
        calls || 0,
        input_tokens || 0,
        output_tokens || 0,
        cost_usd || 0,
        cache_creation_tokens || 0,
        cache_read_tokens || 0,
        id,
      ]
    );
  },
  async getRollups(id) {
    const { rows } = await getDb().query(
      `SELECT file_count, tree_total_bytes, tree_estimated_tokens, tree_truncated,
              ingested_file_count, ingested_bytes, ingested_tokens,
              llm_call_count, llm_input_tokens, llm_output_tokens, llm_cost_usd,
              llm_cache_creation_tokens, llm_cache_read_tokens
        FROM analyses WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },
};

// ── Analysis Files ────────────────────────────────────────────────

/**
 * Builds one UPDATE ... FROM (VALUES ...) statement for a chunk of tier
 * updates (see analysisFiles.bulkUpdateTiers for the row contract).
 * Pure function — exported for unit testing.
 */
function buildBulkTierUpdateChunk(analysisId, chunk) {
  const values = [];
  const tuples = chunk.map((u, idx) => {
    const base = idx * 8;
    values.push(
      u.path,
      u.tier ?? null,
      u.content ?? null,
      u.skeleton ?? null,
      u.content_tokens ?? null,
      u.skeleton_tokens ?? null,
      u.fetched_at ?? null,
      u.skip_reason ?? null
    );
    return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, `
      + `$${base + 5}::int, $${base + 6}::int, $${base + 7}::timestamptz, $${base + 8}::text)`;
  });
  values.push(analysisId);
  const analysisIdParam = `$${values.length}`;
  const sql =
    `UPDATE analysis_files af
        SET tier            = COALESCE(t.tier,            af.tier),
            content         = COALESCE(t.content,         af.content),
            skeleton        = COALESCE(t.skeleton,        af.skeleton),
            content_tokens  = COALESCE(t.content_tokens,  af.content_tokens),
            skeleton_tokens = COALESCE(t.skeleton_tokens, af.skeleton_tokens),
            fetched_at      = COALESCE(t.fetched_at,      af.fetched_at),
            skip_reason     = COALESCE(t.skip_reason,     af.skip_reason)
       FROM (VALUES ${tuples.join(', ')})
         AS t(path, tier, content, skeleton, content_tokens, skeleton_tokens, fetched_at, skip_reason)
      WHERE af.analysis_id = ${analysisIdParam}
        AND af.path = t.path`;
  return { sql, values };
}

const analysisFiles = {
  async upsert(row) {
    const id = crypto.randomUUID();
    const params = [
      id,
      row.analysis_id,
      row.path,
      row.sha ?? null,
      row.size_bytes ?? 0,
      row.language ?? null,
      row.score ?? null,
      row.depth ?? null,
      row.tier ?? 'tree',
      row.content ?? null,
      row.skeleton ?? null,
      row.content_tokens ?? null,
      row.skeleton_tokens ?? null,
      row.fetched_at ?? null,
      row.skip_reason ?? null,
    ];
    // RETURNING * returns the existing row's id on conflict — critical fix
    // for the "wrong id" bug flagged in prior review.
    const { rows } = await getDb().query(
      `INSERT INTO analysis_files
        (id, analysis_id, path, sha, size_bytes, language, score, depth, tier,
         content, skeleton, content_tokens, skeleton_tokens, fetched_at, skip_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (analysis_id, path) DO UPDATE SET
          tier            = COALESCE(EXCLUDED.tier,            analysis_files.tier),
          content         = COALESCE(EXCLUDED.content,         analysis_files.content),
          skeleton        = COALESCE(EXCLUDED.skeleton,        analysis_files.skeleton),
          content_tokens  = COALESCE(EXCLUDED.content_tokens,  analysis_files.content_tokens),
          skeleton_tokens = COALESCE(EXCLUDED.skeleton_tokens, analysis_files.skeleton_tokens),
          fetched_at      = COALESCE(EXCLUDED.fetched_at,      analysis_files.fetched_at),
          skip_reason     = COALESCE(EXCLUDED.skip_reason,     analysis_files.skip_reason),
          sha             = COALESCE(EXCLUDED.sha,             analysis_files.sha),
          size_bytes      = COALESCE(EXCLUDED.size_bytes,      analysis_files.size_bytes),
          language        = COALESCE(EXCLUDED.language,        analysis_files.language),
          score           = COALESCE(EXCLUDED.score,           analysis_files.score),
          depth           = COALESCE(EXCLUDED.depth,           analysis_files.depth)
        RETURNING *`,
      params
    );
    return rows[0];
  },

  async bulkInsertTreeRows(analysisId, rows) {
    if (!rows || rows.length === 0) return;
    const BATCH = 500;
    await withTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = [];
        const placeholders = chunk.map((r, idx) => {
          const base = idx * 10;
          values.push(
            crypto.randomUUID(),
            analysisId,
            r.path,
            r.sha ?? null,
            r.size_bytes ?? 0,
            r.language ?? null,
            r.score ?? null,
            r.depth ?? null,
            r.inbound_degree ?? 0,
            r.outbound_degree ?? 0
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        });
        await client.query(
          `INSERT INTO analysis_files
            (id, analysis_id, path, sha, size_bytes, language, score, depth, inbound_degree, outbound_degree)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (analysis_id, path) DO NOTHING`,
          values
        );
      }
    });
  },

  async updateGraphMetrics(analysisId, metricsByPath) {
    const entries = metricsByPath instanceof Map
      ? Array.from(metricsByPath.entries())
      : Object.entries(metricsByPath || {});
    if (entries.length === 0) return;

    await withTransaction(async (client) => {
      const BATCH = 500;
      for (let i = 0; i < entries.length; i += BATCH) {
        const chunk = entries.slice(i, i + BATCH);
        const values = [];
        const tuples = chunk.map(([p, m], idx) => {
          const base = idx * 3;
          values.push(p, m?.inboundDegree ?? 0, m?.outboundDegree ?? 0);
          return `($${base + 1}::text, $${base + 2}::int, $${base + 3}::int)`;
        });
        values.push(analysisId);
        const analysisIdParam = `$${values.length}`;
        await client.query(
          `UPDATE analysis_files af
              SET inbound_degree  = t.in_deg,
                  outbound_degree = t.out_deg
             FROM (VALUES ${tuples.join(', ')}) AS t(p, in_deg, out_deg)
            WHERE af.analysis_id = ${analysisIdParam}
              AND af.path = t.p`,
          values
        );
      }
    });
  },

  async getSkeletonsMap(analysisId) {
    const { rows } = await getDb().query(
      `SELECT path, skeleton FROM analysis_files
         WHERE analysis_id = $1 AND skeleton IS NOT NULL AND skeleton <> ''`,
      [analysisId]
    );
    const out = {};
    for (const r of rows) out[r.path] = r.skeleton;
    return out;
  },

  /**
   * Batched version of updateTier for the analyzer ingestion loop.
   *
   * Contract: every update row must have a uniform shape —
   *   { path, tier, content, skeleton, content_tokens, skeleton_tokens,
   *     fetched_at, skip_reason }
   * with unused fields set to null (not undefined). Null fields are
   * COALESCEd against the existing column value, i.e. a null NEVER clears
   * a previously-set column. The two callers (analyzer.js ingestion loops)
   * control the shape: freshly-inserted tree rows have NULL in all of these
   * columns, so COALESCE semantics match updateTier's behavior there.
   *
   * One UPDATE ... FROM (VALUES ...) round trip per chunk of 500 rows.
   */
  async bulkUpdateTiers(analysisId, updates) {
    if (!updates || updates.length === 0) return;
    const BATCH = 500;
    await withTransaction(async (client) => {
      for (let i = 0; i < updates.length; i += BATCH) {
        const { sql, values } = buildBulkTierUpdateChunk(analysisId, updates.slice(i, i + BATCH));
        await client.query(sql, values);
      }
    });
  },

  async updateTier(analysisId, filePath, fields) {
    const allowed = ['tier', 'content', 'skeleton', 'content_tokens', 'skeleton_tokens',
                     'fetched_at', 'skip_reason', 'inbound_degree', 'outbound_degree'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        params.push(fields[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return;
    params.push(analysisId);
    const analysisIdIdx = params.length;
    params.push(filePath);
    const pathIdx = params.length;
    await getDb().query(
      `UPDATE analysis_files SET ${sets.join(', ')}
        WHERE analysis_id = $${analysisIdIdx} AND path = $${pathIdx}`,
      params
    );
  },

  async listByAnalysis(analysisId, { tier, minScore, limit, offset } = {}) {
    const conditions = ['analysis_id = $1'];
    const params = [analysisId];
    if (tier) { params.push(tier); conditions.push(`tier = $${params.length}`); }
    if (minScore != null) { params.push(minScore); conditions.push(`score >= $${params.length}`); }
    let sql = `SELECT * FROM analysis_files WHERE ${conditions.join(' AND ')}
      ORDER BY score DESC NULLS LAST, path ASC`;
    if (limit != null) { params.push(limit); sql += ` LIMIT $${params.length}`; }
    if (offset != null) { params.push(offset); sql += ` OFFSET $${params.length}`; }
    const { rows } = await getDb().query(sql, params);
    return rows;
  },

  async countByTier(analysisId) {
    const { rows } = await getDb().query(
      `SELECT tier, COUNT(*)::int AS count FROM analysis_files
        WHERE analysis_id = $1 GROUP BY tier`,
      [analysisId]
    );
    const out = { tree: 0, skeleton: 0, full: 0, chunked: 0 };
    for (const r of rows) {
      if (r.tier in out) out[r.tier] = r.count;
    }
    return out;
  },

  async getByPath(analysisId, filePath) {
    const { rows } = await getDb().query(
      'SELECT * FROM analysis_files WHERE analysis_id = $1 AND path = $2',
      [analysisId, filePath]
    );
    return rows[0] || null;
  },

  async getContentsMap(analysisId, { includeSkeletons = true } = {}) {
    const { rows } = await getDb().query(
      `SELECT path, tier, content, skeleton FROM analysis_files
         WHERE analysis_id = $1
           AND ((tier = 'full' AND content IS NOT NULL)
                OR (tier = 'skeleton' AND skeleton IS NOT NULL))`,
      [analysisId]
    );
    const out = {};
    for (const r of rows) {
      if (r.tier === 'full' && r.content) out[r.path] = r.content;
      else if (includeSkeletons && r.tier === 'skeleton' && r.skeleton) out[r.path] = r.skeleton;
    }
    return out;
  },
};

// ── Analysis File Chunks ──────────────────────────────────────────

const analysisFileChunks = {
  async createBatch(fileId, chunks) {
    if (!chunks || chunks.length === 0) return;
    const BATCH = 500;
    await withTransaction(async (client) => {
      for (let i = 0; i < chunks.length; i += BATCH) {
        const slice = chunks.slice(i, i + BATCH);
        const values = [];
        const placeholders = slice.map((c, idx) => {
          const base = idx * 5;
          values.push(
            crypto.randomUUID(),
            fileId,
            c.ordinal,
            c.content,
            c.tokens ?? 0
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        });
        await client.query(
          `INSERT INTO analysis_file_chunks (id, file_id, ordinal, content, tokens)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (file_id, ordinal) DO NOTHING`,
          values
        );
      }
    });
  },
  async listByFile(fileId) {
    const { rows } = await getDb().query(
      'SELECT * FROM analysis_file_chunks WHERE file_id = $1 ORDER BY ordinal ASC',
      [fileId]
    );
    return rows;
  },
};

// ── Analysis LLM Calls ────────────────────────────────────────────

const analysisLlmCalls = {
  async create(call) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    const { rows } = await getDb().query(
      `INSERT INTO analysis_llm_calls
        (id, analysis_id, phase, model, input_tokens, output_tokens, cost_usd,
         duration_ms, target_path, files_used, created_at,
         cache_creation_tokens, cache_read_tokens)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, created_at`,
      [
        id,
        call.analysis_id,
        call.phase,
        call.model,
        call.input_tokens ?? 0,
        call.output_tokens ?? 0,
        call.cost_usd ?? 0,
        call.duration_ms ?? null,
        call.target_path ?? null,
        call.files_used == null ? null : toJsonb(call.files_used),
        created_at,
        call.cache_creation_tokens ?? 0,
        call.cache_read_tokens ?? 0,
      ]
    );
    return { id: rows[0].id, created_at: rows[0].created_at, ...call };
  },
  async listByAnalysis(analysisId) {
    const { rows } = await getDb().query(
      'SELECT * FROM analysis_llm_calls WHERE analysis_id = $1 ORDER BY created_at ASC',
      [analysisId]
    );
    return rows;
  },
  async aggregateByPhase(analysisId) {
    const { rows } = await getDb().query(
      `SELECT phase,
        COUNT(*)::int                                AS call_count,
        COALESCE(SUM(input_tokens), 0)::int          AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int         AS output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0)::int AS cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0)::int     AS cache_read_tokens,
        COALESCE(SUM(cost_usd), 0)::double precision AS cost_usd
        FROM analysis_llm_calls
        WHERE analysis_id = $1
        GROUP BY phase`,
      [analysisId]
    );
    return rows;
  },
};

// ── Analysis Events ───────────────────────────────────────────────

/**
 * Builds one multi-row INSERT for a chunk of analysis_events rows.
 * Generates id/created_at per row. Pure apart from uuid/timestamp
 * generation — exported for unit testing.
 */
function buildEventsInsertChunk(chunk) {
  const values = [];
  const placeholders = chunk.map((e, idx) => {
    const base = idx * 9;
    values.push(
      crypto.randomUUID(),
      e.analysis_id,
      e.event_type,
      e.source ?? null,
      e.path ?? null,
      e.bytes ?? null,
      e.tokens ?? null,
      e.metadata == null ? null : toJsonb(e.metadata),
      new Date().toISOString()
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
  });
  const sql =
    `INSERT INTO analysis_events
      (id, analysis_id, event_type, source, path, bytes, tokens, metadata, created_at)
      VALUES ${placeholders.join(', ')}`;
  return { sql, values };
}

const analysisEvents = {
  /**
   * Multi-row INSERT following the bulkInsertTreeRows pattern. Each row
   * has the same shape as `create` (analysis_id, event_type, source?, path?,
   * bytes?, tokens?, metadata?); ids and created_at are generated here.
   */
  async createBatch(rows) {
    if (!rows || rows.length === 0) return;
    const BATCH = 500;
    await withTransaction(async (client) => {
      for (let i = 0; i < rows.length; i += BATCH) {
        const { sql, values } = buildEventsInsertChunk(rows.slice(i, i + BATCH));
        await client.query(sql, values);
      }
    });
  },

  async create(event) {
    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();
    await getDb().query(
      `INSERT INTO analysis_events
        (id, analysis_id, event_type, source, path, bytes, tokens, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        event.analysis_id,
        event.event_type,
        event.source ?? null,
        event.path ?? null,
        event.bytes ?? null,
        event.tokens ?? null,
        event.metadata == null ? null : toJsonb(event.metadata),
        created_at,
      ]
    );
    return { id, created_at, ...event };
  },
  async listByAnalysis(analysisId, { limit = 200 } = {}) {
    const { rows } = await getDb().query(
      'SELECT * FROM analysis_events WHERE analysis_id = $1 ORDER BY created_at ASC LIMIT $2',
      [analysisId, limit]
    );
    return rows;
  },
};

const { productMap } = require('./db-map');

// ── v2: Shipped items ─────────────────────────────────────────────

const shippedItems = {
  // Uses ON CONFLICT (project_id, commit_sha) to make the insert idempotent
  // under concurrent webhook deliveries. Migration 012 adds the matching
  // unique index. Returns null when a row already existed for this commit.
  async create(item) {
    const id = item.id || crypto.randomUUID();
    const { rows } = await getDb().query(
      `INSERT INTO shipped_items
        (id, project_id, gap_id, commit_sha, commit_message, branch,
         files_changed, files_changed_count, verification, verification_detail,
         partial_items, match_confidence, match_strategy, deployed_to, deployed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (project_id, commit_sha) DO NOTHING
        RETURNING *`,
      [
        id,
        item.project_id,
        item.gap_id ?? null,
        item.commit_sha,
        item.commit_message ?? null,
        item.branch ?? null,
        toJsonb(item.files_changed ?? []),
        item.files_changed_count ?? 0,
        item.verification ?? 'pending',
        item.verification_detail ?? null,
        item.partial_items == null ? null : toJsonb(item.partial_items),
        item.match_confidence ?? null,
        item.match_strategy ?? null,
        item.deployed_to ?? null,
        item.deployed_at ?? null,
      ]
    );
    return rows[0] || null;
  },

  async findLatestByProjectIds(projectIds) {
    if (!projectIds.length) return new Map();
    const placeholders = projectIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await getDb().query(
      `SELECT DISTINCT ON (project_id)
              project_id, commit_sha, commit_message, shipped_at
         FROM shipped_items
        WHERE project_id IN (${placeholders})
        ORDER BY project_id, shipped_at DESC NULLS LAST`,
      projectIds
    );
    return new Map(rows.map((r) => [r.project_id, r]));
  },

  async listByProjectId(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM shipped_items
        WHERE project_id = $1
        ORDER BY shipped_at DESC`,
      [projectId]
    );
    return rows;
  },

  async findByCommit(projectId, commitSha) {
    const { rows } = await getDb().query(
      'SELECT * FROM shipped_items WHERE project_id = $1 AND commit_sha = $2 LIMIT 1',
      [projectId, commitSha]
    );
    return rows[0] || null;
  },

  async updateVerification(id, { verification, verificationDetail, partialItems }) {
    const { rows } = await getDb().query(
      `UPDATE shipped_items
         SET verification = COALESCE($1, verification),
             verification_detail = COALESCE($2, verification_detail),
             partial_items = COALESCE($3, partial_items)
        WHERE id = $4
        RETURNING *`,
      [
        verification ?? null,
        verificationDetail ?? null,
        partialItems == null ? null : toJsonb(partialItems),
        id,
      ]
    );
    return rows[0] || null;
  },

  async countSinceForProject(projectId, sinceIso) {
    const { rows } = await getDb().query(
      'SELECT COUNT(*)::int AS n FROM shipped_items WHERE project_id = $1 AND shipped_at >= $2',
      [projectId, sinceIso]
    );
    return rows[0]?.n || 0;
  },

  // ── Triage-preservation companions for re-analyze ────────────
  //
  // The suggestions table has `gap_id … ON DELETE SET NULL` on
  // shipped_items (migration 011_v2_shipped.sql:29). When runPipeline
  // deletes all suggestions to re-insert them, every shipped row's
  // gap_id becomes NULL — even though the new pipeline will recreate
  // the gap with the SAME content-stable scoped id. These helpers let
  // takeoff.js snapshot the (shipped_id → gap_id) pairs before the
  // delete and re-link them after the new suggestions land.
  //
  // Only rows with a non-null gap_id are interesting; null-link rows
  // either pre-date the link or have already been orphaned.
  async snapshotGapLinks(projectId) {
    const { rows } = await getDb().query(
      `SELECT id, gap_id FROM shipped_items
        WHERE project_id = $1 AND gap_id IS NOT NULL`,
      [projectId]
    );
    return rows;
  },

  // Re-apply `gap_id` to each shipped row from the snapshot, but only
  // when the target suggestion exists post-insert (FK would otherwise
  // throw). Returns `{ relinked, skipped }` so callers can log.
  async relinkGaps(projectId, snapshots) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return { relinked: 0, skipped: 0 };
    }
    let relinked = 0;
    let skipped = 0;
    await withTransaction(async (client) => {
      for (const snap of snapshots) {
        const { rowCount } = await client.query(
          `UPDATE shipped_items SET gap_id = $1
             WHERE id = $2 AND project_id = $3
               AND EXISTS (
                 SELECT 1 FROM suggestions
                  WHERE id = $1 AND project_id = $3
               )`,
          [snap.gap_id, snap.id, projectId]
        );
        if (rowCount > 0) relinked += 1;
        else skipped += 1;
      }
    });
    return { relinked, skipped };
  },
};

// ── v2: Security report public share links (migration 016) ─────────
//
// Each row mints a short URL slug that anyone can use to view a
// read-only copy of a project's security report. The owner can list
// active links, revoke any of them, and create "redacted" links that
// hide the repo URL/owner.
//
// Active = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()).
// We keep revoked rows in place rather than deleting so a leaked URL
// can never be re-issued — the slug is a primary key, and re-using it
// would let an old screenshot suddenly resolve to a different project.

// Slug alphabet: lowercase + digits, no ambiguous chars (no O/0/I/l).
// 36^12 ≈ 4.7×10^18 entropy; collisions are theoretical and the
// writer retries on the unique-violation just in case.
const SHARE_SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SHARE_SLUG_LENGTH = 12;

function generateShareSlug() {
  const bytes = crypto.randomBytes(SHARE_SLUG_LENGTH);
  let out = '';
  for (let i = 0; i < SHARE_SLUG_LENGTH; i++) {
    out += SHARE_SLUG_ALPHABET[bytes[i] % SHARE_SLUG_ALPHABET.length];
  }
  return out;
}

const securityShares = {
  /**
   * Create a new share link for the given project.
   *
   * The slug is generated client-side and inserted with `ON CONFLICT
   * DO NOTHING` so a (theoretical) collision returns no row instead of
   * raising — we then retry up to 5 times before giving up. Hitting
   * the retry path means either the alphabet/length is too small or
   * the RNG is broken; either way it's a hard failure worth logging.
   */
  async create({ projectId, createdBy, redactRepo, expiresAt }) {
    if (!projectId) throw new Error('securityShares.create: projectId required');
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = generateShareSlug();
      const { rows } = await getDb().query(
        `INSERT INTO v2_security_shares
          (slug, project_id, created_by, redact_repo, expires_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (slug) DO NOTHING
          RETURNING *`,
        [slug, projectId, createdBy ?? null, !!redactRepo, expiresAt ?? null]
      );
      if (rows[0]) return rows[0];
    }
    throw new Error('securityShares.create: failed to generate unique slug after 5 attempts');
  },

  /**
   * Public-endpoint lookup. Filters on active state (not revoked, not
   * expired) so the route layer doesn't have to know the active rule.
   * Returns null for missing/revoked/expired slugs — the route maps
   * those to 410 (revoked/expired) vs 404 (never existed) by checking
   * the un-filtered table; see `findBySlug` below.
   */
  async findActiveBySlug(slug) {
    if (!slug) return null;
    const { rows } = await getDb().query(
      `SELECT * FROM v2_security_shares
        WHERE slug = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1`,
      [slug]
    );
    return rows[0] || null;
  },

  /**
   * Raw lookup (no active filter). The public route uses this only to
   * differentiate 410-Gone (existed but revoked/expired) from 404-Not
   * Found (never existed) so users get an honest error message.
   */
  async findBySlug(slug) {
    if (!slug) return null;
    const { rows } = await getDb().query(
      'SELECT * FROM v2_security_shares WHERE slug = $1 LIMIT 1',
      [slug]
    );
    return rows[0] || null;
  },

  /**
   * Active shares for a single project, newest first. Backs the share
   * modal's "existing links" list. Bounded scan via the partial index
   * on (project_id, created_at DESC) WHERE revoked_at IS NULL.
   */
  async listActiveByProjectId(projectId) {
    if (!projectId) return [];
    const { rows } = await getDb().query(
      `SELECT * FROM v2_security_shares
        WHERE project_id = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC`,
      [projectId]
    );
    return rows;
  },

  /**
   * Soft-revoke. Returns the updated row, or null if the slug was
   * already revoked or doesn't exist (the route maps null to 404 for
   * the latter case via a follow-up `findBySlug` check).
   */
  async revoke(slug) {
    if (!slug) return null;
    const { rows } = await getDb().query(
      `UPDATE v2_security_shares
          SET revoked_at = now()
        WHERE slug = $1
          AND revoked_at IS NULL
        RETURNING *`,
      [slug]
    );
    return rows[0] || null;
  },
};

// ── v2: Webhook events archive ────────────────────────────────────

const webhookEvents = {
  async create(evt) {
    const id = evt.id || crypto.randomUUID();
    await getDb().query(
      `INSERT INTO webhook_events
        (id, delivery_id, event_type, source, project_id, payload, signature_ok)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        evt.delivery_id ?? null,
        evt.event_type,
        evt.source ?? 'github',
        evt.project_id ?? null,
        toJsonb(evt.payload ?? {}),
        evt.signature_ok ?? null,
      ]
    );
    return { id };
  },
};

// ── Processed pushes (webhook dedupe) ─────────────────────────────

// A claim that never completed (crash, deploy) can be taken over after this
// long. Well past the longest push run (commits run one at a time with LLM
// calls), so a slow run is never processed twice.
const PUSH_CLAIM_STALE_MINUTES = 60;

const processedPushes = {
  /**
   * True when this delivery should process the push: it is the first, or the
   * earlier claim never completed and has gone stale. False when another
   * delivery is working on it or finished it. Migration 026 adds the table.
   */
  async claim({ projectId, ref, before, after, deliveryId, source }) {
    const { rows } = await getDb().query(
      `INSERT INTO processed_pushes (project_id, ref, before_sha, after_sha, delivery_id, source)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project_id, ref, before_sha, after_sha) DO UPDATE
          SET delivery_id = EXCLUDED.delivery_id, source = EXCLUDED.source, received_at = now()
          WHERE processed_pushes.completed_at IS NULL
            AND processed_pushes.received_at < now() - ($7 || ' minutes')::interval
        RETURNING project_id`,
      [projectId, ref, before, after, deliveryId ?? null, source, String(PUSH_CLAIM_STALE_MINUTES)]
    );
    return rows.length > 0;
  },
  /** Processing finished; later deliveries of this push are true duplicates. */
  async complete({ projectId, ref, before, after }) {
    await getDb().query(
      `UPDATE processed_pushes SET completed_at = now()
        WHERE project_id = $1 AND ref = $2 AND before_sha = $3 AND after_sha = $4`,
      [projectId, ref, before, after]
    );
  },
  /** Processing failed; let a redelivery try again. */
  async release({ projectId, ref, before, after }) {
    await getDb().query(
      `DELETE FROM processed_pushes
        WHERE project_id = $1 AND ref = $2 AND before_sha = $3 AND after_sha = $4
          AND completed_at IS NULL`,
      [projectId, ref, before, after]
    );
  },
};

// ── Projects, members, invites (Takeoff Milestone 2, migration 031) ─────
// The owner is deployments.user_id; everyone else is a project_members row.

const MEMBER_LABELS = Object.freeze(['creator', 'builder']);

const projectMembers = {
  /** Ids of the projects `userId` is a member of (owners not included). */
  async projectIdsForUser(userId) {
    const { rows } = await getDb().query('SELECT project_id FROM project_members WHERE user_id = $1', [userId]);
    return rows.map((r) => r.project_id);
  },
  async list(projectId) {
    const { rows } = await getDb().query(
      'SELECT * FROM project_members WHERE project_id = $1 ORDER BY joined_at, user_id',
      [projectId]
    );
    return rows;
  },
  async get(projectId, userId) {
    const { rows } = await getDb().query(
      'SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    return rows[0] || null;
  },
  async setLabels(projectId, userId, labels) {
    const { rows } = await getDb().query(
      `UPDATE project_members SET labels = $3::TEXT[], updated_at = now()
        WHERE project_id = $1 AND user_id = $2 RETURNING *`,
      [projectId, userId, labels]
    );
    return rows[0] || null;
  },
  /** The owner's own row, made on first use so the owner has labels too. */
  async ensure(projectId, userId, { email = null, displayName = null, labels = [] } = {}) {
    const { rows } = await getDb().query(
      `INSERT INTO project_members (project_id, user_id, email, display_name, labels)
        VALUES ($1, $2, $3, $4, $5::TEXT[])
        ON CONFLICT (project_id, user_id) DO UPDATE
          SET email = COALESCE(EXCLUDED.email, project_members.email),
              display_name = COALESCE(EXCLUDED.display_name, project_members.display_name)
        RETURNING *`,
      [projectId, userId, email, displayName, labels]
    );
    return rows[0];
  },
  async remove(projectId, userId) {
    const { rowCount } = await getDb().query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    return rowCount > 0;
  },
};

const projectInvites = {
  async create({ id, projectId, email = null, githubLogin = null, githubUserId = null, tokenHash, invitedBy, invitedByName = null, expiresAt }) {
    const { rows } = await getDb().query(
      `INSERT INTO project_invites (id, project_id, email, github_login, github_user_id, token_hash, invited_by, invited_by_name, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
        RETURNING *`,
      [id, projectId, email, githubLogin, githubUserId, tokenHash, invitedBy, invitedByName, expiresAt]
    );
    return rows[0] || null;
  },
  /** The open invite for this address, if one exists (for "invite again"). */
  async findOpen(projectId, { email = null, githubLogin = null }) {
    const { rows } = await getDb().query(
      `SELECT * FROM project_invites
        WHERE project_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
          AND (($2::TEXT IS NOT NULL AND LOWER(email) = LOWER($2::TEXT))
            OR ($3::TEXT IS NOT NULL AND LOWER(github_login) = LOWER($3::TEXT)))`,
      [projectId, email, githubLogin]
    );
    return rows[0] || null;
  },
  /** A new token for an open invite (the old link stops working). */
  async rotateToken(id, tokenHash, expiresAt, { githubUserId = null } = {}) {
    // The original inviter stays on the invite (they can still cancel it).
    const { rows } = await getDb().query(
      `UPDATE project_invites SET token_hash = $2, expires_at = $3,
          github_user_id = COALESCE($4, github_user_id)
        WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING *`,
      [id, tokenHash, expiresAt, githubUserId]
    );
    return rows[0] || null;
  },
  async findByTokenHash(tokenHash) {
    const { rows } = await getDb().query('SELECT * FROM project_invites WHERE token_hash = $1', [tokenHash]);
    return rows[0] || null;
  },
  async listOpen(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM project_invites
        WHERE project_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 200`,
      [projectId]
    );
    return rows;
  },
  async revoke(projectId, id) {
    const { rowCount } = await getDb().query(
      `UPDATE project_invites SET revoked_at = now()
        WHERE project_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [projectId, id]
    );
    return rowCount > 0;
  },
  /** Cancel the open invites someone sent (when they leave or are removed). */
  async revokeByInviter(projectId, userId) {
    const { rowCount } = await getDb().query(
      `UPDATE project_invites SET revoked_at = now()
        WHERE project_id = $1 AND invited_by = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [projectId, userId]
    );
    return rowCount;
  },
  /** Undo markLinkSent after a send that failed, so a retry isn't blocked. */
  async clearLinkSent(id) {
    await getDb().query('UPDATE project_invites SET last_link_sent_at = NULL WHERE id = $1', [id]);
  },
  /**
   * Note a sign-in link send, at most one per `minSeconds` per invite.
   * @returns {Promise<boolean>} false when one was sent too recently
   */
  async markLinkSent(id, minSeconds = 60) {
    const { rowCount } = await getDb().query(
      `UPDATE project_invites SET last_link_sent_at = now()
        WHERE id = $1 AND (last_link_sent_at IS NULL OR last_link_sent_at < now() - ($2 || ' seconds')::interval)`,
      [id, String(minSeconds)]
    );
    return rowCount > 0;
  },
  /**
   * Use the invite and add the member, in one transaction. The invite is
   * claimed first (still open and unexpired), so a link works once.
   * @returns {Promise<{ member: object, alreadyMember: boolean }|null>} null when the invite can't be used
   */
  async accept({ id, userId, email, displayName = null, labels }) {
    return withTransaction(async (client) => {
      const { rows: inv } = await client.query(
        `UPDATE project_invites SET accepted_at = now(), accepted_by = $2
          WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
          RETURNING *`,
        [id, userId]
      );
      if (!inv[0]) return null;
      const { rows } = await client.query(
        `INSERT INTO project_members (project_id, user_id, email, display_name, labels, invited_by)
          VALUES ($1, $2, $3, $4, $5::TEXT[], $6)
          ON CONFLICT (project_id, user_id) DO NOTHING
          RETURNING *`,
        [inv[0].project_id, userId, email, displayName, labels, inv[0].invited_by]
      );
      if (rows[0]) return { member: rows[0], alreadyMember: false };
      const { rows: existing } = await client.query(
        'SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2',
        [inv[0].project_id, userId]
      );
      return { member: existing[0], alreadyMember: true };
    });
  },
};

const recommendations = {
  async create({ id, projectId, actionType, payload, summary, createdBy }) {
    const { rows } = await getDb().query(
      `INSERT INTO recommendations (id, project_id, action_type, payload, summary, created_by)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, projectId, actionType, JSON.stringify(payload || {}), summary, createdBy]
    );
    return rows[0];
  },
  async get(projectId, id) {
    const { rows } = await getDb().query('SELECT * FROM recommendations WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] || null;
  },
  async listPending(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM recommendations WHERE project_id = $1 AND status IN ('pending', 'confirming')
        ORDER BY created_at DESC LIMIT 100`,
      [projectId]
    );
    return rows;
  },
  /**
   * Take a pending recommendation to run it. Only one confirmer wins; a run
   * that died mid-way is taken again after 10 minutes.
   */
  async claimForConfirm(projectId, id, userId) {
    const { rows } = await getDb().query(
      `UPDATE recommendations SET status = 'confirming', decided_by = $3, decided_at = now()
        WHERE project_id = $1 AND id = $2
          AND (status = 'pending' OR (status = 'confirming' AND decided_at < now() - interval '10 minutes'))
        RETURNING *`,
      [projectId, id, userId]
    );
    return rows[0] || null;
  },
  async finish(id, { status, result = null, error = null }) {
    const { rows } = await getDb().query(
      `UPDATE recommendations SET status = $2, result = $3, error = $4, decided_at = now()
        WHERE id = $1 AND status = 'confirming' RETURNING *`,
      [id, status, result ? JSON.stringify(result) : null, error]
    );
    return rows[0] || null;
  },
  /** Back to pending after a confirm that failed, keeping why, so someone can try again. */
  async release(id, error = null) {
    const { rows } = await getDb().query(
      `UPDATE recommendations SET status = 'pending', decided_by = NULL, decided_at = NULL, error = $2
        WHERE id = $1 AND status = 'confirming' RETURNING *`,
      [id, error]
    );
    return rows[0] || null;
  },
  async dismiss(projectId, id, userId) {
    const { rows } = await getDb().query(
      `UPDATE recommendations SET status = 'dismissed', decided_by = $3, decided_at = now()
        WHERE project_id = $1 AND id = $2 AND status = 'pending' RETURNING *`,
      [projectId, id, userId]
    );
    return rows[0] || null;
  },
};

// ── Agreements (Milestone 3) ────────────────────────────────────────────

const AGREEMENT_COMMIT_STALE = "interval '10 minutes'";

const agreements = {
  async create({ id, projectId, areaId = null, text, source = null, proposedBy, proposedByName = null }) {
    const { rows } = await getDb().query(
      `INSERT INTO agreements (id, project_id, area_id, text, source, proposed_by, proposed_by_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, projectId, areaId, text, source, proposedBy, proposedByName]
    );
    return rows[0];
  },
  async get(projectId, id) {
    const { rows } = await getDb().query('SELECT * FROM agreements WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] || null;
  },
  async getById(id) {
    const { rows } = await getDb().query('SELECT * FROM agreements WHERE id = $1', [id]);
    return rows[0] || null;
  },
  async list(projectId, { limit = 100 } = {}) {
    const { rows } = await getDb().query(
      `SELECT * FROM agreements WHERE project_id = $1
        ORDER BY (status = 'proposed') DESC, proposed_at DESC LIMIT $2`,
      [projectId, limit]
    );
    return rows;
  },
  /** proposed → accepted/declined/withdrawn, once. Returns the row, or null when it was already decided. */
  async decide(projectId, id, { status, decidedBy, via, note = null, agreedByEmails = null }) {
    const { rows } = await getDb().query(
      `UPDATE agreements SET status = $3, decided_by = $4, decided_at = now(), decided_via = $5,
          decision_note = $6, agreed_by_emails = $7
        WHERE project_id = $1 AND id = $2 AND status = 'proposed' RETURNING *`,
      [projectId, id, status, decidedBy, via, note, agreedByEmails]
    );
    return rows[0] || null;
  },
  /** Take an accepted agreement to commit it. Only one runner wins; a stuck run is taken again after 10 minutes. */
  async claimCommit(projectId, id) {
    const { rows } = await getDb().query(
      `UPDATE agreements SET commit_state = 'committing', commit_attempted_at = date_trunc('milliseconds', now()), commit_error = NULL
        WHERE project_id = $2 AND id = $1 AND status = 'accepted'
          AND (commit_state IN ('none', 'waiting_for_write', 'failed')
            OR (commit_state = 'committing' AND commit_attempted_at < now() - ${AGREEMENT_COMMIT_STALE}))
        RETURNING *`,
      [id, projectId]
    );
    return rows[0] || null;
  },
  async setAgreedBy(projectId, id, emails) {
    const { rows } = await getDb().query(
      `UPDATE agreements SET agreed_by_emails = $3::text[] WHERE project_id = $1 AND id = $2 AND status = 'accepted' RETURNING *`,
      [projectId, id, emails]
    );
    return rows[0] || null;
  },
  /**
   * Record the commit outcome. With `from`, only while the state is one of
   * those; with `claimedAt` (the claim's commit_attempted_at, ms precision),
   * only while that claim is the current one.
   */
  async setCommit(id, { state, sha = null, url = null, prUrl = null, error = null, recommendationId, from = null, claimedAt = null }) {
    const { rows } = await getDb().query(
      `UPDATE agreements SET commit_state = $2, commit_sha = COALESCE($3, commit_sha), commit_url = COALESCE($4, commit_url),
          commit_pr_url = COALESCE($5, commit_pr_url), commit_error = $6,
          recommendation_id = COALESCE($7, recommendation_id)
        WHERE id = $1 AND ($8::text[] IS NULL OR commit_state = ANY($8::text[]))
          AND ($9::timestamptz IS NULL OR commit_attempted_at = $9::timestamptz) RETURNING *`,
      [id, state, sha, url, prUrl, error, recommendationId ?? null, from, claimedAt]
    );
    return rows[0] || null;
  },
};

const agreementVotes = {
  async upsert(agreementId, userId, { vote, comment = null }) {
    const { rows } = await getDb().query(
      `INSERT INTO agreement_votes (agreement_id, user_id, vote, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (agreement_id, user_id) DO UPDATE
          SET vote = EXCLUDED.vote, comment = EXCLUDED.comment, voted_at = now()
        RETURNING *`,
      [agreementId, userId, vote, comment]
    );
    return rows[0];
  },
  async listFor(agreementIds) {
    if (!agreementIds.length) return [];
    const { rows } = await getDb().query(
      'SELECT * FROM agreement_votes WHERE agreement_id = ANY($1::text[]) ORDER BY voted_at ASC',
      [agreementIds]
    );
    return rows;
  },
};

const notificationOutbox = {
  /** Queue one email. A `dedupeKey` already queued is skipped (returns false). */
  async enqueue({ id, projectId, userId, email, kind, subject, body, link = null, dedupeKey = null }) {
    const { rowCount } = await getDb().query(
      `INSERT INTO notification_outbox (id, project_id, recipient_user_id, recipient_email, kind, subject, body, link, dedupe_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
      [id, projectId, userId, email, kind, subject, body, link, dedupeKey]
    );
    return rowCount > 0;
  },
  /** Recipients with something unsent who can still get email this hour (no digest in the last hour). */
  async pendingRecipients({ limit = 200 } = {}) {
    const { rows } = await getDb().query(
      `SELECT o.recipient_email, MIN(o.created_at) AS oldest FROM notification_outbox o
        WHERE o.sent_at IS NULL AND o.attempts < 5
          AND NOT EXISTS (SELECT 1 FROM notification_outbox d
            WHERE d.recipient_email = o.recipient_email AND d.digest_id IS NOT NULL AND d.sent_at >= now() - interval '1 hour')
        GROUP BY o.recipient_email ORDER BY oldest LIMIT $1`,
      [limit]
    );
    return rows.map((r) => r.recipient_email);
  },
  /** Claim `email`'s unsent emails for sending, so two servers don't both send them. */
  async claimUnsent(email) {
    const { rows } = await getDb().query(
      `UPDATE notification_outbox SET claimed_at = now()
        WHERE id IN (SELECT id FROM notification_outbox
          WHERE recipient_email = $1 AND sent_at IS NULL AND attempts < 5
            AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
          ORDER BY created_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [email]
    );
    return rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },
  async releaseClaims(ids) {
    if (!ids.length) return;
    await getDb().query('UPDATE notification_outbox SET claimed_at = NULL WHERE id = ANY($1::text[]) AND sent_at IS NULL', [ids]);
  },
  /** What went to `email` since `since`: single emails and digests, counted apart. */
  async sentSince(email, since) {
    const { rows } = await getDb().query(
      `SELECT COUNT(*) FILTER (WHERE digest_id IS NULL)::int AS singles,
              COUNT(DISTINCT digest_id)::int AS digests
         FROM notification_outbox
        WHERE recipient_email = $1 AND sent_at IS NOT NULL AND sent_at >= $2`,
      [email, since]
    );
    return { singles: rows[0]?.singles || 0, digests: rows[0]?.digests || 0 };
  },
  async markSent(ids, digestId = null) {
    if (!ids.length) return;
    await getDb().query(
      'UPDATE notification_outbox SET sent_at = now(), digest_id = $2 WHERE id = ANY($1::text[]) AND sent_at IS NULL',
      [ids, digestId]
    );
  },
  async markFailed(ids, error) {
    if (!ids.length) return;
    await getDb().query(
      'UPDATE notification_outbox SET attempts = attempts + 1, last_error = $2, claimed_at = NULL WHERE id = ANY($1::text[]) AND sent_at IS NULL',
      [ids, String(error).slice(0, 500)]
    );
  },
};

const userGithubLinks = {
  async upsert(userId, { githubUserId, githubLogin }) {
    await getDb().query(
      `INSERT INTO user_github_links (user_id, github_user_id, github_login)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE
          SET github_user_id = EXCLUDED.github_user_id, github_login = EXCLUDED.github_login, linked_at = now()`,
      [userId, githubUserId, githubLogin]
    );
  },
  async get(userId) {
    const { rows } = await getDb().query('SELECT * FROM user_github_links WHERE user_id = $1', [userId]);
    return rows[0] || null;
  },
  async deleteForGithubUser(githubUserId) {
    await getDb().query('DELETE FROM user_github_links WHERE github_user_id = $1', [githubUserId]);
  },
};

// ── PR verdict checks (Takeoff Milestone 4, migration 030) ─────────
//
// One row per (repo, PR, head sha). claim() is the dedupe: only the delivery
// whose claim lands calls the model. The stale window is longer than a run can
// take (one model call is capped at about 8 minutes with its retry).
const PR_CHECK_STALE_MINUTES = 30;

const prChecks = {
  /**
   * The claimed row, or null when another run holds it or finished it. A row
   * that failed, or is stuck running past the stale window, is claimed again.
   * `force` (Re-run on the check) also re-claims a finished row. The returned
   * `attempts` identifies this claim: later writes only land while it holds.
   */
  async claim({ repo, prNumber, headSha, projectId, installationId = null, force = false }) {
    const { rows } = await getDb().query(
      `INSERT INTO pr_checks (repo_full_name, pr_number, head_sha, project_id, installation_id)
        VALUES ($1, $2, $3, $4, $7)
        ON CONFLICT (repo_full_name, pr_number, head_sha) DO UPDATE
          SET status = 'running', attempts = pr_checks.attempts + 1, error = NULL,
              -- A stale running attempt's check run is still open: keep it, so
              -- the new attempt reuses and closes it.
              check_run_id = CASE WHEN pr_checks.status = 'running' THEN pr_checks.check_run_id END,
              project_id = COALESCE(EXCLUDED.project_id, pr_checks.project_id),
              installation_id = COALESCE(EXCLUDED.installation_id, pr_checks.installation_id),
              updated_at = now(), completed_at = NULL
          WHERE pr_checks.status = 'failed'
             OR (pr_checks.status = 'running' AND pr_checks.updated_at < now() - ($5 || ' minutes')::interval)
             OR ($6 AND pr_checks.status <> 'running')
        RETURNING *`,
      [repo, prNumber, headSha, projectId ?? null, String(PR_CHECK_STALE_MINUTES), !!force, installationId]
    );
    return rows[0] || null;
  },
  async get({ repo, prNumber, headSha }) {
    const { rows } = await getDb().query(
      'SELECT * FROM pr_checks WHERE repo_full_name = $1 AND pr_number = $2 AND head_sha = $3',
      [repo, prNumber, headSha]
    );
    return rows[0] || null;
  },
  /** Record this attempt's in-progress check run as soon as it exists, so a sweep can close it. */
  async setCheckRun({ repo, prNumber, headSha }, attempts, checkRunId) {
    await getDb().query(
      `UPDATE pr_checks SET check_run_id = $5, updated_at = now()
        WHERE repo_full_name = $1 AND pr_number = $2 AND head_sha = $3
          AND status = 'running' AND attempts = $4`,
      [repo, prNumber, headSha, attempts, checkRunId]
    );
  },
  /**
   * Finish this attempt. Only lands while the row is still this attempt's and
   * running, so a late run never overwrites a newer claim or the sweep.
   * @returns {Promise<boolean>} whether it landed
   */
  async finish({ repo, prNumber, headSha }, { status, verdict = null, result = null, commentId = null, checkRunId = null, model = null, error = null }, attempts) {
    const { rowCount } = await getDb().query(
      `UPDATE pr_checks
          SET status = $4, verdict = $5, result_json = $6, comment_id = COALESCE($7, comment_id),
              check_run_id = COALESCE($8, check_run_id), model = COALESCE($9, model), error = $10,
              updated_at = now(), completed_at = now()
        WHERE repo_full_name = $1 AND pr_number = $2 AND head_sha = $3
          AND status = 'running' AND attempts = $11`,
      [repo, prNumber, headSha, status, verdict, result ? JSON.stringify(result) : null, commentId, checkRunId, model, error, attempts]
    );
    return rowCount > 0;
  },
  /** This sha's verdict is now on the PR's comment. Pass the locked client inside withCommentLock. */
  async setComment({ repo, prNumber, headSha }, commentId, db = getDb()) {
    await db.query(
      // clock_timestamp(): now() is the transaction's start, before the lock wait.
      `UPDATE pr_checks SET comment_id = $4, comment_at = clock_timestamp()
        WHERE repo_full_name = $1 AND pr_number = $2 AND head_sha = $3`,
      [repo, prNumber, headSha, commentId]
    );
  },
  /** The row whose verdict the PR's Takeoff comment shows now, if any. */
  async latestComment({ repo, prNumber }, db = getDb()) {
    const { rows } = await db.query(
      `SELECT head_sha, comment_id FROM pr_checks
        WHERE repo_full_name = $1 AND pr_number = $2 AND comment_id IS NOT NULL
        ORDER BY comment_at DESC NULLS LAST, updated_at DESC LIMIT 1`,
      [repo, prNumber]
    );
    return rows[0] ? { headSha: rows[0].head_sha, commentId: Number(rows[0].comment_id) } : null;
  },
  /**
   * Run `fn(client)` holding a per-PR lock, so two checks of one PR never both
   * post the first comment, and which sha the comment shows is decided and
   * recorded atomically. A transaction-scoped advisory lock, which works
   * through the transaction pooler too. Waiting is capped so a burst can't
   * tie up the pool.
   */
  async withCommentLock({ repo, prNumber }, fn) {
    const client = await getDb().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '20s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pr_comment:${repo}#${prNumber}`]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
  /** The PR's newest check: the one its comment shows, else the latest run. */
  async latestForPr({ repo, prNumber, projectId = null }) {
    const { rows } = await getDb().query(
      `SELECT * FROM pr_checks WHERE repo_full_name = $1 AND pr_number = $2 AND ($3::text IS NULL OR project_id = $3)
        ORDER BY comment_at DESC NULLS LAST, updated_at DESC LIMIT 1`,
      [repo, prNumber, projectId]
    );
    return rows[0] || null;
  },
  /** Each PR's newest check for a project's repo, newest first. */
  async latestPerPr(projectId, repo, { limit = 50 } = {}) {
    const { rows } = await getDb().query(
      `SELECT * FROM (
         SELECT DISTINCT ON (pr_number) * FROM pr_checks
          WHERE project_id = $1 AND repo_full_name = $2
          ORDER BY pr_number, comment_at DESC NULLS LAST, updated_at DESC
       ) latest
       ORDER BY COALESCE(comment_at, updated_at) DESC LIMIT $3`,
      [projectId, repo, limit]
    );
    return rows;
  },
  /** A PR was closed or reopened on GitHub. */
  async setPrClosed({ repo, prNumber, closed }) {
    await getDb().query(
      `UPDATE pr_checks SET pr_closed_at = CASE WHEN $3 THEN COALESCE(pr_closed_at, now()) END
        WHERE repo_full_name = $1 AND pr_number = $2`,
      [repo, prNumber, !!closed]
    );
  },
  /**
   * Take over runs left 'running' past the stale window (e.g. a restart
   * mid-check): marks them failed in one statement and returns them, so a
   * run claimed or finished meanwhile is never touched.
   */
  async failStale() {
    const { rows } = await getDb().query(
      `UPDATE pr_checks SET status = 'failed', error = 'interrupted', updated_at = now(), completed_at = now()
        WHERE (repo_full_name, pr_number, head_sha) IN (
          SELECT repo_full_name, pr_number, head_sha FROM pr_checks
           WHERE status = 'running' AND updated_at < now() - ($1 || ' minutes')::interval
           ORDER BY updated_at LIMIT 100
           FOR UPDATE SKIP LOCKED)
          AND status = 'running'
        RETURNING *`,
      [String(PR_CHECK_STALE_MINUTES)]
    );
    return rows;
  },
};

// ── Drift decisions (Milestone 5) ──────────────────────────────────────

const DRIFT_DECISION_STALE = "interval '10 minutes'";

const driftDecisions = {
  /**
   * Start a decision. A decision left 'working' by a crash stops blocking the
   * PR after 10 minutes. Returns null when another decision on the PR is
   * running now.
   */
  async create({ id, projectId, repo, prNumber, headSha, branch = null, type, note = null, edits = null, actorUserId, actorName = null }) {
    await getDb().query(
      `UPDATE drift_decisions SET state = 'failed', error = 'interrupted', updated_at = now()
        WHERE repo_full_name = $1 AND pr_number = $2 AND state = 'working'
          AND updated_at < now() - ${DRIFT_DECISION_STALE}`,
      [repo, prNumber]
    );
    try {
      const { rows } = await getDb().query(
        `INSERT INTO drift_decisions (id, project_id, repo_full_name, pr_number, head_sha, branch, type, note, edits, actor_user_id, actor_name)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [id, projectId, repo, prNumber, headSha, branch, type, note, edits ? JSON.stringify(edits) : null, actorUserId, actorName]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') return null;
      throw err;
    }
  },
  async get(projectId, id) {
    const { rows } = await getDb().query('SELECT * FROM drift_decisions WHERE project_id = $1 AND id = $2', [projectId, id]);
    return rows[0] || null;
  },
  async listForPr(projectId, repo, prNumber) {
    const { rows } = await getDb().query(
      `SELECT * FROM drift_decisions WHERE project_id = $1 AND repo_full_name = $2 AND pr_number = $3
        ORDER BY created_at DESC LIMIT 50`,
      [projectId, repo, prNumber]
    );
    return rows;
  },
  async listRecent(projectId, { limit = 30 } = {}) {
    const { rows } = await getDb().query(
      'SELECT * FROM drift_decisions WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
      [projectId, limit]
    );
    return rows;
  },
  /** Take a waiting or failed decision to run it (a confirmed recommendation, or a retry). */
  async claim(projectId, id, { from = ['waiting_for_write', 'failed'], confirmedBy = null } = {}) {
    await getDb().query(
      `UPDATE drift_decisions SET state = 'failed', error = 'interrupted', updated_at = now()
        WHERE project_id = $1 AND id = $2 AND state = 'working' AND updated_at < now() - ${DRIFT_DECISION_STALE}`,
      [projectId, id]
    );
    try {
      const { rows } = await getDb().query(
        `UPDATE drift_decisions SET state = 'working', error = NULL, updated_at = now(),
                confirmed_by = COALESCE($4, confirmed_by)
          WHERE project_id = $1 AND id = $2 AND state = ANY($3) RETURNING *`,
        [projectId, id, from, confirmedBy]
      );
      return rows[0] || null;
    } catch (err) {
      if (err.code === '23505') return null; // another decision on this PR is running
      throw err;
    }
  },
  /** Record how a running decision ended. Only lands while it is still running. */
  async finish(id, { state, commitSha = null, commitUrl = null, yamlSha256 = null, baseYamlSha256 = null, commentId = null, commentUrl = null, agreementId = null, recommendationId = null, error = null }) {
    const { rows } = await getDb().query(
      `UPDATE drift_decisions
          SET state = $2, commit_sha = COALESCE($3, commit_sha), commit_url = COALESCE($4, commit_url),
              yaml_sha256 = COALESCE($5, yaml_sha256), base_yaml_sha256 = COALESCE($6, base_yaml_sha256),
              comment_id = COALESCE($7, comment_id), comment_url = COALESCE($8, comment_url),
              agreement_id = COALESCE($9, agreement_id), recommendation_id = COALESCE($10, recommendation_id),
              error = $11, updated_at = now(), done_at = CASE WHEN $2 = 'done' THEN now() ELSE done_at END
        WHERE id = $1 AND state = 'working' RETURNING *`,
      [id, state, commitSha, commitUrl, yamlSha256, baseYamlSha256, commentId, commentUrl, agreementId, recommendationId, error]
    );
    return rows[0] || null;
  },
  /** While an accept runs, the takeoff.yaml it is about to commit (set just before the branch moves). */
  async recordPlan(id, { yamlSha256, baseYamlSha256 }) {
    await getDb().query(
      `UPDATE drift_decisions SET yaml_sha256 = $2, base_yaml_sha256 = $3, updated_at = now()
        WHERE id = $1 AND state = 'working' AND type = 'accepted'`,
      [id, yamlSha256, baseYamlSha256]
    );
  },
  /**
   * The accept in this project that committed (or is committing right now)
   * exactly this takeoff.yaml on this PR, over exactly this base file.
   */
  async acceptedFor({ projectId, repo, prNumber, yamlSha256, baseYamlSha256 }) {
    const { rows } = await getDb().query(
      `SELECT * FROM drift_decisions
        WHERE project_id = $1 AND repo_full_name = $2 AND pr_number = $3 AND type = 'accepted'
          AND (state = 'done' OR (state = 'working' AND updated_at > now() - ${DRIFT_DECISION_STALE}))
          AND yaml_sha256 = $4 AND base_yaml_sha256 = $5
        ORDER BY (state = 'done') DESC, updated_at DESC LIMIT 1`,
      [projectId, repo, prNumber, yamlSha256, baseYamlSha256]
    );
    return rows[0] || null;
  },
};

// ── Intent statements (Takeoff intent substrate) ──────────────────
//
// The first-class "what this app is meant to do" object. Gaps and
// satisfaction are computed as views over confirmed statements (see
// services/v2/gap-mapper.js synthesizeMapGaps and Phase 6). Code links
// live inline as a JSONB array — they're re-derived deterministically on
// every analysis, so they're a cache, not precious relational data. Only
// human decisions (confirm/edit/reject) are precious; everything else is
// rebuildable. See migration 019_intent_substrate.sql.

// Columns the generic `update()` may set. Excludes id/project_id/created_at.
const INTENT_STATEMENTS_ALLOWED = new Set([
  'text', 'kind', 'status', 'source', 'feature_area', 'group_label',
  'links', 'code_hash', 'satisfied', 'last_checked_at', 'updated_at',
  'scope', 'confirmed_via', 'confidence', 'archived',
]);
const INTENT_STATEMENTS_JSONB = new Set(['links']);
const INTENT_STATEMENTS_BOOL = new Set(['satisfied', 'archived']);

const intentStatements = {
  async createBatch(items) {
    if (!items || items.length === 0) return;
    await withTransaction(async (client) => {
      for (const row of items) {
        await client.query(
          `INSERT INTO intent_statements
            (id, project_id, text, kind, status, source, feature_area, group_label,
             links, code_hash, satisfied, last_checked_at, created_at, updated_at,
             scope, confirmed_via, confidence, archived)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18)
            ON CONFLICT (id) DO NOTHING`,
          [
            row.id || crypto.randomUUID(),
            row.project_id,
            row.text,
            row.kind,
            row.status || 'candidate',
            row.source || 'inferred',
            row.feature_area ?? null,
            row.group_label ?? null,
            toJsonb(row.links ?? []),
            row.code_hash ?? null,
            toBool(row.satisfied),
            row.last_checked_at ?? null,
            row.created_at || new Date().toISOString(),
            row.updated_at ?? null,
            row.scope || 'job',
            row.confirmed_via ?? null,
            row.confidence ?? null,
            toBool(row.archived),
          ]
        );
      }
    });
  },

  async findByProjectId(projectId, { status, featureArea, scope, archived } = {}) {
    const params = [projectId];
    let where = 'project_id = $1';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    if (featureArea) {
      params.push(featureArea);
      where += ` AND feature_area = $${params.length}`;
    }
    if (scope) {
      params.push(scope);
      where += ` AND scope = $${params.length}`;
    }
    // `archived` is opt-in: callers that don't pass it get every row (back-compat
    // for reconciliation/suppression); the job/invariant views pass `false`.
    if (archived === true || archived === false) {
      params.push(archived);
      where += ` AND archived = $${params.length}`;
    }
    const { rows } = await getDb().query(
      `SELECT * FROM intent_statements WHERE ${where}
        ORDER BY feature_area NULLS LAST, created_at ASC`,
      params
    );
    return rows;
  },

  async findConfirmedByProjectId(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM intent_statements
        WHERE project_id = $1 AND status = 'confirmed'
        ORDER BY feature_area NULLS LAST, created_at ASC`,
      [projectId]
    );
    return rows;
  },

  async findById(id, projectId) {
    const { rows } = await getDb().query(
      'SELECT * FROM intent_statements WHERE id = $1 AND project_id = $2',
      [id, projectId]
    );
    return rows[0] || null;
  },

  // Generic field update, project-scoped, returns the updated row.
  async update(id, projectId, fields) {
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!INTENT_STATEMENTS_ALLOWED.has(key)) {
        console.warn(`[db] intentStatements.update: ignoring unknown column "${key}"`);
        continue;
      }
      // Skip undefined so partial updates never accidentally null a column
      // (e.g. the NOT NULL `text`). Callers pass explicit null to clear.
      if (value === undefined) continue;
      let v = value;
      if (INTENT_STATEMENTS_JSONB.has(key)) v = toJsonb(value);
      else if (INTENT_STATEMENTS_BOOL.has(key)) v = toBool(value);
      params.push(v);
      sets.push(`${key} = $${params.length}`);
    }
    if (sets.length === 0) return this.findById(id, projectId);
    // Always bump updated_at unless the caller set it explicitly.
    if (!('updated_at' in fields)) {
      params.push(new Date().toISOString());
      sets.push(`updated_at = $${params.length}`);
    }
    params.push(id);
    params.push(projectId);
    const { rows } = await getDb().query(
      `UPDATE intent_statements SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND project_id = $${params.length}
        RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  async setStatus(id, projectId, status) {
    return this.update(id, projectId, { status });
  },

  // Freeze / refresh the satisfaction baseline (Phase 4 confirm, Phase 6 recheck).
  async setSatisfaction(id, projectId, { codeHash, satisfied, lastCheckedAt } = {}) {
    return this.update(id, projectId, {
      code_hash: codeHash ?? null,
      satisfied,
      last_checked_at: lastCheckedAt ?? new Date().toISOString(),
    });
  },

  // Bootstrap idempotency: replace only the machine-proposed candidates for
  // an area, leaving confirmed and rejected (human decisions) untouched.
  async deleteCandidatesByArea(projectId, featureArea) {
    if (featureArea === null || featureArea === undefined) {
      await getDb().query(
        `DELETE FROM intent_statements
          WHERE project_id = $1 AND status = 'candidate' AND feature_area IS NULL`,
        [projectId]
      );
      return;
    }
    await getDb().query(
      `DELETE FROM intent_statements
        WHERE project_id = $1 AND status = 'candidate' AND feature_area = $2`,
      [projectId, featureArea]
    );
  },

  async delete(id, projectId) {
    await getDb().query(
      'DELETE FROM intent_statements WHERE id = $1 AND project_id = $2',
      [id, projectId]
    );
  },

  // Persist semantic grouping (services/intent/grouping.js). `assignments` is an
  // array of { id, groupLabel }. Applied in one transaction, project-scoped so a
  // stale/foreign id can never touch another project's rows. Returns the count
  // of rows actually updated.
  async setGroupLabels(projectId, assignments) {
    const rows = (Array.isArray(assignments) ? assignments : [])
      .filter((a) => a && typeof a.id === 'string');
    if (rows.length === 0) return 0;
    let updated = 0;
    const now = new Date().toISOString();
    await withTransaction(async (client) => {
      for (const a of rows) {
        const res = await client.query(
          `UPDATE intent_statements
             SET group_label = $1, updated_at = $2
             WHERE id = $3 AND project_id = $4`,
          [a.groupLabel ?? null, now, a.id, projectId]
        );
        updated += res.rowCount || 0;
      }
    });
    return updated;
  },
};

// ── Claims (Takeoff intent substrate — Phase 7 coordination) ──────
//
// A claim signals "someone (human or agent) is working on this intent or
// area". Consumed only by the MCP tools (claim_intent / get_my_gaps). A claim
// targets either a single statement_id OR a whole feature_area. See migration
// 020_claims.sql.

const claims = {
  async create({ projectId, statementId = null, featureArea = null, claimantType, claimantId }) {
    const id = crypto.randomUUID();
    const { rows } = await getDb().query(
      `INSERT INTO claims
        (id, project_id, statement_id, feature_area, claimant_type, claimant_id, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'active', now())
        RETURNING *`,
      [id, projectId, statementId, featureArea, claimantType, claimantId]
    );
    return rows[0];
  },

  // The single active claim on a specific statement, if any.
  async findActiveByStatement(projectId, statementId) {
    const { rows } = await getDb().query(
      `SELECT * FROM claims
        WHERE project_id = $1 AND statement_id = $2 AND status = 'active'
        LIMIT 1`,
      [projectId, statementId]
    );
    return rows[0] || null;
  },

  // The single active area-wide claim (statement_id IS NULL), if any.
  async findActiveByArea(projectId, featureArea) {
    const { rows } = await getDb().query(
      `SELECT * FROM claims
        WHERE project_id = $1 AND feature_area = $2
          AND statement_id IS NULL AND status = 'active'
        LIMIT 1`,
      [projectId, featureArea]
    );
    return rows[0] || null;
  },

  async findActiveByClaimant(projectId, claimantId) {
    const { rows } = await getDb().query(
      `SELECT * FROM claims
        WHERE project_id = $1 AND claimant_id = $2 AND status = 'active'
        ORDER BY created_at ASC`,
      [projectId, claimantId]
    );
    return rows;
  },

  async findActiveByProject(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM claims WHERE project_id = $1 AND status = 'active'
        ORDER BY created_at ASC`,
      [projectId]
    );
    return rows;
  },

  async release(id, projectId) {
    const { rows } = await getDb().query(
      `UPDATE claims SET status = 'released', released_at = now()
        WHERE id = $1 AND project_id = $2 AND status = 'active'
        RETURNING *`,
      [id, projectId]
    );
    return rows[0] || null;
  },
};

// ── Statement<->Job links (Takeoff intent substrate — jobs as the unit) ──────
//
// A many-to-many join between intent_statements (invariants) and map_jobs. An
// invariant serving multiple jobs (a shared model, a cross-job constraint) has
// several rows here — the future boundary/collision signal. Global guarantees
// (scope='global') have NO rows here. See migration 023_job_invariants.sql.

const statementJobs = {
  // Link a statement to a job (idempotent).
  async link(statementId, jobId) {
    await getDb().query(
      `INSERT INTO statement_jobs (id, statement_id, job_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (statement_id, job_id) DO NOTHING`,
      [crypto.randomUUID(), statementId, jobId]
    );
  },

  // Link one statement to many jobs in a single transaction.
  async linkMany(statementId, jobIds) {
    const ids = [...new Set((Array.isArray(jobIds) ? jobIds : []).filter(Boolean))];
    if (ids.length === 0) return;
    await withTransaction(async (client) => {
      for (const jobId of ids) {
        await client.query(
          `INSERT INTO statement_jobs (id, statement_id, job_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (statement_id, job_id) DO NOTHING`,
          [crypto.randomUUID(), statementId, jobId]
        );
      }
    });
  },

  // Remove every link for a job (used before regenerating that job's invariants).
  async deleteByJob(jobId) {
    await getDb().query('DELETE FROM statement_jobs WHERE job_id = $1', [jobId]);
  },

  // Full statement rows linked to a job (optionally filtered by status).
  async findStatementsForJob(jobId, { status } = {}) {
    const params = [jobId];
    let extra = '';
    if (status) {
      params.push(status);
      extra = ` AND s.status = $${params.length}`;
    }
    const { rows } = await getDb().query(
      `SELECT s.* FROM intent_statements s
        JOIN statement_jobs sj ON sj.statement_id = s.id
        WHERE sj.job_id = $1 AND s.archived = FALSE${extra}
        ORDER BY s.created_at ASC`,
      params
    );
    return rows;
  },

  // job_id list a statement is linked to.
  async findJobIdsForStatement(statementId) {
    const { rows } = await getDb().query(
      'SELECT job_id FROM statement_jobs WHERE statement_id = $1',
      [statementId]
    );
    return rows.map((r) => r.job_id);
  },

  // All (statement_id, job_id) links for a project — lets the read model group
  // invariants under jobs in one query.
  async findLinksForProject(projectId) {
    const { rows } = await getDb().query(
      `SELECT sj.statement_id, sj.job_id
         FROM statement_jobs sj
         JOIN intent_statements s ON s.id = sj.statement_id
        WHERE s.project_id = $1 AND s.archived = FALSE`,
      [projectId]
    );
    return rows;
  },
};

// ── Project reads ("The Read") ────────────────────────────────────
//
// One row per project: the derived "next thing to build" (title / why /
// builder prompt / category) plus the Pro-stub `read_unlocked` flag that
// gates the prompt. The row is machine-derived and re-derivable, so the
// upsert freely overwrites it — human decisions live on read_claims.
// See migration 024_project_reads.sql.

const projectReads = {
  // Insert or overwrite the project's read row. Re-derivation is cheap and
  // machine-owned, so conflicts always take the fresh values.
  async upsertForProject(projectId, { nextTitle, nextWhy, nextPrompt, nextCategory, draftedAt } = {}) {
    const { rows } = await getDb().query(
      `INSERT INTO project_reads
        (id, project_id, next_title, next_why, next_prompt, next_category, drafted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (project_id) DO UPDATE SET
          next_title    = EXCLUDED.next_title,
          next_why      = EXCLUDED.next_why,
          next_prompt   = EXCLUDED.next_prompt,
          next_category = EXCLUDED.next_category,
          drafted_at    = EXCLUDED.drafted_at,
          updated_at    = now()
        RETURNING *`,
      [
        crypto.randomUUID(),
        projectId,
        nextTitle ?? null,
        nextWhy ?? null,
        nextPrompt ?? null,
        nextCategory ?? null,
        draftedAt ?? new Date().toISOString(),
      ]
    );
    return rows[0];
  },

  async findByProjectId(projectId) {
    const { rows } = await getDb().query(
      'SELECT * FROM project_reads WHERE project_id = $1',
      [projectId]
    );
    return rows[0] || null;
  },

  async findByProjectIds(projectIds) {
    if (!projectIds.length) return [];
    const placeholders = projectIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await getDb().query(
      `SELECT * FROM project_reads WHERE project_id IN (${placeholders})`,
      projectIds
    );
    return rows;
  },

  async setUnlocked(projectId, unlocked) {
    const { rows } = await getDb().query(
      `UPDATE project_reads SET read_unlocked = $1, updated_at = now()
        WHERE project_id = $2
        RETURNING *`,
      [!!unlocked, projectId]
    );
    return rows[0] || null;
  },

  // Refresh only the derived next-thing (claim-correction re-derivation);
  // preserves drafted_at and the unlock flag.
  async updateNext(projectId, { nextTitle, nextWhy, nextPrompt, nextCategory } = {}) {
    const { rows } = await getDb().query(
      `UPDATE project_reads SET
          next_title    = $1,
          next_why      = $2,
          next_prompt   = $3,
          next_category = $4,
          updated_at    = now()
        WHERE project_id = $5
        RETURNING *`,
      [nextTitle ?? null, nextWhy ?? null, nextPrompt ?? null, nextCategory ?? null, projectId]
    );
    return rows[0] || null;
  },
};

// ── Read claims ("The Read" — the three slotted claims) ───────────
//
// Exactly three per project (objective / audience / core_job), identified by
// UNIQUE (project_id, slot). Drafted claims are machine output and get
// replaced wholesale on re-analysis; a settled claim is a human correction
// and is NEVER touched by the pipeline (the upsert's WHERE clause skips it).
// See migration 024_project_reads.sql.

const READ_SLOT_ORDER = `CASE slot
  WHEN 'objective' THEN 0
  WHEN 'audience'  THEN 1
  WHEN 'core_job'  THEN 2
  ELSE 3 END`;

const readClaims = {
  async findByProjectId(projectId) {
    const { rows } = await getDb().query(
      `SELECT * FROM read_claims WHERE project_id = $1
        ORDER BY ${READ_SLOT_ORDER}`,
      [projectId]
    );
    return rows;
  },

  async findByProjectIds(projectIds) {
    if (!projectIds.length) return [];
    const placeholders = projectIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await getDb().query(
      `SELECT * FROM read_claims WHERE project_id IN (${placeholders})
        ORDER BY project_id, ${READ_SLOT_ORDER}`,
      projectIds
    );
    return rows;
  },

  async findById(id, projectId) {
    const { rows } = await getDb().query(
      'SELECT * FROM read_claims WHERE id = $1 AND project_id = $2',
      [id, projectId]
    );
    return rows[0] || null;
  },

  // Insert or replace the drafted claim for (project_id, slot). Settled rows
  // are human decisions and are left completely untouched — the DO UPDATE's
  // WHERE clause makes the upsert a no-op for them (returns null).
  async upsertDraft(projectId, claim) {
    const { rows } = await getDb().query(
      `INSERT INTO read_claims
        (id, project_id, slot, text, confidence, status, source, evidence, alternative)
        VALUES ($1, $2, $3, $4, $5, 'drafted', 'inferred', $6, $7)
        ON CONFLICT (project_id, slot) DO UPDATE SET
          text        = EXCLUDED.text,
          confidence  = EXCLUDED.confidence,
          evidence    = EXCLUDED.evidence,
          alternative = EXCLUDED.alternative,
          status      = 'drafted',
          source      = 'inferred',
          settled_at  = NULL,
          updated_at  = now()
        WHERE read_claims.status <> 'settled'
        RETURNING *`,
      [
        crypto.randomUUID(),
        projectId,
        claim.slot,
        claim.text,
        claim.confidence ?? null,
        toJsonb(claim.evidence ?? []),
        claim.alternative == null ? null : toJsonb(claim.alternative),
      ]
    );
    return rows[0] || null;
  },

  // Human correction: set the text and promote the claim off the inferred
  // track. Settled claims survive every future re-analysis.
  async settle(id, projectId, { text }) {
    const { rows } = await getDb().query(
      `UPDATE read_claims SET
          text       = $1,
          status     = 'settled',
          source     = 'human',
          settled_at = now(),
          updated_at = now()
        WHERE id = $2 AND project_id = $3
        RETURNING *`,
      [text, id, projectId]
    );
    return rows[0] || null;
  },
};

module.exports = {
  getDb, closeDb, withTransaction, toJsonb,
  reviews, reviewFiles, fixPrompts, fixPromptEvents,
  analyses, deployments, githubRepoAccess, buildEntries, projectServices, projectEvents,
  suggestions, analysisFiles, analysisFileChunks, analysisLlmCalls, analysisEvents,
  commitReviews,
  productMap,
  shippedItems, webhookEvents, processedPushes, prChecks, securityShares,
  projectMembers, projectInvites, recommendations, userGithubLinks, MEMBER_LABELS,
  agreements, agreementVotes, notificationOutbox, driftDecisions,
  intentStatements, claims, statementJobs,
  projectReads, readClaims,
  // Pure query builders exported for unit tests only.
  buildBulkTierUpdateChunk, buildEventsInsertChunk,
};
