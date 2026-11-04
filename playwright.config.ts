import {defineConfig,devices} from '@playwright/test';
const port=process.env.PLAYWRIGHT_PORT || '4173';
export default defineConfig({
 testDir:'./tests/browser',outputDir:process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/development',timeout:120000,expect:{timeout:20000},workers:1,
 reporter:[['list'],['json',{outputFile:`${process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/development'}/browser-results.json`}]],
 use:{baseURL:`http://127.0.0.1:${port}`,trace:'retain-on-failure',serviceWorkers:'block'},
 webServer:{command:`npx vite --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,
  env:{DISABLE_HMR:'true',VITE_SUPABASE_URL:'https://auditfixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_test_fixture'}},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
});
