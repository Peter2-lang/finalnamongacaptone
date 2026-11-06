import assert from 'node:assert/strict';
import {test} from 'node:test';
import {queryAssistantRegistry} from './assistantEngine';
test('blank focal assignments and unknown metric names fail before a database read',async()=>{
 let reads=0;const load=async()=>{reads++;return {records:[],total:0};};
 await assert.rejects(queryAssistantRegistry({role:'focal',assignedBarangay:'  '},{},load),/assignment/);
 await assert.rejects(queryAssistantRegistry({role:'admin'},{metric:'execute_sql'},load),/Unsupported/);
 assert.equal(reads,0);
});
test('verified scope is trimmed and grouped labels cannot affect object prototypes',async()=>{
 let filter:any;
 const load:any=async(value:any)=>{filter=value;return {records:[{id:'one',barangay:'Ambacon',swineType:'constructor',asfZone:'__proto__',registeredAt:'2026-11-06',readyToSell:false}],total:1};};
 const result:any=await queryAssistantRegistry({role:'focal',assignedBarangay:' Ambacon '},{period:'all'},load);
 assert.equal(filter.barangay,'Ambacon');assert.equal(result.classifications.constructor,1);assert.equal(result.asfZones.__proto__,1);assert.equal(Object.getPrototypeOf(result.classifications),null);
});
