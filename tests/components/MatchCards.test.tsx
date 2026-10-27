import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import MatchCard, { type MatchData } from '@/components/MatchCard';
import CompatibilityCard from '@/components/CompatibilityCard';
import CategoryScoreCard from '@/components/CategoryScorecard';
import SideBySideComparison from '@/components/SideBySideComparison';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';
import { makeProfile } from '../helpers/factories';

const match: MatchData = {
  id: 'm1',
  name: 'Kēhau ʻAkana',
  major: 'Computer Science',
  traits: ['Night Owl', 'Tidy', 'Introvert'],
  matchPercentage: 86,
};

describe('MatchCard (React Bootstrap Card)', () => {
  test('shows the match details and links to the comparison page', () => {
    render(<MatchCard match={match} viewMode="grid" />);
    expect(screen.getByText('Kēhau ʻAkana')).toHaveClass('card-title');
    expect(screen.getByText('Computer Science')).toHaveClass('card-subtitle');
    expect(screen.getByText('Night Owl · Tidy · Introvert')).toBeInTheDocument();
    expect(screen.getByText(/86\s*% Match/)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/comparison/m1');
    expect(screen.getByRole('button', { name: 'View Details' })).toHaveClass('btn-success');
  });

  test.each([
    ['grid', 'match-card-grid'],
    ['list', 'match-card-list'],
  ] as const)('%s layout uses the %s class', (viewMode, cls) => {
    const { container } = render(<MatchCard match={match} viewMode={viewMode} />);
    expect(container.firstChild).toHaveClass('card', 'match-card', cls);
  });

  test.each([
    [79, false],
    [80, true],
    [100, true],
  ])('a %i%% match shows a filled star: %s', (matchPercentage, filled) => {
    const { container } = render(<MatchCard match={{ ...match, matchPercentage }} viewMode="grid" />);
    expect(container.querySelector('.bi-star-fill') !== null).toBe(filled);
    expect(container.querySelector('.bi-star') !== null).toBe(!filled);
  });

  test('uses the photo when there is one, otherwise a placeholder', () => {
    const { container, rerender } = render(<MatchCard match={match} viewMode="grid" />);
    expect(container.querySelector('.match-photo-placeholder')).not.toBeNull();
    rerender(<MatchCard match={{ ...match, photoUrl: '/kehau.png' }} viewMode="grid" />);
    expect(screen.getByAltText('Kēhau ʻAkana profile')).toHaveAttribute('src', '/kehau.png');
  });

  test.each([...XSS_PAYLOADS])('renders hostile name/major/trait %j as text', (payload) => {
    const { container } = render(
      <MatchCard match={{ ...match, name: payload, major: payload, traits: [payload] }} viewMode="list" />,
    );
    expectRenderedAsText(container, payload);
  });
});

describe('CompatibilityCard', () => {
  test('derives personality traits from the lifestyle scales', () => {
    render(
      <CompatibilityCard
        interests={['Surfing', 'Hiking']}
        lifestyle={{ cleanliness: 5, socialLevel: 4, sleepSchedule: 5, guestFrequency: 4 }}
      />,
    );
    ['Clean & Tidy', 'Social Butterfly', 'Night Owl', 'Host', 'Surfing', 'Hiking'].forEach((text) => {
      expect(screen.getByText(text)).toHaveClass('badge');
    });
  });

  test.each([
    ['low values',
      { cleanliness: 1, socialLevel: 1, sleepSchedule: 1, guestFrequency: 1 }, ['Introvert', 'Early Bird']],
    ['middle values (3) add nothing', { cleanliness: 3, socialLevel: 3, sleepSchedule: 3, guestFrequency: 3 }, []],
  ])('%s', (_label, lifestyle, expected) => {
    render(<CompatibilityCard lifestyle={lifestyle} />);
    expected.forEach((trait) => expect(screen.getByText(trait)).toBeInTheDocument());
    if (expected.length === 0) {
      expect(screen.getByText('Complete the lifestyle survey to see traits.')).toBeInTheDocument();
    }
  });

  test('explains empty states', () => {
    render(<CompatibilityCard />);
    expect(screen.getByText('No interests listed yet.')).toBeInTheDocument();
    expect(screen.getByText('Complete the lifestyle survey to see traits.')).toBeInTheDocument();
  });

  test('renders a hostile interest as text', () => {
    const { container } = render(<CompatibilityCard interests={[XSS_PAYLOADS[1]]} />);
    expectRenderedAsText(container, XSS_PAYLOADS[1]);
  });
});

describe('CategoryScoreCard', () => {
  test.each([
    [80, 'bg-green-500'],
    [79, 'bg-yellow-500'],
    [60, 'bg-yellow-500'],
    [59, 'bg-red-500'],
  ])('score %i uses %s', (compatibility, cls) => {
    const { container } = render(
      <CategoryScoreCard
        category="Sleep"
        yourValue="Early Bird"
        theirValue={5}
        compatibility={compatibility}
        description="d"
      />,
    );
    expect(container.querySelector(`.${cls}`)).not.toBeNull();
    expect(screen.getByText(`${compatibility}%`)).toBeInTheDocument();
    expect(screen.getByText('Early Bird')).toBeInTheDocument();
  });
});

describe('SideBySideComparison', () => {
  const you = makeProfile({ id: 'p1', name: 'You Person' });
  const them = makeProfile({ id: 'p2', name: XSS_PAYLOADS[0], photoUrl: '/them.png' });
  const categories = [
    {
      category: 'Sleep Schedule',
      yourValue: 'Early Bird',
      theirValue: 'Night Owl',
      compatibility: 40,
      description: 'd1',
    },
    { category: 'Cleanliness', yourValue: 'Tidy', theirValue: 'Tidy', compatibility: 100, description: 'd2' },
    { category: 'Social Life', yourValue: 'x', theirValue: 'y', compatibility: 65, description: 'd3' },
    { category: 'Work Schedule', yourValue: 'x', theirValue: 'y', compatibility: 65, description: 'd4' },
    { category: 'Personality', yourValue: 'x', theirValue: 'y', compatibility: 65, description: 'd5' },
    { category: 'Other', yourValue: 'x', theirValue: 'y', compatibility: 65, description: 'd6' },
  ];

  test('shows both users and every category with a colour-coded badge', async () => {
    const { container } = render(
      <SideBySideComparison currentUser={you} matchUser={them} categoryBreakdown={categories} overallScore={72} />,
    );
    expect(screen.getByRole('heading', { name: 'You Person' })).toBeInTheDocument();
    expectRenderedAsText(container, XSS_PAYLOADS[0]);
    expect(screen.getByText('Sleep Schedule')).toBeInTheDocument();
    expect(screen.getByText('40%')).toHaveClass('bg-danger');
    expect(screen.getByText('100%')).toHaveClass('bg-success');
    expect(screen.getAllByText('65%')[0]).toHaveClass('bg-warning');
    ['🛌', '🏠', '👥', '📚', '👤', '📋'].forEach((icon) => expect(screen.getByText(icon)).toBeInTheDocument());
  });
});
