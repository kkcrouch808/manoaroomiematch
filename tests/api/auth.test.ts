import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { compare, hash } from 'bcrypt';
import * as nextAuthRoute from '@/app/api/auth/[...nextauth]/route';
import * as changePassword from '@/app/api/auth/change-password/route';
import * as checkUser from '@/app/api/auth/check-user/route';
import * as deleteUser from '@/app/api/delete user/route';
import { prismaMock } from '../helpers/prisma-mock';
import { signInAs, studentSession } from '../helpers/sessions';
import { jsonRequest, readJson } from '../helpers/requests';
import { makeUser } from '../helpers/factories';
import { SQL_INJECTION_PAYLOADS } from '../fixtures/malicious-inputs';

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hash('changeme', 10);
});

test('the next-auth catch-all route exports GET and POST handlers', () => {
  expect(typeof nextAuthRoute.GET).toBe('function');
  expect(nextAuthRoute.POST).toBe(nextAuthRoute.GET);
});

describe('POST /api/auth/change-password', () => {
  const change = (body: unknown) => changePassword.POST(jsonRequest('/', body));
  beforeEach(() => signInAs(studentSession));

  test('verifies the current password and stores a new bcrypt hash', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    const { status } = await readJson(await change({
      email: 'john@foo.com', currentPassword: 'changeme', newPassword: 'n3w-password',
    }));
    expect(status).toBe(200);
    const { where, data } = prismaMock.user.update.mock.calls[0][0];
    expect(where).toEqual({ email: 'john@foo.com' });
    await expect(compare('n3w-password', data.password)).resolves.toBe(true);
  });

  test.each([
    ['wrong current password', 'not-changeme', 401],
    ['SQL injection as the current password', "' OR '1'='1", 401],
  ])('%s -> %i, password unchanged', async (_label, currentPassword, status) => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    expect((await change({ email: 'john@foo.com', currentPassword, newPassword: 'x' })).status).toBe(status);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test.each([
    ['missing email', { currentPassword: 'a', newPassword: 'b' }],
    ['missing current password', { email: 'a', newPassword: 'b' }],
    ['missing new password', { email: 'a', currentPassword: 'b' }],
  ])('%s -> 400', async (_label, body) => {
    expect((await change(body)).status).toBe(400);
  });

  test('404 for an unknown email, 500 on errors', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await change({ email: 'x', currentPassword: 'a', newPassword: 'b' })).status).toBe(404);
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('db'));
    expect((await change({ email: 'x', currentPassword: 'a', newPassword: 'b' })).status).toBe(500);
  });

  // WEAKNESS: the account is chosen by the `email` in the request body, not by the session, so a signed-in
  // user can change (or brute-force the password of) a different account. Knowing the victim's current
  // password is still required, which limits the impact.
  test.fails('KNOWN DEFECT: only changes the password of the signed-in account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 9, email: 'jane@hawaii.edu', password: passwordHash }));
    const response = await change({ email: 'jane@hawaii.edu', currentPassword: 'changeme', newPassword: 'pwned' });
    expect(response.status).toBe(403);
  });
});

describe('POST /api/auth/check-user (public, used before sign-in)', () => {
  const check = (body: unknown) => checkUser.POST(jsonRequest('/', body));

  test.each([
    ['unknown user', null, 'changeme'],
    ['wrong password', {}, 'wrong'],
  ])('%s gets the same "valid" answer (no account enumeration)', async (_label, user, password) => {
    const suspendedUntil = new Date(Date.now() + 1e9);
    prismaMock.user.findUnique.mockResolvedValue(user && makeUser({ password: passwordHash, suspendedUntil }));
    expect((await readJson(await check({ email: 'x@hawaii.edu', password }))).body).toEqual({ status: 'valid' });
    expect(prismaMock.flag.findFirst).not.toHaveBeenCalled();
  });

  test('suspension details are revealed only with the correct password', async () => {
    const until = new Date(Date.now() + 3_600_000);
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash, suspendedUntil: until }));
    prismaMock.flag.findFirst.mockResolvedValue({
      reason: 'spam', status: 'suspended', created_at: new Date('2025-01-01'),
    });
    prismaMock.moderationAction.findFirst.mockResolvedValue({ action: 'suspend', createdAt: new Date('2025-01-02') });

    const { body } = await readJson(await check({ email: 'john@foo.com', password: 'changeme' }));

    expect(body).toEqual({
      status: 'suspended',
      suspendedUntil: until.toISOString(),
      role: 'USER',
      flag: { reason: 'spam', status: 'suspended', createdAt: '2025-01-01T00:00:00.000Z' },
      action: { action: 'suspend', createdAt: '2025-01-02T00:00:00.000Z' },
    });
    expect(prismaMock.moderationAction.findFirst.mock.calls[0][0].where)
      .toEqual({ targetUserId: 5, action: 'suspend' });
  });

  test('deactivated accounts are reported as such', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash, active: false }));
    prismaMock.flag.findFirst.mockResolvedValue(null);
    prismaMock.moderationAction.findFirst.mockResolvedValue({
      action: 'deactivate', createdAt: new Date('2025-01-02'),
    });
    const { body } = await readJson(await check({ email: 'john@foo.com', password: 'changeme' }));
    expect(body).toMatchObject({ status: 'deactivated', flag: null, action: { action: 'deactivate' } });
  });

  test('deactivated or suspended without history returns nulls', async () => {
    prismaMock.flag.findFirst.mockResolvedValue({ reason: 'r', status: 's', created_at: new Date(0) });
    prismaMock.moderationAction.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValueOnce(makeUser({ password: passwordHash, active: false }));
    expect((await readJson(await check({ email: 'a', password: 'changeme' }))).body.action).toBeNull();
    prismaMock.flag.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValueOnce(
      makeUser({ password: passwordHash, suspendedUntil: new Date(Date.now() + 1e6), role: null }),
    );
    expect((await readJson(await check({ email: 'a', password: 'changeme' }))).body)
      .toMatchObject({ role: 'USER', flag: null, action: null });
  });

  test('an active account with an expired suspension is valid', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ password: passwordHash, suspendedUntil: new Date(0), role: 'ADMIN' }),
    );
    expect((await readJson(await check({ email: 'a', password: 'changeme' }))).body)
      .toEqual({ status: 'valid', role: 'ADMIN' });
  });

  test.each([...SQL_INJECTION_PAYLOADS])('email %j is only a lookup value', async (email) => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await readJson(await check({ email, password: 'x' }))).body).toEqual({ status: 'valid' });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email } });
  });

  test('400 without credentials, 500 on errors', async () => {
    expect((await check({ email: 'a' })).status).toBe(400);
    prismaMock.user.findUnique.mockRejectedValue(new Error('db'));
    expect((await check({ email: 'a', password: 'b' })).status).toBe(500);
  });
});

describe('POST /api/delete user (delete own account)', () => {
  const remove = (body: unknown) => deleteUser.POST(jsonRequest('/', body));
  beforeEach(() => signInAs(studentSession));

  test('with the right password, deletes the caller\'s data in one transaction', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    prismaMock.userProfile.findUnique.mockResolvedValue({ id: 'p5' });
    prismaMock.match.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);

    expect(await readJson(await remove({ password: 'changeme' }))).toEqual({ status: 200, body: { success: true } });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.aIExplanation.deleteMany).toHaveBeenCalledWith({ where: { match_id: { in: ['m1', 'm2'] } } });
    expect(prismaMock.message.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ senderId: 5 }, { receiverId: 5 }] } });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { email: 'john@foo.com' } });
  });

  test('a user without a profile or matches can still delete their account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    prismaMock.userProfile.findUnique.mockResolvedValueOnce({ id: 'p5' }).mockResolvedValueOnce(null);
    prismaMock.match.findMany.mockResolvedValue([]);
    expect((await remove({ password: 'changeme' })).status).toBe(200);
    expect(prismaMock.aIExplanation.deleteMany).not.toHaveBeenCalled();
    expect((await remove({ password: 'changeme' })).status).toBe(200);
  });

  test.each([
    ['no password', {}, 400],
    ['wrong password', { password: 'nope' }, 400],
  ])('%s -> %i and nothing is deleted', async (_label, body, status) => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    expect((await remove(body)).status).toBe(status);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('400 when the account no longer exists, 500 when the transaction fails', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await remove({ password: 'changeme' })).status).toBe(400);
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ password: passwordHash }));
    prismaMock.$transaction.mockRejectedValueOnce(new Error('fk'));
    expect((await remove({ password: 'changeme' })).status).toBe(500);
  });
});
