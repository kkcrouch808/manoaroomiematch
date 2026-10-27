import { describe, expect, test, vi } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  MAX_DIMENSION,
  MAX_FILE_SIZE,
  generateSafeFilename,
  isAllowedMimeType,
  mimeToExtension,
  validateFileSize,
  validateImageUpload,
  validateMagicBytes,
} from '@/lib/imageProcessing';
import { PATH_TRAVERSAL_FILENAMES, PATH_TRAVERSAL_IDS } from '../../fixtures/malicious-inputs';
import { SIGNATURES, bytesOf, makeFile, pngWithDimensions, textBytes, toArrayBuffer } from '../../helpers/images';

describe('isAllowedMimeType', () => {
  test.each([...ALLOWED_MIME_TYPES])('allows %s', (type) => {
    expect(isAllowedMimeType(type)).toBe(true);
  });

  test.each([
    'image/svg+xml', 'text/html', 'application/x-php', 'application/octet-stream',
    'IMAGE/PNG', 'image/png; charset=utf-8', '',
  ])('rejects %j', (type) => {
    expect(isAllowedMimeType(type)).toBe(false);
  });
});

describe('validateFileSize (5 MB limit)', () => {
  test.each([
    ['empty', 0, true],
    ['1 byte under the limit', MAX_FILE_SIZE - 1, true],
    ['exactly 5 MB', MAX_FILE_SIZE, true],
    ['1 byte over the limit', MAX_FILE_SIZE + 1, false],
    ['100 MB', 100 * 1024 * 1024, false],
  ])('%s', (_label, size, valid) => {
    const result = validateFileSize(size);
    expect(result.valid).toBe(valid);
    if (!valid) expect(result.error).toBe('File too large. Maximum size: 5MB');
  });
});

describe('validateMagicBytes', () => {
  test.each([
    ['image/jpeg', SIGNATURES.jpeg],
    ['image/png', SIGNATURES.png],
    ['image/gif', SIGNATURES.gif],
    ['image/webp', SIGNATURES.webp],
  ])('accepts a genuine %s header', (type, header) => {
    expect(validateMagicBytes(toArrayBuffer(bytesOf(header)), type)).toEqual({ valid: true });
  });

  test.each([
    ['PNG bytes declared as JPEG', 'image/jpeg', SIGNATURES.png],
    ['HTML declared as PNG', 'image/png', textBytes('<html><script>alert(1)</script>')],
    ['PHP declared as GIF', 'image/gif', textBytes('<?php system($_GET["c"]); ?>')],
    ['truncated PNG signature', 'image/png', SIGNATURES.pngTruncated],
    ['empty file', 'image/jpeg', []],
  ])('rejects %s', (_label, type, header) => {
    expect(validateMagicBytes(toArrayBuffer(bytesOf(header, header.length)), type)).toEqual({
      valid: false,
      error: 'File content does not match declared type',
    });
  });

  test('rejects a RIFF file that is not WebP (e.g. WAV audio)', () => {
    expect(validateMagicBytes(toArrayBuffer(bytesOf(SIGNATURES.wav)), 'image/webp'))
      .toEqual({ valid: false, error: 'Invalid WebP file' });
  });

  test('rejects types it has no signature for', () => {
    expect(validateMagicBytes(toArrayBuffer(bytesOf(textBytes('<svg/>'))), 'image/svg+xml'))
      .toEqual({ valid: false, error: 'Unsupported file type' });
  });
});

describe('validateImageUpload', () => {
  test('accepts a real PNG', async () => {
    await expect(validateImageUpload(makeFile(SIGNATURES.png, 'image/png'))).resolves.toEqual({ valid: true });
  });

  test.each([
    ['nothing', null, 'No file provided'],
    ['a Blob instead of a File', new Blob(['x']), 'No file provided'],
    ['an SVG (can carry script)', makeFile(textBytes('<svg onload=alert(1)>'), 'image/svg+xml', 'a.svg'),
      'Invalid file type. Allowed: JPG, PNG, WebP, GIF'],
    ['an oversized JPEG', makeFile(SIGNATURES.jpeg, 'image/jpeg', 'big.jpg', MAX_FILE_SIZE + 1),
      'File too large. Maximum size: 5MB'],
    ['a script renamed to .png', makeFile(textBytes('#!/bin/sh\nrm -rf /'), 'image/png', 'evil.png'),
      'File content does not match declared type'],
  ])('rejects %s', async (_label, file, error) => {
    await expect(validateImageUpload(file as File)).resolves.toEqual({ valid: false, error });
  });

  test('accepts a declared 4096x4096 PNG (the documented maximum)', async () => {
    const file = new File([pngWithDimensions(MAX_DIMENSION, MAX_DIMENSION)], 'max.png', { type: 'image/png' });
    await expect(validateImageUpload(file)).resolves.toEqual({ valid: true });
  });

  // KNOWN GAP: MAX_DIMENSION (4096) and MIN_DIMENSION (100) are exported but never checked, so a tiny file
  // that declares a 100000x100000 image (a "decompression bomb" for anything that decodes it) passes.
  test.fails('KNOWN DEFECT: rejects a PNG that declares 100000x100000 pixels', async () => {
    const file = new File([pngWithDimensions(100_000, 100_000)], 'bomb.png', { type: 'image/png' });
    expect((await validateImageUpload(file)).valid).toBe(false);
  });
});

describe('generateSafeFilename', () => {
  const SAFE = /^[A-Za-z0-9_-]+\/\d+-[a-z0-9]{0,6}\.(jpg|jpeg|png|webp|gif)$/;

  test('namespaces by user and keeps an allowed extension (case-insensitive)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    expect(generateSafeFilename('Holiday.PNG', 'user_42')).toMatch(/^user_42\/1700000000000-[a-z0-9]{0,6}\.png$/);
  });

  test.each([...PATH_TRAVERSAL_FILENAMES, 'noextension', ''])(
    'filename %j cannot choose the path or a risky extension',
    (name) => {
      const result = generateSafeFilename(name, 'user1');
      expect(result).toMatch(SAFE);
      expect(result.startsWith('user1/')).toBe(true);
    },
  );

  test.each([...PATH_TRAVERSAL_IDS])('user id %j cannot escape its folder', (userId) => {
    const result = generateSafeFilename('a.jpg', userId);
    expect(result).toMatch(SAFE);
    expect(result).not.toContain('..');
    expect(result.split('/')).toHaveLength(2);
  });
});

describe('mimeToExtension', () => {
  test.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/svg+xml', 'jpg'],
    ['', 'jpg'],
  ])('%j -> %s', (type, ext) => {
    expect(mimeToExtension(type)).toBe(ext);
  });
});
