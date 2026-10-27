// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearAllMatchActions,
  getAcceptedMatches,
  getMatchAction,
  getMatchActions,
  getPassedMatches,
  getSavedMatches,
  isMatchAccepted,
  isMatchPassed,
  isMatchSaved,
  saveMatchAction,
} from '@/lib/matchActions';

beforeEach(() => {
  localStorage.clear();
});

describe('match actions in localStorage', () => {
  test('starts empty', () => {
    expect(getMatchActions().size).toBe(0);
    expect(getMatchAction('m1')).toBeNull();
  });

  test('saves, lists and checks each kind of action', () => {
    saveMatchAction('m1', 'saved');
    saveMatchAction('m2', 'accepted');
    saveMatchAction('m3', 'passed');
    saveMatchAction('m4', 'saved');

    expect(getSavedMatches()).toEqual(['m1', 'm4']);
    expect(getAcceptedMatches()).toEqual(['m2']);
    expect(getPassedMatches()).toEqual(['m3']);
    expect([isMatchSaved('m1'), isMatchAccepted('m2'), isMatchPassed('m3')]).toEqual([true, true, true]);
    expect([isMatchSaved('m2'), isMatchAccepted('m3'), isMatchPassed('m1')]).toEqual([false, false, false]);
  });

  test('a later action on the same match replaces the earlier one', () => {
    saveMatchAction('m1', 'saved');
    saveMatchAction('m1', 'accepted');
    expect(getMatchAction('m1')).toBe('accepted');
    expect(getSavedMatches()).toEqual([]);
  });

  test('persists as JSON with a timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    saveMatchAction('m1', 'passed');
    expect(JSON.parse(localStorage.getItem('match-actions')!)).toEqual([
      { matchId: 'm1', action: 'passed', timestamp: 1234 },
    ]);
  });

  test('clearAllMatchActions removes everything', () => {
    saveMatchAction('m1', 'saved');
    clearAllMatchActions();
    expect(localStorage.getItem('match-actions')).toBeNull();
  });

  test('corrupted storage is ignored instead of crashing the page', () => {
    localStorage.setItem('match-actions', '{not json');
    expect(getMatchActions().size).toBe(0);
  });

  test('storage errors (quota, private mode) are swallowed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveMatchAction('m1', 'saved')).not.toThrow();
    expect(() => clearAllMatchActions()).not.toThrow();
  });

  test('a hostile match id is stored as data', () => {
    const id = '<img src=x onerror=alert(1)>';
    saveMatchAction(id, 'saved');
    expect(getSavedMatches()).toEqual([id]);
  });
});

describe('on the server (no window)', () => {
  test('every function is a safe no-op', () => {
    vi.stubGlobal('window', undefined);
    expect(getMatchActions().size).toBe(0);
    expect(() => saveMatchAction('m1', 'saved')).not.toThrow();
    expect(() => clearAllMatchActions()).not.toThrow();
    vi.unstubAllGlobals();
    expect(localStorage.getItem('match-actions')).toBeNull();
  });
});
