import { describe, expect, test } from 'vitest';
import {
  getConversation,
  getUnreadCount,
  getUserConversations,
  markConversationAsRead,
  markMessageAsRead,
  sendMessage,
} from '@/lib/messaging';
import { prismaMock } from '../../helpers/prisma-mock';

type Profile = { firstName: string | null; lastName: string | null; name: string | null; photoUrl: string | null };
const person = (id: number, email: string, profile: Partial<Profile> | null = {}) => ({
  id,
  email,
  role: 'USER',
  profile: profile && { firstName: null, lastName: null, name: null, photoUrl: null, ...profile },
});

const me = person(1, 'me@hawaii.edu', { firstName: 'Me', lastName: 'Myself' });
const message = (id: number, from: typeof me, to: typeof me, isRead = false, minute = id) => ({
  id,
  senderId: from.id,
  receiverId: to.id,
  sender: from,
  receiver: to,
  content: `message ${id}`,
  isRead,
  sentAt: new Date(Date.UTC(2025, 0, 1, 0, minute)),
});

describe('getUserConversations', () => {
  test('queries messages the user sent or received, newest first', async () => {
    prismaMock.message.findMany.mockResolvedValue([]);
    await expect(getUserConversations(1)).resolves.toEqual({ conversations: [] });
    expect(prismaMock.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ senderId: 1 }, { receiverId: 1 }] },
      orderBy: { sentAt: 'desc' },
    }));
  });

  test('groups by the other person, keeps the newest message and counts unread incoming ones', async () => {
    const kai = person(2, 'kai@hawaii.edu', { firstName: 'Kai', lastName: 'Akana', photoUrl: 'kai.png' });
    const lani = person(3, 'lani@hawaii.edu', { name: 'Lani K' });
    prismaMock.message.findMany.mockResolvedValue([
      message(5, kai, me, false), // newest from Kai, unread
      message(4, me, kai, false), // sent by me: never counts as unread
      message(3, kai, me, false), // unread
      message(2, kai, me, true), // already read
      message(1, lani, me, true),
    ]);

    const { conversations } = await getUserConversations(1);

    expect(conversations).toEqual([
      {
        userId: 2,
        userName: 'Kai Akana',
        userPhoto: 'kai.png',
        lastMessage: 'message 5',
        lastMessageTime: '2025-01-01T00:05:00.000Z',
        unreadCount: 2,
        userRole: 'USER',
      },
      expect.objectContaining({ userId: 3, userName: 'Lani K', userPhoto: null, unreadCount: 0 }),
    ]);
  });

  test.each([
    ['first + last name', { firstName: 'Kēhau', lastName: 'ʻAkana' }, 'Kēhau ʻAkana'],
    ['profile.name only', { name: 'Display Name' }, 'Display Name'],
    ['first name only', { firstName: 'Solo' }, 'Solo'],
    ['empty profile', {}, 'Unknown User'],
    ['no profile: capitalised email name', null, 'Noprofile'],
  ])('display name from %s', async (_label, profile, expected) => {
    const other = person(7, 'noprofile@hawaii.edu', profile);
    prismaMock.message.findMany.mockResolvedValue([message(1, other, me)]);
    const { conversations } = await getUserConversations(1);
    expect(conversations[0].userName).toBe(expected);
  });

  test('rethrows database errors', async () => {
    prismaMock.message.findMany.mockRejectedValue(new Error('db down'));
    await expect(getUserConversations(1)).rejects.toThrow('db down');
  });
});

describe('getConversation', () => {
  test('only returns messages between the two participants, oldest first', async () => {
    prismaMock.user.findUnique.mockResolvedValue(person(2, 'kai@hawaii.edu', { firstName: 'Kai', lastName: 'A' }));
    prismaMock.message.findMany.mockResolvedValue([{ id: 2 }, { id: 1 }]);

    const result = await getConversation(1, 2, 10);

    expect(prismaMock.message.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { senderId: 1, receiverId: 2 },
          { senderId: 2, receiverId: 1 },
        ],
      },
      orderBy: { sentAt: 'desc' },
      take: 10,
    });
    expect(result).toEqual({
      otherUser: { id: 2, name: 'Kai A', photo: null, role: 'USER' },
      messages: [{ id: 1 }, { id: 2 }],
    });
  });

  test('defaults to the 50 most recent messages', async () => {
    prismaMock.user.findUnique.mockResolvedValue(person(2, 'kai@hawaii.edu', null));
    prismaMock.message.findMany.mockResolvedValue([]);
    const result = await getConversation(1, 2);
    expect(prismaMock.message.findMany.mock.calls[0][0].take).toBe(50);
    expect(result.otherUser.name).toBe('Kai');
  });

  test.each([
    ['profile.name', { name: 'Nickname' }, 'Nickname'],
    ['first name only', { firstName: 'Solo' }, 'Solo'],
    ['empty profile', {}, 'Unknown User'],
  ])('display name from %s', async (_label, profile, expected) => {
    prismaMock.user.findUnique.mockResolvedValue(person(2, 'x@hawaii.edu', profile));
    prismaMock.message.findMany.mockResolvedValue([]);
    await expect(getConversation(1, 2)).resolves.toMatchObject({ otherUser: { name: expected } });
  });

  test('throws when the other user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(getConversation(1, 999)).rejects.toThrow('User not found');
    expect(prismaMock.message.findMany).not.toHaveBeenCalled();
  });
});

describe('sendMessage', () => {
  test('stores the content verbatim as an unread message', async () => {
    const content = '<script>alert(1)</script>';
    prismaMock.message.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));

    const result = await sendMessage({ senderId: 1, receiverId: 2, content });

    expect(result.success).toBe(true);
    expect(prismaMock.message.create).toHaveBeenCalledWith({
      data: { senderId: 1, receiverId: 2, content, sentAt: expect.any(Date), isRead: false },
    });
  });

  test('reports failure instead of throwing', async () => {
    prismaMock.message.create.mockRejectedValue(new Error('fk violation'));
    await expect(sendMessage({ senderId: 1, receiverId: 404, content: 'hi' }))
      .resolves.toEqual({ success: false, error: 'Failed to send message' });
  });
});

describe('markMessageAsRead', () => {
  test('sets isRead and readAt', async () => {
    prismaMock.message.update.mockResolvedValue({ id: 3, isRead: true });
    await expect(markMessageAsRead(3)).resolves.toEqual({ success: true, message: { id: 3, isRead: true } });
    expect(prismaMock.message.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  test('reports failure for a missing message', async () => {
    prismaMock.message.update.mockRejectedValue(new Error('not found'));
    await expect(markMessageAsRead(3)).resolves.toMatchObject({ success: false });
  });
});

describe('markConversationAsRead', () => {
  test('only marks messages the other person sent to this user', async () => {
    prismaMock.message.updateMany.mockResolvedValue({ count: 4 });
    await expect(markConversationAsRead(1, 2)).resolves.toEqual({ success: true, count: 4 });
    expect(prismaMock.message.updateMany).toHaveBeenCalledWith({
      where: { senderId: 2, receiverId: 1, isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    });
  });

  test('reports failure with a zero count', async () => {
    prismaMock.message.updateMany.mockRejectedValue(new Error('db'));
    await expect(markConversationAsRead(1, 2)).resolves.toMatchObject({ success: false, count: 0 });
  });
});

describe('getUnreadCount', () => {
  test('counts unread messages addressed to the user', async () => {
    prismaMock.message.count.mockResolvedValue(7);
    await expect(getUnreadCount(1)).resolves.toBe(7);
    expect(prismaMock.message.count).toHaveBeenCalledWith({ where: { receiverId: 1, isRead: false } });
  });

  test('returns 0 on database errors', async () => {
    prismaMock.message.count.mockRejectedValue(new Error('db'));
    await expect(getUnreadCount(1)).resolves.toBe(0);
  });
});
