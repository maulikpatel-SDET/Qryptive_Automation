import { expect, type Locator, type Page } from '@playwright/test';
import type { EnvConfig } from '../../utils/ConfigUtils';
import { Logger } from '../../utils/Logger';
import { cellByHeader } from '../../utils/TableUtils';

/** Options of the "Enroll a repository" form (unset = keep the default). */
export interface EnrollOptions {
  fullRepoScan?: boolean; // Scan scope: "Full repo every run" instead of "Changed files only"
  runOnPullRequests?: boolean;
  weeklyScan?: boolean;
  failBuilds?: boolean;
  autoFixPrs?: boolean;
  sendToDashboard?: boolean;
}

/**
 * Page Object for Sources > Code Sources (GitHub Action tab) and the
 * 3-step enroll flow: Enroll form -> Step 1 (secret) -> Step 2 (workflow file).
 */
export class CodeSourcesPage {
  static readonly PATH = '/integrations?source=gha';
  static readonly WORKFLOW_FILE = '.github/workflows/pqc-scan.yml';

  // ---------- Locators: page ----------
  readonly heading: Locator;
  readonly githubActionTab: Locator;
  readonly addRepoButton: Locator;
  readonly repoRows: Locator;

  // ---------- Locators: Enroll form ----------
  readonly enrollHeading: Locator;
  readonly repoInput: Locator;
  readonly scopeChanged: Locator;
  readonly scopeAll: Locator;
  readonly optPullRequests: Locator;
  readonly optWeekly: Locator;
  readonly optFailBuilds: Locator;
  readonly optAutoFix: Locator;
  readonly optSendToDashboard: Locator;
  readonly cancelButton: Locator;
  readonly enrollButton: Locator;

  // ---------- Locators: Step 1 / Step 2 ----------
  readonly step1Title: Locator;
  readonly openSecretSettings: Locator;
  readonly secretAddedButton: Locator;
  readonly step2Title: Locator;
  readonly addToGitHub: Locator;
  readonly branchInput: Locator;
  readonly yamlBlock: Locator;
  readonly finishButton: Locator;

  constructor(
    private readonly page: Page,
    private readonly config: EnvConfig,
  ) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Code Sources' });
    this.githubActionTab = page.getByRole('navigation', { name: 'Code sources' }).getByRole('button', { name: /^GitHub Action/ });
    this.addRepoButton = page.getByRole('button', { name: 'Add repo' });
    this.repoRows = page.locator('table tbody tr');

    this.enrollHeading = page.getByRole('heading', { level: 2, name: 'Enroll a repository' });
    this.repoInput = page.getByPlaceholder('acme-corp/billing-service');
    this.scopeChanged = page.getByTestId('scan-scope-changed');
    this.scopeAll = page.getByTestId('scan-scope-all');
    this.optPullRequests = page.getByTestId('opt-pr');
    this.optWeekly = page.getByTestId('opt-schedule');
    this.optFailBuilds = page.getByTestId('opt-fail');
    this.optAutoFix = page.getByTestId('opt-autofix');
    this.optSendToDashboard = page.getByTestId('opt-send-to-qryptive');
    this.cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    this.enrollButton = page.getByRole('button', { name: /Enroll & generate YAML/ });

    this.step1Title = page.getByText('Step 1 of 2 — Add the GitHub secret first');
    // Shows "Open repository secret settings →" but its aria-label is "Open repository secrets",
    // so match the test id / visible text instead of the accessible name.
    this.openSecretSettings = page.getByTestId('secret-settings-btn');
    this.secretAddedButton = page.locator('button').filter({ hasText: "I've added the secret" });
    this.step2Title = page.getByText('Step 2 of 2 — Add the workflow file');
    this.addToGitHub = page.locator('a, button').filter({ hasText: 'Add to GitHub' }).first();
    // Only shown when Qryptive "couldn't reach GitHub to check" the default branch.
    this.branchInput = page.getByText('Default branch', { exact: true }).locator('xpath=following::input[1]');
    this.yamlBlock = page.locator('pre, code').filter({ hasText: 'name: PQC Vulnerability Scan' }).first();
    this.finishButton = page.locator('button').filter({ hasText: "I've committed the workflow" });
  }

  /** The table row of one repo, e.g. "maulikpatel-SDET/Qryptive_Automation". */
  repoRow(fullName: string): Locator {
    return this.repoRows.filter({ has: this.page.locator(`span[title="${fullName}"]`) });
  }

  enrolledTitle(fullName: string): Locator {
    return this.page.getByText(`${fullName} enrolled`);
  }

  // ---------- Actions ----------

  async open(): Promise<void> {
    Logger.info('Opening Code Sources');
    const url = this.config.baseUrl + CodeSourcesPage.PATH;
    try {
      await this.page.goto(url);
    } catch (error) {
      // e.g. net::ERR_NETWORK_CHANGED when Wi-Fi/VPN switches - try once more
      Logger.error(`Opening Code Sources failed (${String(error).split('\n')[0]}), retrying`);
      await this.page.waitForTimeout(5_000);
      await this.page.goto(url);
    }
    await expect(this.heading).toBeVisible();
    await expect(this.addRepoButton).toBeVisible();
    await this.waitForTableLoaded();
  }

  /**
   * The repo table first shows a few placeholder rows, then the real list.
   * Sometimes the list request fails ("Failed to load fleet." + Retry) - then press Retry / reload.
   */
  async waitForTableLoaded(): Promise<void> {
    const realRow = this.repoRows.filter({ has: this.page.locator('span[title*="/"]') }).first();
    const loadError = this.page.getByText('Failed to load fleet.');
    await expect(async () => {
      if (await loadError.isVisible()) {
        Logger.error('Code Sources: "Failed to load fleet." - retrying');
        await this.page.getByRole('button', { name: 'Retry' }).click().catch(() => this.page.reload());
      }
      await expect(realRow).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000, intervals: [3_000] });
  }

  /** Reload until the repo row is listed (it can take a moment after enrolling). */
  async waitForRepoListed(fullName: string, timeoutMs = 90_000): Promise<void> {
    await expect(async () => {
      if ((await this.repoRow(fullName).count()) === 0) {
        await this.page.reload();
        await this.waitForTableLoaded();
      }
      await expect(this.repoRow(fullName)).toHaveCount(1, { timeout: 5_000 });
    }).toPass({ timeout: timeoutMs, intervals: [5_000] });
    Logger.info(`${fullName} is listed in Code Sources`);
  }

  async openEnrollForm(): Promise<void> {
    Logger.info('Clicking Add repo');
    await this.addRepoButton.click();
    await expect(this.enrollHeading).toBeVisible();
  }

  /** Default values of the Enroll form (as shown in the product). */
  async verifyEnrollFormDefaults(): Promise<void> {
    await expect(this.repoInput).toBeEmpty();
    await expect(this.scopeChanged).toBeChecked();
    await expect(this.scopeAll).not.toBeChecked();
    await expect(this.optPullRequests).toBeChecked();
    await expect(this.optWeekly).toBeChecked();
    await expect(this.optFailBuilds).not.toBeChecked();
    await expect(this.optAutoFix).not.toBeChecked();
    await expect(this.optSendToDashboard).toBeChecked();
    Logger.info('Enroll form shows the default options');
  }

  async fillEnrollForm(fullName: string, options: EnrollOptions = {}): Promise<void> {
    Logger.info(`Enrolling repo ${fullName}`);
    await this.repoInput.fill(fullName);
    if (options.fullRepoScan !== undefined) await (options.fullRepoScan ? this.scopeAll : this.scopeChanged).check();
    const boxes: [Locator, boolean | undefined][] = [
      [this.optPullRequests, options.runOnPullRequests],
      [this.optWeekly, options.weeklyScan],
      [this.optFailBuilds, options.failBuilds],
      [this.optAutoFix, options.autoFixPrs],
      [this.optSendToDashboard, options.sendToDashboard],
    ];
    for (const [box, value] of boxes) {
      if (value !== undefined) await box.setChecked(value);
    }
  }

  async clickEnroll(): Promise<void> {
    await this.enrollButton.click();
  }

  /** Step 1: title, explanation and the link to the repo's secret settings page. */
  async verifyStep1(fullName: string): Promise<void> {
    await expect(this.enrolledTitle(fullName)).toBeVisible();
    await expect(this.step1Title).toBeVisible();
    await expect(this.page.getByText('Add the GitHub secret first', { exact: true })).toBeVisible();
    await expect(this.openSecretSettings).toBeVisible();
    const href = await this.openSecretSettings.getAttribute('href');
    if (href) {
      expect(href, 'Secret settings link').toContain(`github.com/${fullName}/settings/secrets/actions`);
    }
    Logger.info('Step 1 (add GitHub secret) is displayed');
  }

  async clickSecretAdded(): Promise<void> {
    Logger.info("Clicking I've added the secret - continue");
    await this.secretAddedButton.click();
    await expect(this.step2Title).toBeVisible();
  }

  /** Step 2: title + "Add to GitHub" link that opens the new-file page of the repo. */
  async verifyStep2(fullName: string): Promise<void> {
    await expect(this.step2Title).toBeVisible();
    await expect(this.addToGitHub).toBeVisible();
    const href = await this.addToGitHub.getAttribute('href');
    if (href) {
      expect(href, 'Add to GitHub link').toContain(`github.com/${fullName}/new/`);
      expect(decodeURIComponent(href)).toContain('pqc-scan.yml');
    }
    Logger.info('Step 2 (add workflow file) is displayed');
  }

  /** Fill "Default branch" when Qryptive could not detect it. */
  async confirmBranch(branch: string): Promise<void> {
    if (await this.branchInput.isVisible()) {
      Logger.info(`Confirming default branch: ${branch}`);
      await this.branchInput.fill(branch);
      await expect(this.branchInput).toHaveValue(branch);
    }
  }

  /**
   * The workflow YAML exactly as "Add to GitHub" would commit it
   * (from the link's `value=` parameter), or from the code block as a fallback.
   */
  async getWorkflowYaml(branch: string): Promise<string> {
    let yaml = '';
    const href = await this.addToGitHub.getAttribute('href');
    if (href) {
      yaml = new URL(href).searchParams.get('value') ?? '';
    }
    if (!yaml) {
      yaml = (await this.yamlBlock.textContent()) ?? '';
    }
    expect(yaml, 'Generated workflow YAML').toContain('name: PQC Vulnerability Scan');
    expect(yaml).toContain('PQC_API_KEY');
    expect(yaml, 'Workflow runs on the confirmed branch').toContain(`"${branch}"`);
    Logger.info(`Workflow YAML read (${yaml.length} chars)`);
    return yaml.endsWith('\n') ? yaml : yaml + '\n';
  }

  async clickFinish(): Promise<void> {
    Logger.info("Clicking I've committed the workflow - finish");
    await this.finishButton.click();
    await expect(this.step2Title).toBeHidden();
  }

  /** Reload Code Sources until the repo row shows `status` (e.g. "Active"). */
  async waitForRepoStatus(fullName: string, status: string, timeoutMs: number): Promise<void> {
    Logger.info(`Waiting for ${fullName} to become ${status}`);
    await expect(async () => {
      await this.page.reload();
      await this.waitForTableLoaded();
      const statusCell = await cellByHeader(this.page, this.repoRow(fullName), 'Status');
      const current = (await statusCell.innerText({ timeout: 10_000 })).split('\n')[0];
      Logger.info(`Current status of ${fullName}: ${current}`);
      expect(current.toLowerCase()).toBe(status.toLowerCase());
    }).toPass({ timeout: timeoutMs, intervals: [15_000] });
  }

  /** Row shows a real last-scan time and a findings number. Returns the findings count. */
  async verifyRepoScanned(fullName: string): Promise<number> {
    const row = this.repoRow(fullName);
    await expect(row).toHaveCount(1);
    const lastScan = await cellByHeader(this.page, row, 'Last scan');
    await expect(lastScan).not.toHaveText('—');
    await expect(lastScan).toHaveText(/ago|just now/i);
    const findings = Number((await (await cellByHeader(this.page, row, 'Findings')).innerText()).trim());
    expect(Number.isNaN(findings), 'Findings is a number').toBe(false);
    Logger.info(`${fullName}: last scan ${await lastScan.innerText()}, findings ${findings}`);
    return findings;
  }

  /** Row actions (⋯) > Delete > browser confirm "Remove <repo> from the fleet?" > OK. */
  async deleteRepo(fullName: string): Promise<void> {
    Logger.info(`Deleting ${fullName} from Code Sources`);
    const row = this.repoRow(fullName);
    await row.getByRole('button', { name: 'Row actions' }).click(); // Playwright scrolls the table right

    // The click only finishes after the confirm() is answered, so handle the dialog in the listener.
    let message = '';
    let type = '';
    this.page.once('dialog', async (dialog) => {
      message = dialog.message();
      type = dialog.type();
      await dialog.accept();
    });
    await this.page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => message).not.toBe('');
    expect(type).toBe('confirm');
    expect(message).toBe(`Remove ${fullName} from the fleet?`);
    Logger.info(`Confirmed: "${message}"`);
  }

  async verifyRepoNotListed(fullName: string): Promise<void> {
    await expect(this.repoRow(fullName)).toHaveCount(0);
    await this.page.reload();
    await expect(this.heading).toBeVisible();
    await this.waitForTableLoaded();
    await expect(this.repoRow(fullName)).toHaveCount(0);
    Logger.info(`${fullName} is no longer listed in Code Sources`);
  }
}
