/** Shared types for the database layer. */

export type RunStatus = 'RUNNING' | 'PASSED' | 'FAILED' | 'TIMEDOUT' | 'INTERRUPTED';
export type ExecutionStatus = 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | 'FLAKY';
export type AttemptStatus = 'PASSED' | 'FAILED' | 'SKIPPED' | 'TIMEDOUT' | 'INTERRUPTED';
export type ArtifactType = 'SCREENSHOT' | 'TRACE' | 'VIDEO' | 'STDOUT_LOG' | 'FAILURE_LOG' | 'OTHER';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** BIGINT ids come back from node-postgres as strings (they can be larger than JS numbers). */
export type BigId = string;

export interface ProjectInput {
  key: string;
  name: string;
  description: string | null;
}

export interface EnvironmentInput {
  key: string;
  name: string;
  baseUrl: string;
}

export interface SuiteInput {
  name: string;
  filePath: string;
}

export interface TestCaseInput {
  key: string;
  name: string;
  description: string | null;
  titlePath: string;
  lineNumber: number;
  tags: string[];
}

export interface BrowserInput {
  name: string;
  channel: string | null;
}

export interface AttemptInput {
  number: number;
  status: AttemptStatus;
  startedAt: Date;
  durationMs: number;
  workerIndex: number;
}

export interface LogEntry {
  sequenceNo: number;
  level: LogLevel;
  source: 'STDOUT' | 'STDERR';
  message: string;
  loggedAt: Date;
}

export interface FailureEntry {
  errorType: string;
  errorMessage: string;
  stackTrace: string | null;
  file: string | null;
  line: number | null;
  column: number | null;
  snippet: string | null;
}

/** A file to store for an attempt: copied from `sourcePath` or written from `content`. */
export interface ArtifactFile {
  type: ArtifactType;
  fileName: string;
  contentType: string;
  sourcePath?: string;
  content?: string | Buffer;
}

/** Metadata of a file after it was stored. */
export interface StoredArtifact {
  type: ArtifactType;
  fileName: string;
  filePath: string;
  storageType: 'LOCAL' | 'S3' | 'AZURE' | 'GCS';
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

/** Everything the reporter collects about one test attempt. */
export interface AttemptData {
  suite: SuiteInput;
  testCase: TestCaseInput;
  browser: BrowserInput;
  attempt: AttemptInput;
  finalStatus: ExecutionStatus;
  logs: LogEntry[];
  failures: FailureEntry[];
  files: ArtifactFile[];
}

/** Ids of the current run, created when the run starts. */
export interface RunContext {
  testRunId: BigId;
  runUuid: string;
  projectId: number;
}
