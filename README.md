
## Folders

```text
tests/LoginTest.spec.ts    TC01–TC09: login tests
tests/DashboardTest.spec.ts TC10–TC13: sidebar tests (need a saved login)
pages/LoginPage.ts         login page: locators + actions
pages/DashboardPage.ts     sidebar menu: locators + actions
utils/ConfigUtils.ts       reads environment.yaml, picks qa/staging/production
utils/MailUtils.ts         reads the inbox and finds the magic link
utils/WaitUtils.ts         "wait until something happens" helper
utils/Logger.ts            prints logs and saves them to logs/execution.log
utils/Utils.ts             small helpers (read .env, ask a question)
auth/AuthManager.ts        saves / checks the logged-in session
fixtures/base.fixture.ts   gives each test a ready loginPage + config
config/environment.yaml    URLs of all 3 environments
.env                       your email + mailbox password (secret)
```

## Setup (Linux, one time)

```bash
cd qryptive_automation
npm install
npx playwright install chromium
sudo npx playwright install-deps chromium
cp .env.example .env        # then open .env and fill in your values
```

Also put the real Qryptive URLs in `config/environment.yaml`.

## Run

```bash
ENV=qa npx playwright test            # run on QA
ENV=staging npx playwright test       # run on Staging
ENV=production npx playwright test    # run on Production
npx playwright test                   # asks which environment (Enter = qa)

npx playwright test --grep @magic     # only Scenario 1
npx playwright test --grep @direct    # only Scenario 2 (asks for the link)
npx playwright test --grep @session   # only Scenario 3
npx playwright test --grep @loginpage # TC04–TC09 login page checks (no email sent)
npx playwright test --grep @dashboard # TC10–TC13 sidebar tests (uses saved login)
HEADLESS=true npx playwright test     # run without showing the browser
ENV=qa npx playwright test --last-failed   # re-run only the tests that failed last time

npx playwright test --headed          # watch the browser
npx playwright show-report reports    # open the HTML report
```

## Report email

After every run, `utils/EmailReporter.ts` emails a summary with pass/fail/skip counts and a table of every test. The full HTML report and the failure screenshots are attached.

| `.env` setting | Meaning |
|---|---|
| `MAIL_USER` / `MAIL_PASSWORD` | Gmail account + App Password used to send |
| `REPORT_TO` | Receivers, comma separated (empty = `MAIL_USER`) |
| `SEND_REPORT_EMAIL=false` | Turn the email off |

## Database (PostgreSQL)

Every run is saved by `database/DatabaseReporter.ts` into a normalized schema: projects, environments, suites, test cases, runs, executions, attempts, logs, failures and artifacts.

[database/README.md](database/README.md) has the ER diagram, a description of each table, the normalization, sample SQL and the future API and dashboard design.

```bash
npm run db:migrate     # create database + tables/views (also automatic on every test run)
npm run db:runs        # latest runs
npm run db:cases       # test cases with statistics
npm run db:failures    # failure analysis
RETRIES=1 npx playwright test                  # retries are saved as separate attempts
SAVE_RESULTS_TO_DB=false npx playwright test   # run without saving
```

Screenshots, traces, videos and log files are stored in `artifacts/<run>/<test>/attempt-<n>/`. Only their paths are saved in the database.

## Results

- HTML report: `reports/`
- Failure screenshots: `screenshots/`
- Logs: `logs/execution.log`
