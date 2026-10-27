import { describe, expect, test } from 'vitest';
import { calculateCompatibility, calculateOverallScore } from '@/lib/compatibility';
import type { CategoryScores } from '@/types';
import { makeProfile } from '../../helpers/factories';

const scores = (overrides: Partial<CategoryScores> = {}): CategoryScores => ({
  sleepCompatibility: 0,
  cleanlinessCompatibility: 0,
  socialCompatibility: 0,
  lifestyleCompatibility: 0,
  interestsCompatibility: 0,
  ...overrides,
});

describe('calculateOverallScore', () => {
  test.each([
    ['all categories perfect', scores({
      sleepCompatibility: 100,
      cleanlinessCompatibility: 100,
      socialCompatibility: 100,
      lifestyleCompatibility: 100,
      interestsCompatibility: 100,
    }), 100],
    ['all categories zero', scores(), 0],
    ['sleep only (20%)', scores({ sleepCompatibility: 100 }), 20],
    ['cleanliness only (25%)', scores({ cleanlinessCompatibility: 100 }), 25],
    ['social only (15%)', scores({ socialCompatibility: 100 }), 15],
    ['noise only (20%)', scores({ lifestyleCompatibility: 100 }), 20],
    ['study only (20%)', scores({ interestsCompatibility: 100 }), 20],
    ['rounds to the nearest integer', scores({ socialCompatibility: 10 }), 2], // 1.5 -> 2
  ])('%s', (_label, input, expected) => {
    expect(calculateOverallScore(input)).toBe(expected);
  });

  test('weights sum to 100% so the score stays within 0-100', () => {
    const all = scores({
      sleepCompatibility: 73,
      cleanlinessCompatibility: 73,
      socialCompatibility: 73,
      lifestyleCompatibility: 73,
      interestsCompatibility: 73,
    });
    expect(calculateOverallScore(all)).toBe(73);
  });
});

describe('calculateCompatibility', () => {
  test('returns all five categories in the 0-100 range', () => {
    const result = calculateCompatibility(makeProfile(), makeProfile());
    expect(Object.keys(result).sort()).toEqual([
      'cleanlinessCompatibility', 'interestsCompatibility', 'lifestyleCompatibility',
      'sleepCompatibility', 'socialCompatibility',
    ]);
    Object.values(result).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    });
  });

  test('is symmetric (A vs B equals B vs A)', () => {
    const a = makeProfile({ noiseLevel: 20, socialLevel: 1, guestFrequency: 4 });
    const b = makeProfile({ noiseLevel: 90, socialLevel: 4, guestFrequency: 1 });
    expect(calculateCompatibility(a, b)).toEqual(calculateCompatibility(b, a));
  });

  describe('noise tolerance (stored as 0-100 in noiseLevel)', () => {
    test.each([
      ['identical', 40, 40, 100],
      ['20 apart', 20, 40, 90],
      ['60 apart', 20, 80, 70],
      ['maximum difference that avoids the 0 default', 1, 100, 50.5],
    ])('%s: %i vs %i -> %d', (_label, n1, n2, expected) => {
      const result = calculateCompatibility(makeProfile({ noiseLevel: n1 }), makeProfile({ noiseLevel: n2 }));
      expect(result.lifestyleCompatibility).toBe(expected);
    });

    // KNOWN BUG: `u.noiseLevel || 50` treats a real answer of 0 ("Not at all" tolerant, the slider minimum)
    // as 50, so the most noise-sensitive students look half as different from very tolerant ones.
    test.fails('a tolerance of 0 vs 100 gets the full 50-point penalty', () => {
      const result = calculateCompatibility(makeProfile({ noiseLevel: 0 }), makeProfile({ noiseLevel: 100 }));
      expect(result.lifestyleCompatibility).toBe(50);
    });
  });

  describe('social level and guest frequency', () => {
    test.each([
      ['same social level and guests', [3, 3], [3, 3], 100],
      ['one level apart on social only', [2, 3], [3, 3], 87.5],
      ['opposite on both (1 vs 4)', [1, 1], [4, 4], 25],
      ['opposite social, same guests', [1, 2], [4, 2], 62.5],
    ])('%s', (_label, [s1, g1], [s2, g2], expected) => {
      const result = calculateCompatibility(
        makeProfile({ socialLevel: s1, guestFrequency: g1 }),
        makeProfile({ socialLevel: s2, guestFrequency: g2 }),
      );
      expect(result.socialCompatibility).toBe(expected);
    });
  });

  /*
   * KNOWN BUG: sleep and cleanliness are stored as integers (dbActions.convertSurveyToDatabase writes
   * sleepSchedule 1/3/5 and cleanliness 1-5), but compatibility.ts converts them with
   * `.toString()` and looks them up in maps keyed by survey strings ('early-bird', 'very-clean', ...).
   * "1" or "5" is never found, both users fall back to the same default, and these categories are always
   * 100. Together with the constant study score below, 65% of every match score is free.
   */
  describe('sleep and cleanliness use the stored integer values', () => {
    test.fails('an early bird (1) and a night owl (5) are not 100% sleep-compatible', () => {
      const result = calculateCompatibility(makeProfile({ sleepSchedule: 1 }), makeProfile({ sleepSchedule: 5 }));
      expect(result.sleepCompatibility).toBeLessThan(100);
    });

    test.fails('very clean (5) and very dirty (1) are not 100% cleanliness-compatible', () => {
      const result = calculateCompatibility(makeProfile({ cleanliness: 5 }), makeProfile({ cleanliness: 1 }));
      expect(result.cleanlinessCompatibility).toBeLessThan(100);
    });

    test('documents current behaviour: both categories are 100 for opposite users', () => {
      const result = calculateCompatibility(
        makeProfile({ sleepSchedule: 1, cleanliness: 5 }),
        makeProfile({ sleepSchedule: 5, cleanliness: 1 }),
      );
      expect(result.sleepCompatibility).toBe(100);
      expect(result.cleanlinessCompatibility).toBe(100);
    });
  });

  /*
   * KNOWN BUG (lines ~194-200): calculateStudyCompatibility() takes no arguments and always returns 100.
   * The category is weighted 20%, so every pair of users receives 20 free points. The survey's
   * studyHabits answer is also never saved (convertSurveyToDatabase drops it).
   */
  describe('study habits', () => {
    test.fails('study compatibility depends on the two users', () => {
      const quiet = makeProfile({ preferences: { studyHabits: 'quiet-study' } });
      const social = makeProfile({ preferences: { studyHabits: 'social-study' } });
      expect(calculateCompatibility(quiet, social).interestsCompatibility).toBeLessThan(100);
    });

    test('documents current behaviour: study is 100 for every pair, worth 20 points overall', () => {
      const a = makeProfile({ noiseLevel: 1, socialLevel: 1, guestFrequency: 1 });
      const b = makeProfile({ noiseLevel: 100, socialLevel: 4, guestFrequency: 4 });
      const result = calculateCompatibility(a, b);
      expect(result.interestsCompatibility).toBe(100);
      expect(calculateOverallScore({ ...result, interestsCompatibility: 0 }) + 20)
        .toBe(calculateOverallScore(result));
    });
  });

  test.fails('a pair that disagrees on every survey answer scores below 50%', () => {
    const a = makeProfile({
      sleepSchedule: 1, cleanliness: 5, noiseLevel: 1, socialLevel: 1, guestFrequency: 1,
    });
    const b = makeProfile({
      sleepSchedule: 5, cleanliness: 1, noiseLevel: 100, socialLevel: 4, guestFrequency: 4,
    });
    // Currently 79%: sleep, cleanliness and study all score 100 regardless of the answers
    expect(calculateOverallScore(calculateCompatibility(a, b))).toBeLessThan(50);
  });
});
