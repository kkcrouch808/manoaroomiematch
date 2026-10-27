import { describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageActionsDropdown from '@/components/MessageActionsDropdown';
import { callsTo, mockFetch } from '../helpers/fetch-mock';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

const kai = { id: 7, name: 'Kai Akana', photo: null };
const profile = {
  name: 'Kai Akana',
  firstName: 'Kai',
  lastName: 'Akana',
  email: 'kai@hawaii.edu',
  bio: XSS_PAYLOADS[1],
  sleepSchedule: 1,
  cleanliness: 5,
  noiseLevel: 40,
  socialLevel: 2,
  guestFrequency: 2,
  temperature: 3,
  smoking: false,
  drinking: 'never',
  pets: false,
  petTypes: [],
  dietary: [],
  interests: ['Surfing'],
  workSchedule: 'day',
};

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'User actions' }));
  return user;
}

describe('MessageActionsDropdown (React Bootstrap Dropdown)', () => {
  test('blocks, then unblocks, the other user', async () => {
    const fetchMock = mockFetch({
      '/api/messages/check-blocked/7': () => ({ body: { isBlocked: false } }),
      'POST /api/messages/block-user/7': () => ({ status: 201 }),
      'POST /api/messages/unblock-user/7': () => ({ status: 200 }),
    });
    render(<MessageActionsDropdown otherUser={kai} />);
    const user = await openMenu();

    await waitFor(() => expect(screen.getByText('Block User').closest('a, button')).not.toHaveClass('disabled'));
    await user.click(screen.getByText('Block User'));
    await user.click(screen.getByRole('button', { name: 'User actions' }));
    await user.click(await screen.findByText('Unblock User'));
    expect(await screen.findByText('Block User')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/messages/block-user/7')).toHaveLength(1);
    expect(callsTo(fetchMock, '/api/messages/unblock-user/7')).toHaveLength(1);
  });

  test('starts in the blocked state when the API says so', async () => {
    mockFetch({ '/api/messages/check-blocked/7': () => ({ body: { isBlocked: true } }) });
    render(<MessageActionsDropdown otherUser={kai} />);
    await openMenu();
    expect(await screen.findByText('Unblock User')).toBeInTheDocument();
  });

  test('View Profile opens the profile modal, rendering profile text safely', async () => {
    mockFetch({
      '/api/messages/check-blocked/7': () => ({ body: { isBlocked: false } }),
      '/api/profile/7': () => ({ body: { profile } }),
    });
    render(<MessageActionsDropdown otherUser={kai} />);
    const user = await openMenu();
    await user.click(screen.getByText('View Profile'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Kai Akana');
    expectRenderedAsText(dialog, XSS_PAYLOADS[1]);
  });

  test('admins in the conversation have no View Profile item', async () => {
    mockFetch({ '/api/messages/check-blocked/7': () => ({ body: { isBlocked: false } }) });
    render(<MessageActionsDropdown otherUser={kai} isAdmin />);
    await openMenu();
    expect(screen.queryByText('View Profile')).toBeNull();
    expect(screen.getByText('Report User')).toBeInTheDocument();
  });

  test('Report User opens the report form for this user', async () => {
    mockFetch({
      '/api/messages/check-blocked/7': () => ({ body: { isBlocked: false } }),
      '/api/reports/status': () => ({ body: { reports: [] } }),
    });
    render(<MessageActionsDropdown otherUser={kai} />);
    const user = await openMenu();
    await user.click(screen.getByText('Report User'));
    expect(await screen.findByText('Report Kai Akana')).toBeInTheDocument();
  });

  test('a failed block request leaves the state unchanged', async () => {
    mockFetch({
      '/api/messages/check-blocked/7': () => ({ status: 500 }),
      'POST /api/messages/block-user/7': () => ({ status: 500 }),
    });
    render(<MessageActionsDropdown otherUser={kai} />);
    const user = await openMenu();
    await waitFor(() => expect(screen.getByText('Block User').closest('a, button')).not.toHaveClass('disabled'));
    await user.click(screen.getByText('Block User'));
    await user.click(screen.getByRole('button', { name: 'User actions' }));
    expect(await screen.findByText('Block User')).toBeInTheDocument();
  });
});
