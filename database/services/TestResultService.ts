import { getProjectInfo } from '../db.config';
import { getPool, withTransaction } from '../db.connection';
import { CatalogRepository } from '../repositories/CatalogRepository';
import { EvidenceRepository } from '../repositories/EvidenceRepository';
import { TestAttemptRepository } from '../repositories/TestAttemptRepository';
import { TestExecutionRepository } from '../repositories/TestExecutionRepository';
import { TestRunRepository } from '../repositories/TestRunRepository';
import { ArtifactStorage } from '../storage/ArtifactStorage';
import type { AttemptData, EnvironmentInput, RunContext, RunStatus, StoredArtifact } from '../types';

export interface RunStartInfo {
  runUuid: string;
  startedAt: Date;
  environment: EnvironmentInput;
  triggeredBy: string;
  hostName: string;
  playwrightVersion: string;
}

/**
 * Business logic for saving test results. Uses the repositories and wraps each
 * unit of work in a transaction, so a half-saved result can never exist.
 */
export class TestResultService {
  constructor(private readonly storage = new ArtifactStorage()) {}

  /** Register project + environment and create the test run. */
  async startRun(info: RunStartInfo): Promise<RunContext> {
    return withTransaction(async (client) => {
      const catalog = new CatalogRepository(client);
      const projectId = await catalog.upsertProject(getProjectInfo());
      const environmentId = await catalog.upsertEnvironment(projectId, info.environment);

      const testRunId = await new TestRunRepository(client).createRun({
        runUuid: info.runUuid,
        environmentId,
        startedAt: info.startedAt,
        triggeredBy: info.triggeredBy,
        hostName: info.hostName,
        playwrightVersion: info.playwrightVersion,
      });
      return { testRunId, runUuid: info.runUuid, projectId };
    });
  }

  /**
   * Save one test attempt: test case (+ tags), browser, execution, attempt,
   * logs, failures and artifact metadata - all in one transaction.
   */
  async saveAttempt(run: RunContext, data: AttemptData): Promise<void> {
    // 1. Store the files first (filesystem), then save their metadata in the transaction.
    const folder = `${run.runUuid}/${safeName(data.testCase.key)}/attempt-${data.attempt.number}`;
    const artifacts = data.files
      .map((file) => this.storage.save(folder, file))
      .filter((stored): stored is StoredArtifact => stored !== null);

    // 2. Save everything else in one transaction.
    await withTransaction(async (client) => {
      const catalog = new CatalogRepository(client);
      const suiteId = await catalog.upsertSuite(run.projectId, data.suite);
      const testCaseId = await catalog.upsertTestCase(suiteId, data.testCase);
      await catalog.syncTags(testCaseId, data.testCase.tags);
      const browserId = await catalog.upsertBrowser(data.browser);

      const executions = new TestExecutionRepository(client);
      const executionId = await executions.getOrCreate(run.testRunId, testCaseId, browserId);

      const attemptId = await new TestAttemptRepository(client).create(executionId, data.attempt);
      if (!attemptId) return; // this attempt was already saved - nothing to do

      const evidence = new EvidenceRepository(client);
      await evidence.addLogs(attemptId, data.logs);
      await evidence.addFailures(attemptId, data.failures);
      await evidence.addArtifacts(attemptId, artifacts);

      await executions.updateFinalResult(executionId, data.finalStatus);
    });
  }

  /** Close the run and write the summary counts. */
  async finishRun(run: RunContext, status: RunStatus, finishedAt: Date, durationMs: number): Promise<void> {
    // Playwright can report a fractional duration (e.g. 94338.127) - the column stores whole ms.
    await new TestRunRepository(getPool()).finishRun(run.testRunId, status, finishedAt, Math.round(durationMs));
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 80);
}
