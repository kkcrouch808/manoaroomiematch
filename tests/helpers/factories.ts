import type { Match, UserProfile } from '@prisma/client';

let counter = 0;

/** A complete UserProfile row with neutral defaults (matches schema.prisma defaults). */
export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  counter += 1;
  return {
    id: `profile-${counter}`,
    userId: counter,
    name: `User ${counter}`,
    firstName: 'User',
    lastName: `${counter}`,
    pronouns: null,
    bio: null,
    email: `user${counter}@hawaii.edu`,
    photoUrl: null,
    major: null,
    classStanding: null,
    graduationYear: null,
    needRoommateBy: null,
    instagram: null,
    snapchat: null,
    hometown: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    housingType: null,
    preferredDorm: null,
    specificBuilding: null,
    budget: null,
    sleepSchedule: 3,
    cleanliness: 3,
    noiseLevel: 3,
    socialLevel: 3,
    guestFrequency: 3,
    temperature: 3,
    smoking: false,
    drinking: 'occasionally',
    pets: false,
    petTypes: [],
    dietary: [],
    interests: [],
    workSchedule: 'day',
    preferences: {},
    ...overrides,
  };
}

export function makeMatch(user1: UserProfile, user2: UserProfile, overrides: Partial<Match> = {}): Match {
  return {
    id: `match-${user1.id}-${user2.id}`,
    user1Id: user1.id,
    user2Id: user2.id,
    overallScore: 80,
    categoryScores: {
      sleepCompatibility: 100,
      cleanlinessCompatibility: 75,
      socialCompatibility: 50,
      lifestyleCompatibility: 90,
      interestsCompatibility: 100,
    },
    compatibilityReport: null,
    icebreakers: [],
    status: 'pending',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    email: 'john@foo.com',
    password: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva',
    role: 'USER',
    active: true,
    suspendedUntil: null as Date | null,
    suspensionCount: 0,
    lastLogin: null,
    ...overrides,
  };
}
