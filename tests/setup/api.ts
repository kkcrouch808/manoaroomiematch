import { vi } from 'vitest';

// Route handlers read the caller's identity from getServerSession; tests choose it per case
vi.mock('next-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-auth')>()),
  getServerSession: vi.fn(),
}));
