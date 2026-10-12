import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const notes='端口可替换只表示实现可被替换；文件实现仅用于本机开发，未做事务、并发写者或多实例协调，不能作为生产持久化。';
const port=(id,purpose,implementation,configuredByFile)=>({port:id,purpose,implementation,configuredByFile,durable:false,productionReady:false,limits:implementation==='sqlite'?['SQLite文件（本地开发）','真实事务与唯一约束']:implementation==='postgres'?['PostgreSQL（未接服务器）','真实事务与唯一约束']:['单进程','无事务']});
const ports=(feedback,ledger,task,prompt='memory')=>({ports:[port('IDemoFeedbackStore','反馈记录',feedback,feedback==='development-file'),port('IOperationLedger','幂等台账',ledger,ledger==='development-file'),port('IDemoTaskStore','任务快照与流水',task,task==='development-file'),port('IPromptCatalog','功能提示词目录',prompt,prompt==='development-file')],anyDurable:false,productionReady:false,notes});
const FAIL='存储模式读取失败或响应不符；不显示诊断正文，不回退本地判断。';
let body=ports('memory','memory','memory'),gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/storage-modes'))gets++;});
 else await page.route('**/api/v1/storage-modes',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
 await page.goto(base+'/database');
 const panel=page.getByRole('region',{name:'存储模式（只读）'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 assert.ok((await panel.innerText()).includes('不含任何文件路径'));
 await panel.getByRole('button',{name:'读取存储模式'}).click();
 if(live){await panel.getByText(/已读取 4 个端口的当前实现/).waitFor();}
 else{
  await panel.getByText(/已读取 4 个端口的当前实现：0 个为本机开发文件/).waitFor();assert.equal(gets,1);
  const table=panel.getByLabel('存储模式明细');assert.equal(await table.locator('tbody tr').count(),4);
  const first=await table.locator('tbody tr').first().innerText();
  assert.ok(first.includes('进程内内存')&&first.includes('否'),first);
  body=ports('development-file','development-file','memory');gets=0;
  await panel.getByRole('button',{name:'读取存储模式'}).click();await panel.getByText(/2 个为本机开发文件/).waitFor();
  const rows=await table.locator('tbody tr').allInnerTexts();
  assert.ok(rows[0].includes('本机开发文件')&&rows[0].includes('是'),rows[0]);
  assert.ok(rows[2].includes('进程内内存')&&rows[2].includes('否'),rows[2]);
  assert.ok(rows[3].includes('功能提示词目录'),rows[3]);
  for(const invalid of [
   {...ports('memory','memory','memory'),anyDurable:true},
   {...ports('memory','memory','memory'),productionReady:true},
   {...ports('memory','memory','memory'),notes:' '},
   {...ports('memory','memory','memory'),ports:ports('memory','memory','memory').ports.slice(0,3)},
   {...ports('memory','memory','memory'),ports:ports('memory','memory','memory').ports.map((item,index)=>index===0?{...item,durable:true}:item)},
   {...ports('memory','memory','memory'),ports:ports('memory','memory','memory').ports.map((item,index)=>index===0?{...item,implementation:'mysql'}:item)},
   {...ports('memory','memory','memory'),ports:ports('memory','memory','memory').ports.map((item,index)=>index===1?{...item,limits:[]}:item)},
   {...ports('memory','memory','memory'),ports:ports('memory','memory','memory').ports.map((item,index)=>index===1?{...item,purpose:'/tmp/ops-demo/ledger.json'}:item)},
   {...ports('memory','memory','memory'),ports:ports('memory','memory','memory').ports.map((item,index)=>index===2?{...item,configuredByFile:'yes'}:item)},
  ]){
   body=invalid;await panel.getByRole('button',{name:'读取存储模式'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();
   assert.equal(await panel.locator('tbody').count(),0);
  }
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/storage-modes',hold);
  await panel.getByRole('button',{name:'读取存储模式'}).click();await panel.getByText('正在读取存储模式…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消存储模式等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/storage-modes',hold);
  // A relational deployment must be labelled as such in the table.
  body=ports('sqlite','sqlite','sqlite','sqlite');await panel.getByRole('button',{name:'读取存储模式'}).click();await panel.getByText(/已读取 4 个端口的当前实现/).waitFor();
  const relationalRows=await table.locator('tbody tr').allInnerTexts();
  assert.ok(relationalRows[0].includes('SQLite数据库（本地开发）'),relationalRows[0]);
  assert.ok(relationalRows[1].includes('唯一约束'),relationalRows[1]);
  // A PostgreSQL configuration must be labelled as such, and still not durable.
  body=ports('postgres','postgres','postgres','postgres');await panel.getByRole('button',{name:'读取存储模式'}).click();await panel.getByText(/已读取 4 个端口的当前实现/).waitFor();
  const postgresRows=await table.locator('tbody tr').allInnerTexts();
  assert.ok(postgresRows[0].includes('PostgreSQL（未接服务器）'),postgresRows[0]);
  body=ports('memory','memory','memory');await panel.getByRole('button',{name:'读取存储模式'}).click();await panel.getByText(/已读取 4 个端口/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'storage panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS storage modes ${live?'actual local HTTP':'injected'}: port report, no paths, invalid shapes and cancel.`);
}finally{await browser.close();}
