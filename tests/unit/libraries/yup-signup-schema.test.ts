/**
 * The sign-up rules (Yup), run exactly as react-hook-form's yupResolver runs them: abortEarly false,
 * so every field error is reported. Grouped by input category.
 */
import { describe, expect, test } from 'vitest';
import { ValidationError } from 'yup';
import { signUpSchema, type SignUpForm } from '@/lib/validation/signup';
import {
  OVERSIZED_STRINGS, SQL_INJECTION_PAYLOADS, UNICODE_NAMES, XSS_PAYLOADS,
} from '../../fixtures/malicious-inputs';

const valid: SignUpForm = {
  firstName: 'Kai',
  lastName: 'Akana',
  email: 'kai@hawaii.edu',
  password: 'aloha123',
  confirmPassword: 'aloha123',
};

/** Returns the error messages for a form, or [] when it is valid. */
async function errorsFor(overrides: Partial<SignUpForm>): Promise<string[]> {
  try {
    await signUpSchema.validate({ ...valid, ...overrides }, { abortEarly: false });
    return [];
  } catch (error) {
    if (error instanceof ValidationError) return error.errors;
    throw error;
  }
}

const withPassword = (password: string) => ({ password, confirmPassword: password });

describe('normal input', () => {
  test('a complete, valid form passes', async () => {
    expect(await errorsFor({})).toEqual([]);
  });
});

describe('edge and boundary cases', () => {
  test.each([
    ['5-character password', withPassword('12345'), ['Password must be at least 6 characters']],
    ['6-character password (minimum)', withPassword('123456'), []],
    ['40-character password (maximum)', withPassword('a'.repeat(40)), []],
    ['41-character password', withPassword('a'.repeat(41)), ['Password must not exceed 40 characters']],
    ['whitespace-only password of length 6', withPassword('      '), []],
    ['very long first name (10 KB)', { firstName: OVERSIZED_STRINGS.tenKilobytes }, []],
  ])('%s', async (_label, overrides, expected) => {
    expect(await errorsFor(overrides)).toEqual(expected);
  });

  test('an entirely empty form reports every required field', async () => {
    expect(await errorsFor({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' }))
      .toEqual(expect.arrayContaining([
        'First Name is required',
        'Last Name is required',
        'Email is required',
        'Password is required',
        'Confirm Password is required',
      ]));
  });

  test('missing fields (undefined) are required too', async () => {
    const errors = await errorsFor({ firstName: undefined, email: undefined });
    expect(errors).toContain('First Name is required');
    expect(errors).toContain('Email is required');
  });

  test.each([
    ['different confirmation', { confirmPassword: 'aloha124' }],
    ['confirmation differs only by case', { confirmPassword: 'ALOHA123' }],
  ])('%s does not match', async (_label, overrides) => {
    expect(await errorsFor(overrides)).toEqual(['Confirm Password does not match']);
  });
});

describe('wrong format', () => {
  test.each([
    ['gmail address', 'kai@gmail.com', ['Only @hawaii.edu emails are allowed']],
    ['hawaii.edu as a subdomain of another site', 'kai@hawaii.edu.evil.com', ['Only @hawaii.edu emails are allowed']],
    ['look-alike domain', 'kai@evilhawaii.edu', ['Only @hawaii.edu emails are allowed']],
    ['UH subdomain', 'kai@cs.hawaii.edu', ['Only @hawaii.edu emails are allowed']],
    ['no @ sign', 'kai.hawaii.edu', ['Email is invalid', 'Only @hawaii.edu emails are allowed']],
    ['only the domain', '@hawaii.edu', ['Email is invalid']],
  ])('%s (%s) is rejected', async (_label, email, expected) => {
    expect(await errorsFor({ email })).toEqual(expected);
  });

  test.each(['kai@HAWAII.EDU', 'KAI@Hawaii.Edu', 'kai.akana+housing@hawaii.edu'])('%s is accepted', async (email) => {
    expect(await errorsFor({ email })).toEqual([]);
  });
});

describe('Unicode', () => {
  test.each([...UNICODE_NAMES])('name %s is accepted', async (name) => {
    expect(await errorsFor({ firstName: name, lastName: name })).toEqual([]);
  });

  test('ʻokina and kahakō in a password are allowed and counted as characters', async () => {
    expect(await errorsFor(withPassword('ʻōlelo'))).toEqual([]);
  });
});

describe('malicious input', () => {
  // Names have no character restrictions; the UI must render them as text (see component and E2E tests)
  test.each([...XSS_PAYLOADS])('XSS payload %j as a name passes validation', async (payload) => {
    expect(await errorsFor({ firstName: payload, lastName: payload })).toEqual([]);
  });

  test.each([...SQL_INJECTION_PAYLOADS])('SQL-injection email %j is rejected', async (email) => {
    expect(await errorsFor({ email })).not.toEqual([]);
  });

  test.each([
    'kai@hawaii.edu\n@gmail.com',
    '<script>alert(1)</script>@hawaii.edu',
    "kai'--@hawaii.edu' OR 1=1",
  ])('crafted email %j is rejected', async (email) => {
    expect(await errorsFor({ email })).not.toEqual([]);
  });

  test('a 1 MB password is rejected by the 40-character limit', async () => {
    expect(await errorsFor(withPassword(OVERSIZED_STRINGS.oneMegabyte)))
      .toEqual(['Password must not exceed 40 characters']);
  });
});
