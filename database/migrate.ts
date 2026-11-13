import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_ID = 74_210_001; // any fixed number; stops two runs migrating at the same time

/**
 * Apply every migrations/NNN_name.sql file that has not been applied yet, in order.
 * Each file runs in its own transaction and is recorded in schema_migrations.
 * Never edit an applied file - add a new numbered file instead.
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(20)  PRIMARY KEY,
        file_name  VARCHAR(255) NOT NULL,
        checksum   CHAR(64)     NOT NULL,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((row) => [row.version, row.checksum]));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^\d+_[\w-]+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const version = file.split('_')[0];
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (done.has(version)) {
        if (done.get(version) !== checksum) {
          console.warn(`[Database] WARNING: ${file} changed after it was applied. Add a new migration instead.`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, file_name, checksum) VALUES ($1, $2, $3)', [
          version,
          file,
          checksum,
        ]);
        await client.query('COMMIT');
        applied.push(file);
        console.log(`[Database] Applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }

  return applied;
}
