import { beforeEach, describe, expect, test } from 'vitest';
import * as blockUser from '@/app/api/messages/block-user/[userId]/route';
import * as checkBlocked from '@/app/api/messages/check-blocked/[userId]/route';
import * as conversation from '@/app/api/messages/conversation/[userId]/route';
import * as conversations from '@/app/api/messages/conversations/route';
import * as markConversationReadById from '@/app/api/messages/mark-conversation-read/[userId]/route';
import * as markConversationRead from '@/app/api/messages/mark-conversation-read/route';
import * as markRead from '@/app/api/messages/mark-read/route';
import * as sendConversation from '@/app/api/messages/send/conversation/[userId]/route';
import * as send from '@/app/api/messages/send/route';
import * as unblockUser from '@/app/api/messages/unblock-user/[userId]/route';
import * as unreadCount from '@/app/api/messages/unread-count/route';
import { prismaMock } from '../helpers/prisma-mock';
import { signInAs, studentSession } from '../helpers/sessions';
import { getRequest, jsonRequest, readJson, routeParams } from '../helpers/requests';
import { BAD_NUMERIC_IDS, OVERSIZED_STRINGS, SQL_INJECTION_PAYLOADS, XSS_PAYLOADS } from '../fixtures/malicious-inputs';

const ME = { id: 5, email: 'john@foo.com' };

beforeEach(() => {
  signInAs(studentSession);
});

/** Routes that look the caller up by session email need this row. */
const meExists = () => prismaMock.user.findUnique.mockResolvedValue(ME);

describe('POST /api/messages/send', () => {
  const sendAs = (body: unknown) => send.POST(jsonRequest('/api/messages/send', body));

  beforeEach(() => {
    meExists();
    prismaMock.message.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  });

  test('stores a message from the signed-in user (never a sender id from the body)', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: {} });
    const { status, body } = await readJson(await sendAs({ receiverId: '7', content: 'Aloha!', senderId: 1 }));
    expect(status).toBe(201);
    expect(body).toMatchObject({ senderId: 5, receiverId: 7, content: 'Aloha!', isRead: false });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'john@foo.com' } });
  });

  test('refuses to deliver to a user who blocked the sender (403)', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: { blockedUsers: [3, 5] } });
    const { status, body } = await readJson(await sendAs({ receiverId: 7, content: 'hello?' }));
    expect(status).toBe(403);
    expect(body.error).toMatch(/blocked/);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  test.each([
    ['no block list', { preferences: {} }],
    ['blocked someone else', { preferences: { blockedUsers: [99] } }],
    ['malformed block list', { preferences: { blockedUsers: '5' } }],
    ['receiver has no profile', null],
  ])('delivers when the receiver has %s', async (_label, profile) => {
    prismaMock.userProfile.findUnique.mockResolvedValue(profile);
    expect((await sendAs({ receiverId: 7, content: 'hi' })).status).toBe(201);
  });

  test.each([
    ['missing content', { receiverId: 7 }],
    ['empty content', { receiverId: 7, content: '' }],
    ['missing receiver', { content: 'hi' }],
  ])('rejects %s with 400', async (_label, body) => {
    expect((await sendAs(body)).status).toBe(400);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  test.each([...XSS_PAYLOADS, ...SQL_INJECTION_PAYLOADS])('stores hostile content %j verbatim', async (content) => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: {} });
    const { status, body } = await readJson(await sendAs({ receiverId: 7, content }));
    expect(status).toBe(201);
    expect(body.content).toBe(content);
  });

  // WEAKNESS: there is no maximum message length; a 1 MB message is stored and sent to the recipient.
  test.fails('KNOWN DEFECT: rejects a 1 MB message', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: {} });
    expect((await sendAs({ receiverId: 7, content: OVERSIZED_STRINGS.oneMegabyte })).status).toBe(400);
  });

  test('returns 404 when the session user no longer exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await sendAs({ receiverId: 7, content: 'hi' })).status).toBe(404);
  });

  test('returns 500 when the database rejects the message (e.g. unknown receiver)', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue(null);
    prismaMock.message.create.mockRejectedValue(new Error('Foreign key constraint failed'));
    expect((await sendAs({ receiverId: 999, content: 'hi' })).status).toBe(500);
  });

  test('returns 500 on malformed JSON', async () => {
    const request = jsonRequest('/api/messages/send', {});
    const broken = new Request(request.url, { method: 'POST', body: '{"receiverId":' });
    expect((await send.POST(broken as never)).status).toBe(500);
  });
});

describe.each([
  ['GET /api/messages/conversation/[userId]', conversation.GET],
  ['GET /api/messages/send/conversation/[userId]', sendConversation.GET],
])('%s', (_name, GET) => {
  test('only loads messages between the signed-in user and the requested user', async () => {
    meExists();
    prismaMock.user.findUnique
      .mockResolvedValueOnce(ME)
      .mockResolvedValueOnce({ id: 7, email: 'kai@hawaii.edu', role: 'USER', profile: null });
    prismaMock.message.findMany.mockResolvedValue([]);

    const { status, body } = await readJson(await GET(getRequest('/?limit=20'), routeParams({ userId: '7' })));

    expect(status).toBe(200);
    expect(body.otherUser).toEqual({ id: 7, name: 'Kai', photo: null, role: 'USER' });
    // Reading "another user's conversation" is impossible: one side is always the session user (id 5)
    expect(prismaMock.message.findMany).toHaveBeenCalledWith({
      where: { OR: [{ senderId: 5, receiverId: 7 }, { senderId: 7, receiverId: 5 }] },
      orderBy: { sentAt: 'desc' },
      take: 20,
    });
  });

  test('returns 404 when the session user is unknown', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await GET(getRequest('/'), routeParams({ userId: '7' }))).status).toBe(404);
  });

  test('returns 500 for a user id that does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(ME).mockResolvedValueOnce(null);
    expect((await GET(getRequest('/'), routeParams({ userId: '404' }))).status).toBe(500);
  });
});

test('GET /api/messages/conversations lists the signed-in user\'s conversations', async () => {
  meExists();
  prismaMock.message.findMany.mockResolvedValue([]);
  const { status, body } = await readJson(await conversations.GET(getRequest('/')));
  expect(status).toBe(200);
  expect(body).toEqual({ conversations: [] });
  expect(prismaMock.message.findMany.mock.calls[0][0].where).toEqual({ OR: [{ senderId: 5 }, { receiverId: 5 }] });
});

test('GET /api/messages/unread-count counts only the caller\'s unread messages', async () => {
  meExists();
  prismaMock.message.count.mockResolvedValue(3);
  expect(await readJson(await unreadCount.GET(getRequest('/')))).toEqual({ status: 200, body: { unreadCount: 3 } });
  expect(prismaMock.message.count).toHaveBeenCalledWith({ where: { receiverId: 5, isRead: false } });
});

describe.each([
  ['conversations', () => conversations.GET(getRequest('/'))],
  ['unread-count', () => unreadCount.GET(getRequest('/'))],
  ['mark-conversation-read', () => markConversationRead.PATCH(jsonRequest('/', { senderId: 7 }, 'PATCH'))],
  ['mark-conversation-read/[userId]',
    () => markConversationReadById.POST(getRequest('/'), routeParams({ userId: '7' }))],
])('%s with a session user missing from the database', (_name, call) => {
  test('returns 404', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});

describe('marking conversations read', () => {
  test.each([
    ['PATCH body form', () => markConversationRead.PATCH(jsonRequest('/', { senderId: '7' }, 'PATCH'))],
    ['POST path form', () => markConversationReadById.POST(getRequest('/'), routeParams({ userId: '7' }))],
  ])('%s only marks messages sent to the caller', async (_label, call) => {
    meExists();
    prismaMock.message.updateMany.mockResolvedValue({ count: 2 });
    expect(await readJson(await call())).toEqual({ status: 200, body: { count: 2 } });
    expect(prismaMock.message.updateMany.mock.calls[0][0].where).toEqual({ senderId: 7, receiverId: 5, isRead: false });
  });

  test.each([
    ['PATCH body form', () => markConversationRead.PATCH(jsonRequest('/', { senderId: '7' }, 'PATCH'))],
    ['POST path form', () => markConversationReadById.POST(getRequest('/'), routeParams({ userId: '7' }))],
  ])('%s reports database failures as 500', async (_label, call) => {
    meExists();
    prismaMock.message.updateMany.mockRejectedValue(new Error('db'));
    expect((await call()).status).toBe(500);
  });
});

describe('PATCH /api/messages/mark-read', () => {
  test('marks the message read', async () => {
    prismaMock.message.update.mockResolvedValue({ id: 3, isRead: true });
    expect(await readJson(await markRead.PATCH(jsonRequest('/', { messageId: '3' }, 'PATCH'))))
      .toEqual({ status: 200, body: { id: 3, isRead: true } });
  });

  test('returns 500 when the message does not exist', async () => {
    prismaMock.message.update.mockRejectedValue(new Error('Record not found'));
    expect((await markRead.PATCH(jsonRequest('/', { messageId: 999 }, 'PATCH'))).status).toBe(500);
  });

  // WEAKNESS (IDOR): the handler never checks that the message was sent to the caller, so any signed-in
  // user can mark anyone's messages as read, hiding them from the real recipient's unread count.
  test.fails('KNOWN DEFECT: only the recipient can mark a message as read', async () => {
    prismaMock.message.findUnique.mockResolvedValue({ id: 3, senderId: 7, receiverId: 8 });
    prismaMock.message.update.mockResolvedValue({ id: 3, isRead: true });
    const response = await markRead.PATCH(jsonRequest('/', { messageId: 3 }, 'PATCH'));
    expect(response.status).toBe(403);
  });
});

describe('blocking', () => {
  const block = (id: string) => blockUser.POST(jsonRequest('/', {}), routeParams({ userId: id }));
  const unblock = (id: string) => unblockUser.POST(jsonRequest('/', {}), routeParams({ userId: id }));
  const isBlocked = (id: string) => checkBlocked.GET(getRequest('/'), routeParams({ userId: id }));

  test('block adds the user to the caller\'s own block list and keeps other preferences', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: { theme: 'dark', blockedUsers: [3] } });

    expect(await readJson(await block('7'))).toEqual({ status: 201, body: { success: true, blockedUsers: [3, 7] } });
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({
      where: { userId: 5 },
      data: { preferences: { theme: 'dark', blockedUsers: [3, 7] } },
    });
  });

  test('blocking twice does not duplicate the entry', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: { blockedUsers: [7] } });
    expect((await readJson(await block('7'))).body.blockedUsers).toEqual([7]);
  });

  test('a profile without preferences starts a new block list', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: null });
    expect((await readJson(await block('7'))).body.blockedUsers).toEqual([7]);
  });

  test.each([
    ['yourself', '5', 400],
    ['an unknown user', '404', 404],
  ])('cannot block %s', async (_label, id, status) => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect((await block(id)).status).toBe(status);
    expect(prismaMock.userProfile.update).not.toHaveBeenCalled();
  });

  test('returns 404 when the caller has no profile', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.userProfile.findUnique.mockResolvedValue(null);
    expect((await block('7')).status).toBe(404);
  });

  test.each([...BAD_NUMERIC_IDS].filter((id) => Number.isNaN(Number(id))))(
    'rejects non-numeric user id %j on block, unblock and check',
    async (id) => {
      expect((await block(id)).status).toBe(400);
      expect((await unblock(id)).status).toBe(400);
      expect((await isBlocked(id)).status).toBe(400);
    },
  );

  test('unblock removes only that user', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValue({ preferences: { blockedUsers: [3, 7, 9] } });
    const { status, body } = await readJson(await unblock('7'));
    expect(status).toBe(200);
    expect(body.blockedUsers).toEqual([3, 9]);
    expect(prismaMock.userProfile.update.mock.calls[0][0].where).toEqual({ userId: 5 });
  });

  test('unblock with no profile returns 404; with no list returns an empty list', async () => {
    prismaMock.userProfile.findUnique.mockResolvedValueOnce(null);
    expect((await unblock('7')).status).toBe(404);
    prismaMock.userProfile.findUnique.mockResolvedValueOnce({ preferences: {} });
    expect((await readJson(await unblock('7'))).body.blockedUsers).toEqual([]);
  });

  test.each([
    ['blocked', { preferences: { blockedUsers: [7] } }, true],
    ['not blocked', { preferences: { blockedUsers: [3] } }, false],
    ['no list', { preferences: {} }, false],
    ['no profile', null, false],
  ])('check-blocked reports %s', async (_label, profile, expected) => {
    prismaMock.userProfile.findUnique.mockResolvedValue(profile);
    expect(await readJson(await isBlocked('7'))).toEqual({ status: 200, body: { isBlocked: expected } });
  });

  test.each([
    ['block', () => block('7')],
    ['unblock', () => unblock('7')],
    ['check-blocked', () => isBlocked('7')],
  ])('%s returns 500 on database errors', async (_label, call) => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db'));
    prismaMock.userProfile.findUnique.mockRejectedValue(new Error('db'));
    expect((await call()).status).toBe(500);
  });
});

describe('unexpected database errors return 500 instead of crashing', () => {
  test.each([
    ['conversations', () => conversations.GET(getRequest('/'))],
    ['unread-count', () => unreadCount.GET(getRequest('/'))],
    ['mark-conversation-read', () => markConversationRead.PATCH(jsonRequest('/', { senderId: 7 }, 'PATCH'))],
    ['mark-conversation-read/[userId]',
      () => markConversationReadById.POST(getRequest('/'), routeParams({ userId: '7' }))],
  ])('%s', async (_name, call) => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('connection refused'));
    expect((await call()).status).toBe(500);
  });

  test('mark-read with a malformed JSON body', async () => {
    const broken = new Request('http://localhost:3000/api/messages/mark-read', { method: 'PATCH', body: '{' });
    expect((await markRead.PATCH(broken as never)).status).toBe(500);
  });
});
