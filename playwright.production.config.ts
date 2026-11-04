import config from './playwright.config';
export default {
 ...config,
 outputDir:'test-results/production',
 reporter:[['list'],['json',{outputFile:'test-results/production/browser-results.json'}]],
 testMatch:'system.spec.ts',
 use:{...config.use,baseURL:'http://127.0.0.1:4175'},
 webServer:{
  command:'npm run build && npx vite preview --host 127.0.0.1 --port 4175 --strictPort',
  url:'http://127.0.0.1:4175',reuseExistingServer:false,timeout:180000,
  // Build-time browser configuration must match the isolated API/Auth fixtures.
  env:{VITE_SUPABASE_URL:'https://auditfixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_test_fixture'},
 },
};
