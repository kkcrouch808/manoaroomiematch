/**
 * How the app uses bcrypt: passwords are hashed with cost 10 before they are stored (createUser,
 * changePassword, the change-password route), and only the right password matches the stored hash.
 * bcryptjs (used by the delete-account route) must accept the same hashes.
 */
import { describe, expect, test } from 'vitest';
import { compare, hash } from 'bcrypt';
import * as bcryptjs from 'bcryptjs';
import { changePassword, createUser } from '@/lib/dbActions';
import { prismaMock } from '../../helpers/prisma-mock';
import { UNICODE_NAMES, XSS_PAYLOADS } from '../../fixtures/malicious-inputs';

const BCRYPT_COST_10 = /^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/;

async function storedPasswordAfterCreateUser(password: string) {
  prismaMock.user.create.mockResolvedValue({ id: 1 });
  prismaMock.userProfile.create.mockResolvedValue({});
  await createUser({ email: 'kai@hawaii.edu', password, firstName: 'Kai', lastName: 'Akana' });
  return prismaMock.user.create.mock.calls[0][0].data.password as string;
}

describe('createUser stores a bcrypt hash, never the password', () => {
  test('the stored value is a cost-10 bcrypt hash that verifies', async () => {
    const stored = await storedPasswordAfterCreateUser('aloha123');
    expect(stored).toMatch(BCRYPT_COST_10);
    expect(stored).not.toContain('aloha123');
    await expect(compare('aloha123', stored)).resolves.toBe(true);
  });

  test('two users with the same password get different hashes (random salt)', async () => {
    const first = await storedPasswordAfterCreateUser('same-password');
    prismaMock.user.create.mockClear();
    const second = await storedPasswordAfterCreateUser('same-password');
    expect(first).not.toBe(second);
  });

  test.each([
    ['wrong password', 'aloha124'],
    ['different case', 'ALOHA123'],
    ['prefix', 'aloha12'],
    ['extra character', 'aloha1234'],
    ['empty', ''],
  ])('only the right password matches: %s does not', async (_label, attempt) => {
    const stored = await storedPasswordAfterCreateUser('aloha123');
    await expect(compare(attempt, stored)).resolves.toBe(false);
  });
});

describe('changePassword re-hashes the new password', () => {
  test('stores a new hash for the given email', async () => {
    prismaMock.user.update.mockResolvedValue({});
    await changePassword({ email: 'kai@hawaii.edu', password: 'new-secret' });
    const { where, data } = prismaMock.user.update.mock.calls[0][0];
    expect(where).toEqual({ email: 'kai@hawaii.edu' });
    expect(data.password).toMatch(BCRYPT_COST_10);
    await expect(compare('new-secret', data.password)).resolves.toBe(true);
    await expect(compare('old-secret', data.password)).resolves.toBe(false);
  });
});

describe('bcrypt input range', () => {
  test.each([
    ['Unicode', `${UNICODE_NAMES.join('')}!`],
    ['XSS payload', XSS_PAYLOADS[0]],
    ['40 characters (sign-up maximum)', 'p'.repeat(40)],
  ])('%s passwords round-trip', async (_label, password) => {
    const stored = await hash(password, 4);
    await expect(compare(password, stored)).resolves.toBe(true);
  });

  test('bcrypt only uses the first 72 bytes, so longer passwords that share them also match', async () => {
    // The sign-up form caps passwords at 40 characters, which keeps users clear of this limit
    const stored = await hash(`${'a'.repeat(72)}first`, 4);
    await expect(compare(`${'a'.repeat(72)}second`, stored)).resolves.toBe(true);
  });

  test('bcryptjs (delete-account route) verifies hashes made by bcrypt', async () => {
    const stored = await hash('changeme', 10);
    await expect(bcryptjs.compare('changeme', stored)).resolves.toBe(true);
    await expect(bcryptjs.compare('wrong', stored)).resolves.toBe(false);
  });
});
