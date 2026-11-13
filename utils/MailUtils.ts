import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Logger } from './Logger';
import { getEnvVar } from './Utils';
import { waitUntil } from './WaitUtils';

/** Reads the inbox (IMAP) and gets the magic link from the latest email. */
export class MailUtils {
  /**
   * Get the HTML of the newest email received after `sentAfter`.
   * Returns null if no new email has arrived yet.
   */
  static async getLatestEmail(sentAfter: Date): Promise<string | null> {
    const client = new ImapFlow({
      host: getEnvVar('MAIL_HOST'),
      port: 993,
      secure: true,
      auth: { user: getEnvVar('MAIL_USER'), pass: getEnvVar('MAIL_PASSWORD') },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const ids = await client.search({ since: sentAfter }, { uid: true });
      if (!ids || ids.length === 0) {
        return null;
      }

      // The last id is the newest email.
      const newestId = String(ids[ids.length - 1]);
      const message = await client.fetchOne(newestId, { source: true, internalDate: true }, { uid: true });
      if (!message || !message.source || !message.internalDate) {
        return null;
      }

      // Ignore old emails (1 minute margin for clock differences).
      if (new Date(message.internalDate).getTime() < sentAfter.getTime() - 60_000) {
        return null;
      }

      const email = await simpleParser(message.source);
      return email.html || email.text || null;
    } finally {
      lock.release();
      await client.logout();
    }
  }

  /** Find the Qryptive login link inside the email content. */
  static extractMagicLink(emailContent: string, baseUrl: string): string {
    const allLinks = emailContent.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    const qryptiveHost = new URL(baseUrl).host;

    const magicLink = allLinks
      .map((link) => link.replace(/&amp;/g, '&'))
      .find((link) => new URL(link).host === qryptiveHost && /magic|token|verify|auth|login/i.test(link));

    if (!magicLink) {
      throw new Error('Magic link not found in the email');
    }
    return magicLink;
  }

  /** Wait (max 2 minutes) for the email, then return the magic link. */
  static async waitForMagicLink(sentAfter: Date, baseUrl: string): Promise<string> {
    Logger.info('Waiting for the magic-link email...');
    const emailContent = await waitUntil(() => MailUtils.getLatestEmail(sentAfter), 120_000, 5_000);
    Logger.info('Magic-link email received');
    return MailUtils.extractMagicLink(emailContent, baseUrl);
  }
}
