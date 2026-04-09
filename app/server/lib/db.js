const Database = require('better-sqlite3');
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

  return db;
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
  'updated_at', 'deployed_at', 'user_id', 'slug', 'social_summary',
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

module.exports = { getDb, closeDb, reviews, reviewFiles, fixPrompts, fixPromptEvents, analyses, deployments, buildEntries };
