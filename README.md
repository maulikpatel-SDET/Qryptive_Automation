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
 3. Test file (tests/<module>/*.spec.ts)
    └─ imports `test` from fixtures/base.fixture.ts
        │
        ▼
 4. Fixtures create ready objects for each test
    ├─ config         (selected environment)
    └─ page objects   (pages/<module>/*.ts)
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
├── pages/                             page objects, one folder per module
│   ├── auth/LoginPage.ts
│   ├── dashboard/DashboardPage.ts
│   └── sources/CodeSourcesPage.ts, RepositoriesPage.ts, ScansPage.ts
├── tests/                             spec files, one folder per module
│   ├── auth/login.spec.ts                   TC01–TC09, TC14
│   ├── dashboard/sidebar-navigation.spec.ts TC10–TC13
│   ├── sources/github-repo-scan.spec.ts     TC15–TC18, TC25 (create, scan, delete repo)
│   ├── sources/repositories-last-scan.spec.ts TC19–TC24 (Last Scan results vs expected)
│   └── sources/scans.spec.ts                TC26–TC34 (Scan history page regression)
├── test-data/
│   ├── scan-repo.zip                   sample code pushed to GitHub by the repo scan test
│   └── scan-repo.expected-findings.csv expected scan results for that code (edit by hand)
├── utils/
│   ├── ConfigUtils.ts                 reads environment.yaml, selects the environment
│   ├── MailUtils.ts                   reads the inbox (IMAP) and extracts the magic link
│   ├── WaitUtils.ts                   sleep / waitUntil polling helpers
│   ├── GitHubApi.ts                   GitHub REST helper (repo, push, secret, workflow run)
│   ├── ScanComparator.ts              compares expected vs actual scan findings
│   ├── CsvUtils.ts                    read / write CSV files
│   ├── ScanRepoStore.ts               remembers the last repo created by the scan test
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

Naming rules:

| Item | Rule | Example |
|---|---|---|
| Folder | Module in the left menu, lower case | `tests/sources/`, `pages/sources/` |
| Spec file | Feature in kebab-case + `.spec.ts` | `github-repo-scan.spec.ts` |
| Page object | PascalCase + `Page.ts` | `CodeSourcesPage.ts` |
| `describe` | `<Module> - <feature in plain words>` | `Sources - Connect and scan a GitHub repository` |
| Test title | `TCxx - <who> <does what> <expected result> @tag` — readable by a non-technical person | `TC17 - Connected repository is scanned and shows as Active @reposcan` |
| Steps | `test.step('<plain-English action>')` | `Step 1 of 2 - Add the Qryptive API key to the repository as a secret` |

Keep the `TCxx` number when renaming a test: the database links the history of a test to that number.

1. **Page object** — create `pages/<module>/NewPage.ts` with locators and actions.
2. **Fixture** — register it in `fixtures/base.fixture.ts`:
   ```ts
   newPage: async ({ page, config }, use) => {
     await use(new NewPage(page, config));
   },
   ```
3. **Spec** — create `tests/<module>/new-feature.spec.ts`:
   ```ts
   import { test } from '../../fixtures/base.fixture';
   import { AuthManager } from '../../auth/AuthManager';

   test.describe('New feature', () => {
     test.use({ storageState: AuthManager.sessionFile() }); // only if login is needed

     test('does something @tag', async ({ newPage }) => {
       await newPage.open();
       await newPage.verifySomething();
     });
   });
   ```
4. Add a `@tag` to the title so the test can be run alone with `--grep @tag`.

## Scan Accuracy Tests (TC19–TC24)

`tests/sources/repositories-last-scan.spec.ts` (tag `@scanresults`) does not create anything.
It checks the repo that `github-repo-scan.spec.ts` created and saved in the last run
(`test-data/last-scanned-repo.json`), or `SCAN_RESULTS_REPO` from `.env`. The repo stays on the
Repositories page after it is deleted, so the check still works after the cleanup.

If no repo is saved yet (first run, new machine, CI), Playwright runs `github-repo-scan.spec.ts`
first automatically (project `scan-results` depends on project `repo-scan` in `playwright.config.ts`),
so running only `--grep @scanresults` never fails for a missing repo. Add `--no-deps` to skip that.

Repositories > **Last Scan** is compared with
`test-data/scan-repo.expected-findings.csv` (one row per finding Qryptive should report):

| Column | Meaning |
|---|---|
| Type | `Crypto` (code), `Dependency` (pom.xml / package.json / requirements.txt) or `Asset` (Asset Inventory) |
| Category | Group on the Findings tab, e.g. `Digital Signatures`, `Key Generation`, `Hashing`, `Keys`, `Tokens` |
| Algorithm | Name shown by Qryptive (`ECC` and `ECDSA` count as the same) |
| Status | `vulnerable`, `safe`, `unknown` — or `not-expected` for something that must NOT be reported |
| File / Line | Where it is in the code (Line empty for dependencies) |
| Also Accept Lines | Other lines that are also correct, e.g. a statement over 2 lines (`9;10`) |
| Known Issue | Known Qryptive problem: still compared and listed in the report, but does not fail the test |

Each check attaches an expected-vs-actual CSV to the HTML report (OK / MISSING / WRONG LINE /
WRONG STATUS / WRONG CATEGORY / FALSE POSITIVE / EXTRA). When a known issue gets fixed, the report
says so — then clear its **Known Issue** cell. When the sample code changes, update the CSV.

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
npm run test:auth                      # one module: test:auth / test:dashboard / test:sources
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
| `SCAN_GITHUB_TOKEN` | GitHub classic token (scopes `repo`, `workflow`, `delete_repo`) for the repo scan test |
| `SCAN_GITHUB_OWNER` | GitHub user / organization where the temporary test repo is created |
| `PQC_API_KEY` | Qryptive API key, added as a secret to the test repo |
| `SCAN_REPO_ZIP` | Zip with the code to scan (default `test-data/scan-repo.zip`) |
| `SCAN_EXPECTED_CSV` | Expected scan results (default `test-data/scan-repo.expected-findings.csv`) |
| `SCAN_RESULTS_REPO` | Repo checked by the Last Scan tests (default: the last repo created by the scan test) |
| `SCAN_KEEP_REPO` | `true` keeps the test repo in Qryptive and on GitHub after the run |
| `SCAN_TIMEOUT_MIN` / `SCAN_MIN_FINDINGS` | Max wait for the GitHub scan (15) / minimum findings expected (1) |

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
