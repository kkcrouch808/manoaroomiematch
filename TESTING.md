# Testing Mānoa Roomie Match

This document describes the automated test suite: how to run it, what it covers, the kinds of input it
exercises, where the reports go, and the defects the tests document.

| Layer | Tool | Where | Count |
|---|---|---|---|
| Unit: `src/lib`, `middleware.ts` and how the app uses its libraries | Vitest | `tests/unit/` | 344 |
| API route handlers, called directly with Prisma and `getServerSession` mocked | Vitest | `tests/api/` | 350 |
| React components and pages | Vitest + Testing Library + jsdom | `tests/components/` | 181 |
| Integration against a real PostgreSQL database | Vitest | `tests/integration/` | 23 |
| End-to-end in Chromium, Firefox and WebKit | Playwright | `tests/e2e/` | 41 × 3 browsers |

The counts include tests that are expected to fail because they document a defect (titles start with
`KNOWN DEFECT:`); see [Known defects](#known-defects-documented-by-the-tests).

## Requirements

- **Node.js 22.12 or newer** (Vitest 5 requires it; CI uses the current LTS).
- `npm ci` installs everything, including the Playwright test runner. Install browsers once with
  `npx playwright install`.
- For integration and E2E tests: a **throwaway** PostgreSQL database. Never point these tests at a database
  whose data you care about. The integration tests create and delete their own rows; the E2E tests create
  accounts.

## Running the tests

| What | Command | Needs a database? |
|---|---|---|
| Lint (src, tests, prisma, configs) | `npm run lint` | no |
| Unit + API + component tests | `npm test` | no |
| Same, with coverage and thresholds | `npm run test:coverage` | no |
| Watch mode while developing | `npm run test:watch` | no |
| Integration tests | `npm run test:integration` | yes |
| End-to-end tests | `npm run test:e2e` | yes |
| Markdown summary of the latest reports | `node scripts/test-summary.mjs` | no |

Run one Vitest project with `npx vitest run --project unit` (or `api`, `components`), or one file with
`npx vitest run tests/api/messages.test.ts`. Run one browser with `npx playwright test --project=chromium`.

### Setting up a local test database

```bash
createdb manoa_test
export POSTGRES_PRISMA_URL="postgresql://$USER@localhost:5432/manoa_test"
export POSTGRES_URL_NON_POOLING="$POSTGRES_PRISMA_URL"
export NEXTAUTH_URL="http://localhost:3000"
export NEXTAUTH_SECRET="any-local-throwaway-value"

npx prisma migrate deploy
npx prisma db push --skip-generate --accept-data-loss   # adds columns the migrations are missing, see below
npx prisma db seed                                       # admin@foo.com, john@foo.com, suspended@foo.com (password: changeme)
```

`npm run test:e2e` then starts `npm run dev` on port 3000 (or reuses a running server) and tests it. To test a
production build as CI does, run `npm run build && CI=1 npm run test:e2e`. Set `PLAYWRIGHT_TEST_BASE_URL` only
to target a server you started yourself; the tests never default to the deployed site.

## How CI runs the tests

`.github/workflows/ci.yml` tests **the code in the pull request**, not the deployed site.

1. **`unit` job**: `npm ci` → `npm run lint` → `npm run test:coverage`.
2. **`e2e` job**: a `postgres:16` service container (trust auth, no stored password) → `prisma migrate deploy` →
   a schema-drift report → `prisma db push` → seed → `npm run test:integration` → `npm run build` →
   Playwright against `npm run start` on `http://localhost:3000`. `NEXTAUTH_SECRET` is generated per run.

A job fails if any test fails, if a `KNOWN DEFECT` test unexpectedly passes (the bug was fixed: remove the
marker), or if coverage drops below a threshold.

## Reports

| Report | Location | Produced by |
|---|---|---|
| Vitest results, HTML (self-contained; open in a browser) | `reports/unit/html/index.html` | `npm test`, `npm run test:coverage` |
| Vitest results, JUnit XML | `reports/unit/junit.xml` | same |
| Coverage table in the terminal | console output | `npm run test:coverage` |
| Coverage, HTML (per-file, line by line) | `coverage/index.html` | `npm run test:coverage` |
| Coverage, LCOV and JSON summary | `coverage/lcov.info`, `coverage/coverage-summary.json` | same |
| Integration results, HTML and JUnit | `reports/integration/html/index.html`, `reports/integration/junit.xml` | `npm run test:integration` |
| Playwright results, HTML (traces and screenshots on failure) | `playwright-report/index.html` (`npx playwright show-report`) | `npm run test:e2e` |
| Playwright results, JUnit | `reports/e2e/junit.xml` | same |
| Pass/fail and coverage summary (Markdown) | job summary on the GitHub Actions run page | `scripts/test-summary.mjs` in CI |

In CI all of these are uploaded as artifacts (`vitest-and-coverage-reports`,
`integration-and-playwright-reports`) and the summary is shown on the run's **Summary** page. The summary
lists passed, failed, skipped and documented-defect counts per layer, every failing test, every documented
defect, and coverage by area.

## Coverage

Measured with V8 over `src/lib`, `src/app/api`, `src/components`, `src/contexts`, `src/hooks` and
`middleware.ts`. Pages under `src/app/**/page.tsx` are exercised by the E2E tests rather than measured.
Results at the time of writing:

| Area | Statements | Branches | Functions | Lines | Threshold (lines / statements / functions / branches) |
|---|---:|---:|---:|---:|---|
| `src/lib` | 98.6% | 94.1% | 95.9% | 98.5% | 95 / 95 / 95 / 90 |
| `src/app/api` (all 42 handlers) | 98.7% | 95.8% | 98.6% | 98.8% | 95 / 95 / 95 / 92 |
| `src/components` | 53.3% | 55.2% | 48.6% | 54.0% | (global only) |
| contexts, hooks, middleware | 92.6% | 86.3% | 87.5% | 92.5% | (global only) |
| **All measured code** | **77.8%** | **73.8%** | **65.3%** | **78.4%** | 75 / 75 / 62 / 70 |

### What is not covered

- **Admin dashboard components** (`AdminEditProfileModal`, `AdminSidebar`, `UserManagementAdmin`,
  `ContentModerationAdmin`, `CategoryModal`, `LifestyleCategories`, `LifestyleCategoryAdmin`, small admin
  widgets) and `SurveyConfirmation` have no component tests. The admin APIs behind them are fully tested.
- **Unreachable code** in `src/lib`: three unused converters in `compatibility.ts` (lines 64-104), and a
  `.catch` in `suspensionUtils.ts` on a promise that never rejects.
- **Dead code** in `src/app/api`: `generateFilename` in `upload-picture`, and outer `catch` blocks behind
  inner ones that already handle every error.

## What the tests cover

### 1. The system's own code

- Every exported function in `src/lib` has unit tests (`tests/unit/lib/`), and `middleware.ts` has its own
  (`tests/unit/middleware.test.ts`).
- All 42 API route handlers are imported and called directly (`tests/api/`). `access-control.test.ts` checks
  every protected handler for 401/403 and asserts that a rejected caller never reaches the database; the other
  files cover each handler's behaviour, validation and error paths.
- Component tests cover match cards, the comparison view, profile cards, the sign-up page, the conversation
  page, report and message-action flows, notifications, the lifestyle survey and survey editor,
  profile-picture upload, filters, admin modals and the navbar.
- The E2E tests run the real app: sign-in and sign-up, signed-in pages, role-based access, and XSS and SQL
  injection through the UI.

### 2. The libraries the system uses

| Library | What is tested | Where |
|---|---|---|
| next-auth | `authorize()` with valid, wrong-password, nonexistent, deactivated and suspended users; the `jwt`/`session` callbacks carrying the role as `randomKey`; the redirect callback; real sign-in in the browser; middleware decisions per role and for signed-out users | `tests/unit/libraries/next-auth.test.ts`, `tests/unit/middleware.test.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/security.spec.ts` |
| bcrypt / bcryptjs | stored passwords are cost-10 hashes with a random salt; only the exact password matches; bcryptjs (delete-account route) accepts bcrypt hashes; the 72-byte limit | `tests/unit/libraries/bcrypt.test.ts`, `tests/integration/prisma.test.ts` |
| Prisma | exact `where`/`include`/`orderBy` arguments for every query (mocked), plus real Postgres for the unique email constraint (P2002), foreign keys on account deletion, and how `contains` treats user input | `tests/unit/lib/*.test.ts`, `tests/api/*.test.ts`, `tests/integration/prisma.test.ts` |
| Yup + react-hook-form | the sign-up schema (moved to `src/lib/validation/signup.ts`, rules unchanged) across every input category, and the page wiring it to inline errors | `tests/unit/libraries/yup-signup-schema.test.ts`, `tests/components/SignUpPage.test.tsx`, `tests/e2e/auth.spec.ts` |
| React Bootstrap | Cards, Modals, Dropdowns, Forms, Badges, Collapse and Alerts through the components that use them (roles, classes, visibility, interaction) | `tests/components/` |

### 3. A range of user inputs, including malicious ones

Table-driven tests (`test.each`) use these categories; shared hostile inputs live in
`tests/fixtures/malicious-inputs.ts` and fake images in `tests/helpers/images.ts`.

| Category | Examples | Where |
|---|---|---|
| Normal | valid sign-up, real JPEG/PNG/GIF/WebP, ordinary messages and searches | throughout |
| Edge / boundary | passwords of 5, 6, 40 and 41 characters; empty forms; exactly 5 MB vs 5 MB + 1 byte; 0 and 100 on the noise slider; score thresholds 59/60/79/80; pagination 0, -5, 500 | Yup, imageProcessing, compatibility, API and component tests |
| Wrong format | non-`@hawaii.edu`, look-alike domains (`@evilhawaii.edu`, `@hawaii.edu.evil.com`), `@HAWAII.EDU` (accepted), non-numeric ids, malformed JSON, MIME types that are not allowed | Yup, API, E2E |
| Unicode | ʻokina and kahakō (`Kēhau ʻAkana`, `Pōmaikaʻi`), CJK, emoji in names and passwords | Yup, bcrypt, components, E2E sign-up |
| Malicious | XSS (`<script>`, `<img onerror>`, `<svg onload>`, `javascript:` links); SQL injection (`' OR 1=1 --`, `'; DROP TABLE "User"; --`, `UNION SELECT`); LIKE wildcards; 10 KB and 1 MB strings; path traversal (`../../etc/passwd`, `%2e%2e%2f`, `shell.php%00.jpg`); fake images (wrong magic bytes, PHP/HTML labelled as images, truncated signatures, oversize, a PNG declaring 100000×100000 pixels); open-redirect URLs | `tests/fixtures/`, unit, API, components, integration, E2E |
| Access control | signed-out calls to every protected API; students calling every admin API; reading another user's conversation; messaging someone who blocked you; a suspended user signing in; admins and students on each other's pages | `tests/api/access-control.test.ts`, `tests/api/messages.test.ts`, `tests/integration/`, `tests/e2e/` |

Malicious text must be **rejected** or **stored and displayed as plain text**. `tests/helpers/xss.ts` checks
that a payload appears verbatim and that no `<script>`, injected `<img>`/`<iframe>` or inline event handler was
created; the E2E tests also confirm in real browsers that no dialog opens and no injected script runs.

### 4. Reporting success or failure

See [Reports](#reports). Every run produces HTML and JUnit results; coverage runs add HTML, LCOV and a JSON
summary; CI publishes all of them as artifacts and writes a pass/fail and coverage summary to the run page.

## Known defects documented by the tests

These were found by the tests and **left unfixed** (the only change to app code was moving the sign-up schema).
Each is a test titled `KNOWN DEFECT: ...` written as the correct behaviour and marked to fail
(`test.fails` in Vitest, `test.fail()` in Playwright), so the suite stays green while the defect exists and
turns red the moment someone fixes it without updating the test. Every one was checked to fail for the stated
reason.

### Security

| Defect | Impact | Test |
|---|---|---|
| **Open redirect**: the next-auth `redirect` callback treats anything starting with `/` as safe, so `callbackUrl=//evil.example` (or `/\evil.example`) sends a user to another site after signing in | phishing via a real sign-in link | `tests/unit/libraries/next-auth.test.ts`, `tests/e2e/security.spec.ts` |
| `POST /api/matches/[matchId]/ai-report` and `GET /api/matches/[matchId]/comparison` have **no authentication** | anyone with a match id can overwrite its report, or read both users' full profiles (email, social handles, hometown, bio) | `tests/api/access-control.test.ts` |
| **`middleware.ts` is never loaded**: with a `src/app` layout Next.js only reads `src/middleware.ts`; the build's middleware manifest is empty | admins are not redirected away from student pages (pages that check roles themselves still do) | `tests/unit/middleware.test.ts`, `tests/e2e/security.spec.ts` |
| `PATCH /api/messages/mark-read` has no ownership check | any user can mark anyone's messages as read | `tests/api/messages.test.ts` |
| `POST /api/auth/change-password` picks the account from the request body, not the session | a signed-in user can change or guess another account's password | `tests/api/auth.test.ts` |
| `POST /api/admin/resolve-flag` returns the full user row | bcrypt password hashes reach the browser | `tests/api/admin.test.ts` |
| User search does not escape LIKE wildcards (`%`, `_`) | any user can list every active user's email | `tests/integration/prisma.test.ts` |
| No maximum message length | 1 MB messages are stored and delivered | `tests/api/messages.test.ts` |
| Image limits: `MAX_DIMENSION` (4096 px) is never enforced, and `upload-picture` checks only 4 of the 8 PNG signature bytes | oversized "decompression bomb" images and some fake PNGs are accepted | `tests/unit/lib/imageProcessing.test.ts`, `tests/api/profile.test.ts` |

### Functional

| Defect | Test |
|---|---|
| `calculateStudyCompatibility()` takes no arguments and always returns 100, so every pair gets 20 free points (the survey's study answer is never saved either) | `tests/unit/lib/compatibility.test.ts` |
| Sleep and cleanliness are stored as integers but looked up in string-keyed maps, so both always score 100. With study, 65% of every score is fixed; two users who disagree on everything score 79% | `tests/unit/lib/compatibility.test.ts` |
| A noise tolerance of 0 is treated as 50 (`noiseLevel \|\| 50`) | `tests/unit/lib/compatibility.test.ts` |
| The comparison's "Noise Level" row shows the social score, and survey noise values (0-100) are labelled "Unknown" | `tests/unit/lib/comparison.test.ts` |
| `Flag` has `@@unique([reported_by_user_id, reported_user_id])`, contradicting the route's "you may report again once resolved" logic: re-reporting returns 500 | `tests/integration/prisma.test.ts` |
| A user with any moderation history cannot delete their own account (ModerationAction rows are not deleted; foreign-key error) | `tests/integration/prisma.test.ts` |
| An admin cannot delete a user whose match has an AI explanation (foreign-key error) | `tests/integration/prisma.test.ts` |
| `ProfilePictureUpload`: if the server answers before the local preview is ready, the rejected image stays on screen and hides the real photo | `tests/components/ProfilePictureUpload.test.tsx` |
| `SurveyEdit` "Save Changes" only writes `localStorage`; edited answers never reach the database | `tests/components/SurveyEdit.test.tsx` |
| Non-numeric pagination (`?page=abc`) reaches Prisma as `NaN` instead of defaulting | `tests/api/admin.test.ts` |

### Other findings (not expressed as a test)

- **Migrations have drifted from `schema.prisma`**: a database built only with `prisma migrate deploy` lacks
  `User.lastLogin`, `Message.isRead`/`readAt` and the `Flag` indexes, so the app cannot run on it. CI prints the
  missing SQL on every run and applies it with `prisma db push`; the real fix is a new migration.
- Some 500 responses include internal error text (the admin delete route returns the raw Prisma message,
  including a server file path).
- A failed sign-in shows no message on the sign-in page; the tests check that no session is created.

## Conventions

- **No silent skips.** A test that cannot do its job must fail. Expected failures are only for documented
  defects and must say why in a comment.
- **Unit, API and component tests never touch a database.** `tests/setup/prisma.ts` replaces both
  `@/lib/prisma` and every `new PrismaClient()` with one mock and resets it before each test.
- **Assert behaviour, not existence**: URLs, headings, user-specific content, exact Prisma arguments and status
  codes. Use web-first `expect` waits in Playwright, never fixed sleeps.
- E2E tests wait for hydration (`gotoHydrated`) before interacting, and sign-up tests use unique emails, so
  they can run in parallel and repeatedly against the same database.
- Saved browser sessions (`tests/playwright-auth-sessions/`) and all generated reports are git-ignored.

## Changes outside `tests/`

- `src/lib/validation/signup.ts`: the sign-up Yup schema, moved out of `src/app/auth/signup/page.tsx` with
  identical rules (the only change to application code).
- `prisma/seed.ts` and `config/settings.development.json`: a seeded `suspended@foo.com` account; upserts are
  awaited in order (`forEach(async ...)` could disconnect before they finished).
- `playwright.config.ts`, `vitest.config.mts`, `vitest.integration.config.mts`, `.github/workflows/ci.yml`,
  `scripts/test-summary.mjs`.
- `package.json` scripts; `npm run lint` now also checks `tests/`, `prisma/` and the config files.
  `.eslintrc.json` allows dev dependencies in tests and lets tests `await` in loops; `tsconfig.json` includes
  the `.mts` configs.
