import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const catalog=[
 {id:'demo-snmp',name:'SNMPv3',category:'Network',protocols:['SNMPv3'],targetFamilies:['Switch'],candidateVendors:['Huawei'],plannedReadCapabilities:['interfaces','health']},
 {id:'demo-linux',name:'Linux只读采集',category:'Server',protocols:['SSH allowlist','HTTPS agent'],targetFamilies:['Ubuntu'],candidateVendors:['Distribution-specific'],plannedReadCapabilities:['disk','services']},
 {id:'demo-db-monitor',name:'数据库只读监控',category:'DatabaseTarget',protocols:['Restricted SQL'],targetFamilies:['PostgreSQL'],candidateVendors:['Engine-specific'],plannedReadCapabilities:['availability']},
 {id:'demo-directory',name:'Active Directory',category:'Directory',protocols:['LDAPS'],targetFamilies:['Windows Server AD'],candidateVendors:['Microsoft'],plannedReadCapabilities:['users']},
 {id:'demo-endpoint',name:'终端安全平台',category:'Endpoint',protocols:['HTTPS API'],targetFamilies:['Windows'],candidateVendors:['Vendor-specific'],plannedReadCapabilities:['coverage']},
 {id:'demo-virtualization',name:'虚拟化平台',category:'Virtualization',protocols:['HTTPS API'],targetFamilies:['vSphere'],candidateVendors:['VMware'],plannedReadCapabilities:['hosts']},
 {id:'demo-backup',name:'备份平台',category:'Backup',protocols:['HTTPS API'],targetFamilies:['Backup server'],candidateVendors:['Vendor-specific'],plannedReadCapabilities:['job-result']},
 {id:'demo-windows',name:'Windows只读采集',category:'Server',protocols:['WinRM HTTPS'],targetFamilies:['Windows Server'],candidateVendors:['Microsoft'],plannedReadCapabilities:['services']},
 {id:'demo-printer',name:'打印服务',category:'Printing',protocols:['SNMPv3'],targetFamilies:['Network printer'],candidateVendors:['HP'],plannedReadCapabilities:['supplies']},
 {id:'demo-firewall-api',name:'防火墙厂商API',category:'Network',protocols:['HTTPS API'],targetFamilies:['Firewall'],candidateVendors:['Fortinet'],plannedReadCapabilities:['policy-summary']},
].map(item=>({...item,status:'planned',implemented:false,liveVerified:false,writeEnabled:false,evidence:'synthetic fixture',requiredBeforeOnboarding:['只读账号与最小权限','版本与固件确认']}));
const LOAD_OK='已载入 10 个候选；均为规划且未实现、未验证、未开放写入。';
const LOAD_FAIL='候选目录载入失败或响应不符；不显示诊断正文，不回退为本地候选目录。';
const CHECK_OK='目录规则通过；未连接、未执行、兼容性未验证。';
const CHECK_FAIL='连接器目录规则预检不可用或响应不符；不显示诊断正文，不回退为成功。';
const SELF_FAIL='目录自检不可用或响应不符；不显示诊断正文，不回退为通过。';
let catalogBody=catalog,posts=0,gets=0,planPosts=0,candidateOverride=null,badReference=false;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/connector-preflight'))posts++;if(request.url().endsWith('/connector-capabilities'))gets++;});
 else{
  await page.route('**/api/v1/connector-capabilities',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:catalogBody})})});
  await page.route('**/api/v1/connector-preflight',route=>{posts++;const draft=route.request().postDataJSON();assert.equal(draft.secretReference,'secret://connector/demo');const target=catalog.find(item=>item.id===draft.connectorId);const valid=!!target&&target.protocols.includes(draft.protocol)&&draft.capabilities.length>0&&draft.capabilities.every(value=>target.plannedReadCapabilities.includes(value));
   const candidate=target?{...target,status:'planned',implemented:false,liveVerified:false,writeEnabled:false,...(candidateOverride??{})}:null;
   const referenceOk=!badReference;
   const validAll=valid&&referenceOk;
   return route.fulfill({status:validAll?200:400,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:validAll,connectionAttempted:false,executionAllowed:false,compatibilityVerified:false,errors:validAll?[]:referenceOk?[{field:'protocol',code:'not_registered'}]:[{field:'secretReference',code:'reference_required'}],candidate}})});});
  await page.route('**/api/v1/connector-plan-preflight',route=>{planPosts++;const {items}=route.request().postDataJSON();assert.ok(items.every(item=>item.secretReference===`secret://connector/${item.connectorId}`));const results=(items??[]).map((item,index)=>{const target=catalog.find(entry=>entry.id===item.connectorId);const errors=[];
   if(!target)errors.push({field:'connectorId',code:'unknown_candidate'});
   else if(!target.protocols.includes(item.protocol))errors.push({field:'protocol',code:'not_registered'});
   else if(!item.capabilities.length||item.capabilities.length>16)errors.push({field:'capabilities',code:'count_out_of_range'});
   else if(item.capabilities.some(value=>!target.plannedReadCapabilities.includes(value)))errors.push({field:'capabilities',code:'not_registered'});
   return {index,configurationValid:errors.length===0,errors};});
   const valid=results.length>0&&results.every(item=>item.configurationValid);
   return route.fulfill({status:valid?200:400,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:valid,validItems:results.filter(item=>item.configurationValid).length,invalidItems:results.filter(item=>!item.configurationValid).length,errors:[],items:results,connectionAttempted:false,executionAllowed:false,compatibilityVerified:false}})});});
 }
 await page.goto(base+'/integration');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'连接器只读意图预检'});await panel.waitFor();
 const candidateSelect=panel.getByLabel('演示候选连接器');
 assert.equal(await candidateSelect.count(),0);assert.equal(gets,0);assert.equal(posts,0);
 await panel.getByRole('button',{name:'载入候选目录'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
 assert.equal(await candidateSelect.locator('option').count(),11);
 await candidateSelect.selectOption('demo-linux');
 assert.equal(await panel.getByLabel('演示协议').inputValue(),'SSH allowlist');
 assert.ok(await panel.getByRole('checkbox',{name:'disk'}).isChecked());
 await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(CHECK_OK,{exact:true}).waitFor();assert.equal(posts,1);
 await panel.getByText(/已登记声明（规划，未实现\/未验证）/).first().waitFor();
 assert.ok((await panel.innerText()).includes('协议：SSH allowlist'),'registered protocols not shown');
 assert.ok((await panel.innerText()).includes('规划只读能力：disk、services'),'registered capabilities not shown');
 assert.ok((await panel.innerText()).includes('接入前需确认：'),'onboarding checklist not shown');
 if(!live)assert.ok((await panel.innerText()).includes('接入前需确认：只读账号与最小权限；版本与固件确认'),'onboarding checklist content');
 await panel.getByLabel('演示协议').selectOption('SNMPv3');assert.equal(await panel.getByText('尚未检查',{exact:true}).count(),1);
 await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(/目录规则未通过：协议：不属于该候选规划/).waitFor();assert.equal(posts,2);
 const selfCheck=panel.getByRole('button',{name:'自检目录内部一致性'});
 await selfCheck.click();await panel.getByText('目录自检通过：10/10 项声明内部一致；未连接、未执行。',{exact:true}).waitFor();if(!live)assert.equal(planPosts,1);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'connector panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 if(!live){
  // A cancel button must be usable while the request is still in flight.
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/connector-capabilities',hold);
  await panel.getByRole('button',{name:'载入候选目录'}).click();await panel.getByText('正在载入候选目录…',{exact:true}).waitFor();
  const cancel=panel.getByRole('button',{name:'取消连接器预检等待'});
  assert.equal(await cancel.isEnabled(),true,'cancel must be enabled while a request is pending');
  await cancel.click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/connector-capabilities',hold);
  await panel.getByRole('button',{name:'载入候选目录'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  assert.equal(await cancel.isDisabled(),true,'cancel must be disabled while idle');
  // Reloading the catalog clears the selection, so restore it before the single-candidate checks.
  await candidateSelect.selectOption('demo-linux');
  await panel.getByLabel('演示协议').selectOption('SSH allowlist');
  if(!(await panel.getByRole('checkbox',{name:'disk'}).isChecked()))await panel.getByRole('checkbox',{name:'disk'}).check();
  for(const bad of [{id:'demo-other'},{implemented:true},{liveVerified:true},{writeEnabled:true},{status:'ready'},{protocols:['SSH allowlist','SSH allowlist']},{requiredBeforeOnboarding:[]},{requiredBeforeOnboarding:['只读账号','只读账号']}]){
   candidateOverride=bad;await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();assert.equal(await panel.getByText(/已登记声明（规划，未实现\/未验证）/).count(),0);
  }
  candidateOverride=null;await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(CHECK_OK,{exact:true}).waitFor();
  // A bad credential reference must be reported with its own code, not silently accepted.
  badReference=true;await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(/目录规则未通过：凭据引用：/).waitFor();badReference=false;await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(CHECK_OK,{exact:true}).waitFor();
  for(const bad of [[],[...catalog,catalog[0]],Array.from({length:33},(_,index)=>({...catalog[index%10],id:`demo-extra-${index}`})),catalog.map((item,index)=>index===0?{...item,implemented:true}:item),catalog.map((item,index)=>index===0?{...item,status:'ready'}:item)]){
   catalogBody=bad;await panel.getByRole('button',{name:'载入候选目录'}).click();await panel.getByText(LOAD_FAIL,{exact:true}).waitFor();assert.equal(await candidateSelect.count(),0);
  }
  catalogBody=catalog.map((item,index)=>index===1?{...item,plannedReadCapabilities:['disk','synthetic-unregistered']}:item);
  await panel.getByRole('button',{name:'载入候选目录'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  await selfCheck.click();await panel.getByText(/目录自检未通过：第2项 采集能力：不属于该候选规划/).waitFor();
  catalogBody=catalog;await panel.getByRole('button',{name:'载入候选目录'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();await candidateSelect.selectOption('demo-linux');
 }
 const planned=page.getByRole('button',{name:'自检目录内部一致性'});
 for(const flag of ['connectionAttempted','executionAllowed','compatibilityVerified']){
  const single=route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:true,connectionAttempted:false,executionAllowed:false,compatibilityVerified:false,errors:[],[flag]:true}})});
  await page.route('**/api/v1/connector-preflight',single);
  await panel.getByRole('button',{name:'检查连接器目录规则'}).click();await panel.getByText(CHECK_FAIL,{exact:true}).waitFor();
  await page.unroute('**/api/v1/connector-preflight',single);
  const plan=route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:true,validItems:10,invalidItems:0,errors:[],items:catalog.map((_,index)=>({index,configurationValid:true,errors:[]})),connectionAttempted:false,executionAllowed:false,compatibilityVerified:false,[flag]:true}})});
  await page.route('**/api/v1/connector-plan-preflight',plan);
  await selfCheck.click();await panel.getByText(SELF_FAIL,{exact:true}).waitFor();
  await page.unroute('**/api/v1/connector-plan-preflight',plan);
  await selfCheck.click();await panel.getByText('目录自检通过：10/10 项声明内部一致；未连接、未执行。',{exact:true}).waitFor();
 }
 assert.ok(await planned.isEnabled());
 const planList=panel.getByLabel('拟接入候选清单');
 await panel.getByLabel('演示协议').selectOption('SSH allowlist');assert.ok(await panel.getByRole('checkbox',{name:'disk'}).isChecked());
 await panel.getByRole('button',{name:'加入清单'}).click();await panel.getByText('已加入清单；尚未检查',{exact:true}).waitFor();assert.equal(await planList.locator('li').count(),1);
 await panel.getByLabel('演示协议').selectOption('SNMPv3');await panel.getByRole('button',{name:'加入清单'}).click();assert.equal(await planList.locator('li').count(),2);
 await panel.getByRole('button',{name:'检查清单'}).click();await panel.getByText('清单未通过：1/2 项符合目录规则；未连接、未执行。',{exact:true}).waitFor();
 const failureList=panel.getByLabel('清单未通过项');assert.equal(await failureList.locator('li').count(),1);
 assert.ok((await failureList.innerText()).includes('第2项 协议：不属于该候选规划'),await failureList.innerText());
 await panel.getByRole('button',{name:'清空清单'}).click();await panel.getByText('清单已清空',{exact:true}).waitFor();assert.equal(await planList.count(),0);
 if(!live){
  await panel.getByLabel('演示协议').selectOption('SSH allowlist');
  await panel.getByRole('button',{name:'加入清单'}).click();assert.equal(await planList.locator('li').count(),1);
  const badPlan=route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:true,validItems:1,invalidItems:0,errors:[],items:[{index:0,configurationValid:true,errors:[]}],connectionAttempted:false,executionAllowed:true,compatibilityVerified:false}})});
  await page.route('**/api/v1/connector-plan-preflight',badPlan);
  await panel.getByRole('button',{name:'检查清单'}).click();await panel.getByText('清单检查不可用或响应不符；不显示诊断正文，不回退为通过。',{exact:true}).waitFor();
  await page.unroute('**/api/v1/connector-plan-preflight',badPlan);
  await panel.getByRole('button',{name:'检查清单'}).click();await panel.getByText('清单通过：1/1 项符合目录规则；未连接设备、未执行、兼容性未验证。',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'清空清单'}).click();
 }
 console.log(`PASS connector intent preflight ${live?'actual local HTTP':'injected'}: catalog load, membership check, mismatch rejection, narrow layout${live?'':' , invalid catalogs'} and false execution claims.`);
}finally{await browser.close();}
