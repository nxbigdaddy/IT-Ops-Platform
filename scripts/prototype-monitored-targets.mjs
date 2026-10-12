import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const candidate={id:'demo-db-monitor',name:'数据库只读监控',category:'DatabaseTarget',protocols:['Restricted SQL','HTTPS exporter'],targetFamilies:['PostgreSQL','SQL Server','MySQL'],candidateVendors:['Engine-specific'],plannedReadCapabilities:['availability','replication','backup-summary'],requiredBeforeOnboarding:['只读数据库账号与查询白名单','引擎版本与复制拓扑'],status:'planned',implemented:false,liveVerified:false,writeEnabled:false,evidence:'synthetic fixture'};
const LOADED='已载入被监控数据库目标候选；仍为规划，未连接、未采集、未验证。';
const FAIL='被监控目标候选载入失败或响应不符；不显示诊断正文，不回退为本地说明。';
let body=candidate,gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/connector-capabilities/demo-db-monitor'))gets++;});
 else await page.route('**/api/v1/connector-capabilities/demo-db-monitor',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
 await page.goto(base+'/database');
 const panel=page.getByRole('region',{name:'被监控数据库目标'});await panel.waitFor();
 assert.equal(await panel.locator('dl').count(),0);assert.equal(gets,0);
 await panel.getByRole('button',{name:'载入被监控目标候选'}).click();await panel.getByText(LOADED,{exact:true}).waitFor();assert.equal(gets,1);
 const text=await panel.innerText();
 for(const expected of ['PostgreSQL、SQL Server、MySQL','Restricted SQL、HTTPS exporter','availability、replication、backup-summary','规划 · 未实现 · 未验证 · 未开放写入'])assert.ok(text.includes(expected),expected);
 assert.equal(await page.getByText(/平台自身持久化<|平台自身持久化/).count()>0,true);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'monitored target page overflows');await page.setViewportSize({width:1280,height:720});
 if(!live){
  for(const bad of [{...candidate,id:'demo-other'},{...candidate,implemented:true},{...candidate,liveVerified:true},{...candidate,writeEnabled:true},{...candidate,status:'ready'},{...candidate,plannedReadCapabilities:[]},[candidate],null]){
   body=bad;await panel.getByRole('button',{name:'载入被监控目标候选'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('dl').count(),0);
  }
  body=candidate;await panel.getByRole('button',{name:'载入被监控目标候选'}).click();await panel.getByText(LOADED,{exact:true}).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/connector-capabilities/demo-db-monitor',hold);
  await panel.getByRole('button',{name:'载入被监控目标候选'}).click();await panel.getByText('正在载入被监控目标候选…',{exact:true}).waitFor();assert.equal(await panel.locator('dl').count(),0);
  await panel.getByRole('button',{name:'取消目标载入等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/connector-capabilities/demo-db-monitor',hold);await panel.getByRole('button',{name:'载入被监控目标候选'}).click();await panel.getByText(LOADED,{exact:true}).waitFor();
 }
 console.log(`PASS monitored database target ${live?'actual local HTTP':'injected'}: explicit load, engine list, false-claim rejection and cancel.`);
}finally{await browser.close();}
