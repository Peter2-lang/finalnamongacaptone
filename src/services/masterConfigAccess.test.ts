import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MasterConfigService} from './masterConfigService';
import {DEFAULT_MASTER_CONFIG} from '../data/defaultMasterConfig';

test('only an explicit Super Admin profile triggers restricted configuration reads',async()=>{
 const calls:string[]=[];
 const service=new MasterConfigService(async<T>(path:string)=>{calls.push(path);return {success:true,config:DEFAULT_MASTER_CONFIG,versions:[],auditLogs:[]} as T;});
 for(const role of ['landing','admin','focal','agent','', 'unknown'])await service.syncWithBackend(role);
 assert.deepEqual(calls,[]);
 await service.syncWithBackend('super_admin');assert.deepEqual(calls,['/api/config/master']);
 assert.equal(service.getConfig().version,DEFAULT_MASTER_CONFIG.version);
});
