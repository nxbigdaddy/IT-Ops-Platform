import {createRequire} from 'node:module';import {existsSync,mkdirSync,writeFileSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(path.join(root,'src/frontend/package.json'));const{chromium}=require('playwright-core');
const executablePath=process.env.BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage();const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';const checks=[];
try{
 await page.goto(base+'/prompt-governance',{waitUntil:'networkidle'});
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 await page.getByRole('button',{name:'模拟测试',exact:true}).click();
 await page.getByText('模拟渲染结果 · 非 AI 生成',{exact:true}).waitFor();assert.equal(await page.getByText('模拟渲染结果 · 非 AI 生成',{exact:true}).count(),1);checks.push('valid samples render locally');
 const template=page.locator('#pg-template');await template.fill('{{unknown_name}}');assert.ok(await page.getByRole('button',{name:'模拟测试',exact:true}).isDisabled());checks.push('unknown variable blocks test');
 await template.fill('本地模板 {{asset_name}} {{alert_summary}}');await page.locator('#pg-sample-asset_name').fill('');assert.ok(await page.getByRole('button',{name:'模拟测试',exact:true}).isDisabled());checks.push('required sample blocks test');
 await page.locator('#pg-sample-asset_name').fill('demo-node');await page.getByRole('button',{name:'保存草稿',exact:true}).click();assert.ok((await page.locator('body').innerText()).includes('已保存本机内存草稿 v2'));checks.push('draft version saved');
 await page.getByRole('button',{name:'回滚为新草稿',exact:true}).click();assert.ok((await page.locator('body').innerText()).includes('生成新草稿 v3'));checks.push('restore creates new draft');
 await page.getByRole('button',{name:'发布预览（不发布）',exact:true}).click();
 await page.getByText('发布预览 · 未审批 · 未发布',{exact:true}).waitFor();assert.equal(await page.getByText('发布预览 · 未审批 · 未发布',{exact:true}).count(),1);checks.push('publish is preview only');
 await page.reload();
 await page.locator('#pg-baseline').waitFor();
 assert.equal(await page.locator('#pg-baseline option').count(),1);checks.push('ephemeral workspace resets on reload as disclosed');
 const out=path.join(root,'artifacts/prototype');mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'governance-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await browser.close();}
