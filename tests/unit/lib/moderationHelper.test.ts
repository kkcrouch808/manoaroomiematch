import { describe, expect, test } from 'vitest';
import {
  getErrorMessageForAction,
  getFlagStatusForAction,
  updateUserForModerationAction,
} from '@/lib/moderationHelper';

describe('getFlagStatusForAction', () => {
  test.each([
    ['resolve', 'resolved'],
    ['unsuspend', 'resolved'],
    ['reactivate', 'active'],
    ['deactivate', 'user_deactivated'],
    ['suspend', 'suspended'],
    ['unknown-action', 'pending'],
    ['', 'pending'],
    ['SUSPEND', 'pending'], // actions are case-sensitive
  ])('%j -> %s', (action, status) => {
    expect(getFlagStatusForAction(action)).toBe(status);
  });
});

describe('updateUserForModerationAction', () => {
  const user = { id: 3, active: true, suspendedUntil: null, suspensionCount: 1, name: 'Kai' };

  test('suspend copies the new suspension details from the API response', () => {
    const updated = updateUserForModerationAction(user, 'suspend', {
      suspendedUntil: '2030-01-01T00:00:00.000Z',
      suspensionCount: 2,
    });
    expect(updated).toEqual({ ...user, suspendedUntil: '2030-01-01T00:00:00.000Z', suspensionCount: 2 });
  });

  test('suspend without response data leaves the user unchanged', () => {
    expect(updateUserForModerationAction(user, 'suspend')).toEqual(user);
  });

  test.each([
    ['unsuspend', { suspendedUntil: null }],
    ['deactivate', { active: false, suspendedUntil: null }],
    ['reactivate', { active: true }],
    ['resolve', {}],
    ['something-else', {}],
  ])('%s', (action, changes) => {
    const suspended = { ...user, active: false, suspendedUntil: '2030-01-01' };
    expect(updateUserForModerationAction(suspended, action)).toEqual({ ...suspended, ...changes });
  });

  test('never mutates the object it was given', () => {
    const original = { ...user };
    updateUserForModerationAction(original, 'deactivate');
    expect(original).toEqual(user);
  });
});

describe('getErrorMessageForAction', () => {
  test.each([
    ['resolve', 'Failed to resolve flag'],
    ['suspend', 'Failed to suspend user'],
    ['deactivate', 'Failed to deactivate user'],
    ['reactivate', 'Failed to reactivate user'],
    ['unsuspend', 'Failed to unsuspend user'],
    ['ban', 'Failed to ban user'],
  ])('%s', (action, message) => {
    expect(getErrorMessageForAction(action)).toBe(message);
  });
});
