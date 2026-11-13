/**
 * Database command line:
 *   npm run db:migrate              create database + apply migrations
 *   npm run db:runs                 latest test runs
 *   npm run db -- run <run_uuid>    one run with all its executions
 *   npm run db:cases                test cases with statistics
 *   npm run db -- history TC04      execution history of one test case
 *   npm run db -- attempts <execution_id>   retry history of one execution
 *   npm run db:failures             failure analysis
 *   npm run db:durations            duration report
 *   npm run db:stats                pass / fail per day
 */
import { getProjectInfo } from './db.config';
import { connectDatabase, disconnectDatabase, getPool } from './db.connection';
import { ReportRepository } from './repositories/ReportRepository';

type Row = Record<string, unknown>;

/** Print rows as a table, keeping only the given columns and shortening long text. */
function show(rows: Row[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('No data found.');
    return;
  }
  console.table(
    rows.map((row) =>
      Object.fromEntries(
        columns.map((col) => {
          const value = row[col];
          const text = value instanceof Date ? value.toLocaleString() : value;
          return [col, typeof text === 'string' && text.length > 50 ? text.slice(0, 47) + '...' : text];
        }),
      ),
    ),
  );
}

async function main(): Promise<void> {
  const [command = 'migrate', arg] = process.argv.slice(2);
  const project = getProjectInfo().key;

  await connectDatabase();
  const reports = new ReportRepository(getPool());

  try {
    switch (command) {
      case 'migrate':
        console.log('[Database] Schema is up to date.');
        break;
      case 'runs':
        show(await reports.getRunHistory(project, 20), [
          'run_uuid', 'environment_key', 'status', 'started_at', 'duration_ms',
          'total_tests', 'passed_count', 'failed_count', 'skipped_count', 'flaky_count', 'pass_rate',
        ]);
        break;
      case 'run': {
        const run = arg ? await reports.getRunDetails(arg) : null;
        if (!run) {
          console.log('Run not found. Usage: npm run db -- run <run_uuid>');
          break;
        }
        const { executions, ...summary } = run as Row & { executions: Row[] };
        console.log(summary);
        show(executions, ['test_execution_id', 'case_key', 'case_name', 'final_status', 'attempt_count', 'duration_ms']);
        break;
      }
      case 'cases':
        show(await reports.listTestCases(project), [
          'case_key', 'case_name', 'tags', 'total_executions', 'passed', 'failed', 'flaky', 'pass_rate', 'last_status',
        ]);
        break;
      case 'history':
        show(await reports.getTestCaseHistory(project, (arg ?? '').toUpperCase()), [
          'test_execution_id', 'run_uuid', 'environment_key', 'final_status', 'attempt_count', 'started_at', 'duration_ms',
        ]);
        break;
      case 'attempts':
        show(await reports.getRetryHistory(arg ?? '0'), [
          'test_attempt_id', 'case_key', 'attempt_number', 'attempt_status', 'final_status', 'started_at', 'duration_ms',
        ]);
        break;
      case 'failures':
        show(await reports.getFailureAnalysis(project), [
          'case_key', 'error_type', 'error_summary', 'occurrences', 'affected_runs', 'last_seen',
        ]);
        break;
      case 'durations':
        show(await reports.getDurationReport(project), ['case_key', 'case_name', 'passed_attempts', 'min_ms', 'avg_ms', 'max_ms', 'p95_ms']);
        break;
      case 'stats':
        show(await reports.getDailyStats(project, 30), ['day', 'total', 'passed', 'failed', 'skipped', 'flaky']);
        break;
      default:
        console.log('Unknown command. Use: migrate | runs | run <uuid> | cases | history <TCxx> | attempts <id> | failures | durations | stats');
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: Error) => {
  console.error('[Database] Error:', error.message);
  process.exit(1);
});
