import React,{useEffect,useState} from 'react';
import {MODULE_TIMEOUT_MS,reloadCurrentPage} from '../../utils/moduleLoading';
export function ModuleFailure({retry}:{retry:()=>void}) {
 return <div role="alert" className="mx-auto my-12 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center text-amber-950 shadow-sm">
  <h2 className="text-lg font-bold">This page could not be loaded</h2>
  <p className="mt-2 text-sm">Loading failed or took too long. Your current page has been kept. Check your connection and retry.</p>
  <button type="button" onClick={retry} className="mt-4 min-h-10 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Retry module</button>
  <button type="button" onClick={()=>void reloadCurrentPage()} className="ml-3 mt-4 min-h-10 rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold">Reload current page</button>
 </div>;
}
export function ModuleLoader({retry}:{retry:()=>void}) {
 const [expired,setExpired]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setExpired(true),MODULE_TIMEOUT_MS);return()=>clearTimeout(timer);},[]);
 if(expired)return <ModuleFailure retry={retry}/>;
 return <div role="status" className="flex min-h-[350px] w-full flex-col items-center justify-center p-8 text-emerald-800"><div className="mb-3 h-8 w-8 animate-spin rounded-full border-3 border-emerald-600 border-t-transparent"/><span className="text-xs font-semibold text-stone-500">Loading module...</span></div>;
}
export class ModuleBoundary extends React.Component<{children:React.ReactNode;retry:()=>void}, {failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:Error){console.warn('[MODULE] page load failed',{name:error.name});}
 render(){return this.state.failed?<ModuleFailure retry={this.props.retry}/>:this.props.children;}
}
