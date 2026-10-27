import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('fs');
  vi.resetModules();
});

describe('aiClient with config/ai.json', () => {
  test('reads the model and provider from config/ai.json', async () => {
    const { getDefaultModel, getAiProvider } = await import('@/lib/aiClient');
    expect(getDefaultModel()).toBe('claude-haiku-4.5');
    expect(getAiProvider()).toBe('anthropic');
  });

  test('environment variables override the config file', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_MODEL', 'override-model');
    vi.stubEnv('NEXT_PUBLIC_AI_PROVIDER', 'override-provider');
    const client = (await import('@/lib/aiClient')).default;
    expect(client.getDefaultModel()).toBe('override-model');
    expect(client.getAiProvider()).toBe('override-provider');
  });
});

describe('aiClient without a usable config file', () => {
  test.each([
    ['missing file', { existsSync: () => false, readFileSync: vi.fn() }],
    ['invalid JSON', { existsSync: () => true, readFileSync: () => '{ not json' }],
  ])('%s falls back to built-in defaults', async (_label, fsImpl) => {
    vi.doMock('fs', () => ({ default: fsImpl, ...fsImpl }));
    const { getDefaultModel, getAiProvider } = await import('@/lib/aiClient');
    expect(getDefaultModel()).toBe('claude-haiku-4.5');
    expect(getAiProvider()).toBe('anthropic');
  });
});
