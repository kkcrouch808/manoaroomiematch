import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LifestyleSurvey from '@/components/LifestyleSurvey';
import { callsTo, mockFetch } from '../helpers/fetch-mock';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'john@foo.com' } }, status: 'authenticated' }),
}));

const DRAFT_KEY = 'lifestyle-survey-draft';

beforeEach(() => {
  localStorage.clear();
});

async function answerEveryStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('Night owl'));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
  expect(screen.getByText('0', { selector: 'strong' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByLabelText('Very clean'));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByLabelText('Need complete silence'));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByLabelText('Private - prefer personal space'));
  await user.click(screen.getByLabelText('No guests please'));
}

describe('LifestyleSurvey (multi-step React Bootstrap form)', () => {
  test('Next stays disabled until the step is answered; Back is disabled on step 1', async () => {
    render(<LifestyleSurvey />);
    expect(screen.getByText(/Step\s+1\s+of\s+5/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Early bird'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('submits every answer to /api/lifestyle-survey and records completion', async () => {
    const fetchMock = mockFetch({ 'POST /api/lifestyle-survey': () => ({ body: { success: true } }) });
    const user = userEvent.setup();
    render(<LifestyleSurvey />);

    await answerEveryStep(user);
    expect(screen.getByText(/Progress:\s*100\s*%/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Complete Survey' }));

    const expected = {
      sleepSchedule: 'night-owl',
      noiseTolerance: 0,
      cleanliness: 'very-clean',
      studyHabits: 'quiet-study',
      socialLevel: 'private',
      guestPolicy: 'no-guests',
    };
    await vi.waitFor(() => expect(callsTo(fetchMock, '/api/lifestyle-survey'))
      .toEqual([{ method: 'POST', body: expected }]));
    expect(JSON.parse(localStorage.getItem('lifestyle-survey-completed')!)).toEqual(expected);
    expect(localStorage.getItem('just-completed-survey')).toBe('true');
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  test('shows the server error and keeps the answers when saving fails', async () => {
    mockFetch({
      'POST /api/lifestyle-survey': () => ({ status: 400, body: { error: 'Missing required survey fields' } }),
    });
    const user = userEvent.setup();
    render(<LifestyleSurvey />);
    await answerEveryStep(user);
    await user.click(screen.getByRole('button', { name: 'Complete Survey' }));
    expect(await screen.findByText('Missing required survey fields')).toHaveClass('alert-danger');
    expect(screen.getByLabelText('No guests please')).toBeChecked();
    expect(localStorage.getItem('lifestyle-survey-completed')).toBeNull();
  });

  test('Back returns to the previous step with the answer kept', async () => {
    const user = userEvent.setup();
    render(<LifestyleSurvey />);
    await user.click(screen.getByLabelText('Neither'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Noise Tolerance' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Neither')).toBeChecked();
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).data.sleepSchedule).toBe('neither');
  });

  test('restores a saved draft at its step, and Clear Draft starts over', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      data: {
        sleepSchedule: 'early-bird',
        noiseTolerance: 30,
        cleanliness: '',
        studyHabits: '',
        socialLevel: '',
        guestPolicy: '',
      },
      step: 2,
      timestamp: new Date().toISOString(),
    }));
    render(<LifestyleSurvey />);
    expect(await screen.findByText(/Draft restored/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cleanliness Standards' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear Draft' }));
    expect(screen.getByRole('heading', { name: 'Sleep Schedule' })).toBeInTheDocument();
    expect(screen.getByLabelText('Early bird')).not.toBeChecked();
  });

  test('a new sign-up ignores any old draft', () => {
    localStorage.setItem('survey-start-fresh', 'true');
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: { sleepSchedule: 'night-owl' }, step: 3, timestamp: 0 }));
    render(<LifestyleSurvey />);
    expect(screen.getByRole('heading', { name: 'Sleep Schedule' })).toBeInTheDocument();
    expect(localStorage.getItem('survey-start-fresh')).toBeNull();
  });

  test('a corrupted draft is ignored', () => {
    localStorage.setItem(DRAFT_KEY, '{not json');
    render(<LifestyleSurvey />);
    expect(screen.getByRole('heading', { name: 'Sleep Schedule' })).toBeInTheDocument();
  });
});
