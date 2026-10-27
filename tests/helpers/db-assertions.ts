import { expect } from 'vitest';
import { prismaMock } from './prisma-mock';

type MockFn = { mock: { calls: unknown[] } };

/** Asserts that no Prisma query of any kind was issued (e.g. after an auth check rejected the caller). */
export default function expectNoDatabaseAccess() {
  const called = Object.entries(prismaMock).flatMap(([model, value]) => {
    if (typeof value === 'function') {
      return (value as unknown as MockFn).mock.calls.length ? [model] : [];
    }
    return Object.entries(value as Record<string, MockFn>)
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([method]) => `${model}.${method}`);
  });
  expect(called).toEqual([]);
}
