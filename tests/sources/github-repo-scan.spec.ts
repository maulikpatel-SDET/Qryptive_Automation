import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures/base.fixture';
import { AuthManager } from '../../auth/AuthManager';
import { CodeSourcesPage } from '../../pages/sources/CodeSourcesPage';
import { getConfig } from '../../utils/ConfigUtils';
import { GitHubApi } from '../../utils/GitHubApi';
import { Logger } from '../../utils/Logger';
import { ScanRepoStore } from '../../utils/ScanRepoStore';

/**
 * MODULE: Sources > Code Sources (GitHub Action)
 * FEATURE: Connect a GitHub repository to Qryptive and scan it
 *
 * What this test does, in plain words:
 *   1. Makes a brand-new GitHub repository and uploads the sample code from SCAN_REPO_ZIP.
 *   2. In Qryptive, clicks "Add repo" and connects that repository.
 *   3. Step 1 of 2 - adds the Qryptive API key (PQC_API_KEY) to the repository as a secret.
 *   4. Step 2 of 2 - adds the Qryptive scan workflow file to the repository.
 *   5. Waits for GitHub to run the scan, then checks that Qryptive shows the repository as ACTIVE.
 *   6. Checks the scan appears on the Repositories and Scans pages.
 *   7. Removes the repository from Qryptive and GitHub (set SCAN_KEEP_REPO=true to keep it).
 *
 * The repository name is saved (utils/ScanRepoStore.ts) once it is scanned. Then
 * tests/sources/repositories-last-scan.spec.ts checks the Last Scan results of that same
 * repository against the expected results - it still works after the repo is removed.
 *
 * Needs in .env: SCAN_GITHUB_TOKEN, SCAN_GITHUB_OWNER, PQC_API_KEY, SCAN_REPO_ZIP
 * Run alone:     ENV=qa npx playwright test --grep @reposcan
 */

const TOKEN = process.env.SCAN_GITHUB_TOKEN ?? '';
const OWNER = process.env.SCAN_GITHUB_OWNER ?? '';
const PQC_API_KEY = process.env.PQC_API_KEY ?? '';
const ZIP_PATH = path.resolve(process.env.SCAN_REPO_ZIP ?? 'test-data/scan-repo.zip');
const REPO_PRIVATE = process.env.SCAN_REPO_PRIVATE !== 'false';
const KEEP_REPO = process.env.SCAN_KEEP_REPO === 'true';
const SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MIN ?? 15) * 60_000;
const MIN_FINDINGS = Number(process.env.SCAN_MIN_FINDINGS ?? 1); // the zip contains crypto code

const REPO_NAME = `qx-scan-e2e-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const FULL_NAME = `${OWNER}/${REPO_NAME}`;

/** Shared between the serial tests below. */
const state = {
  branch: 'main',
  workflowSha: '',
  repoCreated: false,
  enrolled: false,
  deletedInQryptive: false,
};

function missingSetup(): string {
  const missing = [
    !TOKEN && 'SCAN_GITHUB_TOKEN',
    !OWNER && 'SCAN_GITHUB_OWNER',
    !PQC_API_KEY && 'PQC_API_KEY',
    !fs.existsSync(ZIP_PATH) && `SCAN_REPO_ZIP (file not found: ${ZIP_PATH})`,
  ].filter(Boolean);
  return missing.length ? `Missing: ${missing.join(', ')}` : '';
}

test.describe('Sources - Connect and scan a GitHub repository', () => {
  test.describe.configure({ mode: 'serial' }); // later tests need the repo from TC16
  test.use({ storageState: AuthManager.sessionFile() });

  const github = new GitHubApi(TOKEN, OWNER);

  test.beforeEach(({}, testInfo) => {
    test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
    // TC15 only checks the form; the other tests need GitHub access + the zip.
    const missing = missingSetup();
    if (!testInfo.title.startsWith('TC15') && missing) {
      Logger.error(`${testInfo.title.split(' - ')[0]} skipped - ${missing}`); // shown in the console
      test.skip(true, missing);
    }
  });

  // Clean up on both sides even if a test failed half-way.
  test.afterAll(async ({ browser }) => {
    if (KEEP_REPO) {
      if (state.repoCreated) Logger.info(`SCAN_KEEP_REPO=true - keeping ${FULL_NAME} in Qryptive and on GitHub`);
      return;
    }
    if (state.enrolled && !state.deletedInQryptive) {
      Logger.info('Cleanup: deleting the repo from Qryptive');
      const context = await browser.newContext({ storageState: AuthManager.sessionFile() });
      const codeSources = new CodeSourcesPage(await context.newPage(), getConfig());
      try {
        await codeSources.open();
        await codeSources.waitForRepoListed(FULL_NAME, 30_000).catch(() => Logger.info('Cleanup: repo not listed'));
        if ((await codeSources.repoRow(FULL_NAME).count()) > 0) {
          await codeSources.deleteRepo(FULL_NAME);
          await codeSources.verifyRepoNotListed(FULL_NAME);
        }
      } catch (error) {
        Logger.error(`Cleanup in Qryptive failed - delete ${FULL_NAME} by hand: ${error}`);
      } finally {
        await context.close();
      }
    }
    if (state.repoCreated && (await github.repoExists(REPO_NAME).catch(() => false))) {
      Logger.info('Cleanup: deleting the GitHub repo');
      await github.deleteRepo(REPO_NAME).catch((e) => Logger.error(`GitHub cleanup failed: ${e}`));
    }
  });

  test(
    'TC15 - Add repo form opens with the recommended scan settings @reposcan',
    {
      annotation: {
        type: 'description',
        description: 'Opens the Add repo form and checks the default choices, then cancels. Nothing is created.',
      },
    },
    async ({ codeSourcesPage }) => {
      await codeSourcesPage.open();
      await expect(codeSourcesPage.githubActionTab).toBeVisible();
      await codeSourcesPage.openEnrollForm();
      await codeSourcesPage.verifyEnrollFormDefaults();
      await codeSourcesPage.cancelButton.click();
      await expect(codeSourcesPage.enrollHeading).toBeHidden();
    },
  );

  test(
    'TC16 - User connects a new GitHub repository to Qryptive @reposcan',
    {
      annotation: {
        type: 'description',
        description:
          'Creates a GitHub repository with sample code, adds it in Qryptive and completes Step 1 (API key secret) and Step 2 (scan workflow).',
      },
    },
    async ({ codeSourcesPage }) => {
      await test.step('Create a new GitHub repository and upload the sample code', async () => {
        state.branch = await github.createRepo(REPO_NAME, REPO_PRIVATE);
        state.repoCreated = true;
        await github.pushZip(REPO_NAME, state.branch, ZIP_PATH, 'Add source code for Qryptive scan test');
      });

      await test.step('Click Add repo, enter the repository name and click Enroll & generate YAML', async () => {
        await codeSourcesPage.open();
        await codeSourcesPage.openEnrollForm();
        await codeSourcesPage.fillEnrollForm(FULL_NAME); // default options, as in the product
        await codeSourcesPage.clickEnroll();
        state.enrolled = true;
      });

      await test.step('Step 1 of 2 - Add the Qryptive API key to the repository as a secret', async () => {
        await codeSourcesPage.verifyStep1(FULL_NAME);
        // "Open repository secret settings" -> New secret PQC_API_KEY (done through the GitHub API)
        await github.setSecret(REPO_NAME, 'PQC_API_KEY', PQC_API_KEY);
        expect(await github.secretExists(REPO_NAME, 'PQC_API_KEY'), 'PQC_API_KEY secret on GitHub').toBe(true);
        await codeSourcesPage.clickSecretAdded();
      });

      await test.step('Step 2 of 2 - Add the scan workflow file to the repository', async () => {
        await codeSourcesPage.verifyStep2(FULL_NAME);
        await codeSourcesPage.confirmBranch(state.branch);
        const yaml = await codeSourcesPage.getWorkflowYaml(state.branch);
        // "Add to GitHub" -> commit .github/workflows/pqc-scan.yml (done through the GitHub API)
        state.workflowSha = await github.putFile(
          REPO_NAME,
          state.branch,
          CodeSourcesPage.WORKFLOW_FILE,
          yaml,
          'Add Qryptive PQC scan workflow',
        );
        await codeSourcesPage.clickFinish();
      });

      await test.step('The repository appears in the Code Sources list', async () => {
        await codeSourcesPage.waitForRepoListed(FULL_NAME);
      });
    },
  );

  test(
    'TC17 - Connected repository is scanned and shows as Active @reposcan',
    {
      annotation: {
        type: 'description',
        description:
          'Waits for the scan to finish on GitHub, then checks the repository is ACTIVE with a last scan time and findings.',
      },
    },
    async ({ codeSourcesPage }) => {
      test.setTimeout(SCAN_TIMEOUT_MS + 5 * 60_000);

      await test.step('GitHub runs the Qryptive scan and it finishes successfully', async () => {
        const run = await github.waitForWorkflowRun(REPO_NAME, state.workflowSha, SCAN_TIMEOUT_MS);
        expect(run.conclusion, `Workflow run ${run.html_url}`).toBe('success');
      });

      await test.step('Code Sources shows the repository as ACTIVE with findings', async () => {
        await codeSourcesPage.open();
        await codeSourcesPage.waitForRepoStatus(FULL_NAME, 'Active', 5 * 60_000);
        const findings = await codeSourcesPage.verifyRepoScanned(FULL_NAME);
        expect(findings, 'Findings in Code Sources').toBeGreaterThanOrEqual(MIN_FINDINGS);
      });

      // repositories-last-scan.spec.ts checks the scan results of this repo
      ScanRepoStore.save(FULL_NAME);
    },
  );

  test(
    'TC18 - Scan results are shown on the Repositories and Scans pages @reposcan',
    {
      annotation: {
        type: 'description',
        description:
          'Checks the repository is listed on Repositories and its latest scan is completed with files scanned and crypto findings.',
      },
    },
    async ({ repositoriesPage, scansPage, page }) => {
      await test.step('Repositories page lists the repository with at least one scan', async () => {
        await repositoriesPage.open();
        await expect(async () => {
          await page.reload();
          await repositoriesPage.verifyRepoListedWithScan(FULL_NAME);
        }).toPass({ timeout: 3 * 60_000, intervals: [10_000] });
        await repositoriesPage.verifyRowActions(FULL_NAME);
      });

      await test.step('Scans page shows a completed scan that found cryptography', async () => {
        await scansPage.open();
        await scansPage.verifyLatestScanCompleted(FULL_NAME, MIN_FINDINGS);
        await scansPage.openLatestScanResults(FULL_NAME);
      });
    },
  );

  test(
    'TC25 - User removes the repository from Qryptive and GitHub @reposcan',
    {
      annotation: {
        type: 'description',
        description: 'Removes the repository from Code Sources (row menu > Delete > OK) and deletes it from GitHub.',
      },
    },
    async ({ codeSourcesPage }) => {
      test.skip(KEEP_REPO, 'SCAN_KEEP_REPO=true - the repository is kept');
      await test.step('Remove the repository from Qryptive (row menu > Delete > OK)', async () => {
        await codeSourcesPage.open();
        await codeSourcesPage.waitForRepoListed(FULL_NAME);
        await codeSourcesPage.deleteRepo(FULL_NAME);
        await codeSourcesPage.verifyRepoNotListed(FULL_NAME);
        state.deletedInQryptive = true;
      });

      await test.step('Delete the repository from GitHub', async () => {
        await github.deleteRepo(REPO_NAME);
        expect(await github.repoExists(REPO_NAME), 'GitHub repo still exists').toBe(false);
      });
    },
  );
});
