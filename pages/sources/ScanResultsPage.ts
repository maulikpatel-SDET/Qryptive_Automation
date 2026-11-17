import { expect, type Locator, type Page } from '@playwright/test';
import type { EnvConfig } from '../../utils/ConfigUtils';
import { Logger } from '../../utils/Logger';
import { toStatusBucket, type ActualFinding, type StatusBucket } from '../../utils/ScanComparator';

/** Numbers at the top of the page and on the tabs. */
export interface ScanSummary {
  cryptoFindings: number; // "72 crypto findings"
  assets: number; // "7 assets"
  findingsTab: number; // "Findings (79)"
  filesTab: number; // "Files (27)"
}

/** One card of "Findings Breakdown" on the Summary tab. */
export interface BreakdownCard {
  category: string;
  total: number;
  statusCounts: { label: string; count: number }[]; // e.g. 28 Quantum Vulnerable
}

/** One row of the Files tab. */
export interface FileRow {
  file: string;
  counts: Record<StatusBucket, number>; // "2 secure 1 vulnerable 1 unclassified"
}

/**
 * Page Object for one scan's results (https://app.qryptive.ai/scan-results/<scan id>).
 * Opened from Repositories > "Last Scan" or Scans > "View".
 * Tabs: Summary | Findings (Crypto Findings / Asset Inventory) | Files | PRs Created
 */
export class ScanResultsPage {
  // ---------- Locators ----------
  readonly heading: Locator;
  readonly scanInfo: Locator;
  readonly headerCounts: Locator;
  readonly summaryTab: Locator;
  readonly findingsTab: Locator;
  readonly filesTab: Locator;
  readonly prsTab: Locator;
  readonly breakdownCards: Locator;
  readonly cryptoFindingsButton: Locator;
  readonly assetInventoryButton: Locator;
  readonly showMoreButtons: Locator;

  constructor(
    private readonly page: Page,
    private readonly config: EnvConfig,
  ) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Scan Results' });
    this.scanInfo = page.getByText(/^Viewing results for scan /);
    this.headerCounts = page
      .getByRole('heading', { level: 2, name: 'Scan Results' })
      .locator('xpath=following-sibling::div[1]');
    this.summaryTab = page.getByRole('button', { name: 'Summary', exact: true });
    this.findingsTab = page.getByRole('button', { name: /^Findings \(\d+\)$/ });
    this.filesTab = page.getByRole('button', { name: /^Files \(\d+\)$/ });
    this.prsTab = page.getByRole('button', { name: /^PRs Created \(\d+\)$/ });
    this.breakdownCards = page.getByTestId('category-breakdown-card');
    this.cryptoFindingsButton = page.getByRole('button', { name: /^Crypto Findings \(\d+\)$/ });
    this.assetInventoryButton = page.getByRole('button', { name: /^Asset Inventory \(\d+\)$/ });
    this.showMoreButtons = page.getByRole('button', { name: /^Show the last \d+ hidden/ });
  }

  // ---------- Actions ----------

  currentUrl(): string {
    return this.page.url();
  }

  async open(url: string): Promise<void> {
    Logger.info(`Opening scan results ${url}`);
    await this.page.goto(url);
    await expect(this.heading).toBeVisible();
  }

  /** Open this scan's results only if Chrome is not already showing them (no reload). */
  async ensureOpen(url: string): Promise<void> {
    if (this.page.url() === url && (await this.heading.isVisible())) {
      Logger.info('Already on this scan - no reload');
      return;
    }
    await this.open(url);
  }

  /** The page shows the scan of this repo, with all tabs. */
  async verifyOpenedFor(fullName: string): Promise<void> {
    await expect(this.page).toHaveURL(/\/scan-results\/[0-9a-f-]+$/);
    await expect(this.heading).toBeVisible();
    await expect(this.scanInfo).toContainText(` of ${fullName} performed on `);
    for (const tab of [this.summaryTab, this.findingsTab, this.filesTab, this.prsTab]) {
      await expect(tab).toBeVisible();
    }
    Logger.info(`Scan results of ${fullName}: ${await this.scanInfo.innerText()}`);
  }

  async getSummary(): Promise<ScanSummary> {
    await expect(this.headerCounts).toContainText('crypto findings');
    const header = await this.headerCounts.innerText();
    const num = (text: string, re: RegExp) => Number(text.match(re)?.[1] ?? NaN);
    const summary = {
      cryptoFindings: num(header, /(\d+) crypto findings/),
      assets: num(header, /(\d+) assets?/),
      findingsTab: num(await this.findingsTab.innerText(), /\((\d+)\)/),
      filesTab: num(await this.filesTab.innerText(), /\((\d+)\)/),
    };
    Logger.info(`Scan summary: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** Summary tab > "Findings Breakdown" cards. */
  async getBreakdown(): Promise<BreakdownCard[]> {
    await this.summaryTab.click();
    await expect(this.breakdownCards.first()).toBeVisible();
    // card = [name] [total "findings"] [status lines "28 Quantum Vulnerable"]
    const cards = await this.breakdownCards.evaluateAll((els) =>
      els.map((card) =>
        [...card.querySelectorAll(':scope > div')].map((block) =>
          [...block.querySelectorAll('span')].map((s) => (s.textContent ?? '').trim()).filter(Boolean),
        ),
      ),
    );
    return cards.map(([name = [], total = [], statuses = []]) => ({
      category: name[0] ?? '',
      total: Number(total[0]),
      statusCounts: statuses
        .map((t) => t.match(/^(\d+) (.+)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ count: Number(m[1]), label: m[2] })),
    }));
  }

  /** Findings tab > Crypto Findings: every finding of every category (hidden ones included). */
  async getCryptoFindings(stripPrefix = ''): Promise<ActualFinding[]> {
    await this.findingsTab.click();
    await this.cryptoFindingsButton.click();
    return this.readFindingGroups(stripPrefix);
  }

  /** Findings tab > Asset Inventory: keys, certificates, tokens. */
  async getAssetInventory(stripPrefix = ''): Promise<ActualFinding[]> {
    await this.findingsTab.click();
    await this.assetInventoryButton.click();
    const assets = await this.readFindingGroups(stripPrefix);
    return assets.map((a) => ({ ...a, type: 'Asset' as const }));
  }

  /** Files tab: every file with its secure / vulnerable / unclassified counts. */
  async getFiles(stripPrefix = ''): Promise<FileRow[]> {
    await this.filesTab.click();
    await expect(this.page.locator('main button[aria-expanded]').first()).toBeVisible();
    await this.expandAll();
    const rows = await this.page.locator('main button[aria-expanded]').evaluateAll((buttons) =>
      buttons.map((b) => ({
        file: b.querySelector('span')?.textContent?.trim() ?? '',
        text: b.textContent ?? '',
      })),
    );
    return rows
      .filter((r) => /\d+ (vulnerable|secure|unclassified)/.test(r.text))
      .map((r) => {
        const counts: Record<StatusBucket, number> = { vulnerable: 0, safe: 0, unknown: 0 };
        for (const m of r.text.matchAll(/(\d+) (vulnerable|secure|unclassified)/g)) {
          counts[toStatusBucket(m[2])] += Number(m[1]);
        }
        return { file: stripPath(r.file, stripPrefix), counts };
      });
  }

  // ---------- Helpers ----------

  /** Click every "Show the last N hidden ..." button so nothing is hidden. */
  private async expandAll(): Promise<void> {
    for (let i = 0; i < 20 && (await this.showMoreButtons.count()) > 0; i++) {
      await this.showMoreButtons.first().click();
    }
  }

  /**
   * Read the grouped list on the Findings tab:
   *   <button>[Category] (N)</button>      <- group header
   *   <div> <button>[status dot][Algorithm][file:line][tags]</button> ... </div>
   */
  private async readFindingGroups(stripPrefix: string): Promise<ActualFinding[]> {
    // The groups render one after another: read until we have as many rows as "72 of 84 findings" says.
    const shownCount = this.page.getByText(/^\d+ of \d+ findings$/);
    let raw: RawRow[] = [];
    await expect(async () => {
      await this.expandAll();
      const expectedRows = Number((await shownCount.innerText({ timeout: 5_000 })).match(/^(\d+)/)![1]);
      raw = await this.readRawRows();
      expect(raw.length, 'findings read from the page').toBe(expectedRows);
    }).toPass({ timeout: 60_000, intervals: [1_000] });

    const findings = raw.map((r): ActualFinding => {
      const m = r.location.match(/^(.*?)(?::(\d+))?$/)!;
      return {
        type: r.tags.includes('Dependency') ? 'Dependency' : 'Crypto',
        category: r.category,
        algorithm: r.algorithm,
        statusLabel: r.statusLabel,
        status: toStatusBucket(r.statusLabel),
        file: stripPath(m[1], stripPrefix),
        line: m[2] ? Number(m[2]) : null,
        tags: r.tags,
      };
    });
    Logger.info(`Read ${findings.length} findings from the results page`);
    return findings;
  }

  private async readRawRows(): Promise<RawRow[]> {
    return this.page.locator('main').evaluate((main) => {
      const out: { category: string; statusLabel: string; algorithm: string; location: string; tags: string[] }[] = [];
      for (const header of main.querySelectorAll('button')) {
        const spans = header.querySelectorAll(':scope > div:first-child > span');
        if (spans.length !== 2 || !/^\(\d+\)$/.test(spans[1].textContent!.trim())) continue;
        const category = spans[0].textContent!.trim();
        const list = header.nextElementSibling;
        if (!list) continue;
        for (const row of list.querySelectorAll('button')) {
          const parts = row.querySelectorAll(':scope > div > span');
          if (parts.length < 3 || !parts[0].getAttribute('title')) continue;
          out.push({
            category,
            statusLabel: parts[0].getAttribute('title')!,
            algorithm: parts[1].textContent!.trim(),
            location: parts[2].textContent!.trim(),
            tags: [...(parts[3]?.querySelectorAll('span') ?? [])].map((t) => t.textContent!.trim()).filter(Boolean),
          });
        }
      }
      return out;
    });
  }
}

/** One finding row as read from the page, before converting to ActualFinding. */
interface RawRow {
  category: string;
  statusLabel: string;
  algorithm: string;
  location: string;
  tags: string[];
}

function stripPath(file: string, prefix: string): string {
  return prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
