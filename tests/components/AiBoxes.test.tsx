import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IcebreakersBox from '@/components/Icebreakers';
import CompatibilityReportBox from '@/components/CompatibilityReport';
import { callsTo, mockFetch } from '../helpers/fetch-mock';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

describe('IcebreakersBox', () => {
  test('shows default questions and fetches personalised ones', async () => {
    const fetchMock = mockFetch({
      'POST /api/matches/m1/ai-report': () => ({ body: { icebreakers: ['Favourite beach?', XSS_PAYLOADS[1]] } }),
    });
    const { container } = render(<IcebreakersBox matchId="m1" />);
    expect(screen.getByText("What's your ideal living environment?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate Personalized Questions' }));
    expect(await screen.findByText('Favourite beach?')).toBeInTheDocument();
    expectRenderedAsText(container, XSS_PAYLOADS[1]);
    expect(callsTo(fetchMock, '/api/matches/m1/ai-report')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Generate Personalized Questions' })).toBeNull();
  });

  test('copies a question to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<IcebreakersBox matchId="m1" icebreakers={['Do you surf?']} />);
    await user.click(screen.getByTitle('Copy question'));
    expect(writeText).toHaveBeenCalledWith('Do you surf?');
  });

  test('keeps the defaults if generation fails', async () => {
    mockFetch({ 'POST /api/matches/m1/ai-report': () => { throw new Error('offline'); } });
    render(<IcebreakersBox matchId="m1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate Personalized Questions' }));
    expect(await screen.findByText("What's important to you in a roommate?")).toBeInTheDocument();
  });
});

describe('CompatibilityReportBox', () => {
  test('generates and shows a report as plain text', async () => {
    mockFetch({ 'POST /api/matches/m2/ai-report': () => ({ body: { report: `Great match!\n${XSS_PAYLOADS[0]}` } }) });
    const { container } = render(<CompatibilityReportBox matchId="m2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
    expect(await screen.findByText(/Great match!/)).toBeInTheDocument();
    expectRenderedAsText(container, XSS_PAYLOADS[0]);
  });

  test('shows an existing report without a generate button', () => {
    render(<CompatibilityReportBox matchId="m2" report="Already analysed" />);
    expect(screen.getByText('Already analysed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Report' })).toBeNull();
  });

  test('returns to the prompt if generation fails', async () => {
    mockFetch({ 'POST /api/matches/m2/ai-report': () => { throw new Error('offline'); } });
    render(<CompatibilityReportBox matchId="m2" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate Report' }));
    expect(await screen.findByRole('button', { name: 'Generate Report' })).toBeInTheDocument();
  });
});
