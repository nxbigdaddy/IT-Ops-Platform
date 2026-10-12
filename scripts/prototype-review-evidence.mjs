import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const catalog=['demo-snmp','demo-linux','demo-virtualization','demo-firewall-api','demo-directory','demo-windows','demo-endpoint','demo-printer','demo-backup','demo-db-monitor'].map(id=>({id,name:id.toUpperCase(),category:'Synthetic',protocols:['SNMPv3'],targetFamilies:['synthetic'],candidateVendors:['synthetic'],plannedReadCapabilities:['inventory'],requiredBeforeOnboarding:['只读账号'],status:'planned',implemented:false,liveVerified:false,writeEnabled:false}));
const EMPTY='尚无已核验结论；请先在上方各面板显式载入或检查。';
let gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().includes('/api/v1/connector-capabilities'))gets++;});
 else{
  await page.route('**/api/v1/connector-capabilities',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:catalog})})});
  await page.route('**/api/v1/connector-plan-preflight',route=>{const items=route.request().postDataJSON().items??[];return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:{configurationValid:true,validItems:items.length,invalidItems:0,errors:[],items:items.map((_,index)=>({index,configurationValid:true,errors:[]})),connectionAttempted:false,executionAllowed:false,compatibilityVerified:false}})});});
 }
 await page.goto(base+'/integration');
 // The route is loaded on demand: wait until the lazy chunk has rendered.
 await page.waitForFunction(()=>!document.body.innerText.includes('正在载入本页模块'));
 const panel=page.getByRole('region',{name:'本次会话评审证据'});await panel.waitFor();
 const exportButton=panel.getByRole('button',{name:/导出本页评审证据/});
 assert.ok(await exportButton.isDisabled());await panel.getByText(EMPTY,{exact:true}).waitFor();
 assert.equal(await panel.locator('tbody').count(),0);
 const connectors=page.getByRole('region',{name:'连接器只读意图预检'});
 await connectors.getByRole('button',{name:'载入候选目录'}).click();await connectors.getByText(/已载入 10 个候选/).waitFor();assert.equal(gets,1);
 await panel.getByText(/已记录 1 项已核验结论/).waitFor();
 assert.equal(await panel.locator('tbody tr').count(),1);assert.ok((await panel.innerText()).includes('连接器候选目录'));
 await connectors.getByRole('button',{name:'自检目录内部一致性'}).click();await connectors.getByText(/目录自检通过：10\/10 项声明内部一致/).waitFor();
 await panel.getByText(/已记录 2 项已核验结论/).waitFor();
 assert.ok(await exportButton.isEnabled());assert.ok((await exportButton.innerText()).includes('2 项'));
 const download=page.waitForEvent('download');await exportButton.click();const file=await download;
 const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
 const evidence=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 assert.equal(evidence.schemaVersion,1);assert.equal(evidence.isDemo,true);assert.equal(evidence.productionEvidence,false);assert.equal(evidence.persistence,'none');
 assert.equal(typeof evidence.buildId,'string');assert.ok(evidence.buildId.length>0&&evidence.buildId.length<=40,'build id must be present and bounded');
 assert.equal(evidence.items.length,2);
 assert.deepEqual(evidence.items.map(item=>item.key),['connector-catalog','connector-selfcheck']);
 assert.ok(evidence.items.every(item=>typeof item.label==='string'&&typeof item.detail==='string'&&item.detail.length<=200));
 assert.ok(!JSON.stringify(evidence).includes('secret'),'evidence must not contain secrets');
 assert.equal(file.suggestedFilename(),'demo-review-evidence.json');
 assert.ok(await panel.getByText(/不能作为生产就绪或部门验收证明/).count()>=1);
 await panel.getByRole('button',{name:'清空证据清单'}).click();await panel.getByText(EMPTY,{exact:true}).waitFor();assert.ok(await exportButton.isDisabled());
 await connectors.getByRole('button',{name:'载入候选目录'}).click();await connectors.getByText(/已载入 10 个候选/).waitFor();await panel.getByText(/已记录 1 项已核验结论/).waitFor();
 await page.getByRole('link',{name:'验收反馈'}).click();
 const feedbackPanel=page.getByRole('region',{name:'本次会话评审证据'});await feedbackPanel.waitFor();
 await feedbackPanel.getByText(/已记录 1 项已核验结论/).waitFor();
 assert.ok((await feedbackPanel.innerText()).includes('连接器候选目录'));assert.ok((await feedbackPanel.innerText()).includes('跨页共享同一份清单'));
 await page.getByRole('link',{name:'后端联调'}).click();
 await page.getByRole('region',{name:'本次会话评审证据'}).getByText(/已记录 1 项已核验结论/).waitFor();
 await page.getByRole('region',{name:'本次会话评审证据'}).getByRole('button',{name:'清空证据清单'}).click();
 await page.getByRole('region',{name:'本次会话评审证据'}).getByText(EMPTY,{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'review evidence panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS review evidence pack ${live?'actual local HTTP':'injected'}: disabled until verified, aggregates panel conclusions, exports non-production JSON and clears.`);
}finally{await browser.close();}
