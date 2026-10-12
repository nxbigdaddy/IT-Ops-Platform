import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const AUTH=['resourcePresent','authorization'],DIGEST=[...AUTH,'digestComputed'],BIND=[...DIGEST,'approvalBinding'];
const stages=(names,failLast=false)=>names.map((name,index)=>({name,passed:!(failLast&&index===names.length-1)}));
const scenario=(id,label,eligible,code,names)=>({id,label,description:`${label}的合成说明`,eligible,code,stages:eligible?stages(names):stages(names,true),executionEnabled:false,approvalConsumed:false,productionEnabled:false});
const listBody=[
 scenario('all-gates-pass','三道门禁全部通过',true,'valid_snapshot_only',BIND),
 scenario('site-outside-scope','站点越权',false,'site_scope_denied',AUTH),
 scenario('viewer-request','观察者请求执行',false,'role_denied',AUTH),
 scenario('no-approval','没有审批证据',false,'independent_approval_required',AUTH),
 scenario('self-approved','自批后请求执行',false,'independent_approval_required',AUTH),
 scenario('approval-expired','审批已过期',false,'approval_time_invalid',BIND),
 scenario('approval-revoked','审批已撤销',false,'approval_revoked',BIND),
 scenario('approval-consumed','审批已被使用',false,'approval_consumed',BIND),
 scenario('digest-mismatch','审批摘要是另一套参数',false,'approval_binding_mismatch',BIND),
 scenario('version-mismatch','审批版本与草稿不符',false,'approval_binding_mismatch',BIND),
 scenario('malformed-draft','草稿本身无法规范化',false,'invalid_operation_draft',DIGEST),
];
const FAIL='执行门禁场景载入失败或响应不符；不显示诊断正文，不回退为本地判定。';
const CHECK_FAIL='执行门禁预检失败或响应不符；不显示诊断正文，不推断为可执行。';
let list=listBody,checkBody=null,gets=0,posts=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/execution-scenarios'))gets++;if(request.url().endsWith('/execution-preflight'))posts++;});
 else{
  await page.route('**/api/v1/execution-scenarios',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:list})})});
  await page.route('**/api/v1/execution-preflight',route=>{posts++;const id=route.request().postDataJSON().scenario;const found=checkBody??listBody.find(item=>item.id===id);const status=found&&found.id===id?200:400;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:found??null})})});
 }
 await page.goto(base+'/integration');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'执行门禁组合预检'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);assert.equal(posts,0);
 assert.ok(await panel.getByText(/调用方无法另外传入一个与当前参数脱节的摘要/).count()>=1);
 await panel.getByRole('button',{name:'载入执行门禁场景'}).click();
 await panel.getByText(/已载入 11 个执行门禁场景/).waitFor();assert.equal(gets,1);
 assert.equal(await panel.getByLabel('合成门禁场景').locator('option').count(),11);
 await panel.getByRole('button',{name:'运行执行门禁'}).click();
 if(live){await panel.getByLabel('执行阶段结果').waitFor();}
 else{
  await panel.getByText(/场景“三道门禁全部通过”：三道门禁均通过；仍不启用执行、不消费审批/).waitFor();assert.equal(posts,1);
  assert.equal(await panel.getByLabel('执行阶段结果').locator('tbody tr').count(),4);
  assert.ok((await panel.innerText()).includes('消费审批：否'));
  await panel.getByLabel('合成门禁场景').selectOption('site-outside-scope');
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(/在“角色与站点授权”处停止：站点超出授权范围/).waitFor();
  assert.equal(await panel.getByLabel('执行阶段结果').locator('tbody tr').count(),2);
  await panel.getByLabel('合成门禁场景').selectOption('malformed-draft');
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(/在“按当前草稿重算动作摘要”处停止：草稿无法规范化/).waitFor();
  await panel.getByLabel('合成门禁场景').selectOption('digest-mismatch');
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(/在“审批绑定与有效期”处停止：审批与当前草稿不匹配/).waitFor();
  for(const bad of [
   listBody.map(item=>item.id==='all-gates-pass'?{...item,executionEnabled:true}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,approvalConsumed:true}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,productionEnabled:true}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,eligible:false}:item),
   listBody.map(item=>item.id==='site-outside-scope'?{...item,code:'valid_snapshot_only'}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,code:'unknown_code'}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,stages:[]}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,stages:[{name:'unknownStage',passed:true}]}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,stages:stages(['resourcePresent'],true)}:item),
   listBody.map(item=>item.id==='all-gates-pass'?{...item,description:''}:item),
   [],
  ]){
   list=bad;await panel.getByRole('button',{name:'载入执行门禁场景'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  list=listBody;await panel.getByRole('button',{name:'载入执行门禁场景'}).click();await panel.getByText(/已载入 11 个执行门禁场景/).waitFor();
  checkBody={...listBody[0]};
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(/三道门禁均通过/).waitFor();
  checkBody={...listBody[0],executionEnabled:true};
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  checkBody={...listBody[0],id:'unknown'};
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();
  checkBody={...listBody[0],approvalConsumed:true};
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();
  checkBody=null;
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/execution-preflight',hold);
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText('正在提交执行门禁场景…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消门禁预检等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/execution-preflight',hold);
  await panel.getByRole('button',{name:'运行执行门禁'}).click();await panel.getByText(/三道门禁均通过/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'execution panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS execution gate preflight ${live?'actual local HTTP':'injected'}: staged gate order, stop points, non-execution markers and cancel.`);
}finally{await browser.close();}
