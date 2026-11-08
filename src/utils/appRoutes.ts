/** The browser pathname is the source of truth, including initial render and popstate. */
export const routeTabs: Record<string,string> = {
 '/dashboard':'dashboard','/kamirani':'dashboard','/kamirani/dashboard':'dashboard','/gis':'gis','/records':'records','/add_swine':'add_swine',
 '/reports':'certificate','/certificate':'certificate','/takeoff':'takeoff','/ready_to_sell':'ready_to_sell',
 '/biosecurity':'biosecurity','/marketing_alerts':'marketing_alerts','/asf-ordinance':'asf_ordinance','/asf_ordinance':'asf_ordinance',
 '/messages':'messages','/barangays':'barangays','/account':'account',
};
const adminPages:Record<string,string> = {'landing-page-cms':'landing_manager','sidebar-configuration':'sidebar_color','user-accounts':'accounts','api-configuration':'api_config','database-configuration':'database_config','registry-form-customization':'form_customizer'};
const superPages:Record<string,string> = {'system-appearance':'system_appearance','role-page-configuration':'role_page_config','feature-configuration':'feature_config','component-configuration':'component_config','chatbot-configuration':'chatbot_config','typography':'typography_config','branding':'branding_config','layout':'layout_config','version-history':'version_history','audit-logs':'audit_logs'};
for (const [page,tab] of Object.entries(adminPages)) for (const prefix of ['admin','kamirani']) routeTabs[`/${prefix}/${page}`]=tab;
for (const [page,tab] of Object.entries(superPages)) routeTabs[`/kamirani/${page}`]=tab;
// Modules also reached through configurable navigation and direct tab IDs.
for (const tab of ['landing_settings','admin_photo_media','photo_media','admin_logos','admin_background','admin_social','admin_theme','form_manager','nav_config','notification_config','popup_config','button_config']) routeTabs[`/${tab}`]=tab;
// Existing direct-tab URLs remain valid as aliases.
for (const tab of Object.values(routeTabs)) routeTabs[`/${tab}`] ||= tab;
export const normalizePath = (path:string) => path.split(/[?#]/)[0].toLowerCase().replace(/\/+$/,'') || '/';
export const isLegacySuperAdminPath = (path:string) => { const value=normalizePath(path);return value==='/superadmin'||value.startsWith('/superadmin/'); };
export const isSuperAdminPath = (path:string) => { const value=normalizePath(path);return value==='/kamirani'||value.startsWith('/kamirani/')||isLegacySuperAdminPath(value); };
/** Legacy URLs are public; the new portal requires a verified existing role. */
export function superAdminRouteRedirect(path:string,role:string|undefined):'/'|null {
  if (isLegacySuperAdminPath(path)) return '/';
  return isSuperAdminPath(path) && role!=='super_admin' ? '/' : null;
}
export const tabForPath = (path:string) => routeTabs[normalizePath(path)] || 'dashboard';

const staffTabs = new Set(['dashboard','add_swine','records','gis','certificate','takeoff','biosecurity','marketing_alerts','messages','account']);
const adminTabs = new Set([...staffTabs,'asf_ordinance','barangays','accounts','form_customizer','form_manager']);
const agentTabs = new Set(['dashboard','ready_to_sell','takeoff','gis','messages','account']);
/** Mirrors existing page guards; direct URLs must not silently render another module. */
export function canAccessTab(role:string,tab:string):boolean {
  if (role === 'super_admin') return Object.values(routeTabs).includes(tab);
  if (role === 'admin') return adminTabs.has(tab);
  if (role === 'focal') return staffTabs.has(tab);
  if (role === 'agent') return agentTabs.has(tab);
  return false;
}


/** Preserve page context without carrying authentication callback credentials. */
export function safeReturnPath(location:{pathname:string;search:string;hash:string}):string {
 const params=new URLSearchParams(location.search);
 for(const key of ['access_token','refresh_token','token','token_hash','code'])params.delete(key);
 const search=params.toString();const hash=/access_token=|refresh_token=|token_hash=/.test(location.hash)?'':location.hash;
 return location.pathname+(search?'?'+search:'')+hash;
}
