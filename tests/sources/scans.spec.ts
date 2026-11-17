import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/base.fixture';
import { AuthManager } from '../../auth/AuthManager';
import { DashboardPage } from '../../pages/dashboard/DashboardPage';
import { ScanResultsPage } from '../../pages/sources/ScanResultsPage';
import { ScansPage } from '../../pages/sources/ScansPage';
import { getConfig } from '../../utils/ConfigUtils';
import { Logger } from '../../utils/Logger';

/**
 * MODULE: Sources > Scans
 * FEATURE: Scan history page (simple regression checks)
 *
 * What these tests check, in plain words:
 *   - the page opens from the left menu with its title, search box and Refresh button
 *   - the table has all its columns and says how many scans are shown
 *   - scans are listed newest first, every row is complete, and the totals add up
 *   - search by repository name, search with no results, clearing the search
 *   - Refresh reloads the list, and View opens the results of that scan
 *
 * Nothing is created or changed - the tests only read the existing scan history.
 * Chrome opens ONE window for all tests in this file (not a new window per test), and the
 * Scans page is loaded only when needed - a test reuses the page the previous test left open.
 * Run alone: ENV=qa npx playwright test --grep @scans
 */

// One browser window shared by every test below (opened in beforeAll, closed in afterAll).
let context: BrowserContext;
let page: Page;
let dashboardPage: DashboardPage;
let scansPage: ScansPage;
let scanResultsPage: ScanResultsPage;

test.describe('Scans - Scan history page', () => {
  test.beforeAll(async ({ browser }) => {
    test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
    Logger.info('Opening one browser window for all Scans tests');
    context = await browser.newContext({
      storageState: AuthManager.sessionFile(),
      viewport: { width: 1600, height: 900 },
    });
    page = await context.newPage();
    const config = getConfig();
    dashboardPage = new DashboardPage(page, config);
    scansPage = new ScansPage(page, config);
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

  test(
    'TC26 - Scans page opens from the left menu with its title, search box and Refresh button @scans',
    {
      annotation: {
        type: 'description',
        description:
          'Clicks Sources > Scans in the left menu and checks the Scan history page opens with its main parts.',
      },
    },
    async () => {
      await dashboardPage.openDashboard();
      await dashboardPage.clickMenu('Scans', 'Sources');
      await dashboardPage.verifyPageOpened(ScansPage.PATH, 'Scan history', 'Scans');
      await expect(page.getByText('View past scans and track your scan history')).toBeVisible();
      await expect(scansPage.searchInput).toBeVisible();
      await expect(scansPage.searchInput).toHaveAttribute('placeholder', 'Search by repository name…');
      await expect(scansPage.refreshButton).toBeVisible();
    },
  );

  test(
    'TC27 - Scan table shows all columns and how many scans are shown @scans',
    {
      annotation: {
        type: 'description',
        description: 'Checks the column names of the table and the "Showing N of M scans." text below it.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      await expect(scansPage.columnHeaders).toHaveText(ScansPage.COLUMNS);
      await expect(scansPage.tableRows.first()).toBeVisible();

      const count = await scansPage.getShowingCount();
      Logger.info(`Scan history: showing ${count.shown} of ${count.total} scans`);
      expect(count.shown, 'scans shown').toBeGreaterThan(0);
      expect(count.shown, 'shown is not more than the total').toBeLessThanOrEqual(count.total);
      await expect(scansPage.tableRows).toHaveCount(count.shown);
    },
  );

  test(
    'TC28 - Scans are listed newest first @scans',
    {
      annotation: {
        type: 'description',
        description: 'Checks the Date column goes from the newest scan to the oldest.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const rows = await scansPage.getAllRows();
      const times = rows.map((r) => new Date(r.date).getTime());
      expect(
        times.every((t) => !Number.isNaN(t)),
        'every Date is a valid date',
      ).toBe(true);
      for (let i = 1; i < times.length; i++) {
        expect(
          times[i],
          `row ${i + 1} (${rows[i].date}) is not newer than row ${i} (${rows[i - 1].date})`,
        ).toBeLessThanOrEqual(times[i - 1]);
      }
    },
  );

  test(
    'TC29 - Every scan row has a repository, type, status and View button @scans',
    {
      annotation: {
        type: 'description',
        description: 'Checks no row is missing its repository name, type, status, file count or View button.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const rows = await scansPage.getAllRows();
      for (const [i, row] of rows.entries()) {
        const where = `row ${i + 1} (${row.date})`;
        expect.soft(row.repository, `${where}: repository`).toMatch(/^[\w.-]+\/[\w.-]+$/);
        expect.soft(row.type, `${where}: type`).not.toBe('');
        expect.soft(row.status, `${where}: status`).not.toBe('');
        expect.soft(row.files, `${where}: files is a number`).not.toBeNaN();
        expect.soft(row.scanId, `${where}: View button`).toMatch(/^[0-9a-f-]{36}$/);
      }
      Logger.info(`Types: ${[...new Set(rows.map((r) => r.type))].join(', ')}`);
      Logger.info(`Statuses: ${[...new Set(rows.map((r) => r.status))].join(', ')}`);
    },
  );

  test(
    'TC30 - Total findings equals crypto findings plus asset inventory @scans',
    {
      annotation: {
        type: 'description',
        description:
          'For every scan, checks Total Findings = Crypto Findings + Asset Inventory ("—" counts as 0, the "(N unfiltered)" note is ignored).',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const rows = await scansPage.getAllRows();
      for (const [i, row] of rows.entries()) {
        expect
          .soft(
            row.totalFindings,
            `row ${i + 1} ${row.repository} (${row.date}): ${row.cryptoFindings} crypto + ${row.assetInventory} assets`,
          )
          .toBe(row.cryptoFindings + row.assetInventory);
      }
    },
  );

  test(
    'TC31 - Searching a repository name shows only the scans of that repository @scans',
    {
      annotation: {
        type: 'description',
        description:
          'Types the name of the newest scanned repository in the search box and checks every row belongs to it.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const repo = (await scansPage.getAllRows())[0].repository;
      const searchText = repo.split('/')[1];

      await scansPage.searchRepo(searchText);
      // the list filters about a second after typing
      await expect(async () => {
        const rows = await scansPage.getAllRows();
        const others = rows.filter((r) => !r.repository.toLowerCase().includes(searchText.toLowerCase()));
        expect(
          others.map((r) => r.repository),
          `rows not matching "${searchText}"`,
        ).toEqual([]);
      }).toPass({ timeout: 15_000 });
      await expect(scansPage.repoRows(repo).first()).toBeVisible();
      Logger.info(`Search "${searchText}": ${await scansPage.tableRows.count()} scans`);
    },
  );

  test(
    'TC32 - Searching an unknown repository shows no scans, clearing the search shows them again @scans',
    {
      annotation: {
        type: 'description',
        description:
          'Searches a repository name that does not exist, checks the "0 scans matching" message, then clears the search.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const before = await scansPage.getShowingCount();

      await scansPage.searchRepo('no-such-repo-qa-automation');
      await expect(scansPage.noResultsMessage).toHaveText('0 scans matching "no-such-repo-qa-automation".');
      await expect(scansPage.tableRows).toHaveCount(0);

      await scansPage.clearSearch();
      await expect(scansPage.showingCount).toBeVisible();
      await expect(scansPage.tableRows).toHaveCount(before.shown);
    },
  );

  test(
    'TC33 - Refresh reloads the scan list @scans',
    {
      annotation: {
        type: 'description',
        description: 'Clicks Refresh and checks the scan list is shown again with the same scans.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const firstBefore = (await scansPage.getAllRows())[0];

      await scansPage.clickRefresh();
      await expect(scansPage.heading).toBeVisible();
      await expect(scansPage.tableRows.first()).toBeVisible();
      const firstAfter = (await scansPage.getAllRows())[0];
      // a new scan may arrive meanwhile: then the newest one is newer, never older
      expect(new Date(firstAfter.date).getTime()).toBeGreaterThanOrEqual(new Date(firstBefore.date).getTime());
    },
  );

  test(
    'TC34 - View opens the results of the selected scan @scans',
    {
      annotation: {
        type: 'description',
        description:
          'Clicks View on the newest scan and checks the Scan Results page of that scan and repository opens.',
      },
    },
    async () => {
      await scansPage.ensureOpen();
      const scan = (await scansPage.getAllRows())[0];

      await scansPage.openScan(scan.scanId);
      await scanResultsPage.verifyOpenedFor(scan.repository);
      await expect(scanResultsPage.scanInfo).toContainText(
        `Viewing results for scan ${scan.scanId} of ${scan.repository}`,
      );
    },
  );
});
