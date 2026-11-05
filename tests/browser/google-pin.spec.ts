import {test,expect} from '@playwright/test';

test('Google provider places exact pins without camera commands or double-click zoom',async({page})=>{
 // Exercise the real component with an isolated Maps SDK adapter: no API key,
 // billable requests, or external Google service is used.
 await page.route('https://maps.googleapis.com/**',route=>route.abort());
 await page.route(/.*@vis_+gl_react-google-maps.*\.js.*/,route=>route.fulfill({contentType:'application/javascript',body:`
 const React=window.auditReact;
 const win=window;
 win.googleCameraCalls=[];
 const map={center:{lat:10.4018,lng:125.1845},zoom:13,panTo(point){this.center=point;win.googleCameraCalls.push(['pan',point]);},setCenter(point){this.center=point;win.googleCameraCalls.push(['center',point]);},setZoom(zoom){this.zoom=zoom;win.googleCameraCalls.push(['zoom',zoom]);},getZoom(){return this.zoom;}};
 win.googleFixtureMap=map;
 export const useMap=()=>map;
 export const useApiIsLoaded=()=>true;
 export const APILoadingStatus={LOADED:'LOADED',FAILED:'FAILED'};
 export const useApiLoadingStatus=()=>APILoadingStatus.LOADED;
 export const APIProvider=({children})=>children;
 export const Map=props=>{win.googleMapOptions=props.options;return React.createElement('div',{'data-testid':'google-map',style:{height:700,width:'100%'},onClick:()=>props.onClick({detail:{latLng:win.googleNextPoint}})},props.children);};
 export const AdvancedMarker=props=>React.createElement('div',{'data-testid':'google-marker','data-position':JSON.stringify(props.position)},props.children);
 export const Polygon=()=>null;
 export const Circle=()=>null;
 export const InfoWindow=({children})=>React.createElement('div',null,children);
 `}));
 await page.route(/\/src\/services\/apiSettings\.ts(\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
 export const useApiSettings=()=>({settings:{googleMapsKey:'isolated-sdk-fixture',quotaDefenseEnabled:false},error:null,loading:false});
 `}));
 await page.route('**/api/**',route=>route.fulfill({json:{success:true,value:{googleMapsKey:'isolated-sdk-fixture'}}}));
 await page.goto('/tests/browser/component-harness.html');
 await page.waitForFunction(()=>Boolean((window as any).auditCreateRoot));
 await page.evaluate(async()=>{
  const win=window as any;
  const load=(path:string)=>import(/* @vite-ignore */ path);
  const {GoogleGisMap}=await load('/src/components/gis/GoogleGisMap.tsx');
  const host=document.createElement('div');document.body.replaceChildren(host);
  const root=win.auditCreateRoot(host);win.googlePicks=[];
  const render=(patch:any={})=>root.render(win.auditReact.createElement(GoogleGisMap,{
   swineList:[],barangays:[],currentRole:'admin',initialCenter:[10.4018,125.1845],
   onPickLocation:(lat:number,lng:number,barangay:string)=>{win.googlePicks.push([lat,lng,barangay]);render({initialCenter:[lat,lng],selectedBarangay:barangay});},...patch,
  }));
  render();
 });
 await expect(page.getByTestId('google-map')).toBeVisible();
 await page.getByRole('button',{name:'Select Location for Registration'}).click();
 const baseline=await page.evaluate(()=>(window as any).googleCameraCalls);
 for(const point of [{lat:10.40181234567,lng:125.18451234567},{lat:10.40191234567,lng:125.18461234567}]){
  await page.evaluate(point=>(window as any).googleNextPoint=point,point);
  await page.getByTestId('google-map').click({position:{x:120,y:300}});
  await expect(page.getByTestId('google-marker')).toHaveCount(1);
  expect(JSON.parse((await page.getByTestId('google-marker').getAttribute('data-position'))!)).toEqual(point);
  expect(await page.evaluate(()=>(window as any).googleCameraCalls)).toEqual(baseline);
 }
 expect(await page.evaluate(()=>(window as any).googlePicks.map((pick:any)=>pick.slice(0,2)))).toEqual([[10.40181234567,125.18451234567],[10.40191234567,125.18461234567]]);
 expect(await page.evaluate(()=>(window as any).googleMapOptions)).toMatchObject({draggableCursor:'crosshair',disableDoubleClickZoom:true});
 await page.getByRole('button',{name:'Pin Mode Active'}).click();
 expect(await page.evaluate(()=>(window as any).googleMapOptions.disableDoubleClickZoom)).toBe(false);
 expect(await page.evaluate(()=>(window as any).googleCameraCalls)).toEqual(baseline);
});
