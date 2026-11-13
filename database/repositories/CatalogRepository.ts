import type { Db } from '../db.connection';
import type { BrowserInput, EnvironmentInput, ProjectInput, SuiteInput, TestCaseInput } from '../types';

/**
 * Master data: projects, environments, test suites, test cases, tags and browsers.
 * Every method is an "upsert": insert if new, update if it already exists, and return the id.
 */
export class CatalogRepository {
  constructor(private readonly db: Db) {}

  async upsertProject(project: ProjectInput): Promise<number> {
    const { rows } = await this.db.query<{ project_id: number }>(
      `INSERT INTO projects (project_key, project_name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_key) DO UPDATE
         SET project_name = EXCLUDED.project_name,
             description  = COALESCE(EXCLUDED.description, projects.description)
       RETURNING project_id`,
      [project.key, project.name, project.description],
    );
    return rows[0].project_id;
  }

  async upsertEnvironment(projectId: number, env: EnvironmentInput): Promise<number> {
    const { rows } = await this.db.query<{ environment_id: number }>(
      `INSERT INTO environments (project_id, environment_key, environment_name, base_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, environment_key) DO UPDATE
         SET environment_name = EXCLUDED.environment_name,
             base_url         = EXCLUDED.base_url
       RETURNING environment_id`,
      [projectId, env.key, env.name, env.baseUrl],
    );
    return rows[0].environment_id;
  }

  async upsertSuite(projectId: number, suite: SuiteInput): Promise<number> {
    const { rows } = await this.db.query<{ suite_id: number }>(
      `INSERT INTO test_suites (project_id, suite_name, file_path)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, file_path) DO UPDATE
         SET suite_name = EXCLUDED.suite_name
       RETURNING suite_id`,
      [projectId, suite.name, suite.filePath],
    );
    return rows[0].suite_id;
  }

  async upsertTestCase(suiteId: number, testCase: TestCaseInput): Promise<number> {
    const { rows } = await this.db.query<{ test_case_id: number }>(
      `INSERT INTO test_cases (suite_id, case_key, case_name, description, title_path, line_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (suite_id, case_key) DO UPDATE
         SET case_name   = EXCLUDED.case_name,
             description = COALESCE(EXCLUDED.description, test_cases.description),
             title_path  = EXCLUDED.title_path,
             line_number = EXCLUDED.line_number,
             is_active   = TRUE
       RETURNING test_case_id`,
      [suiteId, testCase.key, testCase.name, testCase.description, testCase.titlePath, testCase.lineNumber],
    );
    return rows[0].test_case_id;
  }

  /** Make the test case's tags exactly `tagNames` (adds new ones, removes old ones). */
  async syncTags(testCaseId: number, tagNames: string[]): Promise<void> {
    await this.db.query(
      `INSERT INTO tags (tag_name) SELECT UNNEST($1::text[]) ON CONFLICT (tag_name) DO NOTHING`,
      [tagNames],
    );
    await this.db.query(
      `DELETE FROM test_case_tags ct
        USING tags t
        WHERE ct.tag_id = t.tag_id AND ct.test_case_id = $1 AND NOT (t.tag_name = ANY($2::text[]))`,
      [testCaseId, tagNames],
    );
    await this.db.query(
      `INSERT INTO test_case_tags (test_case_id, tag_id)
       SELECT $1, tag_id FROM tags WHERE tag_name = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [testCaseId, tagNames],
    );
  }

  async upsertBrowser(browser: BrowserInput): Promise<number> {
    const { rows } = await this.db.query<{ browser_id: number }>(
      `INSERT INTO browsers (browser_name, channel)
       VALUES ($1, $2)
       ON CONFLICT ON CONSTRAINT uq_browser DO UPDATE SET browser_name = EXCLUDED.browser_name
       RETURNING browser_id`,
      [browser.name, browser.channel],
    );
    return rows[0].browser_id;
  }
}
