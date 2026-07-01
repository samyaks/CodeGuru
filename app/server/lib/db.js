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
  'suggestions_count', 'security_score',
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

const analysisEvents = {
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
]);
const INTENT_STATEMENTS_JSONB = new Set(['links']);
const INTENT_STATEMENTS_BOOL = new Set(['satisfied']);

const intentStatements = {
  async createBatch(items) {
    if (!items || items.length === 0) return;
    await withTransaction(async (client) => {
      for (const row of items) {
        await client.query(
          `INSERT INTO intent_statements
            (id, project_id, text, kind, status, source, feature_area, group_label,
             links, code_hash, satisfied, last_checked_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
          ]
        );
      }
    });
  },

  async findByProjectId(projectId, { status, featureArea } = {}) {
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

module.exports = {
  getDb, closeDb, withTransaction, toJsonb,
  reviews, reviewFiles, fixPrompts, fixPromptEvents,
  analyses, deployments, buildEntries, projectServices, projectEvents,
  suggestions, analysisFiles, analysisFileChunks, analysisLlmCalls, analysisEvents,
  commitReviews,
  productMap,
  shippedItems, webhookEvents, securityShares,
  intentStatements, claims,
};
