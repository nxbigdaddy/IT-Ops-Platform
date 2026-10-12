import{createRequire}from'node:module';import{existsSync}from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import assert from'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(path.join(root,'src/frontend/package.json'));const{chromium}=require('playwright-core');const browser=await chromium.launch({executablePath:['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync),headless:true});
const VOCAB_OK='已核对：8 个状态、9 个事件、11 条允许迁移均与后端规则一致。';
const VOCAB_MISMATCH='后端状态词汇表与本界面的状态标签或事件目标表不一致；已禁用迁移、历史与导出，避免误标状态。';
const vocabulary={states:['AwaitingApproval','Approved','Queued','Running','Succeeded','Failed','Cancelled','OutcomeUnknown'].map((name,value)=>({value,name})),events:['Approve','Enqueue','Start','Succeed','Fail','Cancel','Timeout','ReconcileSucceeded','ReconcileFailed'],transitions:[{from:0,event:'Approve',to:1},{from:0,event:'Cancel',to:6},{from:1,event:'Enqueue',to:2},{from:1,event:'Cancel',to:6},{from:2,event:'Start',to:3},{from:2,event:'Cancel',to:6},{from:3,event:'Succeed',to:4},{from:3,event:'Fail',to:5},{from:3,event:'Timeout',to:7},{from:7,event:'ReconcileSucceeded',to:4},{from:7,event:'ReconcileFailed',to:5}]};
let vocabBody=vocabulary,vocabGets=0;
try{const page=await browser.newPage();let state=0,version=1,calls=0;const task=()=>({id:'11111111-1111-1111-1111-111111111111',isDemo:true,executed:false,persistence:'memory',mode:'state-simulation-only',snapshot:{state,version}});
const live=process.argv.includes('--live');if(live)page.on('request',request=>{if(request.url().includes('/api/v1/demo-tasks'))calls++;if(request.url().endsWith('/api/v1/demo-task-vocabulary'))vocabGets++;});
if(!live)await page.route('**/api/v1/demo-task-vocabulary',route=>{vocabGets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:vocabBody})})});
if(!live)await page.route('**/api/v1/demo-tasks**',async route=>{calls++;const request=route.request();const data=request.postDataJSON();if(data){const map={Approve:1,Enqueue:2,Start:3,Timeout:7,ReconcileSucceeded:4};assert.equal(data.expectedVersion,version);state=map[data.event];version++;}await route.fulfill({status:request.url().endsWith('/demo-tasks')?201:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:request.method()==='POST'?{task:task()}:task()})});});
await page.goto('http://127.0.0.1:5173/integration');assert.equal(calls,0);assert.equal(vocabGets,0);
await page.getByRole('button',{name:'创建模拟任务',exact:true}).click();await page.getByText('状态：未核对词汇表',{exact:true}).waitFor();assert.equal(calls,1);
assert.equal(await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).isDisabled(),true);
await page.getByRole('button',{name:'核对任务状态词汇表',exact:true}).click();await page.getByText(VOCAB_OK,{exact:true}).waitFor();assert.equal(vocabGets,1);assert.equal(await page.getByRole('button',{name:'模拟批准',exact:true}).isEnabled(),true);
for(const label of ['模拟批准','模拟排队','模拟开始','模拟超时','模拟核实成功'])await page.getByRole('button',{name:label,exact:true}).click();await page.getByText('状态：成功 · 版本：6',{exact:true}).waitFor();assert.equal(calls,6);
if(live){await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText('版本 6 · 模拟核实成功 · 结果未知 → 成功',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"] li').count(),5);console.log('PASS explicit actual HTTP history renders five versioned transitions.');
 const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'导出模拟任务证据',exact:true}).click();const download=await downloadWait;const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);const evidence=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 assert.equal(evidence.taskId,await page.locator('[aria-label="模拟任务编号"]').textContent());assert.equal(evidence.version,6);assert.equal(evidence.transitions.length,5);assert.equal(evidence.executed,false);assert.equal(evidence.productionAudit,false);assert.equal(evidence.isDemo,true);assert.equal(evidence.persistence,'memory');
 assert.equal(evidence.stateLabelsVerified,true);assert.deepEqual(evidence.vocabulary,{states:8,events:9,transitions:11});
 assert.deepEqual(evidence.transitions[0],{label:'版本 2 · 模拟批准 · 待审批 → 已批准',version:2,event:'Approve',from:0,to:1});
 assert.equal(evidence.stateValue,4);assert.equal(evidence.state,'成功');
 assert.ok(evidence.transitions.every((item,index)=>item.version===index+2&&typeof item.event==='string'&&Number.isInteger(item.from)&&Number.isInteger(item.to)));
 console.log('PASS downloaded simulation evidence matches displayed task and non-production markers.');
 await page.getByRole('button',{name:'重发上次迁移（同幂等键）',exact:true}).click();
 await page.getByText(/服务器已确认该操作此前提交过（结果版本 v6）/).waitFor();
 assert.equal(await page.getByText('状态：成功 · 版本：6',{exact:true}).count(),1);
 await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText('版本 6 · 模拟核实成功 · 结果未知 → 成功',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"] li').count(),5);
 console.log('PASS same idempotency key replay reports the recorded result without advancing version or history.');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'populated task page overflows at390px');
 const panel=page.locator('[aria-label="任务状态模拟"]');assert.ok(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth),'populated task panel overflows');
 await page.setViewportSize({width:1280,height:720});console.log('PASS390px populated task identifier and five history rows without horizontal overflow.');
 await page.route('**/api/v1/demo-tasks/*/snapshot',async route=>{const response=await route.fetch();const body=await response.json();body.data.history=[];await route.fulfill({response,json:body});});
 await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText(/历史版本不一致，请刷新任务/).waitFor();
 assert.equal(await page.locator('[aria-label="模拟迁移记录"]').count(),0);assert.ok(await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).isDisabled());
 await page.unroute('**/api/v1/demo-tasks/*/snapshot');await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();
 await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText('版本 6 · 模拟核实成功 · 结果未知 → 成功',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"] li').count(),5);
 await page.route('**/api/v1/demo-tasks/*/snapshot',async route=>{const response=await route.fetch();const body=await response.json();body.data.history[4].event=0;await route.fulfill({response,json:body});});
 await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText(/历史事件与状态不符/).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"]').count(),0);
 await page.unroute('**/api/v1/demo-tasks/*/snapshot');await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();
 for(const variant of ['wrong-id','old-version']){
   const originalId=await page.locator('[aria-label="模拟任务编号"]').textContent();
   await page.route('**/api/v1/demo-tasks/*/snapshot',async route=>{const response=await route.fetch();const body=await response.json();if(variant==='wrong-id')body.data.task.id='22222222-2222-2222-2222-222222222222';else{body.data.task.snapshot={state:0,version:1};body.data.history=[];}await route.fulfill({response,json:body});});
   await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText(variant==='wrong-id'?/任务ID不匹配，拒绝切换/:/任务版本不一致，拒绝覆盖/).waitFor();
   assert.equal(await page.locator('[aria-label="模拟任务编号"]').textContent(),originalId);await page.getByText('状态：成功 · 版本：6',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"]').count(),0);assert.ok(await page.getByRole('button',{name:'导出模拟任务证据',exact:true}).isDisabled());
   await page.unroute('**/api/v1/demo-tasks/*/snapshot');await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();
  }
  console.log('PASS incomplete, semantic, wrong-ID and old-version snapshots rejected without partial display.');}
await page.route('**/api/v1/demo-tasks/*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:{...task(),id:'22222222-2222-2222-2222-222222222222'}})}));
await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();await page.getByText(/任务ID不匹配，拒绝切换/).waitFor();assert.equal(await page.getByText('状态：成功 · 版本：6',{exact:true}).count(),1);
await page.unroute('**/api/v1/demo-tasks/*');
await page.route('**/api/v1/demo-tasks/*',route=>route.fulfill({status:200,contentType:'application/json',body:'SYNTHETIC_PRIVATE_DIAGNOSTIC_NOT_JSON'}));
await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();await page.getByText(/未显示诊断正文/).waitFor();assert.ok(!(await page.content()).includes('SYNTHETIC_PRIVATE_DIAGNOSTIC_NOT_JSON'));
if(live){
 const previousId=await page.locator('[aria-label="模拟任务编号"]').textContent();
 assert.ok(await page.getByRole('button',{name:'结束本次查看',exact:true}).isDisabled());
 await page.unroute('**/api/v1/demo-tasks/*');await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();
 await page.getByRole('button',{name:'结束本次查看',exact:true}).click();await page.getByText(/服务器记录仍保留，未删除/).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"]').count(),0);
 const creation=page.waitForResponse(response=>response.url().endsWith('/api/v1/demo-tasks')&&response.request().method()==='POST');
 await page.getByRole('button',{name:'创建模拟任务',exact:true}).click();const created=await(await creation).json();const id=created.data.task.id;
 await page.getByRole('button',{name:'模拟批准',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'结束本次查看',exact:true}).isDisabled());
 assert.notEqual(id,previousId);assert.equal(await page.locator('[aria-label="模拟任务编号"]').textContent(),id);
 const rival=await page.request.post(`http://127.0.0.1:5173/api/v1/demo-tasks/${id}/transitions`,{data:{event:'Approve',expectedVersion:1}});assert.equal(rival.status(),200);
 await page.getByRole('button',{name:'模拟批准',exact:true}).click();await page.getByRole('region',{name:'任务状态模拟',exact:true}).getByText(/HTTP 409/).waitFor();
 assert.ok(await page.getByRole('button',{name:'模拟批准',exact:true}).isDisabled());assert.equal(await page.getByText('状态：待审批 · 版本：1',{exact:true}).count(),1);
 await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();await page.getByText('状态：已批准 · 版本：2',{exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'模拟排队',exact:true}).isEnabled());
 assert.equal((await page.request.post(`http://127.0.0.1:5173/api/v1/demo-tasks/${id}/transitions`,{data:{event:'Enqueue',expectedVersion:2}})).status(),200);
 await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).click();await page.getByText('状态：排队中 · 版本：3',{exact:true}).waitFor();assert.equal(await page.locator('[aria-label="模拟迁移记录"] li').count(),2);
 await page.route(`**/api/v1/demo-tasks/${id}`, route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:created.data.task})}));
 await page.getByRole('button',{name:'刷新模拟任务',exact:true}).click();await page.getByText(/任务版本不一致，拒绝覆盖/).waitFor();assert.equal(await page.getByText('状态：排队中 · 版本：3',{exact:true}).count(),1);assert.ok(await page.getByRole('button',{name:'模拟开始',exact:true}).isDisabled());
 console.log('PASS stale same-ID snapshot rejected without version rollback.');
 console.log('PASS actual competing request produces409, blocks transitions, and explicit refresh restores current version.');
}
if(!live){
 vocabBody={...vocabulary,transitions:vocabulary.transitions.map(item=>item.from===0&&item.event==='Approve'?{...item,to:3}:item)};
 await page.getByRole('button',{name:'核对任务状态词汇表',exact:true}).click();await page.getByText(VOCAB_MISMATCH,{exact:true}).waitFor();
 assert.equal(await page.getByText('状态：成功 · 版本：6',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'模拟核实成功',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'读取模拟迁移记录',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'重发上次迁移（同幂等键）',exact:true}).isDisabled(),true);
 vocabBody=vocabulary;await page.getByRole('button',{name:'核对任务状态词汇表',exact:true}).click();await page.getByText(VOCAB_OK,{exact:true}).waitFor();await page.getByText('状态：成功 · 版本：6',{exact:true}).waitFor();
 console.log('PASS task vocabulary mismatch fails closed and recovery restores state display.');
}
 console.log(`PASS task UI explicit create and timeout reconciliation with ${live?'actual local HTTP':'injected'} Demo API; no actual execution.`);}finally{await browser.close();}
