import config from './playwright.refresh.config';
export default {
 ...config,
 testMatch:'superadmin-route.spec.ts',
 outputDir:'test-results/superadmin-login',
 reporter:[['list'],['json',{outputFile:'test-results/superadmin-login/results.json'}]],
};
