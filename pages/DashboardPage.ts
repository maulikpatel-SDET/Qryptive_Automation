import { expect, type Locator, type Page } from '@playwright/test';
import type { EnvConfig } from '../utils/ConfigUtils';
import { Logger } from '../utils/Logger';

/**
 * Page Object for the left sidebar menu shown after login.
 * Locators are at the top, actions (methods) below.
 */
export class DashboardPage {
  // ---------- Locators ----------
  readonly sidebar: Locator;
  readonly activeMenuItem: Locator;
  readonly commandCenterHeading: Locator;

  constructor(
    private readonly page: Page,
    private readonly config: EnvConfig,
  ) {
    this.sidebar = page.locator('nav');
    this.activeMenuItem = this.sidebar.locator('a[aria-current="page"]');
    this.commandCenterHeading = page.getByRole('heading', { name: 'Command center' });
  }

  /** A link in the sidebar, e.g. "Vendors" or "Applications". */
  menuLink(name: string): Locator {
    return this.sidebar.getByRole('link', { name, exact: true });
  }

  /** A group button in the sidebar, e.g. "Inventory" or "Settings". */
  menuGroup(name: string): Locator {
    return this.sidebar.getByRole('button', { name, exact: true });
  }

  // ---------- Actions ----------

  async openDashboard(): Promise<void> {
    Logger.info('Opening dashboard');
    await this.page.goto(this.config.baseUrl + this.config.dashboardPath);
    await expect(this.commandCenterHeading).toBeVisible();
  }

  /** Open a sidebar group (groups are closed by default). */
  async expandGroup(groupName: string): Promise<void> {
    const group = this.menuGroup(groupName);
    if ((await group.getAttribute('aria-expanded')) !== 'true') {
      Logger.info(`Opening sidebar group: ${groupName}`);
      await group.click();
    }
    await expect(group).toHaveAttribute('aria-expanded', 'true');
  }

  /** Click a sidebar link. If it is inside a group, open the group first. */
  async clickMenu(linkName: string, groupName?: string): Promise<void> {
    if (groupName) {
      await this.expandGroup(groupName);
    }
    Logger.info(`Clicking sidebar link: ${linkName}`);
    await this.menuLink(linkName).click();
  }

  async reloadPage(): Promise<void> {
    Logger.info('Reloading page');
    await this.page.reload();
  }

  // ---------- Checks ----------

  /** The page opened: correct URL, main heading and the menu item is marked active. */
  async verifyPageOpened(path: string, heading: string, linkName: string): Promise<void> {
    await expect(this.page).toHaveURL(this.config.baseUrl + path);
    await expect(this.page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(this.activeMenuItem).toHaveText(linkName);
    Logger.info(`Page "${heading}" is displayed`);
  }

  async verifyMenuItemsVisible(names: string[], type: 'link' | 'group'): Promise<void> {
    for (const name of names) {
      const item = type === 'link' ? this.menuLink(name) : this.menuGroup(name);
      await expect(item, `Sidebar item "${name}"`).toBeVisible();
    }
    Logger.info(`Sidebar ${type}s visible: ${names.join(', ')}`);
  }

  async verifyDashboardIsActive(): Promise<void> {
    await expect(this.activeMenuItem).toHaveText('Dashboard');
    await expect(this.commandCenterHeading).toBeVisible();
    Logger.info('Dashboard is the active menu item');
  }
}
