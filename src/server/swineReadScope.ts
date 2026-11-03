/** Agent scope is authoritative; client query parameters cannot broaden it. */
export function resolveSwineReadFilters(isAgent:boolean, requestedReady:unknown, requestedArchived:unknown) {
 return {
  readyToSell:isAgent?true:requestedReady!==undefined?requestedReady==='true':undefined,
  isArchived:isAgent?false:requestedArchived!==undefined?requestedArchived==='true':false,
 };
}
export function agentMayReadSwine(record:{readyToSell?:boolean;isArchived?:boolean}) {
 return record.readyToSell===true && record.isArchived!==true;
}
