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
  'suggestions_count',
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
};

// ── Analyses ──────────────────────────────────────────────────────

const ANALYSES_ALLOWED_COLUMNS = new Set([
  'status', 'owner', 'repo', 'analysis', 'context_files', 'completion_pct', 'completed_at', 'user_id', 'features_summary',
  'file_count', 'tree_total_bytes', 'tree_estimated_tokens', 'tree_truncated',
  'ingested_file_count', 'ingested_bytes', 'ingested_tokens',
  'llm_call_count', 'llm_input_tokens', 'llm_output_tokens', 'llm_cost_usd',
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
  async incrementLlm(id, { calls = 1, input_tokens = 0, output_tokens = 0, cost_usd = 0 } = {}) {
    await getDb().query(
      `UPDATE analyses
        SET llm_call_count    = COALESCE(llm_call_count, 0)    + $1,
            llm_input_tokens  = COALESCE(llm_input_tokens, 0)  + $2,
            llm_output_tokens = COALESCE(llm_output_tokens, 0) + $3,
            llm_cost_usd      = COALESCE(llm_cost_usd, 0)      + $4
        WHERE id = $5`,
      [calls || 0, input_tokens || 0, output_tokens || 0, cost_usd || 0, id]
    );
  },
  async getRollups(id) {
    const { rows } = await getDb().query(
      `SELECT file_count, tree_total_bytes, tree_estimated_tokens, tree_truncated,
              ingested_file_count, ingested_bytes, ingested_tokens,
              llm_call_count, llm_input_tokens, llm_output_tokens, llm_cost_usd
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
          const base = idx * 8;
          values.push(
            crypto.randomUUID(),
            analysisId,
            r.path,
            r.sha ?? null,
            r.size_bytes ?? 0,
            r.language ?? null,
            r.score ?? null,
            r.depth ?? null
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
        });
        await client.query(
          `INSERT INTO analysis_files
            (id, analysis_id, path, sha, size_bytes, language, score, depth)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (analysis_id, path) DO NOTHING`,
          values
        );
      }
    });
  },

  async updateTier(analysisId, filePath, fields) {
    const allowed = ['tier', 'content', 'skeleton', 'content_tokens', 'skeleton_tokens', 'fetched_at', 'skip_reason'];
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
         duration_ms, target_path, files_used, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        COUNT(*)::int                           AS call_count,
        COALESCE(SUM(input_tokens), 0)::int     AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int    AS output_tokens,
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

module.exports = {
  getDb, closeDb, withTransaction, toJsonb,
  reviews, reviewFiles, fixPrompts, fixPromptEvents,
  analyses, deployments, buildEntries, projectServices, projectEvents,
  suggestions, analysisFiles, analysisFileChunks, analysisLlmCalls, analysisEvents,
  commitReviews,
  productMap,
};
