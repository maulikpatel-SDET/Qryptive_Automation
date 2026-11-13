import { expect, type Locator, type Page } from '@playwright/test';
import type { EnvConfig } from '../utils/ConfigUtils';
import { Logger } from '../utils/Logger';

/**
 * Page Object for the Qryptive login page.
 * Locators are at the top, actions (methods) below.
 */
export class LoginPage {
  // ---------- Locators ----------
  // TODO: if the real Qryptive page uses other text, change it here.
  readonly emailInput: Locator;
  readonly sendMagicLinkButton: Locator;
  readonly confirmationMessage: Locator;
  readonly loginErrorMessage: Locator;
  readonly welcomeHeading: Locator;
  readonly signInSubtitle: Locator;
  readonly signUpLink: Locator;
  readonly signUpHeading: Locator;
  readonly invalidLinkMessage: Locator;
  readonly tryAgainButton: Locator;
  // Dashboard ("Command center") locators
  readonly dashboardHeading: Locator;
  readonly dashboardSubtitle: Locator;
  readonly dashboardMenuItem: Locator;
  readonly pqReadinessCard: Locator;
  readonly openItemsCard: Locator;
  readonly complianceCard: Locator;

  constructor(
    private readonly page: Page,
    private readonly config: EnvConfig,
  ) {
    this.emailInput = page.locator('#email');
    this.sendMagicLinkButton = page.locator('button.auth-button[type="submit"]'); // "Send Login Link"
    // TODO: confirm the exact text shown after clicking "Send Login Link"
    this.confirmationMessage = page.getByText(/check your (email|inbox)|link (has been |was )?sent|we('ve| have) sent/i);
    // Error shown under the button, e.g. "Rate limit exceeded. Please try again later."
    this.loginErrorMessage = page.getByText(/rate limit|try again later|error|invalid|failed/i);
    this.welcomeHeading = page.getByRole('heading', { name: 'Welcome to Qryptive' });
    this.signInSubtitle = page.getByText('Sign in to your account');
    this.signUpLink = page.getByRole('link', { name: 'Sign up' });
    this.signUpHeading = page.getByText('Get Started with Qryptive');
    this.invalidLinkMessage = page.getByText('Invalid or expired magic link');
    this.tryAgainButton = page.getByText('Try Again');
    this.dashboardHeading = page.getByRole('heading', { name: 'Command center' });
    this.dashboardSubtitle = page.getByText(/quantum-readiness posture at a glance/i);
    this.dashboardMenuItem = page.getByRole('link', { name: 'Dashboard', exact: true });
    // Summary cards: the texts also appear in a help panel, so match the card itself
    // (the image / link whose name starts with the card title, e.g. "Open items 7893 ...").
    this.pqReadinessCard = page.getByRole('img', { name: /^PQ readiness/ });
    this.openItemsCard = page.getByRole('link', { name: /^Open items/ });
    this.complianceCard = page.getByRole('link', { name: /^Compliance/ });
  }

  // ---------- Actions ----------

  async openLoginPage(): Promise<void> {
    Logger.info('Opening login page');
    await this.page.goto(this.config.baseUrl + this.config.loginPath);
  }

  /** All elements of the login page are shown. */
  async verifyLoginPageElements(): Promise<void> {
    await expect(this.welcomeHeading).toBeVisible();
    await expect(this.signInSubtitle).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.emailInput).toHaveAttribute('placeholder', 'your@email.com');
    await expect(this.sendMagicLinkButton).toHaveText('Send Login Link');
    await expect(this.signUpLink).toBeVisible();
    Logger.info('Login page elements are visible');
  }

  /** The browser blocked the form because the email field is empty or not a valid email. */
  async verifyEmailIsRejected(): Promise<void> {
    const isValid = await this.emailInput.evaluate((input: HTMLInputElement) => input.validity.valid);
    expect(isValid).toBe(false);
    await expect(this.page).toHaveURL(this.config.baseUrl + this.config.loginPath); // still on login page
    Logger.info('Email was rejected by the form');
  }

  async clickSignUp(): Promise<void> {
    Logger.info('Clicking Sign up');
    await this.signUpLink.click();
  }

  async verifySignUpPage(): Promise<void> {
    await expect(this.page).toHaveURL(this.config.baseUrl + '/auth/signup');
    await expect(this.signUpHeading).toBeVisible();
    Logger.info('Sign up page is displayed');
  }

  async verifyInvalidLinkMessage(): Promise<void> {
    await expect(this.invalidLinkMessage).toBeVisible({ timeout: 15_000 });
    await expect(this.tryAgainButton).toBeVisible();
    await expect(this.dashboardHeading).toBeHidden();
    Logger.info('Invalid link message is displayed');
  }

  /** A user who is not logged in is sent to the public landing page. */
  async verifyRedirectedToLanding(): Promise<void> {
    await expect(this.page).toHaveURL(this.config.baseUrl + '/landing');
    await expect(this.dashboardHeading).toBeHidden();
    Logger.info('User was redirected to the landing page');
  }

  async enterEmail(email: string): Promise<void> {
    Logger.info('Entering email');
    await this.emailInput.fill(email);
  }

  async clickSendMagicLink(): Promise<void> {
    Logger.info('Clicking Send Magic Link');
    await this.sendMagicLinkButton.click();
  }

  /**
   * Wait up to 15 seconds for the result of "Send Login Link":
   * - success message appears -> go to the next step
   * - error message appears (e.g. rate limit) -> stop with that error
   */
  async verifyConfirmationMessage(): Promise<void> {
    const successOrError = this.confirmationMessage.or(this.loginErrorMessage).first();
    await expect(successOrError).toBeVisible({ timeout: 15_000 });

    if (await this.loginErrorMessage.first().isVisible()) {
      const errorText = await this.loginErrorMessage.first().innerText();
      Logger.error('Qryptive showed an error: ' + errorText);
      throw new Error(`Login link was not sent. Qryptive says: "${errorText}"`);
    }

    Logger.info('Confirmation message is visible');
  }

  async openMagicLink(magicLink: string): Promise<void> {
    // Safety check: only open links of our own Qryptive environment.
    if (!magicLink.startsWith(this.config.baseUrl)) {
      throw new Error('Magic link does not belong to ' + this.config.baseUrl);
    }
    Logger.info('Opening magic link'); // the link itself is not logged (it is a secret)
    await this.page.goto(magicLink);
  }

  async openApp(): Promise<void> {
    Logger.info('Opening Qryptive application');
    await this.page.goto(this.config.baseUrl);
  }

  async openDashboard(): Promise<void> {
    Logger.info('Opening dashboard');
    await this.page.goto(this.config.baseUrl + this.config.dashboardPath);
  }

  /** Logged in = we are no longer on the login page. */
  async verifyLoggedIn(): Promise<void> {
    await expect(this.page).not.toHaveURL(new RegExp(this.config.loginPath));
    await expect(this.emailInput).toBeHidden();
    Logger.info('User is logged in');
  }

  /**
   * Expected result after login:
   * - URL is https://app.qryptive.ai/
   * - "Dashboard" menu item is visible in the left sidebar
   * - Page heading "Command center" and its subtitle are visible
   * - Summary cards "PQ readiness", "Open items" and "Compliance" are visible
   */
  async verifyDashboard(): Promise<void> {
    await expect(this.page).toHaveURL(this.config.baseUrl + this.config.dashboardPath);
    await expect(this.dashboardMenuItem).toBeVisible();
    await expect(this.dashboardHeading).toBeVisible();
    await expect(this.dashboardSubtitle).toBeVisible();
    await expect(this.pqReadinessCard).toBeVisible();
    await expect(this.openItemsCard).toBeVisible();
    await expect(this.complianceCard).toBeVisible();
    Logger.info('Dashboard (Command center) is displayed');
  }
}
