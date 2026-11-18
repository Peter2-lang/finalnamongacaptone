import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DEFAULT_PRINT_CONFIGURATION as defaults, PAPER_SIZES, paperDimensions, validatePrintConfiguration, type PrintConfiguration} from '../../utils/printConfiguration';
import {requestJson} from '../../services/http';
import {mediaApi} from '../../services/api';

function snapshot(source:HTMLElement):HTMLElement {
 const clone=source.cloneNode(true) as HTMLElement;
 clone.hidden=false;
 clone.querySelectorAll('button,.no-print,script,iframe').forEach(n=>n.remove());
 clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
 // Canvas pixels are not carried by cloneNode (maps, charts, seals).
 source.querySelectorAll('canvas').forEach((canvas,i)=>{
  const target=clone.querySelectorAll('canvas')[i];
  try {const img=document.createElement('img');img.src=canvas.toDataURL();img.style.cssText=canvas.style.cssText;img.width=canvas.width;img.height=canvas.height;target?.replaceWith(img);} catch {throw new Error('The map provider does not permit this canvas to be printed.');}
 });
 return clone;
}
function Preview({source,target,close}:{source:HTMLElement;target:string;close:()=>void}) {
 const template=source.dataset.printTemplate;
 const scope=(template?`${target}_${template}`:target).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,150);
 const [config,setConfig]=useState<PrintConfiguration>({...defaults});
 const [canManage,setCanManage]=useState(false);
 const [saveScope,setSaveScope]=useState(scope);
 const [message,setMessage]=useState('Loading shared configuration…');
 const [loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false);
 const [zoom,setZoom]=useState(75);
 const frame=useRef<HTMLIFrameElement>(null);
 const original=useRef(snapshot(source));
 const [w,h]=paperDimensions(config);
 const update=(key:keyof PrintConfiguration,value:unknown)=>setConfig(c=>({...c,[key]:value}));
 useEffect(()=>{
  let active=true;
  requestJson<{value:PrintConfiguration;canManage:boolean}>(`/api/print-configurations/${scope}`).then(r=>{
   if(!active)return;
   if(validatePrintConfiguration(r.value))setConfig(r.value);
   setCanManage(r.canManage);setMessage('');setLoaded(true);
  }).catch(e=>{if(active){setMessage(e.message+' Default layout is available.');setLoaded(true);}});
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',onKey);
  const previous=document.activeElement as HTMLElement|null;
  return ()=>{active=false;document.removeEventListener('keydown',onKey);previous?.focus();};
 },[scope]);
 useEffect(()=>{
  const doc=frame.current?.contentDocument;if(!doc)return;
  doc.open();doc.write('<!doctype html><html><head></head><body><main id="print-sheet"></main></body></html>');doc.close();
  document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n=>doc.head.appendChild(n.cloneNode(true)));
  const content=original.current.cloneNode(true) as HTMLElement;
  content.removeAttribute('data-print-document');
  content.style.setProperty('width','100%','important');content.style.setProperty('min-height','0','important');content.style.setProperty('max-height','none','important');content.style.setProperty('overflow','visible','important');
  content.style.setProperty('position','relative','important');content.style.setProperty('box-shadow','none','important');
  [...config.hiddenColumns].sort((a,b)=>b-a).forEach(i=>content.querySelectorAll('tr').forEach(row=>row.children[i]?.remove()));
  if(!config.header)content.querySelectorAll('header,[data-official-header]').forEach(n=>n.remove());
  if(!config.footer)content.querySelectorAll('footer,[data-official-footer]').forEach(n=>n.remove());
  if(!config.signatures)content.querySelectorAll('[data-signature],.signature-block').forEach(n=>n.remove());
  // Overrides apply only to existing image logos, leaving seals and certificate text intact.
  const images=Array.from(content.querySelectorAll<HTMLImageElement>('img')).filter(img=>/logo|seal|department|municipal|agriculture/i.test(img.alt+' '+img.src));
  config.logos.forEach((logo,i)=>{
   let img=images[i];
   if(!img && logo.url){img=doc.createElement('img');content.prepend(img);}
   if(!img)return;
   if(logo.url)img.src=logo.url;
   img.style.display=logo.visible?'block':'none';img.style.width=`${logo.width}px`;img.style.height=logo.aspect?'auto':`${logo.height}px`;img.style.objectFit='contain';img.style.margin=`${logo.spacing}px 0`;img.style.marginLeft=logo.alignment==='left'?'0':'auto';img.style.marginRight=logo.alignment==='right'?'0':'auto';
  });
  const sheet=doc.getElementById('print-sheet')!;
  if(config.title){const title=doc.createElement('h1');title.textContent=config.title;sheet.append(title);}
  if(config.date){const date=doc.createElement('p');date.textContent=config.date;sheet.append(date);}
  sheet.append(content);
  const style=doc.createElement('style');
  const available=(w-2*config.margin)*96/25.4;
  const originalWidth=source.scrollWidth || available;
  const originalHeight=source.scrollHeight || 1;
  const fitWidth=Math.min(1,available/originalWidth);
  const scale=config.scaling==='custom'?config.scale/100:config.scaling==='actual'?1:config.scaling==='fit-page'?Math.min(fitWidth,(h-2*config.margin)*96/25.4/originalHeight):fitWidth;
  style.textContent=`@page {size:${w}mm ${h}mm;margin:${config.margin}mm;${config.pageNumbers?'@bottom-center {content: "Page " counter(page) " of " counter(pages);}':''}}
   html,body{margin:0!important;background:white!important;color:#111!important;overflow:visible!important}
   #print-sheet{box-sizing:border-box;width:${w}mm;min-height:${h}mm;padding:${config.margin}mm;background:white;font-size:${config.fontSize}pt}
   #print-sheet table{font-size:${config.fontSize}pt!important;width:100%;} #print-sheet thead{display:table-header-group} tr,figure{break-inside:avoid} img,svg{max-width:100%;object-fit:contain}
   #print-sheet>div{zoom:${scale};} ${!config.borders?'#print-sheet td,#print-sheet th{border:0!important}':''}
   @media print{html,body,#print-sheet,#print-sheet *{visibility:visible!important} #print-sheet{width:100%;min-height:0;padding:0} #print-sheet header,#print-sheet footer{display:block!important} #print-sheet *{print-color-adjust:${config.backgrounds?'exact':'economy'}!important;-webkit-print-color-adjust:${config.backgrounds?'exact':'economy'}!important} #print-sheet [data-print-document]{page:auto!important;position:relative!important} }
  `;
  doc.head.append(style);
 },[config]);
 const save=async()=>{setBusy(true);try{await requestJson(`/api/print-configurations/${saveScope}`,{method:'PUT',body:JSON.stringify(config)});setMessage('Configuration saved to the database.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 const print=async()=>{
  setBusy(true);try{
   const win=frame.current?.contentWindow;const doc=win?.document;if(!win||!doc)throw new Error('Preview is unavailable.');
   await doc.fonts.ready;
   await Promise.all(Array.from(doc.images).map(img=>img.decode().catch(()=>{throw new Error('An image could not load. Wait or replace the unavailable logo before printing.');})));
   win.focus();win.print();
  }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
 };
 const numeric=(key:keyof PrintConfiguration,label:string,min:number,max:number)=><label>{label}<input type="number" min={min} max={max} value={config[key] as number} onChange={e=>update(key,Math.max(min,Math.min(max,Number(e.target.value))))}/></label>;
 return <div className="print-manager" role="dialog" aria-modal="true" aria-label="Print Preview">
  <div className="print-manager-dialog">
   <div className="print-manager-header"><strong>Print Preview</strong><button autoFocus aria-label="Close print preview" onClick={close}>×</button></div>
   <div className="print-manager-main">
    <section className="print-manager-preview" aria-label="Document preview"><div className="print-manager-zoom"><button onClick={()=>setZoom(z=>Math.max(25,z-25))}>−</button><span>{zoom}%</span><button onClick={()=>setZoom(z=>Math.min(150,z+25))}>+</button></div><iframe title="Printable document" ref={frame} style={{width:`${w}mm`,height:`${h}mm`,transform:`scale(${zoom/100})`,transformOrigin:'top left',background:'white'}}/></section>
    <section className="print-manager-settings" aria-label="Print configuration">
     <label>Paper size<select value={config.paper} onChange={e=>update('paper',e.target.value)}>{Object.entries(PAPER_SIZES).map(([key,size])=><option key={key}>{key}</option>)}</select></label>
     <small>{w} × {h} mm</small>
     {config.paper==='Custom' && <>{numeric('width','Width (mm)',50,1200)}{numeric('height','Height (mm)',50,1200)}</>}
     <label>Orientation<select value={config.orientation} onChange={e=>update('orientation',e.target.value)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
     <label>Margin preset<select value="" onChange={e=>update('margin',Number(e.target.value))}><option value="" disabled>Choose preset</option><option value="10">Normal</option><option value="5">Narrow</option><option value="20">Wide</option></select></label>
     {numeric('margin','Custom margins (mm)',0,50)}
     <label>Scaling<select value={config.scaling} onChange={e=>update('scaling',e.target.value)}><option value="fit-page">Fit to Page</option><option value="fit-width">Fit to Width</option><option value="actual">Actual Size</option><option value="custom">Custom Scale</option></select></label>
     {config.scaling==='custom'&&numeric('scale','Scale (%)',25,200)}
     {numeric('fontSize','Table font size (pt)',6,24)}
     <label>Report title<input maxLength={200} value={config.title} onChange={e=>update('title',e.target.value)}/></label>
     <label>Report date<input type="date" value={config.date} onChange={e=>update('date',e.target.value)}/></label>
     {(['header','footer','pageNumbers','signatures','borders','backgrounds'] as const).map(key=><label className="print-manager-check" key={key}><input type="checkbox" checked={config[key]} onChange={e=>update(key,e.target.checked)}/>{({header:'Show header',footer:'Show footer',pageNumbers:'Page numbers',signatures:'Signature blocks',borders:'Table borders',backgrounds:'Background colors'})[key]}</label>)}
     <details><summary>Column visibility</summary>{Array.from(original.current.querySelectorAll('thead tr:first-child th')).map((th,i)=><label className="print-manager-check" key={i}><input type="checkbox" checked={!config.hiddenColumns.includes(i)} onChange={e=>update('hiddenColumns',e.target.checked?config.hiddenColumns.filter(n=>n!==i):[...config.hiddenColumns,i])}/>{th.textContent}</label>)}</details>
     <details><summary>Configure Logos</summary><p>Existing official logos remain unless you override them.</p>{['Department of Agriculture','Municipality of Hinunangan','Third institutional logo'].map((label,i)=>{
      const logo=config.logos[i]||{url:'',width:72,height:72,visible:true,aspect:true,alignment:'center' as const,spacing:8};
      const change=(patch:Partial<typeof logo>)=>{const logos=[...config.logos];while(logos.length<=i)logos.push({url:'',width:72,height:72,visible:true,aspect:true,alignment:'center',spacing:8});logos[i]={...logo,...patch};update('logos',logos);};
      return <fieldset key={i} disabled={!canManage||busy}><legend>{label}</legend>{logo.url&&<img src={logo.url} alt={label} width={72}/>}<input aria-label={`Upload ${label}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);try{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a PNG, JPEG or WebP image under 5 MB.');const asset=await mediaApi.uploadCertificateAsset(file);change({url:asset.fileUrl});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}/><button onClick={()=>change({url:'',visible:true})}>Restore Default</button><button onClick={()=>change({visible:false})}>Remove</button><label className="print-manager-check"><input type="checkbox" checked={logo.visible} onChange={e=>change({visible:e.target.checked})}/>Show</label>{(['width','height','spacing'] as const).map(k=><label key={k}>{k} (px)<input type="number" min={k==='spacing'?0:10} max={k==='spacing'?100:300} value={logo[k]} onChange={e=>change({[k]:Number(e.target.value)})}/></label>)}<label className="print-manager-check"><input type="checkbox" checked={logo.aspect} onChange={e=>change({aspect:e.target.checked})}/>Maintain aspect ratio</label><label>Alignment<select value={logo.alignment} onChange={e=>change({alignment:e.target.value as typeof logo.alignment})}><option>left</option><option>center</option><option>right</option></select></label></fieldset>;
     })}</details>
     {canManage&&<label>Save settings for<select value={saveScope} onChange={e=>setSaveScope(e.target.value)}><option value={scope}>This {template?'certificate template':'module'}</option><option value="global">Global defaults</option></select></label>}
     <p>Browser print settings may override paper, margins, backgrounds and page numbers. For Custom or Long Bond, select the matching printer paper manually. Use “Save as PDF” in the print dialog. Long documents continue onto additional pages.</p>
    </section>
   </div>
   {message&&<div role="status" className="print-manager-message">{message}</div>}
   <div className="print-manager-footer"><button onClick={close}>Cancel</button><button disabled={!canManage||busy||!loaded} onClick={save}>Save Configuration</button><button disabled={busy||!loaded} onClick={print}>Print</button><button disabled={busy||!loaded} onClick={print}>Save as PDF</button></div>
  </div>
 </div>;
}
let active=false;
export function openPrintPreview(target:string) {
 if(active)return;
 const source=Array.from(document.querySelectorAll<HTMLElement>('[data-print-document]')).find(n=>n.dataset.printDocument===target);
 if(!source)throw new Error('The requested document preview is unavailable.');
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);active=true;
 const close=()=>{root.unmount();host.remove();active=false;};
 root.render(<Preview source={source} target={target} close={close}/>);
}
