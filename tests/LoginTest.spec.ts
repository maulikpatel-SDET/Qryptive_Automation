import { test, expect } from '../fixtures/base.fixture';
import { AuthManager } from '../auth/AuthManager';
import { MailUtils } from '../utils/MailUtils';
import { getEnvVar } from '../utils/Utils';

test.describe('Qryptive Login', () => {
  // ---------------- Login with magic link ----------------

  test('TC01 - Magic link login @magic', async ({ loginPage, config, context }) => {
    const email = getEnvVar('LOGIN_EMAIL');
    getEnvVar('MAIL_PASSWORD'); // stop early if the mailbox password is not set in .env

    await loginPage.openLoginPage();
    await loginPage.enterEmail(email);

    const sentTime = new Date();
    await loginPage.clickSendMagicLink();
    await loginPage.verifyConfirmationMessage();

    const magicLink = await MailUtils.waitForMagicLink(sentTime, config.baseUrl);

    await loginPage.openMagicLink(magicLink);
    await loginPage.verifyLoggedIn();
    await loginPage.verifyDashboard();

    await AuthManager.saveSession(context); // used by the session tests
  });

  test('TC02 - Direct magic link login @direct', async ({ loginPage, context }) => {
    const magicLink = process.env.MAGIC_LINK;
    test.skip(!magicLink, 'No MAGIC_LINK given');

    await loginPage.openMagicLink(magicLink!);
    await loginPage.verifyLoggedIn();
    await loginPage.verifyDashboard();

    await AuthManager.saveSession(context); // used by the session tests
  });

  test.describe('With saved session', () => {
    // Start the browser with the saved session (already logged in).
    test.use({ storageState: AuthManager.sessionFile() });

    test.beforeEach(() => {
      test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
    });

    test('TC03 - Existing session login @session', async ({ loginPage }) => {
      await loginPage.openApp();
      await loginPage.verifyLoggedIn();
      await loginPage.openDashboard();
      await loginPage.verifyDashboard();
    });
  });

  // ---------------- Login page checks (no email is sent) ----------------

  test('TC04 - Login page shows all elements @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.verifyLoginPageElements();
  });

  test('TC05 - Empty email is not accepted @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.clickSendMagicLink(); // email field left empty
    await loginPage.verifyEmailIsRejected();
  });

  test('TC06 - Invalid email format is not accepted @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.enterEmail('invalid-email');
    await loginPage.clickSendMagicLink();
    await loginPage.verifyEmailIsRejected();
  });

  test('TC07 - Sign up link opens the sign up page @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.clickSignUp();
    await loginPage.verifySignUpPage();
  });

  test('TC08 - Invalid magic link shows an error @loginpage', async ({ loginPage, config }) => {
    await loginPage.openMagicLink(config.baseUrl + '/auth/verify?token=invalid-test-token');
    await loginPage.verifyInvalidLinkMessage();
  });

  test('TC09 - Logged-out user cannot open the dashboard @loginpage', async ({ loginPage }) => {
    await loginPage.openDashboard();
    await loginPage.verifyRedirectedToLanding();
  });

  // ---------------- Demo: this test FAILS ON PURPOSE ----------------
  // Use it to check that a failure screenshot is added to the HTML report.
  test('TC14 - Intentional failure to check screenshot in report @faildemo', async ({ loginPage, page }) => {
    await loginPage.openLoginPage();
    await loginPage.verifyLoginPageElements(); // this part passes

    // This heading does not exist on the login page, so the test always fails here.
    await expect(page.getByRole('heading', { name: 'This Heading Does Not Exist' })).toBeVisible({
      timeout: 5_000,
    });
  });
});
