import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const ALL=['identityPresent','resourceWellFormed','knownPermission','siteScopeAllows','roleAllowsAction'];
const rules=(names=ALL,failLast=false)=>names.map((name,index)=>({name,passed:!(failLast&&index===names.length-1)}));
const scenario=(id,label,action,ok,code,names)=>({id,label,description:`${label}的合成说明`,role:ok?'Operator':'Viewer',action,siteId:'site-a',allowed:ok,code,rules:ok?rules(names??ALL):rules(names??[...ALL,'roleAllowsAction'],true),executionEnabled:false,productionEnabled:false});
const listBody=[
 scenario('viewer-read-in-scope','观察者读取本站点','Read',true,'allowed'),
 scenario('operator-edit-allowed','运维编辑本站点草稿','EditDraft',true,'allowed'),
 scenario('request-approved-allowed','已被他人批准后请求执行','RequestExecution',true,'allowed',[...ALL,'independentApproval']),
 scenario('viewer-edit-denied','观察者编辑草稿','EditDraft',false,'role_denied'),
 scenario('site-outside-scope','站点超出授权范围','Read',false,'site_scope_denied',['identityPresent','resourceWellFormed','knownPermission']),
 scenario('approver-self-approval','审批人批准自己的申请','ApproveChange',false,'self_approval_denied',[...ALL,'independentApprover']),
 scenario('request-without-approval','未批准就请求执行','RequestExecution',false,'independent_approval_required',[...ALL,'independentApproval']),
 scenario('unknown-role','未知角色','Read',false,'unknown_permission',['identityPresent','resourceWellFormed']),
 scenario('missing-identity','缺少身份','Read',false,'identity_required',['identityPresent']),
 scenario('missing-resource','缺少资源','Read',false,'resource_required',['identityPresent','resourceWellFormed']),
 scenario('viewer-request-denied','观察者请求执行','RequestExecution',false,'role_denied'),
 scenario('operator-approve-denied','运维尝试审批','ApproveChange',false,'role_denied'),
 scenario('approver-approve-allowed','审批人批准他人申请','ApproveChange',true,'allowed',[...ALL,'independentApprover']),
 scenario('request-self-approved','自批后请求执行','RequestExecution',false,'independent_approval_required',[...ALL,'independentApproval']),
];
const LOAD_OK='已载入 14 个授权场景；角色、站点与批准独立性均由后端规则实际求值，任何结果都不授权执行。';const LOAD_FAIL='授权场景载入失败或响应不符；不显示诊断正文，不回退为本地判定。';
const CHECK_FAIL='授权预检失败或响应不符；不显示诊断正文，不推断为允许。';
let list=listBody,checkBody=null,gets=0,posts=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/authorization-scenarios'))gets++;if(request.url().endsWith('/authorization-preflight'))posts++;});
 else{
  await page.route('**/api/v1/authorization-scenarios',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:list})})});
  await page.route('**/api/v1/authorization-preflight',route=>{posts++;const id=route.request().postDataJSON().scenario;const found=checkBody??listBody.find(item=>item.id===id);const status=found&&found.id===id?200:400;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:found??null})})});
 }
 await page.goto(base+'/integration');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'角色与站点授权预检'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);assert.equal(posts,0);
 assert.ok(await panel.getByText(/无通配站点、无大小写折叠、管理员也没有旁路/).count()>=1);
 await panel.getByRole('button',{name:'载入授权场景'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
 assert.equal(await panel.getByLabel('合成授权场景').locator('option').count(),14);
 await panel.getByRole('button',{name:'运行授权规则'}).click();
 if(live){await panel.getByLabel('授权规则结果').waitFor();}
 else{
  await panel.getByText(/场景“观察者读取本站点”：判定为允许；仍不授权执行/).waitFor();assert.equal(posts,1);
  assert.equal(await panel.getByLabel('授权规则结果').locator('tbody tr').count(),5);
  assert.ok((await panel.innerText()).includes('授权执行：否'));
  await panel.getByLabel('合成授权场景').selectOption('site-outside-scope');
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(/场景“站点超出授权范围”被拒绝：站点超出授权范围/).waitFor();
  assert.ok((await panel.getByLabel('授权规则结果').innerText()).includes('未通过'));
  await panel.getByLabel('合成授权场景').selectOption('approver-self-approval');
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(/禁止自批/).waitFor();
  for(const bad of [
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,executionEnabled:true}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,productionEnabled:true}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,allowed:false}:item),
   listBody.map(item=>item.id==='viewer-edit-denied'?{...item,code:'allowed'}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,code:'unknown_code'}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,action:'Delete'}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,role:''}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,rules:[]}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,rules:[{name:'unknownRule',passed:true}]}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,description:''}:item),
   listBody.map(item=>item.id==='viewer-read-in-scope'?{...item,rules:[{name:'identityPresent',passed:false}]}:item),
   [],
  ]){
   list=bad;await panel.getByRole('button',{name:'载入授权场景'}).click();await panel.getByText(LOAD_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  list=listBody;await panel.getByRole('button',{name:'载入授权场景'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  // The status line must report the actual count, not a hardcoded one.
  list=listBody.slice(0,13);await panel.getByRole('button',{name:'载入授权场景'}).click();await panel.getByText('已载入 13 个授权场景；角色、站点与批准独立性均由后端规则实际求值，任何结果都不授权执行。',{exact:true}).waitFor();
  list=listBody;await panel.getByRole('button',{name:'载入授权场景'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  checkBody={...listBody[0],allowed:true,code:'allowed'};
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(/判定为允许/).waitFor();
  checkBody={...listBody[0],executionEnabled:true};
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  checkBody={...listBody[0],id:'unknown'};
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();
  checkBody={...listBody[0],code:'role_denied'};
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();
  checkBody=null;
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/authorization-preflight',hold);
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText('正在提交授权场景…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消授权预检等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/authorization-preflight',hold);
  await panel.getByRole('button',{name:'运行授权规则'}).click();await panel.getByText(/判定为允许/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'authorization panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS role and site authorization preflight ${live?'actual local HTTP':'injected'}: role/site rules, independent approval, rejections and cancel.`);
}finally{await browser.close();}
