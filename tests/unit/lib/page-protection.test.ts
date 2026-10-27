import { beforeEach, describe, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { adminProtectedPage, loggedInProtectedPage } from '@/lib/page-protection';

// Like the real redirect(), the mock throws so code after it never runs
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
}));

const session = (randomKey: string) => ({ user: { email: 'a@hawaii.edu', id: '1', randomKey } });

beforeEach(() => {
  vi.mocked(redirect).mockClear();
});

describe('loggedInProtectedPage', () => {
  test('signed-out visitors are sent to sign in', () => {
    expect(() => loggedInProtectedPage(null)).toThrow('NEXT_REDIRECT /auth/signin');
  });

  test('any signed-in user may continue', () => {
    expect(() => loggedInProtectedPage(session('USER'))).not.toThrow();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('adminProtectedPage', () => {
  test.each([
    ['signed out', null, '/auth/signin'],
    ['student', session('USER'), '/not-authorized'],
    ['unknown role', session('SUPERUSER'), '/not-authorized'],
    ['lower-case admin', session('admin'), '/not-authorized'],
  ])('%s is redirected to %s', (_label, s, target) => {
    expect(() => adminProtectedPage(s)).toThrow(`NEXT_REDIRECT ${target}`);
  });

  test('admins may continue', () => {
    expect(() => adminProtectedPage(session('ADMIN'))).not.toThrow();
  });
});
