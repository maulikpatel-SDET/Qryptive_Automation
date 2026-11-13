import type { Db } from '../db.connection';

/**
 * Read-only queries for REST APIs and dashboards. Each method maps to one future API endpoint
 * (see database/README.md). They read from the v_* views created in 002_reporting_views.sql.
 */
export class ReportRepository {
  constructor(private readonly db: Db) {}

  /** GET /projects */
  async listProjects() {
    const { rows } = await this.db.query(
      `SELECT project_id, project_key, project_name, description, created_at, updated_at
         FROM projects ORDER BY project_name`,
    );
    return rows;
  }

  /** GET /projects/:projectKey/environments */
  async listEnvironments(projectKey: string) {
    const { rows } = await this.db.query(
      `SELECT e.environment_id, e.environment_key, e.environment_name, e.base_url, e.created_at, e.updated_at
         FROM environments e JOIN projects p ON p.project_id = e.project_id
        WHERE p.project_key = $1
        ORDER BY e.environment_key`,
      [projectKey],
    );
    return rows;
  }

  /** GET /projects/:projectKey/test-cases */
  async listTestCases(projectKey: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_test_case_stats WHERE project_key = $1 ORDER BY case_key`,
      [projectKey],
    );
    return rows;
  }

  /** GET /projects/:projectKey/runs */
  async getRunHistory(projectKey: string, limit = 20) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_test_run_summary WHERE project_key = $1 ORDER BY started_at DESC LIMIT $2`,
      [projectKey, limit],
    );
    return rows;
  }

  /** GET /runs/:runUuid  (run summary + its executions) */
  async getRunDetails(runUuid: string) {
    const summary = await this.db.query(`SELECT * FROM v_test_run_summary WHERE run_uuid = $1`, [runUuid]);
    if (summary.rowCount === 0) return null;
    const executions = await this.db.query(
      `SELECT * FROM v_test_execution_history WHERE run_uuid = $1 ORDER BY started_at`,
      [runUuid],
    );
    return { ...summary.rows[0], executions: executions.rows };
  }

  /** GET /projects/:projectKey/test-cases/:caseKey/history */
  async getTestCaseHistory(projectKey: string, caseKey: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_test_execution_history
        WHERE project_key = $1 AND case_key = $2
        ORDER BY started_at DESC NULLS LAST LIMIT $3`,
      [projectKey, caseKey, limit],
    );
    return rows;
  }

  /** GET /executions/:executionId/attempts */
  async getRetryHistory(executionId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_retry_history WHERE test_execution_id = $1 ORDER BY attempt_number`,
      [executionId],
    );
    return rows;
  }

  /** GET /executions/:executionId/artifacts?type=SCREENSHOT */
  async getArtifacts(executionId: string, type?: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_artifacts
        WHERE test_execution_id = $1 AND ($2::text IS NULL OR artifact_type = $2)
        ORDER BY attempt_number, artifact_type`,
      [executionId, type ?? null],
    );
    return rows;
  }

  /** GET /attempts/:attemptId/logs?level=ERROR */
  async getLogs(attemptId: string, level?: string) {
    const { rows } = await this.db.query(
      `SELECT log_id, sequence_no, log_level, log_source, message, logged_at
         FROM test_logs
        WHERE test_attempt_id = $1 AND ($2::text IS NULL OR log_level = $2)
        ORDER BY sequence_no`,
      [attemptId, level ?? null],
    );
    return rows;
  }

  /** GET /attempts/:attemptId/failures */
  async getFailures(attemptId: string) {
    const { rows } = await this.db.query(
      `SELECT failure_id, error_type, error_message, stack_trace, failure_file, failure_line,
              failure_column, code_snippet, created_at
         FROM test_failures WHERE test_attempt_id = $1 ORDER BY failure_id`,
      [attemptId],
    );
    return rows;
  }

  /** GET /projects/:projectKey/failures */
  async getFailureAnalysis(projectKey: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_failure_analysis WHERE project_key = $1 ORDER BY last_seen DESC LIMIT $2`,
      [projectKey, limit],
    );
    return rows;
  }

  /** GET /projects/:projectKey/durations */
  async getDurationReport(projectKey: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_duration_report WHERE project_key = $1 ORDER BY avg_ms DESC`,
      [projectKey],
    );
    return rows;
  }

  /** GET /projects/:projectKey/stats?days=30  (pass / fail per day, for trend charts) */
  async getDailyStats(projectKey: string, days = 30) {
    const { rows } = await this.db.query(
      `SELECT DATE(started_at)                                      AS day,
              COUNT(*)                                              AS total,
              COUNT(*) FILTER (WHERE final_status = 'PASSED')      AS passed,
              COUNT(*) FILTER (WHERE final_status = 'FAILED')      AS failed,
              COUNT(*) FILTER (WHERE final_status = 'SKIPPED')     AS skipped,
              COUNT(*) FILTER (WHERE final_status = 'FLAKY')       AS flaky
         FROM v_test_execution_history
        WHERE project_key = $1 AND started_at >= now() - make_interval(days => $2)
        GROUP BY DATE(started_at)
        ORDER BY day`,
      [projectKey, days],
    );
    return rows;
  }
}
