import {randomUUID} from 'node:crypto';
import {pool} from '../db/index.ts';
export const CLOUD_ITEM_KEYS=new Set(['takeoff_records','transmittal_letters','marketing_alerts']);
export function visibleModuleItems(items:any[],key:string,user:{isAdmin:boolean;isFocal:boolean;assignedBarangay:string}){
 if(user.isAdmin)return items;
 if(key==='marketing_alerts')return items.filter(item=>item.targetBarangay==='all'||item.targetBarangay===user.assignedBarangay);
 if(!user.isFocal||!user.assignedBarangay)return [];
 return items.filter(item=>typeof item.barangay==='string'&&item.barangay.trim().toLowerCase()===user.assignedBarangay.trim().toLowerCase());
}
export async function mutateModuleItem(key:string,id:string,payload:any,remove:boolean,user:{isAdmin:boolean;isFocal:boolean;assignedBarangay:string}){
 if(!CLOUD_ITEM_KEYS.has(key))throw new Error('Unsupported module.');
 if(!user.isAdmin&&(!user.isFocal||!user.assignedBarangay||key==='marketing_alerts'))throw new Error('You do not have permission to change this module.');
 if(!remove&&(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.id!==id))throw new Error('A record with a matching ID is required.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
  const result=await client.query('SELECT setting_value FROM public.system_settings WHERE setting_key=$1 FOR UPDATE',[key]);
  const items:any[]=Array.isArray(result.rows[0]?.setting_value)?result.rows[0].setting_value:[];
  const existing=items.find(item=>item.id===id);
  if(!user.isAdmin){
   if(existing&&!visibleModuleItems([existing],key,user).length)throw new Error('Record is outside your assigned barangay.');
   if(!remove&&!visibleModuleItems([payload],key,user).length)throw new Error('Record is outside your assigned barangay.');
  }
  if(key==='takeoff_records'&&!remove){
   if(!/^[0-9a-f-]{36}$/i.test(payload.swineId)||!['scheduled','cleared','in_transit','completed','cancelled'].includes(payload.status))throw new Error('A registered swine and valid dispatch status are required.');
   const swine=await client.query('SELECT id,barangay,pig_id_tag,ready_to_sell,is_archived FROM public.swine_records WHERE id=$1 FOR UPDATE',[payload.swineId]);
   const row=swine.rows[0];
   if(!row||(!user.isAdmin&&row.barangay.trim().toLowerCase()!==user.assignedBarangay.trim().toLowerCase()))throw new Error('Registered swine is unavailable in your scope.');
   if(row.is_archived||(!existing&&!row.ready_to_sell))throw new Error('Swine must be active and ready to sell before scheduling.');
   payload={...payload,barangay:row.barangay,earTagNo:row.pig_id_tag};
   if(payload.status==='completed')await client.query("UPDATE public.swine_records SET status='sold',ready_to_sell=FALSE,updated_at=NOW() WHERE id=$1",[row.id]);
  }
  const next=items.filter(item=>item.id!==id);
  if(!remove)next.unshift({...payload,updatedAt:new Date().toISOString()});
  await client.query('INSERT INTO public.system_settings (id,setting_key,setting_value,updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',[randomUUID(),key,JSON.stringify(next)]);
  await client.query('COMMIT');return visibleModuleItems(next,key,user);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
