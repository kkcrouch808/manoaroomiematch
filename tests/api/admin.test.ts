import { beforeEach, describe, expect, test } from 'vitest';
import * as categories from '@/app/api/admin/categories/route';
import * as clearExpired from '@/app/api/admin/clear-expired-suspensions/route';
import * as deleteFlag from '@/app/api/admin/delete-flag/route';
import * as flags from '@/app/api/admin/flags/route';
import * as moderationHistory from '@/app/api/admin/moderation-history/route';
import * as adminProfile from '@/app/api/admin/profile/route';
import * as resolveFlag from '@/app/api/admin/resolve-flag/route';
import * as userRole from '@/app/api/admin/user-role/route';
import * as users from '@/app/api/admin/users/route';
import { prismaMock } from '../helpers/prisma-mock';
import { adminSession, signInAs } from '../helpers/sessions';
import { getRequest, jsonRequest, readJson } from '../helpers/requests';
import { makeUser } from '../helpers/factories';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';

beforeEach(() => {
  signInAs(adminSession);
});

describe('GET /api/admin/flags', () => {
  const flagRow = {
    id: 1,
    reported_user_id: 7,
    reported_by_user_id: 5,
    reason: 'spam',
    status: 'pending',
    created_at: new Date('2025-03-04T10:00:00Z'),
  };

  test('returns flags with names, suspension info and pagination', async () => {
    prismaMock.flag.count.mockResolvedValue(25);
    prismaMock.flag.findMany.mockResolvedValue([flagRow, { ...flagRow, id: 2, reported_user_id: 99 }]);
    prismaMock.user.findMany.mockResolvedValue([
      makeUser({ id: 7, email: 'kai@hawaii.edu', suspensionCount: 2, active: false }),
      makeUser({ id: 5, email: 'john@foo.com' }),
    ]);
    prismaMock.userProfile.findMany.mockResolvedValue([{ userId: 5, name: 'John Foo' }]);

    const { status, body } = await readJson(await flags.GET(getRequest('/api/admin/flags?page=3&limit=10')));

    expect(status).toBe(200);
    expect(body.pagination).toEqual({ total: 25, page: 3, limit: 10, pages: 3 });
    expect(prismaMock.flag.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(body.flags[0]).toMatchObject({
      id: 1,
      user: 'kai@hawaii.edu',
      userId: 7,
      reportedBy: 'John Foo',
      reason: 'spam',
      date: '2025-03-04',
      suspensionCount: 2,
      active: false,
    });
    expect(body.flags[1].user).toBe('Unknown User');
  });

  const emptyTables = () => {
    prismaMock.flag.count.mockResolvedValue(0);
    prismaMock.flag.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.userProfile.findMany.mockResolvedValue([]);
  };

  test.each([
    ['page=0&limit=0', 1, 1],
    ['page=-5&limit=500', 1, 100],
  ])('clamps pagination ?%s', async (query, page, limit) => {
    emptyTables();
    const response = await flags.GET(getRequest(`/api/admin/flags?${query}`));
    expect((await response.json()).pagination).toMatchObject({ page, limit });
  });

  // WEAKNESS: parseInt('abc') is NaN and Math.max(1, NaN) is NaN, so non-numeric paging reaches Prisma as
  // skip/take NaN (a 500 against a real database) instead of falling back to page 1, limit 10.
  test.fails('non-numeric pagination falls back to the defaults', async () => {
    emptyTables();
    const response = await flags.GET(getRequest('/api/admin/flags?page=abc&limit=xyz'));
    expect((await response.json()).pagination).toMatchObject({ page: 1, limit: 10 });
  });

  test('falls back to an empty list when the flag table is unavailable', async () => {
    prismaMock.flag.count.mockRejectedValueOnce(new Error('relation does not exist'));
    expect((await readJson(await flags.GET(getRequest('/')))).body.flags).toEqual([]);
    prismaMock.flag.count.mockResolvedValue(1);
    prismaMock.flag.findMany.mockRejectedValueOnce(new Error('relation does not exist'));
    expect((await readJson(await flags.GET(getRequest('/')))).body.flags).toEqual([]);
  });

  test('uses emails when the profile table is unavailable, and 500s on other errors', async () => {
    prismaMock.flag.count.mockResolvedValue(1);
    prismaMock.flag.findMany.mockResolvedValue([flagRow]);
    prismaMock.user.findMany.mockResolvedValue([makeUser({ id: 5, email: 'john@foo.com' })]);
    prismaMock.userProfile.findMany.mockRejectedValue(new Error('missing'));
    expect((await readJson(await flags.GET(getRequest('/')))).body.flags[0].reportedBy).toBe('john@foo.com');
    prismaMock.user.findMany.mockRejectedValue(new Error('db'));
    expect((await flags.GET(getRequest('/'))).status).toBe(500);
  });
});

describe('POST /api/admin/delete-flag', () => {
  test('deletes the flag', async () => {
    expect(await readJson(await deleteFlag.POST(jsonRequest('/', { flagId: 4 }))))
      .toEqual({ status: 200, body: { success: true } });
    expect(prismaMock.flag.delete).toHaveBeenCalledWith({ where: { id: 4 } });
  });

  test('requires a flag id; reports missing flags as 500', async () => {
    expect((await deleteFlag.POST(jsonRequest('/', {}))).status).toBe(400);
    prismaMock.flag.delete.mockRejectedValue(new Error('Record to delete does not exist'));
    expect((await deleteFlag.POST(jsonRequest('/', { flagId: 99 }))).status).toBe(500);
  });
});

describe('POST /api/admin/resolve-flag', () => {
  const resolve = (body: unknown) => resolveFlag.POST(jsonRequest('/', body));
  const reportedUser = makeUser({ id: 7, email: 'kai@hawaii.edu' });

  beforeEach(() => {
    prismaMock.flag.findUnique.mockResolvedValue({ id: 3, reported_user_id: 7 });
    prismaMock.user.findUnique.mockResolvedValue(reportedUser);
    prismaMock.user.update.mockImplementation(async ({ data }) => ({ ...reportedUser, ...data }));
    prismaMock.flag.update.mockImplementation(async ({ data }) => ({ id: 3, ...data }));
    // Reporters of user 7: a student (5) twice, and an admin (1)
    prismaMock.flag.findMany.mockResolvedValue([
      { reported_by_user_id: 5 }, { reported_by_user_id: 5 }, { reported_by_user_id: 1 },
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 5, role: 'USER' }, { id: 1, role: 'ADMIN' }]);
  });

  test.each([
    ['resolve', {}, 'resolved', undefined, /reviewed the case and taken appropriate action/],
    ['suspend', { durationHours: 24 }, 'suspended', expect.objectContaining({ suspensionCount: { increment: 1 } }),
      /taken appropriate action/],
    ['unsuspend', {}, 'resolved', { suspendedUntil: null }, null],
    ['deactivate', {}, 'user_deactivated', { active: false, suspendedUntil: null }, /deactivated the user's account/],
    ['reactivate', {}, 'resolved', { active: true }, null],
  ])('%s updates the flag, the user, the audit log and notifications', async (
    action,
    extra,
    flagStatus,
    userData,
    notification,
  ) => {
    const { status } = await readJson(await resolve({ flagId: '3', action, notes: 'checked', ...extra }));

    expect(status).toBe(200);
    expect(prismaMock.flag.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: flagStatus } });
    if (userData) {
      expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: userData });
    } else {
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    }
    expect(prismaMock.moderationAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ targetUserId: 7, adminUserId: 1, action, notes: 'checked', flagId: 3 }),
    });
    if (notification) {
      // One notification per distinct non-admin reporter
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [{ user_id: 5, type: 'report_action', content: expect.stringMatching(notification), is_read: false }],
      });
    } else {
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    }
  });

  test('suspension end time is now + durationHours', async () => {
    const before = Date.now();
    await resolve({ flagId: 3, action: 'suspend', durationHours: 48 });
    const { suspendedUntil } = prismaMock.user.update.mock.calls[0][0].data;
    expect(suspendedUntil.getTime() - before).toBeGreaterThanOrEqual(48 * 3600 * 1000);
    expect(suspendedUntil.getTime() - before).toBeLessThan(48 * 3600 * 1000 + 5000);
  });

  test('notification failures do not fail the moderation action', async () => {
    prismaMock.notification.createMany.mockRejectedValue(new Error('db'));
    expect((await resolve({ flagId: 3, action: 'resolve' })).status).toBe(200);
  });

  test('no notifications when only admins reported the user', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 1, role: 'ADMIN' }]);
    await resolve({ flagId: 3, action: 'resolve' });
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
    prismaMock.flag.findMany.mockResolvedValue([]);
    await resolve({ flagId: 3, action: 'resolve' });
    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing flagId', { action: 'resolve' }, 400],
    ['missing action', { flagId: 3 }, 400],
    ['negative flagId', { flagId: -3, action: 'resolve' }, 400],
    ['non-numeric flagId', { flagId: 'abc', action: 'resolve' }, 400],
    ['unknown action', { flagId: 3, action: 'delete-account' }, 400],
    ['injected action', { flagId: 3, action: "resolve'; DROP TABLE \"Flag\"; --" }, 400],
    ['suspend without duration', { flagId: 3, action: 'suspend' }, 400],
    ['negative duration', { flagId: 3, action: 'suspend', durationHours: -1 }, 400],
    ['duration as a string', { flagId: 3, action: 'suspend', durationHours: '24' }, 400],
  ])('rejects %s', async (_label, body, status) => {
    expect((await resolve(body)).status).toBe(status);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.flag.update).not.toHaveBeenCalled();
  });

  test.each([
    ['the flag does not exist', () => prismaMock.flag.findUnique.mockResolvedValue(null), 404],
    ['the flag has no reported user',
      () => prismaMock.flag.findUnique.mockResolvedValue({ id: 3, reported_user_id: 0 }), 400],
    ['the reported user was deleted', () => prismaMock.user.findUnique.mockResolvedValue(null), 404],
    ['the database fails', () => prismaMock.flag.findUnique.mockRejectedValue(new Error('db')), 500],
  ])('refuses when %s', async (_label, arrange, status) => {
    arrange();
    expect((await resolve({ flagId: 3, action: 'deactivate' })).status).toBe(status);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  // WEAKNESS: suspend/unsuspend/deactivate/reactivate return the full Prisma User row, including the
  // bcrypt password hash, to the browser. Admin-only, but hashes should never leave the server.
  test.fails('responses never include the password hash', async () => {
    const { body } = await readJson(await resolve({ flagId: 3, action: 'deactivate' }));
    expect(body.user).not.toHaveProperty('password');
  });
});

describe('POST /api/admin/user-role', () => {
  const setRole = (body: unknown) => userRole.POST(jsonRequest('/', body));

  test('promotes a user and returns only safe fields', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 5 }));
    prismaMock.user.update.mockResolvedValue(makeUser({ id: 5, role: 'ADMIN' }));
    const { status, body } = await readJson(await setRole({ userId: 5, newRole: 'ADMIN' }));
    expect(status).toBe(200);
    expect(body.user).toEqual({ id: 5, email: 'john@foo.com', role: 'ADMIN' });
    expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { role: 'ADMIN' } });
  });

  test('refuses to demote the last admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 1, role: 'ADMIN' }));
    prismaMock.user.count.mockResolvedValue(1);
    const { status, body } = await readJson(await setRole({ userId: 1, newRole: 'USER' }));
    expect(status).toBe(400);
    expect(body.error).toMatch(/last admin/);
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: { role: 'ADMIN' } });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('allows demoting an admin when another admin remains', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 1, role: 'ADMIN' }));
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.update.mockResolvedValue(makeUser({ id: 1, role: 'USER' }));
    expect((await setRole({ userId: 1, newRole: 'USER' })).status).toBe(200);
  });

  test.each([
    ['userId 0', { userId: 0, newRole: 'ADMIN' }, 400],
    ['userId text', { userId: 'abc', newRole: 'ADMIN' }, 400],
    ['lower-case role', { userId: 5, newRole: 'admin' }, 400],
    ['invented role', { userId: 5, newRole: 'SUPERADMIN' }, 400],
    ['XSS role', { userId: 5, newRole: XSS_PAYLOADS[0] }, 400],
  ])('rejects %s', async (_label, body, status) => {
    expect((await setRole(body)).status).toBe(status);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('404 for an unknown user, 500 on database errors', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await setRole({ userId: 99, newRole: 'ADMIN' })).status).toBe(404);
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('db'));
    expect((await setRole({ userId: 99, newRole: 'ADMIN' })).status).toBe(500);
  });
});

describe('/api/admin/users', () => {
  test('GET lists users with display names and never returns password hashes', async () => {
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.user.findMany.mockResolvedValue([
      { ...makeUser({ id: 1 }), profile: { firstName: 'Kai', lastName: 'Akana', name: 'x' } },
      { ...makeUser({ id: 2, email: 'lani@hawaii.edu' }), profile: { firstName: null, lastName: null, name: 'Lani' } },
      { ...makeUser({ id: 3, email: 'noprofile@hawaii.edu' }), profile: null },
    ]);
    const { status, body } = await readJson(await users.GET(getRequest('/?page=1&limit=2')));
    expect(status).toBe(200);
    expect(body.users.map((u: { name: string }) => u.name)).toEqual(['Kai Akana', 'Lani', 'noprofile']);
    expect(body.pagination).toEqual({ total: 3, page: 1, limit: 2, pages: 2 });
    expect(JSON.stringify(body)).not.toContain('$2b$');
  });

  test('GET returns 500 on database errors', async () => {
    prismaMock.user.count.mockRejectedValue(new Error('db'));
    expect((await users.GET(getRequest('/'))).status).toBe(500);
  });

  describe('POST (delete a user)', () => {
    const remove = (body: unknown) => users.POST(jsonRequest('/', body));

    test('removes everything that references the user, then the user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 7 }));
      prismaMock.userProfile.findUnique.mockResolvedValue({ id: 'p7' });

      expect((await remove({ id: '7' })).status).toBe(200);

      expect(prismaMock.match.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ user1Id: 'p7' }, { user2Id: 'p7' }] },
      });
      expect(prismaMock.lifestyleResponse.deleteMany).toHaveBeenCalledWith({ where: { user_id: 7 } });
      expect(prismaMock.userProfile.delete).toHaveBeenCalledWith({ where: { userId: 7 } });
      expect(prismaMock.flag.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ reported_by_user_id: 7 }, { reported_user_id: 7 }] },
      });
      expect(prismaMock.moderationAction.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ targetUserId: 7 }, { adminUserId: 7 }] },
      });
      expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith({ where: { user_id: 7 } });
      expect(prismaMock.message.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ senderId: 7 }, { receiverId: 7 }] },
      });
      expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 7 } });
      // The user row goes last so no foreign key is left dangling
      const lastCleanup = prismaMock.message.deleteMany.mock.invocationCallOrder[0];
      expect(prismaMock.user.delete.mock.invocationCallOrder[0]).toBeGreaterThan(lastCleanup);
    });

    test('works for a user without a profile', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 7 }));
      prismaMock.userProfile.findUnique.mockResolvedValue(null);
      expect((await remove({ id: '7' })).status).toBe(200);
      expect(prismaMock.userProfile.delete).not.toHaveBeenCalled();
    });

    test('refuses to delete the last admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 1, role: 'ADMIN' }));
      prismaMock.user.count.mockResolvedValue(1);
      expect((await remove({ id: '1' })).status).toBe(400);
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
    });

    test('may delete an admin when others remain', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 1, role: 'ADMIN' }));
      prismaMock.user.count.mockResolvedValue(2);
      prismaMock.userProfile.findUnique.mockResolvedValue(null);
      expect((await remove({ id: '1' })).status).toBe(200);
    });

    test.each([
      ['missing id', {}, 400],
      ['numeric id (must be a string)', { id: 7 }, 400],
      ['non-numeric id', { id: 'abc' }, 400],
    ])('rejects %s', async (_label, body, status) => {
      expect((await remove(body)).status).toBe(status);
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
    });

    test('404 for an unknown user; 500 if cleanup or the final delete fails', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      expect((await remove({ id: '99' })).status).toBe(404);

      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 7 }));
      prismaMock.userProfile.findUnique.mockResolvedValue(null);
      prismaMock.flag.deleteMany.mockRejectedValueOnce(new Error('fk'));
      expect((await readJson(await remove({ id: '7' }))).body.error).toMatch(/Failed to delete user records: fk/);

      prismaMock.user.delete.mockRejectedValueOnce(new Error('fk on user'));
      expect((await readJson(await remove({ id: '7' }))).status).toBe(500);
    });
  });
});

describe('/api/admin/categories', () => {
  test('GET paginates categories by name', async () => {
    prismaMock.lifestyleCategory.count.mockResolvedValue(12);
    prismaMock.lifestyleCategory.findMany.mockResolvedValue([{ id: 1, name: 'Sleep', description: null }]);
    const { status, body } = await readJson(await categories.GET(getRequest('/?page=2&limit=5')));
    expect(status).toBe(200);
    expect(body).toEqual({
      categories: [{ id: 1, name: 'Sleep', description: '' }],
      pagination: { total: 12, page: 2, limit: 5, pages: 3 },
    });
    expect(prismaMock.lifestyleCategory.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' }, skip: 5, take: 5 });
  });

  test('GET degrades to an empty list when the table is missing', async () => {
    prismaMock.lifestyleCategory.count.mockRejectedValueOnce(new Error('missing'));
    expect((await readJson(await categories.GET(getRequest('/')))).body.categories).toEqual([]);
    prismaMock.lifestyleCategory.count.mockResolvedValue(1);
    prismaMock.lifestyleCategory.findMany.mockRejectedValueOnce(new Error('missing'));
    expect((await readJson(await categories.GET(getRequest('/')))).body.categories).toEqual([]);
  });

  test('POST creates an active category; stores hostile names verbatim', async () => {
    prismaMock.lifestyleCategory.create.mockImplementation(async ({ data }) => ({ id: 9, ...data }));
    const { status, body } = await readJson(await categories.POST(jsonRequest('/', { name: XSS_PAYLOADS[1] })));
    expect(status).toBe(200);
    expect(body.category).toEqual({ id: 9, name: XSS_PAYLOADS[1], description: '' });
    expect(prismaMock.lifestyleCategory.create).toHaveBeenCalledWith({
      data: { name: XSS_PAYLOADS[1], description: '', is_active: true },
    });
  });

  test('PUT updates by numeric id', async () => {
    prismaMock.lifestyleCategory.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
    const request = jsonRequest('/', { id: '4', name: 'Noise', description: 'd' }, 'PUT');
    const { body } = await readJson(await categories.PUT(request));
    expect(body.category).toEqual({ id: 4, name: 'Noise', description: 'd' });
  });

  test('DELETE removes by numeric id', async () => {
    expect((await categories.DELETE(jsonRequest('/', { id: '4' }, 'DELETE'))).status).toBe(200);
    expect(prismaMock.lifestyleCategory.delete).toHaveBeenCalledWith({ where: { id: 4 } });
  });

  test.each([
    ['POST without name', () => categories.POST(jsonRequest('/', { description: 'x' }))],
    ['PUT without id', () => categories.PUT(jsonRequest('/', { name: 'x' }, 'PUT'))],
    ['DELETE without id', () => categories.DELETE(jsonRequest('/', {}, 'DELETE'))],
  ])('%s -> 400', async (_label, call) => {
    expect((await call()).status).toBe(400);
  });

  test.each([
    ['POST', () => categories.POST(jsonRequest('/', { name: 'x' })), 'create'],
    ['PUT', () => categories.PUT(jsonRequest('/', { id: 1, name: 'x' }, 'PUT')), 'update'],
    ['DELETE', () => categories.DELETE(jsonRequest('/', { id: 1 }, 'DELETE')), 'delete'],
  ] as const)('%s -> 500 on database errors', async (_label, call, method) => {
    prismaMock.lifestyleCategory[method].mockRejectedValue(new Error('db'));
    expect((await call()).status).toBe(500);
  });
});

describe('GET /api/admin/moderation-history', () => {
  test('returns the target user\'s actions, newest first, with admin names', async () => {
    prismaMock.moderationAction.findMany.mockResolvedValue([
      {
        id: 1,
        action: 'suspend',
        durationHours: 24,
        notes: 'n',
        flagId: 3,
        createdAt: new Date('2025-02-01T00:00:00Z'),
        adminUser: { email: 'admin@foo.com', profile: { firstName: 'Admin', lastName: 'User' } },
      },
      {
        id: 2,
        action: 'resolve',
        durationHours: null,
        notes: null,
        flagId: null,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        adminUser: { email: 'other@foo.com', profile: null },
      },
    ]);
    const { status, body } = await readJson(await moderationHistory.GET(getRequest('/?userId=7')));
    expect(status).toBe(200);
    expect(body.totalActions).toBe(2);
    expect(body.history.map((h: { adminName: string }) => h.adminName)).toEqual(['Admin User', 'other@foo.com']);
    expect(body.history[0].date).toBe('2025-02-01');
    expect(prismaMock.moderationAction.findMany.mock.calls[0][0]).toMatchObject({
      where: { targetUserId: 7 }, orderBy: { createdAt: 'desc' },
    });
  });

  test('requires userId; 500 on database errors', async () => {
    expect((await moderationHistory.GET(getRequest('/'))).status).toBe(400);
    prismaMock.moderationAction.findMany.mockRejectedValue(new Error('db'));
    expect((await moderationHistory.GET(getRequest('/?userId=7'))).status).toBe(500);
  });
});

describe('PUT /api/admin/profile', () => {
  const existing = {
    id: 'p1', firstName: 'Old', lastName: 'Name', bio: 'b', pronouns: 'they/them', photoUrl: null, name: 'Old Name',
  };

  test('updates provided fields and keeps the rest', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValue(existing);
    prismaMock.userProfile.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));
    await adminProfile.PUT(jsonRequest('/', { email: 'admin@foo.com', firstName: 'Kai', lastName: 'Akana' }, 'PUT'));
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { firstName: 'Kai', lastName: 'Akana', bio: 'b', pronouns: 'they/them', photoUrl: null, name: 'Kai Akana' },
    });
  });

  test('keeps the old full name when only one part is sent', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValue(existing);
    prismaMock.userProfile.update.mockResolvedValue(existing);
    await adminProfile.PUT(jsonRequest('/', { email: 'admin@foo.com', bio: 'new' }, 'PUT'));
    expect(prismaMock.userProfile.update.mock.calls[0][0].data.name).toBe('Old Name');
  });

  test('400 without email, 404 for unknown profile, 500 on errors', async () => {
    expect((await adminProfile.PUT(jsonRequest('/', {}, 'PUT'))).status).toBe(400);
    prismaMock.userProfile.findFirst.mockResolvedValueOnce(null);
    expect((await adminProfile.PUT(jsonRequest('/', { email: 'x' }, 'PUT'))).status).toBe(404);
    prismaMock.userProfile.findFirst.mockRejectedValueOnce(new Error('db'));
    expect((await adminProfile.PUT(jsonRequest('/', { email: 'x' }, 'PUT'))).status).toBe(500);
  });
});

describe('GET /api/admin/clear-expired-suspensions (cron)', () => {
  const cron = () => clearExpired.GET(getRequest('/', { authorization: 'Bearer cron-secret' }));

  beforeEach(() => {
    process.env.CRON_SECRET_KEY = 'cron-secret';
  });

  test('clears expired suspensions of active users', async () => {
    const until = new Date('2025-01-01T00:00:00Z');
    prismaMock.user.findMany.mockResolvedValue([{ id: 7, email: 'kai@hawaii.edu', suspendedUntil: until }]);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    const { status, body } = await readJson(await cron());
    expect(status).toBe(200);
    expect(body).toEqual({
      message: 'Cleared 1 expired suspensions',
      cleared: 1,
      clearedUsers: [{ id: 7, email: 'kai@hawaii.edu', wasSuspendedUntil: until.toISOString() }],
    });
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { suspendedUntil: { not: null, lt: expect.any(Date) }, active: true },
      data: { suspendedUntil: null },
    });
    delete process.env.CRON_SECRET_KEY;
  });

  test('does nothing when no suspension has expired; 500 on errors', async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    expect((await readJson(await cron())).body).toEqual({ message: 'No expired suspensions found', cleared: 0 });
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    prismaMock.user.findMany.mockRejectedValueOnce(new Error('db'));
    expect((await cron()).status).toBe(500);
    delete process.env.CRON_SECRET_KEY;
  });
});
