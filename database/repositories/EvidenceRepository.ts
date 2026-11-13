import type { Db } from '../db.connection';
import type { BigId, FailureEntry, LogEntry, StoredArtifact } from '../types';

/** Logs, failures and artifact metadata belonging to one test attempt. */
export class EvidenceRepository {
  constructor(private readonly db: Db) {}

  /** Insert all log lines in one statement (arrays are expanded with UNNEST). */
  async addLogs(attemptId: BigId, logs: LogEntry[]): Promise<void> {
    if (logs.length === 0) return;
    await this.db.query(
      `INSERT INTO test_logs (test_attempt_id, sequence_no, log_level, log_source, message, logged_at)
       SELECT $1, * FROM UNNEST($2::int[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])`,
      [
        attemptId,
        logs.map((l) => l.sequenceNo),
        logs.map((l) => l.level),
        logs.map((l) => l.source),
        logs.map((l) => l.message),
        logs.map((l) => l.loggedAt),
      ],
    );
  }

  async addFailures(attemptId: BigId, failures: FailureEntry[]): Promise<void> {
    for (const f of failures) {
      await this.db.query(
        `INSERT INTO test_failures
           (test_attempt_id, error_type, error_message, stack_trace, failure_file, failure_line, failure_column, code_snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [attemptId, f.errorType, f.errorMessage, f.stackTrace, f.file, f.line, f.column, f.snippet],
      );
    }
  }

  async addArtifacts(attemptId: BigId, artifacts: StoredArtifact[]): Promise<void> {
    for (const a of artifacts) {
      await this.db.query(
        `INSERT INTO test_artifacts
           (test_attempt_id, artifact_type, file_name, file_path, storage_type, content_type, size_bytes, checksum_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (test_attempt_id, file_path) DO NOTHING`,
        [attemptId, a.type, a.fileName, a.filePath, a.storageType, a.contentType, a.sizeBytes, a.sha256],
      );
    }
  }
}
