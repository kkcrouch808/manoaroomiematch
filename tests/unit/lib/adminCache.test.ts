// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearAllAdminCache,
  clearCache,
  getCacheMetadata,
  getFromCache,
  isCacheValid,
  setCache,
} from '@/lib/adminCache';

const FIVE_MINUTES = 5 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('admin cache', () => {
  test('stores and returns data under a prefixed key', () => {
    setCache('users', [{ id: 1 }]);
    expect(getFromCache('users')).toEqual([{ id: 1 }]);
    expect(localStorage.getItem('admin-cache-users')).not.toBeNull();
  });

  test('missing keys return null / invalid', () => {
    expect(getFromCache('nothing')).toBeNull();
    expect(isCacheValid('nothing')).toBe(false);
    expect(getCacheMetadata('nothing')).toBeNull();
  });

  test.each([
    ['exactly at the 5-minute TTL', FIVE_MINUTES, true],
    ['1 ms past the TTL', FIVE_MINUTES + 1, false],
  ])('entries are valid until expiry: %s', (_label, age, valid) => {
    setCache('flags', ['f']);
    vi.setSystemTime(1_000_000 + age);
    expect(isCacheValid('flags')).toBe(valid);
    expect(getFromCache('flags')).toEqual(valid ? ['f'] : null);
  });

  test('expired entries are removed when read', () => {
    setCache('flags', ['f']);
    vi.setSystemTime(1_000_000 + FIVE_MINUTES + 1);
    getFromCache('flags');
    expect(localStorage.getItem('admin-cache-flags')).toBeNull();
  });

  test('a custom TTL is honoured', () => {
    setCache('stats', 1);
    vi.setSystemTime(1_000_000 + 2000);
    expect(getFromCache('stats', 1000)).toBeNull();
  });

  test('metadata reports age and time remaining', () => {
    setCache('users', []);
    vi.setSystemTime(1_000_000 + 60_000);
    expect(getCacheMetadata('users')).toEqual({
      timestamp: 1_000_000,
      age: 60_000,
      ttl: FIVE_MINUTES,
      isValid: true,
      timeRemaining: 240_000,
      expiresIn: '240s',
    });
    vi.setSystemTime(1_000_000 + FIVE_MINUTES + 5000);
    expect(getCacheMetadata('users')).toMatchObject({ isValid: false, timeRemaining: 0, expiresIn: '0s' });
  });

  test('clearCache removes one entry; clearAllAdminCache removes only admin entries', () => {
    setCache('a', 1);
    setCache('b', 2);
    localStorage.setItem('match-actions', '[]');
    clearCache('a');
    expect(getFromCache('a')).toBeNull();
    expect(getFromCache('b')).toBe(2);
    clearAllAdminCache();
    expect(getFromCache('b')).toBeNull();
    expect(localStorage.getItem('match-actions')).toBe('[]');
  });

  test('corrupted entries are treated as missing', () => {
    localStorage.setItem('admin-cache-users', 'not json');
    expect(getFromCache('users')).toBeNull();
    expect(isCacheValid('users')).toBe(false);
    expect(getCacheMetadata('users')).toBeNull();
  });

  test('storage failures never throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Object, 'keys').mockImplementationOnce(() => { throw new Error('denied'); });
    expect(() => setCache('x', 1)).not.toThrow();
    expect(() => clearCache('x')).not.toThrow();
    expect(() => clearAllAdminCache()).not.toThrow();
  });
});
