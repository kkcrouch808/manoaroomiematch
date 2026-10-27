import {
  test, expect, type APIRequestContext, type Page,
} from '@playwright/test';
import { ACCOUNTS, getSession, gotoHydrated, signInAsAdmin, signInAsStudent, uniqueHawaiiEmail } from './helpers';

const XSS_IMG = '<img src=x onerror="window.__xss=1">';
const XSS_SCRIPT = '<script>window.__xss=1</script>';

/** Fails the test if any JavaScript dialog opens (alert/confirm/prompt from an injected payload). */
function failOnDialog(page: Page) {
  page.on('dialog', async (dialog) => {
    await dialog.dismiss();
    throw new Error(`Unexpected dialog: ${dialog.message()}`);
  });
}

test.describe('Middleware and page protection', () => {
  test('logged-out visitor is sent to sign-in from /profile', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('logged-out visitor is turned away from /admin', async ({ page }) => {
    await page.goto('/admin');
    // The admin page itself sends visitors to sign-in (the middleware would send them to /not-authorized)
    await expect(page).toHaveURL(/\/(auth\/signin|not-authorized)/);
  });

  test('student is denied /admin', async ({ page }) => {
    await signInAsStudent(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/not-authorized$/);
    await expect(page.getByText('Not Authorized')).toBeVisible();
  });

  // KNOWN BUG (documented, not fixed): middleware.ts is at the repository root, but this app uses `src/app`,
  // and Next.js only loads `src/middleware.ts` in that layout. The middleware never runs (the build's
  // .next/server/middleware-manifest.json is empty), so admins can open student pages. These tests are
  // expected to fail; Playwright reports an error if one ever starts passing.
  for (const path of ['/matches', '/profile', '/messages', '/edit-profile']) {
    test(`KNOWN DEFECT: admin is redirected from student page ${path} to /admin`, async ({ page }) => {
      test.fail(true, 'KNOWN BUG: middleware.ts is never loaded because it is not in src/');
      await signInAsAdmin(page);
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin$/);
    });
  }
});

test.describe('API access control', () => {
  for (const path of ['/api/matches', '/api/admin/users', '/api/notifications', '/api/messages/conversations']) {
    test(`unauthenticated GET ${path} returns 401`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
    });
  }

  test('student cannot list users or promote themselves through admin APIs', async ({ page }) => {
    await signInAsStudent(page);
    const session = await getSession(page);

    expect((await page.request.get('/api/admin/users')).status()).toBe(403);
    const promote = await page.request.post('/api/admin/user-role', {
      data: { userId: Number(session.user.id), newRole: 'ADMIN' },
    });
    expect(promote.status()).toBe(403);
    // Role on the session is unchanged after a fresh read
    expect((await getSession(page)).user.randomKey).toBe('USER');
  });
});

test.describe('Malicious input is stored and shown as plain text', () => {
  test('XSS in a chat message is rendered literally', async ({ page }) => {
    failOnDialog(page);
    await signInAsStudent(page);

    const search = await page.request.get(`/api/users/search?q=${encodeURIComponent(ACCOUNTS.admin.email)}`);
    expect(search.status()).toBe(200);
    const { users } = await search.json();
    expect(users).toHaveLength(1);

    await gotoHydrated(page, `/messages/${users[0].id}`);
    const payload = `${XSS_IMG} ${Date.now()}`;
    await page.getByPlaceholder('Type a message...').fill(payload);
    const sent = page.waitForResponse((r) => r.url().endsWith('/api/messages/send'));
    await page.locator('form button[type="submit"]').click();
    expect((await sent).status()).toBe(201);

    // Visible as text, and no <img> element was created from it
    await expect(page.getByText(payload)).toBeVisible();
    await page.reload();
    await expect(page.getByText(payload)).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('XSS in sign-up names is rendered literally on the profile', async ({ page }, testInfo) => {
    failOnDialog(page);
    const email = uniqueHawaiiEmail('xss', testInfo.project.name);
    await gotoHydrated(page, '/auth/signup');
    await page.getByPlaceholder('John').fill(XSS_SCRIPT);
    await page.getByPlaceholder('Doe').fill(XSS_IMG);
    await page.getByPlaceholder('you@hawaii.edu').fill(email);
    await page.getByPlaceholder('Minimum 6 characters').fill('secret123');
    await page.getByPlaceholder('Re-enter your password').fill('secret123');
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page).toHaveURL(/\/lifestyle-survey/);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: `${XSS_SCRIPT} ${XSS_IMG}` })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('SQL-injection-style search returns no users instead of everyone', async ({ page }) => {
    await signInAsStudent(page);
    for (const q of ["' OR 1=1 --", "%' OR '1'='1", "'; DROP TABLE \"User\"; --"]) {
      const response = await page.request.get(`/api/users/search?q=${encodeURIComponent(q)}`);
      expect(response.status()).toBe(200);
      expect((await response.json()).users).toEqual([]);
    }
    // The User table still exists and normal search still works
    const normal = await page.request.get('/api/users/search?q=admin');
    expect((await normal.json()).users.length).toBeGreaterThan(0);
  });
});

test.describe('Sign-in redirect target (next-auth redirect callback)', () => {
  async function signInWithCallback(request: APIRequestContext, callbackUrl: string) {
    const { csrfToken } = await (await request.get('/api/auth/csrf')).json();
    const response = await request.post('/api/auth/callback/credentials', {
      form: { csrfToken, ...ACCOUNTS.student, callbackUrl, json: 'true' },
    });
    const { url } = await response.json();
    return new URL(url, 'http://localhost:3000');
  }

  test('an absolute external callbackUrl is replaced with the site itself', async ({ request }) => {
    const target = await signInWithCallback(request, 'https://evil.example/phish');
    expect(target.host).toBe('localhost:3000');
  });

  test('KNOWN DEFECT: a protocol-relative callbackUrl does not leave the site', async ({ request }) => {
    // KNOWN VULNERABILITY (open redirect): authOptions.redirect treats any URL starting with "/" as a safe
    // relative path, so "//evil.example/phish" is returned unchanged and the browser goes to evil.example
    // after a successful sign-in.
    test.fail(true, 'KNOWN VULNERABILITY: open redirect via protocol-relative callbackUrl');
    const target = await signInWithCallback(request, '//evil.example/phish');
    expect(target.host).toBe('localhost:3000');
  });
});
