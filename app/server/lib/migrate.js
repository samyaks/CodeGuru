#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const ADVISORY_LOCK_KEY = 8426179423109; // arbitrary bigint, must match across runners
const FORCE = process.env.FORCE_MIGRATE === '1';

async function main() {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL_DIRECT is required for migrations.');
    console.error('Migrations use pg_advisory_lock which requires a session-pooling or direct connection.');
    console.error('Set DATABASE_URL_DIRECT to the Supabase direct connection URL (db.<ref>.supabase.co:5432).');
    process.exit(1);
  }

  // Belt-and-suspenders: a pgbouncer pooler URL silently breaks advisory locks.
  if (/pooler\.supabase\.com/.test(connectionString)) {
    console.error('ERROR: DATABASE_URL_DIRECT appears to be a pgbouncer pooler URL.');
    console.error('Use the direct connection URL (db.<ref>.supabase.co:5432) for migrations.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in', MIGRATIONS_DIR);
      return;
    }

    const { rows: applied } = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => r.filename));

    for (const filename of files) {
      if (appliedSet.has(filename) && !FORCE) {
        console.log(`Skipping (already applied): ${filename}`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      const started = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        if (appliedSet.has(filename)) {
          // FORCE mode: update applied_at
          await client.query(
            'UPDATE schema_migrations SET applied_at = now() WHERE filename = $1',
            [filename]
          );
        } else {
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [filename]
          );
        }
        await client.query('COMMIT');
        console.log(`Applied ${filename} (${Date.now() - started} ms)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`Failed ${filename}:`, err.message);
        process.exitCode = 1;
        return;
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Migration runner error:', err);
  process.exit(1);
});
