import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SurveyEdit from '@/components/SurveyEdit';
import { callsTo, mockFetch } from '../helpers/fetch-mock';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const answers = {
  sleepSchedule: 'early-bird',
  noiseTolerance: 40,
  cleanliness: 'very-clean',
  studyHabits: 'flexible',
  socialLevel: 'mixed',
  guestPolicy: 'rare-guests',
};

beforeEach(() => {
  localStorage.clear();
  router.push.mockClear();
});

describe('SurveyEdit', () => {
  test('without completed answers it sends the user to the survey', () => {
    const { container } = render(<SurveyEdit />);
    expect(container).toBeEmptyDOMElement();
    expect(router.push).toHaveBeenCalledWith('/lifestyle-survey');
  });

  test('edits a single answer and saves it', async () => {
    localStorage.setItem('lifestyle-survey-completed', JSON.stringify(answers));
    mockFetch({});
    render(<SurveyEdit />);
    expect(screen.getByRole('heading', { name: 'Edit Your Survey Answers' })).toBeInTheDocument();

    await userEvent.click(screen.getByText('Sleep Schedule'));
    await userEvent.click(screen.getByLabelText('Night owl'));
    await userEvent.click(screen.getByText('Noise Tolerance'));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '90' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(JSON.parse(localStorage.getItem('lifestyle-survey-completed')!))
      .toEqual({ ...answers, sleepSchedule: 'night-owl', noiseTolerance: 90 });
    expect(router.push).toHaveBeenCalledWith('/lifestyle-survey/confirmation');
  });

  test('Cancel returns to the confirmation page without saving', async () => {
    localStorage.setItem('lifestyle-survey-completed', JSON.stringify(answers));
    render(<SurveyEdit />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.push).toHaveBeenCalledWith('/lifestyle-survey/confirmation');
  });

  // KNOWN BUG: "Save Changes" only writes localStorage ("TODO: Also save to backend API"), so edited answers
  // never reach the database and the user's matches are never recalculated.
  test.fails('saving sends the edited answers to /api/lifestyle-survey', async () => {
    localStorage.setItem('lifestyle-survey-completed', JSON.stringify(answers));
    const fetchMock = mockFetch({ 'POST /api/lifestyle-survey': () => ({ body: { success: true } }) });
    render(<SurveyEdit />);
    await userEvent.click(screen.getByText('Sleep Schedule'));
    await userEvent.click(screen.getByLabelText('Night owl'));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(callsTo(fetchMock, '/api/lifestyle-survey')).toHaveLength(1);
  });
});
