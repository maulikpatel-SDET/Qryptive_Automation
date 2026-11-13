import type { Db } from '../db.connection';
import type { AttemptInput, BigId } from '../types';

/** test_attempts: one row per try of a test (first run + every retry). */
export class TestAttemptRepository {
  constructor(private readonly db: Db) {}

  /**
   * Insert a new attempt. Returns null if this attempt number was already saved,
   * so the same attempt can never be stored twice.
   */
  async create(executionId: BigId, attempt: AttemptInput): Promise<BigId | null> {
    const durationMs = Math.round(attempt.durationMs);
    const finishedAt = new Date(attempt.startedAt.getTime() + durationMs);
    const { rows } = await this.db.query<{ test_attempt_id: BigId }>(
      `INSERT INTO test_attempts
         (test_execution_id, attempt_number, status, started_at, finished_at, duration_ms, worker_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (test_execution_id, attempt_number) DO NOTHING
       RETURNING test_attempt_id`,
      [
        executionId,
        attempt.number,
        attempt.status,
        attempt.startedAt,
        finishedAt,
        durationMs,
        attempt.workerIndex,
      ],
    );
    return rows[0]?.test_attempt_id ?? null;
  }
}
