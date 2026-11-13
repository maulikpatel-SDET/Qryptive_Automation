import { test } from '../fixtures/base.fixture';
import { AuthManager } from '../auth/AuthManager';

// Pages opened from the sidebar in TC12.
// group = the sidebar group the link is inside (groups are closed by default).
const SIDEBAR_PAGES = [
  { link: 'Applications', group: 'Inventory', path: '/applications', heading: 'Business Applications' },
  { link: 'Certificates', group: 'Inventory', path: '/cbom/certificates', heading: 'Certificates' },
  { link: 'Vendors', path: '/vendors', heading: 'Vendors' },
  { link: 'Executive Summary', path: '/executive-summary', heading: 'PQC Migration Executive Summary' },
  { link: 'Team', path: '/team', heading: 'Team' },
  { link: 'Policies', group: 'Compliance', path: '/cbom/policies', heading: 'Policies' },
];

test.describe('Qryptive Dashboard (logged in)', () => {
  // All tests here use the saved login from TC01 / TC02 - no email needed.
  test.use({ storageState: AuthManager.sessionFile() });

  // 1. Skip all tests if there is no saved login (checked before the browser starts).
  test.beforeEach(() => {
    test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
  });

  // 2. Every test starts on the dashboard.
  test.beforeEach(async ({ dashboardPage }) => {
    await dashboardPage.openDashboard();
  });

  test('TC10 - Sidebar shows the main menu @dashboard', async ({ dashboardPage }) => {
    await dashboardPage.verifyDashboardIsActive();
    await dashboardPage.verifyMenuItemsVisible(['Dashboard', 'Vendors', 'Executive Summary', 'Team'], 'link');
    await dashboardPage.verifyMenuItemsVisible(
      ['Inventory', 'Explore', 'Remediate', 'Compliance', 'Sources', 'Settings'],
      'group',
    );
  });

  test('TC11 - Inventory group shows its sub-menu @dashboard', async ({ dashboardPage }) => {
    await dashboardPage.expandGroup('Inventory');
    await dashboardPage.verifyMenuItemsVisible(
      ['Applications', 'Private Keys', 'Keypairs', 'Key Exposures', 'Certificates', 'Protocols',
        'Tokens', 'Data at Rest', 'Cloud', 'Secrets', 'Algorithms', 'Crypto Agility'],
      'link',
    );
  });

  test('TC12 - Sidebar links open the correct pages @dashboard', async ({ dashboardPage }) => {
    for (const item of SIDEBAR_PAGES) {
      await test.step(`Open ${item.link}`, async () => {
        await dashboardPage.clickMenu(item.link, item.group);
        await dashboardPage.verifyPageOpened(item.path, item.heading, item.link);
      });
    }
  });

  test('TC13 - User stays logged in after page reload @dashboard', async ({ dashboardPage }) => {
    await dashboardPage.clickMenu('Vendors');
    await dashboardPage.verifyPageOpened('/vendors', 'Vendors', 'Vendors');

    await dashboardPage.reloadPage();
    await dashboardPage.verifyPageOpened('/vendors', 'Vendors', 'Vendors');

    await dashboardPage.clickMenu('Dashboard');
    await dashboardPage.verifyDashboardIsActive();
  });
});
