import { describe, expect, test } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  createMatch,
  createUser,
  getMatch,
  getMatchesByUserId,
  getProfileByEmail,
  getUserProfile,
  saveLifestyleSurvey,
  saveLifestyleSurveyAndMatch,
  updateMatchWithAI,
  updateUserProfile,
} from '@/lib/dbActions';
import { calculateCompatibility, calculateOverallScore } from '@/lib/compatibility';
import { prismaMock } from '../../helpers/prisma-mock';
import { makeProfile } from '../../helpers/factories';

const newUser = { email: 'kai@hawaii.edu', password: 'aloha123', firstName: 'Kēhau', lastName: 'ʻAkana' };

describe('createUser', () => {
  test('creates the user and profile in one transaction', async () => {
    prismaMock.user.create.mockResolvedValue({ id: 12 });
    prismaMock.userProfile.create.mockResolvedValue({});

    await createUser(newUser);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: { email: 'kai@hawaii.edu', password: expect.stringMatching(/^\$2b\$10\$/) },
    });
    expect(prismaMock.userProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 12,
        email: 'kai@hawaii.edu',
        firstName: 'Kēhau',
        lastName: 'ʻAkana',
        name: 'Kēhau ʻAkana',
      },
    });
  });

  test('a duplicate email (Prisma P2002 unique violation) becomes "Email already exists"', async () => {
    prismaMock.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['email'] } },
    ));
    await expect(createUser(newUser)).rejects.toThrow('Email already exists');
    expect(prismaMock.userProfile.create).not.toHaveBeenCalled();
  });

  test('other database errors are passed through', async () => {
    prismaMock.user.create.mockRejectedValue(new Error('connection reset'));
    await expect(createUser(newUser)).rejects.toThrow('connection reset');
  });
});

describe('updateUserProfile', () => {
  test('updates the profile of the user with that email and rebuilds the full name', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 3 });
    await updateUserProfile('kai@hawaii.edu', { firstName: 'Kai', lastName: 'Akana', major: 'ICS' });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'kai@hawaii.edu' } });
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({
      where: { userId: 3 },
      data: { firstName: 'Kai', lastName: 'Akana', major: 'ICS', name: 'Kai Akana' },
    });
  });

  test('leaves name alone when only one name part changes', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 3 });
    await updateUserProfile('kai@hawaii.edu', { firstName: 'Kai' });
    expect(prismaMock.userProfile.update.mock.calls[0][0].data).toEqual({ firstName: 'Kai' });
  });

  test('throws for an unknown email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(updateUserProfile('ghost@hawaii.edu', { bio: 'x' })).rejects.toThrow('User not found');
    expect(prismaMock.userProfile.update).not.toHaveBeenCalled();
  });
});

describe('profile and match lookups', () => {
  test('getProfileByEmail returns the included profile, or undefined', async () => {
    const profile = makeProfile();
    prismaMock.user.findUnique.mockResolvedValueOnce({ profile }).mockResolvedValueOnce(null);
    await expect(getProfileByEmail('a@hawaii.edu')).resolves.toBe(profile);
    await expect(getProfileByEmail('b@hawaii.edu')).resolves.toBeUndefined();
    expect(prismaMock.user.findUnique)
      .toHaveBeenCalledWith({ where: { email: 'a@hawaii.edu' }, include: { profile: true } });
  });

  test('getUserProfile looks up by profile id', async () => {
    await getUserProfile('profile-1');
    expect(prismaMock.userProfile.findUnique).toHaveBeenCalledWith({ where: { id: 'profile-1' } });
  });

  test('getMatch includes both profiles', async () => {
    await getMatch('m1');
    expect(prismaMock.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'm1' },
      include: { user1: true, user2: true },
    });
  });

  test('getMatchesByUserId finds matches on either side, newest first, with users for role filtering', async () => {
    await getMatchesByUserId('p1');
    expect(prismaMock.match.findMany).toHaveBeenCalledWith({
      where: { OR: [{ user1Id: 'p1' }, { user2Id: 'p1' }] },
      include: { user1: { include: { user: true } }, user2: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('createMatch', () => {
  test('scores the two profiles and stores a pending match', async () => {
    const a = makeProfile({ id: 'a', noiseLevel: 10 });
    const b = makeProfile({ id: 'b', noiseLevel: 70 });
    prismaMock.userProfile.findUnique.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    prismaMock.match.create.mockResolvedValue({ id: 'm1' });

    await expect(createMatch('a', 'b')).resolves.toEqual({ id: 'm1' });

    const categoryScores = calculateCompatibility(a, b);
    expect(prismaMock.match.create).toHaveBeenCalledWith({
      data: {
        user1Id: 'a',
        user2Id: 'b',
        overallScore: calculateOverallScore(categoryScores),
        categoryScores,
        status: 'pending',
        icebreakers: [],
      },
    });
  });

  test('throws when either profile is missing', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValueOnce(makeProfile()).mockResolvedValueOnce(null);
    await expect(createMatch('a', 'missing')).rejects.toThrow('User profiles not found');
    expect(prismaMock.match.create).not.toHaveBeenCalled();
  });
});

test('updateMatchWithAI stores the report and icebreakers', async () => {
  await updateMatchWithAI('m1', 'report', ['q1', 'q2']);
  expect(prismaMock.match.update).toHaveBeenCalledWith({
    where: { id: 'm1' },
    data: { compatibilityReport: 'report', icebreakers: ['q1', 'q2'], updatedAt: expect.any(Date) },
  });
});

describe('saveLifestyleSurvey', () => {
  const survey = {
    sleepSchedule: 'early-bird',
    noiseTolerance: 35,
    cleanliness: 'very-clean',
    studyHabits: 'quiet-study',
    socialLevel: 'private',
    guestPolicy: 'no-guests',
  };

  test.each([
    ['early bird / very clean / private / no guests', survey,
      { sleepSchedule: 1, cleanliness: 5, noiseLevel: 35, socialLevel: 1, guestFrequency: 1 }],
    ['night owl / very dirty / very social / frequent guests', {
      ...survey,
      sleepSchedule: 'night-owl',
      cleanliness: 'very-dirty',
      socialLevel: 'very-social',
      guestPolicy: 'frequent-guests',
      noiseTolerance: 100,
    }, { sleepSchedule: 5, cleanliness: 1, noiseLevel: 100, socialLevel: 4, guestFrequency: 4 }],
    ['neutral answers', {
      ...survey,
      sleepSchedule: 'unknown',
      cleanliness: 'neither',
      socialLevel: 'mixed',
      guestPolicy: 'occasional-guests',
      noiseTolerance: 0,
    }, { sleepSchedule: 3, cleanliness: 3, noiseLevel: 0, socialLevel: 3, guestFrequency: 3 }],
    ['unrecognised / malicious answers fall back to the middle', {
      ...survey, sleepSchedule: "'; DROP TABLE", cleanliness: '<script>', socialLevel: '', guestPolicy: 'x',
    }, { sleepSchedule: 3, cleanliness: 3, noiseLevel: 35, socialLevel: 3, guestFrequency: 3 }],
  ])('maps %s to the numeric columns', async (_label, input, expected) => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 4, profile: {} });
    prismaMock.userProfile.update.mockResolvedValue({ id: 'p4' });

    await saveLifestyleSurvey('kai@hawaii.edu', input);

    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({ where: { userId: 4 }, data: expected });
  });

  test('throws for an unknown user', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(saveLifestyleSurvey('ghost@hawaii.edu', survey)).rejects.toThrow('User not found');
  });

  test('saveLifestyleSurveyAndMatch saves the answers, then generates matches', async () => {
    const profile = makeProfile({ id: 'p4', userId: 4 });
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 4, profile }) // saveLifestyleSurvey
      .mockResolvedValueOnce({ id: 4 }); // id lookup
    prismaMock.userProfile.update.mockResolvedValue(profile);
    prismaMock.userProfile.findUnique.mockResolvedValue(profile); // generateMatchesForUser
    prismaMock.userProfile.findMany.mockResolvedValue([makeProfile({ id: 'other' })]);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.match.create.mockResolvedValue({ id: 'm1' });

    await expect(saveLifestyleSurveyAndMatch('kai@hawaii.edu', survey)).resolves.toBe(profile);
    expect(prismaMock.match.create).toHaveBeenCalledTimes(1);
  });

  test('saveLifestyleSurveyAndMatch throws if the user disappears after saving', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 4, profile: {} }).mockResolvedValueOnce(null);
    prismaMock.userProfile.update.mockResolvedValue({});
    await expect(saveLifestyleSurveyAndMatch('kai@hawaii.edu', survey)).rejects.toThrow('User not found');
  });
});
