/** Never merge separate farmers using only a display name. */
export function farmerIdentity(record:{id?:string;farmerId?:string;farmerName?:string;farmerContact?:string;barangay?:string;farmerAddress?:string}) {
  if(record.farmerId)return `id:${record.farmerId}`;
  const contact=(record.farmerContact||'').replace(/\D/g,'');
  const normalize=(value?:string)=>(value||'').trim().toLowerCase();
  if(contact)return `contact:${contact}:${normalize(record.farmerName)}:${normalize(record.barangay)}:${normalize(record.farmerAddress)}`;
  // Legacy rows without verified identity cannot be safely deduplicated by name.
  return `unresolved:${record.id}`;
}
