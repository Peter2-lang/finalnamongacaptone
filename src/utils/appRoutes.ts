/** The browser pathname is the source of truth, including initial render and popstate. */
export const routeTabs: Record<string,string> = {
 '/dashboard':'dashboard','/superadmin/dashboard':'dashboard','/gis':'gis','/records':'records','/add_swine':'add_swine',
 '/reports':'certificate','/certificate':'certificate','/takeoff':'takeoff','/ready_to_sell':'ready_to_sell',
 '/biosecurity':'biosecurity','/marketing_alerts':'marketing_alerts','/asf-ordinance':'asf_ordinance','/asf_ordinance':'asf_ordinance',
 '/messages':'messages','/barangays':'barangays','/account':'account',
};
const adminPages:Record<string,string> = {'landing-page-cms':'landing_manager','sidebar-configuration':'sidebar_color','user-accounts':'accounts','api-configuration':'api_config','database-configuration':'database_config','registry-form-customization':'form_customizer'};
const superPages:Record<string,string> = {'system-appearance':'system_appearance','role-page-configuration':'role_page_config','feature-configuration':'feature_config','component-configuration':'component_config','chatbot-configuration':'chatbot_config','typography':'typography_config','branding':'branding_config','layout':'layout_config','version-history':'version_history','audit-logs':'audit_logs'};
for (const [page,tab] of Object.entries(adminPages)) for (const prefix of ['admin','superadmin']) routeTabs[`/${prefix}/${page}`]=tab;
for (const [page,tab] of Object.entries(superPages)) routeTabs[`/superadmin/${page}`]=tab;
// Modules also reached through configurable navigation and direct tab IDs.
for (const tab of ['landing_settings','admin_photo_media','photo_media','admin_logos','admin_background','admin_social','admin_theme','form_manager','nav_config','notification_config','popup_config','button_config']) routeTabs[`/${tab}`]=tab;
// Existing direct-tab URLs remain valid as aliases.
for (const tab of Object.values(routeTabs)) routeTabs[`/${tab}`] ||= tab;
export const normalizePath = (path:string) => path.toLowerCase().replace(/\/+$/,'') || '/';
export const tabForPath = (path:string) => routeTabs[normalizePath(path)] || 'dashboard';
