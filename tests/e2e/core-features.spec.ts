import { test, expect } from '@playwright/test';
import { ACCOUNTS, gotoHydrated, signInAsStudent } from './helpers';

test.describe('Public pages', () => {
  test('home page shows the hero and a Login menu for visitors', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Find the Perfect Roommate' })).toBeVisible();
    await expect(page.locator('#login-dropdown')).toHaveText(/Login/);
  });

  test('sign-up page explains the UH email requirement', async ({ page }) => {
    await page.goto('/auth/signup');
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();
    await expect(page.getByText('UH Email Required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeEnabled();
  });

  test('change-password page renders its form', async ({ page }) => {
    await page.goto('/auth/change-password');
    await expect(page.getByRole('heading', { name: 'Change Password' })).toBeVisible();
  });
});

test.describe('Signed-in student', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsStudent(page);
  });

  test('profile page shows the student\'s own name and email', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: ACCOUNTS.student.name })).toBeVisible();
    await expect(page.getByText(ACCOUNTS.student.email).first()).toBeVisible();
  });

  test('matches page loads the student\'s matches from the API', async ({ page }) => {
    const matchesResponse = page.waitForResponse((r) => r.url().endsWith('/api/matches'));
    await page.goto('/matches');
    expect((await matchesResponse).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Browse Matches' })).toBeVisible();
    // The seeded student has not taken the survey, so the empty state must be explained
    await expect(page.getByText('No matches found. Complete your lifestyle survey to find roommates!')).toBeVisible();
  });

  test('grid/list toggle switches the active view', async ({ page }) => {
    await gotoHydrated(page, '/matches');
    const list = page.getByRole('button', { name: 'List view' });
    await list.click();
    await expect(list).toHaveClass(/btn-success/);
    await expect(page.getByRole('button', { name: 'Grid view' })).toHaveClass(/btn-outline-success/);
  });

  test('messages page loads the conversation list', async ({ page }) => {
    const conversations = page.waitForResponse((r) => r.url().endsWith('/api/messages/conversations'));
    await page.goto('/messages');
    expect((await conversations).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
  });

  test('saved matches page loads', async ({ page }) => {
    await page.goto('/saved-matches');
    await expect(page.getByRole('heading', { name: 'Saved Matches', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No Saved Matches Yet' })).toBeVisible();
  });

  test('edit profile form is pre-filled with the student\'s data', async ({ page }) => {
    await page.goto('/edit-profile');
    await expect(page.getByRole('heading', { name: 'Edit Profile' })).toBeVisible();
    await expect(page.getByPlaceholder('Enter first name')).toHaveValue('John');
  });

  test('navbar shows student navigation, not the Login menu', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('#browse-matches-nav')).toBeVisible();
    await expect(page.locator('#messages-nav')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0);
  });
});
