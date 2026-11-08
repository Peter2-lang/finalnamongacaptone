import {useEffect,useState,type Dispatch,type SetStateAction} from 'react';
export type PreferenceParser<T>=(value:unknown)=>T|undefined;
export const choice=<T extends string>(values:readonly T[]):PreferenceParser<T>=>value=>typeof value==='string'&&values.includes(value as T)?value as T:undefined;
export const text:PreferenceParser<string>=value=>typeof value==='string'&&value.length<=100&&!/[<>\u0000-\u001f]/.test(value)?value:undefined;
let restoredNavigation=0;let lastNavigationEvent:Event|undefined;
export const preferenceNavigationVersion=()=>restoredNavigation;
export const tagQuery:PreferenceParser<string>=value=>typeof value==='string'&&value.length<=80&&(/^(?:HIN(?:$|-(?:[A-Z]{2,8}-)?\d{4}[-A-Z0-9]*)|\d[-\d ]*)$/i.test(value)||value==='')?value:undefined;
export const dateFilter:PreferenceParser<string>=value=>typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}$/.test(value))?value:undefined;
export const flag:PreferenceParser<boolean>=value=>value===true||value==='true'?true:value===false||value==='false'?false:undefined;
export const integer=(max:number):PreferenceParser<number>=>value=>{const n=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;return Number.isSafeInteger(n)&&n>=1&&n<=max?n:undefined;};
export const recordReference:PreferenceParser<string>=value=>typeof value==='string'&&(value===''||/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value))?value:undefined;
export function readPreference<T>(key:string,param:string,fallback:T,parse:PreferenceParser<T>):T {
 try {
  const urlValue=new URLSearchParams(window.location.search).get(param);
  if(urlValue!==null)return parse(urlValue)??fallback;
  const saved=JSON.parse(sessionStorage.getItem(key)||'null');
  return saved&&typeof saved.at==='number'&&Date.now()-saved.at<8*3600000 ? parse(saved.value)??fallback:fallback;
 }catch{return fallback;}
}
/** Only explicit primitive UI fields are saved. No rows, credentials, form drafts or owner-name queries. */
export function usePagePreference<T>(owner:string,module:string,field:string,fallback:T,parse:PreferenceParser<T>):[T,Dispatch<SetStateAction<T>>] {
 const key=`da_ui_v1:${owner}:${module}:${field}`;const param=`ui_${field}`;
 const [state,setState]=useState<T>(()=>readPreference(key,param,fallback,parse));
 useEffect(()=>{
  const restore=(event?:Event)=>{if(event&&event!==lastNavigationEvent){lastNavigationEvent=event;restoredNavigation++;}setState(readPreference(key,param,fallback,parse));};
  restore();window.addEventListener('popstate',restore);
  return()=>window.removeEventListener('popstate',restore);
 },[key]);
 useEffect(()=>{
  // An unsafe free-text query may be used now, but is deliberately not persisted.
  const safe=parse(state);const value=safe??fallback;
  try{sessionStorage.setItem(key,JSON.stringify({at:Date.now(),value}));}catch{/* Storage may be unavailable. */}
  try{
   const url=new URL(window.location.href);
   if(safe===undefined)url.searchParams.delete(param);
   else if(value===fallback||value===''){if(parse(url.searchParams.get(param))!==value)url.searchParams.delete(param);}
   else url.searchParams.set(param,String(value));
   if(url.href!==window.location.href)window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  }catch{/* URL state is optional. */}
 },[key,state]);
 return [state,setState];
}
