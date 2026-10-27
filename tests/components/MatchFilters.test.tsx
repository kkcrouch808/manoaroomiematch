import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchFilterPanel, { DEFAULT_FILTERS, type MatchFilters } from '@/components/MatchFilters';

function renderPanel(filters: MatchFilters = DEFAULT_FILTERS, activeFilterCount = 0) {
  const props = {
    onFiltersChange: vi.fn(),
    onClearFilters: vi.fn(),
    onSaveFilters: vi.fn(),
  };
  render(
    <MatchFilterPanel
      filters={filters}
      activeFilterCount={activeFilterCount}
      matchCount={3}
      totalMatches={10}
      {...props}
    />,
  );
  return props;
}

describe('MatchFilterPanel', () => {
  test('shows how many matches the filters keep', () => {
    renderPanel();
    expect(screen.getByText(/Showing/).textContent).toMatch(/Showing\s*3\s*of\s*10\s*matches/);
  });

  test('checking a box adds the value; unchecking removes it', async () => {
    const { onFiltersChange } = renderPanel({ ...DEFAULT_FILTERS, pronouns: ['she/her'] });
    await userEvent.click(screen.getByLabelText('They/Them'));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, pronouns: ['she/her', 'they/them'] });
    await userEvent.click(screen.getByLabelText('She/Her'));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, pronouns: [] });
  });

  test('the dorm list appears only for on-campus housing', async () => {
    renderPanel();
    expect(screen.queryByText('Preferred Dorms')).toBeNull();
    render(
      <MatchFilterPanel
        filters={{ ...DEFAULT_FILTERS, housingType: ['on-campus'] }}
        activeFilterCount={1}
        matchCount={1}
        totalMatches={1}
        onFiltersChange={vi.fn()}
        onClearFilters={vi.fn()}
        onSaveFilters={vi.fn()}
      />,
    );
    expect(screen.getByText('Preferred Dorms')).toBeInTheDocument();
    expect(screen.getByLabelText('Hale Aloha Ilima')).toBeInTheDocument();
  });

  test('the slider sets the minimum match percentage', async () => {
    const { onFiltersChange } = renderPanel();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByRole('slider'), { target: { value: '75' } });
    expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, minMatchPercentage: 75 });
  });

  test('Save shows confirmation; Clear calls back; the active count is shown', async () => {
    const { onSaveFilters, onClearFilters } = renderPanel(DEFAULT_FILTERS, 4);
    expect(screen.getByText('4')).toHaveClass('badge');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(onSaveFilters).toHaveBeenCalled();
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Clear all filters'));
    expect(onClearFilters).toHaveBeenCalled();
  });

  test('advanced filters expand and feed the same callback', async () => {
    const { onFiltersChange } = renderPanel();
    const toggle = screen.getByRole('button', { expanded: false });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[checkboxes.length - 1]);
    expect(onFiltersChange).toHaveBeenCalled();
  });
});
