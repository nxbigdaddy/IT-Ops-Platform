import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const rules=(passed=['approvalPresent','changeWellFormed','notRevoked','notConsumed','timeWindowValid','independentApprover','bindingMatches'])=>
 ['approvalPresent','changeWellFormed','notRevoked','notConsumed','timeWindowValid','independentApprover','bindingMatches'].map(name=>({name,passed:passed.includes(name)}));
const scenario=(id,label,code,ok)=>({id,label,description:`${label}的合成说明`,valid:ok,code,rules:ok?rules():rules(['approvalPresent','changeWellFormed','notRevoked','notConsumed','timeWindowValid','bindingMatches']),executionEnabled:false,productionEnabled:false});
const listBody=[scenario('valid','有效审批快照','valid_snapshot_only',true),scenario('missing','缺少审批','approval_required',false),scenario('self-approval','申请人自批','independent_approval_required',false),scenario('revoked','审批已撤销','approval_revoked',false),scenario('consumed','审批已使用','approval_consumed',false),scenario('digest-mismatch','动作摘要不符','approval_binding_mismatch',false),scenario('version-mismatch','资源版本不符','approval_binding_mismatch',false),scenario('expired','审批已过期','approval_time_invalid',false),scenario('not-yet-valid','审批时间在未来','approval_time_invalid',false),scenario('malformed-change','变更本身不合法','invalid_change',false)];
const LOAD_OK='已载入 10 个审批场景；全部由后端规则实际求值，且任何场景都不授权执行。';
const LOAD_FAIL='审批场景载入失败或响应不符；不显示诊断正文，不回退为本地判定。';
const CHECK_FAIL='审批预检失败或响应不符；不显示诊断正文，不推断为通过。';
let list=listBody,checkBody=null,gets=0,posts=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/approval-scenarios'))gets++;if(request.url().endsWith('/approval-preflight'))posts++;});
 else{
  await page.route('**/api/v1/approval-scenarios',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:list})})});
  await page.route('**/api/v1/approval-preflight',route=>{posts++;const id=route.request().postDataJSON().scenario;const found=checkBody??listBody.find(item=>item.id===id);const status=found&&found.id===id?200:400;return route.fulfill({status,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:found??null})})});
 }
 await page.goto(base+'/integration');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'审批绑定预检'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);assert.equal(posts,0);
 assert.ok(await panel.getByRole('button',{name:'运行审批规则'}).count()===0);
 await panel.getByRole('button',{name:'载入审批场景'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
 await panel.getByRole('button',{name:'运行审批规则'}).click();
 if(live){await panel.getByLabel('审批规则结果').waitFor();}
 else{
  await panel.getByText(/场景“有效审批快照”：全部规则通过；仍不授权执行/).waitFor();assert.equal(posts,1);
  assert.equal(await panel.getByLabel('审批规则结果').locator('tbody tr').count(),7);
  assert.ok((await panel.getByLabel('审批规则结果').innerText()).includes('审批人与申请人不同'));
  assert.ok((await panel.innerText()).includes('授权执行：否'));
  await panel.getByLabel('合成审批场景').selectOption('self-approval');
  await panel.getByRole('button',{name:'运行审批规则'}).click();await panel.getByText(/场景“申请人自批”被拒绝：必须由他人审批（禁止自批）/).waitFor();
  assert.ok((await panel.getByLabel('审批规则结果').innerText()).includes('未通过'));
  for(const bad of [
   listBody.map(item=>item.id==='valid'?{...item,executionEnabled:true}:item),
   listBody.map(item=>item.id==='valid'?{...item,productionEnabled:true}:item),
   listBody.map(item=>item.id==='valid'?{...item,valid:false}:item),
   listBody.map(item=>item.id==='self-approval'?{...item,code:'valid_snapshot_only'}:item),
   listBody.map(item=>item.id==='valid'?{...item,code:'unknown_code'}:item),
   listBody.map(item=>item.id==='valid'?{...item,rules:[]}:item),
   listBody.map(item=>item.id==='valid'?{...item,rules:rules(['approvalPresent'])}:item),
   listBody.map(item=>item.id==='valid'?{...item,rules:[{name:'unknownRule',passed:true}]}:item),
   listBody.map(item=>item.id==='valid'?{...item,description:''}:item),
   [],
  ]){
   list=bad;await panel.getByRole('button',{name:'载入审批场景'}).click();await panel.getByText(LOAD_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  list=listBody;await panel.getByRole('button',{name:'载入审批场景'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  checkBody={...listBody[0],id:'valid',label:'有效审批快照'};
  await panel.getByRole('button',{name:'运行审批规则'}).click();await panel.getByText(/全部规则通过/).waitFor();
  checkBody={...listBody[0],executionEnabled:true};
  await panel.getByRole('button',{name:'运行审批规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  checkBody={...listBody[2],id:'unknown'};
  await panel.getByRole('button',{name:'运行审批规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();
  checkBody=null;
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/approval-preflight',hold);
  await panel.getByRole('button',{name:'运行审批规则'}).click();await panel.getByText('正在提交审批场景…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消审批预检等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/approval-preflight',hold);
  await panel.getByRole('button',{name:'运行审批规则'}).click();await panel.getByText(/全部规则通过/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'approval panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS approval binding preflight ${live?'actual local HTTP':'injected'}: server-evaluated scenarios, rule table, rejection codes and cancel.`);
}finally{await browser.close();}
