/**
 * How the app uses next-auth: the credentials `authorize` function (with real bcrypt hashes),
 * the jwt/session callbacks that carry the role as `randomKey`, and the redirect callback.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { hash } from 'bcrypt';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import authOptions from '@/lib/authOptions';
import { prismaMock } from '../../helpers/prisma-mock';
import { makeUser } from '../../helpers/factories';
import { SQL_INJECTION_PAYLOADS } from '../../fixtures/malicious-inputs';

type Credentials = Record<'email' | 'password', string> | undefined;
// next-auth v4 keeps the user-supplied authorize() on provider.options
const { authorize } = (authOptions.providers[0] as unknown as {
  options: { authorize: (c: Credentials, req: unknown) => Promise<unknown> };
}).options;
const callbacks = authOptions.callbacks!;

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hash('changeme', 10);
});

describe('authOptions configuration', () => {
  test('uses JWT sessions, a credentials provider and the custom auth pages', () => {
    expect(authOptions.session?.strategy).toBe('jwt');
    expect(authOptions.providers).toHaveLength(1);
    expect(authOptions.providers[0]).toMatchObject({ id: 'credentials', type: 'credentials' });
    expect(authOptions.pages).toEqual({ signIn: '/auth/signin', signOut: '/auth/signout' });
  });
});

describe('credentials authorize()', () => {
  test('a student with the right password gets their id, email and role', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    await expect(authorize({ email: 'john@foo.com', password: 'changeme' }, {}))
      .resolves.toEqual({ id: '5', email: 'john@foo.com', randomKey: 'USER' });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'john@foo.com' } });
  });

  test('an admin is tagged with the ADMIN role', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 1, role: 'ADMIN', password: passwordHash }));
    await expect(authorize({ email: 'admin@foo.com', password: 'changeme' }, {}))
      .resolves.toMatchObject({ id: '1', randomKey: 'ADMIN' });
  });

  test('a suspension that has already expired does not block sign-in', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: passwordHash, suspendedUntil: new Date(Date.now() - 60_000) }),
    );
    await expect(authorize({ email: 'john@foo.com', password: 'changeme' }, {})).resolves.not.toBeNull();
  });

  test.each([
    ['wrong password', { password: 'not-changeme' }, 'changeme-wrong'],
    ['password differs only by case', {}, 'CHANGEME'],
    ['password with trailing space', {}, 'changeme '],
    ['empty password', {}, ''],
    ['deactivated account (correct password)', { active: false }, 'changeme'],
    ['suspended account (correct password)', { suspendedUntil: new Date(Date.now() + 3_600_000) }, 'changeme'],
    ['password column holds plaintext, not a hash', { password: 'changeme' }, 'changeme'],
  ])('rejects: %s', async (_label, overrides, password) => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash, ...overrides }));
    await expect(authorize({ email: 'john@foo.com', password }, {})).resolves.toBeNull();
  });

  test('rejects a user that does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(authorize({ email: 'nobody@hawaii.edu', password: 'changeme' }, {})).resolves.toBeNull();
  });

  test.each([
    ['no credentials', undefined],
    ['missing email', { email: '', password: 'changeme' }],
    ['missing password', { email: 'john@foo.com', password: '' }],
  ])('rejects %s without querying the database', async (_label, credentials) => {
    await expect(authorize(credentials as Credentials, {})).resolves.toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  test.each([...SQL_INJECTION_PAYLOADS])('SQL-injection email %j reaches Prisma as a plain value', async (email) => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(authorize({ email, password: "' OR '1'='1" }, {})).resolves.toBeNull();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email } });
  });
});

describe('jwt and session callbacks carry the role', () => {
  const jwt = callbacks.jwt as (args: { token: JWT; user?: unknown }) => JWT;
  const session = callbacks.session as (args: { session: Session; token: JWT }) => Session;

  test('on sign-in, jwt() copies id and role from the authorized user onto the token', () => {
    const token = jwt({ token: { email: 'admin@foo.com' } as JWT, user: { id: '1', randomKey: 'ADMIN' } });
    expect(token).toEqual({ email: 'admin@foo.com', id: '1', randomKey: 'ADMIN' });
  });

  test('on later requests, jwt() returns the token unchanged', () => {
    const existing = { email: 'john@foo.com', id: '5', randomKey: 'USER' } as JWT;
    expect(jwt({ token: existing })).toBe(existing);
  });

  test('session() exposes id and role from the token on session.user', () => {
    const result = session({
      session: { user: { email: 'john@foo.com', name: null }, expires: 'x' } as unknown as Session,
      token: { id: '5', randomKey: 'USER' } as JWT,
    });
    expect(result).toEqual({ user: { email: 'john@foo.com', name: null, id: '5', randomKey: 'USER' }, expires: 'x' });
  });
});

describe('redirect callback (open-redirect protection)', () => {
  const redirect = callbacks.redirect as (args: { url: string; baseUrl: string }) => string;
  const baseUrl = 'http://localhost:3000';

  test.each([
    ['relative path', '/profile', '/profile'],
    ['same-origin absolute URL', 'http://localhost:3000/matches', 'http://localhost:3000/matches'],
    ['external site', 'https://evil.example/phish', baseUrl],
    ['look-alike host', 'http://localhost:3000.evil.example/', baseUrl],
    // eslint-disable-next-line no-script-url
    ['javascript: URL', 'javascript:alert(1)', baseUrl],
    ['data: URL', 'data:text/html,<script>alert(1)</script>', baseUrl],
    ['different port', 'http://localhost:4000/', baseUrl],
    ['unparseable URL', 'http://[::1', baseUrl],
  ])('%s', (_label, url, expected) => {
    expect(redirect({ url, baseUrl })).toBe(expected);
  });

  // KNOWN VULNERABILITY (open redirect): anything starting with "/" is treated as a safe relative path,
  // but browsers resolve "//evil.example" and "/\evil.example" to another host. A sign-in link with
  // callbackUrl=//evil.example sends the user to an attacker's site after a successful login.
  test.fails.each([
    ['protocol-relative URL', '//evil.example/phish'],
    ['backslash variant', '/\\evil.example/phish'],
  ])('KNOWN DEFECT: %s is not allowed', (_label, url) => {
    const target = new URL(redirect({ url, baseUrl }), baseUrl);
    expect(target.origin).toBe(baseUrl);
  });
});
