import{createRequire}from'node:module';import assert from'node:assert/strict';
const require=createRequire(new URL('../src/frontend/package.json',import.meta.url));const{chromium}=require('playwright-core');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:5173';
const rows=['网络','Linux','虚拟化扩展','安全','系统','虚拟化','终端','打印','备份','数据库监控目标'];
const channels=[
 {id:'agentless-snmp',label:'无代理 SNMP（只读）',deployment:'从平台侧直连设备，无需部署节点',prerequisites:['网络可达（仅文档保留地址）','SNMPv3 只读账号引用'],coversMatrixRows:['网络','打印'],needsAgent:false,status:'planned',protocols:['SNMPv3']},
 {id:'worker-linux-ssh',label:'受控 Linux Worker（SSH 只读）',deployment:'在受控网段部署采集节点后执行只读命令',prerequisites:['采集节点部署与加固','只读账号引用'],coversMatrixRows:['Linux'],needsAgent:true,status:'planned',protocols:['SSH allowlist','HTTPS agent']},
 {id:'worker-windows',label:'受控 Windows Worker',deployment:'在受控网段部署 Windows 采集节点',prerequisites:['采集节点部署与补丁基线','只读服务账号引用'],coversMatrixRows:['系统','终端'],needsAgent:true,status:'planned',protocols:['Windows Worker','WinRM HTTPS']},
 {id:'vendor-read-api',label:'厂商只读 API',deployment:'平台直接调用厂商管理接口（只读）',prerequisites:['厂商版本与许可确认','API 只读凭据引用'],coversMatrixRows:['安全','虚拟化','虚拟化扩展'],needsAgent:false,status:'planned',protocols:['HTTPS API','LDAPS']},
 {id:'restricted-sql',label:'受限 SQL（只读）',deployment:'以只读账号执行经白名单筛查的查询',prerequisites:['只读数据库账号引用'],coversMatrixRows:['数据库监控目标'],needsAgent:false,status:'planned',protocols:['Restricted SQL']},
 {id:'manual-registry',label:'人工登记／导入',deployment:'不做自动采集',prerequisites:['登记责任人','导入格式与校验'],coversMatrixRows:['备份'],needsAgent:false,status:'manual-only',protocols:['Manual evidence']},
];
const notes='通道为规划信息：未部署任何采集节点、未使用任何凭据、未验证厂商版本或许可。';
const catalog=(list)=>({channels:list,implemented:false,liveVerified:false,writeEnabled:false,notes});
const FAIL='采集通道目录读取失败或响应不符；不显示诊断正文，不回退本地判断。';
let body=catalog(channels),gets=0;
try{
 const page=await browser.newPage();const live=process.argv.includes('--live');
 if(live)page.on('request',request=>{if(request.url().endsWith('/connector-collection-channels'))gets++;});
 else await page.route('**/api/v1/connector-collection-channels',route=>{gets++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({isDemo:true,persistence:'none',data:body})})});
 await page.goto(base+'/connectors');
 const panel=page.getByRole('region',{name:'采集通道目录'});await panel.waitFor();
 assert.equal(await panel.locator('tbody').count(),0);assert.equal(gets,0);
 assert.ok((await panel.innerText()).includes('未部署节点'));
 await panel.getByRole('button',{name:'载入采集通道目录'}).click();
 await panel.getByText(/已载入 6 条采集通道/).waitFor();
 if(!live){
  assert.equal(gets,1);
  const table=panel.getByLabel('采集通道明细');assert.equal(await table.locator('tbody tr').count(),6);
  const text=await table.innerText();
  assert.ok(text.includes('受控 Windows Worker')&&text.includes('是')&&text.includes('计划接入'),text);
  assert.ok(text.includes('承载协议')&&text.includes('WinRM HTTPS')&&text.includes('Manual evidence'),text);
  assert.ok((await panel.locator('.field-note').first().innerText()).includes('矩阵 10 行均已被至少一条通道覆盖'),await panel.locator('.field-note').first().innerText());
  // A catalog that drops a row must surface the gap instead of silently covering everything.
  body=catalog(channels.filter(channel=>channel.id!=='manual-registry'));
  await panel.getByRole('button',{name:'载入采集通道目录'}).click();await panel.getByText(/已载入 5 条采集通道/).waitFor();
  assert.ok((await panel.locator('.field-note').first().innerText()).includes('尚无通道覆盖的矩阵行：备份'),await panel.locator('.field-note').first().innerText());
  for(const invalid of [
   catalog([]),
   catalog(channels.map(channel=>({...channel,id:''}))),
   catalog([...channels,channels[0]]),
   catalog(channels.map(channel=>({...channel,prerequisites:[]}))),
   catalog(channels.map(channel=>({...channel,coversMatrixRows:['不存在的行']}))),
   catalog(channels.map(channel=>({...channel,status:'live'}))),
   catalog(channels.map(channel=>({...channel,protocols:[]}))),
   catalog(channels.map(channel=>({...channel,protocols:['SNMPv3','SNMPv3']}))),
   catalog(channels.map(channel=>({...channel,protocols:['不存在的协议']}))),
   {...catalog(channels),implemented:true},
   {...catalog(channels),liveVerified:true},
   {...catalog(channels),writeEnabled:true},
   {...catalog(channels),notes:' '},
  ]){
   body=invalid;await panel.getByRole('button',{name:'载入采集通道目录'}).click();
   await assert.doesNotReject(async()=>{const deadline=Date.now()+8000;for(;;){if((await panel.locator('p[role=status]').innerText())===FAIL)return;if(Date.now()>deadline)throw new Error('invalid catalog was accepted');await page.waitForTimeout(100)}});
   assert.equal(await panel.locator('tbody').count(),0);
  }
  let release;const held=new Promise(resolve=>release=resolve);const hold=async route=>{await held;try{await route.abort()}catch{}};
  await page.route('**/api/v1/connector-collection-channels',hold);
  await panel.getByRole('button',{name:'载入采集通道目录'}).click();await panel.getByText('正在载入采集通道目录…',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'取消通道载入等待'}).click();await panel.getByText('等待已取消或超时；没有新的结论。',{exact:true}).waitFor();
  release();await page.unroute('**/api/v1/connector-collection-channels',hold);
  body=catalog(channels);await panel.getByRole('button',{name:'载入采集通道目录'}).click();await panel.getByText(/已载入 6 条采集通道/).waitFor();
 }
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'channel panel overflows at390px');await page.setViewportSize({width:1280,height:720});
 console.log(`PASS collection channels ${live?'actual local HTTP':'injected'}: catalog, row coverage, gaps, invalid shapes and cancel.`);
}finally{await browser.close();}
