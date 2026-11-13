import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

/** Project root folder (one level above /database). */
export const PROJECT_ROOT = path.join(__dirname, '..');

/** PostgreSQL connection settings. All values come from .env - nothing is hardcoded. */
export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number; // connection pool size
}

export function getDbConfig(): DbConfig {
  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Database settings missing in .env: ${missing.join(', ')}`);
  }

  return {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    max: Number(process.env.DB_POOL_MAX ?? 10),
  };
}

/** Saving results can be turned off with SAVE_RESULTS_TO_DB=false in .env */
export function isDatabaseEnabled(): boolean {
  return process.env.SAVE_RESULTS_TO_DB !== 'false';
}

/** The project these test results belong to (one framework can later serve more projects). */
export function getProjectInfo(): { key: string; name: string; description: string | null } {
  return {
    key: process.env.PROJECT_KEY ?? 'QRYPTIVE',
    name: process.env.PROJECT_NAME ?? 'Qryptive',
    description: process.env.PROJECT_DESCRIPTION ?? 'Qryptive web application - Playwright test automation',
  };
}

/** Folder where screenshots, traces, videos and log files are stored. */
export function getArtifactDir(): string {
  return path.resolve(PROJECT_ROOT, process.env.ARTIFACT_DIR ?? 'artifacts');
}
