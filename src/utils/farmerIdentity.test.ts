import assert from 'node:assert/strict';
import {test} from 'node:test';
import {farmerIdentity} from './farmerIdentity.ts';
import {hasPermission} from './rbacPermissions.ts';
test('farmer identity uses linked IDs and never merges legacy rows by name alone',()=>{
 assert.equal(farmerIdentity({farmerId:'farmer-1',id:'pig-1'}),farmerIdentity({farmerId:'farmer-1',id:'pig-2'}));
 assert.notEqual(farmerIdentity({id:'pig-1',farmerName:'Same Name'}),farmerIdentity({id:'pig-2',farmerName:'Same Name'}));
 assert.notEqual(farmerIdentity({farmerId:'person-1',farmerName:'Same Name'}),farmerIdentity({farmerId:'person-2',farmerName:'Same Name'}));
});
test('agent cannot navigate to write-only registry actions',()=>{
 assert.equal(hasPermission('agent','add_swine'),false);
 assert.equal(hasPermission('focal','add_swine'),true);
 assert.equal(hasPermission('admin','accounts'),true);
 assert.equal(hasPermission('focal','accounts'),false);
});
