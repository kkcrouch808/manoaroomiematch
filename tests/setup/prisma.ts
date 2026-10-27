import { beforeEach, vi } from 'vitest';
import { resetPrismaMock } from '../helpers/prisma-mock';

// No unit/API/component test may reach a real database. Integration tests use their own config.
vi.mock('@/lib/prisma', async () => {
  const { prismaMock } = await import('../helpers/prisma-mock');
  return { prisma: prismaMock };
});

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const { prismaMock } = await import('../helpers/prisma-mock');
  return {
    ...actual,
    PrismaClient: vi.fn(function PrismaClient() { return prismaMock; }),
  };
});

beforeEach(() => {
  resetPrismaMock();
});
