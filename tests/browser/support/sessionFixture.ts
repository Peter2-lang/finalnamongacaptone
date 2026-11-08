import type {Page} from '@playwright/test';
import {DEFAULT_MASTER_CONFIG} from '../../../src/data/defaultMasterConfig';
import {INITIAL_LANDING_CMS_CONFIG} from '../../../src/data/initialLandingCmsData';
const userId='00000000-0000-4000-8000-000000000001';
const jwt=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url');
export async function fixture(page:Page,role:string,state:{records:any[]}={records:[]}){
 const project=process.env.PLAYWRIGHT_SUPABASE_PROJECT||'auditfixture';
 const profile={id:userId,authUserId:userId,username:'audit',email:'audit@example.invalid',name:'Audit fixture',role,assignedBarangay:'Ambacon',active:true,isActive:true,status:'active',permissions:[]};
 const authUser={id:userId,email:profile.email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const token=`${jwt({alg:'HS256',typ:'JWT'})}.${jwt({sub:userId,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})}.fixture`;
 await page.route(`https://${project}.supabase.co/**`,route=>route.fulfill({json:route.request().url().includes('/auth/v1/user')?authUser:{data:[],user:authUser}}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data:any=[];
  if(path==='/api/swine-records')data=state.records;
  else if(path==='/api/auth/profile'||path==='/api/auth/superadmin-profile')data=profile;
  else if(path==='/api/connectivity')return route.fulfill({json:{connection_check:true,service:'hinunangan-swine-registry',database:'connected'}});
  else if(path==='/api/config/master')data={published:DEFAULT_MASTER_CONFIG,draft:DEFAULT_MASTER_CONFIG};
  else if(path.includes('registry-schema'))data={version:1,sections:[]};
  else if(path==='/api/landing-cms/published'||path.includes('landing-cms/draft'))data=INITIAL_LANDING_CMS_CONFIG;
  else if(path.includes('landing-config')||path.includes('landing/settings'))data={};
  else if(path==='/api/health')return route.fulfill({json:{service:'hinunangan-swine-registry',status:'healthy',database:'connected',schema:'ready',cloud:'online',authentication:'available'}});
  else if(path==='/api/sync/pull')data={swineRecords:state.records,certificates:[],messages:[]};
  else if(path.startsWith('/api/settings'))data={};
  await route.fulfill({json:{success:true,data,total:0,count:0,schema:path.includes('registry-schema')?{version:1,sections:[]}:undefined,config:path.includes('landing')?INITIAL_LANDING_CMS_CONFIG:undefined,theme:path.includes('sidebar-theme')?{}:undefined}});
 });
 await page.addInitScript(({token,authUser,project})=>localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({access_token:token,refresh_token:'isolated-fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:authUser})),{token,authUser,project});
}
