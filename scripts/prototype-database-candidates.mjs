import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const providers=[
 {id:'PostgreSQL',name:'PostgreSQL',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:true,outboundEnabled:false,notes:'平台数据库候选，非监控目标连接器；依赖包已声明但无业务适配。生产拒绝启用；必测：migrations, jsonb, skip-locked-leases, backup-restore。'},
 {id:'SqlServer',name:'SQL Server',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:false,outboundEnabled:false,notes:'平台数据库候选，非监控目标连接器；适配包尚未安装。生产拒绝启用；必测：provider-package, migrations, locking-hints, backup-restore。'},
 {id:'Sqlite',name:'SQLite',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:false,outboundEnabled:false,notes:'平台数据库候选，非监控目标连接器；适配包尚未安装。生产拒绝启用；必测：provider-package, migrations, single-writer, file-backup。'},
 {id:'MySql',name:'MySQL',status:'planned',planned:true,implemented:false,verified:false,packageAvailable:false,outboundEnabled:false,notes:'平台数据库候选，非监控目标连接器；适配包尚未安装。生产拒绝启用；必测：provider-package, migrations, collation, locking-leases, backup-restore。'},
];
const LOAD_OK='已载入 4 个平台持久化候选；均未实现、未验证、未开放外连。';
const LOAD_FAIL='候选能力目录载入失败或响应不符；不显示诊断正文，不回退为本地说明。';
let body=providers,gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/database-providers'))gets++;});
 else await page.route('**/api/v1/database-providers',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
 await page.goto(base+'/database');
 const panel=page.getByRole('region',{name:'后端平台数据库候选能力'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
 assert.equal(await panel.locator('tbody tr').count(),4);
 assert.equal(await panel.getByRole('cell',{name:'PostgreSQL',exact:true}).count(),1);
 assert.equal(await panel.getByText('已声明（无业务适配）',{exact:true}).count(),1);
 assert.equal(await panel.getByRole('cell',{name:'否',exact:true}).count(),8);
 // The exported annotation sheet must keep every candidate marked as not implemented.
 const downloadWait=page.waitForEvent('download');await panel.getByRole('button',{name:'导出平台持久化候选明细 CSV（含批注列）'}).click();
 const file=await downloadWait;assert.equal(file.suggestedFilename(),'平台持久化-candidates-template.csv');
 const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
 const csv=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'').trim().split('\n');
 assert.equal(csv[0],'id,name,packageAvailable,planned,implemented,verified,outboundEnabled,notes,首批纳入,部门意见');
 assert.equal(csv.length,5);assert.ok(csv.slice(1).every(line=>line.includes(',否,否,否,')),csv.join('\n'));
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'database candidate page overflows');await page.setViewportSize({width:1280,height:720});
 if(!live){
  body=providers.slice(0,3);await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText('已载入 3 个平台持久化候选；均未实现、未验证、未开放外连。',{exact:true}).waitFor();assert.equal(await panel.locator('tbody tr').count(),3);
  body=providers;
  for(const bad of [
   providers.map((item,index)=>index===0?{...item,implemented:true}:item),
   providers.map((item,index)=>index===0?{...item,verified:true}:item),
   providers.map((item,index)=>index===0?{...item,outboundEnabled:true}:item),
   providers.map((item,index)=>index===0?{...item,planned:false}:item),
   providers.map((item,index)=>index===0?{...item,notes:''}:item),
   [providers[0],providers[0],providers[1],providers[2]],
   [...providers,providers[0],providers[1],providers[2],providers[3],providers[0]],
  ]){
   body=bad;await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  }
  body=providers;await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/database-providers',hold);
  await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText('正在载入候选能力…',{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  await panel.getByRole('button',{name:'取消候选载入等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();assert.ok(await panel.getByRole('button',{name:'载入候选能力'}).isEnabled());
  release();await page.unroute('**/api/v1/database-providers',hold);await panel.getByRole('button',{name:'载入候选能力'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
 }
 console.log(`PASS platform database candidates ${live?'actual local HTTP':'injected'}: explicit load, four candidates, narrow layout, invalid claims and cancel.`);
}finally{await browser.close();}
