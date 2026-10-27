import { test, expect } from '@playwright/test';
import { ACCOUNTS, getSession, gotoHydrated, signIn, submitSignIn, uniqueHawaiiEmail } from './helpers';

test.describe('Sign in page', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toHaveAttribute('type', 'email');
    await expect(page.locator('input[name="password"]')).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/auth/signup');
  });

  test('a student with valid credentials lands on their own profile', async ({ page }) => {
    await signIn(page, ACCOUNTS.student, /\/profile$/);
    await expect(page.getByRole('heading', { name: ACCOUNTS.student.name })).toBeVisible();
    const session = await getSession(page);
    expect(session.user.randomKey).toBe('USER');
  });

  test('an admin with valid credentials lands on the admin dashboard', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin, /\/admin$/);
    const session = await getSession(page);
    expect(session.user.randomKey).toBe('ADMIN');
  });
});

test.describe('Rejected sign-ins create no session', () => {
  const cases = [
    { category: 'wrong password', email: ACCOUNTS.student.email, password: 'not-the-password' },
    { category: 'nonexistent user', email: 'nobody-here@hawaii.edu', password: 'changeme' },
    { category: 'suspended user with the correct password', ...ACCOUNTS.suspended },
    // Payloads must pass the browser's own type=email check, otherwise no request is sent at all
    { category: 'malicious: SQL-injection-style email', email: "admin'--@foo.com", password: 'anything' },
    { category: 'malicious: SQL-injection-style password', email: ACCOUNTS.student.email, password: "' OR '1'='1' --" },
  ];

  for (const { category, email, password } of cases) {
    test(`${category}`, async ({ page }) => {
      const response = await submitSignIn(page, email, password);
      // next-auth answers a rejected credentials sign-in with a redirect URL carrying the error code
      expect((await response.json()).url).toContain('error=CredentialsSignin');
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
      await expect(page).toHaveURL(/\/auth\/signin/);
      expect(await getSession(page)).toEqual({});
    });
  }
});

test.describe('Sign up form validation (Yup + react-hook-form)', () => {
  const cases = [
    {
      category: 'empty form',
      fill: {},
      errors: ['First Name is required', 'Last Name is required', 'Email is required', 'Password is required'],
    },
    {
      category: 'wrong format: non-@hawaii.edu email',
      fill: { email: 'student@gmail.com', password: 'secret1', confirm: 'secret1' },
      errors: ['Only @hawaii.edu emails are allowed'],
    },
    {
      category: 'boundary: 5-character password',
      fill: { email: 'student@hawaii.edu', password: '12345', confirm: '12345' },
      errors: ['Password must be at least 6 characters'],
    },
    {
      category: 'boundary: 41-character password',
      fill: { email: 'student@hawaii.edu', password: 'a'.repeat(41), confirm: 'a'.repeat(41) },
      errors: ['Password must not exceed 40 characters'],
    },
    {
      category: 'mismatched confirmation',
      fill: { email: 'student@hawaii.edu', password: 'secret1', confirm: 'secret2' },
      errors: ['Confirm Password does not match'],
    },
  ];

  for (const { category, fill, errors } of cases) {
    test(`${category} is rejected with a visible message`, async ({ page }) => {
      await gotoHydrated(page, '/auth/signup');
      await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();
      const f = fill as { email?: string; password?: string; confirm?: string };
      if (f.email) {
        await page.getByPlaceholder('John').fill('Test');
        await page.getByPlaceholder('Doe').fill('User');
        await page.getByPlaceholder('you@hawaii.edu').fill(f.email);
        await page.getByPlaceholder('Minimum 6 characters').fill(f.password ?? '');
        await page.getByPlaceholder('Re-enter your password').fill(f.confirm ?? '');
      }
      await page.getByRole('button', { name: 'Create Account' }).click();
      for (const message of errors) {
        await expect(page.getByText(message, { exact: true })).toBeVisible();
      }
      await expect(page).toHaveURL(/\/auth\/signup$/);
    });
  }

  test('Unicode name and upper-case @HAWAII.EDU domain create an account', async ({ page }, testInfo) => {
    const email = uniqueHawaiiEmail('unicode', testInfo.project.name, 'HAWAII.EDU');
    await gotoHydrated(page, '/auth/signup');
    await page.getByPlaceholder('John').fill('Kēhau');
    await page.getByPlaceholder('Doe').fill('ʻAkana');
    await page.getByPlaceholder('you@hawaii.edu').fill(email);
    await page.getByPlaceholder('Minimum 6 characters').fill('aloha123');
    await page.getByPlaceholder('Re-enter your password').fill('aloha123');
    await page.getByRole('button', { name: 'Create Account' }).click();

    // A new account is signed in and sent to the lifestyle survey
    await expect(page).toHaveURL(/\/lifestyle-survey/);
    expect((await getSession(page)).user.email).toBe(email);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Kēhau ʻAkana' })).toBeVisible();
  });
});
