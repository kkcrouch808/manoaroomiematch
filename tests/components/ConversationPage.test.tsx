/** The chat view (/messages/[userId]): loading, rendering messages as text, sending, and errors. */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationPage from '@/app/messages/[userId]/page';
import { callsTo, mockFetch } from '../helpers/fetch-mock';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ status: 'authenticated' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ userId: '7' }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: auth.status, data: auth.status === 'authenticated' ? { user: { id: '5' } } : null }),
}));

const today = new Date().toISOString();
const conversation = {
  otherUser: { id: 7, name: 'Kai Akana', photo: null, role: 'USER' },
  messages: [
    {
      id: 1, senderId: 7, receiverId: 5, content: 'Aloha!', sentAt: '2024-01-01T10:00:00Z', isRead: true, readAt: null,
    },
    { id: 2, senderId: 7, receiverId: 5, content: XSS_PAYLOADS[1], sentAt: today, isRead: false, readAt: null },
  ],
};

function routes(extra = {}) {
  return mockFetch({
    '/api/messages/conversation/7': () => ({ body: conversation }),
    'POST /api/messages/mark-conversation-read/7': () => ({ body: { count: 1 } }),
    '/api/messages/check-blocked/7': () => ({ body: { isBlocked: false } }),
    ...extra,
  });
}

beforeEach(() => {
  auth.status = 'authenticated';
  router.push.mockClear();
});

describe('Conversation page', () => {
  test('loads the conversation, marks it read and renders every message as text', async () => {
    const fetchMock = routes();
    const { container } = render(<ConversationPage />);
    expect(await screen.findByRole('heading', { name: 'Kai Akana' })).toBeInTheDocument();
    expect(screen.getByText('KA')).toBeInTheDocument(); // initials avatar
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Aloha!')).toBeInTheDocument();
    expectRenderedAsText(container, XSS_PAYLOADS[1]);
    expect(callsTo(fetchMock, '/api/messages/mark-conversation-read/7')).toHaveLength(1);
  });

  test.each([...XSS_PAYLOADS])('sending %j posts it and shows it as text', async (payload) => {
    const fetchMock = routes({
      'POST /api/messages/send': (init?: RequestInit) => ({
        status: 201,
        body: {
          id: 9,
          senderId: 5,
          receiverId: 7,
          sentAt: today,
          isRead: false,
          readAt: null,
          ...JSON.parse(String(init?.body)),
        },
      }),
    });
    const user = userEvent.setup();
    const { container } = render(<ConversationPage />);
    const input = await screen.findByPlaceholderText('Type a message...');
    await user.click(input);
    await user.paste(`  ${payload}  `);
    await user.click(container.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(input).toHaveValue(''));
    expect(callsTo(fetchMock, '/api/messages/send')).toEqual([
      { method: 'POST', body: { receiverId: 7, content: payload } },
    ]);
    expectRenderedAsText(container, payload);
  });

  test('the send button is disabled for blank input', async () => {
    routes();
    const { container } = render(<ConversationPage />);
    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, '   ');
    expect(container.querySelector('button[type="submit"]')).toBeDisabled();
  });

  test('a blocked/failed send shows an error and keeps the draft', async () => {
    routes({ 'POST /api/messages/send': () => ({ status: 403, body: { error: 'blocked' } }) });
    const user = userEvent.setup();
    const { container } = render(<ConversationPage />);
    const input = await screen.findByPlaceholderText('Type a message...');
    await user.type(input, 'hello?');
    await user.click(container.querySelector('button[type="submit"]')!);
    expect(await screen.findByText('Failed to send message')).toHaveClass('alert-danger');
    expect(input).toHaveValue('hello?');
  });

  test('a conversation that fails to load offers a way back', async () => {
    mockFetch({
      '/api/messages/conversation/7': () => ({ status: 500 }),
      'POST /api/messages/mark-conversation-read/7': () => ({ status: 500 }),
    });
    render(<ConversationPage />);
    expect(await screen.findByText('Failed to fetch conversation')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Messages' }));
    expect(router.push).toHaveBeenCalledWith('/messages');
  });

  test('an empty conversation invites the first message; admins get a badge', async () => {
    routes({
      '/api/messages/conversation/7': () => ({
        body: { otherUser: { id: 7, name: 'Admin', photo: '/a.png', role: 'ADMIN' }, messages: [] },
      }),
    });
    render(<ConversationPage />);
    expect(await screen.findByText('No messages yet. Start the conversation!')).toBeInTheDocument();
    expect(screen.getByText('Admin', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByAltText('Admin')).toHaveAttribute('src', '/a.png');
  });

  test('signed-out visitors are sent to sign in', async () => {
    auth.status = 'unauthenticated';
    mockFetch({});
    render(<ConversationPage />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/api/auth/signin'));
  });
});
