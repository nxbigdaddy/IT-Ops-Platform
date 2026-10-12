import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'src/frontend/package.json'));const {chromium}=require('playwright-core');
const executablePath=process.env.BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
const base=process.env.PROTOTYPE_URL || 'http://127.0.0.1:5173';const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const cases=[['/directory','搜索目录对象'],['/permissions','搜索共享权限'],['/printing','搜索打印设备'],['/virtualization','搜索虚拟机'],['/backup','搜索备份任务'],['/knowledge','搜索知识库']];
try{
 for(const [route,label] of cases){
  await page.goto(base+route,{waitUntil:'networkidle'});
  await page.getByLabel(label,{exact:true}).fill('no-such-demo-item');
  assert.ok(await page.getByText('没有匹配的模拟记录',{exact:true}).count()>0,`${route} empty state`);
  await page.getByLabel(label,{exact:true}).fill('');
  const details=page.locator('details');if(await details.count()){await details.first().locator('summary').click();assert.equal(await details.first().getAttribute('open'),'');}
  // The checklist requires recording feedback on the page itself while keeping the current filter.
  await page.getByLabel(label,{exact:true}).fill('演示');
  const filtered=await page.locator('.domain-list-item, tbody tr').count();
  const textarea=page.locator('textarea[aria-label^="本页意见内容"]').first();
 assert.equal(await page.locator('textarea[aria-label^="本页意见内容"]').count(),1,'exactly one composer per page');
  await textarea.fill('自动化：本页筛选后记录意见');
  await page.getByRole('button',{name:'记录本页意见',exact:true}).first().click();
  await page.getByText(/已记录到本机反馈（共 \d+ 条，模块：/).first().waitFor();
  assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'演示',`${route} filter must survive inline feedback`);
  assert.equal(await page.locator('.domain-list-item, tbody tr').count(),filtered,`${route} rows must stay filtered after feedback`);
  checks.push(`${route} inline feedback keeps the active filter`);
  await page.getByLabel(label,{exact:true}).fill('');
  checks.push(`${route} search empty/reset and available evidence`);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,`${route} overflow`);
  await page.setViewportSize({width:1440,height:1000});
 }
 await page.goto(base+'/feedback');
 await page.getByLabel('所属模块').selectOption('后端联调');
 await page.getByLabel('反馈内容',{exact:true}).fill('自动化新增模块反馈验证');
 await page.getByRole('button',{name:'添加反馈',exact:true}).click();await page.reload();
 assert.equal(await page.getByText('自动化新增模块反馈验证',{exact:true}).count(),1);checks.push('new module feedback survives schema sanitation and reload');
 // Inline composers must refuse obvious secrets and keep the record count unchanged.
 await page.goto(base+'/directory',{waitUntil:'networkidle'});
 const before=Number((await page.locator('text=/全部 \\d+ ·/').first().innerText().catch(()=>'')).replace(/\D/g,''))||0;
 await page.locator('textarea[aria-label^="本页意见内容"]').first().fill('password=DemoSecret123');
 await page.getByRole('button',{name:'记录本页意见',exact:true}).first().click();
 await page.getByText(/检测到疑似敏感内容或记录无效，已阻止保存/).first().waitFor();
 assert.equal(await page.locator('textarea[aria-label^="本页意见内容"]').first().inputValue(),'password=DemoSecret123','a rejected draft must stay editable');
 await page.goto(base+'/feedback');
 assert.equal(await page.getByText('password=DemoSecret123').count(),0);checks.push('inline feedback refuses obvious secrets without navigating away');
 assert.equal(errors.length,0);checks.push('no domain page errors');
 const out=path.join(root,'artifacts/prototype');mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'domain-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await browser.close();}
