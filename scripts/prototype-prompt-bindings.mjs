import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const notes='绑定状态仅描述草稿与发布修订的关系；未实现审批、发布生效或模型调用。';
const bindings=[
 {feature:'alerts',promptId:'alert-explanation',name:'告警解释',currentVersion:2,publishedVersion:1,publishedFrom:1,bindingStatus:'draft-ahead',modelExecutionEnabled:false,notes},
 {feature:'inspection',promptId:'inspection-report',name:'巡检报告',currentVersion:1,publishedVersion:0,publishedFrom:0,bindingStatus:'unpublished',modelExecutionEnabled:false,notes},
 {feature:'tickets',promptId:'ticket-summary',name:'工单摘要',currentVersion:3,publishedVersion:2,publishedFrom:3,bindingStatus:'published-current',modelExecutionEnabled:false,notes},
];
const LOAD_OK='已载入 3 项功能绑定；尚未发布 1、草稿领先 1、与草稿一致 1。均未启用模型执行。';
const FAIL='功能绑定载入失败或响应不符；不显示诊断正文，不回退本地映射。';
const coverageBody={bound:[{feature:'alerts',label:'告警解释',promptIds:['alert-explanation']},{feature:'inspection',label:'巡检报告',promptIds:['inspection-report']},{feature:'tickets',label:'工单摘要',promptIds:['ticket-summary']}],unbound:[{feature:'change-summary',label:'变更摘要',promptIds:[]},{feature:'knowledge-search',label:'知识检索问答',promptIds:[]}],orphanPrompts:[],modelExecutionEnabled:false,productionEnabled:false,notes:'覆盖核对只比较功能登记与提示词归属。'};
let body=bindings,gets=0;
let coverage=coverageBody,coverageGets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live){
  page.on('request',request=>{if(request.url().endsWith('/prompt-bindings'))gets++;if(request.url().endsWith('/prompt-feature-coverage'))coverageGets++;});
 }else{
  await page.route('**/api/v1/prompt-bindings',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:body})})});
  await page.route('**/api/v1/prompt-feature-coverage',route=>{coverageGets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:coverage})})});
 }
 await page.goto(base+'/prompt-governance');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'功能与提示词绑定'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 await panel.getByRole('button',{name:'载入功能绑定'}).click();
 if(live){await panel.getByLabel('功能绑定清单').waitFor();}
 else{
  await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
  const table=panel.getByLabel('功能绑定清单');assert.equal(await table.locator('tbody tr').count(),3);
  assert.ok((await table.innerText()).includes('已发布但草稿领先'),await table.innerText());
  assert.ok((await table.innerText()).includes('尚未发布'));
  assert.ok((await table.innerText()).includes('已发布且与当前草稿一致'));
  assert.equal(await panel.getByText('未启用',{exact:true}).count(),3);
  assert.ok(await panel.getByText(/不.*启用模型执行、不代表审批通过或已上线/).count()>=1);
  const downloadWait=page.waitForEvent('download');await panel.getByRole('button',{name:'导出功能绑定 CSV（含批注列）'}).click();
  const file=await downloadWait;assert.equal(file.suggestedFilename(),'prompt-bindings-template.csv');
  const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
  const csv=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'').trim().split('\n');
  assert.equal(csv[0],'feature,promptId,name,currentVersion,publishedVersion,publishedFrom,bindingStatus,modelExecutionEnabled,首批纳入,部门意见');
  assert.equal(csv.length,4);
  assert.ok(csv.slice(1).every(line=>line.includes(',否,')),csv.join('\n'));
  assert.ok(csv.some(line=>line.includes('尚未发布'))&&csv.some(line=>line.includes('已发布但草稿领先'))&&csv.some(line=>line.includes('已发布且与当前草稿一致')),csv.join('\n'));
  for(const bad of [
   bindings.map(item=>item.feature==='alerts'?{...item,bindingStatus:'published-current'}:item),
   bindings.map(item=>item.feature==='alerts'?{...item,publishedFrom:5}:item),
   bindings.map(item=>item.feature==='alerts'?{...item,modelExecutionEnabled:true}:item),
   bindings.map(item=>item.feature==='alerts'?{...item,publishedVersion:0}:item),
   [bindings[0],{...bindings[1],feature:'alerts'}],
   [bindings[0],{...bindings[1],promptId:'alert-explanation'}],
   bindings.map(item=>item.feature==='alerts'?{...item,notes:' '}:item),
   [],
  ]){
   body=bad;await panel.getByRole('button',{name:'载入功能绑定'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  body=bindings;await panel.getByRole('button',{name:'载入功能绑定'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  // Feature coverage: gaps must be listed explicitly, never filled with invented prompts.
  const beforeCoverage=coverageGets;
  await panel.getByRole('button',{name:'核对功能覆盖'}).click();
  await panel.getByText(/已核对 5 个计划功能：已登记提示词 3、尚无提示词 2、未注册归属 0/).waitFor();
  assert.equal(coverageGets,beforeCoverage+1);
  const coverageTable=panel.getByLabel('功能覆盖核对');
  assert.equal(await coverageTable.locator('tbody tr').count(),5);
  assert.ok((await coverageTable.innerText()).includes('尚无提示词（规划中）'),await coverageTable.innerText());
  assert.ok((await coverageTable.innerText()).includes('变更摘要'));
  assert.ok((await panel.innerText()).includes('启用模型执行：否'));
  for(const bad of [
   {...coverageBody,modelExecutionEnabled:true},
   {...coverageBody,productionEnabled:true},
   {...coverageBody,notes:' '},
   {...coverageBody,unbound:[{feature:'change-summary',label:'变更摘要',promptIds:['alert-explanation']},{...coverageBody.unbound[1]}]},
   {...coverageBody,bound:[{feature:'alerts',label:'告警解释',promptIds:[]},...coverageBody.bound.slice(1)]},
   {...coverageBody,bound:[coverageBody.bound[0],{...coverageBody.bound[1],feature:'alerts'},coverageBody.bound[2]]},
   {...coverageBody,orphanPrompts:['']},
   {...coverageBody,bound:'none'},
  ]){
   coverage=bad;await panel.getByRole('button',{name:'核对功能覆盖'}).click();await panel.getByText('功能覆盖核对失败或响应不符；不显示诊断正文，不回退为本地结论。',{exact:true}).waitFor();
   await page.waitForFunction(()=>!document.querySelector('[aria-label="功能覆盖核对"]'));
  }
  coverage=coverageBody;await panel.getByRole('button',{name:'核对功能覆盖'}).click();await panel.getByText(/已核对 5 个计划功能/).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/prompt-bindings',hold);
  await panel.getByRole('button',{name:'载入功能绑定'}).click();await panel.getByText('正在载入功能绑定…',{exact:true}).waitFor();assert.equal(await panel.getByLabel('功能绑定清单').count(),0);
  await panel.getByRole('button',{name:'取消绑定载入等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/prompt-bindings',hold);await panel.getByRole('button',{name:'载入功能绑定'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
 }
 if(live){
  await panel.getByRole('button',{name:'核对功能覆盖'}).click();await panel.getByLabel('功能覆盖核对').waitFor();
  assert.ok(await panel.getByText(/已核对 \d+ 个计划功能/).count()>=1);
  assert.ok(await panel.getByText(/启用模型执行：否/).count()>=1);
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'binding panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS prompt feature bindings ${live?'actual local HTTP':'injected'}: explicit load, status derivation, invalid shapes and cancel.`);
}finally{await browser.close();}
