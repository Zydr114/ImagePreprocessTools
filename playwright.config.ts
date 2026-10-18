import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'tests/e2e',timeout:120000,fullyParallel:false,workers:1,
 reporter:[['list'],['json',{outputFile:'artifacts/playwright-results.json'}]],
 use:{baseURL:process.env.TEST_BASE_URL||'http://127.0.0.1:5188',viewport:{width:1440,height:1000},trace:'retain-on-failure',launchOptions:{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox',...(process.env.GPU_TEST==='1'?['--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan']:[])]}},
 webServer:process.env.TEST_BASE_URL?undefined:{command:'npm run dev',url:'http://127.0.0.1:5188',reuseExistingServer:true},
});
