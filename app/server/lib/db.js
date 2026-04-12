const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'takeoff.db');

let db;

function getDb() {
  if (db) return db;

  const fs = require('fs');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('pr', 'repo')),
      repo_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER,
      branch TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
      ai_report TEXT,
      human_notes TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS review_files (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      diff TEXT,
      ai_comments TEXT,
      human_comments TEXT,
      severity TEXT CHECK(severity IN ('critical', 'warning', 'info', 'ok')),
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fix_prompts (
      id TEXT PRIMARY KEY,
      short_id TEXT NOT NULL UNIQUE,
      review_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      issue_category TEXT,
      issue_title TEXT NOT NULL,
      issue_description TEXT NOT NULL,
      severity TEXT,
      code_snippet TEXT,
      reference_file_path TEXT,
      reference_snippet TEXT,
      related_files TEXT,
      full_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fix_prompt_events (
      id TEXT PRIMARY KEY,
      fix_prompt_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('page_view', 'copy_prompt', 'deeplink_click', 'feedback_up', 'feedback_down')),
      deeplink_target TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (fix_prompt_id) REFERENCES fix_prompts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      analysis TEXT,
      context_files TEXT,
      completion_pct INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      repo_url TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT DEFAULT 'main',
      framework TEXT,
      deploy_type TEXT,
      stack_info TEXT,
      build_plan TEXT,
      readiness_score INTEGER,
      readiness_categories TEXT,
      plan_steps TEXT,
      recommendation TEXT,
      railway_project_id TEXT,
      railway_service_id TEXT,
      railway_environment_id TEXT,
      railway_deployment_id TEXT,
      railway_domain TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','analyzing','scored','planning','ready',
                         'deploying','building','live','failed','stopped')),
      live_url TEXT,
      error TEXT,
      build_logs TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deployed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS build_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entry_type TEXT NOT NULL
        CHECK(entry_type IN ('prompt','note','decision','milestone','deploy_event','file')),
      title TEXT,
      content TEXT NOT NULL,
      metadata TEXT,
      is_public INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_services (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      service_type TEXT NOT NULL CHECK(service_type IN ('supabase', 'railway', 'vercel', 'github')),
      external_id TEXT,
      config TEXT DEFAULT '{}',
      synced_at TEXT,
      FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      event TEXT NOT NULL,
      path TEXT,
      referrer TEXT,
      device TEXT,
      session_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_events_event ON project_events(event);
    CREATE INDEX IF NOT EXISTS idx_project_events_created ON project_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_project_events_session ON project_events(project_id, session_id);

    CREATE TABLE IF NOT EXISTS suggestions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bug', 'fix', 'feature', 'idea', 'perf')),
      category TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('critical', 'high', 'medium', 'low')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT,
      effort TEXT,
      context_file TEXT,
      cursor_prompt TEXT,
      affected_files TEXT,
      related_docs TEXT,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'dismissed', 'done')),
      source TEXT NOT NULL CHECK(source IN ('static', 'ai')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_project ON suggestions(project_id);
    CREATE INDEX IF NOT EXISTS idx_suggestions_priority ON suggestions(project_id, priority);
  `);

  // Migrate existing databases
  try { db.exec('ALTER TABLE reviews ADD COLUMN user_id TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE analyses ADD COLUMN user_id TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE analyses ADD COLUMN features_summary TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN readiness_score INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN readiness_categories TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN plan_steps TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN recommendation TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN description TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN analysis_data TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN features_summary TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN slug TEXT'); } catch (_) {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_slug ON deployments(slug)'); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN social_summary TEXT'); } catch (_) {}
  try { db.exec(`ALTER TABLE deployments ADD COLUMN env_vars TEXT DEFAULT '{}'`); } catch (_) {}
  try { db.exec('ALTER TABLE deployments ADD COLUMN suggestions_count INTEGER DEFAULT 0'); } catch (_) {}

  return db;
}

function safeParseArr(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}

const reviews = {
  create(review) {
    const d = getDb();
    d.prepare(`INSERT INTO reviews (id, type, repo_url, owner, repo, pr_number, branch, status, created_at, user_id)
      VALUES (@id, @type, @repo_url, @owner, @repo, @pr_number, @branch, @status, @created_at, @user_id)`).run({
      ...review,
      user_id: review.user_id || null,
    });
    return review;
  },
  findById(id) {
    return getDb().prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  },
  list({ limit = 20, offset = 0, userId = null } = {}) {
    if (userId) {
      return getDb().prepare('SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset);
    }
    return getDb().prepare('SELECT * FROM reviews ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  },
  updateStatus(id, status, extra = {}) {
    const d = getDb();
    const sets = ['status = @status'];
    const params = { id, status };
    if (extra.ai_report !== undefined) {
      sets.push('ai_report = @ai_report');
      params.ai_report = typeof extra.ai_report === 'string' ? extra.ai_report : JSON.stringify(extra.ai_report);
    }
    if (extra.error !== undefined) {
      sets.push('error = @error');
      params.error = extra.error;
    }
    if (status === 'completed') {
      sets.push('completed_at = @completed_at');
      params.completed_at = new Date().toISOString();
    }
    d.prepare(`UPDATE reviews SET ${sets.join(', ')} WHERE id = @id`).run(params);
  },
  updateHumanNotes(id, notes) {
    getDb().prepare('UPDATE reviews SET human_notes = ? WHERE id = ?').run(
      typeof notes === 'string' ? notes : JSON.stringify(notes), id
    );
  },
};

const reviewFiles = {
  create(file) {
    getDb().prepare(`INSERT INTO review_files (id, review_id, file_path, diff, ai_comments, severity)
      VALUES (@id, @review_id, @file_path, @diff, @ai_comments, @severity)`).run({
      ...file,
      ai_comments: typeof file.ai_comments === 'string' ? file.ai_comments : JSON.stringify(file.ai_comments),
    });
    return file;
  },
  findByReviewId(reviewId) {
    return getDb().prepare('SELECT * FROM review_files WHERE review_id = ? ORDER BY file_path').all(reviewId);
  },
  updateHumanComments(id, comments) {
    getDb().prepare('UPDATE review_files SET human_comments = ? WHERE id = ?').run(
      typeof comments === 'string' ? comments : JSON.stringify(comments), id
    );
  },
  updateAiComments(id, comments, severity) {
    getDb().prepare('UPDATE review_files SET ai_comments = ?, severity = ? WHERE id = ?').run(
      typeof comments === 'string' ? comments : JSON.stringify(comments), severity || null, id
    );
  },
};

const fixPrompts = {
  create(prompt) {
    getDb().prepare(`INSERT INTO fix_prompts (id, short_id, review_id, file_path, line_start, line_end,
      issue_category, issue_title, issue_description, severity, code_snippet,
      reference_file_path, reference_snippet, related_files, full_prompt, created_at, expires_at)
      VALUES (@id, @short_id, @review_id, @file_path, @line_start, @line_end,
      @issue_category, @issue_title, @issue_description, @severity, @code_snippet,
      @reference_file_path, @reference_snippet, @related_files, @full_prompt, @created_at, @expires_at)`).run({
      ...prompt,
      related_files: typeof prompt.related_files === 'string' ? prompt.related_files : JSON.stringify(prompt.related_files || []),
    });
    return prompt;
  },
  findByShortId(shortId) {
    return getDb().prepare('SELECT * FROM fix_prompts WHERE short_id = ? AND expires_at > ?').get(shortId, new Date().toISOString());
  },
  findByReviewId(reviewId) {
    return getDb().prepare('SELECT * FROM fix_prompts WHERE review_id = ? ORDER BY file_path, line_start').all(reviewId);
  },
  shortIdExists(shortId) {
    return !!getDb().prepare('SELECT 1 FROM fix_prompts WHERE short_id = ?').get(shortId);
  },
};

const fixPromptEvents = {
  create(event) {
    getDb().prepare(`INSERT INTO fix_prompt_events (id, fix_prompt_id, event_type, deeplink_target, created_at)
      VALUES (@id, @fix_prompt_id, @event_type, @deeplink_target, @created_at)`).run(event);
    return event;
  },
};

// ── Deployments ──

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
  create(deployment) {
    getDb().prepare(`INSERT INTO deployments (id, user_id, repo_url, owner, repo, branch, status, created_at)
      VALUES (@id, @user_id, @repo_url, @owner, @repo, @branch, @status, @created_at)`).run({
      branch: 'main',
      user_id: null,
      ...deployment,
    });
    return deployment;
  },
  findById(id) {
    return getDb().prepare('SELECT * FROM deployments WHERE id = ?').get(id);
  },
  findBySlug(slug) {
    return getDb().prepare('SELECT * FROM deployments WHERE slug = ?').get(slug);
  },
  findByUserId(userId, { limit = 20, offset = 0 } = {}) {
    return getDb().prepare(
      'SELECT * FROM deployments WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(userId, limit, offset);
  },
  update(id, fields) {
    const d = getDb();
    const sets = [];
    const params = { id };
    for (const [key, value] of Object.entries(fields)) {
      if (!DEPLOYMENTS_ALLOWED_COLUMNS.has(key)) continue;
      sets.push(`${key} = @${key}`);
      params[key] = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    }
    if (sets.length > 0) {
      d.prepare(`UPDATE deployments SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
  },
  delete(id) {
    getDb().prepare('DELETE FROM deployments WHERE id = ?').run(id);
  },
  countUserDeployments(userId) {
    const row = getDb().prepare(
      "SELECT COUNT(*) as count FROM deployments WHERE user_id = ? AND status IN ('live', 'building', 'deploying')"
    ).get(userId);
    return row.count;
  },
  countUserActiveBuilds(userId) {
    const row = getDb().prepare(
      "SELECT COUNT(*) as count FROM deployments WHERE user_id = ? AND status IN ('building', 'deploying')"
    ).get(userId);
    return row.count;
  },
};

// ── Build Entries (BuildStory) ──

const buildEntries = {
  create(entry) {
    const prepared = {
      is_public: 0,
      sort_order: 0,
      ...entry,
      metadata: entry.metadata && typeof entry.metadata === 'object'
        ? JSON.stringify(entry.metadata) : (entry.metadata || null),
    };
    getDb().prepare(`INSERT INTO build_entries
      (id, project_id, user_id, entry_type, title, content, metadata, is_public, created_at, sort_order)
      VALUES (@id, @project_id, @user_id, @entry_type, @title, @content, @metadata, @is_public, @created_at, @sort_order)`).run(prepared);
    return entry;
  },
  findByProjectId(projectId, { limit = 100, offset = 0 } = {}) {
    return getDb().prepare(
      'SELECT * FROM build_entries WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT ? OFFSET ?'
    ).all(projectId, limit, offset);
  },
  findPublicByProjectId(projectId) {
    return getDb().prepare(
      'SELECT * FROM build_entries WHERE project_id = ? AND is_public = 1 ORDER BY sort_order ASC, created_at ASC'
    ).all(projectId);
  },
  findById(id) {
    return getDb().prepare('SELECT * FROM build_entries WHERE id = ?').get(id);
  },
  update(id, fields) {
    const d = getDb();
    const allowed = new Set(['title', 'content', 'metadata', 'is_public', 'updated_at', 'sort_order', 'entry_type']);
    const sets = [];
    const params = { id };
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key)) continue;
      sets.push(`${key} = @${key}`);
      params[key] = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    }
    if (sets.length > 0) {
      d.prepare(`UPDATE build_entries SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
  },
  delete(id) {
    getDb().prepare('DELETE FROM build_entries WHERE id = ?').run(id);
  },
};

// ── Project Services ──

const projectServices = {
  create(data) {
    const d = getDb();
    const id = crypto.randomUUID();
    d.prepare(
      'INSERT INTO project_services (id, project_id, service_type, external_id, config) VALUES (?, ?, ?, ?, ?)'
    ).run(id, data.project_id, data.service_type, data.external_id || null, JSON.stringify(data.config || {}));
    return { id, ...data };
  },
  findByProject(projectId) {
    return getDb().prepare('SELECT * FROM project_services WHERE project_id = ?').all(projectId);
  },
  update(id, data) {
    const sets = [];
    const vals = [];
    if (data.external_id !== undefined) { sets.push('external_id = ?'); vals.push(data.external_id); }
    if (data.config !== undefined) { sets.push('config = ?'); vals.push(JSON.stringify(data.config)); }
    if (data.synced_at !== undefined) { sets.push('synced_at = ?'); vals.push(data.synced_at); }
    if (sets.length === 0) return;
    vals.push(id);
    getDb().prepare(`UPDATE project_services SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  },
  delete(id) {
    getDb().prepare('DELETE FROM project_services WHERE id = ?').run(id);
  },
};

// ── Project Events (Analytics) ──

const projectEvents = {
  create(event) {
    getDb().prepare(`INSERT INTO project_events (id, project_id, event, path, referrer, device, session_id, metadata, created_at)
      VALUES (@id, @project_id, @event, @path, @referrer, @device, @session_id, @metadata, @created_at)`).run({
      ...event,
      metadata: event.metadata && typeof event.metadata === 'object'
        ? JSON.stringify(event.metadata) : (event.metadata || null),
    });
    return event;
  },

  createBatch(events) {
    const d = getDb();
    const stmt = d.prepare(`INSERT INTO project_events (id, project_id, event, path, referrer, device, session_id, metadata, created_at)
      VALUES (@id, @project_id, @event, @path, @referrer, @device, @session_id, @metadata, @created_at)`);
    const tx = d.transaction((rows) => {
      for (const row of rows) {
        stmt.run({
          ...row,
          metadata: row.metadata && typeof row.metadata === 'object'
            ? JSON.stringify(row.metadata) : (row.metadata || null),
        });
      }
    });
    tx(events);
  },

  findByProjectId(projectId, { event, since, limit = 100 } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (event) { conditions.push('event = ?'); params.push(event); }
    if (since) { conditions.push('created_at >= ?'); params.push(since); }
    params.push(limit);
    return getDb().prepare(
      `SELECT * FROM project_events WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
    ).all(...params);
  },

  countByProject(projectId, { event, since } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (event) { conditions.push('event = ?'); params.push(event); }
    if (since) { conditions.push('created_at >= ?'); params.push(since); }
    const row = getDb().prepare(
      `SELECT COUNT(*) as count FROM project_events WHERE ${conditions.join(' AND ')}`
    ).get(...params);
    return row.count;
  },

  aggregateByPath(projectId, { since } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (since) { conditions.push('created_at >= ?'); params.push(since); }
    return getDb().prepare(
      `SELECT path, COUNT(*) as count FROM project_events WHERE ${conditions.join(' AND ')} GROUP BY path ORDER BY count DESC`
    ).all(...params);
  },

  aggregateByReferrer(projectId, { since } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (since) { conditions.push('created_at >= ?'); params.push(since); }
    return getDb().prepare(
      `SELECT referrer, COUNT(*) as count FROM project_events WHERE ${conditions.join(' AND ')} GROUP BY referrer ORDER BY count DESC`
    ).all(...params);
  },

  aggregateByEvent(projectId, { since } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (since) { conditions.push('created_at >= ?'); params.push(since); }
    return getDb().prepare(
      `SELECT event, COUNT(*) as count FROM project_events WHERE ${conditions.join(' AND ')} GROUP BY event ORDER BY count DESC`
    ).all(...params);
  },

  uniqueSessions(projectId, { since } = {}) {
    const conditions = ['project_id = ?'];
    const params = [projectId];
    if (since) { conditions.push('created_at >= ?'); params.push(since); }
    const row = getDb().prepare(
      `SELECT COUNT(DISTINCT session_id) as count FROM project_events WHERE ${conditions.join(' AND ')}`
    ).get(...params);
    return row.count;
  },

  overviewStats(projectId, { today, week, month }) {
    const row = getDb().prepare(`
      SELECT
        COUNT(DISTINCT CASE WHEN created_at >= ? THEN session_id END) AS visitors_today,
        COUNT(DISTINCT CASE WHEN created_at >= ? THEN session_id END) AS visitors_week,
        COUNT(DISTINCT CASE WHEN created_at >= ? THEN session_id END) AS visitors_month,
        SUM(CASE WHEN event = 'pageview' AND created_at >= ? THEN 1 ELSE 0 END) AS pageviews_today,
        SUM(CASE WHEN event = 'pageview' AND created_at >= ? THEN 1 ELSE 0 END) AS pageviews_week,
        SUM(CASE WHEN event = 'pageview' AND created_at >= ? THEN 1 ELSE 0 END) AS pageviews_month
      FROM project_events
      WHERE project_id = ?
    `).get(today, week, month, today, week, month, projectId);
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

// ── Suggestions ──

const suggestions = {
  createBatch(items) {
    const d = getDb();
    const stmt = d.prepare(`INSERT OR IGNORE INTO suggestions 
      (id, project_id, type, category, priority, title, description, evidence, effort, cursor_prompt, affected_files, source, status, created_at)
      VALUES (@id, @project_id, @type, @category, @priority, @title, @description, @evidence, @effort, @cursor_prompt, @affected_files, @source, @status, @created_at)`);
    const tx = d.transaction((rows) => {
      for (const row of rows) {
        const scopedId = row.project_id
          ? crypto.createHash('sha256').update(row.project_id + ':' + row.id).digest('hex').slice(0, 16)
          : row.id;
        stmt.run({
          ...row,
          id: scopedId,
          evidence: JSON.stringify(row.evidence || []),
          affected_files: JSON.stringify(row.affected_files || []),
          status: row.status || 'open',
          created_at: row.created_at || new Date().toISOString(),
        });
      }
    });
    tx(items);
  },
  findByProjectId(projectId) {
    const rows = getDb().prepare(
      'SELECT * FROM suggestions WHERE project_id = ? ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, created_at DESC'
    ).all(projectId);
    return rows.map(r => ({
      ...r,
      evidence: safeParseArr(r.evidence),
      affected_files: safeParseArr(r.affected_files),
    }));
  },
  updateStatus(id, projectId, status) {
    getDb().prepare('UPDATE suggestions SET status = ? WHERE id = ? AND project_id = ?').run(status, id, projectId);
  },
  deleteByProjectId(projectId) {
    getDb().prepare('DELETE FROM suggestions WHERE project_id = ?').run(projectId);
  },
  countByProjectId(projectId) {
    const row = getDb().prepare(
      `SELECT COUNT(*) as total,
        COALESCE(SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END), 0) as critical,
        COALESCE(SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END), 0) as high,
        COALESCE(SUM(CASE WHEN priority = 'medium' THEN 1 ELSE 0 END), 0) as medium,
        COALESCE(SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END), 0) as low
      FROM suggestions WHERE project_id = ? AND status = 'open'`
    ).get(projectId);
    return row;
  },
  summary(projectId) {
    const rows = getDb().prepare(
      'SELECT type, COUNT(*) as count FROM suggestions WHERE project_id = ? AND status = \'open\' GROUP BY type'
    ).all(projectId);
    const byType = {};
    for (const r of rows) byType[r.type] = r.count;
    const counts = this.countByProjectId(projectId);
    return { total: counts.total, byType, byPriority: { critical: counts.critical, high: counts.high, medium: counts.medium, low: counts.low } };
  },
};

// ── Analyses ──

const ANALYSES_ALLOWED_COLUMNS = new Set([
  'status', 'owner', 'repo', 'analysis', 'context_files', 'completion_pct', 'completed_at', 'user_id', 'features_summary',
]);

const analyses = {
  create(analysis) {
    getDb().prepare(`INSERT INTO analyses (id, repo_url, owner, repo, status, created_at, user_id)
      VALUES (@id, @repo_url, @owner, @repo, @status, @created_at, @user_id)`).run({
      ...analysis,
      user_id: analysis.user_id || null,
    });
    return analysis;
  },
  findById(id) {
    return getDb().prepare('SELECT * FROM analyses WHERE id = ?').get(id);
  },
  list({ limit = 20, offset = 0, userId = null } = {}) {
    if (userId) {
      return getDb().prepare('SELECT * FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limit, offset);
    }
    return getDb().prepare('SELECT * FROM analyses ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  },
  update(id, fields) {
    const d = getDb();
    const sets = [];
    const params = { id };
    for (const [key, value] of Object.entries(fields)) {
      if (!ANALYSES_ALLOWED_COLUMNS.has(key)) {
        console.warn(`analyses.update: ignoring unknown column "${key}"`);
        continue;
      }
      sets.push(`${key} = @${key}`);
      params[key] = typeof value === 'object' ? JSON.stringify(value) : value;
    }
    if (sets.length > 0) {
      d.prepare(`UPDATE analyses SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
  },
};

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, reviews, reviewFiles, fixPrompts, fixPromptEvents, analyses, deployments, buildEntries, projectServices, projectEvents, suggestions };
