import fs from 'fs';
import path from 'path';
import { expect, type BrowserContext } from '@playwright/test';
import { Logger } from '../utils/Logger';

/**
 * Saves the logged-in browser session (cookies + local storage) to a file,
 * so the next test can reuse it without logging in again.
 * One file per environment: auth/session-qa.json, auth/session-staging.json, ...
 */
export class AuthManager {
  static sessionFile(): string {
    return path.join(__dirname, `session-${process.env.ENV}.json`);
  }

  static async saveSession(context: BrowserContext): Promise<void> {
    // The app writes the login token to local storage a moment after the redirect.
    // Wait for it, otherwise an empty (logged-out) session is saved.
    await expect
      .poll(
        async () => (await context.storageState()).origins.some((o) => o.localStorage.some((i) => i.name === 'accessToken')),
        { message: 'accessToken was not stored after login', timeout: 15_000 },
      )
      .toBe(true);
    await context.storageState({ path: AuthManager.sessionFile() });
    Logger.info('Session saved');
  }

  static hasSession(): boolean {
    return fs.existsSync(AuthManager.sessionFile());
  }
}
