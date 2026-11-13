import { Client, Pool, type PoolClient } from 'pg';
import { getDbConfig } from './db.config';
import { runMigrations } from './migrate';

/** Anything that can run a query: the pool, or one client inside a transaction. */
export type Db = Pool | PoolClient;

let pool: Pool | null = null;

/**
 * Connect to PostgreSQL:
 * 1. create the database if it does not exist yet
 * 2. open a connection pool
 * 3. apply any new migration files (database/migrations/*.sql)
 */
export async function connectDatabase(): Promise<Pool> {
  if (pool) return pool;

  const { max, ...config } = getDbConfig();
  await createDatabaseIfMissing();

  const newPool = new Pool({ ...config, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  newPool.on('error', (error) => console.error('[Database] Idle connection error:', error.message));

  try {
    await runMigrations(newPool);
  } catch (error) {
    await newPool.end();
    throw error;
  }

  pool = newPool;
  console.log(`[Database] Connected to "${config.database}" on ${config.host}:${config.port}`);
  return pool;
}

/** The open pool. Throws if connectDatabase() was not called first. */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database is not connected. Call connectDatabase() first.');
  }
  return pool;
}

/** Close all connections. Safe to call more than once. */
export async function disconnectDatabase(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
  console.log('[Database] Connection closed');
}

/**
 * Run `work` inside one transaction: everything is saved, or nothing is (ROLLBACK on error).
 * Use the `client` passed to `work` for every query that belongs to the transaction.
 */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Connects to the default "postgres" database and creates DB_NAME if it is missing. */
async function createDatabaseIfMissing(): Promise<void> {
  const { max: _max, ...config } = getDbConfig();
  const client = new Client({ ...config, database: 'postgres', connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
    if (exists.rowCount === 0) {
      // A database name cannot be a $1 parameter, so it is quoted safely as an identifier.
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(config.database)}`);
      console.log(`[Database] Created database "${config.database}"`);
    }
  } finally {
    await client.end();
  }
}
