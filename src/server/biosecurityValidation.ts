const checklist=['footbathsOperational','vehicleDisinfectionStation','quarantineCheckpointActive','deadSwineDisposalFacility','swillFeedingBanEnforced','visitorLogCompliance','waterChlorination','perimeterFencingAudit'] as const;
export function normalizeBiosecurityAudits(items:any[]):any[]{
 return items.map(item=>{
  if(!item || typeof item!=='object' || typeof item.id!=='string' || typeof item.barangay!=='string' || !item.barangay.trim())throw new Error('Audit ID and barangay are required.');
  if(checklist.some(key=>typeof item[key]!=='boolean'))throw new Error('Every biosecurity checklist answer must be true or false.');
  if(!['green','yellow','red'].includes(item.asfZone))throw new Error('Invalid ASF zone.');
  const score=Math.round(checklist.filter(key=>item[key]===true).length/checklist.length*100);
  return {...item,complianceScore:score,biosecurityLevel:score>=90?3:score>=70?2:1,status:item.asfZone==='red'||score<60?'critical':item.asfZone==='yellow'||score<80?'warning':'compliant'};
 });
}
export function scopeBiosecurityItems(items:any[],barangay:string){
 return items.filter(item=>typeof item?.barangay==='string'&&item.barangay.trim().toLowerCase()===barangay.trim().toLowerCase());
}
