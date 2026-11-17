import fs from 'fs';
import path from 'path';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../fixtures/base.fixture';
import { AuthManager } from '../../auth/AuthManager';
import { RepositoriesPage } from '../../pages/sources/RepositoriesPage';
import { ScanResultsPage } from '../../pages/sources/ScanResultsPage';
import { getConfig } from '../../utils/ConfigUtils';
import { toCsv } from '../../utils/CsvUtils';
import { Logger } from '../../utils/Logger';
import { ScanRepoStore } from '../../utils/ScanRepoStore';
import {
  acceptedFindings,
  compareFindings,
  detectExtraRootFolder,
  expectedFileCounts,
  loadExpectedFindings,
  summarize,
  toReportRows,
  type ActualFinding,
  type ComparisonResult,
  type ComparisonRow,
} from '../../utils/ScanComparator';

/**
 * MODULE: Sources > Repositories > Last Scan
 * FEATURE: The scan results of a repository are correct
 *
 * What this test does, in plain words:
 *   1. On Sources > Repositories, clicks "Last Scan" for the repository.
 *   2. Compares what Qryptive found with the expected results in SCAN_EXPECTED_CSV:
 *      summary totals, every algorithm with its file and line, safe / vulnerable status,
 *      category, keys / certificates / tokens, and the Files tab.
 *
 * No GitHub repository is created here. The repository checked is (first one found):
 *   1. SCAN_RESULTS_REPO in .env                 - check any repo you choose
 *   2. the repo saved by github-repo-scan.spec.ts - the one created and scanned in the last run
 * If neither exists (first run, new machine, CI), playwright.config.ts runs
 * github-repo-scan.spec.ts FIRST (project dependency), so this file never starts without a repo.
 * The repository stays on the Repositories page after it is removed from Code Sources,
 * so this works even after github-repo-scan.spec.ts has deleted it.
 *
 * The expected results file is written by hand from the sample code (it is not generated).
 * Rows with a "Known Issue" are known Qryptive problems: they are listed in the report
 * on every run but do not fail the test. Any other difference fails the test.
 * The full expected-vs-actual table is attached to each check in the HTML report.
 *
 * Chrome opens ONE window for all tests in this file, and the scan results page is loaded
 * only when needed - the tests just switch tabs on the page that is already open.
 *
 * Run alone: ENV=qa npx playwright test --grep @scanresults
 */

/** The repo to check - read when the tests start, after github-repo-scan.spec.ts has saved it. */
let REPO = '';
const EXPECTED_CSV = path.resolve(process.env.SCAN_EXPECTED_CSV ?? 'test-data/scan-repo.expected-findings.csv');

// One browser window shared by every test below (opened in beforeAll, closed in afterAll).
let context: BrowserContext;
let page: Page;
let repositoriesPage: RepositoriesPage;
let scanResultsPage: ScanResultsPage;

/** Shared between the serial tests below. */
const state = {
  scanResultsUrl: '',
  rootFolder: '', // extra top folder in Qryptive's paths, e.g. "qx-coverage-suite/" (removed before comparing)
  comparison: [] as ComparisonRow[],
};

const stripRoot = (file: string) =>
  state.rootFolder && file.startsWith(state.rootFolder) ? file.slice(state.rootFolder.length) : file;

/** Read the scan results page once and compare it with the expected CSV (reused by TC20-TC24). */
async function getComparison(): Promise<ComparisonRow[]> {
  if (state.comparison.length === 0) {
    await scanResultsPage.ensureOpen(state.scanResultsUrl);
    const found: ActualFinding[] = [
      ...(await scanResultsPage.getCryptoFindings()),
      ...(await scanResultsPage.getAssetInventory()),
    ];
    const expected = loadExpectedFindings(EXPECTED_CSV);
    state.rootFolder = detectExtraRootFolder(
      found.map((f) => f.file),
      expected.map((e) => e.file),
    );
    if (state.rootFolder) Logger.info(`Paths in this scan start with "${state.rootFolder}" - removed before comparing`);
    state.comparison = compareFindings(
      expected,
      found.map((f) => ({ ...f, file: stripRoot(f.file) })),
    );
  }
  return state.comparison;
}

/**
 * Attach the expected-vs-actual table to the report, list known issues,
 * and fail when there is any NEW problem of the given kinds.
 */
async function checkRows(testInfo: TestInfo, name: string, rows: ComparisonRow[], kinds: ComparisonResult[]) {
  await testInfo.attach(`${name}.csv`, { body: toCsv(toReportRows(rows)), contentType: 'text/csv' });
  const { failures, knownIssues, fixedIssues } = summarize(rows, kinds);
  for (const issue of knownIssues) testInfo.annotations.push({ type: 'known issue', description: issue });
  for (const fixed of fixedIssues) testInfo.annotations.push({ type: 'known issue fixed', description: fixed });
  const ok = rows.filter((r) => r.result === 'OK').length;
  Logger.info(`${name}: ${ok}/${rows.length} OK, ${failures.length} problems, ${knownIssues.length} known issues`);
  knownIssues.forEach((k) => Logger.info(`  known issue: ${k}`));
  fixedIssues.forEach((f) => Logger.info(`  FIXED: ${f}`));
  expect(failures, `${name} - differences from ${path.basename(EXPECTED_CSV)}:\n${failures.join('\n')}`).toEqual([]);
}

test.describe('Repositories - Last Scan results are correct', () => {
  test.describe.configure({ mode: 'serial' }); // TC20-TC24 use the scan opened in TC19

  test.beforeAll(async ({ browser }) => {
    test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
    REPO = process.env.SCAN_RESULTS_REPO || ScanRepoStore.load()?.fullName || '';
    test.skip(!REPO, 'No scanned repo saved - run github-repo-scan.spec.ts first (npm run test:sources)');
    Logger.info(`Checking the last scan of ${REPO} - one browser window for all tests`);
    context = await browser.newContext({
      storageState: AuthManager.sessionFile(),
      viewport: { width: 1600, height: 900 },
    });
    page = await context.newPage();
    const config = getConfig();
    repositoriesPage = new RepositoriesPage(page, config);
    scanResultsPage = new ScanResultsPage(page, config);
  });

  // The shared window is not covered by the automatic failure screenshot - add it here.
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus && page) {
      await testInfo.attach('screenshot', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(({}, testInfo) => {
    test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
    test.skip(!fs.existsSync(EXPECTED_CSV), `Expected results not found: ${EXPECTED_CSV}`);
    testInfo.annotations.push({ type: 'repository', description: REPO });
  });

  test(
    'TC19 - Last Scan button on Repositories opens the latest scan of the repository @scanresults',
    {
      annotation: {
        type: 'description',
        description:
          'On Sources > Repositories, clicks Last Scan for the repository and checks the Scan Results page of that repository opens with all tabs.',
      },
    },
    async () => {
      await repositoriesPage.open();
      await repositoriesPage.verifyRepoListedWithScan(REPO);
      await repositoriesPage.clickLastScan(REPO);
      await scanResultsPage.verifyOpenedFor(REPO);
      state.scanResultsUrl = scanResultsPage.currentUrl();
    },
  );

  test(
    'TC20 - Scan summary shows the right totals and category breakdown @scanresults',
    {
      annotation: {
        type: 'description',
        description:
          'Checks the numbers at the top of the scan (crypto findings, assets, Findings and Files tabs) and the Findings Breakdown cards against the expected results.',
      },
    },
    async ({}, testInfo) => {
      const rows = await getComparison();
      const accepted = acceptedFindings(rows);
      const expected = {
        cryptoFindings: accepted.filter((f) => f.type !== 'Asset').length,
        assets: accepted.filter((f) => f.type === 'Asset' && f.category !== 'Tokens').length,
        files: expectedFileCounts(rows).size,
      };

      await scanResultsPage.ensureOpen(state.scanResultsUrl);
      const summary = await scanResultsPage.getSummary();
      const cards = await scanResultsPage.getBreakdown();
      await testInfo.attach('findings-breakdown.csv', {
        body: toCsv(
          cards.map((c) => ({
            Category: c.category,
            Findings: c.total,
            'By status': c.statusCounts.map((s) => `${s.count} ${s.label}`).join(', '),
          })),
        ),
        contentType: 'text/csv',
      });

      await test.step('Header and tab totals match the expected results', async () => {
        expect.soft(summary.cryptoFindings, '"N crypto findings" at the top').toBe(expected.cryptoFindings);
        expect.soft(summary.assets, '"N assets" at the top').toBe(expected.assets);
        expect
          .soft(summary.findingsTab, 'Findings tab = crypto findings + assets')
          .toBe(summary.cryptoFindings + summary.assets);
        expect.soft(summary.filesTab, 'Files tab').toBe(expected.files);
      });

      await test.step('Findings Breakdown cards add up', async () => {
        for (const card of cards) {
          const sum = card.statusCounts.reduce((total, s) => total + s.count, 0);
          expect.soft(sum, `"${card.category}" card: status counts add up to its total`).toBe(card.total);
        }
        const cryptoCards = cards.filter((c) => !['Certificates', 'Secrets & Keys'].includes(c.category));
        const cryptoTotal = cryptoCards.reduce((total, c) => total + c.total, 0);
        expect.soft(cryptoTotal, 'all crypto category cards together = crypto findings').toBe(summary.cryptoFindings);
      });
    },
  );

  test(
    'TC21 - Every expected algorithm is found in the right file and on the right line @scanresults',
    {
      annotation: {
        type: 'description',
        description:
          'Compares every crypto and dependency finding with the expected results: nothing missing, nothing extra, and each one on the right line.',
      },
    },
    async ({}, testInfo) => {
      const rows = (await getComparison()).filter((r) => r.type !== 'Asset');
      await checkRows(testInfo, 'algorithms-file-and-line', rows, [
        'MISSING',
        'WRONG LINE',
        'FALSE POSITIVE',
        'EXTRA (not expected)',
      ]);
    },
  );

  test(
    'TC22 - Each finding shows the right Safe or Vulnerable status and category @scanresults',
    {
      annotation: {
        type: 'description',
        description:
          'For every finding found at the right place, checks the status (PQC Safe / Quantum Vulnerable / Unknown) and the category (e.g. Key Generation, Hashing).',
      },
    },
    async ({}, testInfo) => {
      const rows = (await getComparison()).filter((r) => r.type !== 'Asset');
      await checkRows(testInfo, 'status-and-category', rows, ['WRONG STATUS', 'WRONG CATEGORY']);
    },
  );

  test(
    'TC23 - Keys, certificates and tokens are listed in Asset Inventory @scanresults',
    {
      annotation: {
        type: 'description',
        description:
          'Compares Findings > Asset Inventory with the expected key files, certificates, hardcoded secrets and JWT tokens, including file, line and status.',
      },
    },
    async ({}, testInfo) => {
      const rows = (await getComparison()).filter((r) => r.type === 'Asset');
      await checkRows(testInfo, 'asset-inventory', rows, [
        'MISSING',
        'WRONG LINE',
        'WRONG STATUS',
        'WRONG CATEGORY',
        'FALSE POSITIVE',
        'EXTRA (not expected)',
      ]);
    },
  );

  test(
    'TC24 - Files tab lists every scanned file with the right number of findings @scanresults',
    {
      annotation: {
        type: 'description',
        description:
          'Checks the Files tab lists every expected file, and for each file the number of vulnerable, secure and unclassified findings.',
      },
    },
    async ({}, testInfo) => {
      const expectedFiles = expectedFileCounts(await getComparison());
      await scanResultsPage.ensureOpen(state.scanResultsUrl);
      const actualFiles = (await scanResultsPage.getFiles()).map((f) => ({ ...f, file: stripRoot(f.file) }));

      const fmt = (c?: Record<string, number>) =>
        c ? `${c.vulnerable} vulnerable, ${c.safe} secure, ${c.unknown} unclassified` : 'not listed';
      const problems: string[] = [];
      const table: Record<string, string>[] = [];
      for (const [file, exp] of expectedFiles) {
        const act = actualFiles.find((f) => f.file === file)?.counts;
        const same = !!act && act.vulnerable === exp.vulnerable && act.safe === exp.safe && act.unknown === exp.unknown;
        table.push({
          Result: same ? 'OK' : act ? 'WRONG COUNT' : 'MISSING',
          File: file,
          Expected: fmt(exp),
          Actual: fmt(act),
        });
        if (!same)
          problems.push(`${act ? 'WRONG COUNT' : 'MISSING    '} ${file}: expected ${fmt(exp)}, shown ${fmt(act)}`);
      }
      for (const f of actualFiles.filter((a) => !expectedFiles.has(a.file))) {
        table.push({ Result: 'EXTRA', File: f.file, Expected: '', Actual: fmt(f.counts) });
        problems.push(`EXTRA       ${f.file} is listed but not expected`);
      }
      await testInfo.attach('files.csv', { body: toCsv(table), contentType: 'text/csv' });
      Logger.info(`Files tab: ${table.filter((t) => t.Result === 'OK').length}/${table.length} OK`);
      expect(problems, `Files tab - differences from the expected results:\n${problems.join('\n')}`).toEqual([]);
    },
  );
});
