import type { Db } from '../db.connection';
import type { BigId, ExecutionStatus } from '../types';

/** test_executions: the final result of one test case in one run (on one browser). */
export class TestExecutionRepository {
  constructor(private readonly db: Db) {}

  /** Returns the execution of this test in this run, creating it on the first attempt. */
  async getOrCreate(testRunId: BigId, testCaseId: number, browserId: number): Promise<BigId> {
    const { rows } = await this.db.query<{ test_execution_id: BigId }>(
      `INSERT INTO test_executions (test_run_id, test_case_id, browser_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (test_run_id, test_case_id, browser_id)
         DO UPDATE SET test_run_id = EXCLUDED.test_run_id   -- no-op, so RETURNING gives the existing id
       RETURNING test_execution_id`,
      [testRunId, testCaseId, browserId],
    );
    return rows[0].test_execution_id;
  }

  /** Set the final status and roll up start / end / duration from all attempts. */
  async updateFinalResult(executionId: BigId, finalStatus: ExecutionStatus): Promise<void> {
    await this.db.query(
      `UPDATE test_executions x
          SET final_status = $2,
              started_at   = a.first_start,
              finished_at  = a.last_end,
              duration_ms  = a.total_ms
         FROM (SELECT MIN(started_at)  AS first_start,
                      MAX(finished_at) AS last_end,
                      SUM(duration_ms) AS total_ms
                 FROM test_attempts
                WHERE test_execution_id = $1) a
        WHERE x.test_execution_id = $1`,
      [executionId, finalStatus],
    );
  }
}
