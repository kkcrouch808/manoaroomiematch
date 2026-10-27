import { expect } from 'vitest';

/**
 * Asserts a hostile string was rendered as visible text: it appears verbatim in the DOM text, and the markup
 * it contains was not turned into elements (no <script>, injected <img>/<svg>/<iframe>, or inline handlers).
 */
export default function expectRenderedAsText(container: HTMLElement, payload: string) {
  expect(container.textContent).toContain(payload);
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('iframe')).toBeNull();
  expect(container.querySelector('img[src="x"]')).toBeNull();
  expect(container.querySelector('[onerror], [onload], [onclick]')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
}
