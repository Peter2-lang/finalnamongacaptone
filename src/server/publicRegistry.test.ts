import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicRegistrySummary, PUBLIC_REGISTRY_SQL } from './publicRegistry.ts';
const base = { farmers: 2, barangays: [{ id:'b',name:'Ambacon',code:'AMB',swineCount:0,readyToSellCount:0 }],audits:[] };
test('real zero records remain zero; missing approved assessments are unavailable', () => {
 const data=publicRegistrySummary(base);
 assert.equal(data.barangays[0].focalPersonName,null); assert.equal(data.activeSwine,0); assert.equal(data.readyToSell,0); assert.equal(data.coveredBarangays,1); assert.equal(data.registeredFarmers,2); assert.equal(data.compliancePercent,null); assert.equal(data.barangays[0].riskLevel,null);
});
test('only latest approved valid assessment contributes; private fields never returned', () => {
 const audit={id:'1',barangay:'Ambacon',auditDate:'2026-11-01',reviewStatus:'approved',asfZone:'yellow',auditorName:'PRIVATE',notes:'PRIVATE',footbathsOperational:true,vehicleDisinfectionStation:true,quarantineCheckpointActive:true,deadSwineDisposalFacility:true,swillFeedingBanEnforced:true,visitorLogCompliance:true,waterChlorination:true,perimeterFencingAudit:true};
 const data=publicRegistrySummary({...base,audits:[audit,{...audit,id:'2',reviewStatus:'draft',auditDate:'2026-11-02',asfZone:'green'}]});
 assert.equal(data.assessedBarangays,1); assert.equal(data.barangays[0].riskLevel,'yellow'); assert.equal(data.compliancePercent,0); assert.equal(JSON.stringify(data).includes('PRIVATE'),false);
 assert.equal(publicRegistrySummary({...base,audits:[{...audit,footbathsOperational:null}]}).compliancePercent,null);
});
test('SQL counts distinct farmer identities and excludes archived, inactive, sold and deceased swine',()=>{
 assert.match(PUBLIC_REGISTRY_SQL,/count\(DISTINCT id\)/); assert.match(PUBLIC_REGISTRY_SQL,/s.is_archived = FALSE/); assert.match(PUBLIC_REGISTRY_SQL,/is_active/); assert.match(PUBLIC_REGISTRY_SQL,/'sold', 'deceased'/); assert.match(PUBLIC_REGISTRY_SQL,/s.ready_to_sell = TRUE/); assert.match(PUBLIC_REGISTRY_SQL,/LEFT JOIN/);
});
