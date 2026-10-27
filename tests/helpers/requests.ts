import { NextRequest } from 'next/server';

const ORIGIN = 'http://localhost:3000';

export function getRequest(path: string, headers?: Record<string, string>) {
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

export function jsonRequest(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

export function formRequest(path: string, form: FormData) {
  return new NextRequest(`${ORIGIN}${path}`, { method: 'POST', body: form });
}

/** Second argument the App Router passes to dynamic route handlers. */
export const routeParams = <T extends Record<string, string>>(params: T) => ({ params });

export async function readJson(response: Response) {
  return { status: response.status, body: await response.json() };
}
