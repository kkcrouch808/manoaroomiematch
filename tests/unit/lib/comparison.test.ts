import { describe, expect, test } from 'vitest';
import buildComparisonData from '@/lib/comparison';
import { makeMatch, makeProfile } from '../../helpers/factories';

const you = makeProfile({
  sleepSchedule: 1,
  cleanliness: 5,
  noiseLevel: 2,
  socialLevel: 4,
  dietary: ['Vegetarian', 'Halal'],
  interests: ['Surfing', 'Hiking', 'Coding', 'Chess'],
});
const them = makeProfile({
  sleepSchedule: 5,
  cleanliness: 1,
  noiseLevel: 5,
  socialLevel: 1,
  dietary: [],
  interests: [],
});
const categoryScores = {
  sleepCompatibility: 10,
  cleanlinessCompatibility: 20,
  socialCompatibility: 30,
  lifestyleCompatibility: 40,
  interestsCompatibility: 50,
};

const rowFor = (data: ReturnType<typeof buildComparisonData>, category: string) => (
  data.categoryBreakdown.find((row) => row.category === category)!
);

describe('buildComparisonData', () => {
  const data = buildComparisonData(you, them, makeMatch(you, them, { categoryScores }));

  test('passes the users and match through unchanged', () => {
    expect(data.currentUser).toBe(you);
    expect(data.matchUser).toBe(them);
    expect(data.match.categoryScores).toEqual(categoryScores);
  });

  test('builds six categories in a fixed order', () => {
    expect(data.categoryBreakdown.map((row) => row.category)).toEqual([
      'Sleep Schedule', 'Cleanliness', 'Noise Level', 'Social Life', 'Lifestyle', 'Shared Interests',
    ]);
  });

  test.each([
    ['Sleep Schedule', 'Early Bird', 'Night Owl', 10],
    ['Cleanliness', 'Very Clean', 'Relaxed', 20],
    ['Social Life', 'Social', 'Homebody', 30],
    ['Lifestyle', 'Vegetarian', 'Standard', 40],
    ['Shared Interests', 'Surfing, Hiking, Coding', 'None listed', 50],
  ])('%s shows labels for both users and the stored score', (category, yours, theirs, score) => {
    expect(rowFor(data, category)).toMatchObject({ yourValue: yours, theirValue: theirs, compatibility: score });
  });

  test('accepts categoryScores stored as a JSON string', () => {
    const fromString = buildComparisonData(
      you,
      them,
      makeMatch(you, them, { categoryScores: JSON.stringify(categoryScores) }),
    );
    expect(rowFor(fromString, 'Sleep Schedule').compatibility).toBe(10);
  });

  test.each([0, 6, -1])('out-of-range scale value %i is labelled "Unknown"', (value) => {
    const odd = makeProfile({ sleepSchedule: value, cleanliness: value, socialLevel: value });
    const result = buildComparisonData(odd, odd, makeMatch(odd, odd));
    ['Sleep Schedule', 'Cleanliness', 'Social Life'].forEach((category) => {
      expect(rowFor(result, category).yourValue).toBe('Unknown');
    });
  });

  // KNOWN BUG: the "Noise Level" row reads scores.socialCompatibility instead of the noise score,
  // which calculateCompatibility stores in lifestyleCompatibility.
  test.fails('the Noise Level row shows the noise score', () => {
    expect(rowFor(data, 'Noise Level').compatibility).toBe(categoryScores.lifestyleCompatibility);
  });

  // KNOWN BUG: the survey stores noise tolerance as 0-100, but getNoiseLabel indexes a 5-item array,
  // so any real survey answer above 5 is shown as "Unknown".
  test.fails('a surveyed noise tolerance (e.g. 80) gets a readable label', () => {
    const surveyed = makeProfile({ noiseLevel: 80 });
    const result = buildComparisonData(surveyed, surveyed, makeMatch(surveyed, surveyed));
    expect(rowFor(result, 'Noise Level').yourValue).not.toBe('Unknown');
  });
});
