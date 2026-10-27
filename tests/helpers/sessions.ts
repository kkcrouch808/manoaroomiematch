import { vi } from 'vitest';
import { getServerSession, type Session } from 'next-auth';

const expires = '2999-01-01T00:00:00.000Z';

/** Shape produced by authOptions' session callback: role is carried as `randomKey`. */
export const studentSession: Session = {
  user: { id: '5', email: 'john@foo.com', randomKey: 'USER' }, expires,
};
export const otherStudentSession: Session = {
  user: { id: '9', email: 'jane@hawaii.edu', randomKey: 'USER' }, expires,
};
export const adminSession: Session = {
  user: { id: '1', email: 'admin@foo.com', randomKey: 'ADMIN' }, expires,
};

/** Makes the next getServerSession() call(s) return this session (null = signed out). */
export function signInAs(session: Session | null) {
  vi.mocked(getServerSession).mockResolvedValue(session as never);
}
