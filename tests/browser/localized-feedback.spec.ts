import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';

test('UI feedback changes language while inserted names and input values remain untouched',async({page})=>{
 await page.goto('/tests/browser/component-harness.html');await page.waitForFunction(()=>Boolean((window as any).auditCreateRoot));
 await page.evaluate(async()=>{
  const load=(path:string)=>import(/* @vite-ignore */ path);
  const [{LanguageProvider},{LocalizedFeedback},{languageService}]=await Promise.all([load('/src/context/LanguageContext.tsx'),load('/src/i18n/LocalizedFeedback.tsx'),load('/src/services/languageService.ts')]);
  const win=window as any;win.testLanguageService=languageService;
  const host=document.createElement('div');document.body.append(host);
  const react=win.auditReact;
  win.auditCreateRoot(host).render(react.createElement(LanguageProvider,null,react.createElement('div',null,react.createElement(LocalizedFeedback,{value:'No records match “Juan Dela Cruz”.'}),react.createElement('input',{'aria-label':'Preserved value',defaultValue:'Cancel'}))));
 });
 await page.getByRole('textbox',{name:'Preserved value'}).fill('Farmer Name');
 for(const language of ['ceb','fil','en']){
  await page.evaluate(language=>(window as any).testLanguageService.setLanguage(language),language);
  await expect(page.getByText(/Juan Dela Cruz/)).toBeVisible();await expect(page.getByRole('textbox',{name:'Preserved value'})).toHaveValue('Farmer Name');
  const prefix=language==='ceb'?'Walay rekord':language==='fil'?'Walang talang':'No records';await expect(page.getByText(new RegExp(prefix))).toBeVisible();
 }
});

test('farmer names that match interface words are preserved in actual records',async({page})=>{
 await fixture(page,'admin',{records:[{id:'00000000-0000-4000-8000-000000000099',farmerName:'Cancel',barangay:'Ambacon',pigIdTag:'HIN-2026-0099',earTagNo:'HIN-2026-0099',registeredAt:'2026-11-06T00:00:00Z',swineType:'grower',readyToSell:false,status:'healthy',customFields:{}}]});
 await page.goto('/records');await expect(page.getByText('Cancel',{exact:true}).filter({visible:true}).first()).toBeVisible();
 for(const language of ['ceb','fil','en']){
  await page.locator('header select').first().selectOption(language);await expect(page.getByText('Cancel',{exact:true}).filter({visible:true}).first()).toBeVisible();
 }
});
