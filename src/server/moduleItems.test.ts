import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pool} from '../db/index.ts';
import {mutateModuleItem,visibleModuleItems} from './moduleItems.ts';
const admin={isAdmin:true,isFocal:false,assignedBarangay:''};
const focal={isAdmin:false,isFocal:true,assignedBarangay:'Ambacon'};
test('module item visibility and agent/focal write permissions are enforced',async()=>{
 const items=[{id:'a',barangay:'Ambacon'},{id:'b',barangay:'Bugho'}];
 assert.deepEqual(visibleModuleItems(items,'transmittal_letters',focal),[items[0]]);
 assert.deepEqual(visibleModuleItems(items,'takeoff_records',{...focal,isFocal:false}),[]);
 await assert.rejects(mutateModuleItem('marketing_alerts','id',{id:'id'},false,focal),/permission/);
 await assert.rejects(mutateModuleItem('transmittal_letters','id',{id:'id'},false,{...focal,isFocal:false}),/permission/);
});
test('dispatch completion commits sold status and dispatch together; failures roll both back',async()=>{
 const original=pool.connect;let fail=false;const calls:string[]=[];
 (pool as any).connect=async()=>({release(){},async query(text:string,params:any[]=[]){
  calls.push(text);
  if(text.startsWith('SELECT setting_value'))return {rows:[{setting_value:[{id:'dispatch',barangay:'Ambacon'}]}]};
  if(text.startsWith('SELECT id,barangay'))return {rows:[{id:'00000000-0000-4000-8000-000000000001',barangay:'Ambacon',pig_id_tag:'HIN-2026-0001',ready_to_sell:true,is_archived:false}]};
  if(text.startsWith('INSERT INTO')&&fail)throw new Error('Fixture database failure');
  return {rows:[]};
 }});
 try{
  const payload={id:'dispatch',swineId:'00000000-0000-4000-8000-000000000001',barangay:'Ambacon',status:'completed'};
  const saved=await mutateModuleItem('takeoff_records','dispatch',payload,false,admin);
  assert.equal(saved[0].earTagNo,'HIN-2026-0001');assert.ok(calls.some(text=>text.startsWith('UPDATE public.swine_records')));assert.ok(calls.includes('COMMIT'));
  calls.length=0;fail=true;await assert.rejects(mutateModuleItem('takeoff_records','dispatch',payload,false,admin),/database failure/);
  assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));
 }finally{pool.connect=original;}
});
