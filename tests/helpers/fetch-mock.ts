import { vi } from 'vitest';

type Reply = { status?: number; body?: unknown } | undefined;
type Handler = (init?: RequestInit) => Reply | Promise<Reply>;

/**
 * Replaces global fetch for component tests. Routes are keyed "METHOD /path" or "/path" (any method);
 * the query string is ignored. Unknown URLs fail the test loudly instead of hanging.
 */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = (init?.method || 'GET').toUpperCase();
    const handler = routes[`${method} ${path}`] ?? routes[path];
    if (!handler) throw new Error(`Unexpected fetch: ${method} ${path}`);
    const reply = (await handler(init)) ?? {};
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Calls made to a given path, with their parsed JSON bodies. */
export function callsTo(fn: ReturnType<typeof mockFetch>, path: string) {
  return fn.mock.calls
    .filter(([input]) => String(input).split('?')[0].endsWith(path))
    .map(([, init]) => ({
      method: (init?.method || 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    }));
}
