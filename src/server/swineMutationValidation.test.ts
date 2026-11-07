import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateSwineMutation,assertImmutableSwineIdentity} from './swineMutationValidation.ts';
test('all write paths reject malformed dates, numeric bounds and non-integer ages',()=>{
 for(const payload of [null,[],{birthDate:'2026-02-30'},{birthDate:'2099-01-01'},{ageMonths:2.5},{age_months:-1},{weightKg:-1},{latitude:91},{longitude:'invalid'},{readyToSell:'false'},{farmerName:{}}])assert.throws(()=>validateSwineMutation(payload));
 assert.doesNotThrow(()=>validateSwineMutation({birthDate:'2024-02-29',ageMonths:0,weightKg:0,latitude:0,longitude:0,readyToSell:false}));
 const existing={id:'one',pigIdTag:'HIN-2026-0001',earTagNo:'HIN-2026-0001'};
 assert.throws(()=>assertImmutableSwineIdentity(existing,{pigIdTag:'HIN-2026-0002'}),/immutable/);
 assert.doesNotThrow(()=>assertImmutableSwineIdentity(existing,{weightKg:50}));
});
