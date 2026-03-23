const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'reviews.db');

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
      completed_at TEXT
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
  `);

  return db;
}

const reviews = {
  create(review) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO reviews (id, type, repo_url, owner, repo, pr_number, branch, status, created_at)
      VALUES (@id, @type, @repo_url, @owner, @repo, @pr_number, @branch, @status, @created_at)
    `);
    stmt.run(review);
    return review;
  },

  findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  },

  list({ limit = 20, offset = 0 } = {}) {
    const db = getDb();
    return db.prepare('SELECT * FROM reviews ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  },

  updateStatus(id, status, extra = {}) {
    const db = getDb();
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

    db.prepare(`UPDATE reviews SET ${sets.join(', ')} WHERE id = @id`).run(params);
  },

  updateHumanNotes(id, notes) {
    const db = getDb();
    db.prepare('UPDATE reviews SET human_notes = ? WHERE id = ?').run(
      typeof notes === 'string' ? notes : JSON.stringify(notes),
      id
    );
  },
};

const reviewFiles = {
  create(file) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO review_files (id, review_id, file_path, diff, ai_comments, severity)
      VALUES (@id, @review_id, @file_path, @diff, @ai_comments, @severity)
    `);
    stmt.run({
      ...file,
      ai_comments: typeof file.ai_comments === 'string' ? file.ai_comments : JSON.stringify(file.ai_comments),
    });
    return file;
  },

  findByReviewId(reviewId) {
    const db = getDb();
    return db.prepare('SELECT * FROM review_files WHERE review_id = ? ORDER BY file_path').all(reviewId);
  },

  updateHumanComments(id, comments) {
    const db = getDb();
    db.prepare('UPDATE review_files SET human_comments = ? WHERE id = ?').run(
      typeof comments === 'string' ? comments : JSON.stringify(comments),
      id
    );
  },

  updateAiComments(id, comments, severity) {
    const db = getDb();
    db.prepare('UPDATE review_files SET ai_comments = ?, severity = ? WHERE id = ?').run(
      typeof comments === 'string' ? comments : JSON.stringify(comments),
      severity || null,
      id
    );
  },
};

module.exports = { getDb, reviews, reviewFiles };
