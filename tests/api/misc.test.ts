import { beforeEach, describe, expect, test } from 'vitest';
import * as flags from '@/app/api/flags/route';
import * as lifestyleSurvey from '@/app/api/lifestyle-survey/route';
import * as lifestyleCategories from '@/app/api/lifestyle/categories/route';
import * as notificationRead from '@/app/api/notifications/[id]/read/route';
import * as notificationDelete from '@/app/api/notifications/delete/route';
import * as notifications from '@/app/api/notifications/route';
import * as reportsStatus from '@/app/api/reports/status/route';
import * as usersSearch from '@/app/api/users/search/route';
import { prismaMock } from '../helpers/prisma-mock';
import { adminSession, signInAs, studentSession } from '../helpers/sessions';
import { getRequest, jsonRequest, readJson, routeParams } from '../helpers/requests';
import {
  LIKE_WILDCARDS, OVERSIZED_STRINGS, SQL_INJECTION_PAYLOADS, XSS_PAYLOADS,
} from '../fixtures/malicious-inputs';

beforeEach(() => {
  signInAs(studentSession);
});

describe('POST /api/flags (report a user)', () => {
  const report = (body: unknown) => flags.POST(jsonRequest('/', body));

  test('creates a pending flag from the signed-in reporter', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.flag.findFirst.mockResolvedValue(null);
    prismaMock.flag.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    const { status, body } = await readJson(await report({ reportedUserId: '7', reason: '[Spam/scam] links' }));
    expect(status).toBe(201);
    expect(prismaMock.flag.create).toHaveBeenCalledWith({
      data: { reported_by_user_id: 5, reported_user_id: 7, reason: '[Spam/scam] links', status: 'pending' },
    });
    expect(body.flag.reported_by_user_id).toBe(5);
  });

  test('a student with a pending report on the same user gets 409', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.flag.findFirst.mockResolvedValue({ id: 1 });
    expect((await report({ reportedUserId: 7, reason: 'again' })).status).toBe(409);
    expect(prismaMock.flag.findFirst).toHaveBeenCalledWith({
      where: { reported_by_user_id: 5, reported_user_id: 7, status: 'pending' },
    });
    expect(prismaMock.flag.create).not.toHaveBeenCalled();
  });

  test('admins skip the duplicate check', async () => {
    signInAs(adminSession);
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.flag.create.mockResolvedValue({ id: 2 });
    expect((await report({ reportedUserId: 7, reason: 'repeat offence' })).status).toBe(201);
    expect(prismaMock.flag.findFirst).not.toHaveBeenCalled();
  });

  test.each([
    ['missing reason', { reportedUserId: 7 }, 400],
    ['missing user', { reason: 'x' }, 400],
    ['whitespace reason', { reportedUserId: 7, reason: '   ' }, 400],
    ['non-string reason', { reportedUserId: 7, reason: { $ne: null } }, 400],
    ['negative id', { reportedUserId: -7, reason: 'x' }, 400],
    ['SQL-injection id', { reportedUserId: '7 OR 1=1', reason: 'x' }, 400],
    ['self-report', { reportedUserId: 5, reason: 'x' }, 400],
  ])('%s -> %i', async (_label, body, status) => {
    expect((await report(body)).status).toBe(status);
    expect(prismaMock.flag.create).not.toHaveBeenCalled();
  });

  test.each([...XSS_PAYLOADS])('stores reason %j verbatim', async (reason) => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.flag.findFirst.mockResolvedValue(null);
    prismaMock.flag.create.mockResolvedValue({ id: 1 });
    await report({ reportedUserId: 7, reason });
    expect(prismaMock.flag.create.mock.calls[0][0].data.reason).toBe(reason);
  });

  test('404 for an unknown user, 500 on errors', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await report({ reportedUserId: 99, reason: 'x' })).status).toBe(404);
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error('db'));
    expect((await report({ reportedUserId: 99, reason: 'x' })).status).toBe(500);
  });
});

describe('notifications', () => {
  const row = {
    id: 3, user_id: 5, type: 'report_action', content: 'Thanks', is_read: false, created_at: new Date('2025-01-01'),
  };

  test('GET returns the caller\'s 20 newest notifications', async () => {
    prismaMock.notification.findMany.mockResolvedValue([row]);
    const { status, body } = await readJson(await notifications.GET());
    expect(status).toBe(200);
    expect(body.notifications).toEqual([{
      id: 3, type: 'report_action', content: 'Thanks', is_read: false, created_at: '2025-01-01T00:00:00.000Z',
    }]);
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
      where: { user_id: 5 }, orderBy: { created_at: 'desc' }, take: 20,
    });
    prismaMock.notification.findMany.mockRejectedValue(new Error('db'));
    expect((await notifications.GET()).status).toBe(500);
  });

  describe.each([
    ['PATCH [id]/read',
      (id: number | string) => notificationRead.PATCH(getRequest('/'), routeParams({ id: String(id) })),
      'update'],
    ['POST delete',
      (id: number | string) => notificationDelete.POST(jsonRequest('/', { notificationId: id })), 'delete'],
  ] as const)('%s', (_name, call, method) => {
    test('works on the caller\'s own notification', async () => {
      prismaMock.notification.findUnique.mockResolvedValue(row);
      prismaMock.notification.update.mockResolvedValue({ ...row, is_read: true });
      expect((await call(3)).status).toBe(200);
      expect(prismaMock.notification[method]).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }));
    });

    test('refuses another user\'s notification with 403', async () => {
      prismaMock.notification.findUnique.mockResolvedValue({ ...row, user_id: 9 });
      expect((await call(3)).status).toBe(403);
      expect(prismaMock.notification[method]).not.toHaveBeenCalled();
    });

    test('404 when missing, 500 on errors', async () => {
      prismaMock.notification.findUnique.mockResolvedValueOnce(null);
      expect((await call(3)).status).toBe(404);
      prismaMock.notification.findUnique.mockRejectedValueOnce(new Error('db'));
      expect((await call(3)).status).toBe(500);
    });
  });

  test.each(['abc', '0', '-1'])('read rejects id %j with 400', async (id) => {
    expect((await notificationRead.PATCH(getRequest('/'), routeParams({ id }))).status).toBe(400);
  });

  test.each([
    ['string id', '3'],
    ['missing id', undefined],
    ['zero', 0],
  ])('delete rejects %s with 400', async (_l, id) => {
    expect((await notificationDelete.POST(jsonRequest('/', { notificationId: id }))).status).toBe(400);
  });
});

test('GET /api/reports/status lists only the caller\'s reports', async () => {
  prismaMock.flag.findMany.mockResolvedValue([
    {
      id: 1,
      reported_user_id: 7,
      reported_user: { profile: { name: 'Kai' } },
      reason: 'r',
      status: 'pending',
      created_at: new Date(0),
    },
    {
      id: 2, reported_user_id: 8, reported_user: null, reason: 'r', status: 'resolved', created_at: new Date(0),
    },
  ]);
  const { status, body } = await readJson(await reportsStatus.GET());
  expect(status).toBe(200);
  expect(body.reports.map((r: { reportedUserName: string }) => r.reportedUserName)).toEqual(['Kai', 'Unknown User']);
  expect(prismaMock.flag.findMany.mock.calls[0][0].where).toEqual({ reported_by_user_id: 5 });
  prismaMock.flag.findMany.mockRejectedValue(new Error('db'));
  expect((await reportsStatus.GET()).status).toBe(500);
});

describe('POST /api/lifestyle-survey', () => {
  const survey = {
    sleepSchedule: 'night-owl',
    noiseTolerance: 0,
    cleanliness: 'very-clean',
    studyHabits: 'quiet-study',
    socialLevel: 'private',
    guestPolicy: 'no-guests',
  };

  test('saves the caller\'s answers and generates matches', async () => {
    const profile = { id: 'p5', userId: 5, name: 'John' };
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 5, profile }).mockResolvedValueOnce({ id: 5 });
    prismaMock.userProfile.update.mockResolvedValue(profile);
    prismaMock.userProfile.findUnique.mockResolvedValue(profile);
    prismaMock.userProfile.findMany.mockResolvedValue([]);
    const { status, body } = await readJson(await lifestyleSurvey.POST(jsonRequest('/', survey)));
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, profile });
    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({ email: 'john@foo.com' });
  });

  test.each(Object.keys(survey))('rejects a survey missing %s', async (field) => {
    const partial: Record<string, unknown> = { ...survey };
    delete partial[field];
    expect((await lifestyleSurvey.POST(jsonRequest('/', partial))).status).toBe(400);
  });

  test('reports save failures as 500 with the error message', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await readJson(await lifestyleSurvey.POST(jsonRequest('/', survey))))
      .toEqual({ status: 500, body: { error: 'User not found' } });
  });
});

test('GET /api/lifestyle/categories is public and returns active categories only', async () => {
  signInAs(null);
  prismaMock.lifestyleCategory.findMany.mockResolvedValue([{ id: 1, name: 'Sleep', description: 'd' }]);
  const response = await lifestyleCategories.GET();
  expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
  expect((await response.json()).categories).toHaveLength(1);
  expect(prismaMock.lifestyleCategory.findMany).toHaveBeenCalledWith({
    where: { is_active: true }, select: { id: true, name: true, description: true }, orderBy: { name: 'asc' },
  });
  prismaMock.lifestyleCategory.findMany.mockRejectedValue(new Error('missing table'));
  expect((await readJson(await lifestyleCategories.GET())).body).toEqual({ categories: [] });
});

describe('GET /api/users/search', () => {
  const search = (q: string) => usersSearch.GET(getRequest(`/api/users/search?q=${encodeURIComponent(q)}`));

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 });
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  test('searches other active, unsuspended users case-insensitively, at most 20', async () => {
    await search('kai');
    const { where, take, select } = prismaMock.user.findMany.mock.calls[0][0];
    expect(take).toBe(20);
    expect(select).not.toHaveProperty('password');
    expect(where.AND[0]).toEqual({ id: { not: 5 } });
    expect(where.AND[1]).toEqual({ active: true });
    expect(where.AND[2]).toEqual({ OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: expect.any(Date) } }] });
    expect(where.AND[3].OR).toContainEqual({ email: { contains: 'kai', mode: 'insensitive' } });
    expect(where.AND[3].OR).toContainEqual({ profile: { name: { contains: 'kai', mode: 'insensitive' } } });
  });

  test.each([...SQL_INJECTION_PAYLOADS, ...XSS_PAYLOADS])('query %j is passed to Prisma only as a value', async (q) => {
    expect((await search(q)).status).toBe(200);
    const { OR } = prismaMock.user.findMany.mock.calls[0][0].where.AND[3];
    OR.forEach((condition: object) => expect(JSON.stringify(condition)).toContain(JSON.stringify(q).slice(1, -1)));
  });

  test.each(['', '   '])('blank query %j returns no users without searching', async (q) => {
    expect((await readJson(await search(q))).body).toEqual({ users: [] });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  test('an oversized query is handled', async () => {
    expect((await search(OVERSIZED_STRINGS.tenKilobytes)).status).toBe(200);
  });

  test('formats results and hides majors of admins', async () => {
    const emptyProfile = { firstName: null, lastName: null, name: null, photoUrl: null, major: null, bio: null };
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 1,
        email: 'admin@foo.com',
        role: 'ADMIN',
        profile: { ...emptyProfile, firstName: 'Ad', lastName: 'Min', major: 'X' },
      },
      {
        id: 2,
        email: 'kai@hawaii.edu',
        role: 'USER',
        profile: { ...emptyProfile, name: 'Kai A', photoUrl: 'p', major: 'ICS', bio: 'b' },
      },
      { id: 3, email: 'solo@hawaii.edu', role: 'USER', profile: { ...emptyProfile, firstName: 'Solo' } },
      { id: 4, email: 'lani@hawaii.edu', role: 'USER', profile: emptyProfile },
      { id: 5, email: 'noprofile@hawaii.edu', role: 'USER', profile: null },
    ]);
    const { body } = await readJson(await search('a'));
    expect(body.users.map((u: { name: string }) => u.name))
      .toEqual(['Ad Min', 'Kai A', 'Solo', 'Unknown User', 'Noprofile']);
    expect(body.users[0].major).toBeNull();
    expect(body.users[1]).toMatchObject({ major: 'ICS', photoUrl: 'p', bio: 'b' });
  });

  test('404 when the session user is unknown, 500 on errors', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await search('a')).status).toBe(404);
    prismaMock.user.findMany.mockRejectedValueOnce(new Error('db'));
    expect((await search('a')).status).toBe(500);
  });

  // LIKE wildcards are checked against the real database in tests/integration/prisma.test.ts
  test.each([...LIKE_WILDCARDS])('wildcard %j is passed through as a value', async (q) => {
    await search(q);
    expect(prismaMock.user.findMany.mock.calls[0][0].where.AND[3].OR[0]).toEqual({
      email: { contains: q, mode: 'insensitive' },
    });
  });
});
