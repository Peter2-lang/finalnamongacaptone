import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackendHealthCheck } from './backendHealth.ts';

const healthResponse = (database = 'connected', kind?: string) => Response.json({
  status: 'healthy', cloud: 'online', authentication: 'available', service: 'hinunangan-swine-registry', database, database_error_kind: kind,
});

test('concurrent health checks await one current request', async () => {
  let requests = 0;
  let finish: (response: Response) => void = () => { throw new Error('Request not started'); };
  const check = createBackendHealthCheck({ fetcher: async () => {
    requests++;
    return new Promise<Response>(resolve => { finish = resolve; });
  } });
  const first = check();
  const second = check();
  assert.equal(first, second);
  assert.equal(requests, 1);
  finish(healthResponse());
  assert.deepEqual(await first, { healthy: true, error: null });
  assert.deepEqual(await second, { healthy: true, error: null });
});

test('HTTP failures report status without exposing response details', async () => {
  const check = createBackendHealthCheck({ fetcher: async () => new Response('private diagnostic details', { status: 500 }) });
  const result = await check();
  assert.equal(result.healthy, false);
  assert.match(result.error || '', /HTTP 500/);
  assert.doesNotMatch(result.error || '', /private diagnostic details/);
});

test('HTML fallback cannot count as a healthy API', async () => {
  const check = createBackendHealthCheck({ fetcher: async () => new Response('<html>SPA</html>', { status: 200 }) });
  const result = await check();
  assert.equal(result.healthy, false);
  assert.match(result.error || '', /expected API JSON/);
});

test('database credential and schema failures differ from internet failures', async () => {
  const checkCredentials = createBackendHealthCheck({ fetcher: async () => healthResponse('error', 'authentication_failed') });
  assert.match((await checkCredentials()).error || '', /database authentication failed/);
  const checkSchema = createBackendHealthCheck({ fetcher: async () => healthResponse('schema_error') });
  assert.match((await checkSchema()).error || '', /review the schema/);
});

test('a later successful check clears a previous failure', async () => {
  let calls = 0;
  const check = createBackendHealthCheck({ fetcher: async () => ++calls === 1 ? new Response('', { status: 503 }) : healthResponse() });
  assert.equal((await check()).healthy, false);
  assert.deepEqual(await check(), { healthy: true, error: null });
  assert.equal(calls, 2);
});

test('aborted and blocked requests have actionable messages', async () => {
  const timeoutCheck = createBackendHealthCheck({ timeoutMs: 5, fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }) });
  assert.match((await timeoutCheck()).error || '', /timed out/);
  const networkCheck = createBackendHealthCheck({ fetcher: async () => { throw new TypeError('Failed to fetch'); } });
  assert.match((await networkCheck()).error || '', /could not reach \/api\/health/);
});


test('503 preserves safe database diagnostics and never claims offline internet', async () => {
  const check = createBackendHealthCheck({ fetcher: async () => Response.json({
    service: 'hinunangan-swine-registry', status: 'unhealthy', database: 'error', database_error_kind: 'authentication_failed',
  }, { status: 503 }) });
  const result = await check();
  assert.equal(result.healthy, false);
  assert.match(result.error!, /database authentication failed/);
  assert.doesNotMatch(result.error!, /browser is offline/);
});

test('connected database alone is insufficient for cloud health', async () => {
  const check = createBackendHealthCheck({ fetcher: async () => Response.json({ service: 'hinunangan-swine-registry', database: 'connected' }) });
  assert.equal((await check()).healthy, false);
});

test('connected database with schema not ready remains unavailable for synchronization', async () => {
  for (const status of [200, 503]) {
    const check = createBackendHealthCheck({ fetcher: async () => Response.json({
      service: 'hinunangan-swine-registry', status: 'healthy', database: 'connected', schema: 'not_ready', cloud: 'online', authentication: 'available',
    }, { status }) });
    const result = await check();
    assert.equal(result.healthy, false);
    assert.match(result.error!, /schema check failed/);
  }
});
