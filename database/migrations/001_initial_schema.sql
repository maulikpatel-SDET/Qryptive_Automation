-- =============================================================================
-- 001_initial_schema.sql
-- Normalized schema for Qryptive test automation results.
--
--   projects ─┬─< environments ──< test_runs ──< test_executions ──< test_attempts ─┬─< test_artifacts
--             └─< test_suites ──< test_cases ──────────┘   │                         ├─< test_logs
--                                     └─< test_case_tags >─ tags                     └─< test_failures
--                                 browsers ──────────────────┘
-- =============================================================================

-- Keeps updated_at current, but only when a row really changed.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------- PROJECT LEVEL

CREATE TABLE projects (
  project_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_key   VARCHAR(50)  NOT NULL UNIQUE,          -- e.g. QRYPTIVE
  project_name  VARCHAR(150) NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE environments (
  environment_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       INT          NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  environment_key  VARCHAR(50)  NOT NULL,             -- qa / staging / production
  environment_name VARCHAR(100) NOT NULL,             -- QA / Staging / Production
  base_url         TEXT         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_environment UNIQUE (project_id, environment_key)
);

-- ---------------------------------------------------------------- TESTCASE LEVEL

-- One suite = one spec file (e.g. tests/LoginTest.spec.ts).
CREATE TABLE test_suites (
  suite_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   INT          NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
  suite_name   VARCHAR(255) NOT NULL,                 -- top-level describe(), e.g. "Qryptive Login"
  file_path    TEXT         NOT NULL,                 -- source file of every test case in the suite
  description  TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_suite_file UNIQUE (project_id, file_path)
);

CREATE TABLE test_cases (
  test_case_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  suite_id     INT          NOT NULL REFERENCES test_suites (suite_id) ON DELETE CASCADE,
  case_key     VARCHAR(100) NOT NULL,                 -- e.g. TC04
  case_name    VARCHAR(255) NOT NULL,                 -- e.g. Login page shows all elements
  description  TEXT,
  title_path   TEXT,                                  -- e.g. Qryptive Login > With saved session
  line_number  INT,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_test_case UNIQUE (suite_id, case_key)
);

-- Tags are many-to-many (1NF: no comma-separated lists in a column).
CREATE TABLE tags (
  tag_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag_name   VARCHAR(100) NOT NULL UNIQUE,            -- e.g. loginpage, dashboard
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE test_case_tags (
  test_case_id INT NOT NULL REFERENCES test_cases (test_case_id) ON DELETE CASCADE,
  tag_id       INT NOT NULL REFERENCES tags (tag_id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, tag_id)
);

CREATE TABLE browsers (
  browser_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  browser_name VARCHAR(50) NOT NULL,                  -- chromium / firefox / webkit
  channel      VARCHAR(50),                           -- chrome / msedge / NULL
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_browser UNIQUE NULLS NOT DISTINCT (browser_name, channel)
);

-- --------------------------------------------------------------- EXECUTION LEVEL

-- One row per "npx playwright test" run.
CREATE TABLE test_runs (
  test_run_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_uuid           UUID         NOT NULL UNIQUE,
  environment_id     INT          NOT NULL REFERENCES environments (environment_id),
  status             VARCHAR(20)  NOT NULL DEFAULT 'RUNNING'
                     CHECK (status IN ('RUNNING', 'PASSED', 'FAILED', 'TIMEDOUT', 'INTERRUPTED')),
  started_at         TIMESTAMPTZ  NOT NULL,
  finished_at        TIMESTAMPTZ,
  duration_ms        BIGINT,
  -- run summary, written once when the run finishes (snapshot for fast dashboards)
  total_tests        INT          NOT NULL DEFAULT 0,
  passed_count       INT          NOT NULL DEFAULT 0,
  failed_count       INT          NOT NULL DEFAULT 0,
  skipped_count      INT          NOT NULL DEFAULT 0,
  flaky_count        INT          NOT NULL DEFAULT 0,
  triggered_by       VARCHAR(100),
  host_name          VARCHAR(255),
  playwright_version VARCHAR(30),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One row per test case per run per browser: the FINAL result after all retries.
CREATE TABLE test_executions (
  test_execution_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_run_id       BIGINT      NOT NULL REFERENCES test_runs (test_run_id) ON DELETE CASCADE,
  test_case_id      INT         NOT NULL REFERENCES test_cases (test_case_id),
  browser_id        INT         NOT NULL REFERENCES browsers (browser_id),
  final_status      VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
                    CHECK (final_status IN ('RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'FLAKY')),
  started_at        TIMESTAMPTZ,                      -- start of the first attempt
  finished_at       TIMESTAMPTZ,                      -- end of the last attempt
  duration_ms       BIGINT,                           -- total time of all attempts
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_execution UNIQUE (test_run_id, test_case_id, browser_id)
);

-- One row per try. Retries add new rows - history is never overwritten.
CREATE TABLE test_attempts (
  test_attempt_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_execution_id BIGINT      NOT NULL REFERENCES test_executions (test_execution_id) ON DELETE CASCADE,
  attempt_number    SMALLINT    NOT NULL CHECK (attempt_number >= 1),
  status            VARCHAR(20) NOT NULL
                    CHECK (status IN ('PASSED', 'FAILED', 'SKIPPED', 'TIMEDOUT', 'INTERRUPTED')),
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ NOT NULL,
  duration_ms       BIGINT      NOT NULL,
  worker_index      INT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_attempt UNIQUE (test_execution_id, attempt_number)
);

-- ------------------------------------------------------------ LOGS AND ARTIFACTS

-- File metadata only - the files themselves live on disk / object storage.
CREATE TABLE test_artifacts (
  artifact_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_attempt_id BIGINT       NOT NULL REFERENCES test_attempts (test_attempt_id) ON DELETE CASCADE,
  artifact_type   VARCHAR(30)  NOT NULL
                  CHECK (artifact_type IN ('SCREENSHOT', 'TRACE', 'VIDEO', 'STDOUT_LOG', 'FAILURE_LOG', 'OTHER')),
  file_name       VARCHAR(255) NOT NULL,
  file_path       TEXT         NOT NULL,              -- relative to the storage root
  storage_type    VARCHAR(20)  NOT NULL DEFAULT 'LOCAL' CHECK (storage_type IN ('LOCAL', 'S3', 'AZURE', 'GCS')),
  content_type    VARCHAR(100),
  size_bytes      BIGINT,
  checksum_sha256 CHAR(64),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_artifact_path UNIQUE (test_attempt_id, file_path)
);

-- Each stdout / stderr line is its own row (searchable, filterable by level).
CREATE TABLE test_logs (
  log_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_attempt_id BIGINT      NOT NULL REFERENCES test_attempts (test_attempt_id) ON DELETE CASCADE,
  sequence_no     INT         NOT NULL,
  log_level       VARCHAR(10) NOT NULL CHECK (log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
  log_source      VARCHAR(10) NOT NULL DEFAULT 'STDOUT' CHECK (log_source IN ('STDOUT', 'STDERR')),
  message         TEXT        NOT NULL,
  logged_at       TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_log_sequence UNIQUE (test_attempt_id, sequence_no)
);

-- One row per error thrown in an attempt.
CREATE TABLE test_failures (
  failure_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  test_attempt_id BIGINT       NOT NULL REFERENCES test_attempts (test_attempt_id) ON DELETE CASCADE,
  error_type      VARCHAR(100) NOT NULL,              -- AssertionError / TimeoutError / Error ...
  error_message   TEXT         NOT NULL,
  stack_trace     TEXT,
  failure_file    TEXT,                               -- where it failed (file / line / column)
  failure_line    INT,
  failure_column  INT,
  code_snippet    TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------ INDEXES
-- (UNIQUE constraints above already create indexes for their columns.)

CREATE INDEX idx_environments_project      ON environments (project_id);
CREATE INDEX idx_test_case_tags_tag        ON test_case_tags (tag_id);
CREATE INDEX idx_test_runs_env_started     ON test_runs (environment_id, started_at DESC);
CREATE INDEX idx_test_runs_started         ON test_runs (started_at DESC);
CREATE INDEX idx_executions_case_started   ON test_executions (test_case_id, started_at DESC);
CREATE INDEX idx_executions_status         ON test_executions (final_status);
CREATE INDEX idx_executions_browser        ON test_executions (browser_id);
CREATE INDEX idx_attempts_status           ON test_attempts (status);
CREATE INDEX idx_artifacts_attempt_type    ON test_artifacts (test_attempt_id, artifact_type);
CREATE INDEX idx_logs_attempt_level        ON test_logs (test_attempt_id, log_level);
CREATE INDEX idx_failures_attempt          ON test_failures (test_attempt_id);
CREATE INDEX idx_failures_type             ON test_failures (error_type);

-- ----------------------------------------------------------------------- TRIGGERS

CREATE TRIGGER trg_projects_updated        BEFORE UPDATE ON projects        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_environments_updated    BEFORE UPDATE ON environments    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_test_suites_updated     BEFORE UPDATE ON test_suites     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_test_cases_updated      BEFORE UPDATE ON test_cases      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_test_runs_updated       BEFORE UPDATE ON test_runs       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_test_executions_updated BEFORE UPDATE ON test_executions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
