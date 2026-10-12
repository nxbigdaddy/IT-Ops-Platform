import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const notes='仅开发演示草稿；内存数据重启丢失。未实现审批、发布、模型调用或生产持久化。';
const specs={
 'alert-explanation':{feature:'alerts',name:'告警解释',variables:['asset_name','alert_summary','severity'],required:['asset_name','alert_summary'],descriptions:['演示资产名称','已知告警信息','演示严重级别'],examples:['演示应用服务器','演示磁盘使用率85%，根因未知','Warning']},
 'ticket-summary':{feature:'tickets',name:'工单摘要',variables:['ticket_id','ticket_details','asset_name'],required:['ticket_id','ticket_details'],descriptions:['演示工单编号','演示工单已知信息','关联演示资产'],examples:['demo-ticket-01','排查磁盘告警；尚未确认根因','演示应用服务器']},
 'inspection-report':{feature:'inspection',name:'巡检报告',variables:['asset_name','inspection_result','inspection_date'],required:['asset_name','inspection_result'],descriptions:['演示资产名称','演示巡检观察结果','演示巡检日期'],examples:['演示应用服务器','演示主机可达；备份结果未知','2026-10-10']},
};
const seeds={
 'alert-explanation':'根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；无依据时明确无法确认，不执行操作。',
 'ticket-summary':'总结工单 {{ticket_id}} 的 {{ticket_details}} 与待人工确认项；不得自行批准变更。',
 'inspection-report':'依据 {{asset_name}} 的 {{inspection_result}} 编写摘要，标明缺失数据与来源，禁止将未知状态描述为正常。',
};
const built=Object.fromEntries(Object.keys(specs).map(id=>[id,[{version:1,content:seeds[id],createdAt:'2026-01-01T00:00:00Z',sourceVersion:null,status:'draft'}]]));
const published=Object.fromEntries(Object.keys(specs).map(id=>[id,[]]));
function detail(id){
 const spec=specs[id],versions=built[id],latest=versions[versions.length-1];
 return {id,feature:spec.feature,name:spec.name,currentVersion:latest.version,content:latest.content,variables:spec.variables,
  schema:spec.variables.map((name,index)=>({name,type:'string',description:spec.descriptions[index],example:spec.examples[index],required:spec.required.includes(name)})),
  versions:[...versions].reverse(),maxVersions:20,maxContentLength:4000,status:'draft',modelExecutionEnabled:false,notes,
  published:[...published[id]].reverse(),publishedVersion:published[id].length};
}
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(!live)await page.route('**/api/v1/prompts**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='GET'&&url.pathname==='/api/v1/prompts')
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:Object.keys(specs).map(detail)})});
  const id=url.pathname.split('/')[4],entry=built[id];assert.ok(entry,'unexpected prompt path '+url.pathname);
  if(request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:detail(id)})});
  const body=request.postDataJSON(),current=entry[entry.length-1].version;
  if(url.pathname.endsWith('/publish')){
   if(body.expectedVersion!==current)return route.fulfill({status:409,contentType:'application/problem+json',body:JSON.stringify({isDemo:true,persistence:'memory',code:'version_conflict'})});
   if(published[id].some(item=>item.publishedFrom===current))return route.fulfill({status:409,contentType:'application/problem+json',body:JSON.stringify({isDemo:true,persistence:'memory',code:'already_published'})});
   assert.ok(/^approval:\/\/prompt\/[a-z0-9-]+\/[1-9][0-9]{0,5}$/.test(body.approvalReference),'publish must carry an approval reference: '+body.approvalReference);assert.ok(typeof body.approvedBy==='string'&&body.approvedBy.trim().length>0,'publish must carry an approver');
   published[id].push({version:published[id].length+1,content:entry[entry.length-1].content,publishedFrom:current,publishedAt:'2026-01-03T00:00:00Z',status:'published',approvalReference:body.approvalReference,approvedBy:body.approvedBy.trim()});
   return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:detail(id)})});
  }
  if(body.expectedVersion!==current)return route.fulfill({status:409,contentType:'application/problem+json',body:JSON.stringify({isDemo:true,persistence:'memory',code:'version_conflict'})});
  const source=url.pathname.endsWith('/restore')?body.sourceVersion:null;
  const content=source===null?body.content:entry.find(version=>version.version===source).content;
  entry.push({version:current+1,content,createdAt:'2026-01-02T00:00:00Z',sourceVersion:source,status:'draft'});
  return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'memory',data:detail(id)})});
 });
 const reference=live?(await(await page.request.get(`${base}/api/v1/prompts/alert-explanation`)).json()).data:null;
 await page.goto(base+'/prompt-governance');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'服务器 Demo 版本'});await panel.waitFor();
 await panel.getByRole('button',{name:'加载服务器提示词列表'}).click();await panel.getByText(/已验证服务器 Demo 固定 3 项目录/).waitFor();
 await panel.getByRole('button',{name:'加载服务器提示词详情'}).click();await panel.getByText(/详情已加载/).waitFor();
 const history=panel.getByRole('table',{name:'服务器版本历史'}),preview=panel.getByLabel('所选服务器历史版本内容');
 await history.waitFor();
 const expected=live?reference.currentVersion:1;
 assert.equal(await history.locator('tbody tr').count(),expected);
 assert.equal(await panel.getByLabel('查看历史版本内容').inputValue(),String(expected));
 assert.equal((await preview.textContent()).trim(),live?reference.content:seeds['alert-explanation']);
 assert.equal(await panel.getByText(/历史只追加、不改写/).count(),1);
 assert.ok((await history.locator('tbody tr').first().innerText()).includes(`v${expected}（当前）`));
 if(live&&expected>1){
  const oldest=reference.versions[reference.versions.length-1].version;
  await panel.getByLabel('查看历史版本内容').selectOption(String(oldest));
  assert.equal((await preview.textContent()).trim(),reference.versions[reference.versions.length-1].content);
  assert.equal(await panel.getByText(/所选为历史版本，只读展示/).count(),1);
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'prompt history overflows at390px');await page.setViewportSize({width:1280,height:720});
 if(!live){
  const draft='根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；补充 {{severity}}，无依据时不执行操作。';
  await panel.getByLabel('服务器提示词内容').fill(draft);
  await panel.getByRole('button',{name:'保存服务器新版本'}).click();await panel.getByText(/已创建服务器内存 draft v2/).waitFor();
  assert.equal(await history.locator('tbody tr').count(),2);assert.equal(await panel.getByLabel('查看历史版本内容').inputValue(),'2');
  assert.ok((await history.locator('tbody tr').first().innerText()).includes('新内容'));
  await panel.getByLabel('查看历史版本内容').selectOption('1');
  assert.equal((await preview.textContent()).trim(),seeds['alert-explanation']);
  assert.equal(await panel.getByText(/所选为历史版本，只读展示/).count(),1);
  assert.equal(await panel.getByLabel('服务器提示词内容').inputValue(),draft);
  await panel.getByLabel('服务器恢复来源版本').selectOption('1');
  await panel.getByRole('button',{name:'恢复服务器历史为新版本'}).click();await panel.getByText(/已创建服务器内存 draft v3/).waitFor();
  assert.equal(await history.locator('tbody tr').count(),3);
  assert.ok((await history.locator('tbody tr').first().innerText()).includes('由 v1 恢复'));
  assert.equal(await panel.getByLabel('查看历史版本内容').inputValue(),'3');
  assert.equal(await panel.getByText('尚无发布修订；草稿保存与恢复都不会自动发布。',{exact:true}).count(),1);
  const publish=panel.getByRole('button',{name:'发布当前草稿为发布修订'});
  // Publishing without an approval record must stay impossible from the UI.
  assert.ok(await publish.isDisabled(),'publish must be disabled without an approval record');
  await panel.getByLabel('审批引用').fill('approval://prompt/alert-explanation/9');
  await panel.getByLabel('审批人').fill('演示审批人');
  assert.ok(await publish.isEnabled());
  await publish.click();await panel.getByText(/已创建发布修订 v1（来自草稿 v3）/).waitFor();
  const revisions=panel.getByRole('table',{name:'发布修订历史'});
  assert.equal(await revisions.locator('tbody tr').count(),1);
  assert.ok((await revisions.locator('tbody tr').first().innerText()).includes('v3'));
  assert.ok((await revisions.locator('tbody tr').first().innerText()).includes('approval://prompt/alert-explanation/9'),await revisions.innerText());
  assert.equal(await history.locator('tbody tr').count(),3);
  assert.ok(await publish.isDisabled());
  assert.equal(await panel.getByText('当前草稿版本 v3 已发布；按钮已禁用，历史不可改写。',{exact:true}).count(),1);
  assert.equal((await panel.getByLabel('所选发布修订内容').textContent()).trim(),seeds['alert-explanation']);
  assert.equal(await panel.getByLabel('查看发布修订内容').inputValue(),'1');
  assert.equal(await panel.getByText(/内容与来源草稿版本逐字一致/).count(),1);
  assert.equal((await panel.getByLabel('发布修订与当前草稿差异').textContent()).trimEnd(),`  ${seeds['alert-explanation']}`);
  await panel.getByLabel('服务器提示词内容').fill('根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；已被本地修改。');
  const diff=(await panel.getByLabel('发布修订与当前草稿差异').textContent()).trimEnd();
  assert.ok(diff.startsWith(`- ${seeds['alert-explanation']}`),diff);
  assert.ok(diff.includes('+ 根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；已被本地修改。'),diff);
  assert.equal(await panel.getByText(/仅逐行文本比对，不做语义判断/).count(),1);
 }
 console.log(`PASS prompt server history ${live?'actual local HTTP':'injected'}: append-only table, read-only historical preview, restore provenance${live?'':' and publish revision'}.`);
}finally{await browser.close();}
