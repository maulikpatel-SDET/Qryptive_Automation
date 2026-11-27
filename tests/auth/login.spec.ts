import { test, expect } from '../../fixtures/base.fixture';
import { AuthManager } from '../../auth/AuthManager';
import { MailUtils } from '../../utils/MailUtils';
import { LoginPage } from '../../pages/auth/LoginPage';
import { getEnvVar } from '../../utils/Utils';

test.describe('Login - Sign in with a magic link', () => {
  // ---------------- Login with magic link ----------------

  test('TC01 - User logs in with the magic link sent by email @magic', async ({ loginPage, config, context }) => {
    const email = getEnvVar('LOGIN_EMAIL');
    getEnvVar('MAIL_PASSWORD'); // stop early if the mailbox password is not set in .env

    await loginPage.openLoginPage();
    await loginPage.enterEmail(email);

    const sentTime = new Date();
    await loginPage.clickContinue();
    await loginPage.verifyConfirmationMessage();

    const magicLink = await MailUtils.waitForMagicLink(sentTime, config.baseUrl);

    await loginPage.openMagicLink(magicLink);
    await loginPage.verifyLoggedIn();
    // Save right after login, so a dashboard UI change does not skip all the session tests.
    await AuthManager.saveSession(context); // used by the session tests
    await loginPage.verifyDashboard();
  });

  test('TC02 - User logs in by opening a magic link directly @direct', async ({ loginPage, context, browser, config }) => {
    // Use MAGIC_LINK from .env when given. Otherwise ask for a new link in ANOTHER browser
    // and open it here, in a clean browser (like opening the email on a second device).
    let magicLink = process.env.MAGIC_LINK;
    if (!magicLink) {
      const email = getEnvVar('LOGIN_EMAIL');
      getEnvVar('MAIL_PASSWORD');
      const requestContext = await browser.newContext();
      try {
        const requestPage = new LoginPage(await requestContext.newPage(), config);
        await requestPage.openLoginPage();
        await requestPage.enterEmail(email);
        const sentTime = new Date();
        await requestPage.clickContinue();
        await requestPage.verifyConfirmationMessage();
        magicLink = await MailUtils.waitForMagicLink(sentTime, config.baseUrl);
      } finally {
        await requestContext.close();
      }
    }

    await loginPage.openMagicLink(magicLink);
    await loginPage.verifyLoggedIn();
    // Save right after login, so a dashboard UI change does not skip all the session tests.
    await AuthManager.saveSession(context); // used by the session tests
    await loginPage.verifyDashboard();
  });

  test.describe('With saved session', () => {
    // Start the browser with the saved session (already logged in).
    test.use({ storageState: AuthManager.sessionFile() });

    test.beforeEach(() => {
      test.skip(!AuthManager.hasSession(), 'No saved session - run TC01 or TC02 first');
    });

    test('TC03 - Logged-in user stays logged in when opening the app again @session', async ({ loginPage }) => {
      await loginPage.openApp();
      await loginPage.verifyLoggedIn();
      await loginPage.openDashboard();
      await loginPage.verifyDashboard();
    });
  });

  // ---------------- Login page checks (no email is sent) ----------------

  test('TC04 - Login page shows the email box, Continue button, Google/Microsoft buttons and Sign up link @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.verifyLoginPageElements();
  });

  test('TC05 - Login is blocked when the email is empty @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.clickContinue(); // email field left empty
    await loginPage.verifyEmailIsRejected();
  });

  test('TC06 - Login is blocked when the email format is wrong @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.enterEmail('invalid-email');
    await loginPage.clickContinue();
    await loginPage.verifyEmailIsRejected();
  });

  test('TC07 - Sign up link opens the sign up page @loginpage', async ({ loginPage }) => {
    await loginPage.openLoginPage();
    await loginPage.clickSignUp();
    await loginPage.verifySignUpPage();
  });

  test('TC08 - An invalid or expired login link shows an error message @loginpage', async ({ loginPage, config }) => {
    await loginPage.openMagicLink(config.baseUrl + '/auth/verify?token=invalid-test-token');
    await loginPage.verifyInvalidLinkMessage();
  });

  test('TC09 - Logged-out user is sent away from the dashboard @loginpage', async ({ loginPage }) => {
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
