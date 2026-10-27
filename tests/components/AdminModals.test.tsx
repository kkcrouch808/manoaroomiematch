import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuspensionModal from '@/components/SuspensionModal';
import DeleteUserModal from '@/components/DeleteUserModal';
import { XSS_PAYLOADS } from '../fixtures/malicious-inputs';
import expectRenderedAsText from '../helpers/xss';

describe('SuspensionModal', () => {
  const setup = () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<SuspensionModal show userName={XSS_PAYLOADS[1]} onClose={onClose} onConfirm={onConfirm} />);
    return { onConfirm, onClose, user: userEvent.setup() };
  };

  test.each([
    ['1 day', 24],
    ['7 days', 168],
    ['30 days', 720],
  ])('preset %s suspends for %i hours with notes', async (label, hours) => {
    const { onConfirm, user } = setup();
    await user.click(screen.getByLabelText(label));
    await user.type(screen.getByPlaceholderText('Add notes about this suspension...'), 'spam');
    await user.click(screen.getByRole('button', { name: 'Suspend User' }));
    expect(onConfirm).toHaveBeenCalledWith(hours, 'spam');
  });

  test.each([
    ['2', 'days', 48],
    ['6', 'hours', 6],
  ])('custom %s %s = %i hours', async (amount, unit, hours) => {
    const { onConfirm, user } = setup();
    await user.click(screen.getByLabelText('Custom Duration'));
    await user.type(screen.getByPlaceholderText('Enter duration'), amount);
    await user.selectOptions(screen.getByRole('combobox'), unit);
    await user.click(screen.getByRole('button', { name: 'Suspend User' }));
    expect(onConfirm).toHaveBeenCalledWith(hours, '');
  });

  test.each(['0', '-3'])('a custom duration of %s is refused', async (amount) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { onConfirm, user } = setup();
    await user.click(screen.getByLabelText('Custom Duration'));
    await user.type(screen.getByPlaceholderText('Enter duration'), amount);
    await user.click(screen.getByRole('button', { name: 'Suspend User' }));
    expect(alert).toHaveBeenCalledWith('Please enter a valid duration');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('Suspend is disabled while a custom duration is empty; Cancel closes', async () => {
    const { onClose, user } = setup();
    await user.click(screen.getByLabelText('Custom Duration'));
    expect(screen.getByRole('button', { name: 'Suspend User' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('the user name is rendered as text', () => {
    setup();
    expectRenderedAsText(screen.getByRole('dialog'), XSS_PAYLOADS[1]);
  });

  test('shows progress while suspending', () => {
    render(<SuspensionModal show userName="Kai" onClose={vi.fn()} onConfirm={vi.fn()} isLoading />);
    expect(screen.getByRole('button', { name: 'Suspending...' })).toBeDisabled();
  });
});

describe('DeleteUserModal', () => {
  test('confirms, cancels, and shows errors', async () => {
    const onConfirm = vi.fn(async () => {});
    const onHide = vi.fn();
    render(
      <DeleteUserModal
        show
        onHide={onHide}
        onConfirm={onConfirm}
        userName={XSS_PAYLOADS[0]}
        error="Cannot delete the last admin."
      />,
    );
    const dialog = screen.getByRole('dialog');
    expectRenderedAsText(dialog, XSS_PAYLOADS[0]);
    expect(screen.getByText('Cannot delete the last admin.')).toHaveClass('alert-danger');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
