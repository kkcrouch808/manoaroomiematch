import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePictureUpload from '@/components/ProfilePictureUpload';
import { ProfilePictureProvider, useProfilePicture } from '@/contexts/ProfilePictureContext';
import { callsTo, mockFetch } from '../helpers/fetch-mock';
import { SIGNATURES, makeFile, textBytes } from '../helpers/images';

const session = vi.hoisted(() => ({ status: 'authenticated' as string }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: session.status === 'authenticated' ? { user: { email: 'john@foo.com' } } : null,
    status: session.status,
  }),
}));

/**
 * FileReader whose preview completes only when the test calls finish(), so the order of "local preview
 * ready" and "server answered" is deterministic instead of depending on timing.
 */
const readers: { finish: () => void }[] = [];
class ControlledFileReader {
  result: string | null = null;

  onloadend: (() => void) | null = null;

  readAsDataURL(file: File) {
    this.result = `data:${file.type};base64,LOCAL-PREVIEW`;
    readers.push({ finish: () => act(() => this.onloadend?.()) });
  }
}

/** Lets the test decide when the upload response arrives. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

beforeEach(() => {
  readers.length = 0;
  session.status = 'authenticated';
  vi.stubGlobal('FileReader', ControlledFileReader);
});

function renderUpload() {
  const view = render(<ProfilePictureProvider><ProfilePictureUpload /></ProfilePictureProvider>);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  // fireEvent bypasses the input's accept= filter, like a user choosing "All files" in the picker
  const choose = (file: File) => fireEvent.change(input, { target: { files: [file] } });
  return { ...view, input, choose };
}

describe('ProfilePictureUpload with ProfilePictureProvider', () => {
  test('loads the current photo for a signed-in user', async () => {
    mockFetch({ '/api/profile/picture': () => ({ body: { photoUrl: '/me.png' } }) });
    renderUpload();
    expect(await screen.findByRole('button', { name: 'Change Photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  test('accepts only image types the server allows', () => {
    mockFetch({ '/api/profile/picture': () => ({ body: { photoUrl: null } }) });
    const { input } = renderUpload();
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
  });

  test.each([
    ['an SVG', makeFile(textBytes('<svg onload=alert(1)>'), 'image/svg+xml', 'x.svg'),
      'Please upload a JPG, PNG, WebP, or GIF image'],
    ['an HTML file', makeFile(textBytes('<script>'), 'text/html', 'x.html'),
      'Please upload a JPG, PNG, WebP, or GIF image'],
    ['a 6 MB JPEG', makeFile(SIGNATURES.jpeg, 'image/jpeg', 'big.jpg', 6 * 1024 * 1024), 'Image must be less than 5MB'],
  ])('rejects %s before uploading', async (_label, file, message) => {
    const fetchMock = mockFetch({ '/api/profile/picture': () => ({ body: { photoUrl: null } }) });
    const { choose } = renderUpload();
    choose(file);
    expect(await screen.findByText(message)).toHaveClass('alert-danger');
    expect(callsTo(fetchMock, '/api/profile/upload-picture')).toHaveLength(0);
    expect(readers).toHaveLength(0);
  });

  test('previews locally, then shows the uploaded image', async () => {
    const response = gate();
    const fetchMock = mockFetch({
      '/api/profile/picture': () => ({ body: { photoUrl: null } }),
      'POST /api/profile/upload-picture': async () => {
        await response.opened;
        return { body: { success: true, photoUrl: 'data:image/png;base64,SERVER' } };
      },
    });
    const { choose } = renderUpload();
    choose(makeFile(SIGNATURES.png, 'image/png'));

    readers[0].finish();
    expect(screen.getByAltText('Profile')).toHaveAttribute('src', 'data:image/png;base64,LOCAL-PREVIEW');
    response.open();
    await waitFor(() => expect(screen.getByAltText('Profile')).toHaveAttribute('src', 'data:image/png;base64,SERVER'));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    const [call] = callsTo(fetchMock, '/api/profile/upload-picture');
    expect((call.body as FormData).get('file')).toBeInstanceOf(File);
  });

  test('shows the server\'s reason and drops the preview when it rejects a spoofed image', async () => {
    const response = gate();
    mockFetch({
      '/api/profile/picture': () => ({ body: { photoUrl: null } }),
      'POST /api/profile/upload-picture': async () => {
        await response.opened;
        return { status: 400, body: { error: 'File content does not match declared type' } };
      },
    });
    const { choose } = renderUpload();
    choose(makeFile(textBytes('<?php'), 'image/png'));
    readers[0].finish();
    response.open();
    expect(await screen.findByText('File content does not match declared type')).toBeInTheDocument();
    expect(screen.queryByAltText('Profile')).toBeNull();
  });

  /*
   * KNOWN BUG (race): handleFile() starts the FileReader preview and the upload together and clears the
   * preview when the upload settles. If the server answers first (e.g. a fast rejection), the reader's
   * onloadend runs afterwards and sets the preview again permanently: the rejected image stays on screen,
   * the real photo is hidden, and the Remove button disappears.
   */
  test.fails('KNOWN DEFECT: a rejected image stays hidden when the server answers before the preview', async () => {
    mockFetch({
      '/api/profile/picture': () => ({ body: { photoUrl: null } }),
      'POST /api/profile/upload-picture': () => ({
        status: 400, body: { error: 'File content does not match declared type' },
      }),
    });
    const { choose } = renderUpload();
    choose(makeFile(textBytes('<?php'), 'image/png'));
    await screen.findByText('File content does not match declared type');
    readers[0].finish();
    expect(screen.queryByAltText('Profile')).toBeNull();
  });

  test('accepts a dropped file', async () => {
    const response = gate();
    mockFetch({
      '/api/profile/picture': () => ({ body: { photoUrl: null } }),
      'POST /api/profile/upload-picture': async () => {
        await response.opened;
        return { body: { photoUrl: 'data:image/gif;base64,R0lG' } };
      },
    });
    renderUpload();
    const zone = screen.getByRole('button', { name: 'Upload profile picture' });
    fireEvent.dragEnter(zone);
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile(SIGNATURES.gif, 'image/gif', 'a.gif')] } });
    readers[0].finish();
    response.open();
    await waitFor(() => expect(screen.getByAltText('Profile')).toHaveAttribute('src', 'data:image/gif;base64,R0lG'));
  });

  test('removes the photo, and reports a failed removal', async () => {
    let deleteStatus = 500;
    mockFetch({
      '/api/profile/picture': () => ({ body: { photoUrl: '/me.png' } }),
      'DELETE /api/profile/delete-picture': () => ({
        status: deleteStatus, body: { error: 'Failed to delete image.' },
      }),
    });
    renderUpload();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Failed to delete image.')).toBeInTheDocument();
    deleteStatus = 200;
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload Photo' })).toBeInTheDocument());
  });

  test('network failures during upload show a retry message', async () => {
    mockFetch({
      '/api/profile/picture': () => { throw new Error('offline'); },
      'POST /api/profile/upload-picture': () => { throw new Error('offline'); },
    });
    const { choose } = renderUpload();
    choose(makeFile(SIGNATURES.png, 'image/png'));
    expect(await screen.findByText('Upload failed. Please try again.')).toBeInTheDocument();
  });

  test('signed-out users never fetch a picture', () => {
    session.status = 'unauthenticated';
    const fetchMock = mockFetch({});
    renderUpload();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

test('useProfilePicture outside its provider throws a helpful error', () => {
  const Orphan = () => { useProfilePicture(); return null; };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => render(<Orphan />)).toThrow('useProfilePicture must be used within a ProfilePictureProvider');
});
