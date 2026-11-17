import { expect, type Locator, type Page } from '@playwright/test';
import type { EnvConfig } from '../../utils/ConfigUtils';
import { Logger } from '../../utils/Logger';

/** One row of the Repositories table. */
export interface RepositoryRowData {
  riskLevel: string;
  riskScore: string;
  fips: string;
  totalScans: number;
  lastScanned: string;
}

/**
 * Page Object for Sources > Repositories (https://app.qryptive.ai/repositories).
 * Lists every scanned repository with its risk level, scan count and last scan date.
 */
export class RepositoriesPage {
  static readonly PATH = '/repositories';

  // ---------- Locators ----------
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly riskLevelFilter: Locator;
  readonly clearFiltersButton: Locator;
  readonly tableRows: Locator;

  constructor(
    private readonly page: Page,
    private readonly config: EnvConfig,
  ) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Repositories' });
    this.searchInput = page.getByPlaceholder('Search repositories...');
    this.riskLevelFilter = page.getByRole('combobox');
    this.clearFiltersButton = page.getByRole('button', { name: 'Clear Filters' });
    this.tableRows = page.locator('table tbody tr');
  }

  /** The row of one repo, matched by its GitHub URL, e.g. "maulikpatel-SDET/qx-cert-lab". */
  repoRow(fullName: string): Locator {
    return this.tableRows.filter({ hasText: `https://github.com/${fullName}` });
  }

  // ---------- Actions ----------

  async open(): Promise<void> {
    Logger.info('Opening Repositories');
    await this.page.goto(this.config.baseUrl + RepositoriesPage.PATH);
    await expect(this.heading).toBeVisible();
    await expect(this.searchInput).toBeVisible();
  }

  async searchRepo(fullName: string): Promise<void> {
    Logger.info(`Searching Repositories for ${fullName}`);
    await this.searchInput.fill(fullName);
  }

  async getRepoRowData(fullName: string): Promise<RepositoryRowData> {
    const cells = this.repoRow(fullName).locator('td');
    const text = async (i: number) => (await cells.nth(i).innerText()).trim();
    return {
      riskLevel: await text(1),
      riskScore: await text(2),
      fips: await text(3),
      totalScans: Number(await text(4)),
      lastScanned: (await text(5)).replace(/\s+/g, ' '),
    };
  }

  /** Row button "Last Scan" -> opens that repo's latest scan results. */
  async clickLastScan(fullName: string): Promise<void> {
    Logger.info(`Clicking Last Scan for ${fullName}`);
    await this.repoRow(fullName).getByRole('button', { name: 'Last Scan' }).click();
    await expect(this.page).toHaveURL(/\/scan-results\//);
  }

  // ---------- Checks ----------

  /** Repo is listed with at least one scan and a last-scanned date. Returns the row data. */
  async verifyRepoListedWithScan(fullName: string): Promise<RepositoryRowData> {
    await this.searchRepo(fullName);
    await expect(this.repoRow(fullName)).toHaveCount(1);
    const data = await this.getRepoRowData(fullName);
    expect(data.totalScans, 'Total Scans').toBeGreaterThanOrEqual(1);
    expect(data.lastScanned, 'Last Scanned').not.toBe('—');
    Logger.info(`Repositories: ${fullName} ${JSON.stringify(data)}`);
    return data;
  }

  /** Row action buttons are shown for the repo. */
  async verifyRowActions(fullName: string): Promise<void> {
    const row = this.repoRow(fullName);
    await expect(row.getByRole('button', { name: 'Last Scan' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'View connections' })).toBeVisible();
    await expect(row.getByRole('button', { name: `Download CBOM for ${fullName}` })).toBeVisible();
  }
}
