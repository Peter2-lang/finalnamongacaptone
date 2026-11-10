import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoalescedRefresh } from './coalescedRefresh.ts';

test('burst invalidations during a snapshot trigger one serialized authoritative follow-up', async () => {
  const releases: (() => void)[] = [];
  let reads = 0;
  const queue = createCoalescedRefresh(async () => {
    reads++;
    await new Promise<void>(resolve => releases.push(resolve));
  });
  const initial = queue.request();
  await Promise.all([queue.request(), queue.request(), queue.request()]);
  assert.equal(reads, 1);
  releases.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
  releases.shift()!();
  await initial;
  queue.cancel();
  await queue.request();
  assert.equal(reads, 2);
});

test('unmount cancels pending invalidations and failed reads permit retry', async () => {
  let reads = 0;
  let release!: () => void;
  const queue = createCoalescedRefresh(async () => { reads++; await new Promise<void>(resolve => {release = resolve;}); });
  const initial = queue.request();
  await queue.request();
  queue.cancel();
  release();
  await initial;
  assert.equal(reads, 1);
  const retry = createCoalescedRefresh(async () => { if (++reads === 2) throw new Error('network'); });
  await assert.rejects(retry.request(), /network/);
  await retry.request();
  assert.equal(reads, 3);
});
