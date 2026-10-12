import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const OPERATION_ID='22222222-2222-2222-2222-222222222222';
const summary={capacity:500,count:3,pending:1,completed:1,unknown:1,remaining:497,persistent:false};
const record={scope:'demo:actor',operation:'task.transition',key:'synthetic-key',digest:'a'.repeat(64),operationId:OPERATION_ID,state:'completed',resultVersion:2,resultReference:null};
const SUMMARY_OK='台账共 3 项（待处理 1 · 已提交 1 · 结果未知 1），上限 500。仅进程内存，重启即丢失。';
const SUMMARY_FAIL='台账摘要不可用或响应不符；不显示诊断正文，不回退本地计数。';
const LOOKUP_OK='已按操作ID查询到记录；这是对账读取，不会重放或重试该操作。';
const LOOKUP_MISSING='未找到该操作记录：可能已随进程重启丢失，或本就未认领。不代表未提交，请勿凭猜测重发。';
let summaryBody=summary,recordBody=record,gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().includes('/api/v1/demo-operations'))gets++;});
 if(!live)await page.route('**/api/v1/demo-operations',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:summaryBody})})});
 if(!live)await page.route('**/api/v1/demo-operations/*',route=>{recordBody===null?route.fulfill({status:404,contentType:'application/problem+json',body:JSON.stringify({isDemo:true,persistence:'memory',code:'operation_not_found'})}):route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:recordBody})});});
 await page.goto(base+'/integration');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'操作幂等台账'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 if(live){await panel.getByRole('button',{name:'载入台账摘要'}).click();await panel.getByLabel('台账摘要').waitFor();assert.ok((await panel.innerText()).includes('上限'));}
 else{
  await panel.getByRole('button',{name:'载入台账摘要'}).click();await panel.getByText(SUMMARY_OK,{exact:true}).waitFor();assert.equal(gets,1);
  assert.equal(await panel.locator('tbody tr').count(),1);
  assert.equal(await panel.getByRole('cell',{name:'497',exact:true}).count(),1);
  for(const bad of [{...summary,remaining:1},{...summary,pending:2},{...summary,persistent:true},{...summary,capacity:0},{...summary,count:999},{}]){
   summaryBody=bad;await panel.getByRole('button',{name:'载入台账摘要'}).click();await panel.getByText(SUMMARY_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  summaryBody=summary;await panel.getByRole('button',{name:'载入台账摘要'}).click();await panel.getByText(SUMMARY_OK,{exact:true}).waitFor();
  const input=panel.getByLabel('操作ID');const query=panel.getByRole('button',{name:'查询操作记录'});
  await input.fill('not-a-guid');await query.click();await panel.getByText('请输入合法操作ID（GUID）后再查询。',{exact:true}).waitFor();
  await input.fill(OPERATION_ID);await query.click();await panel.getByText(LOOKUP_OK,{exact:true}).waitFor();
  const list=panel.getByLabel('操作记录');assert.equal(await list.locator('li').count(),4);
  assert.ok((await list.innerText()).includes('结果版本：2'),await list.innerText());
  for(const bad of [{...record,digest:'zz'},{...record,state:'done'},{...record,operationId:'33333333-3333-3333-3333-333333333333'},{...record,resultVersion:-1},null]){
   recordBody=bad;await query.click();if(bad===null)await panel.getByText(LOOKUP_MISSING,{exact:true}).waitFor();else await panel.getByText('查询失败或响应不符；不显示诊断正文，不自动重发。',{exact:true}).waitFor();
   assert.equal(await list.count(),0);
  }
  recordBody=record;await query.click();await panel.getByText(LOOKUP_OK,{exact:true}).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'ledger panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS operation ledger ${live?'actual local HTTP':'injected'}: summary bounds, reconciliation lookup, missing record and narrow layout.`);
}finally{await browser.close();}
