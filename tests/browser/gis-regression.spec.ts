import {test,expect,type Page} from '@playwright/test';

// Component fixtures exercise actual React components and Leaflet, without touching a database.
async function mount(page:Page,component:'GisMap'|'ImportSwineModal'|'PhotoMediaSettings',props:Record<string,unknown>={}){
 await page.route('**/api/**',r=>r.fulfill({json:{success:true,data:{},settings:{}}}));
 await page.goto('/tests/browser/component-harness.html');
 await page.waitForLoadState('networkidle');
 await page.evaluate(async({component,props})=>{
  const load=(path:string)=>import(/* @vite-ignore */ path);
  const React=(window as any).auditReact;
  const createRoot=(window as any).auditCreateRoot;
  const paths={GisMap:'/src/components/gis/GisMap.tsx',ImportSwineModal:'/src/components/records/ImportSwineModal.tsx',PhotoMediaSettings:'/src/components/admin/media/PhotoMediaSettings.tsx'};
  const mod=await load(paths[component]);
  const host=document.createElement('div');host.style.cssText='height:800px;width:100%';document.body.replaceChildren(host);
  const root=createRoot(host);const win=window as any;
  win.auditPicks=[];
  if(component==='GisMap'){
   const source=await (await fetch('/src/components/gis/GisMap.tsx')).text();
   const leafletPath=source.match(/from ["']([^"']*\/leaflet\.js[^"']*)["']/)![1];
   const L=(await load(leafletPath)).default;
   L.Map.addInitHook(function(this:any){win.auditMap=this;});
  }
  const base=component==='GisMap'?{swineList:[],barangays:[],currentRole:'admin',onPickLocation:(...args:any[])=>win.auditPicks.push(args)}:component==='ImportSwineModal'?{isOpen:false,barangays:[],existingRecords:[],currentUser:null,onClose:()=>{},onSuccess:()=>{}}:{currentUserRole:'focal'};
  win.auditRender=(next:any)=>root.render(React.createElement(mod[component],{...base,...props,...next}));
  win.auditRender({});
  await new Promise(resolve=>setTimeout(resolve,150));
 },{component,props});
}

test('import modal closed/open/closed maintains hook order',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await mount(page,'ImportSwineModal');
 await page.evaluate(()=>(window as any).auditRender({isOpen:true}));
 await expect(page.getByText('Smart Swine Registry Importer',{exact:false}).first()).toBeVisible();
 await page.evaluate(()=>(window as any).auditRender({isOpen:false}));
 await expect(page.getByText('Smart Swine Registry Importer',{exact:false})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('GIS 20 normal clicks never select registration coordinates',async({page})=>{
 await mount(page,'GisMap');
 const map=page.locator('.leaflet-container');await expect(map).toBeVisible();
 for(let n=0;n<20;n++)await map.click({position:{x:180+n,y:400},force:true});
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});

test('GIS denied GPS permission preserves viewing mode',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
  getCurrentPosition:(_success:unknown,fail:(error:{code:number})=>void)=>fail({code:1}),
 }}));
 await mount(page,'GisMap');
 await page.getByRole('button',{name:'Locate Me',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Location permission was denied.');
 expect(await page.evaluate(()=>(window as any).auditMap.getZoom())).toBe(13);
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});

test('GIS mouse wheel zoom preserves viewing mode',async({page},info)=>{
 test.skip(info.project.name==='mobile','Mouse wheel is a desktop interaction.');
 await mount(page,'GisMap');
 await page.getByRole('button',{name:'Close map legend'}).click();
 const bounds=(await page.locator('.leaflet-container').boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width*0.6,bounds.y+350);
 await page.mouse.wheel(0,-500);
 await expect.poll(()=>page.evaluate(()=>(window as any).auditMap.getZoom())).toBeGreaterThan(13);
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});

test('GIS zoom, pan, reset, GPS and explicit location selection',async({page,context},info)=>{
 await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:10.42,longitude:125.20});
 await mount(page,'GisMap');await expect(page.locator('.leaflet-container')).toBeVisible();
 const initialLegend=page.getByRole('button',{name:'Close map legend'});if(await initialLegend.isVisible())await initialLegend.click();
 const zoom=()=>page.evaluate(()=>(window as any).auditMap.getZoom());
 await page.getByRole('button',{name:'Zoom In (+)',exact:true}).click();await expect.poll(zoom).toBe(14);
 await page.getByRole('button',{name:'Zoom Out (−)',exact:true}).click();await expect.poll(zoom).toBe(13);
 if(info.project.name==='desktop'){
 await page.locator('.leaflet-container').dblclick({position:{x:210,y:360},force:true});await expect.poll(zoom).toBe(14);
 await expect.poll(()=>page.evaluate(()=>(window as any).auditMap._animatingZoom || false)).toBe(false);
 const close=page.getByRole('button',{name:'Close barangay information'});if(await close.isVisible())await close.click();
 const legend=page.getByRole('button',{name:'Close map legend'});if(await legend.isVisible())await legend.click();
 const before=await page.evaluate(()=>(window as any).auditMap.getCenter().lng);
 const bounds=(await page.locator('.leaflet-container').boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width*0.55,bounds.y+280);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*0.55+80,bounds.y+280,{steps:10});await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>(window as any).auditMap.getCenter().lng)).not.toBe(before);
 }
 await page.getByRole('button',{name:'Reset View',exact:true}).click();await expect.poll(zoom).toBe(13);
 await page.getByRole('button',{name:'Locate Me',exact:true}).click();await expect.poll(zoom).toBe(16);
 expect(await page.evaluate(()=>(window as any).auditMap.getCenter().lat)).toBeCloseTo(10.42,3);
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
 await page.getByRole('button',{name:'Select Location for Registration',exact:false}).click();
 await page.locator('.leaflet-container').click({position:{x:160,y:360},force:true});
 expect(await page.evaluate(()=>(window as any).auditPicks.length)).toBe(1);
});

test('GIS swine markers open popup without edit or coordinate selection',async({page})=>{
 await mount(page,'GisMap',{swineList:[{id:'fixture-pig',pigIdTag:'HIN-2026-0001',farmerName:'Fixture Farmer',barangay:'Ambacon',latitude:10.39,longitude:125.195,swineType:'piglet',gender:'female',status:'active',registeredAt:'2026-01-01',readyToSell:true}]});
 await page.locator('.swine-map-marker').first().click();
 await expect(page.locator('.leaflet-popup')).toContainText('HIN-2026-0001');
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});

test('photo settings role transitions maintain hook order',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await mount(page,'PhotoMediaSettings');
 await page.evaluate(()=>(window as any).auditRender({currentUserRole:'admin'}));
 await expect(page.getByText('All Media',{exact:true}).first()).toBeVisible();
 await page.evaluate(()=>(window as any).auditRender({currentUserRole:'focal'}));
 await expect(page.getByText('All Media',{exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('print utility isolates intended document and restores after printing',async({page})=>{
 await page.goto('/tests/browser/component-harness.html');
 await page.waitForLoadState('networkidle');
 const result=await page.evaluate(async()=>{
  const path='/src/utils/printUtils.ts';
  const {printDocument}=await import(/* @vite-ignore */ path);
  const host=document.createElement('div');
  host.innerHTML='<div data-print-document="certificate">Certificate</div><div data-print-document="masterlist">Masterlist</div>';
  host.id='root';document.body.append(host);
  window.print=()=>{};printDocument('certificate');
  const active=document.querySelector('[data-print-document="certificate"]')!.getAttribute('data-print-selected');
  const excluded=document.querySelector('[data-print-document="masterlist"]')!.getAttribute('data-print-selected');
  return {active,excluded,target:document.body.dataset.printTarget};
 });
 expect(result).toEqual({active:'true',excluded:'false',target:'certificate'});
 await page.emulateMedia({media:'print'});
 await expect(page.locator('[data-print-document="certificate"]')).toBeVisible();
 await expect(page.locator('[data-print-document="masterlist"]')).toBeHidden();
 await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 expect(await page.evaluate(()=>document.body.dataset.printTarget)).toBeUndefined();
});

for(const role of ['admin','focal','agent'])test(`GIS ${role} markers obey visibility scope`,async({page})=>{
 const record={swineType:'piglet',gender:'female',status:'active',registeredAt:'2026-01-01',readyToSell:true,latitude:10.4015,longitude:125.195};
 await mount(page,'GisMap',{currentRole:role,currentUser:{role,assignedBarangay:'Ambacon'},swineList:[
  {...record,id:'a',pigIdTag:'HIN-2026-0001',farmerName:'Authorized Farmer',barangay:'Ambacon'},
  {...record,id:'b',pigIdTag:'HIN-2026-0002',farmerName:'Other Farmer',barangay:'Bangcas A'},
  {...record,id:'c',pigIdTag:'HIN-2026-0003',farmerName:'Not Ready Farmer',barangay:'Ambacon',readyToSell:false},
 ]});
 await expect(page.locator('.custom-swine-marker-div')).toHaveCount(role==='admin'?3:2);
 if(role==='agent')await expect(page.getByRole('button',{name:'Select Location for Registration',exact:false})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});

test('GIS boundaries, heatmap and base layers stay in viewing mode',async({page})=>{
 await mount(page,'GisMap');await expect(page.locator('.leaflet-container')).toBeVisible();
 const boundary=page.locator('.leaflet-overlay-pane path.leaflet-interactive').first();
 await boundary.dispatchEvent('click');
 await expect(page.getByText('Total Swine Heads',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close barangay information'}).click();
 await page.getByRole('checkbox',{name:'Heatmap',exact:true}).check();
 for(const layer of ['Satellite','Terrain','Street'])await page.getByRole('button',{name:layer,exact:true}).click();
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});

test('mobile touch dragging and pinch zoom operate on Leaflet',async({page,context},info)=>{
 test.skip(info.project.name!=='mobile','Touch gestures require the mobile project.');
 await mount(page,'GisMap');await expect(page.locator('.leaflet-container')).toBeVisible();
 const legend=page.getByRole('button',{name:'Close map legend'});if(await legend.isVisible())await legend.click();
 const bounds=(await page.locator('.leaflet-container').boundingBox())!;
 const x=bounds.x+130,y=bounds.y+350;
 const cdp=await context.newCDPSession(page);
 const touch=(id:number,x:number,y:number)=>({id,x,y,radiusX:1,radiusY:1,force:1});
 const center=await page.evaluate(()=>(window as any).auditMap.getCenter().lng);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(0,x,y)]});
 for(let n=1;n<=6;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(0,x+n*10,y)]});await page.waitForTimeout(40);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>page.evaluate(()=>(window as any).auditMap.getCenter().lng)).not.toBe(center);
 const zoom=await page.evaluate(()=>(window as any).auditMap.getZoom());
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(0,x-35,y),touch(1,x+35,y)]});
 for(let n=1;n<=6;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(0,x-35-n*10,y),touch(1,x+35+n*10,y)]});await page.waitForTimeout(40);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>page.evaluate(()=>(window as any).auditMap.getZoom())).toBeGreaterThan(zoom);
 expect(await page.evaluate(()=>(window as any).auditPicks)).toEqual([]);
});
