import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

// Genuine PostgreSQL connection refusal, isolated from configured cloud credentials.
process.env.DATABASE_URL = 'postgresql://isolated:isolated@127.0.0.1:1/isolated';
const fixturePool = new Pool({connectionString:process.env.DATABASE_URL,ssl:false,connectionTimeoutMillis:500});
global._postgresPool = fixturePool;
const { createApp } = await import('./app.ts');
test('genuine database connection refusal produces an unavailable public response, never zero statistics', async()=>{
 const server=createApp().listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/registry-summary`);
  assert.equal(response.status,503);
  const data=await response.json();assert.deepEqual(data,{success:false,error:'Public registry data temporarily unavailable.'});
  assert.equal(data.activeSwine,undefined);assert.equal(data.registeredFarmers,undefined);
  assert.doesNotMatch(JSON.stringify(data),/isolated|127\.0\.0\.1|password|ECONNREFUSED/);
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await fixturePool.end();}
});
