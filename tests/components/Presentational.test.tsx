import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileAvatar from '@/components/ProfileAvatar';
import HousingHighlightCard from '@/components/HousingHighlightCard';
import MatchesCardOverview from '@/components/MatchesCardOverview';
import QuickMatchesList from '@/components/QuickMatchesList';
import DeactivationModal from '@/components/DeactivationModal';
import MatchHeader from '@/components/MatchHeader';
import { ProfilePictureProvider } from '@/contexts/ProfilePictureContext';
import { mockFetch } from '../helpers/fetch-mock';
import { makeProfile } from '../helpers/factories';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'john@foo.com' } }, status: 'authenticated' }),
}));

describe('ProfileAvatar', () => {
  test('shows the current user\'s photo from the context', async () => {
    mockFetch({ '/api/profile/picture': () => ({ body: { photoUrl: 'data:image/png;base64,AAAA' } }) });
    render(<ProfilePictureProvider><ProfileAvatar alt="Me" /></ProfilePictureProvider>);
    expect(await screen.findByAltText('Me')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  test('shows a provided photo, or a placeholder icon', () => {
    mockFetch({ '/api/profile/picture': () => ({ body: { photoUrl: null } }) });
    const { container, rerender } = render(
      <ProfilePictureProvider>
        <ProfileAvatar useCurrentUser={false} photoUrl="/kai.png" alt="Kai" />
      </ProfilePictureProvider>,
    );
    expect(screen.getByAltText('Kai')).toBeInTheDocument();
    rerender(<ProfilePictureProvider><ProfileAvatar useCurrentUser={false} photoUrl={null} /></ProfilePictureProvider>);
    expect(container.querySelector('.bi-person-circle')).not.toBeNull();
  });
});

describe('HousingHighlightCard', () => {
  test('renders nothing without a date or housing type', () => {
    const { container } = render(<HousingHighlightCard />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each([
    ['on-campus', 'On-Campus'],
    ['off-campus', 'Off-Campus'],
    ['either', 'Flexible'],
    ['undecided', 'Exploring Options'],
  ])('housing type %s is shown as %s', (housingType, label) => {
    render(
      <HousingHighlightCard
        housingType={housingType}
        preferredDorm="Hale Noelani"
        specificBuilding="B"
        budget="$900"
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/Hale Noelani/)).toBeInTheDocument();
  });

  test.each([
    ['in 10 days', 10, true],
    ['in 60 days', 60, false],
    ['10 days ago', -10, false],
  ])('a move-in date %s is urgent: %s', (_label, days, urgent) => {
    const date = new Date(Date.now() + days * 86_400_000);
    render(<HousingHighlightCard needRoommateBy={date} />);
    expect(screen.queryByText('Urgent') !== null).toBe(urgent);
  });
});

describe('MatchesCardOverview', () => {
  const me = { id: 'me', name: 'Me', major: null, photoUrl: null, interests: [] };
  const other = (id: string, name: string | null, overallScore: number) => ({
    id: `m-${id}`,
    overallScore,
    user1Id: 'me',
    user2Id: id,
    user1: me,
    user2: { id, name, major: 'ICS', photoUrl: null, interests: ['Surfing'], pronouns: 'they/them' },
  });

  test('shows the three best matches, best first, from the other person\'s side', async () => {
    mockFetch({
      '/api/matches': () => ({
        body: {
          currentProfileId: 'me',
          matches: [other('a', 'Low', 40), other('b', 'Best', 95), other('c', null, 70), other('d', 'Mid', 80)],
        },
      }),
    });
    render(<MatchesCardOverview />);
    const titles = await screen.findAllByText(/^(Best|Mid|Profile|Low)$/, { selector: '.card-title' });
    expect(titles.map((t) => t.textContent)).toEqual(['Best', 'Mid', 'Profile']);
  });

  test('explains the empty state', async () => {
    mockFetch({ '/api/matches': () => ({ body: { matches: [], currentProfileId: 'me' } }) });
    render(<MatchesCardOverview />);
    expect(await screen.findByText('No matches yet. Complete your lifestyle survey to get matches.'))
      .toBeInTheDocument();
  });

  test('a failed request shows the empty state', async () => {
    mockFetch({ '/api/matches': () => { throw new Error('offline'); } });
    render(<MatchesCardOverview />);
    expect(await screen.findByText(/No matches yet/)).toBeInTheDocument();
  });
});

describe('QuickMatchesList', () => {
  test('lists matches with links to their comparison', () => {
    const { container } = render(
      <QuickMatchesList matches={[{ id: 'm1', name: XSS_PAYLOADS[1], school: 'UH Mānoa', photoUrl: '/p.png' }]} />,
    );
    expectRenderedAsText(container, XSS_PAYLOADS[1]);
    expect(screen.getByRole('button', { name: 'View' })).toHaveAttribute('href', '/comparison/m1');
  });

  test('invites the survey when empty', () => {
    render(<QuickMatchesList matches={[]} />);
    expect(screen.getByText('No matches yet!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take Survey' })).toHaveAttribute('href', '/lifestyle-survey');
  });
});

describe('DeactivationModal', () => {
  test('confirms with notes, then clears them; cancel closes', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<DeactivationModal show userName={XSS_PAYLOADS[0]} onClose={onClose} onConfirm={onConfirm} />);
    expectRenderedAsText(screen.getByRole('dialog'), XSS_PAYLOADS[0]);
    const notes = screen.getByPlaceholderText('Add notes about this deactivation...');
    await userEvent.type(notes, 'fake profile');
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate User' }));
    expect(onConfirm).toHaveBeenCalledWith('fake profile');
    expect(notes).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('disables both buttons while working', () => {
    render(<DeactivationModal show userName="Kai" onClose={vi.fn()} onConfirm={vi.fn()} isLoading />);
    expect(screen.getByRole('button', { name: 'Deactivating...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});

describe('MatchHeader', () => {
  test.each([
    [85, 'text-green-600'],
    [65, 'text-yellow-600'],
    [30, 'text-red-600'],
  ])('a %i%% score uses %s', (score, cls) => {
    const kai = makeProfile({ name: 'Kai' });
    const lani = makeProfile({ name: 'Lani' });
    render(<MatchHeader currentUser={kai} matchUser={lani} overallScore={score} />);
    expect(screen.getByText(`${score}%`)).toHaveClass(cls);
    expect(screen.getByText('K')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  test('uses photos when present', () => {
    render(
      <MatchHeader
        currentUser={makeProfile({ name: 'Kai', photoUrl: '/k.png' })}
        matchUser={makeProfile({ name: 'Lani', photoUrl: '/l.png' })}
        overallScore={50}
      />,
    );
    expect(screen.getByAltText('Kai')).toBeInTheDocument();
    expect(screen.getByAltText('Lani')).toBeInTheDocument();
  });
});
