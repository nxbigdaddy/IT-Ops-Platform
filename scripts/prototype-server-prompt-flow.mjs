import{createRequire}from'node:module';import{existsSync,mkdirSync,writeFileSync}from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(path.join(root,'src/frontend/package.json'));const{chromium}=require('playwright-core');
const executablePath=process.env.BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext();const page=await context.newPage();const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';const checks=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base+'/prompt-governance',{waitUntil:'networkidle'});
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 await page.getByRole('button',{name:'加载服务器提示词列表',exact:true}).click();
 await page.getByLabel('服务器提示词 ID',{exact:true}).selectOption('ticket-summary');
 await page.getByRole('button',{name:'加载服务器提示词详情',exact:true}).click();
 const content=page.getByLabel('服务器提示词内容',{exact:true});await content.waitFor();
 await page.waitForFunction(()=>document.querySelector('[aria-label="服务器提示词内容"]')?.value?.length>0);
 checks.push('explicit load obtains server draft');
 await content.fill('本地待保存草稿 {{ ticket_id }} {{ticket_details}}');
 const before=await (await context.request.get(base+'/api/v1/prompts/ticket-summary')).json();
 const rival=await context.request.post(base+'/api/v1/prompts/ticket-summary/versions',{data:{expectedVersion:before.data.currentVersion,content:'并发演示版本 {{ticket_id}}'}});assert.equal(rival.status(),201);
 await page.getByRole('button',{name:'保存服务器新版本',exact:true}).click();
 await page.waitForFunction(()=>document.body.innerText.includes('409'));
 assert.equal(await content.inputValue(),'本地待保存草稿 {{ ticket_id }} {{ticket_details}}');checks.push('409 preserves unsaved draft');
 await page.getByRole('button',{name:'重新加载服务器详情以比对',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="保存服务器新版本"]')?.disabled);
 assert.equal(await content.inputValue(),'本地待保存草稿 {{ ticket_id }} {{ticket_details}}');checks.push('explicit refresh preserves draft for comparison');
 await page.getByRole('button',{name:'保存服务器新版本',exact:true}).click();
 await page.waitForFunction(()=>document.body.innerText.includes('201'));
 const after=await(await context.request.get(base+'/api/v1/prompts/ticket-summary')).json();assert.equal(after.data.content,'本地待保存草稿 {{ ticket_id }} {{ticket_details}}');checks.push('save persists actual in-memory server version');
 await page.getByLabel('服务器恢复来源版本',{exact:true}).selectOption('1');await page.getByRole('button',{name:'恢复服务器历史为新版本',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="恢复服务器历史为新版本"]')?.disabled);
 const restored=await(await context.request.get(base+'/api/v1/prompts/ticket-summary')).json();assert.equal(restored.data.currentVersion,after.data.currentVersion+1);checks.push('restore appends server version');
 await page.route('**/api/v1/prompts/**',route=>route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({title:'Injected offline'})}));
 await page.getByRole('button',{name:'重新加载服务器详情以比对',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('503'));checks.push('unavailable backend shows failure not fallback');
 assert.equal(errors.length,0);const out=path.join(root,'artifacts/prototype');mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'server-prompt-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await browser.close();}
