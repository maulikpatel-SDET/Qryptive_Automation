import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Logger } from './Logger';
import { getEnvVar } from './Utils';
import { waitUntil } from './WaitUtils';

/** Reads the inbox (IMAP) and gets the magic link from the latest email. */
export class MailUtils {
  /** Open the inbox, run `action`, then always close the connection. */
  private static async withInbox<T>(action: (client: ImapFlow) => Promise<T>): Promise<T> {
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
      return await action(client);
    } finally {
      lock.release();
      await client.logout();
    }
  }

  /**
   * UID of the newest email in the inbox right now (0 if the inbox is empty).
   * Call it BEFORE requesting a login link: the new email always gets a higher UID,
   * so an older (already used) login email is never picked up by mistake.
   */
  static async getNewestUid(): Promise<number> {
    return MailUtils.withInbox(async (client) => {
      const ids = await client.search({ all: true }, { uid: true });
      return ids && ids.length > 0 ? Math.max(...ids) : 0;
    });
  }

  /**
   * Get the HTML of the newest email that arrived after the email with UID `afterUid`.
   * Returns null if no new email has arrived yet.
   */
  static async getLatestEmail(afterUid: number): Promise<string | null> {
    return MailUtils.withInbox(async (client) => {
      const ids = ((await client.search({ uid: `${afterUid + 1}:*` }, { uid: true })) || []).filter(
        (id) => id > afterUid, // "n:*" also returns the newest email when there is nothing newer
      );
      if (ids.length === 0) {
        return null;
      }

      const newestId = String(Math.max(...ids));
      const message = await client.fetchOne(newestId, { source: true }, { uid: true });
      if (!message || !message.source) {
        return null;
      }

      const email = await simpleParser(message.source);
      return email.html || email.text || null;
    });
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

  /** Wait (max 2 minutes) for a NEW email (UID above `afterUid`), then return its magic link. */
  static async waitForMagicLink(afterUid: number, baseUrl: string): Promise<string> {
    Logger.info('Waiting for the magic-link email...');
    const emailContent = await waitUntil(() => MailUtils.getLatestEmail(afterUid), 120_000, 5_000);
    Logger.info('Magic-link email received');
    return MailUtils.extractMagicLink(emailContent, baseUrl);
  }
}
