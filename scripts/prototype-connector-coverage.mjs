import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const ids=['demo-snmp','demo-linux','demo-virtualization','demo-firewall-api','demo-directory','demo-windows','demo-endpoint','demo-printer','demo-backup','demo-db-monitor'];
const categories={'demo-snmp':'Network','demo-linux':'Server','demo-virtualization':'Virtualization','demo-firewall-api':'Network','demo-directory':'Directory','demo-windows':'Server','demo-endpoint':'Endpoint','demo-printer':'Printing','demo-backup':'Backup','demo-db-monitor':'DatabaseTarget'};
const protocols={'demo-snmp':['SNMPv3'],'demo-linux':['SSH allowlist'],'demo-virtualization':['HTTPS API'],'demo-firewall-api':['HTTPS API'],'demo-directory':['LDAPS'],'demo-windows':['WinRM HTTPS'],'demo-endpoint':['HTTPS API'],'demo-printer':['SNMPv3'],'demo-backup':['HTTPS API'],'demo-db-monitor':['Restricted SQL']};
const catalog=ids.map(id=>({id,name:id.replace('demo-','').toUpperCase(),category:categories[id],protocols:protocols[id],targetFamilies:['synthetic'],candidateVendors:['synthetic'],plannedReadCapabilities:['inventory'],status:'planned',implemented:false,liveVerified:false,writeEnabled:false,evidence:'synthetic fixture',requiredBeforeOnboarding:['只读账号与最小权限','版本与固件确认']}));
const CONSISTENT='页面矩阵与后端目录覆盖一致：10/10 个候选均有对应行。此核对不验证协议等价或设备兼容。';
const FAIL='目录覆盖核对失败或响应不符；不显示诊断正文，不回退为本地结论。';
let body=catalog,gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/connector-capabilities'))gets++;});
 else await page.route('**/api/v1/connector-capabilities',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
 await page.goto(base+'/connectors');
 const panel=page.getByRole('region',{name:'矩阵覆盖核对'});await panel.waitFor();
 assert.equal(await panel.locator('tbody tr').count(),0);assert.equal(gets,0);
 await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(CONSISTENT,{exact:true}).waitFor();assert.equal(gets,1);
 const mapping=panel.getByRole('table',{name:'矩阵与候选映射'});
 assert.equal(await mapping.locator('tbody tr').count(),10);
 assert.equal(await panel.getByText(/没有任何矩阵行覆盖/).count(),0);
 const lastRow=mapping.locator('tbody tr').last();
 assert.ok((await lastRow.innerText()).includes('数据库监控目标'));
 assert.ok(!(await lastRow.innerText()).includes('未覆盖'));
 assert.ok((await mapping.innerText()).includes('接入前需确认（候选声明）'));
 const lastCells=await lastRow.locator('td').allInnerTexts();
 assert.ok(lastCells[4].includes('；'),lastCells[4]);
 if(!live)assert.ok(lastCells[4].includes('只读账号与最小权限'),lastCells[4]);
 const detail=page.getByLabel('候选目录明细');assert.equal(await detail.locator('tbody tr').count(),10);
 assert.ok((await detail.innerText()).includes('未实现/未验证/未开放'),await detail.innerText());
 const firstCells=await detail.locator('tbody tr').first().locator('td').allInnerTexts();
 assert.equal(firstCells.length,8);assert.ok(firstCells[7].includes('未实现'));
 const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'导出候选明细 CSV（含批注列）'}).click(); const file=await downloadWait;assert.equal(file.suggestedFilename(),'connector-candidates-template.csv');
 const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
 const csv=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'').trim();
 const lines=csv.split('\n');assert.equal(lines.length,11);
 assert.equal(lines[0],'id,name,category,protocols,plannedReadCapabilities,targetFamilies,candidateVendors,requiredBeforeOnboarding,status,implemented,liveVerified,writeEnabled,首批纳入,部门意见');
 assert.ok(lines[1].startsWith('demo-snmp,'));
 assert.ok(lines.slice(1).every(line=>line.includes('planned')&&line.includes('否')&&!/,true|,yes/i.test(line)),'exported flags must stay false');
 // Local inventory kinds must map to planned candidates, or be reported as an unmapped gap.
 const assetTable=page.getByLabel('资产类别覆盖');
 assert.equal(await assetTable.locator('tbody tr').count(),8);
 const assetText=await assetTable.innerText();
 assert.ok(assetText.includes('尚无候选（未映射）'),assetText);
 assert.ok(assetText.includes('存储')&&assetText.includes('软件授权'),assetText);
 assert.ok((await panel.innerText()).includes('未映射类别：存储、软件授权'),await panel.innerText());
 assert.ok((await assetTable.innerText()).includes('demo-linux'),assetText);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'coverage page overflows at390px');await page.setViewportSize({width:1280,height:720});
 if(!live){
  body=[...catalog.slice(0,9),{...catalog[9],id:'demo-new-area'}];
  await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(/发现 2 处覆盖差异/).waitFor();
  await panel.getByText(/后端候选 demo-new-area 没有任何矩阵行覆盖/).waitFor();await panel.getByText(/矩阵引用了不存在的候选 demo-db-monitor/).waitFor();
  // A grown registry must be reported as drift, not rejected as a malformed catalog.
  body=[...catalog,{...catalog[0],id:'demo-extra-area'}];
  await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(/发现 1 处覆盖差异/).waitFor();
  await panel.getByText(/后端候选 demo-extra-area 没有任何矩阵行覆盖/).waitFor();
  // The mapping table stays at one row per matrix row; the detail table follows the registry.
  assert.equal(await panel.getByLabel('矩阵与候选映射').locator('tbody tr').count(),10);
  assert.equal(await panel.getByLabel('候选目录明细').locator('tbody tr').count(),11);
  assert.equal(await panel.getByText(/没有任何矩阵行覆盖/).count(),1);
  body=[];await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  body=Array.from({length:33},(_,index)=>({...catalog[index%10],id:`demo-extra-${index}`}));await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  body=catalog.map((item,index)=>index===3?{...item,implemented:true}:item);await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(FAIL,{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  body=catalog;await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(CONSISTENT,{exact:true}).waitFor();
  await panel.getByText(/未包含其覆盖候选的任何已登记协议，仅供人工核对/).waitFor();
  assert.ok((await panel.innerText()).includes('「Linux」显示'));
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/connector-capabilities',hold);
  await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText('正在载入后端目录并核对矩阵…',{exact:true}).waitFor();assert.equal(await panel.locator('tbody').count(),0);
  await panel.getByRole('button',{name:'取消覆盖核对等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/connector-capabilities',hold);await panel.getByRole('button',{name:'核对矩阵覆盖'}).click();await panel.getByText(CONSISTENT,{exact:true}).waitFor();
 }
 console.log(`PASS connector matrix coverage ${live?'actual local HTTP':'injected'}: mapping table, drift detection, invalid catalogs and cancel.`);
}finally{await browser.close();}
