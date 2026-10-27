import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportModal from '@/components/ReportModal';
import { callsTo, mockFetch } from '../helpers/fetch-mock';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

const noReports = () => ({ body: { reports: [] } });

function renderModal(onHide = vi.fn()) {
  render(<ReportModal show onHide={onHide} userId={7} userName="Kai" />);
  return { onHide, user: userEvent.setup() };
}

describe('ReportModal (multi-step React Bootstrap Modal form)', () => {
  test('walks reason -> description -> confirm and submits the combined reason', async () => {
    const fetchMock = mockFetch({
      '/api/reports/status': noReports,
      'POST /api/flags': () => ({ status: 201, body: { message: 'ok' } }),
    });
    const { user } = renderModal();

    expect(await screen.findByRole('dialog')).toHaveTextContent('Report Kai');
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();

    await user.click(screen.getByLabelText('Harassment/bullying'));
    await user.click(next);
    await user.type(screen.getByPlaceholderText(/Describe what happened/), 'Rude messages');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Review your report:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));

    expect(await screen.findByText(/Your report has been submitted successfully/)).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/flags')).toEqual([
      { method: 'POST', body: { reportedUserId: 7, reason: '[Harassment/bullying] Rude messages' } },
    ]);
  });

  test('requires a description unless the reason is "Other"', async () => {
    mockFetch({ '/api/reports/status': noReports });
    const { user } = renderModal();
    await user.click(await screen.findByLabelText('Spam/scam'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Please provide a description')).toHaveClass('alert-danger');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByLabelText('Other'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Review your report:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByPlaceholderText(/Describe what happened/)).toBeInTheDocument();
  });

  test('shows the API error (e.g. duplicate report) and keeps the form', async () => {
    mockFetch({
      '/api/reports/status': noReports,
      'POST /api/flags': () => ({ status: 409, body: { error: 'You have a pending report for this user.' } }),
    });
    const { user } = renderModal();
    await user.click(await screen.findByLabelText('Other'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    expect(await screen.findByText('You have a pending report for this user.')).toBeInTheDocument();
  });

  test('a network failure shows a generic error', async () => {
    mockFetch({
      '/api/reports/status': noReports,
      'POST /api/flags': () => { throw new Error('offline'); },
    });
    const { user } = renderModal();
    await user.click(await screen.findByLabelText('Other'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Submit Report' }));
    expect(await screen.findByText('An error occurred while submitting your report')).toBeInTheDocument();
  });

  test('a pending report for this user blocks a new one', async () => {
    mockFetch({
      '/api/reports/status': () => ({
        body: { reports: [{ reportedUserId: 7, status: 'pending', createdAt: '2025-01-02T03:04:00Z' }] },
      }),
    });
    const { onHide, user } = renderModal();
    expect(await screen.findByText('Report Under Review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    await user.click(screen.getByText('Close', { selector: 'button' }));
    expect(onHide).toHaveBeenCalled();
  });

  test('a resolved earlier report allows a new one', async () => {
    mockFetch({
      '/api/reports/status': () => ({ body: { reports: [{ reportedUserId: 7, status: 'resolved' }] } }),
    });
    renderModal();
    expect(await screen.findByLabelText('Fake profile')).toBeInTheDocument();
  });

  test.each([...XSS_PAYLOADS])('a hostile description %j is previewed as text', async (payload) => {
    mockFetch({ '/api/reports/status': noReports });
    const { user } = renderModal();
    await user.click(await screen.findByLabelText('Other'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByPlaceholderText(/Describe what happened/));
    await user.paste(payload);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Review your report:')).toBeInTheDocument());
    const review = within(screen.getByRole('dialog')).getByText('Review your report:').closest('.alert')!;
    expectRenderedAsText(review as HTMLElement, payload);
  });

  test('cancel resets and closes', async () => {
    mockFetch({ '/api/reports/status': noReports });
    const { onHide, user } = renderModal();
    await user.click(await screen.findByLabelText('Other'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onHide).toHaveBeenCalled();
  });
});
