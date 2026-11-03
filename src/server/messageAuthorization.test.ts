import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authorizeMessagePayload} from './messageAuthorization.ts';

test('broadcast is administrative; focal reports cannot escape their barangay',()=>{
 for(const role of ['super_admin','admin']) assert.equal(authorizeMessagePayload({targetBarangay:'all'}, {role,assignedBarangay:''}).targetBarangay,'all');
 const focal={role:'focal',assignedBarangay:'Ambacon'};
 assert.equal(authorizeMessagePayload({content:'Report'},focal).targetBarangay,'Ambacon');
 for(const payload of [{targetBarangay:'all'},{targetBarangay:'Bugho'},{recipientId:'another-user'},{receiverId:'another-user'}]) assert.throws(()=>authorizeMessagePayload(payload,focal),/assigned barangay/);
 assert.throws(()=>authorizeMessagePayload({}, {...focal,assignedBarangay:''}),/assigned barangay/);
 assert.throws(()=>authorizeMessagePayload({}, {role:'agent',assignedBarangay:''}),/view-only/);
});
