import { test as base, expect } from '@playwright/test';
import { CodeSourcesPage } from '../pages/sources/CodeSourcesPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { RepositoriesPage } from '../pages/sources/RepositoriesPage';
import { ScanResultsPage } from '../pages/sources/ScanResultsPage';
import { ScansPage } from '../pages/sources/ScansPage';
import { getConfig, type EnvConfig } from '../utils/ConfigUtils';

/**
 * Fixtures = ready-made objects that every test receives automatically.
 * Instead of writing `new LoginPage(page, getConfig())` in each test,
 * a test just asks for `loginPage` or `dashboardPage`.
 */
type MyFixtures = {
  config: EnvConfig;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  codeSourcesPage: CodeSourcesPage;
  repositoriesPage: RepositoriesPage;
  scansPage: ScansPage;
  scanResultsPage: ScanResultsPage;
};

export const test = base.extend<MyFixtures>({
  config: async ({}, use) => {
    await use(getConfig());
  },

  loginPage: async ({ page, config }, use) => {
    await use(new LoginPage(page, config));
  },

  dashboardPage: async ({ page, config }, use) => {
    await use(new DashboardPage(page, config));
  },

  codeSourcesPage: async ({ page, config }, use) => {
    await use(new CodeSourcesPage(page, config));
  },

  repositoriesPage: async ({ page, config }, use) => {
    await use(new RepositoriesPage(page, config));
  },

  scansPage: async ({ page, config }, use) => {
    await use(new ScansPage(page, config));
  },

  scanResultsPage: async ({ page, config }, use) => {
    await use(new ScanResultsPage(page, config));
  },
});

export { expect };
