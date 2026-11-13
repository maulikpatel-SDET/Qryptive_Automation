import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

dotenv.config({ quiet: true });

/** One row in the email table. */
type TestRow = {
  title: string;
  file: string;
  status: string; // passed | failed | timedOut | skipped | interrupted | flaky
  durationMs: number;
  error?: string;
  screenshots: string[];
};

const REPORT_FILE = path.join(__dirname, '..', 'reports', 'index.html');

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  passed: { label: 'PASSED', color: '#16a34a' },
  flaky: { label: 'FLAKY', color: '#d97706' },
  failed: { label: 'FAILED', color: '#dc2626' },
  timedOut: { label: 'TIMED OUT', color: '#dc2626' },
  interrupted: { label: 'INTERRUPTED', color: '#dc2626' },
  skipped: { label: 'SKIPPED', color: '#6b7280' },
};

/**
 * Custom Playwright reporter.
 * After all tests finish, it emails a summary (pass / fail / skip counts + a table of every test)
 * with the HTML report and the failure screenshots attached.
 *
 * Settings (.env):
 *   MAIL_USER, MAIL_PASSWORD  - Gmail account + App Password used to send
 *   REPORT_TO                 - who receives the email (comma separated). Default: MAIL_USER
 *   SEND_REPORT_EMAIL=false   - turn the email off
 */
export default class EmailReporter implements Reporter {
  private tests = new Map<string, TestRow>();
  private startTime = new Date();

  onBegin(): void {
    this.startTime = new Date();
  }

  /** Called after every test. If a test is retried, the last result wins. */
  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests.set(test.id, {
      title: test.title,
      file: path.basename(test.location.file),
      status: test.outcome() === 'flaky' ? 'flaky' : result.status,
      durationMs: result.duration,
      error: result.error?.message ? cleanError(result.error.message) : undefined,
      screenshots: result.attachments
        .filter((a) => a.contentType === 'image/png' && a.path && fs.existsSync(a.path))
        .map((a) => a.path!),
    });
  }

  /** Called once at the end of the run (after the HTML report is written). */
  async onEnd(result: FullResult): Promise<void> {
    if (process.env.SEND_REPORT_EMAIL === 'false') return;
    if (this.tests.size === 0) return; // nothing ran (e.g. --list)

    const user = process.env.MAIL_USER;
    const password = process.env.MAIL_PASSWORD;
    if (!user || !password) {
      console.log('[EmailReporter] MAIL_USER / MAIL_PASSWORD not set in .env - report email not sent.');
      return;
    }

    const rows = [...this.tests.values()];
    const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
    const summary = {
      total: rows.length,
      passed: count('passed', 'flaky'),
      failed: count('failed', 'timedOut', 'interrupted'),
      skipped: count('skipped'),
      env: (process.env.ENV ?? 'qa').toUpperCase(),
      duration: formatDuration(Date.now() - this.startTime.getTime()),
      overall: result.status === 'passed' ? 'PASSED' : 'FAILED',
    };

    const subject =
      `[Qryptive ${summary.env}] ${summary.overall === 'PASSED' ? '✅' : '❌'} Test run ${summary.overall} - ` +
      `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`;

    // Attachments: the HTML report + one screenshot per failed test
    const attachments: { filename: string; path: string }[] = [];
    if (fs.existsSync(REPORT_FILE)) {
      attachments.push({ filename: 'Qryptive-Test-Report.html', path: REPORT_FILE });
    }
    for (const row of rows.filter((r) => r.screenshots.length > 0)) {
      row.screenshots.forEach((file, i) => {
        attachments.push({ filename: `${safeName(row.title)}${i ? `-${i + 1}` : ''}.png`, path: file });
      });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass: password },
      });
      await transporter.sendMail({
        from: `"Qryptive Automation" <${user}>`,
        to: process.env.REPORT_TO || user,
        subject,
        html: buildHtml(summary, rows, this.startTime),
        attachments,
      });
      console.log(`[EmailReporter] Report email sent to ${process.env.REPORT_TO || user}`);
    } catch (error) {
      // Never fail the test run because the email could not be sent.
      console.error('[EmailReporter] Could not send report email:', (error as Error).message);
    }
  }
}

// ---------------- helpers ----------------

function buildHtml(
  s: { total: number; passed: number; failed: number; skipped: number; env: string; duration: string; overall: string },
  rows: TestRow[],
  startTime: Date,
): string {
  const overallColor = s.overall === 'PASSED' ? '#16a34a' : '#dc2626';
  const passRate = s.total - s.skipped > 0 ? Math.round((s.passed / (s.total - s.skipped)) * 100) : 0;

  const card = (label: string, value: number | string, color: string) => `
    <td style="padding:6px;">
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 10px;text-align:center;background:#fff;">
        <div style="font-size:26px;font-weight:700;color:${color};">${value}</div>
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">${label}</div>
      </div>
    </td>`;

  const tableRows = rows
    .map((r, i) => {
      const st = STATUS_STYLE[r.status] ?? { label: r.status.toUpperCase(), color: '#6b7280' };
      const error = r.error
        ? `<div style="margin-top:4px;font-size:12px;color:#b91c1c;font-family:monospace;">${escapeHtml(r.error)}</div>`
        : '';
      return `
      <tr style="background:${i % 2 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.title)}${error}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(r.file)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
          <span style="background:${st.color};color:#fff;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">${st.label}</span>
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatDuration(r.durationMs)}</td>
      </tr>`;
    })
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:20px;">
    <div style="max-width:820px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#1e3a8a;color:#fff;padding:18px 22px;">
        <div style="font-size:20px;font-weight:700;">Qryptive Automation - Test Report</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px;">
          Environment: <b>${s.env}</b> &nbsp;|&nbsp; Started: ${startTime.toLocaleString()} &nbsp;|&nbsp; Duration: ${s.duration}
        </div>
      </div>

      <div style="padding:18px 22px;">
        <div style="font-size:16px;">Overall result:
          <span style="color:${overallColor};font-weight:700;">${s.overall}</span>
          &nbsp;(${passRate}% pass rate)
        </div>

        <table style="width:100%;border-collapse:collapse;margin:14px 0;"><tr>
          ${card('Total', s.total, '#111827')}
          ${card('Passed', s.passed, '#16a34a')}
          ${card('Failed', s.failed, '#dc2626')}
          ${card('Skipped', s.skipped, '#6b7280')}
        </tr></table>

        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr style="background:#1f2937;color:#fff;text-align:left;">
            <th style="padding:8px;">#</th>
            <th style="padding:8px;">Test case</th>
            <th style="padding:8px;">File</th>
            <th style="padding:8px;">Status</th>
            <th style="padding:8px;text-align:right;">Time</th>
          </tr>
          ${tableRows}
        </table>

        <p style="font-size:12px;color:#6b7280;margin-top:18px;">
          Attached: <b>Qryptive-Test-Report.html</b> (full Playwright report)${s.failed > 0 ? ' and screenshots of failed tests' : ''}.
        </p>
      </div>
    </div>
  </div>`;
}

/** First useful line of an error, without terminal colour codes. */
function cleanError(message: string): string {
  const text = message.replace(/\u001b\[[0-9;]*m/g, '');
  return text.split('\n').filter((line) => line.trim() !== '').slice(0, 2).join(' ').slice(0, 300);
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
