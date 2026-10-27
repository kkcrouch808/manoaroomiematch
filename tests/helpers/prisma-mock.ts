import { vi, type Mock } from 'vitest';

const MODELS = [
  'user', 'userProfile', 'match', 'flag', 'notification', 'aIExplanation', 'message',
  'lifestyleCategory', 'lifestyleQuestion', 'lifestyleOption', 'lifestyleResponse', 'moderationAction',
] as const;
const METHODS = [
  'findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany',
  'upsert', 'delete', 'deleteMany', 'count',
] as const;

type ModelMock = Record<(typeof METHODS)[number], Mock>;
export type PrismaMock = Record<(typeof MODELS)[number], ModelMock> & {
  $transaction: Mock;
  $disconnect: Mock;
};

const mock = {} as PrismaMock;
MODELS.forEach((model) => {
  mock[model] = Object.fromEntries(METHODS.map((method) => [method, vi.fn()])) as ModelMock;
});
// Interactive transactions run against the same mock, array transactions resolve every query
mock.$transaction = vi.fn(async (arg: unknown) => (
  typeof arg === 'function' ? arg(mock) : Promise.all(arg as Promise<unknown>[])
));
mock.$disconnect = vi.fn();

/** One shared mock that replaces both `@/lib/prisma` and every `new PrismaClient()` in src/. */
export const prismaMock = mock;

/** Clears calls and per-test return values (mockReset keeps the vi.fn(impl) defaults above). */
export function resetPrismaMock() {
  MODELS.forEach((model) => METHODS.forEach((method) => mock[model][method].mockReset()));
  mock.$transaction.mockReset();
  mock.$disconnect.mockReset();
}
