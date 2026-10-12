import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const note='存活与演示可用都不等于生产就绪；就绪状态永远为否，因为鉴权、迁移历史、保留策略与生产运维证据都未提供。';
const checks=(persistence)=>({name:'persistence',status:persistence,verified:persistence==='demoDatabaseReachable',detail:persistence==='notConfigured'?'演示存储为进程内存；重启即清空。':'本机演示数据库可连接（provider=sqlite）；表结构由 EnsureCreated 建立，无迁移历史。'});
const report=()=>({status:'notReady',ready:false,note,blockers:['未配置任何持久化存储（Demo:SqlitePath 为空）。','未实现身份认证与授权执行点。','没有版本化迁移与回滚方案。'],checks:[checks('notConfigured'),{name:'authentication',status:'notImplemented',verified:false,detail:'没有身份认证；角色切换只是展示模拟。'},{name:'migrations',status:'none',verified:false,detail:'数据库结构由 EnsureCreated 直接建立，没有版本化迁移。'},{name:'externalNetwork',status:'disabled',verified:false,detail:'Demo 不发起外部网络请求；AI 传输只允许本机回环。'},{name:'demoApi',status:'available',verified:true,detail:'本机 Demo API 可用。'}]});
const FAIL='就绪自检读取失败或响应不符；不显示诊断正文，不回退本地判断。';
let body=report(),gets=0,status503=true;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/health/ready'))gets++;});
 else await page.route('**/health/ready',route=>{gets++;return route.fulfill({status:status503?503:200,contentType:'application/json',body:JSON.stringify(body)})});
 await page.goto(base+'/database');
 const panel=page.getByRole('region',{name:'生产就绪自检（只读）'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 assert.ok((await panel.innerText()).includes('始终为 503'));
 await panel.getByRole('button',{name:'读取就绪自检'}).click();
 await panel.getByText(/就绪结论：不可用（503）/).waitFor();
 if(!live){
  assert.equal(gets,1);
  const table=panel.getByLabel('就绪检查项');assert.equal(await table.locator('tbody tr').count(),5);
  const text=await panel.locator('.panel-note').innerText();
  assert.ok(text.includes('阻断项')&&text.includes('未实现身份认证'),text);
  assert.ok((await table.innerText()).includes('演示API'),await table.innerText());
  // A 200 answer would mean a readiness claim: the panel must refuse it outright.
  status503=false;await panel.getByRole('button',{name:'读取就绪自检'}).click();
  await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  status503=true;
  for(const invalid of [
   {...report(),ready:true},
   {...report(),status:'ready'},
   {...report(),note:' '},
   {...report(),blockers:[]},
   {...report(),checks:report().checks.slice(0,4)},
   {...report(),checks:report().checks.map(item=>item.name==='authentication'?{...item,verified:true}:item)},
   {...report(),checks:report().checks.map(item=>item.name==='migrations'?{...item,verified:true}:item)},
   {...report(),checks:report().checks.map(item=>item.name==='persistence'?{...item,name:'unknown',verified:false}:item)},
   {...report(),checks:report().checks.map(item=>item.name==='persistence'?{...item,detail:'Data Source=C:\\demo\\demo.db'}:item)},
   {...report(),blockers:['Host=192.0.2.10;Password=demo']},
  ]){
   body=invalid;await panel.getByRole('button',{name:'读取就绪自检'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();
   assert.equal(await panel.locator('tbody').count(),0);
  }
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/health/ready',hold);
  await panel.getByRole('button',{name:'读取就绪自检'}).click();await panel.getByText('正在读取就绪自检…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消就绪自检等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/health/ready',hold);
  body=report();await panel.getByRole('button',{name:'读取就绪自检'}).click();await panel.getByText(/就绪结论：不可用/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'readiness panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS readiness self-check ${live?'actual local HTTP':'injected'}: components, blockers, no path leak and cancel.`);
}finally{await browser.close();}
