import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserOverviewCard from '@/components/UserOverviewCard';
import AboutMeCard from '@/components/AboutMeCard';
import { UNICODE_NAMES, XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

describe('UserOverviewCard', () => {
  test('shows the profile details and an Edit Profile link', () => {
    render(
      <UserOverviewCard
        name="Kēhau ʻAkana"
        email="kehau@hawaii.edu"
        major="ICS"
        year="Junior"
        graduationYear={2027}
        pronouns="she/her"
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Kēhau ʻAkana' })).toBeInTheDocument();
    expect(screen.getByText('ICS')).toBeInTheDocument();
    expect(screen.getByText('Junior')).toBeInTheDocument();
    expect(screen.getByText('2027')).toBeInTheDocument();
    expect(screen.getByText('kehau@hawaii.edu')).toBeInTheDocument();
    expect(screen.getByText('she/her')).toBeInTheDocument();
    // next/link (legacyBehavior) hands its href to the React Bootstrap Button, which renders <a role="button">
    expect(screen.getByRole('button', { name: 'Edit Profile' })).toHaveAttribute('href', '/edit-profile');
  });

  test('handles missing optional fields', () => {
    render(<UserOverviewCard name="Kai" email="kai@hawaii.edu" />);
    expect(screen.getByText('Major not set')).toBeInTheDocument();
    expect(screen.queryByText('Year:')).toBeNull();
    expect(screen.queryByText('Pronouns:')).toBeNull();
  });

  test('shows the photo with descriptive alt text', () => {
    render(<UserOverviewCard name="Kai" email="kai@hawaii.edu" photoUrl="/kai.png" />);
    expect(screen.getByAltText("Kai's profile picture")).toBeInTheDocument();
  });

  test.each([...UNICODE_NAMES])('Unicode name %s is displayed unchanged', (name) => {
    render(<UserOverviewCard name={name} email="u@hawaii.edu" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(name);
  });

  test.each([...XSS_PAYLOADS])('hostile name/pronouns %j are rendered as text', (payload) => {
    const { container } = render(<UserOverviewCard name={payload} email="u@hawaii.edu" pronouns={payload} />);
    expectRenderedAsText(container, payload);
  });
});

describe('AboutMeCard', () => {
  test('shows bio, hometown, socials and interests', () => {
    render(
      <AboutMeCard bio="Aloha!" hometown="Hilo" instagram="@kai" snapchat="kai.snap" interests={['Surfing', 'Poke']} />,
    );
    ['Aloha!', 'Hilo', '@kai', 'kai.snap', 'Surfing', 'Poke'].forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  test('drops blank and "null"/"undefined" interests and hides empty sections', () => {
    render(<AboutMeCard interests={['', '  ', 'null', 'undefined', 'Chess']} />);
    expect(screen.getAllByText(/.+/, { selector: '.badge' }).map((b) => b.textContent)).toEqual(['Chess']);
    expect(screen.queryByText('Bio')).toBeNull();
    expect(screen.queryByText('Social Media')).toBeNull();
  });

  test('with nothing filled in, only the heading remains', () => {
    render(<AboutMeCard />);
    expect(screen.getByRole('heading', { name: 'About Me' })).toBeInTheDocument();
    expect(screen.queryByText('Interests & Hobbies')).toBeNull();
  });

  test.each([...XSS_PAYLOADS])('hostile bio/socials %j are rendered as text', (payload) => {
    const { container } = render(<AboutMeCard bio={payload} instagram={payload} hometown="Hilo" />);
    expectRenderedAsText(container, payload);
  });
});
