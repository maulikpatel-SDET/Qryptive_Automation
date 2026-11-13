import type { Db } from '../db.connection';
import type { BigId, RunStatus } from '../types';

export interface NewRun {
  runUuid: string;
  environmentId: number;
  startedAt: Date;
  triggeredBy: string;
  hostName: string;
  playwrightVersion: string;
}

/** test_runs: one row per `npx playwright test` command. */
export class TestRunRepository {
  constructor(private readonly db: Db) {}

  async createRun(run: NewRun): Promise<BigId> {
    const { rows } = await this.db.query<{ test_run_id: BigId }>(
      `INSERT INTO test_runs (run_uuid, environment_id, started_at, triggered_by, host_name, playwright_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING test_run_id`,
      [run.runUuid, run.environmentId, run.startedAt, run.triggeredBy, run.hostName, run.playwrightVersion],
    );
    return rows[0].test_run_id;
  }

  /** Close the run and write its summary, counted from the saved executions. */
  async finishRun(testRunId: BigId, status: RunStatus, finishedAt: Date, durationMs: number): Promise<void> {
    await this.db.query(
      `UPDATE test_runs r
          SET status        = $2,
              finished_at   = $3,
              duration_ms   = $4,
              total_tests   = s.total,
              passed_count  = s.passed,
              failed_count  = s.failed,
              skipped_count = s.skipped,
              flaky_count   = s.flaky
         FROM (SELECT COUNT(*)                                          AS total,
                      COUNT(*) FILTER (WHERE final_status = 'PASSED')  AS passed,
                      COUNT(*) FILTER (WHERE final_status = 'FAILED')  AS failed,
                      COUNT(*) FILTER (WHERE final_status = 'SKIPPED') AS skipped,
                      COUNT(*) FILTER (WHERE final_status = 'FLAKY')   AS flaky
                 FROM test_executions
                WHERE test_run_id = $1) s
        WHERE r.test_run_id = $1`,
      [testRunId, status, finishedAt, durationMs],
    );
  }
}
