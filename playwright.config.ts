import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { getConfig } from './utils/ConfigUtils';
import { askQuestion } from './utils/Utils';

// 1. Load secrets from the .env file
dotenv.config({ quiet: true });

// 2. Pick the environment (ENV=qa / console question / default qa)
const env = getConfig();
console.log(`Running tests on ${env.name}: ${env.baseUrl}`);

// 3. Scenario 2: ask for the magic link if it was not given
if (process.argv.includes('@direct') && !process.env.MAGIC_LINK) {
  process.env.MAGIC_LINK = askQuestion('Paste the magic link: ');
}

export default defineConfig({
  testDir: './tests',
  outputDir: './screenshots', // failure screenshots are saved here
  timeout: 180_000, // 3 minutes per test (waiting for the email takes time)
  workers: 1, // run the tests one after another, in order
  retries: Number(process.env.RETRIES ?? 0), // RETRIES=1 re-runs a failed test once (saved as attempt 2)
  expect: { timeout: 15_000 }, // wait up to 15 seconds for each check (pages load data)

  reporter: [
    ['list'],
    ['html', { outputFolder: './reports', open: 'never' }],
    ['./database/DatabaseReporter.ts'], // saves every test result to PostgreSQL
    ['./utils/EmailReporter.ts'], // emails the summary + report after the run (keep it last)
  ],

  use: {
    channel: 'chrome', // use the Google Chrome installed on this computer
    headless: process.env.HEADLESS === 'true', // browser window is shown (HEADLESS=true hides it)
    viewport: { width: 1600, height: 900 },
    // When a test fails, take a full-page screenshot and attach it to the HTML report.
    screenshot: { mode: 'only-on-failure', fullPage: true },
    trace: 'retain-on-failure', // saved as a TRACE artifact in the database
    video: 'retain-on-failure', // saved as a VIDEO artifact in the database
  },
});
