import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its own cleanup
afterEach(() => {
  cleanup();
});

// jsdom does not implement scrolling; the chat views call scrollIntoView after rendering
Element.prototype.scrollIntoView = vi.fn();
