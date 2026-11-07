import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getConnectivityState } from './connectivityState.ts';

const online = { browserOnline: true, simulatedOffline: false, backendReachable: true, syncing: false, state: 'ONLINE' as const };

test('backend outage preserves the browser connection and reports ERROR', () => {
  assert.deepEqual(getConnectivityState({ ...online, backendReachable: false }), { isOnline: true, state: 'ERROR' });
});

test('actual offline and explicitly enabled simulation report OFFLINE', () => {
  assert.deepEqual(getConnectivityState({ ...online, browserOnline: false }), { isOnline: false, state: 'OFFLINE' });
  assert.deepEqual(getConnectivityState({ ...online, simulatedOffline: true }), { isOnline: false, state: 'OFFLINE' });
});

test('unverified backend cannot report connected on startup or reconnection', () => {
  assert.equal(getConnectivityState({ ...online, backendReachable: false, state: 'SYNCED' }).state, 'ERROR');
  assert.equal(getConnectivityState(online).state, 'ONLINE');
});

test('initializing backend checks do not report a false error', () => {
  assert.deepEqual(getConnectivityState({
    ...online,
    backendReachable: false,
    connectionInitializing: true,
    state: 'ONLINE',
  }), { isOnline: true, state: 'ONLINE' });
});
