import { expect, type Locator, type Page } from '@playwright/test';
import type { EnvConfig } from '../../utils/ConfigUtils';
import { Logger } from '../../utils/Logger';

/** One row of the Scan history table. */
export interface ScanRowData {
  date: string;
  type: string;
  status: string;
  cryptoFindings: string;
  assetInventory: string;
  totalFindings: string;
  files: string;
}

/** Every column of one Scan history row (numbers: "—" = 0). */
export interface ScanTableRow {
  date: string; // "Nov 17, 2026, 01:47:26 PM"
  repository: string; // full name from the cell title
  type: string;
  status: string;
  cryptoFindings: number;
  assetInventory: number;
  totalFindings: number; // without the "(56 unfiltered)" chip
  files: number;
  scanId: string; // from the View button
}

/**
 * Page Object for Sources > Scans (https://app.qryptive.ai/scans) - "Scan history".
 * Newest scan first; the Repository column is shortened, so rows are found by searching.
 */
export class ScansPage {
  static readonly PATH = '/scans';

  // ---------- Locators ----------
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly refreshButton: Locator;
  readonly tableRows: Locator;
  readonly columnHeaders: Locator;
  readonly showingCount: Locator;
  readonly noResultsMessage: Locator;

  // shown in capitals on screen (CSS), the text itself is "Date", "Repository", ...
  static readonly COLUMNS = [
    'Date',
    'Repository',
    'Type',
    'Status',
    'Crypto Findings',
    'Asset Inventory',
    'Total Findings',
    'Files',
    'Actions',
  ];

  constructor(
    private readonly page: Page,
    private readonly config: EnvConfig,
  ) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Scan history' });
    this.searchInput = page.getByRole('textbox', { name: 'Search scans by repository name' });
    this.refreshButton = page.getByRole('button', { name: 'Refresh scan history' });
    this.tableRows = page.locator('table tbody tr');
    this.columnHeaders = page.locator('table thead th');
    this.showingCount = page.getByText(/^Showing \d+ of \d+ scans\.$/); // "Showing 50 of 1048 scans."
    this.noResultsMessage = page.getByText(/^0 scans matching "/);
  }

  // ---------- Actions ----------

  async open(): Promise<void> {
    Logger.info('Opening Scan history');
    await this.page.goto(this.config.baseUrl + ScansPage.PATH);
    await expect(this.heading).toBeVisible();
  }

  /**
   * Make sure Scan history is shown with no search filter - WITHOUT reloading when possible:
   *   - already on the page: only clear the search box if it has text
   *   - on another page: open the Scans page
   */
  async ensureOpen(): Promise<void> {
    const onScansPage = new URL(this.page.url()).pathname === ScansPage.PATH && (await this.heading.isVisible());
    if (!onScansPage) {
      await this.open();
    } else if (await this.searchInput.inputValue()) {
      await this.clearSearch();
    } else {
      Logger.info('Already on Scan history - no reload');
    }
    await expect(this.showingCount).toBeVisible(); // full list shown ("Showing 50 of 1048 scans.")
  }

  async searchRepo(repoName: string): Promise<void> {
    Logger.info(`Searching Scan history for ${repoName}`);
    await this.searchInput.fill(repoName);
  }

  async clearSearch(): Promise<void> {
    Logger.info('Clearing the search');
    await this.searchInput.fill('');
  }

  async clickRefresh(): Promise<void> {
    Logger.info('Clicking Refresh');
    await this.refreshButton.click();
  }

  /** "Showing 50 of 1048 scans." -> { shown: 50, total: 1048 } */
  async getShowingCount(): Promise<{ shown: number; total: number }> {
    const m = (await this.showingCount.innerText()).match(/Showing (\d+) of (\d+)/)!;
    return { shown: Number(m[1]), total: Number(m[2]) };
  }

  /** All rows currently in the table. */
  async getAllRows(): Promise<ScanTableRow[]> {
    await expect(this.tableRows.first()).toBeVisible();
    const raw = await this.tableRows.evaluateAll((rows) =>
      rows.map((row) => {
        const cells = [...row.querySelectorAll('td')];
        const text = (i: number) => (cells[i]?.textContent ?? '').trim();
        return {
          date: text(0),
          repository: cells[1]?.querySelector('span[title]')?.getAttribute('title') ?? text(1),
          type: text(2),
          status: text(3),
          crypto: text(4),
          asset: text(5),
          total: (cells[6]?.querySelector('[data-testid="total-findings-value"]')?.textContent ?? text(6)).trim(),
          files: text(7),
          view: cells[8]?.querySelector('button')?.getAttribute('aria-label') ?? '',
        };
      }),
    );
    const num = (v: string) => (v === '—' || v === '' ? 0 : Number(v.replace(/,/g, ''))); // "1,516" -> 1516
    return raw.map((r) => ({
      date: r.date,
      repository: r.repository,
      type: r.type,
      status: r.status,
      cryptoFindings: num(r.crypto),
      assetInventory: num(r.asset),
      totalFindings: num(r.total),
      files: num(r.files),
      scanId: r.view.replace('View results for scan ', ''),
    }));
  }

  /** Click View on the row of this scan id. */
  async openScan(scanId: string): Promise<void> {
    Logger.info(`Opening scan ${scanId}`);
    await this.page.getByRole('button', { name: `View results for scan ${scanId}`, exact: true }).click();
    await expect(this.page).toHaveURL(new RegExp(`/scan-results/${scanId}$`));
  }

  /** Rows of one repo. The Repository column is shortened, but its title has the full name. */
  repoRows(fullName: string): Locator {
    return this.tableRows.filter({ has: this.page.locator(`span[title="${fullName}"]`) });
  }

  /** Newest scan of the repo, e.g. "maulikpatel-SDET/qx-cert-lab" (search waits ~1s before filtering). */
  async getLatestScan(fullName: string): Promise<ScanRowData> {
    await this.searchRepo(fullName.split('/').pop()!);
    const row = this.repoRows(fullName).first();
    await expect(row).toBeVisible();
    const cells = row.locator('td');
    const text = async (i: number) => (await cells.nth(i).innerText()).trim();
    const data: ScanRowData = {
      date: await text(0),
      type: await text(2),
      status: await text(3),
      cryptoFindings: await text(4),
      assetInventory: await text(5),
      totalFindings: (await cells.nth(6).getByTestId('total-findings-value').innerText()).trim(),
      files: await text(7),
    };
    Logger.info(`Latest scan of ${fullName}: ${JSON.stringify(data)}`);
    return data;
  }

  /** Open the results of the repo's newest scan. */
  async openLatestScanResults(fullName: string): Promise<void> {
    await this.repoRows(fullName)
      .first()
      .getByRole('button', { name: /View results for scan/ })
      .click();
    await expect(this.heading).toBeHidden();
    Logger.info(`Scan results opened: ${this.page.url()}`);
  }

  // ---------- Checks ----------

  /** Latest scan finished, scanned files and found at least `minFindings` crypto findings. */
  async verifyLatestScanCompleted(fullName: string, minFindings: number): Promise<ScanRowData> {
    const scan = await this.getLatestScan(fullName);
    expect(scan.status, 'Scan status').toBe('completed');
    expect(Number(scan.files), 'Files scanned').toBeGreaterThan(0);
    expect(Number(scan.totalFindings), 'Total findings').toBeGreaterThanOrEqual(minFindings);
    return scan;
  }
}
