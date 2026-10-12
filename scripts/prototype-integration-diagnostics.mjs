import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));
const {chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage();
 await page.addInitScript(()=>{const original=window.fetch;window.fetch=(input,init)=>String(input).startsWith('/api/v1/')?Promise.reject(new Error('SYNTHETIC_PRIVATE_FETCH_DIAGNOSTIC')):original(input,init);});
 await page.goto('http://127.0.0.1:5173/integration');
 await page.getByRole('button',{name:'检查后端 Demo',exact:true}).click();
 await page.getByText('网络或响应处理失败；未显示诊断正文，未使用替代数据。',{exact:true}).first().waitFor();
 assert.equal(await page.getByText('网络或响应处理失败；未显示诊断正文，未使用替代数据。',{exact:true}).count(),7);
 assert.ok(!(await page.content()).includes('SYNTHETIC_PRIVATE_FETCH_DIAGNOSTIC'));
 assert.ok(await page.getByRole('button',{name:'检查后端 Demo',exact:true}).isEnabled());
 console.log('PASS seven integration probes suppress untrusted exception messages and restore controls.');
} finally {await browser.close();}
