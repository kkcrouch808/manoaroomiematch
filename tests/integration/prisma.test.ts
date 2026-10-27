/**
 * Integration tests against a real PostgreSQL database (the CI service container, or a local throwaway DB).
 * Route handlers and lib functions run unmodified; only getServerSession is mocked to pick the caller.
 * Every row created here uses a per-run prefix and is removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { compare } from 'bcrypt';
import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createUser } from '@/lib/dbActions';
import { getConversation } from '@/lib/messaging';
import authOptions from '@/lib/authOptions';
import * as usersSearch from '@/app/api/users/search/route';
import * as send from '@/app/api/messages/send/route';
import * as blockUser from '@/app/api/messages/block-user/[userId]/route';
import * as flags from '@/app/api/flags/route';
import * as resolveFlag from '@/app/api/admin/resolve-flag/route';
import * as adminUsers from '@/app/api/admin/users/route';
import * as deleteAccount from '@/app/api/delete user/route';
import { LIKE_WILDCARDS, SQL_INJECTION_PAYLOADS } from '../fixtures/malicious-inputs';

vi.mock('next-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-auth')>()),
  getServerSession: vi.fn(),
}));

const RUN = `it${Date.now()}`;
const email = (name: string) => `${RUN}-${name}@hawaii.edu`;
const ORIGIN = 'http://localhost:3000';
const json = (body: unknown) => new NextRequest(ORIGIN, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

type Account = { id: number; email: string; role: string };
const accounts: Record<string, Account> = {};

function actAs(account: Account | null) {
  const session = account && {
    user: { id: String(account.id), email: account.email, randomKey: account.role },
    expires: '2999',
  };
  vi.mocked(getServerSession).mockResolvedValue(session as never);
}

async function makeAccount(key: string, firstName: string, role: 'USER' | 'ADMIN' = 'USER') {
  await createUser({ email: email(key), password: 'changeme', firstName, lastName: RUN });
  const user = await prisma.user.update({ where: { email: email(key) }, data: { role } });
  accounts[key] = { id: user.id, email: user.email, role };
  return accounts[key];
}

/** Removes every row this run created, children first. */
async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: RUN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  const profiles = await prisma.userProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const profileIds = profiles.map((p) => p.id);
  const matches = await prisma.match.findMany({
    where: { OR: [{ user1Id: { in: profileIds } }, { user2Id: { in: profileIds } }] }, select: { id: true },
  });
  await prisma.aIExplanation.deleteMany({ where: { match_id: { in: matches.map((m) => m.id) } } });
  await prisma.match.deleteMany({ where: { id: { in: matches.map((m) => m.id) } } });
  await prisma.moderationAction.deleteMany({
    where: { OR: [{ targetUserId: { in: ids } }, { adminUserId: { in: ids } }] },
  });
  await prisma.notification.deleteMany({ where: { user_id: { in: ids } } });
  await prisma.flag.deleteMany({
    where: { OR: [{ reported_by_user_id: { in: ids } }, { reported_user_id: { in: ids } }] },
  });
  await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  if (!process.env.POSTGRES_PRISMA_URL) {
    throw new Error('Set POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING to a throwaway, migrated database');
  }
  await makeAccount('kai', 'Kai');
  await makeAccount('lani', 'Lani');
  await makeAccount('mod', 'Moderator', 'ADMIN');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('users and credentials (Prisma + bcrypt + next-auth)', () => {
  test('the stored password is a bcrypt hash that authorize() accepts', async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email('kai') } });
    expect(row.password).not.toBe('changeme');
    await expect(compare('changeme', row.password)).resolves.toBe(true);

    const { authorize } = (authOptions.providers[0] as unknown as {
      options: { authorize: (c: Record<string, string>, r: unknown) => Promise<unknown> };
    }).options;
    await expect(authorize({ email: email('kai'), password: 'changeme' }, {}))
      .resolves.toEqual({ id: String(row.id), email: email('kai'), randomKey: 'USER' });
    await expect(authorize({ email: email('kai'), password: 'wrong' }, {})).resolves.toBeNull();
  });

  test('the unique email constraint rejects a second account with the same email', async () => {
    await expect(createUser({ email: email('kai'), password: 'x', firstName: 'Dup', lastName: 'Dup' }))
      .rejects.toThrow('Email already exists');
    await expect(prisma.user.count({ where: { email: email('kai') } })).resolves.toBe(1);
  });

  test('email lookups are exact: case and whitespace variants are different accounts', async () => {
    await expect(prisma.user.findUnique({ where: { email: email('kai').toUpperCase() } })).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { email: ` ${email('kai')}` } })).resolves.toBeNull();
  });
});

describe('GET /api/users/search treats user input as data', () => {
  const search = async (q: string) => {
    const response = await usersSearch.GET(new NextRequest(`${ORIGIN}/api/users/search?q=${encodeURIComponent(q)}`));
    return { status: response.status, users: (await response.json()).users as { email: string }[] };
  };

  test('finds other users by name, never the caller', async () => {
    actAs(accounts.kai);
    const { users } = await search(RUN);
    const found = users.map((u) => u.email).sort();
    expect(found).toEqual([email('lani'), email('mod')].sort());
  });

  test.each([...SQL_INJECTION_PAYLOADS])('SQL-injection query %j matches nobody and drops nothing', async (q) => {
    actAs(accounts.kai);
    const { status, users } = await search(q);
    expect(status).toBe(200);
    expect(users).toEqual([]);
    await expect(prisma.user.count({ where: { email: { startsWith: RUN } } })).resolves.toBe(3);
  });

  test('a backslash is matched literally', async () => {
    actAs(accounts.kai);
    expect((await search('\\')).users).toEqual([]);
  });

  /*
   * KNOWN WEAKNESS (wildcard injection / user enumeration): Prisma's `contains` does not escape LIKE
   * wildcards on PostgreSQL, so a search for "%" or "_" matches every active user and returns up to 20
   * emails per request. No account here has a literal % or _ in its email or name, so [] is correct.
   */
  const wildcards = LIKE_WILDCARDS.filter((q) => q !== '\\');
  test.fails.each(wildcards)('KNOWN DEFECT: LIKE wildcard %j is matched literally', async (q) => {
    actAs(accounts.kai);
    expect((await search(q)).users).toEqual([]);
  });
});

describe('messaging and blocking', () => {
  test('a blocked user cannot message the person who blocked them', async () => {
    actAs(accounts.lani);
    const blocked = await blockUser.POST(json({}), { params: { userId: String(accounts.kai.id) } });
    expect(blocked.status).toBe(201);

    actAs(accounts.kai);
    const response = await send.POST(json({ receiverId: accounts.lani.id, content: 'hello?' }));
    expect(response.status).toBe(403);
    await expect(prisma.message.count({ where: { senderId: accounts.kai.id } })).resolves.toBe(0);
  });

  test('a conversation only contains messages between its two participants', async () => {
    actAs(accounts.lani);
    expect((await send.POST(json({ receiverId: accounts.kai.id, content: '<script>alert(1)</script>' }))).status)
      .toBe(201);
    actAs(accounts.mod);
    expect((await send.POST(json({ receiverId: accounts.kai.id, content: 'admin note' }))).status).toBe(201);

    const { messages } = await getConversation(accounts.kai.id, accounts.lani.id);
    expect(messages.map((m) => m.content)).toEqual(['<script>alert(1)</script>']);
  });
});

describe('reporting and moderation', () => {
  test('a student report creates a pending flag; a second one while pending is refused', async () => {
    actAs(accounts.kai);
    const first = await flags.POST(json({ reportedUserId: accounts.lani.id, reason: 'spam' }));
    expect(first.status).toBe(201);
    const again = await flags.POST(json({ reportedUserId: accounts.lani.id, reason: 'spam again' }));
    expect(again.status).toBe(409);
  });

  test('resolving a flag records an audit entry and notifies the reporter', async () => {
    const flag = await prisma.flag.findFirstOrThrow({ where: { reported_by_user_id: accounts.kai.id } });
    actAs(accounts.mod);
    const response = await resolveFlag.POST(json({ flagId: flag.id, action: 'resolve', notes: 'warned' }));
    expect(response.status).toBe(200);
    await expect(prisma.moderationAction.count({ where: { flagId: flag.id, action: 'resolve' } })).resolves.toBe(1);
    await expect(prisma.notification.count({ where: { user_id: accounts.kai.id } })).resolves.toBe(1);
  });

  /*
   * KNOWN BUG: /api/flags only refuses a new report while an earlier one is *pending* ("if it's resolved"
   * the user may report again; admins may always file more), but schema.prisma has
   * @@unique([reported_by_user_id, reported_user_id]). The second report fails with P2002 and a 500.
   */
  test.fails('KNOWN DEFECT: after a report is resolved, the same student can report the user again', async () => {
    actAs(accounts.kai);
    const response = await flags.POST(json({ reportedUserId: accounts.lani.id, reason: 'still spamming' }));
    expect(response.status).toBe(201);
  });
});

describe('account deletion cleans up', () => {
  test('deleting your own account removes your profile, matches, messages and flags', async () => {
    const temp = await makeAccount('temp', 'Temp');
    const tempProfile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: temp.id } });
    const kaiProfile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: accounts.kai.id } });
    const match = await prisma.match.create({
      data: { user1Id: tempProfile.id, user2Id: kaiProfile.id, overallScore: 50, categoryScores: {} },
    });
    await prisma.aIExplanation.create({ data: { match_id: match.id, strengths_text: 'x' } });
    await prisma.message.create({ data: { senderId: temp.id, receiverId: accounts.kai.id, content: 'bye' } });
    await prisma.flag.create({
      data: { reported_by_user_id: accounts.kai.id, reported_user_id: temp.id, reason: 'r' },
    });

    actAs(temp);
    expect((await deleteAccount.POST(json({ password: 'wrong' }))).status).toBe(400);
    await expect(prisma.user.count({ where: { id: temp.id } })).resolves.toBe(1);

    expect((await deleteAccount.POST(json({ password: 'changeme' }))).status).toBe(200);
    await expect(prisma.user.count({ where: { id: temp.id } })).resolves.toBe(0);
    await expect(prisma.userProfile.count({ where: { userId: temp.id } })).resolves.toBe(0);
    await expect(prisma.match.count({ where: { id: match.id } })).resolves.toBe(0);
    await expect(prisma.message.count({ where: { senderId: temp.id } })).resolves.toBe(0);
    await expect(prisma.flag.count({ where: { reported_user_id: temp.id } })).resolves.toBe(0);
    // The other user is untouched
    await expect(prisma.userProfile.count({ where: { id: kaiProfile.id } })).resolves.toBe(1);
  });

  /*
   * KNOWN BUG: the self-service delete route does not delete ModerationAction rows, which reference the user
   * with ON DELETE RESTRICT. Anyone who has ever been moderated (or any admin who moderated) cannot delete
   * their account: the transaction fails with a foreign-key error and the route answers 500.
   */
  test.fails('KNOWN DEFECT: a user who has been moderated can still delete their own account', async () => {
    const temp = await makeAccount('moderated', 'Moderated');
    await prisma.moderationAction.create({
      data: { targetUserId: temp.id, adminUserId: accounts.mod.id, action: 'resolve' },
    });
    actAs(temp);
    expect((await deleteAccount.POST(json({ password: 'changeme' }))).status).toBe(200);
  });

  /*
   * KNOWN BUG: the admin delete route removes matches without first removing their AIExplanation rows, so a
   * user with an AI explanation on any match cannot be deleted by an admin (500, foreign-key error).
   */
  test.fails('KNOWN DEFECT: an admin can delete a user whose match has an AI explanation', async () => {
    const temp = await makeAccount('withai', 'WithAI');
    const tempProfile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: temp.id } });
    const laniProfile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: accounts.lani.id } });
    const match = await prisma.match.create({
      data: { user1Id: tempProfile.id, user2Id: laniProfile.id, overallScore: 70, categoryScores: {} },
    });
    await prisma.aIExplanation.create({ data: { match_id: match.id, strengths_text: 'x' } });

    actAs(accounts.mod);
    const response = await adminUsers.POST(json({ id: String(temp.id) }));
    expect(response.status).toBe(200);
  });

  test('an admin can delete a user with messages, flags and moderation history', async () => {
    const temp = await makeAccount('admindel', 'AdminDel');
    await prisma.message.create({ data: { senderId: temp.id, receiverId: accounts.lani.id, content: 'hi' } });
    await prisma.moderationAction.create({
      data: { targetUserId: temp.id, adminUserId: accounts.mod.id, action: 'suspend' },
    });
    actAs(accounts.mod);
    expect((await adminUsers.POST(json({ id: String(temp.id) }))).status).toBe(200);
    await expect(prisma.user.count({ where: { id: temp.id } })).resolves.toBe(0);
    await expect(prisma.moderationAction.count({ where: { targetUserId: temp.id } })).resolves.toBe(0);
  });
});
