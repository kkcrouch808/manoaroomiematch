import { describe, expect, test } from 'vitest';
import {
  deleteMatchesForUser,
  generateAllMatches,
  generateMatchesForUser,
  getMatchStats,
  handleUserProfileComplete,
  regenerateMatchesForUser,
} from '@/lib/matchGeneration';
import { calculateCompatibility, calculateOverallScore } from '@/lib/compatibility';
import { prismaMock } from '../../helpers/prisma-mock';
import { makeMatch, makeProfile } from '../../helpers/factories';

const me = makeProfile({ id: 'me', userId: 1, name: 'Me', noiseLevel: 30 });
const alice = makeProfile({ id: 'alice', userId: 2, name: 'Alice', noiseLevel: 90 });
const bob = makeProfile({ id: 'bob', userId: 3, name: 'Bob', noiseLevel: 30 });

describe.each([
  ['generateMatchesForUser', generateMatchesForUser],
  ['regenerateMatchesForUser', regenerateMatchesForUser],
  ['deleteMatchesForUser', deleteMatchesForUser],
  ['getMatchStats', getMatchStats],
])('%s without a profile', (_name, fn) => {
  test('throws a descriptive error', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(null);
    await expect((fn as (id: number) => Promise<unknown>)(42))
      .rejects.toThrow('User profile not found for user ID: 42');
    expect(prismaMock.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 42 } });
  });
});

describe('generateMatchesForUser', () => {
  test('creates one scored, pending match per other user and excludes the user themself', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.userProfile.findMany.mockResolvedValue([alice, bob]);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create.mockImplementation(async ({ data }) => ({ id: `m-${data.user2Id}`, ...data }));

    const ids = await generateMatchesForUser(1);

    expect(ids).toEqual(['m-alice', 'm-bob']);
    expect(prismaMock.userProfile.findMany).toHaveBeenCalledWith({ where: { userId: { not: 1 } } });
    const aliceScores = calculateCompatibility(me, alice);
    expect(prismaMock.match.create).toHaveBeenCalledWith({
      data: {
        user1Id: 'me',
        user2Id: 'alice',
        overallScore: calculateOverallScore(aliceScores),
        categoryScores: aliceScores,
        status: 'pending',
        icebreakers: [],
      },
    });
  });

  test('checks both directions for an existing match and skips duplicates', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.userProfile.findMany.mockResolvedValue([alice, bob]);
    prismaMock.match.findFirst
      .mockResolvedValueOnce(makeMatch(alice, me)) // alice -> me already exists
      .mockResolvedValueOnce(null);
    prismaMock.match.create.mockResolvedValue({ id: 'm-bob' });

    const ids = await generateMatchesForUser(1);

    expect(ids).toEqual(['m-bob']);
    expect(prismaMock.match.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          { user1Id: 'me', user2Id: 'alice' },
          { user1Id: 'alice', user2Id: 'me' },
        ],
      },
    });
    expect(prismaMock.match.create).toHaveBeenCalledTimes(1);
  });

  test('keeps going when creating one match fails', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.userProfile.findMany.mockResolvedValue([alice, bob]);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create
      .mockRejectedValueOnce(new Error('unique constraint'))
      .mockResolvedValueOnce({ id: 'm-bob' });

    await expect(generateMatchesForUser(1)).resolves.toEqual(['m-bob']);
  });

  test('returns an empty list when there is nobody else', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.userProfile.findMany.mockResolvedValue([]);
    await expect(generateMatchesForUser(1)).resolves.toEqual([]);
    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });
});

describe('regenerateMatchesForUser', () => {
  test('recomputes the score of every match the user is in, from either side', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.match.findMany.mockResolvedValue([
      { ...makeMatch(me, alice, { id: 'm1' }), user1: me, user2: alice },
      { ...makeMatch(bob, me, { id: 'm2' }), user1: bob, user2: me },
    ]);
    prismaMock.match.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('row locked'));

    await expect(regenerateMatchesForUser(1)).resolves.toBe(1);

    expect(prismaMock.match.findMany).toHaveBeenCalledWith({
      where: { OR: [{ user1Id: 'me' }, { user2Id: 'me' }] },
      include: { user1: true, user2: true },
    });
    const expectedScores = calculateCompatibility(me, alice);
    expect(prismaMock.match.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'm1' },
      data: {
        overallScore: calculateOverallScore(expectedScores),
        categoryScores: expectedScores,
        updatedAt: expect.any(Date),
      },
    });
    // Second match: current user is user2, so scores are computed me-vs-bob
    expect(prismaMock.match.update.mock.calls[1][0].data.categoryScores).toEqual(calculateCompatibility(me, bob));
  });
});

describe('generateAllMatches', () => {
  test('generates for every user with a profile and counts errors', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 1, email: 'me@hawaii.edu', profile: me },
      { id: 2, email: 'noprofile@hawaii.edu', profile: null },
      { id: 3, email: 'broken@hawaii.edu', profile: bob },
    ]);
    // user 1: profile found, one match created; user 3: profile lookup fails -> error
    prismaMock.userProfile.findUnique
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce(null);
    prismaMock.userProfile.findMany.mockResolvedValue([alice]);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create.mockResolvedValue({ id: 'm1' });

    await expect(generateAllMatches()).resolves.toEqual({ totalUsers: 3, matchesCreated: 1, errors: 1 });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({ include: { profile: true } });
  });
});

describe('deleteMatchesForUser', () => {
  test('deletes matches where the user is on either side', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.match.deleteMany.mockResolvedValue({ count: 4 });

    await expect(deleteMatchesForUser(1)).resolves.toBe(4);
    expect(prismaMock.match.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ user1Id: 'me' }, { user2Id: 'me' }] },
    });
  });
});

describe('getMatchStats', () => {
  test('buckets scores at the 60 and 80 boundaries and averages them', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.match.findMany.mockResolvedValue(
      [59, 60, 79, 80, 100].map((overallScore) => ({ overallScore })),
    );

    await expect(getMatchStats(1)).resolves.toEqual({
      totalMatches: 5,
      highMatches: 2, // 80, 100
      mediumMatches: 2, // 60, 79
      lowMatches: 1, // 59
      averageScore: 76, // 378 / 5 = 75.6
    });
  });

  test('reports an average of 0 when there are no matches', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.match.findMany.mockResolvedValue([]);
    await expect(getMatchStats(1)).resolves.toMatchObject({ totalMatches: 0, averageScore: 0 });
  });
});

describe('handleUserProfileComplete', () => {
  test('new users get fresh matches', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.userProfile.findMany.mockResolvedValue([alice]);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create.mockResolvedValue({ id: 'm1' });
    prismaMock.match.findMany.mockResolvedValue([{ overallScore: 90 }]);

    const result = await handleUserProfileComplete(1, true);

    expect(result).toEqual({
      matchesCreated: 1,
      matchesUpdated: 0,
      stats: { totalMatches: 1, highMatches: 1, mediumMatches: 0, lowMatches: 0, averageScore: 90 },
    });
  });

  test('existing users (the default) have their matches regenerated', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(me);
    prismaMock.match.findMany
      .mockResolvedValueOnce([{ ...makeMatch(me, alice), user1: me, user2: alice }])
      .mockResolvedValueOnce([{ overallScore: 50 }]);
    prismaMock.match.update.mockResolvedValue({});

    const result = await handleUserProfileComplete(1);

    expect(result.matchesCreated).toBe(0);
    expect(result.matchesUpdated).toBe(1);
    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });
});
