export const MODULE_TIMEOUT_MS=20000;
export function boundedModule<T>(load:()=>Promise<T>,timeout=MODULE_TIMEOUT_MS):Promise<T> {
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Object.assign(new Error('The page module did not finish loading. Please retry.'),{name:'ModuleLoadTimeout'})),timeout);
  Promise.resolve().then(load).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
 });
}
/** Explicit recovery preserves the entire current URL and the provider's session. */
export async function reloadCurrentPage() {
 const cleanup=async()=>{
  if('serviceWorker' in navigator){
   const registrations=await navigator.serviceWorker.getRegistrations();
   await Promise.all(registrations.filter(r=>r.scope===location.origin+'/').map(r=>r.unregister()));
  }
  if('caches' in window)await Promise.all((await caches.keys()).filter(k=>k.startsWith('workbox-precache')||k==='api-runtime-cache').map(k=>caches.delete(k)));
 };
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([cleanup(),new Promise<void>(resolve=>{timer=setTimeout(resolve,4000);})]);}catch{/* Recovery must still reload if browser cache APIs are unavailable. */}
 finally{clearTimeout(timer);window.location.reload();}
}
