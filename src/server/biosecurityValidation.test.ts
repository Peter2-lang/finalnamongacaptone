import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeBiosecurityAudits,scopeBiosecurityItems} from './biosecurityValidation.ts';
test('biosecurity score and risk are recomputed from actual boolean answers',()=>{
 const audit={id:'test',barangay:'Ambacon',asfZone:'green',footbathsOperational:true,vehicleDisinfectionStation:true,quarantineCheckpointActive:true,deadSwineDisposalFacility:true,swillFeedingBanEnforced:false,visitorLogCompliance:false,waterChlorination:false,perimeterFencingAudit:false,complianceScore:100};
 const [saved]=normalizeBiosecurityAudits([audit]);assert.equal(saved.complianceScore,50);assert.equal(saved.status,'critical');assert.equal(saved.biosecurityLevel,1);
 assert.throws(()=>normalizeBiosecurityAudits([{...audit,footbathsOperational:'true'}]),/true or false/);
 assert.deepEqual(scopeBiosecurityItems([audit,{...audit,id:'other',barangay:'Bugho'}],'ambacon'),[audit]);
});
