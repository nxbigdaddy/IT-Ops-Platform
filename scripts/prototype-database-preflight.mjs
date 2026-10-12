import{createRequire}from'node:module';import assert from'node:assert/strict';const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{const page=await browser.newPage();let calls=0,loads=0;const live=process.argv.includes('--live');if(live)page.on('request',request=>{if(request.url().endsWith('/api/v1/database-preflight'))calls++;if(request.url().endsWith('/api/v1/database-provider-values'))loads++;});
const valueBody=[{value:0,name:'PostgreSQL',displayName:'PostgreSQL'},{value:1,name:'SqlServer',displayName:'SQL Server'},{value:2,name:'Sqlite',displayName:'SQLite'},{value:3,name:'MySql',displayName:'MySQL'}];let values=valueBody;
if(!live)await page.route('**/api/v1/database-provider-values',route=>{loads++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:values})})});
if(!live)await page.route('**/api/v1/database-preflight',async route=>{calls++;const draft=route.request().postDataJSON();assert.equal(draft.secretReference,'secret://database/demo');assert.equal(draft.automaticFallback,false);assert.equal(typeof draft.host,'string');const hostOk=/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.|^2001:db8:|\.(?:invalid|example)$/.test(draft.host)&&draft.host===draft.host.trim()&&draft.host===draft.host.toLowerCase();const valid=hostOk&&(draft.provider!==2||draft.apiInstances===1);const name=valueBody.find(item=>item.value===draft.provider).displayName;await route.fulfill({status:valid?200:400,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:valid,connectionAttempted:false,productionReady:false,errors:valid?[]:[hostOk?{field:'topology',code:'sqlite_single_instance_only'}:{field:'host',code:'not_documentation_target'}],candidate:{name,packageAvailable:draft.provider===0,singleInstanceOnly:draft.provider===2,adapterImplemented:false,liveVerified:false,productionEnabled:false,requiredVerification:['provider-package','migrations','backup-restore']}}})});});
await page.goto('http://127.0.0.1:5173/integration');assert.equal(calls,0);assert.equal(loads,0);
assert.ok(await page.getByLabel('数据库候选',{exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'检查数据库部署规则'}).isDisabled());
await page.getByRole('button',{name:'载入候选取值'}).click();await page.getByText('已载入 4 个平台持久化候选取值；取值由服务端下发，未连接数据库。',{exact:true}).waitFor();assert.equal(loads,1);assert.equal(calls,0);
assert.equal(await page.getByLabel('数据库候选',{exact:true}).inputValue(),'0');
await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText('配置规则通过；未连接数据库，未保存，非生产就绪',{exact:true}).waitFor();await page.getByText(/的前置条件（尚未完成，仅为待验证清单）/).first().waitFor();assert.ok(await page.getByText('migrations',{exact:true}).count()>=1);assert.ok(await page.getByText(/依赖包：已声明，无业务适配/).count()>=1);
await page.getByLabel('数据库候选',{exact:true}).selectOption('2');await page.getByLabel('API实例数',{exact:true}).fill('2');await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText(/配置规则未通过：部署拓扑：SQLite/).waitFor();assert.ok(await page.getByText(/的前置条件（尚未完成，仅为待验证清单）/).count()>=1);
assert.ok(await page.getByText('单实例限制：是').count()>=1);assert.equal(calls,2);
if(!live){
 await page.getByLabel('数据库主机',{exact:true}).fill('db-01.internal');
 await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText(/配置规则未通过：主机：主机必须是文档保留地址或 .invalid\/.example 主机名/).waitFor();
 assert.equal(await page.getByText('配置规则通过；未连接数据库，未保存，非生产就绪',{exact:true}).count(),0);
 await page.getByLabel('数据库主机',{exact:true}).fill('db-01.invalid');
 await page.getByLabel('数据库候选',{exact:true}).selectOption('0');await page.getByLabel('API实例数',{exact:true}).fill('1');
 await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText('配置规则通过；未连接数据库，未保存，非生产就绪',{exact:true}).waitFor();
 for(const bad of [[{...valueBody[0],value:0},{...valueBody[1],value:0}],valueBody.map((item,index)=>index===0?{...item,name:'PostgreSQL-1'}:item),valueBody.map((item,index)=>index===0?{...item,displayName:''}:item),[]]){
  values=bad;await page.getByRole('button',{name:'载入候选取值'}).click();await page.getByText('候选取值载入失败或响应不符；不显示诊断正文，不回退为本地候选清单。',{exact:true}).waitFor();
  assert.ok(await page.getByLabel('数据库候选',{exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'检查数据库部署规则'}).isDisabled());
 }
 values=valueBody;await page.getByRole('button',{name:'载入候选取值'}).click();await page.getByText('已载入 4 个平台持久化候选取值；取值由服务端下发，未连接数据库。',{exact:true}).waitFor();
}
if(live){
 await page.route('**/api/v1/database-preflight',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:false,connectionAttempted:false,productionReady:false,errors:[{field:'unrecognizedField',code:'out_of_range'}]}})}));
 await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText('预检不可用或响应不符；未显示诊断正文，不回退为成功。',{exact:true}).waitFor();assert.ok(!(await page.content()).includes('unrecognizedField'));await page.unroute('**/api/v1/database-preflight');
 await page.getByLabel('API实例数',{exact:true}).fill('1');
 for(const flag of ['connectionAttempted','productionReady']){
  await page.route('**/api/v1/database-preflight',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:true,connectionAttempted:false,productionReady:false,errors:[],[flag]:true}})}));
  await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText('预检不可用或响应不符；未显示诊断正文，不回退为成功。',{exact:true}).waitFor();
  assert.equal(await page.getByText('配置规则通过；未连接数据库，未保存，非生产就绪',{exact:true}).count(),0);
  await page.unroute('**/api/v1/database-preflight');
 }
 await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText('配置规则通过；未连接数据库，未保存，非生产就绪',{exact:true}).waitFor();
 let release,arrived;const held=new Promise(resolve=>{release=resolve}),arrival=new Promise(resolve=>{arrived=resolve});
 await page.route('**/api/v1/database-preflight',async route=>{arrived();await held;await route.abort().catch(()=>{});});
 await page.getByRole('button',{name:'检查数据库部署规则'}).click();await arrival;assert.ok(await page.getByLabel('数据库候选',{exact:true}).isDisabled());
 await page.getByRole('button',{name:'取消数据库预检等待',exact:true}).click();await page.getByText(/数据库预检等待已取消或超时/).waitFor();assert.ok(await page.getByLabel('数据库候选',{exact:true}).isEnabled());release();await page.unrouteAll({behavior:'wait'});
 await page.getByRole('button',{name:'检查数据库部署规则'}).click();await page.getByText('配置规则通过；未连接数据库，未保存，非生产就绪',{exact:true}).waitFor();
 console.log('PASS cancellation restores inputs and actual recheck; false connection/production claims rejected.');
}
console.log(`PASS ${live?'actual local HTTP':'injected'} database preflight valid and SQLite topology rejection; explicit request only.`);}finally{await browser.close();}
