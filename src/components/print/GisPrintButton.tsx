import React,{useState} from 'react';
import html2canvas from 'html2canvas';
import type {SwineRecord} from '../../types';
import {openPrintPreview} from './PrintPreview';

/** Receives the map's already authorized and filtered rows; never fetches private coordinates. */
export function GisPrintButton({records}:{records:SwineRecord[]}) {
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const print=async(button:HTMLButtonElement)=>{
  const container=button.closest<HTMLElement>('[data-gis-print-container]');if(!container)return;
  setBusy(true);setError('');
  try {
   const started=Date.now();
   while(container.querySelector('.leaflet-tile:not(.leaflet-tile-loaded)') || Array.from(container.querySelectorAll('img')).some(img=>!img.complete)){
    if(Date.now()-started>15000)throw new Error('Map tiles are still loading. Wait for the map to finish loading and try again.');
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   await document.fonts.ready;
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   const canvas=await html2canvas(container,{useCORS:true,allowTaint:false,backgroundColor:'#ffffff',ignoreElements:el=>el.hasAttribute('data-gis-print-controls')});
   const sheet=document.createElement('div');sheet.dataset.printDocument='gis-report';
   const title=document.createElement('h1');title.textContent='DA Hinunangan — GIS Biosecurity Report';sheet.append(title);
   const date=document.createElement('p');date.textContent=new Date().toLocaleString();sheet.append(date);
   const image=document.createElement('img');image.src=canvas.toDataURL('image/png');image.alt='Current authorized map extent, visible layers and legend';image.style.width='100%';sheet.append(image);
   const summary=document.createElement('p');summary.textContent=`Authorized filtered records: ${records.length}. Ready to sell: ${records.filter(r=>r.readyToSell).length}.`;sheet.append(summary);
   const table=document.createElement('table');const head=table.createTHead().insertRow();['Record ID','Barangay','Status'].forEach(text=>{const th=document.createElement('th');th.textContent=text;head.append(th);});
   const body=table.createTBody();records.forEach(r=>{const row=body.insertRow();[r.pigIdTag||r.id,r.barangay,r.status].forEach(value=>{row.insertCell().textContent=value||'';});});sheet.append(table);
   sheet.hidden=true;document.body.append(sheet);
   try{openPrintPreview('gis-report');}finally{sheet.remove();}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 return <div data-gis-print-controls className="absolute bottom-3 left-3 z-[500] rounded bg-white p-2 text-xs text-stone-900 shadow"><button disabled={busy} onClick={e=>void print(e.currentTarget)}>{busy?'Preparing map…':'Print Current Map / GIS Report'}</button>{error&&<p role="alert" className="max-w-xs">{error}</p>}</div>;
}
