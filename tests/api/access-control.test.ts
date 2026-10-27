/**
 * Authentication and authorization for every API route handler, called directly with getServerSession mocked.
 * Each protected handler must reject a signed-out caller (and admin handlers a student) before touching the DB.
 */
import { describe, expect, test } from 'vitest';
import * as adminCategories from '@/app/api/admin/categories/route';
import * as adminDeleteFlag from '@/app/api/admin/delete-flag/route';
import * as adminFlags from '@/app/api/admin/flags/route';
import * as adminModerationHistory from '@/app/api/admin/moderation-history/route';
import * as adminProfile from '@/app/api/admin/profile/route';
import * as adminResolveFlag from '@/app/api/admin/resolve-flag/route';
import * as adminUserRole from '@/app/api/admin/user-role/route';
import * as adminUsers from '@/app/api/admin/users/route';
import * as changePassword from '@/app/api/auth/change-password/route';
import * as deleteUser from '@/app/api/delete user/route';
import * as flags from '@/app/api/flags/route';
import * as lifestyleSurvey from '@/app/api/lifestyle-survey/route';
import * as aiReport from '@/app/api/matches/[matchId]/ai-report/route';
import * as comparison from '@/app/api/matches/[matchId]/comparison/route';
import * as matchDetail from '@/app/api/matches/[matchId]/route';
import * as generate from '@/app/api/matches/generate/route';
import * as matches from '@/app/api/matches/route';
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
import * as notificationRead from '@/app/api/notifications/[id]/read/route';
import * as notificationDelete from '@/app/api/notifications/delete/route';
import * as notifications from '@/app/api/notifications/route';
import * as profileById from '@/app/api/profile/[userId]/route';
import * as deletePicture from '@/app/api/profile/delete-picture/route';
import * as picture from '@/app/api/profile/picture/route';
import * as profile from '@/app/api/profile/route';
import * as uploadPicture from '@/app/api/profile/upload-picture/route';
import * as reportsStatus from '@/app/api/reports/status/route';
import * as usersSearch from '@/app/api/users/search/route';
import { adminSession, signInAs, studentSession } from '../helpers/sessions';
import { formRequest, getRequest, jsonRequest, routeParams } from '../helpers/requests';
import { prismaMock } from '../helpers/prisma-mock';
import { makeMatch, makeProfile } from '../helpers/factories';
import expectNoDatabaseAccess from '../helpers/db-assertions';

type Call = () => Promise<Response>;
const upload = () => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0xFF, 0xD8, 0xFF])], 'a.jpg', { type: 'image/jpeg' }));
  return uploadPicture.POST(formRequest('/api/profile/upload-picture', form));
};

/** Every handler that must require a signed-in user. */
const SIGNED_IN_ROUTES: [string, Call][] = [
  ['POST /api/auth/change-password', () => changePassword.POST(
    jsonRequest('/', { email: 'x', currentPassword: 'a', newPassword: 'b' }),
  )],
  ['POST /api/delete user', () => deleteUser.POST(jsonRequest('/', { password: 'x' }))],
  ['POST /api/flags', () => flags.POST(jsonRequest('/', { reportedUserId: 2, reason: 'spam' }))],
  ['POST /api/lifestyle-survey', () => lifestyleSurvey.POST(jsonRequest('/', {}))],
  ['GET /api/matches', () => matches.GET()],
  ['GET /api/matches/[matchId]', () => matchDetail.GET(getRequest('/'), routeParams({ matchId: 'm1' }))],
  ['POST /api/matches/generate', () => generate.POST(jsonRequest('/', { action: 'stats' }))],
  ['POST /api/messages/block-user/[userId]', () => blockUser.POST(jsonRequest('/', {}), routeParams({ userId: '2' }))],
  ['GET /api/messages/check-blocked/[userId]', () => checkBlocked.GET(getRequest('/'), routeParams({ userId: '2' }))],
  ['GET /api/messages/conversation/[userId]', () => conversation.GET(getRequest('/'), routeParams({ userId: '2' }))],
  ['GET /api/messages/conversations', () => conversations.GET(getRequest('/'))],
  ['POST /api/messages/mark-conversation-read/[userId]',
    () => markConversationReadById.POST(getRequest('/'), routeParams({ userId: '2' }))],
  ['PATCH /api/messages/mark-conversation-read',
    () => markConversationRead.PATCH(jsonRequest('/', { senderId: 2 }, 'PATCH'))],
  ['PATCH /api/messages/mark-read', () => markRead.PATCH(jsonRequest('/', { messageId: 1 }, 'PATCH'))],
  ['GET /api/messages/send/conversation/[userId]',
    () => sendConversation.GET(getRequest('/'), routeParams({ userId: '2' }))],
  ['POST /api/messages/send', () => send.POST(jsonRequest('/', { receiverId: 2, content: 'hi' }))],
  ['POST /api/messages/unblock-user/[userId]',
    () => unblockUser.POST(jsonRequest('/', {}), routeParams({ userId: '2' }))],
  ['GET /api/messages/unread-count', () => unreadCount.GET(getRequest('/'))],
  ['PATCH /api/notifications/[id]/read', () => notificationRead.PATCH(getRequest('/'), routeParams({ id: '1' }))],
  ['POST /api/notifications/delete', () => notificationDelete.POST(jsonRequest('/', { notificationId: 1 }))],
  ['GET /api/notifications', () => notifications.GET()],
  ['GET /api/profile/[userId]', () => profileById.GET(getRequest('/'), routeParams({ userId: '2' }))],
  ['DELETE /api/profile/delete-picture', () => deletePicture.DELETE()],
  ['GET /api/profile/picture', () => picture.GET()],
  ['POST /api/profile/upload-picture', upload],
  ['GET /api/reports/status', () => reportsStatus.GET()],
  ['GET /api/users/search', () => usersSearch.GET(getRequest('/api/users/search?q=a'))],
];

/** Admin-only handlers, with the status a signed-in student receives. */
const ADMIN_ROUTES: [string, Call, number][] = [
  ['GET /api/admin/categories', () => adminCategories.GET(getRequest('/')), 403],
  ['POST /api/admin/categories', () => adminCategories.POST(jsonRequest('/', { name: 'x' })), 401],
  ['PUT /api/admin/categories', () => adminCategories.PUT(jsonRequest('/', { id: 1, name: 'x' }, 'PUT')), 401],
  ['DELETE /api/admin/categories', () => adminCategories.DELETE(jsonRequest('/', { id: 1 }, 'DELETE')), 401],
  ['POST /api/admin/delete-flag', () => adminDeleteFlag.POST(jsonRequest('/', { flagId: 1 })), 401],
  ['GET /api/admin/flags', () => adminFlags.GET(getRequest('/')), 403],
  ['GET /api/admin/moderation-history', () => adminModerationHistory.GET(getRequest('/?userId=2')), 403],
  ['PUT /api/admin/profile', () => adminProfile.PUT(jsonRequest('/', { email: 'x' }, 'PUT')), 401],
  ['POST /api/admin/resolve-flag',
    () => adminResolveFlag.POST(jsonRequest('/', { flagId: 1, action: 'deactivate' })), 403],
  ['POST /api/admin/user-role', () => adminUserRole.POST(jsonRequest('/', { userId: 5, newRole: 'ADMIN' })), 403],
  ['GET /api/admin/users', () => adminUsers.GET(getRequest('/')), 403],
  ['POST /api/admin/users (delete user)', () => adminUsers.POST(jsonRequest('/', { id: '2' })), 401],
  ['GET /api/profile?email= (admin lookup)', () => profile.GET(getRequest('/api/profile?email=a@b.c')), 401],
];

describe('signed-out callers are rejected with 401 before any database access', () => {
  test.each([...SIGNED_IN_ROUTES, ...ADMIN_ROUTES.map(([name, call]) => [name, call] as [string, Call])])(
    '%s',
    async (_name, call) => {
      signInAs(null);
      const response = await call();
      expect(response.status).toBe(401);
      expect((await response.json()).error).toMatch(/unauthorized|not authenticated/i);
      expectNoDatabaseAccess();
    },
  );
});

describe('students cannot use admin APIs', () => {
  test.each(ADMIN_ROUTES)('%s -> %i', async (_name, call, status) => {
    signInAs(studentSession);
    const response = await call();
    expect(response.status).toBe(status);
    expectNoDatabaseAccess();
  });

  test('a student cannot run generate-all', async () => {
    signInAs(studentSession);
    prismaMock.user.findUnique.mockResolvedValue({ id: 5, profile: null });
    const response = await generate.POST(jsonRequest('/', { action: 'generate-all' }));
    expect(response.status).toBe(403);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  test('an admin session passes the same checks (control case)', async () => {
    signInAs(adminSession);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    const response = await adminUsers.GET(getRequest('/'));
    expect(response.status).toBe(200);
  });
});

describe('the cron endpoint requires its secret', () => {
  const adminClear = () => import('@/app/api/admin/clear-expired-suspensions/route');

  test.each([
    ['no secret configured, no header', undefined, undefined],
    ['no secret configured, empty bearer', undefined, 'Bearer '],
    ['no secret configured, "Bearer undefined"', undefined, 'Bearer undefined'],
    ['wrong secret', 'right-secret', 'Bearer wrong-secret'],
    ['secret without Bearer prefix', 'right-secret', 'right-secret'],
  ])('%s -> 401', async (_label, secret, header) => {
    if (secret) process.env.CRON_SECRET_KEY = secret; else delete process.env.CRON_SECRET_KEY;
    const { GET } = await adminClear();
    const response = await GET(getRequest('/', header ? { authorization: header } : undefined));
    expect(response.status).toBe(401);
    expectNoDatabaseAccess();
    delete process.env.CRON_SECRET_KEY;
  });
});

/*
 * KNOWN VULNERABILITIES (documented, not fixed): these two handlers never call getServerSession.
 * - POST /api/matches/[matchId]/ai-report lets anyone overwrite any match's report and icebreakers.
 * - GET /api/matches/[matchId]/comparison returns both users' full profiles (email, social handles,
 *   hometown, bio) to anyone who has a match id. The authenticated /api/matches/[matchId] route
 *   correctly checks that the caller is part of the match; this one does not.
 */
describe('match routes without authentication', () => {
  const alice = makeProfile({ id: 'p1', email: 'alice@hawaii.edu', instagram: '@alice' });
  const bob = makeProfile({ id: 'p2', email: 'bob@hawaii.edu' });
  const existingMatch = () => prismaMock.match.findUnique.mockResolvedValue({
    ...makeMatch(alice, bob, { id: 'm1' }), user1: alice, user2: bob,
  });

  test.fails('KNOWN DEFECT: POST /api/matches/[matchId]/ai-report requires sign-in', async () => {
    existingMatch();
    signInAs(null);
    const response = await aiReport.POST(jsonRequest('/', {}), routeParams({ matchId: 'm1' }));
    expect(response.status).toBe(401);
  });

  test.fails('KNOWN DEFECT: GET /api/matches/[matchId]/comparison requires sign-in', async () => {
    existingMatch();
    signInAs(null);
    const response = await comparison.GET(getRequest('/?userId=p1'), routeParams({ matchId: 'm1' }));
    expect(response.status).toBe(401);
  });

  test('documents current behaviour: a signed-out caller can read and overwrite match data', async () => {
    existingMatch();
    signInAs(null);
    const leaked = await comparison.GET(getRequest('/?userId=p1'), routeParams({ matchId: 'm1' }));
    expect(leaked.status).toBe(200);
    const body = await leaked.json();
    expect([body.currentUser.email, body.matchUser.email]).toEqual(['alice@hawaii.edu', 'bob@hawaii.edu']);
    expect(body.currentUser.instagram).toBe('@alice');

    const overwritten = await aiReport.POST(jsonRequest('/', {}), routeParams({ matchId: 'm1' }));
    expect(overwritten.status).toBe(200);
    expect(prismaMock.match.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' } }));
  });
});
