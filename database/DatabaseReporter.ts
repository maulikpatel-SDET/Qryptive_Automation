import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import { getConfig } from '../utils/ConfigUtils';
import { PROJECT_ROOT, isDatabaseEnabled } from './db.config';
import { connectDatabase, disconnectDatabase } from './db.connection';
import { TestResultService } from './services/TestResultService';
import type {
  ArtifactFile,
  AttemptData,
  AttemptStatus,
  ExecutionStatus,
  FailureEntry,
  LogEntry,
  LogLevel,
  RunContext,
  RunStatus,
} from './types';

/**
 * Playwright reporter that stores every run in PostgreSQL.
 *
 *  onBegin   -> connect, run migrations, create the test run
 *  onTestEnd -> save the attempt (called once per try, so retries become separate attempts)
 *  onEnd     -> wait for all saves, write the run summary, close the connection
 *
 * Database problems are only printed as warnings - they never change the Playwright result.
 */
export default class DatabaseReporter implements Reporter {
  private readonly service = new TestResultService();
  private readonly startedAt = new Date();
  private run: Promise<RunContext | null> = Promise.resolve(null);
  private queue: Promise<void> = Promise.resolve(); // saves run one after another, in order
  private saved = 0;
  private errors = 0;

  onBegin(config: FullConfig, _suite: Suite): void {
    if (!isDatabaseEnabled()) return;

    const env = getConfig();
    this.run = connectDatabase()
      .then(() =>
        this.service.startRun({
          runUuid: randomUUID(),
          startedAt: this.startedAt,
          environment: { key: process.env.ENV ?? 'qa', name: env.name, baseUrl: env.baseUrl },
          triggeredBy: os.userInfo().username,
          hostName: os.hostname(),
          playwrightVersion: config.version,
        }),
      )
      .catch((error: Error) => {
        console.error(`[Database] Could not start - results will NOT be saved: ${error.message}`);
        return null;
      });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!isDatabaseEnabled()) return;
    // Collect now (files exist now), save in the background queue.
    const data = collectAttempt(test, result);
    this.queue = this.queue.then(() => this.saveAttempt(data));
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!isDatabaseEnabled()) return;
    await this.queue;

    const run = await this.run;
    if (!run) return;

    try {
      await this.service.finishRun(run, toRunStatus(result.status), new Date(), result.duration);
      console.log(
        `[Database] Run ${run.runUuid}: saved ${this.saved} attempt(s)` +
          (this.errors ? `, ${this.errors} could not be saved` : ''),
      );
    } catch (error) {
      console.error(`[Database] Could not save run summary: ${(error as Error).message}`);
    } finally {
      await disconnectDatabase().catch((error: Error) => console.error(`[Database] Close failed: ${error.message}`));
    }
  }

  private async saveAttempt(data: AttemptData): Promise<void> {
    const run = await this.run;
    if (!run) return;
    try {
      await this.service.saveAttempt(run, data);
      this.saved++;
    } catch (error) {
      this.errors++;
      console.error(`[Database] Could not save ${data.testCase.key}: ${(error as Error).message}`);
    }
  }
}

// =============================================================================
// Mapping Playwright objects -> database input
// =============================================================================

function collectAttempt(test: TestCase, result: TestResult): AttemptData {
  const describes = describeTitles(test);
  const filePath = path.relative(PROJECT_ROOT, test.location.file);
  const project = test.parent.project();
  const failures = result.errors.map(toFailure);

  return {
    suite: { name: describes[0] ?? path.basename(filePath), filePath },
    testCase: {
      key: caseKey(test),
      name: caseName(test.title),
      description: test.annotations.find((a) => a.type === 'description')?.description ?? null,
      titlePath: [...describes, test.title].join(' > '),
      lineNumber: test.location.line,
      tags: test.tags.map((tag) => tag.replace(/^@/, '').toLowerCase()),
    },
    browser: {
      name: project?.use.browserName ?? 'chromium',
      channel: project?.use.channel ?? null,
    },
    attempt: {
      number: result.retry + 1,
      status: toAttemptStatus(result.status),
      startedAt: result.startTime,
      durationMs: result.duration,
      workerIndex: result.workerIndex,
    },
    finalStatus: toExecutionStatus(test, result),
    logs: parseLogs(result),
    failures,
    files: collectFiles(result, failures),
  };
}

/** Titles of the describe() blocks around the test, outermost first. */
function describeTitles(test: TestCase): string[] {
  const titles: string[] = [];
  for (let suite: Suite | undefined = test.parent; suite; suite = suite.parent) {
    if (suite.type === 'describe') titles.unshift(suite.title);
  }
  return titles;
}

/** "TC04 - Login page shows all elements @loginpage" -> "TC04" */
function caseKey(test: TestCase): string {
  return test.title.match(/^(TC[_-]?\w*?\d+)/i)?.[1].toUpperCase() ?? `AUTO_${test.id}`;
}

/** "TC04 - Login page shows all elements @loginpage" -> "Login page shows all elements" */
function caseName(title: string): string {
  return title
    .replace(/^TC[_-]?\w*?\d+\s*-\s*/i, '')
    .replace(/\s@\S+/g, '')
    .trim()
    .slice(0, 255);
}

function toAttemptStatus(status: TestResult['status']): AttemptStatus {
  const map: Record<TestResult['status'], AttemptStatus> = {
    passed: 'PASSED',
    failed: 'FAILED',
    timedOut: 'TIMEDOUT',
    skipped: 'SKIPPED',
    interrupted: 'INTERRUPTED',
  };
  return map[status];
}

/** Final status of the test so far (updated again after every retry). */
function toExecutionStatus(test: TestCase, result: TestResult): ExecutionStatus {
  switch (test.outcome()) {
    case 'expected':
      return result.status === 'skipped' ? 'SKIPPED' : 'PASSED';
    case 'flaky':
      return 'FLAKY';
    case 'skipped':
      return 'SKIPPED';
    default:
      return 'FAILED';
  }
}

function toRunStatus(status: FullResult['status']): RunStatus {
  if (status === 'passed') return 'PASSED';
  if (status === 'timedout') return 'TIMEDOUT';
  if (status === 'interrupted') return 'INTERRUPTED';
  return 'FAILED';
}

const LOGGER_LINE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\] \[(DEBUG|INFO|WARN|ERROR)\] (.*)$/;

/** Split stdout / stderr into one entry per line. Lines from utils/Logger keep their time and level. */
function parseLogs(result: TestResult): LogEntry[] {
  const entries: LogEntry[] = [];
  const sources: ['STDOUT' | 'STDERR', (string | Buffer)[]][] = [
    ['STDOUT', result.stdout],
    ['STDERR', result.stderr],
  ];

  for (const [source, chunks] of sources) {
    const text = stripColors(chunks.map((chunk) => chunk.toString()).join(''));
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      const match = line.match(LOGGER_LINE);
      entries.push({
        sequenceNo: entries.length + 1,
        level: match ? (match[2] as LogLevel) : source === 'STDERR' ? 'ERROR' : 'INFO',
        source,
        message: match ? match[3] : line,
        loggedAt: match ? new Date(match[1]) : result.startTime,
      });
    }
  }
  return entries;
}

function toFailure(error: TestError): FailureEntry {
  const message = stripColors(error.message ?? String(error.value ?? 'Unknown error'));
  return {
    errorType: errorType(message),
    errorMessage: message,
    stackTrace: error.stack ? stripColors(error.stack) : null,
    file: error.location ? path.relative(PROJECT_ROOT, error.location.file) : null,
    line: error.location?.line ?? null,
    column: error.location?.column ?? null,
    snippet: error.snippet ? stripColors(error.snippet) : null,
  };
}

function errorType(message: string): string {
  const firstLine = message.split('\n')[0];
  if (/expect\(.*\)/.test(firstLine)) return 'AssertionError';
  if (/Test timeout|Timeout \d+ms exceeded|TimeoutError/i.test(message)) return 'TimeoutError';
  return firstLine.match(/^(\w*Error)\b/)?.[1] ?? 'Error';
}

/** Screenshots, traces and videos from Playwright, plus a stdout file and a failure file. */
function collectFiles(result: TestResult, failures: FailureEntry[]): ArtifactFile[] {
  const files: ArtifactFile[] = [];

  for (const attachment of result.attachments) {
    if (!attachment.path && !attachment.body) continue;
    const type =
      attachment.contentType.startsWith('image/') ? 'SCREENSHOT'
      : attachment.name === 'trace' ? 'TRACE'
      : attachment.contentType.startsWith('video/') ? 'VIDEO'
      : 'OTHER';
    files.push({
      type,
      fileName: attachment.path ? path.basename(attachment.path) : `${attachment.name}`,
      contentType: attachment.contentType,
      sourcePath: attachment.path,
      content: attachment.path ? undefined : attachment.body,
    });
  }

  const stdout = stripColors(result.stdout.map((chunk) => chunk.toString()).join(''));
  if (stdout.trim() !== '') {
    files.push({ type: 'STDOUT_LOG', fileName: 'stdout.log', contentType: 'text/plain', content: stdout });
  }

  if (failures.length > 0) {
    const text = failures
      .map((f) => `${f.errorType}: ${f.errorMessage}\n\n${f.stackTrace ?? ''}`)
      .join('\n\n==========\n\n');
    files.push({ type: 'FAILURE_LOG', fileName: 'failure.log', contentType: 'text/plain', content: text });
  }

  return files;
}

function stripColors(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}
