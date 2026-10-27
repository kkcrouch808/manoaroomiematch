/**
 * The sign-up page wired together: react-hook-form + yupResolver(signUpSchema) + React Bootstrap,
 * with createUser (server action) and next-auth signIn mocked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { signIn } from 'next-auth/react';
import SignUp from '@/app/auth/signup/page';
import { createUser } from '@/lib/dbActions';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('@/lib/dbActions', () => ({ createUser: vi.fn() }));

const fields = {
  firstName: () => screen.getByPlaceholderText('John'),
  lastName: () => screen.getByPlaceholderText('Doe'),
  email: () => screen.getByPlaceholderText('you@hawaii.edu'),
  password: () => screen.getByPlaceholderText('Minimum 6 characters'),
  confirm: () => screen.getByPlaceholderText('Re-enter your password'),
};

async function fillAndSubmit(values: Partial<Record<keyof typeof fields, string>>) {
  const user = userEvent.setup();
  for (const [name, value] of Object.entries(values)) {
    if (value) await user.type(fields[name as keyof typeof fields](), value);
  }
  await user.click(screen.getByRole('button', { name: 'Create Account' }));
  return user;
}

const valid = {
  firstName: 'Kēhau', lastName: 'ʻAkana', email: 'kehau@HAWAII.EDU', password: 'aloha123', confirm: 'aloha123',
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(createUser).mockResolvedValue(undefined);
  vi.mocked(signIn).mockResolvedValue(undefined as never);
});

describe('Sign-up page', () => {
  test('a valid form creates the account and signs in to the survey', async () => {
    localStorage.setItem('lifestyle-survey-draft', '{}');
    render(<SignUp />);
    await fillAndSubmit(valid);

    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(createUser).toHaveBeenCalledWith({
      firstName: 'Kēhau',
      lastName: 'ʻAkana',
      email: 'kehau@HAWAII.EDU',
      password: 'aloha123',
      confirmPassword: 'aloha123',
    });
    expect(signIn).toHaveBeenCalledWith('credentials', {
      email: 'kehau@HAWAII.EDU', password: 'aloha123', redirect: true, callbackUrl: '/lifestyle-survey',
    });
    expect(localStorage.getItem('survey-start-fresh')).toBe('true');
    expect(localStorage.getItem('lifestyle-survey-draft')).toBeNull();
  });

  test.each([
    ['empty form', {}, ['First Name is required', 'Email is required', 'Password is required']],
    ['non-UH email', { ...valid, email: 'kai@gmail.com' }, ['Only @hawaii.edu emails are allowed']],
    ['5-character password', { ...valid, password: '12345', confirm: '12345' },
      ['Password must be at least 6 characters']],
    ['41-character password', { ...valid, password: 'a'.repeat(41), confirm: 'a'.repeat(41) },
      ['Password must not exceed 40 characters']],
    ['mismatched confirmation', { ...valid, confirm: 'aloha124' }, ['Confirm Password does not match']],
  ])('%s shows inline errors and never calls createUser', async (_label, values, messages) => {
    render(<SignUp />);
    await fillAndSubmit(values);
    for (const message of messages) {
      const feedback = await screen.findByText(message);
      expect(feedback).toHaveClass('invalid-feedback');
      expect(feedback.previousElementSibling).toHaveClass('is-invalid');
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  test('a duplicate email is reported without signing in', async () => {
    vi.mocked(createUser).mockRejectedValue(new Error('Email already exists'));
    render(<SignUp />);
    await fillAndSubmit(valid);
    expect(await screen.findByText('This email is already registered.')).toHaveClass('alert-danger');
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeEnabled();
  });

  test('other registration errors are shown', async () => {
    vi.mocked(createUser).mockRejectedValue(new Error('connection reset'));
    render(<SignUp />);
    await fillAndSubmit(valid);
    expect(await screen.findByText('Registration failed: connection reset')).toBeInTheDocument();
  });

  test('a sign-in failure after registration asks the user to log in manually', async () => {
    vi.mocked(signIn).mockResolvedValue({ error: 'CredentialsSignin' } as never);
    render(<SignUp />);
    await fillAndSubmit(valid);
    expect(await screen.findByText(/Sign in failed after registration: CredentialsSignin/)).toBeInTheDocument();
    vi.mocked(signIn).mockRejectedValue(new Error('network'));
    await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(await screen.findByText(/An unexpected error occurred during sign-in: network/)).toBeInTheDocument();
  });

  test.each([
    ['abc', 'Weak'],
    ['abcdefghij', 'Fair'],
    ['Abcdefgh1', 'Good'],
    ['Abcdefghij1!', 'Strong'],
  ])('password strength for %j is %s', async (password, label) => {
    render(<SignUp />);
    await userEvent.type(fields.password(), password);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  test.each([...XSS_PAYLOADS])('hostile names %j are submitted unchanged as data', async (payload) => {
    render(<SignUp />);
    const user = userEvent.setup();
    await user.click(fields.firstName());
    await user.paste(payload);
    await user.click(fields.lastName());
    await user.paste(payload);
    await fillAndSubmit({ email: 'x@hawaii.edu', password: 'secret1', confirm: 'secret1' });
    await waitFor(() => expect(createUser).toHaveBeenCalled());
    expect(vi.mocked(createUser).mock.calls[0][0]).toMatchObject({ firstName: payload, lastName: payload });
    expect(document.querySelector('script, img[src="x"], iframe')).toBeNull();
  });
});
