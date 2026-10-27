import { expect, type Page } from '@playwright/test';

/** Accounts created by `prisma/seed.ts` from config/settings.development.json. */
export const ACCOUNTS = {
  student: { email: 'john@foo.com', password: 'changeme', name: 'John Foo' },
  admin: { email: 'admin@foo.com', password: 'changeme', name: 'Admin User' },
  suspended: { email: 'suspended@foo.com', password: 'changeme', name: 'Sam Suspended' },
} as const;

/** Returns the next-auth session the browser context currently holds ({} when signed out). */
export async function getSession(page: Page): Promise<Record<string, any>> {
  const response = await page.request.get('/api/auth/session');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/**
 * Navigates and waits until React has hydrated. SessionProvider fetches /api/auth/session on mount, so
 * that response means client handlers are attached; interacting earlier would trigger a native form submit.
 */
export async function gotoHydrated(page: Page, path: string) {
  const sessionFetched = page.waitForResponse((r) => r.url().endsWith('/api/auth/session'));
  await page.goto(path);
  await sessionFetched;
}

/** Fills and submits the sign-in form, and waits for next-auth to answer the credentials POST. */
export async function submitSignIn(page: Page, email: string, password: string) {
  await gotoHydrated(page, '/auth/signin');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const callback = page.waitForResponse((r) => r.url().includes('/api/auth/callback/credentials'));
  await page.getByRole('button', { name: 'Sign In' }).click();
  return callback;
}

/**
 * Signs in through the UI and fails the test unless the app redirects to the expected landing page
 * (students go to /profile, admins to /admin).
 */
export async function signIn(page: Page, account: { email: string; password: string }, landing: RegExp) {
  await submitSignIn(page, account.email, account.password);
  await expect(page).toHaveURL(landing);
  const session = await getSession(page);
  expect(session.user?.email).toBe(account.email);
}

export const signInAsStudent = (page: Page) => signIn(page, ACCOUNTS.student, /\/profile$/);
export const signInAsAdmin = (page: Page) => signIn(page, ACCOUNTS.admin, /\/admin$/);

/** A unique @hawaii.edu address per test run and browser, so sign-up tests never collide. */
export function uniqueHawaiiEmail(prefix: string, project: string, domain = 'hawaii.edu') {
  return `${prefix}-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${domain}`;
}
