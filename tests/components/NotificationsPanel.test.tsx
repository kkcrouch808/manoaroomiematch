import { describe, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationsPanel from '@/components/NotificationsPanel';
import { callsTo, mockFetch } from '../helpers/fetch-mock';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const notifications = [
  { id: 1, type: 'report_action', content: XSS_PAYLOADS[1], is_read: false, created_at: minutesAgo(5) },
  { id: 2, type: 'report_action', content: 'Old news', is_read: true, created_at: minutesAgo(60 * 24 * 30) },
  { id: 3, type: 'report_action', content: 'Hours ago', is_read: false, created_at: minutesAgo(180) },
];

describe('NotificationsPanel', () => {
  test('shows the unread count, lists notifications and renders content as text', async () => {
    mockFetch({ '/api/notifications': () => ({ body: { notifications } }) });
    const { container } = render(<NotificationsPanel />);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(await within(bell).findByText('2')).toHaveClass('badge');

    await userEvent.click(bell);
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expectRenderedAsText(container, XSS_PAYLOADS[1]);
  });

  test('opening a notification marks it read and shows it in a modal', async () => {
    const fetchMock = mockFetch({
      '/api/notifications': () => ({ body: { notifications } }),
      'PATCH /api/notifications/1/read': () => ({ status: 200 }),
    });
    render(<NotificationsPanel />);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    await within(bell).findByText('2');
    await userEvent.click(bell);
    await userEvent.click(screen.getAllByText(XSS_PAYLOADS[1])[0]);

    const dialog = await screen.findByRole('dialog');
    expectRenderedAsText(dialog, XSS_PAYLOADS[1]);
    expect(callsTo(fetchMock, '/api/notifications/1/read')).toHaveLength(1);
    await waitFor(() => expect(within(bell).getByText('1')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByText('Close', { selector: 'button' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('deleting removes the notification without opening it', async () => {
    const fetchMock = mockFetch({
      '/api/notifications': () => ({ body: { notifications } }),
      'POST /api/notifications/delete': () => ({ status: 200 }),
    });
    render(<NotificationsPanel />);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    await within(bell).findByText('2');
    await userEvent.click(bell);
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete notification' })[0]);

    await waitFor(() => expect(screen.queryByText(XSS_PAYLOADS[1])).toBeNull());
    expect(callsTo(fetchMock, '/api/notifications/delete')).toEqual([{ method: 'POST', body: { notificationId: 1 } }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(bell).getByText('1')).toBeInTheDocument();
  });

  test('shows an empty state, and closes when clicking outside', async () => {
    mockFetch({ '/api/notifications': () => ({ body: { notifications: [] } }) });
    render(<NotificationsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByText('No notifications')).toBeNull();
  });

  test('more than 99 unread shows 99+', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...notifications[0], id: i + 10, content: `n${i}` }));
    mockFetch({ '/api/notifications': () => ({ body: { notifications: many } }) });
    render(<NotificationsPanel />);
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });
});
