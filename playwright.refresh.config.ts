import config from './playwright.config';
const live=process.env.REFRESH_PRODUCTION_URL;
export default {
 ...config,
 testMatch:'refresh-restoration.spec.ts',
 outputDir:'test-results/refresh-restoration',
 reporter:[['list'],['json',{outputFile:'test-results/refresh-restoration/results.json'}]],
 use:{...config.use,baseURL:live||'http://127.0.0.1:4179'},
 webServer:live?undefined:{command:'npm run build && npx vite preview --host 127.0.0.1 --port 4179 --strictPort',url:'http://127.0.0.1:4179',reuseExistingServer:false,timeout:180000,
 env:{VITE_SUPABASE_URL:'https://auditfixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_test_fixture'}},
};
