import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSyncSessionToken, type SyncAuthClient, type SyncSession } from './syncAuth.ts';

const token = (id = 'user-1', expires_at = 5000): SyncSession =>
  ({ access_token: 'valid-token', expires_at, user: { id } });

test('sync rejects public-cloud reachability without a signed-in profile or session', async () => {
  const auth: SyncAuthClient = {
    getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: async () => { throw new Error('refresh must not run'); },
  };
  await assert.rejects(getSyncSessionToken(auth, null, 100), /Sign in/);
  await assert.rejects(getSyncSessionToken(auth, { authUserId: 'user-1' }, 100), /session has expired/);
  await assert.rejects(getSyncSessionToken(null, { authUserId: 'user-1' }, 100), /not configured/);
});

test('sync uses current token only when session and verified profile agree', async () => {
  const auth: SyncAuthClient = {
    getSession: async () => ({ data: { session: token() }, error: null }),
    refreshSession: async () => { throw new Error('refresh must not run'); },
  };
  assert.equal(await getSyncSessionToken(auth, { authUserId: 'user-1' }, 100), 'valid-token');
  await assert.rejects(getSyncSessionToken(auth, { authUserId: 'user-2' }, 100), /does not match/);
  await assert.rejects(getSyncSessionToken(auth, {}, 100), /does not match/);
});

test('sync refreshes an about-to-expire session before any network write', async () => {
  let refreshed = 0;
  const auth: SyncAuthClient = {
    getSession: async () => ({ data: { session: token('user-1', 140) }, error: null }),
    refreshSession: async () => { refreshed++; return { data: { session: { ...token('user-1', 800), access_token: 'refreshed-token' } }, error: null }; },
  };
  assert.equal(await getSyncSessionToken(auth, { authUserId: 'user-1' }, 100), 'refreshed-token');
  assert.equal(refreshed, 1);
});

test('sync preserves authentication failures without trusting an old stored token', async () => {
  const auth: SyncAuthClient = {
    getSession: async () => ({ data: { session: token('user-1', 140) }, error: null }),
    refreshSession: async () => ({ data: { session: null }, error: new Error('expired') }),
  };
  await assert.rejects(getSyncSessionToken(auth, { authUserId: 'user-1' }, 100), /session has expired/);
});
