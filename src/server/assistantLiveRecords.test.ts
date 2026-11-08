import assert from 'node:assert/strict';
import {test} from 'node:test';
import {answerAssistant,queryAssistantRegistry,AssistantDataError} from './assistantEngine';
import {resolveRegistryQuestion,registryLanguage} from './assistantRegistryIntent';

test('supported multilingual questions query live records without any AI provider',async()=>{
 for(const message of ['How many swine are registered?','How many swine are registered today?','How many swine records were added this week?','How many swine are ready to sell?','Pila ka baboy ang narehistro sa Ambacon?','Ilang baboy ang nakarehistro?','How many farmers are registered?','How many archived records are there?','Show the latest registered swine.','How many certificates are issued?']) {
  let reads=0;
  const result=await answerAssistant({message},{role:'admin'},{generate:async()=>{throw new Error('Must not call provider')},query:async args=>{reads++;return {totalSwine:0,totalFarmers:0,totalCertificates:0,scope:args.barangay||'Hinunangan',period:args.period,latest:[]};}});
  assert.equal(reads,1,message);assert.match(result.reply,/0/);assert.equal(result.source,'database');
 }
 const result=await answerAssistant({message:'How many swine are registered?'},{role:'admin'},{query:async()=>({totalSwine:0,scope:'Hinunangan',period:'all'})});
 assert.equal(result.reply,'Currently, there are 0 registered swine records.');
});

test('focal cross-barangay and agent restricted questions never read data',async()=>{
 for(const [scope,message] of [[{role:'focal',assignedBarangay:'Ambacon'},'How many swine are registered in Canipaan?'],[{role:'agent'},'How many farmers are registered?'],[{role:'agent'},'How many archived records are there?'],[{role:'agent'},'How many certificates are issued?'],[{role:'agent'},'What is the ASF status of my barangay?']] as const) {
  await assert.rejects(answerAssistant({message},scope,{query:async()=>{throw new Error('Forbidden read');}}),(error:unknown)=>error instanceof AssistantDataError && error.code==='registry_forbidden');
 }
 await assert.rejects(queryAssistantRegistry({role:'agent'},{metric:'archived'}),/outside/);
});

test('database outages are recoverable failures rather than zero or provider errors',async()=>{
 await assert.rejects(answerAssistant({message:'How many swine are registered?'},{role:'admin'},{query:async()=>{throw new Error('private database credentials');}}),(error:unknown)=>error instanceof AssistantDataError&&error.code==='registry_unavailable'&&!error.message.includes('credentials'));
});

test('archive and latest reads enforce query scope and omit personal details',async()=>{
 let filters:any;
 const load:any=async(f:any)=>{filters=f;return {records:[{id:'a',pigIdTag:'TAG-A',barangay:'Ambacon',registeredAt:'2026-11-08',isArchived:f.isArchived,farmerName:'Restricted Person',farmerContact:'private',readyToSell:true,status:'SOLD'}]};};
 const archive:any=await queryAssistantRegistry({role:'focal',assignedBarangay:'Ambacon'},{metric:'archived'},load);
 assert.equal(filters.isArchived,true);assert.equal(filters.barangay,'Ambacon');assert.equal(archive.totalSwine,1);
 const latest:any=await queryAssistantRegistry({role:'admin'},{metric:'latest'},load);
 assert.equal(latest.latest[0].tag,'TAG-A');assert.doesNotMatch(JSON.stringify(latest),/Restricted Person|private/);
 const agent:any=await queryAssistantRegistry({role:'agent'},{metric:'latest'},load);
 assert.equal(agent.totalSwine,0);assert.equal(agent.healthStatuses,undefined);
});

test('language, date filters and unknown barangay parsing stay explicit',()=>{
 assert.equal(registryLanguage('Unsa ang ASF?','en'),'ceb');assert.equal(registryLanguage('Ano ang ASF?','en'),'fil');assert.equal(registryLanguage('What is a pig?','ceb'),'en');
 assert.equal(resolveRegistryQuestion('How many records this week?',{role:'admin'})?.args.period,'week');
 assert.equal(resolveRegistryQuestion('How many swine in UnknownPlace?',{role:'admin'}),null);
 assert.equal(resolveRegistryQuestion('What is a breeding boar?',{role:'admin'}),null);
});


test('ASF answers distinguish missing approved assessments from a zero registry',async()=>{
 const result=await answerAssistant({message:'What is the ASF status of my barangay?'},{role:'focal',assignedBarangay:'Ambacon'},{query:async args=>{assert.equal(args.metric,'biosecurity');return {scope:'Ambacon',assessments:[]};}});
 assert.match(result.reply,/No approved ASF/);assert.doesNotMatch(result.reply,/0 registered|green/);
});

test('certificate counts and zero-count barangay summaries use parameterized scoped SQL',async()=>{
 const {pool}=await import('../db/index');const original=pool.query;const queries:any[]=[];
 (pool as any).query=async(sql:string,values:any[])=>{queries.push({sql,values});return {rows:sql.includes('issued_certificates')?[{total:0}]:[{name:'Ambacon'}]};};
 try {
  const cert:any=await queryAssistantRegistry({role:'focal',assignedBarangay:'Ambacon'},{metric:'certificates'});assert.equal(cert.totalCertificates,0);assert.equal(queries[0].values[0],'Ambacon');assert.match(queries[0].sql,/\$1/);
  const summary:any=await queryAssistantRegistry({role:'focal',assignedBarangay:'Ambacon'},{view:'summary'},async()=>({records:[],total:0}));assert.deepEqual({...summary.byBarangay},{Ambacon:0});assert.equal(queries[1].values[0],'Ambacon');
 } finally {pool.query=original;}
});
