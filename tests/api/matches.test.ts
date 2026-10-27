import { beforeEach, describe, expect, test } from 'vitest';
import * as aiReport from '@/app/api/matches/[matchId]/ai-report/route';
import * as comparison from '@/app/api/matches/[matchId]/comparison/route';
import * as matchDetail from '@/app/api/matches/[matchId]/route';
import * as generate from '@/app/api/matches/generate/route';
import * as matches from '@/app/api/matches/route';
import { prismaMock } from '../helpers/prisma-mock';
import { adminSession, signInAs, studentSession } from '../helpers/sessions';
import { getRequest, jsonRequest, readJson, routeParams } from '../helpers/requests';
import { makeMatch, makeProfile } from '../helpers/factories';

const me = makeProfile({ id: 'p5', userId: 5, email: 'john@foo.com', sleepSchedule: 1, interests: ['Surfing'] });
const kai = makeProfile({ id: 'p7', userId: 7, sleepSchedule: 5 });
const stranger = makeProfile({ id: 'p9', userId: 9 });

beforeEach(() => {
  signInAs(studentSession);
});

describe('GET /api/matches', () => {
  test('returns the caller\'s matches without any that involve an admin', async () => {
    const adminProfile = makeProfile({ id: 'pa' });
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.match.findMany.mockResolvedValue([
      {
        ...makeMatch(me, kai, { id: 'm1' }),
        user1: { ...me, user: { role: 'USER' } },
        user2: { ...kai, user: { role: 'USER' } },
      },
      {
        ...makeMatch(me, adminProfile, { id: 'm2' }),
        user1: { ...me, user: { role: 'USER' } },
        user2: { ...adminProfile, user: { role: 'ADMIN' } },
      },
    ]);

    const { status, body } = await readJson(await matches.GET());

    expect(status).toBe(200);
    expect(body.currentProfileId).toBe('p5');
    expect(body.matches.map((m: { id: string }) => m.id)).toEqual(['m1']);
    expect(prismaMock.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 5 } });
  });

  test.each([
    ['non-numeric session id', { ...studentSession, user: { ...studentSession.user, id: 'abc' } }, 400],
    ['session id missing', { ...studentSession, user: { ...studentSession.user, id: '' } }, 401],
  ])('%s -> %i', async (_label, session, status) => {
    signInAs(session);
    expect((await matches.GET()).status).toBe(status);
  });

  test('404 without a profile, 500 on errors', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValueOnce(null);
    expect((await matches.GET()).status).toBe(404);
    prismaMock.userProfile.findUnique.mockRejectedValueOnce(new Error('db'));
    expect((await matches.GET()).status).toBe(500);
  });
});

describe('GET /api/matches/[matchId]', () => {
  const get = (matchId = 'm1') => matchDetail.GET(getRequest('/'), routeParams({ matchId }));

  test('a participant gets the comparison with highlights from their own point of view', async () => {
    prismaMock.match.findUnique.mockResolvedValue({
      ...makeMatch(kai, me, {
        id: 'm1',
        categoryScores: {
          sleepCompatibility: 40,
          cleanlinessCompatibility: 100,
          socialCompatibility: 70,
          lifestyleCompatibility: 80,
          interestsCompatibility: 100,
        },
      }),
      user1: kai,
      user2: me,
    });
    prismaMock.userProfile.findFirst.mockResolvedValue(me);

    const { status, body } = await readJson(await get());

    expect(status).toBe(200);
    expect(body.currentUser.id).toBe('p5');
    expect(body.matchUser.id).toBe('p7');
    expect(body.compatibleTraits).toContain('Aligned on cleanliness: Moderate');
    expect(body.conflicts).toContain('Different sleep schedule: Early Bird vs Night Owl');
  });

  test('a student who is not in the match gets 403', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...makeMatch(kai, stranger), user1: kai, user2: stranger });
    prismaMock.userProfile.findFirst.mockResolvedValue(me);
    const { status, body } = await readJson(await get());
    expect(status).toBe(403);
    expect(body).not.toHaveProperty('matchUser');
  });

  test.each([
    ['the match does not exist', () => prismaMock.match.findUnique.mockResolvedValue(null), 404],
    ['the caller has no profile', () => {
      prismaMock.match.findUnique.mockResolvedValue({ ...makeMatch(me, kai), user1: me, user2: kai });
      prismaMock.userProfile.findFirst.mockResolvedValue(null);
    }, 404],
    ['a profile on the match is missing', () => {
      prismaMock.match.findUnique.mockResolvedValue({ ...makeMatch(me, kai), user1: me, user2: null });
      prismaMock.userProfile.findFirst.mockResolvedValue(me);
    }, 500],
    ['the database fails', () => prismaMock.match.findUnique.mockRejectedValue(new Error('db')), 500],
  ])('%s -> %i', async (_label, arrange, status) => {
    arrange();
    expect((await get()).status).toBe(status);
  });
});

describe('GET /api/matches/[matchId]/comparison', () => {
  const get = (query: string) => comparison.GET(getRequest(`/${query}`), routeParams({ matchId: 'm1' }));

  test('orients the comparison around the userId in the query', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...makeMatch(me, kai), user1: me, user2: kai });
    expect((await readJson(await get('?userId=p7'))).body.currentUser.id).toBe('p7');
    expect((await readJson(await get('?userId=p5'))).body.currentUser.id).toBe('p5');
  });

  test('400 without userId, 404 for unknown match, 500 on errors', async () => {
    expect((await get('')).status).toBe(400);
    prismaMock.match.findUnique.mockResolvedValueOnce(null);
    expect((await get('?userId=p5')).status).toBe(404);
    prismaMock.match.findUnique.mockRejectedValueOnce(new Error('db'));
    expect((await get('?userId=p5')).status).toBe(500);
  });
});

describe('POST /api/matches/[matchId]/ai-report', () => {
  const post = () => aiReport.POST(jsonRequest('/', {}), routeParams({ matchId: 'm1' }));

  test('stores placeholder report text and three icebreakers', async () => {
    prismaMock.match.findUnique.mockResolvedValue({ ...makeMatch(me, kai), user1: me, user2: kai });
    const { status, body } = await readJson(await post());
    expect(status).toBe(200);
    expect(body.icebreakers).toHaveLength(3);
    expect(prismaMock.match.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { compatibilityReport: body.report, icebreakers: body.icebreakers, updatedAt: expect.any(Date) },
    });
  });

  test('404 for unknown match, 500 on errors', async () => {
    prismaMock.match.findUnique.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(404);
    prismaMock.match.findUnique.mockRejectedValueOnce(new Error('db'));
    expect((await post()).status).toBe(500);
  });
});

describe('POST /api/matches/generate', () => {
  const run = (action?: string) => generate.POST(jsonRequest('/', action ? { action } : {}));

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5, email: 'john@foo.com', profile: me });
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
  });

  test('generate: creates matches for the caller and returns stats', async () => {
    prismaMock.userProfile.findMany.mockResolvedValue([kai]);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create.mockResolvedValue({ id: 'm1' });
    prismaMock.match.findMany.mockResolvedValue([{ overallScore: 85 }]);
    const { status, body } = await readJson(await run('generate'));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, matchesCreated: 1, stats: { totalMatches: 1, highMatches: 1 } });
    expect(prismaMock.userProfile.findMany).toHaveBeenCalledWith({ where: { userId: { not: 5 } } });
  });

  test('regenerate: updates the caller\'s matches', async () => {
    prismaMock.match.findMany
      .mockResolvedValueOnce([{ ...makeMatch(me, kai), user1: me, user2: kai }])
      .mockResolvedValueOnce([{ overallScore: 50 }]);
    expect((await readJson(await run('regenerate'))).body).toMatchObject({ matchesUpdated: 1 });
  });

  test('delete: removes the caller\'s matches', async () => {
    prismaMock.match.deleteMany.mockResolvedValue({ count: 2 });
    expect((await readJson(await run('delete'))).body).toMatchObject({ matchesDeleted: 2 });
  });

  test('stats: returns the caller\'s stats', async () => {
    prismaMock.match.findMany.mockResolvedValue([]);
    expect((await readJson(await run('stats'))).body.stats.totalMatches).toBe(0);
  });

  test('generate-all is allowed for admins', async () => {
    signInAs(adminSession);
    prismaMock.user.findMany.mockResolvedValue([]);
    expect((await readJson(await run('generate-all'))).body).toMatchObject({ success: true, totalUsers: 0 });
  });

  test.each([
    ['missing action', undefined, 400],
    ['unknown action', 'drop-everything', 400],
  ])('%s -> 400', async (_label, action, status) => {
    expect((await run(action)).status).toBe(status);
  });

  test('404 for an unknown session user, 500 with a message on errors', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    expect((await run('stats')).status).toBe(404);
    prismaMock.userProfile.findUnique.mockResolvedValue(null);
    const { status, body } = await readJson(await run('stats'));
    expect(status).toBe(500);
    expect(body.message).toBe('User profile not found for user ID: 5');
  });
});
