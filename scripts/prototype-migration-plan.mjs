import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const step=(id,table)=>({id,table,purpose:`${table}的用途说明`,keyColumns:['id'],uniqueConstraints:[`ux_${table}(id)`],notes:`${table}的迁移要求说明`,executed:false,productionEnabled:false});
const planBody=[
 step('feedback-records','feedback_records'),step('operation-ledger','operation_ledger'),
 step('prompt-drafts','prompt_drafts'),step('prompt-published','prompt_published'),
 step('prompt-versions','prompt_versions'),step('task-journal','task_journal'),
 step('task-snapshots','task_snapshots'),step('feature-registry','prompt_features'),
];
const LOAD_OK='已载入 8 步迁移计划；全部为未执行，未创建任何表或约束。';
const FAIL='迁移计划载入失败或响应不符；不显示诊断正文，不回退为本地计划。';
let plan=planBody,gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/api/v1/migration-plan'))gets++;});
 else await page.route('**/api/v1/migration-plan',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:plan})})});
 await page.goto(base+'/database');
 const panel=page.getByRole('region',{name:'持久化迁移计划'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 assert.ok(await panel.getByText(/不创建任何表/).count()>=1);
 await panel.getByRole('button',{name:'载入迁移计划'}).click();
 if(live){await panel.getByLabel('迁移计划清单').waitFor();}
 else{
  await panel.getByText(LOAD_OK,{exact:true}).waitFor();assert.equal(gets,1);
  const table=panel.getByLabel('迁移计划清单');assert.equal(await table.locator('tbody tr').count(),8);
  assert.ok((await table.innerText()).includes('operation_ledger'));
  assert.equal(await table.getByText('未执行',{exact:true}).count(),8);
  const downloadWait=page.waitForEvent('download');await panel.getByRole('button',{name:'导出迁移计划 CSV（含批注列）'}).click();
  const file=await downloadWait;assert.equal(file.suggestedFilename(),'migration-plan-template.csv');
  const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
  const csv=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'').trim().split('\n');
  assert.equal(csv[0],'id,table,purpose,keyColumns,uniqueConstraints,notes,executed,productionEnabled,评审结论,部门意见');
  assert.equal(csv.length,9);assert.ok(csv.slice(1).every(line=>line.includes(',否,否,')));
  for(const bad of [
   planBody.map(item=>item.id==='operation-ledger'?{...item,executed:true}:item),
   planBody.map(item=>item.id==='operation-ledger'?{...item,productionEnabled:true}:item),
   planBody.map(item=>item.id==='operation-ledger'?{...item,keyColumns:[]}:item),
   planBody.map(item=>item.id==='operation-ledger'?{...item,uniqueConstraints:[]}:item),
   planBody.map(item=>item.id==='operation-ledger'?{...item,notes:' '}:item),
   planBody.map(item=>item.id==='operation-ledger'?{...item,table:'task_snapshots'}:item),
   [planBody[0],{...planBody[1],id:'feedback-records'}],
   [],
  ]){
   plan=bad;await panel.getByRole('button',{name:'载入迁移计划'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();
   await page.waitForFunction(()=>!document.querySelector('[aria-label="迁移计划清单"]'));
  }
  plan=planBody;await panel.getByRole('button',{name:'载入迁移计划'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/migration-plan',hold);
  await panel.getByRole('button',{name:'载入迁移计划'}).click();await panel.getByText('正在载入迁移计划…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消迁移计划等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/migration-plan',hold);
  await panel.getByRole('button',{name:'载入迁移计划'}).click();await panel.getByText(LOAD_OK,{exact:true}).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'migration plan overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS migration plan ${live?'actual local HTTP':'injected'}: eight steps, no execution claim, annotation export and cancel.`);
}finally{await browser.close();}
