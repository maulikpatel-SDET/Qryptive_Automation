# Qryptive Automation Framework

UI automation framework for the Qryptive web app, built with **Playwright + TypeScript** using the **Page Object Model**.
Results are saved to **PostgreSQL**, emailed as a report, and the suite runs on **GitHub Actions**.

## Framework Flow

```text
 npx playwright test
        │
        ▼
 1. playwright.config.ts
    ├─ loads .env (secrets)
    ├─ picks environment  ──► utils/ConfigUtils.ts ──► config/environment.yaml
    └─ registers reporters (list, html, database, email)
        │
        ▼
 2. Reporters start (onBegin)
    └─ DatabaseReporter: connect DB → run migrations → create test run
        │
        ▼
 3. Test file (tests/*.spec.ts)
    └─ imports `test` from fixtures/base.fixture.ts
        │
        ▼
 4. Fixtures create ready objects for each test
    ├─ config         (selected environment)
    └─ page objects   (pages/*.ts)
        │
        ▼
 5. Page objects drive the browser
    ├─ locators + actions + verifications
    └─ use helpers: MailUtils, WaitUtils, Logger, AuthManager
        │
        ▼
 6. After each test (onTestEnd)
    ├─ failure → screenshot, video, trace kept
    └─ DatabaseReporter saves execution + attempt + logs + artifacts
        │
        ▼
 7. After the run (onEnd)
    ├─ HTML report       → reports/
    ├─ DB run summary    → PostgreSQL
    └─ EmailReporter     → summary email with report + screenshots
```

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Config | `playwright.config.ts`, `config/environment.yaml`, `.env` | Browser settings, timeouts, reporters, environment URLs, secrets |
| Tests | `tests/` | Test scenarios only — no locators, no raw Playwright calls |
| Fixtures | `fixtures/base.fixture.ts` | Injects `config` and page objects into every test |
| Pages | `pages/` | One class per page: locators, actions and checks |
| Auth | `auth/AuthManager.ts` | Saves / reuses the logged-in session (`auth/session-<env>.json`) |
| Utils | `utils/` | Config loading, mailbox reading, waits, logging, email report |
| Database | `database/` | Reporter, repositories, services, migrations, artifact storage |
| CI | `.github/workflows/playwright.yml` | Runs the suite on GitHub Actions |

## Folder Structure

```text
qryptive_automation/
├── .github/workflows/playwright.yml   CI pipeline
├── auth/AuthManager.ts                session save / check
├── config/environment.yaml            qa / staging / production URLs
├── database/                          PostgreSQL reporting layer (see database/README.md)
├── fixtures/base.fixture.ts           custom Playwright fixtures
├── pages/                             page objects
├── tests/                             spec files
├── utils/
│   ├── ConfigUtils.ts                 reads environment.yaml, selects the environment
│   ├── MailUtils.ts                   reads the inbox (IMAP) and extracts the magic link
│   ├── WaitUtils.ts                   sleep / waitUntil polling helpers
│   ├── Logger.ts                      console + logs/execution.log
│   ├── EmailReporter.ts               custom reporter that emails the result
│   └── Utils.ts                       small helpers (env values, console input)
├── playwright.config.ts
├── .env.example
└── package.json
```

## Key Flows

### Environment selection
`utils/ConfigUtils.ts` decides the environment in this order:
1. `ENV` variable (`ENV=staging npx playwright test`)
2. otherwise asks in the console
3. empty answer → `qa`

The choice is stored in `process.env.ENV` so all workers use the same environment.

### Login and session reuse
1. The login page object submits the email and requests a magic link.
2. `MailUtils` polls the mailbox (IMAP) until the email arrives and extracts the link.
3. The browser opens the link and the session is saved by `AuthManager` to `auth/session-<env>.json`.
4. Tests that need a logged-in user load that file through `test.use({ storageState })`, so they skip the email step. If the file is missing, those tests are skipped.

### Reporting
Four reporters run on every execution:

| Reporter | Output |
|---|---|
| `list` | Console progress |
| `html` | `reports/index.html` |
| `database/DatabaseReporter.ts` | Run, executions, attempts, logs, failures and artifact paths in PostgreSQL |
| `utils/EmailReporter.ts` | Summary email with the HTML report and failure screenshots attached |

Database errors are printed as warnings only — they never change the test result.
Artifacts (screenshots, traces, videos, logs) are stored in `artifacts/<run>/<test>/attempt-<n>/`; only their paths go into the database.

### CI (GitHub Actions)
Triggered on push / pull request to `main`, or manually with an environment choice.

```text
checkout → install Node + deps → install Chrome
   → start PostgreSQL service
   → create login session
   → run test suite (headless)
   → upload HTML report, screenshots, artifacts, logs
```

Secrets (`LOGIN_EMAIL`, `MAIL_USER`, `MAIL_PASSWORD`, `REPORT_TO`, optional `DB_*`) are set in
*GitHub → Settings → Secrets and variables → Actions*. Only one run executes at a time because all runs share the same mailbox.

## Adding a New Test

1. **Page object** — create `pages/NewPage.ts` with locators and actions.
2. **Fixture** — register it in `fixtures/base.fixture.ts`:
   ```ts
   newPage: async ({ page, config }, use) => {
     await use(new NewPage(page, config));
   },
   ```
3. **Spec** — create `tests/NewTest.spec.ts`:
   ```ts
   import { test } from '../fixtures/base.fixture';
   import { AuthManager } from '../auth/AuthManager';

   test.describe('New feature', () => {
     test.use({ storageState: AuthManager.sessionFile() }); // only if login is needed

     test('does something @tag', async ({ newPage }) => {
       await newPage.open();
       await newPage.verifySomething();
     });
   });
   ```
4. Add a `@tag` to the title so the test can be run alone with `--grep @tag`.

## Setup (one time)

```bash
npm install
npx playwright install chromium
sudo npx playwright install-deps chromium
cp .env.example .env        # fill in your values
```

Set the real application URLs in `config/environment.yaml`.

## Run

```bash
ENV=qa npx playwright test             # or: npm run test:qa
ENV=staging npx playwright test        # or: npm run test:staging
ENV=production npx playwright test     # or: npm run test:production
npx playwright test --grep @tag        # run tests with a tag
npx playwright test --last-failed      # re-run failed tests
HEADLESS=true npx playwright test      # hide the browser
RETRIES=1 npx playwright test          # retry failures (saved as separate attempts)
npm run report                         # open the HTML report
```

## Configuration (.env)

| Variable | Purpose |
|---|---|
| `LOGIN_EMAIL` | User that receives the magic link |
| `MAIL_HOST` / `MAIL_USER` / `MAIL_PASSWORD` | Mailbox used to read the link and send the report |
| `REPORT_TO` | Report receivers, comma separated (empty = `MAIL_USER`) |
| `SEND_REPORT_EMAIL` | `false` turns the email off |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | PostgreSQL connection |
| `SAVE_RESULTS_TO_DB` | `false` runs without saving to the database |
| `ARTIFACT_DIR` | Where screenshots / traces / videos are stored |
| `RETRIES` | Number of retries for failed tests |

## Database Commands

```bash
npm run db:migrate     # create tables and views (also runs automatically on every test run)
npm run db:runs        # latest runs
npm run db:cases       # test cases with statistics
npm run db:failures    # failure analysis
npm run db:durations   # duration statistics
npm run db:stats       # overall statistics
```

Schema, ER diagram and sample queries: [database/README.md](database/README.md).

## Outputs

| Output | Location |
|---|---|
| HTML report | `reports/` |
| Failure screenshots | `screenshots/` |
| Artifacts per attempt | `artifacts/` |
| Execution log | `logs/execution.log` |
| Saved login session | `auth/session-<env>.json` |
