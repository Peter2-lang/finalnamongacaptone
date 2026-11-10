import assert from 'node:assert/strict';
import {test} from 'node:test';
import {swineApi} from './swineApi.ts';

test('registration and edits require a saved database identity instead of manufacturing success from the request', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({success:true}), {headers:{'content-type':'application/json'}});
    await assert.rejects(swineApi.create({id:'request-only'}), /did not confirm/);
    await assert.rejects(swineApi.update('request-only',{id:'request-only'}), /did not confirm/);
    globalThis.fetch = async () => new Response(JSON.stringify({success:true,data:{id:'database-id',latitude:10.401804141,longitude:125.18452409}}), {headers:{'content-type':'application/json'}});
    assert.equal((await swineApi.create({id:'request-only'})).id,'database-id');
  } finally { globalThis.fetch=original; }
});
