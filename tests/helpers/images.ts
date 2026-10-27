/** Byte-level builders for real and fake image uploads. */

export const SIGNATURES = {
  jpeg: [0xFF, 0xD8, 0xFF, 0xE0],
  png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  // "RIFF" + 4 size bytes + "WEBP"
  webp: [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  // "RIFF....WAVE": a valid RIFF container that is not WebP
  wav: [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45],
  pngTruncated: [0x89, 0x50, 0x4E, 0x47], // only the first 4 PNG bytes
} as const;

export const textBytes = (text: string) => Array.from(new TextEncoder().encode(text));

export function bytesOf(header: readonly number[], size = 64): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(new ArrayBuffer(Math.max(size, header.length)));
  data.set(header);
  return data;
}

export function makeFile(header: readonly number[], type: string, name = 'avatar.png', size = 64): File {
  return new File([bytesOf(header, size)], name, { type });
}

/** A PNG whose IHDR chunk declares the given width/height (pixel data is not needed to lie about size). */
export function pngWithDimensions(width: number, height: number): Uint8Array<ArrayBuffer> {
  const data = bytesOf(SIGNATURES.png, 33);
  const view = new DataView(data.buffer);
  view.setUint32(8, 13); // IHDR length
  data.set(textBytes('IHDR'), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

export const toArrayBuffer = (data: Uint8Array): ArrayBuffer => (
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
);
