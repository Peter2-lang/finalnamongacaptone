import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',timeout:120000,expect:{timeout:20000},workers:1,
 reporter:[['list'],['json',{outputFile:'test-results/browser-results.json'}]],
 use:{baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure',serviceWorkers:'block'},
 webServer:{command:'npx vite --host 127.0.0.1 --port 4173 --strictPort',url:'http://127.0.0.1:4173',reuseExistingServer:false,
  env:{VITE_SUPABASE_URL:'https://auditfixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_test_fixture'}},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
});
