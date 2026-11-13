import { test as base, expect } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
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
});

export { expect };
