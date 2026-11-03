import {useEffect,useState} from 'react';
import {requestJson} from '../services/http.ts';
/** Cloud mutations complete before success is shown; one item per transaction. */
export function useCloudItems<T extends {id:string}>(key:string){
 const [items,setItems]=useState<T[]>([]);
 const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;
  requestJson<{data:T[]}>(`/api/module-data/${key}`).then(response=>{if(active)setItems(response.data);}).catch(error=>{if(active)setError(error.message);});
  return()=>{active=false;};
 },[key]);
 async function mutate(id:string,item?:T){
  if(busy)return false;
  setBusy(true);setError(null);
  try{
   const response=await requestJson<{data:T[]}>(`/api/module-data/${key}/items/${encodeURIComponent(id)}`,{method:item?'PUT':'DELETE',...(item?{body:JSON.stringify(item)}:{})});
   setItems(response.data);return true;
  }catch(error){setError(error instanceof Error?error.message:'Unable to save to the database.');return false;}
  finally{setBusy(false);}
 }
 return{items,error,busy,save:(item:T)=>mutate(item.id,item),remove:(id:string)=>mutate(id)};
}
