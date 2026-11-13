-- =============================================================================
-- 002_reporting_views.sql
-- Read-only views for REST APIs and dashboards. They join the normalized tables
-- back together so an API can answer with one simple SELECT.
-- =============================================================================

-- Test runs with project / environment names and pass rate.
CREATE VIEW v_test_run_summary AS
SELECT r.test_run_id,
       r.run_uuid,
       p.project_key,
       p.project_name,
       e.environment_key,
       e.environment_name,
       e.base_url,
       r.status,
       r.started_at,
       r.finished_at,
       r.duration_ms,
       r.total_tests,
       r.passed_count,
       r.failed_count,
       r.skipped_count,
       r.flaky_count,
       ROUND(100.0 * (r.passed_count + r.flaky_count)
             / NULLIF(r.total_tests - r.skipped_count, 0), 2) AS pass_rate,
       r.triggered_by,
       r.host_name,
       r.playwright_version
FROM test_runs r
JOIN environments e ON e.environment_id = r.environment_id
JOIN projects p     ON p.project_id = e.project_id;

-- Every test execution with test case, suite, run, environment and browser details.
CREATE VIEW v_test_execution_history AS
SELECT x.test_execution_id,
       r.test_run_id,
       r.run_uuid,
       p.project_key,
       e.environment_key,
       s.suite_id,
       s.suite_name,
       s.file_path,
       c.test_case_id,
       c.case_key,
       c.case_name,
       b.browser_name,
       b.channel AS browser_channel,
       x.final_status,
       (SELECT COUNT(*) FROM test_attempts a WHERE a.test_execution_id = x.test_execution_id) AS attempt_count,
       x.started_at,
       x.finished_at,
       x.duration_ms
FROM test_executions x
JOIN test_runs r    ON r.test_run_id = x.test_run_id
JOIN environments e ON e.environment_id = r.environment_id
JOIN projects p     ON p.project_id = e.project_id
JOIN test_cases c   ON c.test_case_id = x.test_case_id
JOIN test_suites s  ON s.suite_id = c.suite_id
JOIN browsers b     ON b.browser_id = x.browser_id;

-- Test case list with tags and lifetime statistics.
CREATE VIEW v_test_case_stats AS
SELECT c.test_case_id,
       p.project_key,
       c.case_key,
       c.case_name,
       c.description,
       s.suite_name,
       s.file_path,
       c.line_number,
       c.is_active,
       (SELECT STRING_AGG(t.tag_name, ', ' ORDER BY t.tag_name)
          FROM test_case_tags ct JOIN tags t ON t.tag_id = ct.tag_id
         WHERE ct.test_case_id = c.test_case_id) AS tags,
       COUNT(x.test_execution_id)                                AS total_executions,
       COUNT(*) FILTER (WHERE x.final_status = 'PASSED')         AS passed,
       COUNT(*) FILTER (WHERE x.final_status = 'FAILED')         AS failed,
       COUNT(*) FILTER (WHERE x.final_status = 'SKIPPED')        AS skipped,
       COUNT(*) FILTER (WHERE x.final_status = 'FLAKY')          AS flaky,
       ROUND(100.0 * COUNT(*) FILTER (WHERE x.final_status IN ('PASSED', 'FLAKY'))
             / NULLIF(COUNT(*) FILTER (WHERE x.final_status IN ('PASSED', 'FLAKY', 'FAILED')), 0), 2) AS pass_rate,
       ROUND(AVG(x.duration_ms) FILTER (WHERE x.final_status IN ('PASSED', 'FLAKY'))) AS avg_duration_ms,
       MAX(x.started_at)                                         AS last_executed_at,
       (SELECT x2.final_status FROM test_executions x2
         WHERE x2.test_case_id = c.test_case_id AND x2.final_status <> 'RUNNING'
         ORDER BY x2.started_at DESC NULLS LAST LIMIT 1)         AS last_status
FROM test_cases c
JOIN test_suites s ON s.suite_id = c.suite_id
JOIN projects p    ON p.project_id = s.project_id
LEFT JOIN test_executions x ON x.test_case_id = c.test_case_id AND x.final_status <> 'RUNNING'
GROUP BY c.test_case_id, s.suite_id, p.project_id;

-- Every attempt (first try + retries) with its execution and test case.
CREATE VIEW v_retry_history AS
SELECT a.test_attempt_id,
       a.test_execution_id,
       r.run_uuid,
       p.project_key,
       c.case_key,
       c.case_name,
       a.attempt_number,
       a.status AS attempt_status,
       x.final_status,
       a.started_at,
       a.finished_at,
       a.duration_ms,
       a.worker_index
FROM test_attempts a
JOIN test_executions x ON x.test_execution_id = a.test_execution_id
JOIN test_runs r       ON r.test_run_id = x.test_run_id
JOIN environments e    ON e.environment_id = r.environment_id
JOIN projects p        ON p.project_id = e.project_id
JOIN test_cases c      ON c.test_case_id = x.test_case_id;

-- Screenshots, traces, videos and log files with their test context.
CREATE VIEW v_artifacts AS
SELECT f.artifact_id,
       f.artifact_type,
       f.file_name,
       f.file_path,
       f.storage_type,
       f.content_type,
       f.size_bytes,
       f.created_at,
       a.test_attempt_id,
       a.attempt_number,
       a.test_execution_id,
       r.run_uuid,
       p.project_key,
       c.case_key,
       c.case_name
FROM test_artifacts f
JOIN test_attempts a   ON a.test_attempt_id = f.test_attempt_id
JOIN test_executions x ON x.test_execution_id = a.test_execution_id
JOIN test_runs r       ON r.test_run_id = x.test_run_id
JOIN environments e    ON e.environment_id = r.environment_id
JOIN projects p        ON p.project_id = e.project_id
JOIN test_cases c      ON c.test_case_id = x.test_case_id;

-- Failures grouped by test case + error type + first line of the message.
CREATE VIEW v_failure_analysis AS
SELECT p.project_key,
       c.case_key,
       c.case_name,
       f.error_type,
       SPLIT_PART(f.error_message, E'\n', 1) AS error_summary,
       COUNT(*)                              AS occurrences,
       COUNT(DISTINCT x.test_run_id)         AS affected_runs,
       MIN(f.created_at)                     AS first_seen,
       MAX(f.created_at)                     AS last_seen
FROM test_failures f
JOIN test_attempts a   ON a.test_attempt_id = f.test_attempt_id
JOIN test_executions x ON x.test_execution_id = a.test_execution_id
JOIN test_runs r       ON r.test_run_id = x.test_run_id
JOIN environments e    ON e.environment_id = r.environment_id
JOIN projects p        ON p.project_id = e.project_id
JOIN test_cases c      ON c.test_case_id = x.test_case_id
GROUP BY p.project_key, c.case_key, c.case_name, f.error_type, SPLIT_PART(f.error_message, E'\n', 1);

-- Duration statistics of passed attempts per test case.
CREATE VIEW v_duration_report AS
SELECT p.project_key,
       c.case_key,
       c.case_name,
       COUNT(*)                                                         AS passed_attempts,
       MIN(a.duration_ms)                                               AS min_ms,
       ROUND(AVG(a.duration_ms))                                        AS avg_ms,
       MAX(a.duration_ms)                                               AS max_ms,
       ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY a.duration_ms)) AS p95_ms
FROM test_attempts a
JOIN test_executions x ON x.test_execution_id = a.test_execution_id
JOIN test_runs r       ON r.test_run_id = x.test_run_id
JOIN environments e    ON e.environment_id = r.environment_id
JOIN projects p        ON p.project_id = e.project_id
JOIN test_cases c      ON c.test_case_id = x.test_case_id
WHERE a.status = 'PASSED'
GROUP BY p.project_key, c.case_key, c.case_name;
