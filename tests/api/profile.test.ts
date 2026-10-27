import { beforeEach, describe, expect, test } from 'vitest';
import * as profileById from '@/app/api/profile/[userId]/route';
import * as deletePicture from '@/app/api/profile/delete-picture/route';
import * as picture from '@/app/api/profile/picture/route';
import * as profile from '@/app/api/profile/route';
import * as uploadPicture from '@/app/api/profile/upload-picture/route';
import { MAX_FILE_SIZE } from '@/lib/imageProcessing';
import { prismaMock } from '../helpers/prisma-mock';
import { adminSession, signInAs, studentSession } from '../helpers/sessions';
import { formRequest, getRequest, readJson, routeParams } from '../helpers/requests';
import { SIGNATURES, bytesOf, makeFile, pngWithDimensions, textBytes } from '../helpers/images';
import { PATH_TRAVERSAL_FILENAMES, SQL_INJECTION_PAYLOADS } from '../fixtures/malicious-inputs';

describe('POST /api/profile/upload-picture', () => {
  const upload = (file: File | string | null) => {
    const form = new FormData();
    if (file !== null) form.append('file', file);
    return uploadPicture.POST(formRequest('/api/profile/upload-picture', form));
  };

  beforeEach(() => {
    signInAs(studentSession);
    prismaMock.userProfile.findFirst.mockResolvedValue({ id: 'p5', photoUrl: 'data:image/png;base64,old' });
  });

  test.each([
    ['JPEG', SIGNATURES.jpeg, 'image/jpeg'],
    ['PNG', SIGNATURES.png, 'image/png'],
    ['GIF', SIGNATURES.gif, 'image/gif'],
    ['WebP', SIGNATURES.webp, 'image/webp'],
  ])('stores a real %s on the signed-in user\'s own profile', async (_label, header, type) => {
    const { status, body } = await readJson(await upload(makeFile(header, type, 'me.img')));
    expect(status).toBe(200);
    expect(body.photoUrl).toMatch(new RegExp(`^data:${type};base64,`));
    expect(prismaMock.userProfile.findFirst).toHaveBeenCalledWith({
      where: { email: 'john@foo.com' }, select: { id: true, photoUrl: true },
    });
    expect(prismaMock.userProfile.update)
      .toHaveBeenCalledWith({ where: { id: 'p5' }, data: { photoUrl: body.photoUrl } });
  });

  test('accepts exactly 5 MB', async () => {
    expect((await upload(makeFile(SIGNATURES.jpeg, 'image/jpeg', 'max.jpg', MAX_FILE_SIZE))).status).toBe(200);
  });

  test.each([
    ['no file field', null, 'No file provided'],
    ['a text field instead of a file', 'not-a-file', 'No file provided'],
    ['SVG with an onload handler', makeFile(textBytes('<svg onload=alert(1)>'), 'image/svg+xml', 'x.svg'),
      'Invalid file type. Allowed: JPG, PNG, WebP, GIF'],
    ['HTML page', makeFile(textBytes('<html><script>alert(1)</script>'), 'text/html', 'x.html'),
      'Invalid file type. Allowed: JPG, PNG, WebP, GIF'],
    ['PHP script labelled as a JPEG', makeFile(textBytes('<?php system($_GET["c"]); ?>'), 'image/jpeg', 'x.jpg'),
      'File content does not match declared type'],
    ['PNG bytes labelled as a GIF', makeFile(SIGNATURES.png, 'image/gif', 'x.gif'),
      'File content does not match declared type'],
    ['WAV audio labelled as WebP', makeFile(SIGNATURES.wav, 'image/webp', 'x.webp'),
      'File content does not match declared type'],
    ['empty file', new File([], 'empty.png', { type: 'image/png' }), 'File content does not match declared type'],
    ['5 MB + 1 byte', makeFile(SIGNATURES.jpeg, 'image/jpeg', 'big.jpg', MAX_FILE_SIZE + 1),
      'File too large. Maximum size: 5MB'],
  ])('rejects %s with 400 and does not touch the profile', async (_label, file, error) => {
    const { status, body } = await readJson(await upload(file as File));
    expect(status).toBe(400);
    expect(body.error).toBe(error);
    expect(prismaMock.userProfile.update).not.toHaveBeenCalled();
  });

  test.each([...PATH_TRAVERSAL_FILENAMES])('a valid image named %j is stored as data, not a path', async (name) => {
    const { status, body } = await readJson(await upload(makeFile(SIGNATURES.png, 'image/png', name)));
    expect(status).toBe(200);
    expect(body.photoUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(body.photoUrl).not.toContain(name);
  });

  test('a GIF/script polyglot is stored with its validated image type, so it can only render as an image', async () => {
    const polyglot = makeFile([...SIGNATURES.gif, ...textBytes('<script>alert(1)</script>')], 'image/gif', 'p.gif');
    const { status, body } = await readJson(await upload(polyglot));
    expect(status).toBe(200);
    expect(body.photoUrl).toMatch(/^data:image\/gif;base64,/);
  });

  // KNOWN GAP: neither this route nor imageProcessing.ts enforces the 4096px MAX_DIMENSION
  test.fails('rejects an image that declares 100000x100000 pixels', async () => {
    const bomb = new File([pngWithDimensions(100_000, 100_000)], 'bomb.png', { type: 'image/png' });
    expect((await upload(bomb)).status).toBe(400);
  });

  // WEAKNESS: the route has its own copy of the validation and checks only the first 4 PNG bytes
  // (imageProcessing.ts checks all 8), so a file that starts with "\x89PNG" and then garbage is accepted.
  test.fails('rejects a file with only the first 4 PNG signature bytes', async () => {
    const header = [...SIGNATURES.pngTruncated, ...textBytes('<html>')];
    const fake = new File([bytesOf(header)], 'f.png', { type: 'image/png' });
    expect((await upload(fake)).status).toBe(400);
  });

  test('404 without a profile, 500 when saving fails', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValueOnce(null);
    expect((await upload(makeFile(SIGNATURES.png, 'image/png'))).status).toBe(404);
    prismaMock.userProfile.update.mockRejectedValueOnce(new Error('db'));
    expect((await upload(makeFile(SIGNATURES.png, 'image/png'))).status).toBe(500);
  });
});

describe('profile picture read/delete', () => {
  beforeEach(() => signInAs(studentSession));

  test('GET /api/profile/picture returns the caller\'s photo or null', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValueOnce({ photoUrl: 'data:x' }).mockResolvedValueOnce(null);
    expect((await readJson(await picture.GET())).body).toEqual({ photoUrl: 'data:x' });
    expect((await readJson(await picture.GET())).body).toEqual({ photoUrl: null });
    expect(prismaMock.userProfile.findFirst)
      .toHaveBeenCalledWith({ where: { email: 'john@foo.com' }, select: { photoUrl: true } });
    prismaMock.userProfile.findFirst.mockRejectedValueOnce(new Error('db'));
    expect((await picture.GET()).status).toBe(500);
  });

  test('DELETE /api/profile/delete-picture clears only the caller\'s photo', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValue({ id: 'p5', photoUrl: 'data:x' });
    expect(await readJson(await deletePicture.DELETE())).toEqual({ status: 200, body: { success: true } });
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({ where: { id: 'p5' }, data: { photoUrl: null } });
  });

  test('DELETE returns 404 without a profile and 500 on errors', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValueOnce(null);
    expect((await deletePicture.DELETE()).status).toBe(404);
    prismaMock.userProfile.findFirst.mockRejectedValueOnce(new Error('db'));
    expect((await deletePicture.DELETE()).status).toBe(500);
  });
});

describe('GET /api/profile/[userId]', () => {
  const get = (userId: string) => profileById.GET(getRequest('/'), routeParams({ userId }));
  beforeEach(() => signInAs(studentSession));

  test('a numeric id is a User id', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ id: 'p7', userId: 7 });
    expect(await readJson(await get('7')))
      .toEqual({ status: 200, body: { profile: { id: 'p7', userId: 7 }, userId: 7 } });
    expect(prismaMock.userProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 7 } });
  });

  test('anything else is a profile id (cuid)', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ id: 'ckxyz', userId: 7 });
    await get('ckxyz');
    expect(prismaMock.userProfile.findUnique).toHaveBeenCalledWith({ where: { id: 'ckxyz' } });
  });

  test.each([...SQL_INJECTION_PAYLOADS])('id %j is used only as a lookup value', async (id) => {
    prismaMock.userProfile.findUnique.mockResolvedValue(null);
    expect((await get(id)).status).toBe(404);
    expect(prismaMock.userProfile.findUnique).toHaveBeenCalledWith({ where: { id } });
  });

  test('400 for an empty id, 500 on errors', async () => {
    expect((await get('')).status).toBe(400);
    prismaMock.userProfile.findUnique.mockRejectedValue(new Error('db'));
    expect((await get('7')).status).toBe(500);
  });
});

describe('GET /api/profile?email= (admin lookup)', () => {
  beforeEach(() => signInAs(adminSession));

  test('returns the profile with that email', async () => {
    prismaMock.userProfile.findFirst.mockResolvedValue({ id: 'p7' });
    expect((await readJson(await profile.GET(getRequest('/api/profile?email=kai%40hawaii.edu')))).body)
      .toEqual({ profile: { id: 'p7' } });
    expect(prismaMock.userProfile.findFirst).toHaveBeenCalledWith({ where: { email: 'kai@hawaii.edu' } });
  });

  test('400 without email, 404 when unknown, 500 on errors', async () => {
    expect((await profile.GET(getRequest('/api/profile'))).status).toBe(400);
    prismaMock.userProfile.findFirst.mockResolvedValueOnce(null);
    expect((await profile.GET(getRequest('/api/profile?email=x'))).status).toBe(404);
    prismaMock.userProfile.findFirst.mockRejectedValueOnce(new Error('db'));
    expect((await profile.GET(getRequest('/api/profile?email=x'))).status).toBe(500);
  });
});
