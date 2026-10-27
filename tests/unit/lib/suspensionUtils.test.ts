import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  checkUserSuspensionStatus,
  clearExpiredSuspensions,
  clearExpiredSuspensionsAsync,
} from '@/lib/suspensionUtils';
import { prismaMock } from '../../helpers/prisma-mock';

// clearExpiredSuspensions keeps module-level throttle state (at most once per 5 minutes), so every test
// starts at a clock far enough after the previous one to be allowed to run.
let clock = Date.UTC(2030, 0, 1);
beforeEach(() => {
  clock += 60 * 60 * 1000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('clearExpiredSuspensions', () => {
  test('resolves "suspended" flags of expired users and clears their suspensions', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 4 }, { id: 8 }]);
    prismaMock.flag.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.user.updateMany.mockResolvedValue({ count: 2 });

    await expect(clearExpiredSuspensions()).resolves.toBe(2);

    const expiredFilter = { suspendedUntil: { not: null, lt: new Date(clock) }, active: true };
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({ where: expiredFilter, select: { id: true } });
    expect(prismaMock.flag.updateMany).toHaveBeenCalledWith({
      where: { reported_user_id: { in: [4, 8] }, status: 'suspended' },
      data: { status: 'resolved' },
    });
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: expiredFilter,
      data: { suspendedUntil: null },
    });
  });

  test('skips flag updates when nobody has expired', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(clearExpiredSuspensions()).resolves.toBe(0);
    expect(prismaMock.flag.updateMany).not.toHaveBeenCalled();
  });

  test('runs at most once every 5 minutes', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    await clearExpiredSuspensions();
    vi.setSystemTime(clock + 4 * 60 * 1000);
    await expect(clearExpiredSuspensions()).resolves.toBe(0);
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + 5 * 60 * 1000 + 1);
    await clearExpiredSuspensions();
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(2);
  });

  test('returns 0 instead of throwing when the database fails', async () => {
    prismaMock.user.findMany.mockRejectedValue(new Error('db down'));
    await expect(clearExpiredSuspensions()).resolves.toBe(0);
  });

  test('async variant starts the cleanup without awaiting it', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    expect(clearExpiredSuspensionsAsync()).toBeUndefined();
    await vi.waitFor(() => expect(prismaMock.user.updateMany).toHaveBeenCalled());
  });
});

describe('checkUserSuspensionStatus', () => {
  test.each([
    ['missing user', null],
    ['never suspended', { suspendedUntil: null }],
  ])('%s is not suspended', async (_label, row) => {
    prismaMock.user.findUnique.mockResolvedValue(row);
    await expect(checkUserSuspensionStatus(3)).resolves.toEqual({ suspended: false, suspendedUntil: null });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('an active suspension is reported and left in place', async () => {
    const until = new Date(clock + 1000);
    prismaMock.user.findUnique.mockResolvedValue({ suspendedUntil: until });
    await expect(checkUserSuspensionStatus(3)).resolves.toEqual({ suspended: true, suspendedUntil: until });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { id: 3 }, select: { suspendedUntil: true } });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('an expired suspension is cleared', async () => {
    const until = new Date(clock - 1000);
    prismaMock.user.findUnique.mockResolvedValue({ suspendedUntil: until });
    await expect(checkUserSuspensionStatus(3)).resolves.toEqual({ suspended: false, suspendedUntil: until });
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { suspendedUntil: null } });
  });

  test('database errors fail open as "not suspended"', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db'));
    await expect(checkUserSuspensionStatus(3)).resolves.toEqual({ suspended: false, suspendedUntil: null });
  });
});
