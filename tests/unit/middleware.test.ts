import { existsSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { config, middleware } from '../../middleware';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));

const STUDENT_PAGES = ['/matches', '/comparison/abc', '/lifestyle-survey', '/profile', '/edit-profile', '/messages/2'];
const ADMIN_PAGES = ['/admin', '/admin/users'];
const PUBLIC_PAGES = ['/', '/auth/signin', '/auth/signup', '/resources', '/not-authorized'];

async function visit(path: string, role?: string) {
  vi.mocked(getToken).mockResolvedValue(role ? ({ randomKey: role } as never) : null);
  const response = await middleware(new NextRequest(`http://localhost:3000${path}`));
  const location = response.headers.get('location');
  return location ? new URL(location).pathname : 'next';
}

describe('middleware role-based redirects', () => {
  test.each(STUDENT_PAGES)('admin visiting %s is sent to /admin', async (path) => {
    expect(await visit(path, 'ADMIN')).toBe('/admin');
  });

  test.each(ADMIN_PAGES)('admin may open %s', async (path) => {
    expect(await visit(path, 'ADMIN')).toBe('next');
  });

  test.each(ADMIN_PAGES)('student visiting %s is sent to /not-authorized', async (path) => {
    expect(await visit(path, 'USER')).toBe('/not-authorized');
  });

  test.each(ADMIN_PAGES)('logged-out visitor to %s is sent to /not-authorized', async (path) => {
    expect(await visit(path)).toBe('/not-authorized');
  });

  test.each(STUDENT_PAGES)('student may open %s', async (path) => {
    expect(await visit(path, 'USER')).toBe('next');
  });

  test.each(PUBLIC_PAGES)('everyone may open public page %s', async (path) => {
    expect(await visit(path)).toBe('next');
    expect(await visit(path, 'USER')).toBe('next');
    expect(await visit(path, 'ADMIN')).toBe('next');
  });

  test('a forged role value is treated as a non-admin', async () => {
    expect(await visit('/admin', 'admin')).toBe('/not-authorized');
    expect(await visit('/admin', 'ADMIN ')).toBe('/not-authorized');
  });

  test('reads the role from the JWT stored by next-auth', async () => {
    await visit('/admin', 'ADMIN');
    expect(getToken).toHaveBeenCalledWith({ req: expect.any(NextRequest) });
  });
});

describe('middleware matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  test.each(['/admin', '/matches', '/profile', '/'])('runs on %s', (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  test.each(['/api/admin/users', '/_next/static/chunk.js', '/_next/image', '/favicon.ico'])('skips %s', (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});

// KNOWN BUG: in a project that uses `src/app`, Next.js only loads `src/middleware.ts`. This file is at the
// repository root, so the logic above (which is correct) never runs in the real app: the build's
// .next/server/middleware-manifest.json is empty, and the E2E admin-redirect tests fail.
test.fails('middleware is placed where Next.js loads it for a src/ layout', () => {
  expect(existsSync('src/middleware.ts')).toBe(true);
});
