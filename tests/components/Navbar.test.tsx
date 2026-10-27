/** Navbar: what each role sees, driven by the next-auth session (role carried as randomKey). */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { signOut } from 'next-auth/react';
import NavBar from '@/components/Navbar';
import { ProfilePictureProvider } from '@/contexts/ProfilePictureContext';
import { mockFetch } from '../helpers/fetch-mock';

const auth = vi.hoisted(() => ({ session: null as null | { user: { email: string; randomKey: string } } }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: auth.session, status: auth.session ? 'authenticated' : 'unauthenticated' }),
  signOut: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/matches' }));

const renderNav = () => render(<ProfilePictureProvider><NavBar /></ProfilePictureProvider>);

beforeEach(() => {
  mockFetch({
    '/api/messages/unread-count': () => ({ body: { unreadCount: 3 } }),
    '/api/notifications': () => ({ body: { notifications: [] } }),
    '/api/profile/picture': () => ({ body: { photoUrl: null } }),
  });
});

describe('NavBar', () => {
  test('visitors see only Login with sign-in and sign-up', async () => {
    auth.session = null;
    renderNav();
    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByText('Sign in').closest('a')).toHaveAttribute('href', '/auth/signin');
    expect(screen.getByText('Sign up').closest('a')).toHaveAttribute('href', '/auth/signup');
    expect(screen.queryByText('Browse Matches')).toBeNull();
    expect(screen.getByAltText('Manoa RoomieMatch').closest('a')).toHaveAttribute('href', '/');
  });

  test('students get student navigation, notifications and an unread-message badge', async () => {
    auth.session = { user: { email: 'john@foo.com', randomKey: 'USER' } };
    renderNav();
    expect(screen.getByText('Browse Matches')).toHaveClass('active');
    expect(screen.getByText('Lifestyle Survey')).toHaveAttribute('href', '/lifestyle-survey');
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(await screen.findByText('3', { selector: '.badge' })).toBeInTheDocument();
  });

  test('admins do not get student pages or notifications, and the logo leads to /admin', () => {
    auth.session = { user: { email: 'admin@foo.com', randomKey: 'ADMIN' } };
    renderNav();
    expect(screen.queryByText('Browse Matches')).toBeNull();
    expect(screen.queryByText('Lifestyle Survey')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
    expect(screen.getByAltText('Manoa RoomieMatch').closest('a')).toHaveAttribute('href', '/admin');
  });

  test('Sign Out calls next-auth signOut back to the home page', async () => {
    auth.session = { user: { email: 'john@foo.com', randomKey: 'USER' } };
    const { container } = renderNav();
    await userEvent.click(container.querySelector('#login-dropdown')!);
    await userEvent.click(await screen.findByText('Sign Out'));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' });
  });

  test('a failed unread-count request leaves the badge hidden', async () => {
    auth.session = { user: { email: 'john@foo.com', randomKey: 'USER' } };
    mockFetch({
      '/api/messages/unread-count': () => { throw new Error('offline'); },
      '/api/notifications': () => ({ body: { notifications: [] } }),
      '/api/profile/picture': () => ({ body: { photoUrl: null } }),
    });
    renderNav();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText('3', { selector: '.badge' })).toBeNull();
  });
});
