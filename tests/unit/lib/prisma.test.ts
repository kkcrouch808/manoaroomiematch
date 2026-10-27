import { afterEach, describe, expect, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

type GlobalWithPrisma = typeof globalThis & { prisma?: unknown };

afterEach(() => {
  delete (globalThis as GlobalWithPrisma).prisma;
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The setup file replaces @/lib/prisma with a mock; load the real module (it still gets the mocked PrismaClient)
const loadRealModule = () => vi.importActual<typeof import('@/lib/prisma')>('@/lib/prisma');

describe('@/lib/prisma', () => {
  test('creates a client with query logging and caches it on globalThis outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { prisma } = await loadRealModule();
    expect(PrismaClient).toHaveBeenCalledWith({ log: ['query'] });
    expect((globalThis as GlobalWithPrisma).prisma).toBe(prisma);
  });

  test('reuses the cached client instead of opening another connection pool', async () => {
    const cached = { cached: true };
    (globalThis as GlobalWithPrisma).prisma = cached;
    vi.mocked(PrismaClient).mockClear();
    const { prisma } = await loadRealModule();
    expect(prisma).toBe(cached);
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  test('does not cache on globalThis in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await loadRealModule();
    expect((globalThis as GlobalWithPrisma).prisma).toBeUndefined();
  });
});
